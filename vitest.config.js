import { defineConfig } from 'vitest/config';

export default defineConfig({
  // This codebase's React components live in plain .js files (Next.js's
  // own SWC-based build handles that fine), but Vite's default esbuild
  // transform only parses JSX in .jsx/.tsx files. Telling esbuild to treat
  // every .js as 'jsx' (automatic runtime, matching Next 15's default — no
  // `import React` needed in scope) lets component test files import real
  // page/component modules directly — harmless for every existing
  // non-component .js file too, since the jsx loader is a strict superset
  // of plain JS syntax.
  esbuild: {
    loader: 'jsx',
    include: /\.js$/,
    // Vite's esbuild plugin defaults `exclude` to /\.js$/ whenever it's
    // left unset — meaning setting only `include` above still silently
    // excludes every .js file via that default, undoing it. Overriding
    // exclude to match nothing is what actually makes `include` take effect.
    exclude: [],
    jsx: 'automatic',
  },
  test: {
    environment: 'node',
    setupFiles: ['./vitest.setup.js'],
    include: ['**/*.test.js'],
    exclude: ['node_modules/**', '.next/**'],
  },
});
