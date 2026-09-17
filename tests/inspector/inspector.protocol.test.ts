import { describe, expect, it } from 'vitest';

import { isToInspector, isToPlugin } from '../../src/inspector/inspector.messages.js';
import { inspectorMessages, settingsFrom } from '../../src/inspector/inspector.protocol.js';

const messages = inspectorMessages('panel-uuid', 'com.maroonedsoftware.bluos.now-playing');

describe('what the panel sends', () => {
    it('registers itself with the event the app named', () => {
        expect(messages.register('registerPropertyInspector')).toEqual({ event: 'registerPropertyInspector', uuid: 'panel-uuid' });
    });

    it('writes the key’s own player, and the default for the next key', () => {
        expect(messages.setSettings({ address: '192.168.1.234' })).toEqual({
            event: 'setSettings',
            context: 'panel-uuid',
            payload: { address: '192.168.1.234' },
        });
        expect(messages.setGlobalSettings({ defaultAddress: '192.168.1.234' })).toEqual({
            event: 'setGlobalSettings',
            context: 'panel-uuid',
            payload: { defaultAddress: '192.168.1.234' },
        });
    });

    it('asks the plugin for a check, naming the action it was opened on', () => {
        expect(messages.testConnection()).toEqual({
            event: 'sendToPlugin',
            action: 'com.maroonedsoftware.bluos.now-playing',
            context: 'panel-uuid',
            payload: { event: 'testConnection' },
        });
    });
});

describe('settingsFrom', () => {
    it('trims what was typed', () => {
        expect(settingsFrom('  192.168.1.234  ')).toEqual({ address: '192.168.1.234' });
    });

    it('leaves the address out entirely rather than storing an empty one', () => {
        expect(settingsFrom('')).toEqual({});
        expect(settingsFrom('   ')).toEqual({});
    });
});

describe('the guards', () => {
    it('recognise the two messages, and nothing else', () => {
        expect(isToPlugin({ event: 'testConnection' })).toBe(true);
        expect(isToPlugin({ event: 'somethingElse' })).toBe(false);
        expect(isToPlugin(null)).toBe(false);
        expect(isToInspector({ event: 'connection', ok: true, text: 'Connected.' })).toBe(true);
        expect(isToInspector({ event: 'connection', ok: 'yes', text: 'Connected.' })).toBe(false);
        expect(isToInspector(undefined)).toBe(false);
    });
});
