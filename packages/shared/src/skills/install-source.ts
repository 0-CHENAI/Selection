/** Bounded, non-executing skill source snapshots. Never extracts archive paths directly. */
import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { createHash } from "node:crypto";
import { Parser } from "tar";
import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";

export const INSTALL_LIMITS = {
  timeoutMs: 120_000,
  downloadBytes: 50 * 1024 ** 2,
  unpackedBytes: 200 * 1024 ** 2,
  files: 20_000,
};
export interface SkillSourceArgs {
  source: string;
  ref?: string;
  skillPath?: string;
  slug?: string;
}
export interface SnapshotFile {
  path: string;
  data: Buffer;
  mode: number;
}
export interface SkillSnapshot {
  files: SnapshotFile[];
  source: string;
  commit?: string;
  suggestedSlug: string;
  skillPath?: string;
}
export class SkillInstallError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export function fail(code: string, message: string): never {
  throw new SkillInstallError(code, message);
}
const ignored = new Set([".git", "node_modules", ".DS_Store"]);
export function safeRelative(path: string): string {
  if (
    !path ||
    path.includes("\\") ||
    path.startsWith("/") ||
    path
      .split("/")
      .some(
        (p) =>
          !p ||
          p === "." ||
          p === ".." ||
          /[<>:"|?*\x00-\x1f]/.test(p) ||
          /[. ]$/.test(p) ||
          /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
      )
  ) {
    fail("unsafe_path", `Unsupported or unsafe path: ${path}`);
  }
  return path;
}
export function fingerprint(files: SnapshotFile[]): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) =>
    a.path.localeCompare(b.path, "en"),
  )) {
    hash.update(
      JSON.stringify([
        file.path,
        process.platform === "win32" ? 0 : file.mode & 0o111,
        file.data.length,
      ]),
    );
    hash.update(file.data);
  }
  return hash.digest("hex");
}
function validateFiles(files: SnapshotFile[]): void {
  const allFileNames = new Set(
    files.map((f) => f.path.normalize("NFC").toLowerCase()),
  );
  const names = new Set<string>();
  const components = new Map<string, string>();
  let size = 0;
  for (const file of files) {
    safeRelative(file.path);
    const key = file.path.normalize("NFC").toLowerCase();
    if (names.has(key))
      fail("path_collision", `Case-insensitive path collision: ${file.path}`);
    names.add(key);
    size += file.data.length;
    const parts = file.path.split("/");
    for (let i = 1; i <= parts.length; i++) {
      const path = parts.slice(0, i).join("/");
      const normalized = path.normalize("NFC").toLowerCase();
      const previous = components.get(normalized);
      if (previous && previous !== path)
        fail("path_collision", `Conflicting path spelling: ${path}`);
      components.set(normalized, path);
      if (i < parts.length && allFileNames.has(normalized))
        fail("path_collision", `File used as directory: ${path}`);
    }
  }
  if (
    files.length > INSTALL_LIMITS.files ||
    size > INSTALL_LIMITS.unpackedBytes
  )
    fail("source_too_large", "Skill source exceeds file or size limits");
}
export async function snapshotLocal(
  root: string,
  signal: AbortSignal,
): Promise<SnapshotFile[]> {
  const files: SnapshotFile[] = [];
  let bytes = 0;
  let entries = 0;
  const walk = async (dir: string, prefix: string): Promise<void> => {
    signal.throwIfAborted();
    const stat = await lstat(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory())
      fail("unsupported_file", `Expected a real directory: ${dir}`);
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      signal.throwIfAborted();
      if (ignored.has(entry.name)) continue;
      if (++entries > INSTALL_LIMITS.files)
        fail("source_too_large", "Too many source entries");
      const path = safeRelative(prefix + entry.name);
      const abs = resolve(dir, entry.name);
      const st = await lstat(abs);
      if (st.isSymbolicLink())
        fail(
          "unsupported_symlink",
          `Symbolic links are not supported: ${path}`,
        );
      if (st.isDirectory()) await walk(abs, path + "/");
      else if (st.isFile()) {
        bytes += st.size;
        if (bytes > INSTALL_LIMITS.unpackedBytes)
          fail("source_too_large", "Source exceeds unpacked limit");
        const data = await readFile(abs, { signal });
        if (data.length !== st.size)
          fail("source_changed", `Source changed while reading: ${path}`);
        files.push({ path, data, mode: 0o644 | (st.mode & 0o111) });
      } else
        fail("unsupported_file", `Special files are not supported: ${path}`);
    }
  };
  await walk(root, "");
  validateFiles(files);
  return files;
}
async function get(
  url: string,
  signal: AbortSignal,
  fetcher: typeof fetch,
): Promise<Response> {
  const response = await fetcher(url, {
    signal,
    redirect: "error",
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "Selection-Skill-Installer",
    },
  });
  if (!response.ok) {
    await response.body?.cancel();
    fail(
      response.status === 429 ||
        (response.status === 403 &&
          response.headers.get("x-ratelimit-remaining") === "0")
        ? "rate_limited"
        : response.status === 401 || response.status === 403
          ? "access_denied"
          : response.status === 404
            ? "source_not_found"
            : "http_error",
      `GitHub returned HTTP ${response.status}`,
    );
  }
  return response;
}
async function boundedBody(
  response: Response,
  max: number,
  signal: AbortSignal,
): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) return fail("empty_response", "Response body is missing");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > max) fail("source_too_large", "Download exceeds size limit");
      chunks.push(value);
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => {});
  }
}
export async function unpackArchive(
  data: Buffer,
  signal: AbortSignal,
): Promise<SnapshotFile[]> {
  const files: SnapshotFile[] = [];
  let bytes = 0;
  let entries = 0;
  let root: string | undefined;
  await new Promise<void>((resolveDone, reject) => {
    let stream: ReturnType<typeof createGunzip> | undefined;
    const parser = new Parser({
      strict: true,
      maxMetaEntrySize: 64 * 1024,
      onReadEntry(entry) {
        try {
          signal.throwIfAborted();
          if (++entries > INSTALL_LIMITS.files)
            fail("source_too_large", "Too many archive entries");
          const full = safeRelative(entry.path.replace(/\/$/, ""));
          const parts = full.split("/");
          root ??= parts[0];
          if (root !== parts[0])
            fail("invalid_archive", "Archive must have one root directory");
          if (!["File", "OldFile", "Directory"].includes(entry.type))
            fail(
              "unsupported_file",
              `Archive entry type ${entry.type} is unsupported`,
            );
          bytes += entry.size;
          if (bytes > INSTALL_LIMITS.unpackedBytes)
            fail("source_too_large", "Archive exceeds unpacked limit");
          if (
            entry.type === "Directory" ||
            parts.length === 1 ||
            parts.some((p) => ignored.has(p))
          ) {
            entry.resume();
            return;
          }
          const chunks: Buffer[] = [];
          entry.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
          entry.on("end", () =>
            files.push({
              path: parts.slice(1).join("/"),
              data: Buffer.concat(chunks),
              mode: 0o644 | ((entry.mode ?? 0o644) & 0o111),
            }),
          );
        } catch (error) {
          parser.abort(error as Error);
        }
      },
    });
    const abort = () => parser.abort(new Error("Cancelled"));
    signal.addEventListener("abort", abort, { once: true });
    const cleanup = () => signal.removeEventListener("abort", abort);
    parser.on("error", (error) => {
      cleanup();
      stream?.destroy();
      reject(error);
    });
    parser.on("end", () => {
      cleanup();
      resolveDone();
    });
    // Bound the entire expanded tar stream, including metadata and padding.
    void (async () => {
      stream = Readable.from([data]).pipe(createGunzip());
      let expanded = 0;
      try {
        for await (const chunk of stream) {
          signal.throwIfAborted();
          expanded += chunk.length;
          if (
            expanded >
            INSTALL_LIMITS.unpackedBytes + INSTALL_LIMITS.files * 1024
          )
            fail("source_too_large", "Expanded archive stream exceeds limit");
          parser.write(chunk);
        }
        parser.end();
      } catch (error) {
        parser.abort(error as Error);
      } finally {
        stream.destroy();
      }
    })();
  });
  validateFiles(files);
  return files;
}
export async function acquireSource(
  args: SkillSourceArgs,
  workingDirectory: string | undefined,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<SkillSnapshot> {
  if (!/^https?:\/\//i.test(args.source)) {
    if (args.ref)
      fail("invalid_source", "ref is only supported for GitHub sources");
    if (!isAbsolute(args.source) && !workingDirectory)
      fail("working_directory_required", "Use an absolute local path");
    let root = resolve(workingDirectory ?? ".", args.source);
    if (basename(root) === "SKILL.md") root = dirname(root);
    return {
      source: root,
      files: await snapshotLocal(root, signal),
      suggestedSlug: basename(root),
    };
  }
  const url = new URL(args.source);
  if (
    url.protocol !== "https:" ||
    url.hostname !== "github.com" ||
    url.username ||
    url.password ||
    url.port ||
    url.search
  )
    fail(
      "unsupported_source",
      "Use a public https://github.com owner/repository URL",
    );
  const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
  const [owner, rawRepo, kind, ...tail] = parts;
  const repo = rawRepo?.replace(/\.git$/, "");
  if (!owner || !repo || !/^[\w.-]+$/.test(owner) || !/^[\w.-]+$/.test(repo))
    fail("invalid_source", "Expected GitHub owner/repository");
  let ref = args.ref;
  let skillPath = args.skillPath;
  if (kind) {
    if (!["tree", "blob"].includes(kind) || !tail.length)
      fail("invalid_source", "Unsupported GitHub URL");
    // Slashed refs cannot be distinguished from paths without an explicit ref.
    if (!ref)
      fail(
        "ref_required",
        "For tree/blob URLs provide ref explicitly to disambiguate branch and directory",
      );
    const suffix = tail.join("/");
    if (suffix !== ref && !suffix.startsWith(ref + "/"))
      fail("invalid_source", "URL and explicit ref disagree");
    const embedded = suffix
      .slice(ref.length)
      .replace(/^\//, "")
      .replace(/(?:^|\/)SKILL\.md$/, "");
    if (skillPath && embedded && skillPath !== embedded)
      fail("invalid_source", "URL and skillPath disagree");
    skillPath ??= embedded || undefined;
  }
  const api = `https://api.github.com/repos/${owner}/${repo}`;
  if (!ref) {
    const metadata = JSON.parse(
      (
        await boundedBody(await get(api, signal, fetcher), 1024 * 1024, signal)
      ).toString(),
    );
    ref = metadata.default_branch;
  }
  if (typeof ref !== "string" || !ref)
    fail("invalid_ref", "Could not resolve repository ref");
  const info = JSON.parse(
    (
      await boundedBody(
        await get(`${api}/commits/${encodeURIComponent(ref)}`, signal, fetcher),
        1024 * 1024,
        signal,
      )
    ).toString(),
  );
  if (typeof info.sha !== "string" || !/^[a-f0-9]{40}$/i.test(info.sha))
    fail("invalid_ref", "GitHub did not return a commit SHA");
  const archive = await boundedBody(
    await get(
      `https://codeload.github.com/${owner}/${repo}/tar.gz/${info.sha}`,
      signal,
      fetcher,
    ),
    INSTALL_LIMITS.downloadBytes,
    signal,
  );
  const files = await unpackArchive(archive, signal);
  // Return selection separately through normalized paths, without mutating caller arguments.
  return {
    source: `https://github.com/${owner}/${repo}`,
    commit: info.sha,
    suggestedSlug: skillPath ? basename(skillPath) : repo,
    skillPath,
    files: selectSubtree(files, skillPath),
  };
}
export function selectSubtree(
  files: SnapshotFile[],
  path?: string,
): SnapshotFile[] {
  if (!path || path === ".") return files;
  const prefix = safeRelative(path.replace(/\/$/, "")) + "/";
  const result = files
    .filter((f) => f.path.startsWith(prefix))
    .map((f) => ({ ...f, path: f.path.slice(prefix.length) }));
  if (!result.length)
    fail("skill_not_found", "Selected skill directory does not exist");
  return result;
}
