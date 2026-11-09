import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { extractSimpleCommandsStrict } from '../../bash-validator.ts';
import {
  classifyFileWrite,
  isAutoApprovableBashCommand,
  isSensitivePath,
  isTrustedWorkingDirectory,
  realPathForWrite,
  rememberKeys,
  resolveTrustedZones,
  type TrustedZones,
} from '../smart-confirm.ts';

let root: string;
let project: string;
let sessionFolder: string;
let outside: string;
let zones: TrustedZones;

const READ_ONLY = [/^cd\b/, /^ls\b/, /^git\s+status\b/, /^cat\b/].map(regex => ({ regex, source: regex.source }));
const never = () => false;

beforeAll(() => {
  root = realPathForWrite(mkdtempSync(join(tmpdir(), 'smart-confirm-')));
  project = join(root, 'project');
  sessionFolder = join(root, 'workspace', 'sessions', 's1');
  outside = join(root, 'outside');
  for (const dir of [project, join(project, 'src'), sessionFolder, outside]) mkdirSync(dir, { recursive: true });
  symlinkSync(outside, join(project, 'escape'));
  zones = resolveTrustedZones(project, sessionFolder);
});

afterAll(() => {
  rmSync(root, { recursive: true, force: true });
});

describe('isTrustedWorkingDirectory', () => {
  it('trusts a real project folder', () => {
    expect(isTrustedWorkingDirectory(project)).toBe(true);
  });

  it('does not trust root, home, or an ancestor of home', () => {
    expect(isTrustedWorkingDirectory('/')).toBe(false);
    expect(isTrustedWorkingDirectory(homedir())).toBe(false);
    expect(isTrustedWorkingDirectory(dirname(homedir()))).toBe(false);
    expect(isTrustedWorkingDirectory(undefined)).toBe(false);
  });
});

describe('isSensitivePath', () => {
  it.each([
    '/p/.env', '/p/.env.local', '/p/.git/config', '/home/u/.ssh/config',
    '/home/u/.aws/credentials', '/p/certs/server.pem', '/p/id_ed25519', '/p/.npmrc',
  ])('%s is sensitive', path => {
    expect(isSensitivePath(path)).toBe(true);
  });

  it.each(['/p/.env.example', '/p/.gitignore', '/p/src/env.ts', '/p/README.md'])('%s is not sensitive', path => {
    expect(isSensitivePath(path)).toBe(false);
  });
});

describe('classifyFileWrite', () => {
  it('auto-allows writes inside the working directory, including new subfolders', () => {
    expect(classifyFileWrite(join(project, 'src/a.ts'), zones, project, never)).toEqual({ autoAllow: true });
    expect(classifyFileWrite(join(project, 'new/dir/b.ts'), zones, project, never)).toEqual({ autoAllow: true });
  });

  it('resolves relative paths against the working directory', () => {
    expect(classifyFileWrite('src/a.ts', zones, project, never)).toEqual({ autoAllow: true });
    const escaped = classifyFileWrite('../outside/x.txt', zones, project, never);
    expect(escaped.autoAllow).toBe(false);
  });

  it('asks for a relative path when there is no base directory', () => {
    const decision = classifyFileWrite('a.ts', zones, undefined, never);
    expect(decision).toMatchObject({ autoAllow: false, reason: 'unknown_path' });
  });

  it('auto-allows the session folder even without a working directory', () => {
    const sessionOnly = resolveTrustedZones(undefined, sessionFolder);
    expect(classifyFileWrite(join(sessionFolder, 'plans/plan.md'), sessionOnly, undefined, never)).toEqual({ autoAllow: true });
    expect(classifyFileWrite(join(project, 'a.ts'), sessionOnly, undefined, never).autoAllow).toBe(false);
  });

  it('asks for writes outside the zones and remembers approval per directory', () => {
    const target = join(outside, 'notes', 'a.txt');
    const decision = classifyFileWrite(target, zones, project, never);
    expect(decision).toMatchObject({
      autoAllow: false,
      reason: 'outside_zone',
      rememberKey: rememberKeys.writeDir(join(outside, 'notes')),
    });

    const remembered = new Set([rememberKeys.writeDir(join(outside, 'notes'))]);
    const has = (key: string) => remembered.has(key);
    expect(classifyFileWrite(join(outside, 'notes', 'deeper', 'b.txt'), zones, project, has)).toEqual({ autoAllow: true });
    expect(classifyFileWrite(join(outside, 'other.txt'), zones, project, has).autoAllow).toBe(false);
  });

  it('does not let a symlink inside the working directory escape it', () => {
    const decision = classifyFileWrite(join(project, 'escape', 'x.txt'), zones, project, never);
    expect(decision).toMatchObject({ autoAllow: false, reason: 'outside_zone' });
  });

  it('asks for sensitive files even inside the working directory, remembering the exact file', () => {
    const envFile = join(project, '.env');
    const decision = classifyFileWrite(envFile, zones, project, never);
    expect(decision).toMatchObject({ autoAllow: false, reason: 'sensitive', rememberKey: rememberKeys.writeFile(envFile) });
    expect(classifyFileWrite(envFile, zones, project, key => key === rememberKeys.writeFile(envFile))).toEqual({ autoAllow: true });
    expect(classifyFileWrite(join(project, '.git', 'config'), zones, project, never).autoAllow).toBe(false);
    expect(classifyFileWrite(join(project, '.env.example'), zones, project, never)).toEqual({ autoAllow: true });
  });

  it('treats a home-directory working directory as untrusted', () => {
    const homeZones = resolveTrustedZones(homedir(), undefined);
    expect(classifyFileWrite(join(homedir(), 'notes.txt'), homeZones, homedir(), never).autoAllow).toBe(false);
  });
});

describe('isAutoApprovableBashCommand', () => {
  const auto = (command: string, z: TrustedZones = zones) => isAutoApprovableBashCommand(command, READ_ONLY, z);

  it.each([
    'npm test',
    'bun test src/foo.test.ts',
    'bun run typecheck',
    'pnpm run lint:fix',
    'yarn build',
    'git add . && git commit -m "fix: handle empty input"',
    'git fetch origin',
    'git switch -c feature/x',
    'mkdir -p src/new && touch src/new/index.ts',
    'cd src && npm test',
    'npm test 2>/dev/null',
    'npm test 2>&1 | cat',
    'cargo test',
    'go vet ./...',
    'python -m pytest tests',
    'eslint --fix src',
  ])('auto-allows routine command: %s', command => {
    expect(auto(command)).toBe(true);
  });

  it.each([
    ['npm install left-pad', 'installs software'],
    ['npm run deploy', 'unknown script'],
    ['npx eslint .', 'may download and run code'],
    ['git push', 'publishes'],
    ['git reset --hard', 'irreversible'],
    ['git -C /etc add .', 'targets another repository'],
    ['rm -rf build', 'deletes'],
    ['mkdir /tmp/x', 'absolute path'],
    ['touch ../x', 'escapes the tree'],
    ['prettier --write ~/notes.md', 'home path'],
    ['tsc --outDir=../dist', 'option value escapes'],
    ['cd / && mkdir x', 'cd outside'],
    ['cd .. && npm test', 'cd to parent'],
    ['cd && npm test', 'bare cd goes home'],
    ['npm test > out.txt', 'redirect writes a file'],
    ['npm test $(rm -rf ~)', 'command substitution'],
    ['FOO=1 npm test', 'env assignment'],
    ['npm test &', 'background'],
    ['ls | xargs rm', 'pipe into unknown command'],
    ['if true; then npm test; fi', 'control flow'],
    ['make deploy', 'arbitrary make target'],
  ])('asks for: %s (%s)', command => {
    expect(auto(command)).toBe(false);
  });

  it('never auto-allows without a trusted working directory', () => {
    expect(auto('npm test', resolveTrustedZones(undefined, sessionFolder))).toBe(false);
    expect(auto('npm test', resolveTrustedZones(homedir(), undefined))).toBe(false);
  });
});

describe('extractSimpleCommandsStrict', () => {
  it('flattens compound commands into word lists', () => {
    expect(extractSimpleCommandsStrict('git add . && git commit -m "a b" | cat')).toEqual([
      ['git', 'add', '.'], ['git', 'commit', '-m', 'a b'], ['cat'],
    ]);
  });

  it('fails closed on unsupported constructs', () => {
    expect(extractSimpleCommandsStrict('for f in *; do rm $f; done')).toBeNull();
    expect(extractSimpleCommandsStrict('echo `whoami`')).toBeNull();
    expect(extractSimpleCommandsStrict('')).toBeNull();
  });
});
