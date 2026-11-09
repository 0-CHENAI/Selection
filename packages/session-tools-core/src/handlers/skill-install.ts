import type { SessionToolContext } from "../context.ts";
import type { ToolResult } from "../types.ts";
import {
  runSkillInstall,
  type SkillInstallArgs,
} from "@craft-agent/shared/skills/install";
import { validateSkillContent } from "../validation.ts";
import { resolveSessionWorkingDirectory } from "../source-helpers.ts";

async function run(
  ctx: SessionToolContext,
  args: SkillInstallArgs,
  install: boolean,
): Promise<ToolResult> {
  if (install && ctx.permissionMode === "safe")
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "skill_install is blocked in Explore/Safe mode.",
        },
      ],
    };
  const result = await runSkillInstall(
    args,
    {
      workspacePath: ctx.workspacePath,
      workingDirectory:
        ctx.workingDirectory ??
        resolveSessionWorkingDirectory(ctx.workspacePath, ctx.sessionId),
      signal: ctx.signal,
      validate: validateSkillContent,
      refresh: ctx.refreshSkills,
    },
    install,
  );
  return {
    isError: ["failed", "cancelled", "conflict"].includes(result.status),
    content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
  };
}
export const handleSkillInspect = (
  ctx: SessionToolContext,
  args: SkillInstallArgs,
): Promise<ToolResult> => run(ctx, args, false);
export const handleSkillInstall = (
  ctx: SessionToolContext,
  args: SkillInstallArgs,
): Promise<ToolResult> => run(ctx, args, true);
