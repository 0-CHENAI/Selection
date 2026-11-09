import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createHash } from 'node:crypto';

import { SELECTION_SWAN_PATH } from '../../branding.ts';
import { CATHALIE_FONT_BASE64 } from '../cathalie-font.ts';
import { generateCallbackPage } from '../callback-page.ts';

const SWAN_ASSETS = [
  'selection-swan-trimmed.svg',
  'selection-icon.svg',
  'selection-swan-black.svg',
  'selection-swan-white.svg',
];

function assetPath(name: string): string {
  return join(import.meta.dir, '../../../../../apps/electron/src/renderer/assets', name);
}

function svgPath(name: string): string {
  const svg = readFileSync(assetPath(name), 'utf8');
  const match = svg.match(/d="([^"]+)"/);
  if (!match?.[1]) throw new Error(`No path in ${name}`);
  return match[1];
}

describe('OAuth callback page branding', () => {
  it('uses the existing Selection swan artwork', () => {
    for (const name of SWAN_ASSETS) {
      expect(svgPath(name)).toBe(SELECTION_SWAN_PATH);
    }
  });

  it('inlines the bundled CATHALIE wordmark face', () => {
    const otf = readFileSync(join(import.meta.dir, '../../../../../apps/electron/src/renderer/assets/fonts/cathalie.otf'));
    const embedded = Buffer.from(CATHALIE_FONT_BASE64, 'base64');
    expect(createHash('sha256').update(embedded).digest('hex')).toBe(createHash('sha256').update(otf).digest('hex'));
  });

  it('shows the swan, Selection title and label, and favicon on success', () => {
    const html = generateCallbackPage({
      title: 'Authorization Complete',
      isSuccess: true,
    });

    expect(html).toContain('<title>Selection - Authorization Complete</title>');
    expect(html).toContain('class="brand-name">Selection</div>');
    expect(html).not.toContain('CATHELIE');
    expect(html).toContain('font-family: "CATHALIE", sans-serif');
    expect(html).toContain('letter-spacing: 0.02em');
    expect(html).toContain('font-weight: 400');
    expect(html).toContain(SELECTION_SWAN_PATH);
    expect(html).toContain('rel="icon" type="image/svg+xml"');
    expect(html).toContain('media="(prefers-color-scheme: dark)"');
    expect(html).toContain('Authorization successful');
    expect(html).toContain('You can now return to the application.');
    expect(html).not.toContain('█');
    expect(html).not.toContain('CRAFT');
    expect(html).not.toContain('<pre');
  });

  it('keeps the same brand on error pages', () => {
    const html = generateCallbackPage({
      title: 'Authorization Failed',
      isSuccess: false,
      errorDetail: 'The user denied the authorization request.',
    });

    expect(html).toContain('<title>Selection - Authorization Failed</title>');
    expect(html).toContain('class="brand-name">Selection</div>');
    expect(html).not.toContain('CATHELIE');
    expect(html).toContain(SELECTION_SWAN_PATH);
    expect(html).toContain('rel="icon"');
    expect(html).toContain('Authorization failed: The user denied the authorization request.');
    expect(html).toContain('Please close this window and try again.');
    expect(html).not.toContain('█');
    expect(html).not.toContain('CRAFT');
  });

  it('escapes provider error text in the page', () => {
    const html = generateCallbackPage({
      title: 'Authorization Failed',
      isSuccess: false,
      errorDetail: '<img alt="CRAFT">',
    });

    expect(html).toContain('Authorization failed: &lt;img alt=&quot;CRAFT&quot;&gt;');
    expect(html).not.toContain('<img alt="CRAFT">');
  });
});
