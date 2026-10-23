import schema from './spec.schema.json';
import styles from '../styles/catalog.json';
import { isAbsolute } from 'node:path';
import { Painter, type FontSet, type Palette, type TypeScale } from './paint';
import { PAINTERS } from './painters';
export const LAYOUTS = ['cover', 'agenda', 'section', 'bullets', 'image-text', 'comparison', 'big-number', 'timeline', 'process', 'chart', 'quote', 'closing', 'cards', 'matrix'] as const;
export type Layout = typeof LAYOUTS[number];
export type Slide = {
    layout: Layout;
    title: string;
    notes: string;
    eyebrow?: string;
    subtitle?: string;
    source?: string;
    slots: Record<string, any>;
};
export type Spec = {
    version: 1;
    dataFolderPath: string;
    style: keyof typeof styles;
    slides: Slide[];
};
export type Command = {
    command: string;
    parent?: string;
    path?: string;
    type?: string;
    props?: Record<string, string>;
};
type Rule = {
    type?: string;
    const?: unknown;
    enum?: unknown[];
    properties?: Record<string, Rule | undefined>;
    required?: string[];
    additionalProperties?: boolean;
    items?: Rule;
    minItems?: number;
    maxItems?: number;
    minLength?: number;
    maxLength?: number;
    oneOf?: Rule[];
    anyOf?: Rule[];
};
function check(value: unknown, rule: Rule, path: string): void {
    const fail = (message: string): never => {
        throw new Error(`${path}: ${message}`);
    };
    if (rule.oneOf) {
        let matches = 0;
        for (const option of rule.oneOf) {
            try {
                check(value, option, path);
                matches++;
            }
            catch {
            }
        }
        if (matches !== 1)
            fail('must match exactly one layout/slot schema (unknown fields and incorrect types are rejected)');
    }
    if (rule.anyOf && !rule.anyOf.some(option => {
        try {
            check(value, option, path);
            return true;
        }
        catch {
            return false;
        }
    }))
        fail('required alternative missing');
    if ('const' in rule && value !== rule.const)
        fail(`expected ${rule.const}`);
    if (rule.enum && !rule.enum.includes(value))
        fail(`expected one of ${rule.enum.join(', ')}`);
    if (rule.type !== 'object' && value && typeof value === 'object' && !Array.isArray(value)) {
        const object = value as Record<string, unknown>;
        for (const key of rule.required ?? [])
            if (!(key in object))
                fail(`missing ${key}`);
        for (const [key, child] of Object.entries(rule.properties ?? {}))
            if (child && key in object)
                check(object[key], child, `${path}.${key}`);
    }
    if (rule.type === 'object') {
        if (!value || typeof value !== 'object' || Array.isArray(value))
            fail('expected object');
        const object = value as Record<string, unknown>;
        for (const key of rule.required ?? [])
            if (!(key in object))
                fail(`missing ${key}`);
        for (const [key, item] of Object.entries(object)) {
            if (!rule.properties?.[key]) {
                if (rule.additionalProperties === false)
                    fail(`unknown field ${key}`);
            }
            else
                check(item, rule.properties[key], `${path}.${key}`);
        }
    }
    if (rule.type === 'array') {
        if (!Array.isArray(value))
            fail('expected array');
        const a = value as unknown[];
        if (a.length < (rule.minItems ?? 0) || a.length > (rule.maxItems ?? Infinity))
            fail(`item capacity ${rule.minItems ?? 0}..${rule.maxItems ?? 'unbounded'}`);
        a.forEach((v, i) => check(v, rule.items!, `${path}[${i}]`));
    }
    if (rule.type === 'string') {
        if (typeof value !== 'string')
            fail('expected string');
        const s = value as string;
        if (!s.trim() || s.length < (rule.minLength ?? 0) || s.length > (rule.maxLength ?? Infinity))
            fail('empty text or exceeded character capacity');
        if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(s))
            fail('unsupported control character');
    }
    if (rule.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value)))
        fail('expected finite number');
}
export function validateSpec(value: unknown): Spec {
    check(value, schema as Rule, 'spec');
    const spec = value as Spec;
    if (!isAbsolute(spec.dataFolderPath))
        throw new Error('dataFolderPath must be absolute');
    spec.slides.forEach((s, i) => {
        if (i && spec.slides[i - 1].layout === s.layout)
            throw new Error(`slide ${i + 1}: adjacent repeated layout ${s.layout}`);
        if (s.layout === 'image-text' && s.slots.image && !isAbsolute(s.slots.image.path))
            throw new Error('image.path must be absolute');
        if (s.layout === 'chart') {
            const { categories, series, type } = s.slots;
            if (categories.some((v: string) => /[,\r\n]/.test(v)))
                throw new Error('chart categories cannot contain commas or line breaks (OfficeCLI category delimiter)');
            if (series.some((v: any) => v.values.length !== categories.length))
                throw new Error('chart series/category lengths mismatch');
            if (['pie', 'doughnut'].includes(type) && (series.length !== 1 || series[0].values.some((v: number) => v < 0) || !series[0].values.some((v: number) => v > 0)))
                throw new Error('pie/doughnut requires one nonnegative series with positive total');
        }
    });
    return spec;
}
/** Conservative glyph-width estimate. Explicit blank lines count; no truncation or shrink-to-fit. Visual review remains authoritative. */
export function estimateLines(text: string, width: number, size: number): number {
    const capacity = width * 72 / 2.54 / size;
    return text.split(/\r\n|\r|\n/).reduce((sum, line) => {
        let units = 0;
        for (const character of line) {
            const fullWidth = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}\p{Extended_Pictographic}\u3000-\u303f\uff00-\uffef]/u.test(character);
            units += fullWidth ? 1.08 : /[MW@%]/.test(character) ? 0.9 : 0.61;
        }
        return sum + Math.max(1, Math.ceil(units / capacity));
    }, 0);
}
export function assertFits(text: string, width: number, height: number, size: number, name: string): void {
    const needed = estimateLines(text, width, size) * size * 2.54 / 72 * 1.24;
    if (needed > height)
        throw new Error(`${name}: overflow (${needed.toFixed(2)}cm > ${height}cm at ${size}pt); split/rewrite slots or choose another layout; content was not dropped`);
}
export type ImageSize = {
    width: number;
    height: number;
};
export function renderRecipe(spec: Spec, options: {
    platform?: string;
    fontCjk?: string;
    images?: Map<string, ImageSize>;
} = {}): Command[] {
    validateSpec(spec);
    const style = styles[spec.style];
    const p = style.palette as Palette;
    const fonts = style.fonts[(options.platform ?? process.platform) as keyof typeof style.fonts] ?? style.fonts.linux;
    const f: FontSet = {
        ...fonts, cjkHeading: options.fontCjk ?? fonts.cjkHeading, cjkBody: options.fontCjk ?? fonts.cjkBody,
    };
    const commands: Command[] = [{
            command: 'set', path: '/', props: { slideWidth: '33.8667cm', slideHeight: '19.05cm' },
        }, {
            command: 'set', path: '/theme', props: {
                headingFont: f.heading, 'headingFont.ea': f.cjkHeading, bodyFont: f.body, 'bodyFont.ea': f.cjkBody, accent1: p.accent, accent2: p.secondary,
            },
        }];
    spec.slides.forEach((slide, index) => {
        const parent = `/slide[${index + 1}]`;
        commands.push({
            command: 'add', parent: '/', type: 'slide', props: {
                background: p.background, name: `${String(index + 1).padStart(2, '0')} ${slide.layout}`,
            },
        }, {
            command: 'add', parent, type: 'notes', props: { text: slide.notes },
        });
        const type = { ...(style.type as TypeScale), headingBold: style.headingBold !== false };
        const painter = new Painter(commands, parent, slide, index, p, f, type, spec.style, options.images ?? new Map(), assertFits);
        const paint = PAINTERS[spec.style];
        if (!paint) throw new Error(`no painter for style ${spec.style}`);
        paint(painter);
    });
    return commands;
}
