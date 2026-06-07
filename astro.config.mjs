import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import { fileURLToPath } from 'node:url';
import { canvasSavePlugin } from './src/dev/canvas-save-plugin.mjs';
import { sceneSavePlugin } from './src/dev/scene-save-plugin.mjs';

// We consume Excalidraw built from source in the vendored submodule. We alias the
// entry + its CSS straight at the built files; the entry's own imports of the
// sibling workspace packages (@excalidraw/common|element|math) and third-party
// deps then resolve via realpath from vendor/excalidraw/node_modules — so the
// whole graph is from-source. `dedupe` forces a single React instance shared
// between the Astro island and Excalidraw (two copies break hooks/context).
const excalidrawPkg = fileURLToPath(
  new URL('./vendor/excalidraw/packages/excalidraw', import.meta.url),
);
// `astro build` (incl. `npm run deploy`) → prod bundle; `astro dev` → dev bundle.
// Keyed off the CLI command, which is reliable at config-eval time (NODE_ENV isn't).
const excalidrawDist = process.argv.includes('build') ? 'dist/prod' : 'dist/dev';

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
    plugins: [canvasSavePlugin(), sceneSavePlugin()],
    resolve: {
      alias: [
        { find: '@excalidraw/excalidraw/index.css', replacement: `${excalidrawPkg}/${excalidrawDist}/index.css` },
        { find: /^@excalidraw\/excalidraw$/, replacement: `${excalidrawPkg}/${excalidrawDist}/index.js` },
      ],
      dedupe: ['react', 'react-dom'],
    },
    server: { fs: { strict: false }, allowedHosts: ['.trycloudflare.com'] },
  },
});
