import {
  mkdirSync,
  renameSync,
  existsSync,
  chmodSync,
  realpathSync,
} from "node:fs";
import { writeFile } from "node:fs/promises";
import { join, dirname, posix, basename, resolve } from "node:path";
import { Lexer, type Token, type Tokens } from "marked";
import {
  acquireSource,
  selectSubtree,
  snapshotLocal,
  fingerprint,
  fail,
  safeRelative,
  SkillInstallError,
  INSTALL_LIMITS,
  type SkillSourceArgs,
  type SnapshotFile,
} from "./install-source.ts";
import {
  acquireInstallLock,
  writeRecord,
  rollbackInstall,
  assertRealDirectoryPath,
  type InstallRecord,
} from "./install-transaction.ts";
import {
  invalidateSkillsCache,
  loadSkillBySlug,
  resolveBundledSkillMdPath,
} from "./storage.ts";
import { BUNDLED_OFFICECLI_SKILL_SLUGS } from "../utils/officecli.ts";

export interface SkillInstallArgs extends SkillSourceArgs {
  replace?: boolean;
  expectedTargetFingerprint?: string;
}
export interface SkillInstallContext {
  workspacePath: string;
  workingDirectory?: string;
  signal?: AbortSignal;
  validate: (
    content: string,
    slug: string,
  ) => { valid: boolean; errors: unknown[]; warnings: unknown[] };
  refresh?: () => Promise<void> | void;
  /** Injectable transport for local protocol fixtures; never exposed as tool input. */
  fetcher?: typeof fetch;
}
export interface SkillInstallResult {
  status:
    | "ready"
    | "needs_selection"
    | "installed"
    | "already_installed"
    | "conflict"
    | "failed"
    | "cancelled";
  source?: string;
  commit?: string;
  slug?: string;
  candidates?: string[];
  skillPath?: string;
  fingerprint?: string;
  targetPath?: string;
  targetFingerprint?: string;
  validation?: {
    format: { valid: boolean; errors: unknown[]; warnings: unknown[] };
    resources: "passed";
    runtime: "not_verified";
  };
  effectivePath?: string;
  shadowed?: boolean;
  stage?: string;
  code?: string;
  message?: string;
}
function resourceCheck(files: SnapshotFile[]): void {
  const paths = new Set(files.map((f) => f.path));
  const check = (href: string, file: string) => {
    if (
      !href ||
      href.startsWith("#") ||
      /^[a-z][a-z0-9+.-]*:/i.test(href) ||
      href.startsWith("//") ||
      /\$\{|\{\{|<.*>/.test(href)
    )
      return;
    const clean = decodeURIComponent(href.split(/[?#]/)[0]!);
    if (!clean) return;
    const path = posix.normalize(posix.join(posix.dirname(file), clean));
    if (clean.startsWith("/") || path === ".." || path.startsWith("../"))
      fail("resource_outside_skill", `Resource is outside skill: ${href}`);
    if (path === ".") return;
    safeRelative(path);
    if (!paths.has(path) && ![...paths].some((p) => p.startsWith(path + "/")))
      fail("missing_resource", `Missing resource in ${file}: ${href}`);
  };
  const visit = (tokens: Token[], file: string): void => {
    for (const token of tokens) {
      if (token.type === "link" || token.type === "image")
        check((token as Tokens.Link).href, file);
      if ("tokens" in token && Array.isArray(token.tokens))
        visit(token.tokens, file);
      if (token.type === "list")
        for (const item of (token as Tokens.List).items)
          visit(item.tokens, file);
      if (token.type === "table") {
        const table = token as Tokens.Table;
        for (const cell of [...table.header, ...table.rows.flat()])
          visit(cell.tokens, file);
      }
    }
  };
  for (const file of files.filter((f) => f.path.toLowerCase().endsWith(".md")))
    visit(Lexer.lex(file.data.toString("utf8")), file.path);
}
export async function runSkillInstall(
  args: SkillInstallArgs,
  ctx: SkillInstallContext,
  install: boolean,
): Promise<SkillInstallResult> {
  const timeout = AbortSignal.timeout(INSTALL_LIMITS.timeoutMs);
  const signal = ctx.signal ? AbortSignal.any([ctx.signal, timeout]) : timeout;
  let stage = "source";
  let result: SkillInstallResult = { status: "failed" };
  let lock: ReturnType<typeof acquireInstallLock> | undefined;
  let record: InstallRecord | undefined;
  let preserve = false;
  try {
    signal.throwIfAborted();
    ctx = { ...ctx, workspacePath: realpathSync(ctx.workspacePath) };
    const snapshot = await acquireSource(
      args,
      ctx.workingDirectory,
      signal,
      ctx.fetcher,
    );
    let files = /^https?:/i.test(args.source)
      ? snapshot.files
      : selectSubtree(snapshot.files, args.skillPath);
    const candidates = files
      .filter((f) => f.path === "SKILL.md" || f.path.endsWith("/SKILL.md"))
      .map((f) => posix.dirname(f.path))
      .sort();
    result = {
      status: "ready",
      source: snapshot.source,
      commit: snapshot.commit,
    };
    if (!candidates.length) fail("skill_not_found", "No SKILL.md found");
    if (
      candidates.length > 1 &&
      !(
        (args.skillPath !== undefined || snapshot.skillPath !== undefined) &&
        files.some((file) => file.path === "SKILL.md")
      )
    )
      return {
        ...result,
        status: "needs_selection",
        candidates: candidates.map((path) =>
          posix.join(snapshot.skillPath ?? args.skillPath ?? ".", path),
        ),
        message: "Choose skillPath from these candidates",
      };
    const selected = files.some((f) => f.path === "SKILL.md")
      ? "."
      : candidates[0]!;
    files = selectSubtree(files, selected);
    const slug =
      args.slug ??
      (selected !== "."
        ? basename(selected)
        : args.skillPath && args.skillPath !== "."
          ? basename(args.skillPath)
          : snapshot.suggestedSlug);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug))
      fail("invalid_slug", "Provide a lowercase kebab-case slug");
    const target = join(ctx.workspacePath, "skills", slug);
    result = {
      ...result,
      slug,
      skillPath: posix.join(
        snapshot.skillPath ?? args.skillPath ?? ".",
        selected,
      ),
      targetPath: target,
      fingerprint: fingerprint(files),
    };
    stage = "validation";
    if (
      resolveBundledSkillMdPath(slug) ||
      (BUNDLED_OFFICECLI_SKILL_SLUGS as readonly string[]).includes(slug)
    )
      fail("protected_skill", `Cannot install over bundled skill: ${slug}`);
    const format = ctx.validate(
      files.find((f) => f.path === "SKILL.md")!.data.toString("utf8"),
      slug,
    );
    if (!format.valid) {
      result.message = JSON.stringify(format);
      fail("invalid_skill", result.message);
    }
    resourceCheck(files);
    signal.throwIfAborted();
    result.validation = {
      format,
      resources: "passed",
      runtime: "not_verified",
    };
    stage = "conflict";
    assertRealDirectoryPath(target);
    if (install) lock = acquireInstallLock(ctx.workspacePath, slug);
    const oldFiles = existsSync(target)
      ? await snapshotLocal(target, signal)
      : undefined;
    const targetFingerprint = oldFiles && fingerprint(oldFiles);
    result.targetFingerprint = targetFingerprint;
    const loaded = () => {
      invalidateSkillsCache();
      const effective = loadSkillBySlug(
        ctx.workspacePath,
        slug,
        ctx.workingDirectory,
      );
      if (!effective)
        fail("load_failed", "Installed skill could not be loaded");
      result.effectivePath = effective.path;
      result.shadowed = resolve(effective.path) !== resolve(target);
    };
    if (targetFingerprint === result.fingerprint) {
      loaded();
      if (install) await ctx.refresh?.();
      return {
        ...result,
        status: "already_installed",
        message:
          "Content already installed; runtime dependencies have not been verified",
      };
    }
    if (
      oldFiles &&
      (!args.replace || args.expectedTargetFingerprint !== targetFingerprint)
    )
      return {
        ...result,
        status: "conflict",
        code: "target_conflict",
        message:
          "Explicit update and matching expectedTargetFingerprint are required",
      };
    if (args.replace && (!args.expectedTargetFingerprint || !oldFiles))
      return {
        ...result,
        status: "conflict",
        code: "target_changed",
        message: "Replacement target no longer matches inspection",
      };
    if (!install) return result;
    stage = "staging";
    const dir = lock!.dir;
    const staged = join(dir, "new", slug);
    mkdirSync(staged, { recursive: true });
    for (const file of files) {
      signal.throwIfAborted();
      const path = join(staged, file.path);
      mkdirSync(dirname(path), { recursive: true });
      await writeFile(path, file.data, { signal });
      chmodSync(path, file.mode);
    }
    signal.throwIfAborted();
    // Renames are synchronous; post-publish verification completes or rolls back
    // with its own signal so cancellation cannot leave a half-committed replacement.
    stage = "publish";
    const beforePublish = existsSync(target)
      ? fingerprint(await snapshotLocal(target, signal))
      : undefined;
    if (beforePublish !== targetFingerprint)
      fail(
        "target_changed",
        "Target changed while staging; inspect again before replacing",
      );
    signal.throwIfAborted();
    mkdirSync(join(ctx.workspacePath, "skills"), { recursive: true });
    record = { pid: process.pid, phase: "prepared", hadTarget: !!oldFiles };
    writeRecord(dir, record);
    if (oldFiles) {
      mkdirSync(join(dir, "old"));
      renameSync(target, join(dir, "old", slug));
    }
    renameSync(staged, target);
    if (
      fingerprint(await snapshotLocal(target, new AbortController().signal)) !==
      result.fingerprint
    )
      fail(
        "publish_mismatch",
        "Published content differs from validated snapshot",
      );
    writeRecord(dir, { ...record, phase: "committed" });
    loaded();
    stage = "refresh";
    await ctx.refresh?.();
    return {
      ...result,
      status: "installed",
      message:
        "Installed and statically validated; runtime dependencies have not been verified",
    };
  } catch (error) {
    if (record && lock && result.slug) {
      try {
        writeRecord(lock.dir, record);
        rollbackInstall(ctx.workspacePath, result.slug, lock.dir, record);
        invalidateSkillsCache();
      } catch {
        preserve = true;
      }
      // A failed notification must not strand a successfully rolled-back filesystem lock.
      if (!preserve) {
        try {
          await ctx.refresh?.();
        } catch {
          /* Original refresh failure is reported below. */
        }
      }
    }
    return {
      ...result,
      status: signal.aborted && !preserve ? "cancelled" : "failed",
      stage,
      code: preserve
        ? "recovery_required"
        : signal.aborted
          ? timeout.aborted && !ctx.signal?.aborted
            ? "timeout"
            : "cancelled"
          : error instanceof SkillInstallError
            ? error.code
            : (error as NodeJS.ErrnoException).code === "EEXIST"
              ? "install_busy"
              : "install_failed",
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    if (!preserve) lock?.release();
  }
}
