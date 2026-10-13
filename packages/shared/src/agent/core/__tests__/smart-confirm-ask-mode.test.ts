/**
 * End-to-end ask-mode ("Smart Confirm") decisions through the real
 * shouldPromptInAskMode: real bundled permissions config, real
 * PermissionManager approvals, real temp folders.
 */
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { permissionsConfigCache, type PermissionsContext } from '../../permissions-config.ts';
import { PermissionManager } from '../permission-manager.ts';
import { shouldPromptInAskMode, type SmartConfirmContext } from '../pre-tool-use.ts';
import { realPathForWrite } from '../smart-confirm.ts';

const BUNDLED_DEFAULT_PERMISSIONS = join(
  import.meta.dir, '../../../../../../apps/electron/resources/permissions/default.json',
);

let root: string;
let project: string;
let outside: string;
let configDir: string;
let previousConfigDir: string | undefined;
let pm: PermissionManager;
let ctx: PermissionsContext;
let smart: SmartConfirmContext;

const ask = (toolName: string, input: Record<string, unknown>) =>
  shouldPromptInAskMode(toolName, input, pm, ctx, undefined, undefined, smart);

beforeAll(() => {
  root = realPathForWrite(mkdtempSync(join(tmpdir(), 'smart-confirm-e2e-')));
  project = join(root, 'project');
  outside = join(root, 'outside');
  configDir = join(root, 'config');
  mkdirSync(project, { recursive: true });
  mkdirSync(outside, { recursive: true });
  mkdirSync(join(configDir, 'permissions'), { recursive: true });
  writeFileSync(join(configDir, 'permissions', 'default.json'), readFileSync(BUNDLED_DEFAULT_PERMISSIONS));
  previousConfigDir = process.env.CRAFT_CONFIG_DIR;
  process.env.CRAFT_CONFIG_DIR = configDir;
  permissionsConfigCache.clear();

  pm = new PermissionManager({ workspaceId: 'ws-smart-confirm', sessionId: 'smart-confirm-e2e', workingDirectory: project });
  ctx = { workspaceRootPath: project, activeSourceSlugs: [] };
  smart = { workingDirectory: project, sessionFolder: join(root, 'sessions', 's1') };
});

afterAll(() => {
  if (previousConfigDir === undefined) delete process.env.CRAFT_CONFIG_DIR;
  else process.env.CRAFT_CONFIG_DIR = previousConfigDir;
  permissionsConfigCache.clear();
  rmSync(root, { recursive: true, force: true });
});

describe('Smart Confirm (ask mode) end to end', () => {
  it('runs project edits and routine commands without prompting', () => {
    expect(ask('Write', { file_path: join(project, 'src', 'a.ts'), content: 'x' })).toBeNull();
    expect(ask('Edit', { file_path: join(project, 'README.md') })).toBeNull();
    expect(ask('Bash', { command: 'git status' })).toBeNull();
    expect(ask('Bash', { command: 'npm test' })).toBeNull();
    expect(ask('Bash', { command: 'git add . && git commit -m "wip"' })).toBeNull();
  });

  it('asks before writing outside the project, then honours "Always allow" for that directory', () => {
    const target = join(outside, 'notes.md');
    const prompt = ask('Write', { file_path: target });
    expect(prompt?.promptType).toBe('file_write');
    expect(prompt?.description).toContain('outside the working directory');
    expect(prompt?.rememberKey).toBeTruthy();

    pm.rememberApproval(prompt!.rememberKey!);
    expect(ask('Write', { file_path: target })).toBeNull();
    expect(ask('Write', { file_path: join(root, 'elsewhere.md') })).not.toBeNull();
  });

  it('asks for sensitive files inside the project', () => {
    expect(ask('Write', { file_path: join(project, '.env') })?.description).toContain('sensitive file');
  });

  it('asks for destructive commands and remembers only the exact command', () => {
    const prompt = ask('Bash', { command: 'rm -rf build' });
    expect(prompt?.promptType).toBe('bash');
    expect(prompt?.rememberKey).toBe('bash:rm -rf build');

    pm.rememberApproval(prompt!.rememberKey!);
    expect(ask('Bash', { command: 'rm -rf build' })).toBeNull();
    expect(ask('Bash', { command: 'rm -rf Build' })).not.toBeNull();
    expect(ask('Bash', { command: 'rm -rf src' })).not.toBeNull();
  });

  it('keeps asking for external side effects even inside the project', () => {
    expect(ask('Bash', { command: 'git push origin main' })).not.toBeNull();
    expect(ask('Bash', { command: 'npm install left-pad' })).not.toBeNull();
    expect(ask('mcp__linear__create_issue', { title: 'Bug' })?.promptType).toBe('mcp_mutation');
  });

  it('without a working directory, only the session folder is trusted', () => {
    const sessionOnly: SmartConfirmContext = { sessionFolder: join(root, 'sessions', 's1') };
    const askSessionOnly = (toolName: string, input: Record<string, unknown>) =>
      shouldPromptInAskMode(toolName, input, pm, ctx, undefined, undefined, sessionOnly);
    expect(askSessionOnly('Write', { file_path: join(root, 'sessions', 's1', 'plans', 'p.md') })).toBeNull();
    expect(askSessionOnly('Write', { file_path: join(project, 'a.ts') })).not.toBeNull();
    expect(askSessionOnly('Bash', { command: 'npm test' })).not.toBeNull();
  });
});
