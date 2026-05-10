import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';

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
    server: { fs: { strict: false }, allowedHosts: ['.trycloudflare.com'] },
  },
});
