import { describe, expect, it } from 'vitest';

import { FacePainter } from '../../src/actions/key.face.js';
import { FakeKey } from '../fixtures/fake.key.js';

describe('FacePainter', () => {
    it('tells a key everything the first time it is painted', () => {
        const key = new FakeKey('k1');
        const painter = new FacePainter();
        painter.add(key);
        painter.paint('k1', { title: 'Deadair', image: 'data:x', state: 1 });
        expect(key.titles).toEqual(['Deadair']);
        expect(key.images).toEqual(['data:x']);
        expect(key.states).toEqual([1]);
    });

    // A key is asked to redraw far more often than what it shows changes. This is what keeps the
    // plugin under Elgato's ten-updates-a-second rule without any action having to think about it.
    it('says nothing when nothing changed', () => {
        const key = new FakeKey('k1');
        const painter = new FacePainter();
        painter.add(key);
        painter.paint('k1', { title: 'Deadair', image: 'data:x' });
        painter.paint('k1', { title: 'Deadair', image: 'data:x' });
        painter.paint('k1', { title: 'Deadair', image: 'data:x' });
        expect(key.titles).toHaveLength(1);
        expect(key.images).toHaveLength(1);
    });

    it('sends only the field that moved', () => {
        const key = new FakeKey('k1');
        const painter = new FacePainter();
        painter.add(key);
        painter.paint('k1', { title: 'A', image: 'data:x' });
        painter.paint('k1', { title: 'B', image: 'data:x' });
        expect(key.titles).toEqual(['A', 'B']);
        expect(key.images).toEqual(['data:x']);
    });

    it('leaves a field alone when the frame does not mention it', () => {
        const key = new FakeKey('k1');
        const painter = new FacePainter();
        painter.add(key);
        painter.paint('k1', { title: 'A', image: 'data:x' });
        painter.paint('k1', { title: 'B' });
        expect(key.images).toEqual(['data:x']);
    });

    it('paints every key, or one of them', () => {
        const one = new FakeKey('k1');
        const two = new FakeKey('k2');
        const painter = new FacePainter();
        painter.add(one);
        painter.add(two);
        painter.paintAll({ title: 'both' });
        painter.paint('k2', { title: 'only me' });
        expect(one.title).toBe('both');
        expect(two.title).toBe('only me');
        expect(painter.ids()).toEqual(['k1', 'k2']);
    });

    // A send fails because the app has let the key go, and the key going is its own event.
    it('swallows a send that fails rather than throwing at the caller', () => {
        const key = new FakeKey('k1');
        key.setTitle = () => Promise.reject(new Error('gone'));
        const painter = new FacePainter();
        painter.add(key);
        expect(() => painter.paint('k1', { title: 'A' })).not.toThrow();
    });

    it('forgets a key that went', () => {
        const painter = new FacePainter();
        painter.add(new FakeKey('k1'));
        painter.remove('k1');
        expect(painter.size).toBe(0);
        expect(() => painter.paint('k1', { title: 'A' })).not.toThrow();
    });
});
