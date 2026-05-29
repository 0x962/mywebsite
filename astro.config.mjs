import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { canvasSavePlugin } from './src/dev/canvas-save-plugin.mjs';

export default defineConfig({
  site: 'https://nvdk.co',
  integrations: [react(), mdx(), sitemap()],
  markdown: {
    shikiConfig: {
      theme: 'github-dark-default',
      wrap: false,
    },
  },
  vite: {
    plugins: [canvasSavePlugin()],
    server: { fs: { strict: false }, allowedHosts: ['.trycloudflare.com'] },
  },
});
