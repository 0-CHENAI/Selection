#!/usr/bin/env bun
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { main as compose } from './compose';
import { heatIslandSpec } from './sample-deck';
import { resolveThumbnailPath, STYLE_IDS, type StyleId } from './style-packs';

const skillRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const defaultOffice = resolve(skillRoot, '../../bin', process.platform === 'win32' ? 'officecli.cmd' : 'officecli');
const CAPTURE_CSS = `<style id="sel-capture">
html.headless, html.headless body { height:auto!important; overflow:visible!important; background:#111!important; }
html.headless .main { height:auto!important; overflow:visible!important; padding:0!important; gap:0!important; }
html.headless .slide-notes, html.headless .file-title, html.headless .slide-label { display:none!important; }
html.headless .slide-container, html.headless .slide-wrapper { margin:0!important; gap:0!important; }
html.headless .slide { margin:0 auto!important; box-shadow:none!important; border-radius:0!important; }
</style>
<script>document.documentElement.classList.add('headless')</script>`;

function flag(args: string[], name: string, fallback?: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
}

async function officecli(bin: string, args: string[]): Promise<void> {
  const child = Bun.spawn([bin, ...args, '--json'], {
    env: { ...process.env, OFFICECLI_SKIP_UPDATE: '1' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (code !== 0) throw new Error(`OfficeCLI ${args[0]} failed (${code}): ${stderr}\n${stdout}`);
}

function run(command: string[], timeoutMs: number): void {
  const result = Bun.spawnSync(command, { stdout: 'pipe', stderr: 'pipe', timeout: timeoutMs });
  if (result.exitCode !== 0) {
    throw new Error(`${command[0]} failed (${result.exitCode}): ${result.stderr.toString()}\n${result.stdout.toString()}`);
  }
}

function python(script: string): void {
  run(['python3', '-c', script], 60_000);
}

function chromeBin(): string {
  for (const candidate of ['google-chrome', 'chrome', 'chromium', 'chromium-browser']) {
    const found = Bun.which(candidate);
    if (found) return found;
  }
  throw new Error('Chrome/Chromium is required to capture HTML previews');
}

export async function generatePreviews(options: {
  out: string;
  officecli?: string;
  thumbs?: string;
  only?: string[];
}): Promise<void> {
  const out = realpathSync(options.out);
  const bin = options.officecli ?? process.env.CRAFT_OFFICECLI ?? defaultOffice;
  const chrome = chromeBin();
  mkdirSync(out, { recursive: true });
  const selected = options.only?.length
    ? STYLE_IDS.filter(id => options.only!.includes(id))
    : STYLE_IDS;
  if (selected.length === 0) throw new Error('no matching style packs');

  for (const style of selected) {
    const folder = join(out, style);
    const shotsDir = join(folder, 'screenshots');
    mkdirSync(shotsDir, { recursive: true });
    const work = realpathSync(mkdtempSync(join(tmpdir(), `ppt-style-${style}-`)));
    const spec = heatIslandSpec(style as StyleId, work);
    const specPath = join(work, 'spec.json');
    const deck = join(work, 'deck.pptx');
    writeFileSync(specPath, JSON.stringify(spec, null, 2));
    await compose(['--spec', specPath, '--out', deck, '--officecli', bin]);
    const delivered = join(folder, 'deck.pptx');
    try { unlinkSync(delivered); } catch { /* first render */ }
    copyFileSync(deck, delivered);

    const htmlPath = join(work, 'preview.html');
    await officecli(bin, ['view', delivered, 'html', '-o', htmlPath]);
    const html = readFileSync(htmlPath, 'utf8').replace('</head>', `${CAPTURE_CSS}</head>`);
    writeFileSync(htmlPath, html);

    const pages = spec.slides.length;
    const strip = join(work, 'strip.png');
    run([
      chrome, '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-sandbox',
      '--virtual-time-budget=8000', `--window-size=1280,${720 * pages}`,
      `--screenshot=${strip}`, `file://${htmlPath}`,
    ], 90_000);

    python(`
from PIL import Image
from pathlib import Path
im = Image.open(${JSON.stringify(strip)})
out = Path(${JSON.stringify(shotsDir)})
w, h = im.size
page_h = h // ${pages}
if page_h < 600:
    raise SystemExit(f'unexpected strip height {h} for ${pages} pages')
for i in range(${pages}):
    im.crop((0, i * page_h, w, (i + 1) * page_h)).resize((1280, 720)).save(out / f'slide-{i+1:02d}.png')
`);

    const mapping = { cover: 1, content: 2, data: spec.slides.findIndex(slide => slide.layout === 'chart') + 1 };
    for (const [key, page] of Object.entries(mapping)) {
      const src = join(shotsDir, `slide-${String(page).padStart(2, '0')}.png`);
      const dest = options.thumbs
        ? join(options.thumbs, style, `${key}.png`)
        : resolveThumbnailPath(style, key as 'cover' | 'content' | 'data');
      mkdirSync(dirname(dest), { recursive: true });
      copyFileSync(src, dest);
    }
    python(`
from PIL import Image
from pathlib import Path
folder = Path(${JSON.stringify(folder)})
shots = sorted((folder / 'screenshots').glob('slide-*.png'))
cols, w, h, pad = 3, 640, 360, 16
rows = (len(shots) + cols - 1) // cols
sheet = Image.new('RGB', (cols * w + (cols + 1) * pad, rows * h + (rows + 1) * pad), (24, 24, 24))
for i, path in enumerate(shots):
    im = Image.open(path).convert('RGB').resize((w, h))
    r, c = divmod(i, cols)
    sheet.paste(im, (pad + c * (w + pad), pad + r * (h + pad)))
sheet.save(folder.parent / f'${style}-sheet.png')
`);
    console.log(JSON.stringify({ style, deck: delivered, pages }));
  }

  python(`
from PIL import Image
from pathlib import Path
root = Path(${JSON.stringify(out)})
covers = [root / style / 'screenshots' / 'slide-01.png' for style in ${JSON.stringify(STYLE_IDS)}]
covers = [path for path in covers if path.exists()]
cols, w, h, pad = 5, 640, 360, 18
rows = (len(covers) + cols - 1) // cols
sheet = Image.new('RGB', (cols * w + (cols + 1) * pad, rows * h + (rows + 1) * pad), (18, 18, 18))
for i, path in enumerate(covers):
    im = Image.open(path).convert('RGB').resize((w, h))
    r, c = divmod(i, cols)
    sheet.paste(im, (pad + c * (w + pad), pad + r * (h + pad)))
sheet.save(root / 'styles-overview.png')
`);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const out = flag(args, '--out');
  if (!out) throw new Error('Usage: bun generate-previews.ts --out /ABS/dir [--officecli /ABS/bin] [--thumbs /ABS/dir] [--only id,id]');
  mkdirSync(out, { recursive: true });
  const only = flag(args, '--only')?.split(',').map(item => item.trim()).filter(Boolean);
  generatePreviews({
    out: realpathSync(out),
    officecli: flag(args, '--officecli'),
    thumbs: flag(args, '--thumbs'),
    only,
  }).catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
