import type { FontPair, Palette, PlatformFonts, TextStyle, Theme, TypeRole } from './types';
import { normalizeHex } from './contrast';

export function platformKey(platform = process.platform): keyof PlatformFonts {
  if (platform === 'darwin' || platform === 'win32') return platform;
  return 'linux';
}

export function resolveFont(theme: Theme, role: 'heading' | 'body', text: string, platform = process.platform): string {
  const pair: FontPair = theme.fonts[role][platformKey(platform)];
  return /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u.test(text) ? pair.cjk : pair.latin;
}

export function resolveSize(theme: Theme, style?: TextStyle): number {
  if (style?.size) return style.size;
  const role: TypeRole = style?.role ?? 'body';
  return theme.type[role];
}

export function resolveColor(theme: Theme, color?: string): string {
  if (!color) return normalizeHex(theme.palette.text, theme.palette);
  const key = color.replace('#', '');
  if (key in theme.palette) return normalizeHex(theme.palette[key as keyof Palette], theme.palette);
  return normalizeHex(color, theme.palette);
}

export function resolvePalette(theme: Theme, token: keyof Palette | string): string {
  if (token in theme.palette) return normalizeHex(theme.palette[token as keyof Palette]);
  return resolveColor(theme, token);
}

export function fontStack(theme: Theme, role: 'heading' | 'body'): string {
  const { darwin, win32, linux } = theme.fonts[role];
  const names = [darwin.cjk, darwin.latin, win32.cjk, win32.latin, linux.cjk, linux.latin, 'WenQuanYi Micro Hei', 'sans-serif'];
  return [...new Set(names)].map(name => (name.includes(' ') ? `"${name}"` : name)).join(', ');
}
