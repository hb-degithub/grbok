// @ts-check
import { defineConfig } from 'astro/config';

import tailwindcss from '@tailwindcss/vite';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import react from '@astrojs/react';

// https://astro.build/config
export default defineConfig({
  site: 'http://localhost:4321',

  vite: {
    plugins: [tailwindcss()],
  },

  integrations: [
    mdx(),
    sitemap(),
    react(), // 添加 React 支持
  ],
});
