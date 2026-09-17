import { describe, expect, it } from 'vitest';

import { asKeyImage, nowPlayingSvg, PROGRESS_STEPS, progressStep } from '../../src/display/key.image.js';

describe('progressStep', () => {
    it.each([
        [0, 0],
        [0.5, PROGRESS_STEPS / 2],
        [1, PROGRESS_STEPS],
        [-1, 0],
        [9, PROGRESS_STEPS],
    ])('puts %s at step %s', (fraction, step) => {
        expect(progressStep(fraction)).toBe(step);
    });
});

describe('nowPlayingSvg', () => {
    const cover = 'data:image/jpeg;base64,AAAA';

    // Measured on a real Stream Deck + by the sibling plugin: the app's renderer is Qt's, not a
    // browser's, and SVG 1.1 is the spelling it is sure to know.
    it('embeds the cover through xlink:href rather than the bare href', () => {
        const svg = nowPlayingSvg({ cover, stale: false, shade: true });
        expect(svg).toContain(`xlink:href="${cover}"`);
        expect(svg).toContain('xmlns:xlink="http://www.w3.org/1999/xlink"');
        expect(svg).not.toMatch(/[^:]href="data:/);
    });

    it('draws a record where there is no cover', () => {
        const svg = nowPlayingSvg({ stale: false, shade: true });
        expect(svg).not.toContain('<image');
        expect(svg).toContain('<circle');
    });

    it('draws no bar without a step, which is what a stream gets', () => {
        expect(nowPlayingSvg({ cover, stale: false, shade: true })).not.toContain('height="8"');
    });

    it('fills the bar further as the step rises', () => {
        const early = nowPlayingSvg({ cover, step: 4, stale: false, shade: true });
        const late = nowPlayingSvg({ cover, step: 30, stale: false, shade: true });
        const widthOf = (svg: string): number =>
            Number(/height="8" fill="#2e7bd6"/.exec(svg) ? /width="([\d.]+)" height="8" fill="#2e7bd6"/.exec(svg)?.[1] : 0);
        expect(widthOf(late)).toBeGreaterThan(widthOf(early));
    });

    // One missed reading must not throw away something true, and the paleness is what says "this is
    // the last thing known" rather than "this is what is playing now".
    it('draws a stale reading faint rather than blanking it', () => {
        expect(nowPlayingSvg({ cover, stale: true, shade: true })).toContain('opacity="0.4"');
        expect(nowPlayingSvg({ cover, stale: false, shade: true })).not.toContain('opacity="0.4"');
    });

    it('leaves the shade off a key showing no title, where it would only darken the cover', () => {
        expect(nowPlayingSvg({ cover, stale: false, shade: true })).toContain('url(#shade)');
        expect(nowPlayingSvg({ cover, stale: false, shade: false })).not.toContain('url(#shade)');
    });

    it('is well-formed enough to have one root and balanced tags', () => {
        const svg = nowPlayingSvg({ cover, step: 12, stale: false, shade: true });
        expect(svg.startsWith('<svg')).toBe(true);
        expect(svg.endsWith('</svg>')).toBe(true);
        expect(svg.split('<svg').length - 1).toBe(1);
    });
});

describe('asKeyImage', () => {
    // Elgato's documented form, and NOT base64: the cover inside is already base64, and wrapping
    // base64 in base64 would grow every redraw by a third for nothing.
    it('is a percent-encoded SVG data URI', () => {
        const image = asKeyImage('<svg><rect fill="#fff"/></svg>');
        expect(image.startsWith('data:image/svg+xml,')).toBe(true);
        expect(image).not.toContain('base64,');
        expect(decodeURIComponent(image.slice('data:image/svg+xml,'.length))).toBe('<svg><rect fill="#fff"/></svg>');
    });
});
