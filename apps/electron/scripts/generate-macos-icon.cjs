/** Generate macOS Dock PNG + ICNS with a consistent transparent outer margin.
 * Run on macOS: bun apps/electron/scripts/generate-macos-icon.cjs [source.png|source.svg]
 * Linux/Windows and Icon Composer artwork retain their own platform sizing.
 */
const sharp = require('sharp');
const { mkdtempSync, mkdirSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { tmpdir } = require('node:os');
const { execFileSync } = require('node:child_process');

async function main() {
  if (process.platform !== 'darwin') throw new Error('ICNS generation requires macOS iconutil');
  const resources = resolve(__dirname, '../resources');
  const source = process.argv[2] ? resolve(process.argv[2]) : join(resources, 'icon.svg');
  const temp = mkdtempSync(join(tmpdir(), 'selection-macos-icon-'));
  const iconset = join(temp, 'icon.iconset');
  mkdirSync(iconset);
  // 848/1024: the visible plate occupies ~83% of the canvas, with equal margins.
  // Scale the whole artwork, keeping the swan-to-plate ratio unchanged.
  const raster = async size => {
    const inset = Math.round(size * 88 / 1024);
    const content = await sharp(source).resize(size - 2 * inset, size - 2 * inset).png().toBuffer();
    return sharp({ create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: content, left: inset, top: inset }]).png().toBuffer();
  };
  try {
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        const pixels = size * scale;
        const png = await raster(pixels);
        await sharp(png).toFile(join(iconset, `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`));
      }
    }
    await sharp(await raster(512)).toFile(join(resources, 'icon-dock.png'));
    execFileSync('iconutil', ['-c', 'icns', iconset, '-o', join(resources, 'icon.icns')]);
    console.log('Generated icon-dock.png and icon.icns with ~83% visible artwork.');
  } finally {
    rmSync(temp, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
