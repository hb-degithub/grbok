// @ts-check
import { defineConfig } from 'astro/config';
import { loadEnv } from 'vite';
import node from '@astrojs/node';

import tailwindcss from '@tailwindcss/vite';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';

// Vite plugin to inject a build timestamp into JS modules at transform stage,
// forcing content hash changes so CDN caches are invalidated.
function buildStampPlugin() {
  const stamp = `/* _bs:${Date.now()} */`;
  return {
    name: 'build-stamp',
    /**
     * @param {string} code
     * @param {string} id
     */
    transform(code, id) {
      if (id.endsWith('.ts') || id.endsWith('.tsx') || id.endsWith('.js') || id.endsWith('.jsx')) {
        return stamp + '\n' + code;
      }
      return null;
    },
  };
}

// .env 文件不会自动进入 process.env，必须显式 loadEnv：
// 2026-08-31 事故——生产构建时 .env.production 存在但本配置直读 process.env，
// 导致 site 回退 localhost:4321，canonical/OG/sitemap/feed 全站泄露开发地址。
// astro build 在加载本配置前会把 NODE_ENV 置为 production（dev 为 development）。
// 注意：本配置必须保持对象形式导出——函数形式 defineConfig(({command})=>...) 会导致
// 构建时适配器丢失（NoAdapterInstalled），2026-08-31 已实测踩坑。
const nodeEnv = process.env.NODE_ENV ?? 'development';
const env = loadEnv(nodeEnv, process.cwd(), '');
const site = process.env.PUBLIC_SITE_URL || env.PUBLIC_SITE_URL || 'http://localhost:4321';

// 防回归护栏：生产构建产物不允许携带 localhost 站点地址。
// 本地全量构建测试可显式设 ALLOW_LOCALHOST_SITE=1 跳过。
if (nodeEnv === 'production' && /localhost|127\.0\.0\.1/.test(site) && !process.env.ALLOW_LOCALHOST_SITE) {
  throw new Error(
    `[astro.config] 生产构建的 site 为 ${site}（localhost）。` +
      `请设置 PUBLIC_SITE_URL（见 astro/.env.production），或显式设 ALLOW_LOCALHOST_SITE=1 进行本地测试构建。`,
  );
}

// https://astro.build/config
export default defineConfig({
  site,
  output: 'server', // 启用SSR模式
  adapter: node({
    mode: 'standalone', // 独立模式，生成自包含的Node.js服务器
  }),

  vite: {
    plugins: [tailwindcss(), buildStampPlugin()],
    build: {
      // Split heavy vendor libraries into separate chunks so pages that don't use
      // them (every page except login/home) don't pay the download cost.
      // three+postprocessing (~700KB) only load on /login; ogl/gsap only on home.
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (!id.includes('node_modules')) return;
            if (/[\\/]node_modules[\\/](three|postprocessing)[\\/]/.test(id)) return 'three-vendor';
            if (/[\\/]node_modules[\\/]ogl[\\/]/.test(id)) return 'ogl-vendor';
            if (/[\\/]node_modules[\\/]gsap[\\/]/.test(id)) return 'gsap-vendor';
            if (/[\\/]node_modules[\\/]framer-motion[\\/]/.test(id)) return 'framer-vendor';
            if (/[\\/]node_modules[\\/]pocketbase[\\/]/.test(id)) return 'pocketbase-vendor';
            if (/[\\/]node_modules[\\/]echarts[\\/]/.test(id)) return 'echarts-vendor';
            if (/[\\/]node_modules[\\/]zrender[\\/]/.test(id)) return 'echarts-vendor';
          },
        },
      },
    },
  },

  integrations: [
    mdx(),
    sitemap({
      filter: (page) => {
        const url = new URL(page);
        return !['/admin/', '/login/', '/404/'].some((path) => url.pathname === path || url.pathname.startsWith(path));
      },
    }),
    react(),
  ],
});