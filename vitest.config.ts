import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // jsdom rather than happy-dom: the engine leans on ARIA IDREF resolution,
    // shadow roots and MutationObserver, and jsdom implements all three faithfully.
    environment: 'jsdom',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    restoreMocks: true,
    reporters: ['default'],
  },
});
