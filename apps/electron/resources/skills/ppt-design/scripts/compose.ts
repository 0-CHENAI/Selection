#!/usr/bin/env bun
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderRecipe, validateSpec, type ImageSize } from './recipe';

/** PNG/JPEG dimensions allow dependency-free contain-fit, never stretch-fit. */
export function imageSize(path: string): ImageSize {
  const bytes = readFileSync(path);
  const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(pngSignature)) {
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (width && height) return { width, height };
  }
  if (bytes[0] === 255 && bytes[1] === 216) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset] !== 255) throw new Error(`Invalid JPEG: ${path}`);
      while (bytes[offset] === 255) offset++;
      const marker = bytes[offset++];
      if (marker === 217 || marker === 218) break;
      if (marker === 1 || (marker >= 208 && marker <= 215)) continue;
      if (offset + 2 > bytes.length) break;
      const length = bytes.readUInt16BE(offset);
      if (length < 2 || offset + length > bytes.length) break;
      if ([192, 193, 194, 195, 197, 198, 199, 201, 202, 203, 205, 206, 207].includes(marker)) {
        if (length < 7) break;
        const height = bytes.readUInt16BE(offset + 3);
        const width = bytes.readUInt16BE(offset + 5);
        if (width && height) return { width, height };
      }
      offset += length;
    }
  }
  throw new Error(`Image must be a valid PNG or JPEG: ${path}`);
}

export function validateOutput(dataFolderPath: string, out: string): string {
  if (!isAbsolute(out) || extname(out).toLowerCase() !== '.pptx') {
    throw new Error('--out must be an absolute .pptx path');
  }
  if (!statSync(dataFolderPath).isDirectory()) {
    throw new Error('dataFolderPath must be an existing directory');
  }
  const folder = realpathSync(dataFolderPath);
  const parent = realpathSync(dirname(out));
  const distance = relative(folder, parent);
  if (distance === '..' || distance.startsWith(`..${sep}`) || isAbsolute(distance)) {
    throw new Error('--out must be inside dataFolderPath (including symlink resolution)');
  }
  if (existsSync(out)) throw new Error('Refusing to overwrite existing output');
  return resolve(parent, basename(out));
}

async function officecli(bin: string, args: string[], stdin?: string): Promise<void> {
  // The fixed Windows launcher delegates to this adjacent executable. Avoid cmd.exe interpolation.
  const executable = process.platform === 'win32' && /\.cmd$/i.test(bin)
    ? resolve(dirname(bin), 'win32-x64/officecli.exe')
    : bin;
  const child = Bun.spawn([executable, ...args, '--json'], {
    env: { ...process.env, OFFICECLI_SKIP_UPDATE: '1' },
    stdin: stdin === undefined ? 'ignore' : new TextEncoder().encode(stdin),
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0 || /\b(?:warning|unsupported)\b/i.test(stderr)) {
    throw new Error(`OfficeCLI ${args[0]} failed or warned (${code}): ${stderr}\n${stdout}`);
  }

  // Batch failures and property refusals may be nested in a successful outer envelope.
  function failed(value: unknown): boolean {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.some(failed);
    const object = value as Record<string, unknown>;
    if (object.success === false) return true;
    if (Array.isArray(object.warnings) && object.warnings.length > 0) return true;
    return Object.values(object).some(failed);
  }
  let result: unknown;
  try {
    result = JSON.parse(stdout);
  } catch {
    throw new Error(`OfficeCLI returned non-JSON output: ${stdout}`);
  }
  if (failed(result)) throw new Error(`OfficeCLI reported failed command or warnings: ${stdout}`);
}

export async function main(args = process.argv.slice(2)): Promise<void> {
  const flags = new Map<string, string>();
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!['--spec', '--out', '--officecli', '--font-cjk'].includes(key) || !value || flags.has(key)) {
      throw new Error('Usage: bun compose.ts --spec /ABS/spec.json --out /ABS/dataFolder/deck.pptx [--officecli /ABS/bin] [--font-cjk FONT]');
    }
    flags.set(key, value);
  }
  const specPath = flags.get('--spec');
  const out = flags.get('--out');
  if (!specPath || !isAbsolute(specPath) || !out) {
    throw new Error('--spec and --out absolute paths are required');
  }
  const spec = validateSpec(JSON.parse(readFileSync(specPath, 'utf8')));
  const target = validateOutput(spec.dataFolderPath, out);
  const images = new Map<string, ImageSize>();
  for (const slide of spec.slides) {
    if (slide.layout !== 'image-text' || !slide.slots.image) continue;
    const path = slide.slots.image.path;
    if (!statSync(path).isFile()) throw new Error(`Image is not a file: ${path}`);
    images.set(path, imageSize(path));
  }
  const commands = renderRecipe(spec, { fontCjk: flags.get('--font-cjk'), images });
  const bin = flags.get('--officecli') ?? process.env.CRAFT_OFFICECLI ?? resolve(
    dirname(fileURLToPath(import.meta.url)),
    '../../../bin',
    process.platform === 'win32' ? 'officecli.cmd' : 'officecli',
  );
  if (!isAbsolute(bin)) throw new Error('OfficeCLI executable must be absolute');
  if (!existsSync(bin)) throw new Error(`OfficeCLI executable missing: ${bin}; prepare bundled OfficeCLI first`);

  // Validate every slot, file, and geometry before create; create rejects overwrite races too.
  await officecli(bin, ['create', target, '--locale', 'en-US']);
  try {
    await officecli(bin, ['batch', target], JSON.stringify(commands));
  } finally {
    await officecli(bin, ['close', target]);
  }
  console.log(JSON.stringify({
    outcome: 'GENERATED_UNREVIEWED',
    path: target,
    slides: spec.slides.length,
    style: spec.style,
    visualReviewRequired: true,
    gates: ['G1 story/order', 'G2 typography/fit', 'G3 schema/readback', 'G4 real screenshots of every slide', 'G5 close/reopen/path'],
    visualAttemptsMaximum: 3,
  }));
}

if (import.meta.main) {
  main().catch(error => {
    console.error(JSON.stringify({ outcome: 'FAILED', error: error instanceof Error ? error.message : String(error) }));
    process.exitCode = 1;
  });
}
