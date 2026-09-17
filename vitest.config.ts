import { defineConfig } from 'vitest/config';

// Tests live in a top-level tests/ folder mirroring src/, importing ../src/...
// Kept out of the build tsconfig so tsc only type-checks shippable code.
export default defineConfig({
    test: {
        include: ['./tests/**/*.test.ts'],
        // Two of these files launch the BUILT bundle in a child process and wait for it to
        // register over a socket. Vitest runs files in parallel, so a run can have several Node
        // processes starting at once on top of everything else, and the default five seconds is
        // not enough: the suite failed about two runs in five, always on whichever bundle test
        // happened to start first. This is generous on purpose, because FakeDeck's own timeout is
        // shorter and its message says what the plugin did say, which is the useful diagnosis.
        testTimeout: 20_000,
    },
});
