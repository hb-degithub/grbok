import { defineConfig } from 'vitest/config';

// Vitest 配置 —— 复用 Astro 的 Vite 配置，确保 path alias 与 JSX 一致。
// 依赖：npm i -D vitest jsdom
export default defineConfig({
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['src/**/*.test.{ts,tsx}'],
    // 强制测试进程使用 React 的开发构建：act 仅存在于 development/test 构建。
    // 若调用方 shell 带着 NODE_ENV=production（例如从生产模式 Node 服务派生的
    // 终端/agent 环境继承），react 会加载不含 act 的生产 CJS 构建，导致
    // @testing-library/react 全部报 "React.act is not a function"。
    // 测试不应依赖调用方 shell 的 NODE_ENV，这里固定为 test。
    env: {
      NODE_ENV: 'test',
    },
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
