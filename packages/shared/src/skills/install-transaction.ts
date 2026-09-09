/** Filesystem transaction/lock shared by installer and skill readers. No model continuation. */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
  lstatSync,
  openSync,
  fsyncSync,
  closeSync,
  realpathSync,
} from "node:fs";
import { join, resolve, parse } from "node:path";
import { randomUUID } from "node:crypto";

export interface InstallRecord {
  pid: number;
  phase: "staging" | "prepared" | "committed";
  hadTarget: boolean;
}
const validSlug = (slug: string) => /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
export const installRoot = (workspace: string) =>
  join(
    existsSync(workspace) ? realpathSync(workspace) : resolve(workspace),
    ".skill-install",
  );
export function assertRealDirectoryPath(path: string): void {
  const absolute = resolve(path);
  let current = parse(absolute).root;
  for (const part of absolute
    .slice(current.length)
    .split(/[\\/]/)
    .filter(Boolean)) {
    current = join(current, part);
    if (existsSync(current)) {
      const stat = lstatSync(current);
      if (stat.isSymbolicLink() || !stat.isDirectory())
        throw new Error(
          `Installation directory is not a real directory: ${current}`,
        );
    }
  }
}
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}
export function readRecord(dir: string): InstallRecord | undefined {
  try {
    const value = JSON.parse(readFileSync(join(dir, "record.json"), "utf8"));
    if (
      Number.isInteger(value.pid) &&
      value.pid > 0 &&
      ["staging", "prepared", "committed"].includes(value.phase) &&
      typeof value.hadTarget === "boolean"
    )
      return value;
  } catch {
    /* Incomplete creation is left alone until the stale grace period. */
  }
}
export function writeRecord(dir: string, record: InstallRecord): void {
  const file = join(dir, "record.tmp");
  // Windows requires a writable handle for FlushFileBuffers (fsync).
  const fd = openSync(file, "w");
  try {
    writeFileSync(fd, JSON.stringify(record));
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  renameSync(file, join(dir, "record.json"));
}
export function rollbackInstall(
  workspace: string,
  slug: string,
  dir: string,
  record: InstallRecord,
): void {
  const target = join(workspace, "skills", slug);
  const backup = join(dir, "old", slug);
  if (existsSync(backup)) {
    rmSync(target, { recursive: true, force: true });
    renameSync(backup, target);
  } else if (
    !record.hadTarget &&
    record.phase === "prepared" &&
    !existsSync(join(dir, "new", slug))
  )
    rmSync(target, { recursive: true, force: true });
}
function transactionName(
  name: string,
): { slug: string; recoveryPid?: number } | undefined {
  if (validSlug(name)) return { slug: name };
  const match =
    /^\.recovery-(\d+)-([a-z0-9]+(?:-[a-z0-9]+)*)-([a-f0-9]{8}-[a-f0-9-]{27})$/.exec(
      name,
    );
  return match ? { slug: match[2]!, recoveryPid: Number(match[1]) } : undefined;
}
function recoveryDirectory(
  workspace: string,
  slug: string,
): string | undefined {
  const root = installRoot(workspace);
  if (!existsSync(root)) return undefined;
  const entry = readdirSync(root).find((name) => {
    const parsed = transactionName(name);
    return parsed?.recoveryPid !== undefined && parsed.slug === slug;
  });
  return entry ? join(root, entry) : undefined;
}
export function recoverSkillInstalls(workspace: string): void {
  const root = installRoot(workspace);
  if (!existsSync(root)) return;
  assertRealDirectoryPath(root);
  assertRealDirectoryPath(join(realpathSync(workspace), "skills"));
  for (const name of readdirSync(root)) {
    const parsed = transactionName(name);
    if (
      !parsed ||
      (parsed.recoveryPid !== undefined && alive(parsed.recoveryPid))
    )
      continue;
    const { slug } = parsed;
    const dir = join(root, name);
    if (!existsSync(dir)) continue;
    assertRealDirectoryPath(dir);
    const record = readRecord(dir);
    if (
      record
        ? parsed.recoveryPid === undefined && alive(record.pid)
        : Date.now() - lstatSync(dir).mtimeMs < 60_000
    )
      continue;
    if (!record && existsSync(join(dir, "old")))
      throw new Error(
        "Installation recovery record is unreadable; preserving backup",
      );
    // Rename claims this dead transaction so concurrent readers cannot recover it twice.
    const claimed = join(
      root,
      `.recovery-${process.pid}-${slug}-${randomUUID()}`,
    );
    try {
      renameSync(dir, claimed);
    } catch {
      continue;
    }
    try {
      if (record && record.phase !== "committed")
        rollbackInstall(workspace, slug, claimed, record);
      rmSync(claimed, { recursive: true, force: true });
    } catch (error) {
      renameSync(claimed, dir);
      throw error;
    }
  }
}
export function acquireInstallLock(
  workspace: string,
  slug: string,
): { dir: string; release: () => void } {
  recoverSkillInstalls(workspace);
  const root = installRoot(workspace);
  assertRealDirectoryPath(root);
  assertRealDirectoryPath(join(realpathSync(workspace), "skills"));
  mkdirSync(root, { recursive: true });
  const dir = join(root, slug);
  mkdirSync(dir); // EEXIST means busy; never steal an active operation.
  try {
    // Check after mkdir: a dead transaction may have moved into recovery concurrently.
    if (recoveryDirectory(workspace, slug)) {
      throw Object.assign(new Error("Skill recovery is in progress"), {
        code: "EEXIST",
      });
    }
    writeRecord(dir, {
      pid: process.pid,
      phase: "staging",
      hadTarget: existsSync(join(workspace, "skills", slug)),
    });
  } catch (error) {
    // We own this newly created directory; no publish or backup has started yet.
    rmSync(dir, { recursive: true, force: true });
    throw error;
  }
  return { dir, release: () => rmSync(dir, { recursive: true, force: true }) };
}
/** Stable old view while a replacement is prepared; never expose a new half-install. */
export function skillReadDirectory(
  workspace: string,
  slug: string,
): string | undefined {
  const dir =
    recoveryDirectory(workspace, slug) ?? join(installRoot(workspace), slug);
  const record = readRecord(dir);
  if (!record || record.phase !== "prepared") return join(workspace, "skills");
  if (!record.hadTarget) return undefined;
  return existsSync(join(dir, "old", slug))
    ? join(dir, "old")
    : join(workspace, "skills");
}
export function pendingSkillSlugs(workspace: string): string[] {
  const root = installRoot(workspace);
  return existsSync(root)
    ? readdirSync(root).flatMap((name) => {
        const item = transactionName(name);
        return item ? [item.slug] : [];
      })
    : [];
}
