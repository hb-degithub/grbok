// @ts-check
import { defineConfig } from 'astro/config';

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

  vite: {
    plugins: [tailwindcss(), buildStampPlugin()],
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