import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import sitemap from '@astrojs/sitemap';
import cloudflare from '@astrojs/cloudflare';
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
    // Only inject the shim into SSR chunks that actually reference
    // MessageChannel (i.e. the ones bundling React's server renderer).
    // Prepending to every client chunk too was putting statements before
    // `import` declarations in ESM modules — silently breaking them in the
    // browser, which is why client islands stopped hydrating. The shim is
    // wrapped in an IIFE so the leading non-import code is valid module text.
    generateBundle(_opts, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== 'chunk') continue;
        if (!chunk.code.includes('MessageChannel')) continue;
        chunk.code = `(()=>{${SHIM}})();\n${chunk.code}`;
      }
    },
  };
}

export default defineConfig({
  site: 'https://nvdk.co',
  // `server` = SSR by default with the Cloudflare adapter. Pages stay static when
  // they declare `export const prerender = true`. Required so /admin, /post/<slug>,
  // and the /api/* endpoints can read R2 at request time.
  output: 'server',
  adapter: cloudflare({
    platformProxy: { enabled: true, configPath: './wrangler.toml' },
  }),
  // Old canvas-post URLs redirect via public/_redirects (Pages-native rule —
  // Astro's `redirects` config emits a pattern that misses trailing slashes).
  integrations: [react(), sitemap()],
  vite: {
    plugins: [canvasSavePlugin(), messageChannelPolyfill()],
    resolve: {
      alias: [
        // SSR on Workers: react-dom/server.browser pulls in MessageChannel,
        // which the Workers runtime lacks. The .edge build is the same API
        // without the polyfill assumption.
        { find: 'react-dom/server.browser', replacement: 'react-dom/server.edge' },
      ],
      // Keeps react/react-dom resolving to a single ESM copy in the dev SSR
      // (workerd) environment — without it Vite loads the CJS server.node
      // build and dies on `require is not defined`.
      dedupe: ['react', 'react-dom'],
    },
    ssr: {
      // Bundle react-dom only for the Workers build (rollup's CJS plugin
      // handles its CJS entries there). In dev, leave it external so Node
      // loads the CJS build natively — Vite's ESM SSR runner can't execute
      // it ("require is not defined").
      noExternal: process.argv.includes('build') ? ['react-dom'] : [],
    },
    server: {
      fs: { strict: false },
      allowedHosts: ['.trycloudflare.com'],
    },
  },
});
