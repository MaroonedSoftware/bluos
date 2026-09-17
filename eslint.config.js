import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/** The Node globals the plain-JavaScript tools use. TypeScript gets these from @types/node instead. */
const nodeGlobals = { AbortSignal: 'readonly', Buffer: 'readonly', URL: 'readonly', console: 'readonly', fetch: 'readonly', process: 'readonly' };

export default tseslint.config(
    // The built bundle, the built panel script and the packed installer are outputs, not source.
    { ignores: ['com.maroonedsoftware.bluos.sdPlugin/**', 'artifacts/**', 'node_modules/**'] },
    js.configs.recommended,
    ...tseslint.configs.recommended,
    {
        rules: {
            '@typescript-eslint/consistent-type-imports': 'error',
            // A leading underscore means "deliberately discarded", which covers a rest-destructure
            // that drops a field as much as it covers an unused argument.
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', ignoreRestSiblings: true }],
        },
    },
    // The generators in tools/ are plain ES modules run by `node`, not part of the bundle.
    {
        files: ['tools/**/*.mjs'],
        languageOptions: { globals: nodeGlobals },
    },
);
