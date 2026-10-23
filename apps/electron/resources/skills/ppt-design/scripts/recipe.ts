import schema from './spec.schema.json';
import styles from '../styles/catalog.json';
import { isAbsolute } from 'node:path';
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
    const style = styles[spec.style], p = style.palette, fonts = style.fonts[(options.platform ?? process.platform) as keyof typeof style.fonts] ?? style.fonts.linux;
    const f = {
        ...fonts, cjkHeading: options.fontCjk ?? fonts.cjkHeading, cjkBody: options.fontCjk ?? fonts.cjkBody
    };
    const commands: Command[] = [{
            command: 'set', path: '/', props: {
                slideWidth: '33.8667cm', slideHeight: '19.05cm'
            }
        }, {
            command: 'set', path: '/theme', props: {
                headingFont: f.heading, 'headingFont.ea': f.cjkHeading, bodyFont: f.body, 'bodyFont.ea': f.cjkBody, accent1: p.accent, accent2: p.secondary
            }
        }];
    spec.slides.forEach((slide, index) => {
        const parent = `/slide[${index + 1}]`, s = slide.slots;
        commands.push({
            command: 'add', parent: '/', type: 'slide', props: {
                background: p.background, name: `${String(index + 1).padStart(2, '0')} ${slide.layout}`
            }
        }, {
            command: 'add', parent, type: 'notes', props: {
                text: slide.notes
            }
        });
        const rect = (name: string, x: number, y: number, w: number, h: number, fill = p.surface, line = 'none') => commands.push({
            command: 'add', parent, type: 'shape', props: {
                name, x: `${x}cm`, y: `${y}cm`, width: `${w}cm`, height: `${h}cm`, fill, line, geometry: 'rect'
            }
        });
        const text = (name: string, value: string, x: number, y: number, w: number, h: number, size = 18, color = p.text, heading = false) => {
            assertFits(value, w, h, size, `slide ${index + 1} ${name}`);
            commands.push({
                command: 'add', parent, type: 'shape', props: {
                    name, text: value, x: `${x}cm`, y: `${y}cm`, width: `${w}cm`, height: `${h}cm`, size: String(size), font: heading ? f.heading : f.body, 'font.ea': heading ? f.cjkHeading : f.cjkBody, bold: String(heading && spec.style !== 'fresh-editorial'), color, fill: 'none', line: 'none', margin: '0cm', autoFit: 'none', valign: 'top', lineSpacing: '1.24x', spaceBefore: '0pt', spaceAfter: '0pt'
                }
            });
        };
        const panel = (name: string, x: number, y: number, w: number, h: number) => {
            if (style.panel === 'filled')
                rect(name, x, y, w, h);
            else if (style.panel === 'outlined')
                rect(name, x, y, w, h, 'none', `${p.rule}:1`);
            else
                rect(name, x, y, w, .035, p.rule);
        };
        if (style.chrome === 'band')
            rect('top-band', 0, 0, 33.8667, .22, p.text);
        else if (style.chrome === 'rail')
            rect('left-rail', .48, .8, .09, 17.4, p.accent);
        else
            rect('editorial-rule', 1.4, .75, 31, .035, p.rule);
        if (slide.eyebrow)
            text('eyebrow', slide.eyebrow, 1.4, 1.05, 29.5, .95, 14, p.accent);
        const special = ['cover', 'section', 'closing'].includes(slide.layout);
        if (!special) {
            text('title', slide.title, 1.4, 2, 30.8, 2.15, 36, p.text, true);
            rect('title-rule', 1.4, 4.35, 2, .06, p.accent);
        }
        if (slide.subtitle)
            text('subtitle', slide.subtitle, 1.4, special ? 4.5 : 4.65, 30.8, 1.05, 18, p.muted);
        const top = slide.subtitle ? 6.15 : 5.3;
        const bottom = 16.9, available = bottom - top;
        if (slide.source)
            text('source', slide.source, 1.4, 17.65, 28.7, .95, 12, p.muted);
        text('page', String(index + 1).padStart(2, '0'), 31, 17.7, 1.3, .7, 12, p.muted);
        switch (slide.layout) {
            case 'cover':
                text('title', slide.title, 1.4, 6, 29.8, 4.4, style.type.hero, p.text, true);
                rect('cover-rule', 1.4, 11, 8, .12, p.accent);
                text('presenter', s.presenter, 1.4, 12.2, 28, 1.8, 23);
                text('date', s.date, 1.4, 14.4, 28, 1.2, 18, p.muted);
                break;
            case 'section':
                text('section-number', s.number, 1.4, 6, 6, 4.8, 76, p.accent, true);
                text('title', slide.title, 8, 6, 23, 3.8, 36, p.text, true);
                text('body', s.body, 8, 11, 23, 5, 18);
                break;
            case 'closing':
                text('title', slide.title, 1.4, 6, 30, 3.6, style.type.hero, p.text, true);
                text('body', s.body, 1.4, 10.3, 28, 3.7, 23);
                rect('closing-rule', 1.4, 14.8, 8, .06, p.accent);
                text('contact', s.contact, 1.4, 15.4, 29, 1.4, 18, p.muted);
                break;
            case 'agenda':
            case 'bullets': {
                const step = available / s.items.length;
                s.items.forEach((v: string, i: number) => {
                    text(`item-number-${i}`, String(i + 1).padStart(2, '0'), 1.4, top + i * step, 1.9, 1.5, 23, p.accent, true);
                    text(`item-${i}`, v, 3.8, top + i * step, 27.4, step - .35, 23);
                    rect(`item-rule-${i}`, 3.8, top + (i + 1) * step - .2, 27.4, .025, p.rule);
                });
                break;
            }
            case 'comparison':
                ['left', 'right'].forEach((key, i) => {
                    const x = 1.4 + i * 15.8;
                    panel(key, x, top, 15, available);
                    text(`${key}-heading`, s[key].heading, x + .6, top + .6, 13.8, 2.3, 23, p.accent, true);
                    text(`${key}-body`, s[key].body, x + .6, top + 3.2, 13.8, available - 3.8);
                });
                break;
            case 'big-number':
                text('value', s.value, 1.4, top, 30, 4.9, style.type.number, p.accent, true);
                text('label', s.label, 1.4, top + 5.4, 29, 2.3, 23, p.text, true);
                text('context', s.context, 1.4, top + 8.2, 29, available - 8.2);
                break;
            case 'image-text':
                text('body', s.body, 1.4, top, 13.8, available);
                if (s.panel) {
                    panel('intentional-text-panel', 16.4, top, 15.8, available);
                    text('panel-headline', s.panel.headline, 17.1, top + .7, 14.4, 2.8, 23, p.accent, true);
                    text('panel-body', s.panel.body, 17.1, top + 4, 14.4, available - 4.7);
                }
                else {
                    const dimensions = options.images?.get(s.image.path);
                    if (!dimensions)
                        throw new Error(`image dimensions missing: ${s.image.path}`);
                    const scale = Math.min(15.8 / dimensions.width, available / dimensions.height), w = dimensions.width * scale, h = dimensions.height * scale;
                    commands.push({
                        command: 'add', parent, type: 'picture', props: {
                            src: s.image.path, alt: s.image.alt, name: 'supplied-image', x: `${16.4 + (15.8 - w) / 2}cm`, y: `${top + (available - h) / 2}cm`, width: `${w}cm`, height: `${h}cm`
                        }
                    });
                }
                break;
            case 'timeline': {
                const step = available / s.items.length;
                rect('timeline-spine', 2, top + .3, .05, available - .6, p.rule);
                s.items.forEach((v: any, i: number) => {
                    const y = top + i * step;
                    rect(`node-${i}`, 1.8, y + .15, .45, .45, p.accent);
                    text(`label-${i}`, v.label, 2.9, y, 4.4, step - .25, 18, p.accent);
                    text(`title-${i}`, v.title, 7.7, y, 9, step - .25, 23, p.text, true);
                    text(`body-${i}`, v.body, 17.4, y, 14.1, step - .25);
                });
                break;
            }
            case 'process':
            case 'cards': {
                const count = s.items.length, w = (30.8 - (count - 1) * .55) / count;
                s.items.forEach((v: any, i: number) => {
                    const x = 1.4 + i * (w + .55);
                    panel(`module-${i}`, x, top, w, available);
                    text(`index-${i}`, String(i + 1).padStart(2, '0'), x + .5, top + .5, w - 1, 1.5, 23, p.accent, true);
                    text(`title-${i}`, v.title, x + .5, top + 2.5, w - 1, 3.2, 23, p.text, true);
                    text(`body-${i}`, v.body, x + .5, top + 6, w - 1, available - 6.6);
                    if (slide.layout === 'process' && i < count - 1)
                        commands.push({
                            command: 'add', parent, type: 'shape', props: {
                                name: `process-arrow-${i}`, geometry: 'rightArrow', x: `${x + w + .05}cm`, y: `${top + 1}cm`, width: '.45cm', height: '.35cm', fill: p.accent, line: 'none'
                            }
                        });
                });
                break;
            }
            case 'chart': {
                text('insight', s.insight, 24, top, 8.2, available, 23, p.accent, true);
                const props: Record<string, string> = {
                    name: 'native-data-chart', chartType: s.type, x: '1.4cm', y: `${top}cm`, width: '21.7cm', height: `${available}cm`, categories: s.categories.join(','), data: s.series.map((v: any, i: number) => `Series ${i + 1}:${v.values.join(',')}`).join(';'), title: 'none', legend: 'bottom', colors: `${p.accent},${p.secondary},${p.muted}`, chartfill: p.background, plotFill: p.background, axisfont: `18:${p.text}:${f.cjkBody}`, legendFont: `18:${p.text}:${f.cjkBody}`, labelfont: `18:${p.text}:${f.cjkBody}`
                };
                commands.push({
                    command: 'add', parent, type: 'chart', props
                });
                s.series.forEach((v: any, i: number) => commands.push({
                    command: 'set', path: `${parent}/chart[1]/series[${i + 1}]`, props: {
                        name: v.name
                    }
                }));
                break;
            }
            case 'quote':
                rect('quote-rail', 1.4, top, .12, available, p.accent);
                text('quote', s.quote, 2.5, top, 28.4, available - 2.5, 30, p.text, true);
                text('attribution', s.attribution, 2.5, bottom - 1.5, 28.4, 1.5, 18, p.muted);
                break;
            case 'matrix':
                text('x-axis-label', s.xLabel, 3.5, top, 28.2, 1.2, 18, p.accent);
                text('y-axis-label', s.yLabel, 1.4, top + 1.4, 3, available - 1.4, 18, p.accent);
                {
                    const h = (available - 1.9) / 2;
                    s.cells.forEach((v: any, i: number) => {
                        const x = 5.1 + (i % 2) * 13.8, y = top + 1.4 + Math.floor(i / 2) * (h + .5);
                        panel(`cell-${i}`, x, y, 13.2, h);
                        text(`cell-title-${i}`, v.title, x + .5, y + .4, 12.2, 1.5, 23, p.text, true);
                        text(`cell-body-${i}`, v.body, x + .5, y + 1.9, 12.2, h - 2.3);
                    });
                }
                break;
        }
    });
    return commands;
}
