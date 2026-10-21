/**
 * Conservative per-provider image token estimates for the compaction precheck.
 *
 * The goal is avoiding overflow, not matching a provider invoice. Families are
 * chosen from connection config (explicit field, piAuthProvider, or API host),
 * never from a model id. No count endpoint is called.
 *
 * Kimi and GLM worked examples are the resized grid counts themselves
 * (1024² → 1369, 2048² → 4225, GLM 2048² → 5329). An extra wrapper on top of
 * those grids would miss the oracles, so those two families stop at the grid
 * (GLM also caps at 6144). Qwen's +2 and the unknown-family +4 are part of
 * their estimates.
 */

import { deepSeekImageTokens } from '../../../utils/image-send-size.ts';

export const IMAGE_TOKEN_FAMILIES = [
  'anthropic',
  'openai',
  'openai-patch',
  'deepseek',
  'kimi',
  'glm',
  'qwen3',
  'qwen2.5',
  'unknown',
] as const;

export type ImageTokenFamily = (typeof IMAGE_TOKEN_FAMILIES)[number];

export interface ImageTokenConnection {
  piAuthProvider?: string;
  baseUrl?: string;
  /** Explicit family. Wins over provider id and host. */
  imageTokenFamily?: string;
  /** DashScope VL high-resolution mode. Raises the pixel budget and applies the 16384 token cap. */
  vlHighResolutionImages?: boolean;
  /** Explicit DashScope max_pixels. Also applies the 16384 token cap. */
  imageMaxPixels?: number;
}

const ANTHROPIC_LONG_EDGE = 1568;
const ANTHROPIC_MAX_PIXELS = 1_150_000;
const OPENAI_TILE = 512;
const OPENAI_PATCH = 32;
const KIMI_PATCH = 14;
const KIMI_MERGE = 28;
const KIMI_MAX_PATCHES = 16_384;
const KIMI_MAX_SIDE_PATCHES = 512;
const GLM_FACTOR = 28;
const GLM_MAX_PIXELS = 9_633_792 / 2;
const GLM_MIN_PIXELS = 12_544 / 2;
const GLM_TOKEN_CAP = 6144;
const QWEN3_FACTOR = 32;
const QWEN3_MAX_PIXELS = 2_621_440;
const QWEN25_FACTOR = 28;
const QWEN25_MAX_PIXELS = 1_003_520;
const QWEN_HIGH_RES_TOKEN_CAP = 16_384;
const UNKNOWN_PIXELS_PER_TOKEN = 784;
const UNKNOWN_TOKEN_CAP = 16_384;
const UNKNOWN_MARGIN = 4;
const QWEN_MARGIN = 2;

/** Upper bound used when the image bytes do not yield a width and height. */
const UNKNOWN_DIMENSION_TOKENS: Record<ImageTokenFamily, number> = {
  anthropic: 1534,
  openai: 4096,
  'openai-patch': 4096,
  deepseek: 1024,
  kimi: 8192,
  glm: GLM_TOKEN_CAP,
  qwen3: 8192,
  'qwen2.5': 8192,
  unknown: UNKNOWN_TOKEN_CAP + UNKNOWN_MARGIN,
};

const PROVIDER_FAMILIES: Record<string, ImageTokenFamily> = {
  anthropic: 'anthropic',
  openai: 'openai',
  'openai-codex': 'openai',
  azure: 'openai',
  'azure-openai-responses': 'openai',
  deepseek: 'deepseek',
  moonshotai: 'kimi',
  'moonshotai-cn': 'kimi',
  'kimi-coding': 'kimi',
  kimi: 'kimi',
  moonshot: 'kimi',
  zai: 'glm',
  'zai-coding-cn': 'glm',
  glm: 'glm',
  zhipu: 'glm',
  'qwen-token-plan': 'qwen3',
  'qwen-token-plan-cn': 'qwen3',
  'qwen-token-plan-individual': 'qwen3',
  dashscope: 'qwen3',
  qwen: 'qwen3',
};

const HOST_FAMILIES: Record<string, ImageTokenFamily> = {
  'api.anthropic.com': 'anthropic',
  'api.openai.com': 'openai',
  'chatgpt.com': 'openai',
  'api.deepseek.com': 'deepseek',
  'api.moonshot.ai': 'kimi',
  'api.moonshot.cn': 'kimi',
  'api.kimi.com': 'kimi',
  'open.bigmodel.cn': 'glm',
  'api.z.ai': 'glm',
  'dashscope.aliyuncs.com': 'qwen3',
};

function positive(value: number): boolean {
  return Number.isFinite(value) && value > 0;
}

function connectionHost(baseUrl?: string): string | undefined {
  const trimmed = baseUrl?.trim();
  if (!trimmed) return undefined;
  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    return undefined;
  }
}

function familyFromHost(host: string | undefined): ImageTokenFamily | undefined {
  if (!host) return undefined;
  if (HOST_FAMILIES[host]) return HOST_FAMILIES[host];
  if (host.endsWith('.dashscope.aliyuncs.com') || host.endsWith('.maas.aliyuncs.com')) return 'qwen3';
  if (host.endsWith('.bigmodel.cn')) return 'glm';
  if (host.endsWith('.z.ai')) return 'glm';
  return undefined;
}

export function isImageTokenFamily(value: string | undefined): value is ImageTokenFamily {
  return !!value && (IMAGE_TOKEN_FAMILIES as readonly string[]).includes(value);
}

/**
 * Family for one connection. Explicit `imageTokenFamily` wins, then the auth
 * provider id, then the API host. Model ids are not an input.
 */
export function resolveImageTokenFamily(connection?: ImageTokenConnection | null): ImageTokenFamily {
  if (isImageTokenFamily(connection?.imageTokenFamily)) return connection.imageTokenFamily;
  const provider = connection?.piAuthProvider?.trim().toLowerCase();
  if (provider && PROVIDER_FAMILIES[provider]) return PROVIDER_FAMILIES[provider];
  return familyFromHost(connectionHost(connection?.baseUrl)) ?? 'unknown';
}

/** Anthropic downscale: long edge 1568 and about 1.15 megapixels, never upscale. */
export function anthropicImageTokens(width: number, height: number): number {
  if (!positive(width) || !positive(height)) return 0;
  let scale = 1;
  const longEdge = Math.max(width, height);
  if (longEdge > ANTHROPIC_LONG_EDGE) scale = Math.min(scale, ANTHROPIC_LONG_EDGE / longEdge);
  const pixels = width * height;
  if (pixels * scale * scale > ANTHROPIC_MAX_PIXELS) {
    scale = Math.min(scale, Math.sqrt(ANTHROPIC_MAX_PIXELS / pixels));
  }
  return Math.ceil((width * scale) * (height * scale) / 750);
}

/** OpenAI high detail: fit the long edge to 2048, then the short edge to 768, then 512px tiles. */
export function openAiHighDetailTokens(width: number, height: number): number {
  if (!positive(width) || !positive(height)) return 0;
  let scaledWidth = width;
  let scaledHeight = height;
  const longEdge = Math.max(scaledWidth, scaledHeight);
  if (longEdge > 2048) {
    const scale = 2048 / longEdge;
    scaledWidth *= scale;
    scaledHeight *= scale;
  }
  const shortEdge = Math.min(scaledWidth, scaledHeight);
  if (shortEdge > 768) {
    const scale = 768 / shortEdge;
    scaledWidth *= scale;
    scaledHeight *= scale;
  }
  const tiles = Math.ceil(scaledWidth / OPENAI_TILE) * Math.ceil(scaledHeight / OPENAI_TILE);
  return 85 + 170 * tiles;
}

/**
 * Patch-based 32px family. Fit the long edge to 2048 and count ceil(side/32)
 * patches. The 1536-patch downscale some models apply is not used: skipping
 * it overestimates, which is the safe direction.
 */
export function openAiPatchTokens(width: number, height: number): number {
  if (!positive(width) || !positive(height)) return 0;
  let scaledWidth = width;
  let scaledHeight = height;
  const longEdge = Math.max(scaledWidth, scaledHeight);
  if (longEdge > 2048) {
    const scale = 2048 / longEdge;
    scaledWidth *= scale;
    scaledHeight *= scale;
  }
  return Math.min(8192, Math.ceil(scaledWidth / OPENAI_PATCH) * Math.ceil(scaledHeight / OPENAI_PATCH));
}

/**
 * Moonshot NaViT: 14px patches, 2×2 merge (28px per token). Scale down so
 * floor(w/14)·floor(h/14) ≤ 16384 and each side ≤ 512 patches. No upscale.
 */
export function kimiImageTokens(width: number, height: number): number {
  if (!positive(width) || !positive(height)) return 0;
  let scaledWidth = width;
  let scaledHeight = height;
  const maxSide = KIMI_MAX_SIDE_PATCHES * KIMI_PATCH;
  const side = Math.max(scaledWidth, scaledHeight);
  if (side > maxSide) {
    const scale = maxSide / side;
    scaledWidth *= scale;
    scaledHeight *= scale;
  }
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const patches = Math.floor(scaledWidth / KIMI_PATCH) * Math.floor(scaledHeight / KIMI_PATCH);
    if (patches <= KIMI_MAX_PATCHES) break;
    const scale = Math.sqrt(KIMI_MAX_PATCHES / patches);
    scaledWidth *= scale;
    scaledHeight *= scale;
  }
  return Math.ceil(scaledWidth / KIMI_MERGE) * Math.ceil(scaledHeight / KIMI_MERGE);
}

function smartResize(
  width: number,
  height: number,
  factor: number,
  minPixels: number,
  maxPixels: number,
): { width: number; height: number } {
  let resizedWidth = Math.round(width / factor) * factor;
  let resizedHeight = Math.round(height / factor) * factor;
  if (resizedWidth < factor) resizedWidth = factor;
  if (resizedHeight < factor) resizedHeight = factor;
  const pixels = resizedWidth * resizedHeight;
  if (pixels > maxPixels) {
    const beta = Math.sqrt((width * height) / maxPixels);
    resizedWidth = Math.max(factor, Math.floor(width / beta / factor) * factor);
    resizedHeight = Math.max(factor, Math.floor(height / beta / factor) * factor);
  } else if (pixels < minPixels && width * height > 0) {
    const beta = Math.sqrt(minPixels / (width * height));
    resizedWidth = Math.ceil(width * beta / factor) * factor;
    resizedHeight = Math.ceil(height * beta / factor) * factor;
  }
  return { width: resizedWidth, height: resizedHeight };
}

/** GLM 4.1V/4.5V/4.6V: 28px grid, temporal factor 2 baked into the pixel budget, cap 6144. */
export function glmImageTokens(width: number, height: number): number {
  if (!positive(width) || !positive(height)) return 0;
  const resized = smartResize(width, height, GLM_FACTOR, GLM_MIN_PIXELS, GLM_MAX_PIXELS);
  const tokens = (resized.height / GLM_FACTOR) * (resized.width / GLM_FACTOR);
  return Math.min(GLM_TOKEN_CAP, tokens);
}

function qwenImageTokens(
  width: number,
  height: number,
  factor: number,
  defaultMaxPixels: number,
  connection?: ImageTokenConnection | null,
): number {
  if (!positive(width) || !positive(height)) return 0;
  const highResolution = connection?.vlHighResolutionImages === true
    || (typeof connection?.imageMaxPixels === 'number' && connection.imageMaxPixels > 0);
  const maxPixels = typeof connection?.imageMaxPixels === 'number' && connection.imageMaxPixels > 0
    ? Math.floor(connection.imageMaxPixels)
    : highResolution
      ? QWEN_HIGH_RES_TOKEN_CAP * factor * factor
      : defaultMaxPixels;
  const minPixels = factor * factor * 4;
  const resized = smartResize(width, height, factor, minPixels, maxPixels);
  const tokens = (resized.height / factor) * (resized.width / factor) + QWEN_MARGIN;
  return highResolution ? Math.min(QWEN_HIGH_RES_TOKEN_CAP, tokens) : tokens;
}

export function qwen3ImageTokens(width: number, height: number, connection?: ImageTokenConnection | null): number {
  return qwenImageTokens(width, height, QWEN3_FACTOR, QWEN3_MAX_PIXELS, connection);
}

export function qwen25ImageTokens(width: number, height: number, connection?: ImageTokenConnection | null): number {
  return qwenImageTokens(width, height, QWEN25_FACTOR, QWEN25_MAX_PIXELS, connection);
}

/** Opaque providers: one token per 28×28 px, capped, plus a small margin. The EMA corrects the bias later. */
export function unknownImageTokens(width: number, height: number): number {
  if (!positive(width) || !positive(height)) return 0;
  return Math.min(UNKNOWN_TOKEN_CAP, Math.ceil((width * height) / UNKNOWN_PIXELS_PER_TOKEN)) + UNKNOWN_MARGIN;
}

export function imageTokensForFamily(
  family: ImageTokenFamily,
  width: number,
  height: number,
  connection?: ImageTokenConnection | null,
): number {
  switch (family) {
    case 'anthropic':
      return anthropicImageTokens(width, height);
    case 'openai':
      return Math.max(openAiHighDetailTokens(width, height), openAiPatchTokens(width, height));
    case 'openai-patch':
      return openAiPatchTokens(width, height);
    case 'deepseek':
      try {
        return deepSeekImageTokens(width, height);
      } catch {
        return 1024;
      }
    case 'kimi':
      return kimiImageTokens(width, height);
    case 'glm':
      return glmImageTokens(width, height);
    case 'qwen3':
      return qwen3ImageTokens(width, height, connection);
    case 'qwen2.5':
      return qwen25ImageTokens(width, height, connection);
    default:
      return unknownImageTokens(width, height);
  }
}

export function estimateImageTokens(
  width: number,
  height: number,
  connection?: ImageTokenConnection | null,
): number {
  return imageTokensForFamily(resolveImageTokenFamily(connection), width, height, connection);
}

export function fallbackImageTokens(connection?: ImageTokenConnection | null): number {
  return UNKNOWN_DIMENSION_TOKENS[resolveImageTokenFamily(connection)];
}

function decodeBase64Prefix(data: string, maxBytes: number): Uint8Array | undefined {
  const cleaned = data.replace(/\s/g, '');
  if (!cleaned) return undefined;
  const neededChars = Math.min(cleaned.length, Math.ceil(maxBytes / 3) * 4);
  const slice = cleaned.slice(0, neededChars);
  try {
    const binary = atob(slice);
    const bytes = new Uint8Array(Math.min(binary.length, maxBytes));
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return undefined;
  }
}

function readUInt24LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8) | ((bytes[offset + 2] ?? 0) << 16);
}

function readUInt32BE(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 24) | ((bytes[offset + 1] ?? 0) << 16)
    | ((bytes[offset + 2] ?? 0) << 8) | (bytes[offset + 3] ?? 0);
}

function inspectPng(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 24) return undefined;
  if (String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return undefined;
  const width = readUInt32BE(bytes, 16);
  const height = readUInt32BE(bytes, 20);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

function inspectGif(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 10 || String.fromCharCode(...bytes.subarray(0, 3)) !== 'GIF') return undefined;
  const width = (bytes[6] ?? 0) | ((bytes[7] ?? 0) << 8);
  const height = (bytes[8] ?? 0) | ((bytes[9] ?? 0) << 8);
  return width > 0 && height > 0 ? { width, height } : undefined;
}

function inspectJpeg(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (bytes[offset] === 0xff) offset += 1;
    const marker = bytes[offset];
    offset += 1;
    if (marker === undefined || marker === 0xd8 || marker === 0xd9) continue;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 1 >= bytes.length) return undefined;
    const segmentLength = ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
    if (segmentLength < 2) return undefined;
    const isStartOfFrame = (marker >= 0xc0 && marker <= 0xc3)
      || (marker >= 0xc5 && marker <= 0xc7)
      || (marker >= 0xc9 && marker <= 0xcb)
      || (marker >= 0xcd && marker <= 0xcf);
    if (isStartOfFrame && offset + 7 < bytes.length) {
      const height = ((bytes[offset + 3] ?? 0) << 8) | (bytes[offset + 4] ?? 0);
      const width = ((bytes[offset + 5] ?? 0) << 8) | (bytes[offset + 6] ?? 0);
      return width > 0 && height > 0 ? { width, height } : undefined;
    }
    offset += segmentLength;
  }
  return undefined;
}

function inspectWebp(bytes: Uint8Array): { width: number; height: number } | undefined {
  if (bytes.length < 30) return undefined;
  if (String.fromCharCode(...bytes.subarray(0, 4)) !== 'RIFF') return undefined;
  if (String.fromCharCode(...bytes.subarray(8, 12)) !== 'WEBP') return undefined;
  const chunk = String.fromCharCode(...bytes.subarray(12, 16));
  if (chunk === 'VP8X') {
    return { width: readUInt24LE(bytes, 24) + 1, height: readUInt24LE(bytes, 27) + 1 };
  }
  if (chunk === 'VP8L' && bytes[20] === 0x2f) {
    const b1 = bytes[21] ?? 0;
    const b2 = bytes[22] ?? 0;
    const b3 = bytes[23] ?? 0;
    const b4 = bytes[24] ?? 0;
    return {
      width: 1 + (b1 | ((b2 & 0x3f) << 8)),
      height: 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10)),
    };
  }
  if (chunk === 'VP8 ' && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    const width = ((bytes[26] ?? 0) | ((bytes[27] ?? 0) << 8)) & 0x3fff;
    const height = ((bytes[28] ?? 0) | ((bytes[29] ?? 0) << 8)) & 0x3fff;
    return width > 0 && height > 0 ? { width, height } : undefined;
  }
  return undefined;
}

export function readImageDimensions(bytes: Uint8Array): { width: number; height: number } | undefined {
  return inspectPng(bytes) ?? inspectJpeg(bytes) ?? inspectGif(bytes) ?? inspectWebp(bytes);
}

/** Dimensions of an inline image, or undefined when the header cannot be read. */
export function readImageDataDimensions(data: string | undefined): { width: number; height: number } | undefined {
  if (!data) return undefined;
  const payload = data.startsWith('data:') ? data.slice(data.indexOf(',') + 1) : data;
  const bytes = decodeBase64Prefix(payload, 512 * 1024);
  return bytes ? readImageDimensions(bytes) : undefined;
}

export function estimateImageContentTokens(
  data: string | undefined,
  connection?: ImageTokenConnection | null,
): number {
  const dimensions = readImageDataDimensions(data);
  if (!dimensions) return fallbackImageTokens(connection);
  return estimateImageTokens(dimensions.width, dimensions.height, connection);
}
