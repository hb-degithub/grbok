import { defineConfig } from 'vitest/config';

// Vitest 配置 —— 复用 Astro 的 Vite 配置，确保 path alias 与 JSX 一致。
// 依赖：npm i -D vitest jsdom
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/lib/**', 'src/hooks/**'],
    },
  },
  resolve: {
    alias: {
      // Astro 的 import.meta.env 在测试中需要 mock
    },
  },
});
