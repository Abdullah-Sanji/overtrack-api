import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  test: {
    globals: false,
    include: ['src/**/*.spec.ts', 'test/**/*.spec.ts'],
    environment: 'node',
    hookTimeout: 120_000,
    testTimeout: 30_000,
    fileParallelism: false,
    alias: { '@': path.resolve(__dirname, 'src') },
  },
  plugins: [swc.vite({ jsc: { transform: { legacyDecorator: true, decoratorMetadata: true } } })],
});
