// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';

import tailwindcss from '@tailwindcss/vite';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';

const site = process.env.PUBLIC_SITE_URL || 'http://localhost:4321';

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