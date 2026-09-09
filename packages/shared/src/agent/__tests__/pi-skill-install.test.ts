import { afterEach, describe, expect, test } from "bun:test";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PiEventAdapter } from "../backend/pi/event-adapter.ts";
import { PiAgent } from "../pi-agent.ts";
import type { BackendConfig } from "../backend/types.ts";
import { SESSION_TOOL_REGISTRY } from "@craft-agent/session-tools-core";
const roots: string[] = [];
const agents: PiAgent[] = [];
afterEach(() => {
  agents.splice(0).forEach((a) => a.destroy());
  roots.splice(0).forEach((p) => rmSync(p, { recursive: true, force: true }));
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pi-skill310-"));
  roots.push(root);
  const source = join(root, "input");
  mkdirSync(source);
  writeFileSync(
    join(source, "SKILL.md"),
    "---\nname: X\ndescription: X\n---\nTest",
  );
  const agent = new PiAgent({
    provider: "pi",
    workspace: { id: "310", name: "Test", rootPath: root },
    session: {
      id: "s310",
      workspaceRootPath: root,
      createdAt: Date.now(),
      lastUsedAt: Date.now(),
    },
    isHeadless: true,
    skipConfigWatcher: true,
  } as BackendConfig);
  agents.push(agent);
  agent.setPermissionMode("allow-all");
  return { root, source, agent };
}
describe("Pi skill installation tool contract", () => {
  test("actual proxy handler returns only after installation and catalog notification", async () => {
    const { root, source, agent } = fixture();
    let slugs: string[] = [];
    agent.onSkillsListChange = (skills) => {
      slugs = skills.map((s) => s.slug);
    };
    const result = await (agent as any).executeSessionTool("skill_install", {
      source,
      slug: "demo",
    });
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content[0].text).status).toBe("installed");
    expect(existsSync(join(root, "skills/demo/SKILL.md"))).toBe(true);
    expect(slugs).toContain("demo");
    const adapter = new PiEventAdapter();
    adapter.startTurn();
    expect(
      [...adapter.adaptEvent({ type: "agent_end", messages: [] } as any)].some(
        (e) => e.type === "complete",
      ),
    ).toBe(true);
    expect(existsSync(join(root, "skills/demo/SKILL.md"))).toBe(true);
    // No pending install remains for a later complete/user continuation to finish.
    expect((agent as any).sessionToolControllers.size).toBe(0);
  });
  test("Explore blocks install but permits inspection", async () => {
    const { root, source, agent } = fixture();
    agent.setPermissionMode("safe");
    expect(
      (await (agent as any).executeSessionTool("skill_install", { source }))
        .isError,
    ).toBe(true);
    expect(existsSync(join(root, "skills/input"))).toBe(false);
    expect(
      (await (agent as any).executeSessionTool("skill_inspect", { source }))
        .isError,
    ).toBe(false);
    expect(SESSION_TOOL_REGISTRY.get("skill_install")?.readOnly).toBe(false);
    expect(SESSION_TOOL_REGISTRY.get("skill_inspect")?.safeMode).toBe("allow");
  });
  test("abort reaches in-flight host tool signal", async () => {
    const { agent } = fixture();
    const def = SESSION_TOOL_REGISTRY.get("skill_install")!;
    const old = def.handler;
    let started!: () => void;
    const ready = new Promise<void>((r) => {
      started = r;
    });
    def.handler = async (ctx) => {
      started();
      await new Promise<void>((r) =>
        ctx.signal!.addEventListener("abort", () => r(), { once: true }),
      );
      return { isError: true, content: [{ type: "text", text: "cancelled" }] };
    };
    try {
      const pending = (agent as any).executeSessionTool("skill_install", {
        source: "/unused",
      });
      await ready;
      await agent.abort();
      expect((await pending).isError).toBe(true);
      expect((agent as any).sessionToolControllers.size).toBe(0);
    } finally {
      def.handler = old;
    }
  });
});
