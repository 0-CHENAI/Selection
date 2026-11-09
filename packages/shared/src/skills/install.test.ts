import * as fs from "node:fs";
import { afterEach, describe, expect, test, spyOn } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  symlinkSync,
  renameSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSkillInstall } from "./install.ts";
import {
  acquireSource,
  fingerprint,
  snapshotLocal,
  safeRelative,
} from "./install-source.ts";
import {
  acquireInstallLock,
  writeRecord,
  recoverSkillInstalls,
} from "./install-transaction.ts";
import { loadWorkspaceSkills, invalidateSkillsCache } from "./storage.ts";
import { validateSkillContent } from "../../../session-tools-core/src/validation.ts";

const roots: string[] = [];
afterEach(() => {
  for (const p of roots.splice(0)) rmSync(p, { recursive: true, force: true });
  invalidateSkillsCache();
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "skill310-"));
  roots.push(root);
  const workspacePath = join(root, "工作区");
  const source = join(root, "sample");
  mkdirSync(workspacePath);
  mkdirSync(source);
  writeFileSync(
    join(source, "SKILL.md"),
    "---\nname: Sample\ndescription: Test skill\n---\nUse this skill.\n",
  );
  return {
    root,
    source,
    workspacePath,
    ctx: { workspacePath, validate: validateSkillContent },
  };
}
describe("skill installation contract", () => {
  test("failed transaction initialization releases its lock for retry", () => {
    const f = fixture();
    const sync = spyOn(fs, "fsyncSync").mockImplementationOnce(() => {
      throw Object.assign(new Error("injected sync failure"), { code: "EPERM" });
    });
    try {
      expect(() => acquireInstallLock(f.workspacePath, "sample")).toThrow("injected sync failure");
      expect(existsSync(join(f.workspacePath, ".skill-install", "sample"))).toBe(false);
    } finally {
      sync.mockRestore();
    }
    const lock = acquireInstallLock(f.workspacePath, "sample");
    try {
      writeRecord(lock.dir, { pid: process.pid, phase: "prepared", hadTarget: false });
      expect(JSON.parse(readFileSync(join(lock.dir, "record.json"), "utf8")).phase).toBe("prepared");
      expect(() => acquireInstallLock(f.workspacePath, "sample")).toThrow();
      expect(existsSync(lock.dir)).toBe(true);
    } finally {
      lock.release();
    }
  });

  test("one invocation validates and loads; identical install is idempotent", async () => {
    const f = fixture();
    let refresh = 0;
    const result = await runSkillInstall(
      { source: f.source },
      {
        ...f.ctx,
        refresh: () => {
          refresh++;
        },
      },
      true,
    );
    expect(result.status, JSON.stringify(result)).toBe("installed");
    expect(result.validation?.runtime).toBe("not_verified");
    expect(loadWorkspaceSkills(f.workspacePath).map((s) => s.slug)).toEqual([
      "sample",
    ]);
    expect(refresh).toBe(1);
    expect(
      (await runSkillInstall({ source: f.source }, f.ctx, true)).status,
    ).toBe("already_installed");
  });
  test("inspect never publishes; explicit update requires current fingerprint", async () => {
    const f = fixture();
    expect(
      (await runSkillInstall({ source: f.source }, f.ctx, false)).status,
    ).toBe("ready");
    expect(existsSync(join(f.workspacePath, "skills"))).toBe(false);
    const first = await runSkillInstall({ source: f.source }, f.ctx, true);
    writeFileSync(join(f.source, "extra.txt"), "new");
    const conflict = await runSkillInstall({ source: f.source }, f.ctx, true);
    expect(conflict.status).toBe("conflict");
    expect(
      (
        await runSkillInstall(
          {
            source: f.source,
            replace: true,
            expectedTargetFingerprint: "a".repeat(64),
          },
          f.ctx,
          true,
        )
      ).status,
    ).toBe("conflict");
    const update = await runSkillInstall(
      {
        source: f.source,
        replace: true,
        expectedTargetFingerprint: first.fingerprint,
      },
      f.ctx,
      true,
    );
    expect(update.status).toBe("installed");
    expect(
      readFileSync(join(f.workspacePath, "skills/sample/extra.txt"), "utf8"),
    ).toBe("new");
  });
  test("refresh failure rolls back old content", async () => {
    const f = fixture();
    const first = await runSkillInstall({ source: f.source }, f.ctx, true);
    writeFileSync(join(f.source, "extra.txt"), "new");
    const update = await runSkillInstall(
      {
        source: f.source,
        replace: true,
        expectedTargetFingerprint: first.fingerprint,
      },
      {
        ...f.ctx,
        refresh: () => {
          throw new Error("refresh failed");
        },
      },
      true,
    );
    expect(update.status).toBe("failed");
    expect(existsSync(join(f.workspacePath, "skills/sample/extra.txt"))).toBe(
      false,
    );
    expect(
      fingerprint(
        await snapshotLocal(
          join(f.workspacePath, "skills/sample"),
          new AbortController().signal,
        ),
      ),
    ).toBe(first.fingerprint!);
  });
  test("format and resource failures cannot publish; fenced examples ignored", async () => {
    const f = fixture();
    writeFileSync(join(f.source, "SKILL.md"), "bad");
    expect(
      (await runSkillInstall({ source: f.source }, f.ctx, true)).code,
    ).toBe("invalid_skill");
    writeFileSync(
      join(f.source, "SKILL.md"),
      "---\nname: X\ndescription: X\n---\n[missing](missing.md)",
    );
    expect(
      (await runSkillInstall({ source: f.source }, f.ctx, true)).code,
    ).toBe("missing_resource");
    writeFileSync(
      join(f.source, "SKILL.md"),
      "---\nname: X\ndescription: X\n---\n```md\n[example](missing.md)\n```",
    );
    expect(
      (await runSkillInstall({ source: f.source }, f.ctx, true)).status,
    ).toBe("installed");
  });
  test("multi-skill selection and local relative source", async () => {
    const f = fixture();
    mkdirSync(join(f.source, "nested"));
    writeFileSync(
      join(f.source, "nested/SKILL.md"),
      readFileSync(join(f.source, "SKILL.md")),
    );
    expect(
      (await runSkillInstall({ source: f.source }, f.ctx, true)).status,
    ).toBe("needs_selection");
    expect(
      (
        await runSkillInstall(
          { source: "sample", skillPath: "nested" },
          { ...f.ctx, workingDirectory: f.root },
          true,
        )
      ).slug,
    ).toBe("nested");
  });
  test("project shadowing reported without validating project content", async () => {
    const f = fixture();
    const project = join(f.root, "project");
    mkdirSync(join(project, ".agents/skills/sample"), { recursive: true });
    writeFileSync(
      join(project, ".agents/skills/sample/SKILL.md"),
      "---\nname: Old\ndescription: Project\n---\nOld",
    );
    const result = await runSkillInstall(
      { source: f.source },
      { ...f.ctx, workingDirectory: project },
      true,
    );
    expect(result.status, JSON.stringify(result)).toBe("installed");
    expect(result.shadowed).toBe(true);
    expect(result.effectivePath).toContain(join(".agents", "skills", "sample"));
  });
  test("cancelled invocation and active lock cannot publish", async () => {
    const f = fixture();
    const controller = new AbortController();
    controller.abort();
    expect(
      (
        await runSkillInstall(
          { source: f.source },
          { ...f.ctx, signal: controller.signal },
          true,
        )
      ).status,
    ).toBe("cancelled");
    const lock = acquireInstallLock(f.workspacePath, "sample");
    expect(
      (await runSkillInstall({ source: f.source }, f.ctx, true)).code,
    ).toBe("install_busy");
    lock.release();
  });
  test.skipIf(process.platform === "win32")(
    "rejects symlink and portable path collisions",
    async () => {
      const f = fixture();
      symlinkSync(join(f.source, "SKILL.md"), join(f.source, "link"));
      expect(
        (await runSkillInstall({ source: f.source }, f.ctx, true)).code,
      ).toBe("unsupported_symlink");
      for (const p of ["../bad", "/bad", "a\\b", "CON.txt", "trail.", "C:foo"])
        expect(() => safeRelative(p)).toThrow();
    },
  );
  test("prepared readers see old skill; dead transaction rolls back", async () => {
    const f = fixture();
    await runSkillInstall({ source: f.source }, f.ctx, true);
    const lock = acquireInstallLock(f.workspacePath, "sample");
    writeRecord(lock.dir, {
      pid: process.pid,
      phase: "prepared",
      hadTarget: true,
    });
    mkdirSync(join(lock.dir, "old"));
    renameSync(
      join(f.workspacePath, "skills/sample"),
      join(lock.dir, "old/sample"),
    );
    expect(loadWorkspaceSkills(f.workspacePath)[0]?.metadata.name).toBe(
      "Sample",
    );
    writeRecord(lock.dir, {
      pid: 2147483647,
      phase: "prepared",
      hadTarget: true,
    });
    recoverSkillInstalls(f.workspacePath);
    expect(existsSync(join(f.workspacePath, "skills/sample/SKILL.md"))).toBe(
      true,
    );
    expect(existsSync(lock.dir)).toBe(false);
  });
  test("GitHub error classes and ambiguous URL do not pretend skill missing", async () => {
    const signal = new AbortController().signal;
    for (const [status, code] of [
      [403, "access_denied"],
      [429, "rate_limited"],
      [404, "source_not_found"],
    ] as const) {
      const fetcher = (async () =>
        new Response("", { status })) as unknown as typeof fetch;
      await expect(
        acquireSource(
          { source: "https://github.com/a/b" },
          undefined,
          signal,
          fetcher,
        ),
      ).rejects.toMatchObject({ code });
    }
    await expect(
      acquireSource(
        { source: "https://github.com/a/b/tree/feature/x/path" },
        undefined,
        signal,
      ),
    ).rejects.toMatchObject({ code: "ref_required" });
  });
});

test("recovery interrupted by another crash remains discoverable; committed content survives", async () => {
  const f = fixture();
  await runSkillInstall({ source: f.source }, f.ctx, true);
  const lock = acquireInstallLock(f.workspacePath, "sample");
  writeRecord(lock.dir, {
    pid: 2147483647,
    phase: "prepared",
    hadTarget: true,
  });
  mkdirSync(join(lock.dir, "old"));
  renameSync(
    join(f.workspacePath, "skills/sample"),
    join(lock.dir, "old/sample"),
  );
  const claimed = join(
    f.workspacePath,
    ".skill-install",
    ".recovery-2147483647-sample-12345678-1234-1234-1234-123456789012",
  );
  renameSync(lock.dir, claimed);
  recoverSkillInstalls(f.workspacePath);
  expect(existsSync(join(f.workspacePath, "skills/sample/SKILL.md"))).toBe(
    true,
  );
  expect(existsSync(claimed)).toBe(false);
  const committed = acquireInstallLock(f.workspacePath, "sample");
  writeRecord(committed.dir, {
    pid: 2147483647,
    phase: "committed",
    hadTarget: false,
  });
  recoverSkillInstalls(f.workspacePath);
  expect(existsSync(join(f.workspacePath, "skills/sample/SKILL.md"))).toBe(
    true,
  );
});
test("portable collisions, outside resources and protected names are rejected", async () => {
  const f = fixture();
  for (const path of ["../x", "/x", "C:foo", "COM1", "trailing.", "a\\b"])
    expect(() => safeRelative(path)).toThrow();
  writeFileSync(
    join(f.source, "SKILL.md"),
    "---\nname: X\ndescription: X\n---\n[escape](../outside.txt)",
  );
  expect((await runSkillInstall({ source: f.source }, f.ctx, true)).code).toBe(
    "resource_outside_skill",
  );
  expect(
    (
      await runSkillInstall(
        { source: f.source, slug: "officecli-docx" },
        f.ctx,
        true,
      )
    ).code,
  ).toBe("protected_skill");
});
test("concurrent same-slug installs cannot both replace; no scripts are executed", async () => {
  const f = fixture();
  writeFileSync(join(f.source, "install.sh"), "exit 99");
  const results = await Promise.all([
    runSkillInstall({ source: f.source }, f.ctx, true),
    runSkillInstall({ source: f.source }, f.ctx, true),
  ]);
  expect(results.filter((r) => r.status === "installed")).toHaveLength(1);
  expect(
    results.every(
      (r) =>
        ["installed", "already_installed"].includes(r.status) ||
        r.code === "install_busy",
    ),
  ).toBe(true);
  expect(existsSync(join(f.workspacePath, "skills/sample/install.sh"))).toBe(
    true,
  );
});
