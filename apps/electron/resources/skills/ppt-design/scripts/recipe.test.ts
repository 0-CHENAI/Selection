import { describe, expect, test } from 'bun:test';
import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertFits, estimateLines, renderRecipe, validateSpec, type Spec } from './recipe';
import { validateOutput } from './compose';
import { heatIslandSpec, sweepSpec } from './sample-deck';
import { H, W } from './paint';
import { STYLE_IDS } from './style-packs';
import { wrapHeading } from './wrap';
const base = (): Spec => ({
    version: 1, dataFolderPath: '/tmp', style: 'business', slides: [{
            layout: 'comparison', title: 'Compare options', notes: 'Keep the entire speaker note.', source: 'Source: demonstration', slots: {
                left: {
                    heading: 'First', body: 'Original left body.'
                }, right: {
                    heading: 'Second', body: 'Original right body.'
                }
            }
        }]
});
describe('recipe consumer safety', () => {
    test('explicit blank and trailing lines contribute to overflow', () => {
        expect(estimateLines('one\n\nthree\n', 30, 18)).toBe(4);
        expect(() => assertFits('one\n'.repeat(100), 30, 5, 18, 'body')).toThrow('overflow');
    });
    test('fullwidth punctuation crosses a one-line capacity boundary', () => {
        expect(estimateLines('，，，，', 2, 18)).toBe(2);
        expect(() => assertFits('，，，，', 2, 1, 18, 'punctuation')).toThrow('overflow');
    });
    test('long content fails instead of shrinking or dropping text', () => {
        const spec = base();
        spec.slides[0].slots.left.body = '界'.repeat(800);
        expect(() => renderRecipe(spec)).toThrow('overflow');
    });
    test('unknown fields rejected recursively', () => {
        for (const mutate of [(s: any) => s.extra = true, (s: any) => s.slides[0].extra = true, (s: any) => s.slides[0].slots.left.extra = true]) {
            const s = base();
            mutate(s);
            expect(() => validateSpec(s)).toThrow();
        }
    });
    test('wrong types, missing values and adjacent repeats rejected', () => {
        const s = base();
        s.slides[0].slots.left.body = 9;
        expect(() => validateSpec(s)).toThrow();
        const repeated = base();
        repeated.slides.push(structuredClone(repeated.slides[0]));
        expect(() => validateSpec(repeated)).toThrow('adjacent');
    });
    test('image-text rejects neither or both alternatives', () => {
        const spec = base();
        spec.slides[0] = {
            layout: 'image-text', title: 'Image context', notes: 'Demo', slots: {
                body: 'Context'
            }
        };
        expect(() => validateSpec(spec)).toThrow();
        spec.slides[0].slots.panel = {
            headline: 'Intentional panel', body: 'Panel copy'
        };
        spec.slides[0].slots.image = {
            path: '/tmp/photo.png', alt: 'Photo'
        };
        expect(() => validateSpec(spec)).toThrow();
    });
    test('supplied images preserve aspect ratio and alternative text', () => {
        const s = base();
        s.slides[0] = {
            layout: 'image-text', title: 'Context image', notes: 'Demo', slots: {
                body: 'Full body copy.', image: {
                    path: '/tmp/photo.png', alt: 'Original image description'
                }
            }
        };
        const images = new Map<string, {
            width: number;
            height: number;
        }>();
        images.set('/tmp/photo.png', {
            width: 1600, height: 900
        });
        const commands = renderRecipe(s, {
            images
        });
        const image = commands.find(c => c.type === 'picture')!.props!;
        expect(parseFloat(image.width) / parseFloat(image.height)).toBeCloseTo(16 / 9);
        expect(image.alt).toBe('Original image description');
        expect(commands.some(c => c.props?.text === 'Full body copy.')).toBe(true);
    });
    test('chart rejects series/category length mismatches', () => {
        const spec = base();
        spec.slides[0] = {
            layout: 'chart', title: 'Observed values', notes: 'Demo',
            slots: {
                type: 'column', categories: ['A', 'B'], series: [{
                        name: 'Revenue', values: [1, 2, 3]
                    }], insight: 'A useful comparison'
            }
        };
        expect(() => validateSpec(spec)).toThrow('lengths mismatch');
    });
    test('no malformed category delimiter or nonfinite data silently loses content', () => {
        const s = base();
        s.slides[0] = {
            layout: 'chart', title: 'Values', notes: 'Demo', slots: {
                type: 'line', categories: ['A,B', 'C'], series: [{
                        name: 'S', values: [1, 2]
                    }], insight: 'Demo'
            }
        };
        expect(() => validateSpec(s)).toThrow('delimiter');
        s.slides[0].slots.categories = ['A', 'B'];
        s.slides[0].slots.series[0].values = [NaN, 2];
        expect(() => validateSpec(s)).toThrow();
    });
    test('each style pack composes different geometry, not a recolor', () => {
        const signature = (style: Spec['style'], layout: Spec['slides'][number]['layout']) => {
            const spec = heatIslandSpec(style, '/tmp');
            spec.slides = spec.slides.filter(slide => slide.layout === layout);
            const commands = renderRecipe(spec);
            const shapes = commands.filter(command => command.type === 'shape' && !command.props?.text);
            const area = Math.max(0, ...shapes.map(command => parseFloat(command.props!.width) * parseFloat(command.props!.height)));
            const geometry = shapes.map(command => `${command.props!.name}:${command.props!.x}:${command.props!.width}:${command.props!.geometry ?? 'rect'}`).join('|');
            return { area, geometry, chart: commands.find(command => command.type === 'chart')?.props };
        };
        const covers = STYLE_IDS.map(style => signature(style, 'cover'));
        const comparisons = STYLE_IDS.map(style => signature(style, 'comparison'));
        for (const cover of covers) expect(cover.area).toBeGreaterThan(40);
        expect(new Set(covers.map(cover => cover.geometry)).size).toBe(STYLE_IDS.length);
        expect(new Set(comparisons.map(item => item.geometry)).size).toBe(STYLE_IDS.length);
        const chart = signature('business', 'chart').chart;
        expect(chart?.gridlines).toBe('none');
        expect(chart?.dataLabels).toBe('outsideEnd');
        expect(chart?.valaxisvisible).toBe('false');
    });
    test('heat-island copy and every layout fit in every style pack', () => {
        for (const style of STYLE_IDS) {
            expect(renderRecipe(heatIslandSpec(style, '/tmp')).some(command => command.type === 'chart')).toBe(true);
            expect(renderRecipe(sweepSpec(style, '/tmp')).filter(command => command.type === 'slide')).toHaveLength(14);
        }
    });
    test('titles wrap 街区 together and large numbers stay on-canvas', () => {
        expect(wrapHeading('把城市热岛变成清凉街区', 8.4, 42).split('\n').includes('区')).toBe(false);
        for (const style of STYLE_IDS) {
            const commands = renderRecipe(heatIslandSpec(style, '/tmp'));
            const texts = commands.filter(command => command.type === 'shape' && command.props?.text);
            for (const command of texts) {
                const x = parseFloat(command.props!.x);
                const y = parseFloat(command.props!.y);
                const w = parseFloat(command.props!.width);
                const h = parseFloat(command.props!.height);
                expect(x).toBeGreaterThanOrEqual(0);
                expect(y).toBeGreaterThanOrEqual(0);
                expect(x + w).toBeLessThanOrEqual(W + 0.05);
                expect(y + h).toBeLessThanOrEqual(H + 0.05);
            }
            const sizes = texts.map(command => Number(command.props!.size)).filter(size => Number.isFinite(size));
            expect(Math.min(...sizes.filter(size => size >= 16), 16)).toBeGreaterThanOrEqual(16);
            expect(texts.some(command => command.props?.name === 'title' && Number(command.props.size) >= 28)).toBe(true);
            expect(texts.some(command => command.props?.name === 'title' && String(command.props.text).includes('街区'))).toBe(true);
        }
    });
    test('output containment resolves symlinks and refuses overwrite', () => {
        const dir = realpathSync(mkdtempSync(join(tmpdir(), 'ppt-recipe-')));
        try {
            mkdirSync(join(dir, 'data'));
            mkdirSync(join(dir, 'outside'));
            symlinkSync(join(dir, 'outside'), join(dir, 'data', 'escape'));
            expect(() => validateOutput(join(dir, 'data'), join(dir, 'data', 'escape', 'deck.pptx'))).toThrow('inside');
            writeFileSync(join(dir, 'data', 'exists.pptx'), 'existing');
            expect(() => validateOutput(join(dir, 'data'), join(dir, 'data', 'exists.pptx'))).toThrow('overwrite');
            expect(validateOutput(join(dir, 'data'), join(dir, 'data', 'new.pptx'))).toBe(join(dir, 'data', 'new.pptx'));
        }
        finally {
            rmSync(dir, {
                recursive: true, force: true
            });
        }
    });
});
