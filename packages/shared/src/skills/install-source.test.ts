import { afterEach, expect, test } from "bun:test";
import { create as createTar } from "tar";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
  chmodSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  acquireSource,
  unpackArchive,
  INSTALL_LIMITS,
} from "./install-source.ts";
const roots: string[] = [];
afterEach(() =>
  roots.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true })),
);
async function archive() {
  const root = mkdtempSync(join(tmpdir(), "skill-archive-"));
  roots.push(root);
  mkdirSync(join(root, "repo/skills/demo"), { recursive: true });
  writeFileSync(
    join(root, "repo/skills/demo/SKILL.md"),
    "---\nname: Demo\ndescription: Demo\n---\nText",
  );
  writeFileSync(join(root, "repo/skills/demo/run.sh"), "echo example");
  chmodSync(join(root, "repo/skills/demo/run.sh"), 0o755);
  const file = join(root, "repo.tgz");
  await createTar({ gzip: true, file, cwd: root }, ["repo"]);
  return readFileSync(file);
}
test("real HTTP fixture resolves commit and downloads archive without GitHub HTML", async () => {
  const data = await archive();
  const urls: string[] = [];
  const sha = "a".repeat(40);
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const url = new URL(request.url);
      urls.push(url.pathname);
      if (url.pathname.endsWith(`/tar.gz/${sha}`)) return new Response(data);
      return Response.json(
        url.pathname.includes("/commits/")
          ? { sha }
          : { default_branch: "main" },
      );
    },
  });
  try {
    const fetcher = ((input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.href
            : input.url,
      );
      return fetch(`http://127.0.0.1:${server.port}${url.pathname}`, init);
    }) as typeof fetch;
    const result = await acquireSource(
      { source: "https://github.com/a/repo", skillPath: "skills/demo" },
      undefined,
      new AbortController().signal,
      fetcher,
    );
    expect(result.commit).toBe(sha);
    expect(result.files.map((f) => f.path).sort()).toEqual([
      "SKILL.md",
      "run.sh",
    ]);
    expect(result.files.find((f) => f.path === "run.sh")!.mode & 0o111).toBe(
      process.platform === "win32" ? 0 : 0o111,
    );
    expect(urls).toEqual([
      "/repos/a/repo",
      "/repos/a/repo/commits/main",
      `/a/repo/tar.gz/${sha}`,
    ]);
    const nested = await acquireSource(
      {
        source: "https://github.com/a/repo/tree/feature/x/skills/demo",
        ref: "feature/x",
      },
      undefined,
      new AbortController().signal,
      fetcher,
    );
    expect(nested.files.some((f) => f.path === "SKILL.md")).toBe(true);
  } finally {
    server.stop(true);
  }
});
test("archive entry limits and malformed data reject rather than partial success", async () => {
  const data = await archive();
  const prior = INSTALL_LIMITS.files;
  try {
    INSTALL_LIMITS.files = 1;
    await expect(
      unpackArchive(data, new AbortController().signal),
    ).rejects.toThrow();
  } finally {
    INSTALL_LIMITS.files = prior;
  }
  await expect(
    unpackArchive(
      Buffer.from("not a tar archive"),
      new AbortController().signal,
    ),
  ).rejects.toThrow();
});

test("bounded download and HTTP cancellation do not continue extracting", async () => {
  const data = await archive();
  const prior = INSTALL_LIMITS.downloadBytes;
  const sha = "a".repeat(40);
  const fetcher = (async (url: string) =>
    url.includes("tar.gz")
      ? new Response(data)
      : Response.json({
          sha,
          default_branch: "main",
        })) as unknown as typeof fetch;
  try {
    INSTALL_LIMITS.downloadBytes = 1;
    await expect(
      acquireSource(
        { source: "https://github.com/a/b" },
        undefined,
        new AbortController().signal,
        fetcher,
      ),
    ).rejects.toMatchObject({ code: "source_too_large" });
  } finally {
    INSTALL_LIMITS.downloadBytes = prior;
  }
  const controller = new AbortController();
  const server = Bun.serve({
    port: 0,
    fetch: () =>
      new Response(
        new ReadableStream({
          start(c) {
            c.enqueue(new TextEncoder().encode("{"));
          },
        }),
      ),
  });
  const timer = setTimeout(() => controller.abort(), 20);
  try {
    const localFetch = ((_: unknown, init?: RequestInit) =>
      fetch(`http://127.0.0.1:${server.port}/`, init)) as typeof fetch;
    await expect(
      acquireSource(
        { source: "https://github.com/a/b" },
        undefined,
        controller.signal,
        localFetch,
      ),
    ).rejects.toThrow();
  } finally {
    clearTimeout(timer);
    server.stop(true);
  }
});
