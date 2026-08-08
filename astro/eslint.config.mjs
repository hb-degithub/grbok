// @ts-check
// 项目级 ESLint 扁平配置（Flat Config，ESLint 9）
// 基于 typescript-eslint 推荐规则，并针对 Astro 项目做必要宽松处理。
import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  {
    ignores: [
      // 构建产物与生成目录
      'dist/**',
      '.astro/**',
      'node_modules/**',
      // 临时目录与日志
      'tmp*/**',
      '*.log',
      // 运维/工具脚本（本地运行，不参与质量门禁）
      'scripts/**',
      // 静态资源
      'public/**',
    ],
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // React Hooks 经典规则（rules-of-hooks 强制，exhaustive-deps 告警避免存量阻塞）
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // 全局宽松项：本项目含 Astro 特有代码、动态数据流与三方接口，放宽部分规则
    rules: {
      // 允许显式 any（部分三方 SDK / 动态数据场景）
      '@typescript-eslint/no-explicit-any': 'off',
      // 未使用变量仅告警，不阻断（避免脚手架/模板代码误伤）
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      // TypeScript 环境下由编译器负责未定义变量检查
      'no-undef': 'off',
      // Astro/React 组件中常见空 catch 或空分支
      'no-empty': 'off',
      // 安全/消毒代码需要匹配控制字符（如 \x00-\x1f）
      'no-control-regex': 'off',
    },
  },
  {
    // 根级配置文件、工具脚本与测试文件：允许 console 输出与 CJS require 等运行时行为
    files: [
      'astro.config.mjs',
      'vitest.config.ts',
      'jsrepo.config.ts',
      'pw-screenshot.cjs',
      'test/**/*.{ts,mjs}',
      'e2e/**/*.ts',
    ],
    rules: {
      'no-console': 'off',
      '@typescript-eslint/no-require-imports': 'off',
    },
  },
);
