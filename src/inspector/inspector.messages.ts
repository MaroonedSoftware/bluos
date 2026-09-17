/**
 * What the settings panel and the plugin say to each other, beyond the settings themselves.
 *
 * The panel never sends the settings here. It writes them with `setSettings`, the Stream Deck app
 * hands them to the plugin, and the plugin checks what it was handed. So the answer the panel shows
 * is always about the settings the keys are actually using, rather than about what the panel
 * believes it typed. The sibling plugin arrived at the same rule for global settings; the only
 * difference here is which message the app delivers.
 */
export type ToPlugin = { event: 'testConnection' };

export type ToInspector = { event: 'connection'; ok: boolean; text: string };

export function isToPlugin(value: unknown): value is ToPlugin {
    return typeof value === 'object' && value !== null && (value as { event?: unknown }).event === 'testConnection';
}

export function isToInspector(value: unknown): value is ToInspector {
    const message = value as Partial<ToInspector> | null;
    return (
        typeof message === 'object' &&
        message !== null &&
        message.event === 'connection' &&
        typeof message.ok === 'boolean' &&
        typeof message.text === 'string'
    );
}
