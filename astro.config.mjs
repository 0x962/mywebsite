import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';
import { fileURLToPath } from 'node:url';
import { canvasSavePlugin } from './src/dev/canvas-save-plugin.mjs';

/**
 * Workers runtime lacks `MessageChannel`, which React 19's SSR bundle calls
 * at module-init time (before any request handler runs). nodejs_compat
 * doesn't expose it as a global, so we prepend a tiny shim to every SSR
 * chunk. The shim is a no-op queue — React only uses it to schedule
 * microtasks, which is exactly what `queueMicrotask` already does.
 */
function messageChannelPolyfill() {
  const SHIM = `if (typeof MessageChannel === 'undefined') {
    globalThis.MessageChannel = class {
      constructor() {
        const listeners = [];
        const port = {
          postMessage(msg) { queueMicrotask(() => listeners.forEach(fn => fn({ data: msg }))); },
          addEventListener(_type, fn) { listeners.push(fn); },
          removeEventListener(_type, fn) {
            const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1);
          },
          start() {}, close() {},
        };
        this.port1 = port; this.port2 = port;
      }
    };
  }`;
  return {
    name: 'cf-message-channel-polyfill',
    apply: 'build',
    enforce: 'post',
    // Prepend to EVERY SSR chunk: imported chunks execute their top-level
    // before control returns to the entry, so polyfilling only the entry
    // is too late. The shim is idempotent (typeof guard).
    generateBundle(_opts, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === 'chunk') {
          chunk.code = SHIM + '\n' + chunk.code;
        }
      }
    },
  };
}

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
  // `server` = SSR by default with the Cloudflare adapter. Pages stay static when
  // they declare `export const prerender = true`. Required so /admin, /post/<slug>,
  // and the /api/* endpoints can read/write KV at request time.
  output: 'server',
  adapter: cloudflare({
    platformProxy: { enabled: true, configPath: './wrangler.toml' },
  }),
  integrations: [react(), mdx(), sitemap()],
  markdown: {
    shikiConfig: {
      theme: 'github-dark-default',
      wrap: false,
    },
  },
  vite: {
    plugins: [canvasSavePlugin(), messageChannelPolyfill()],
    resolve: {
      alias: [
        { find: '@excalidraw/excalidraw/index.css', replacement: `${excalidrawPkg}/${excalidrawDist}/index.css` },
        { find: /^@excalidraw\/excalidraw$/, replacement: `${excalidrawPkg}/${excalidrawDist}/index.js` },
        // SSR on Workers: react-dom/server.browser pulls in MessageChannel,
        // which the Workers runtime lacks. The .edge build is the same API
        // without the polyfill assumption.
        { find: 'react-dom/server.browser', replacement: 'react-dom/server.edge' },
      ],
      dedupe: ['react', 'react-dom'],
    },
    ssr: {
      noExternal: ['react-dom'],
    },
    server: {
      fs: { strict: false },
      allowedHosts: ['.trycloudflare.com'],
    },
  },
});
