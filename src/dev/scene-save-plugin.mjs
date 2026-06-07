import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Dev-only Vite plugin: persists an Excalidraw scene to per-post scene JSON.
 *
 * `apply: 'serve'` → mounted ONLY by the dev server, never in a production build,
 * so the write endpoint cannot exist after deploy.
 *
 * POST /__canvas/scene  { slug, json }
 *   json = the string from Excalidraw's serializeAsJSON() (canonical persisted
 *   form: { type, version, source, elements, appState, files }).
 *   → writes src/data/scenes/<slug>.json (re-indented for diff-friendliness).
 *
 * Hardening mirrors canvas-save-plugin.mjs (the dev server can be exposed over a
 * public tunnel via allowedHosts, so this write endpoint is treated as reachable):
 *   - localhost-only host
 *   - same-origin only (CSRF)
 *   - require Content-Type: application/json, cap body size
 *   - slug allowlist + payload shape validation (must contain an elements array)
 */
const SAFE = /^[a-z0-9-]+$/i;
const MAX_BODY = 50 * 1024 * 1024; // scenes can embed images inline (files map)

const hostname = (hostHeader) => String(hostHeader ?? '').split(':')[0].replace(/^\[|\]$/g, '');
const isLocalHost = (h) => h === 'localhost' || h === '127.0.0.1' || h === '::1';

function sameOrigin(req) {
  const host = req.headers.host;
  const src = req.headers.origin || req.headers.referer;
  if (!src) return true; // non-browser client
  try {
    return new URL(src).host === host;
  } catch {
    return false;
  }
}

export function sceneSavePlugin() {
  return {
    name: 'scene-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__canvas/scene', (req, res, next) => {
        if (req.method !== 'POST') return next();

        const deny = (code, msg) => {
          res.statusCode = code;
          res.end(msg);
        };

        if (!isLocalHost(hostname(req.headers.host))) return deny(403, 'forbidden');
        if (!sameOrigin(req)) return deny(403, 'cross-origin denied');
        if (!String(req.headers['content-type'] || '').includes('application/json'))
          return deny(415, 'expected application/json');

        let body = '';
        let aborted = false;
        req.on('data', (c) => {
          if (aborted) return;
          body += c;
          if (body.length > MAX_BODY) {
            aborted = true;
            deny(413, 'payload too large');
            req.destroy();
          }
        });
        req.on('end', async () => {
          if (aborted) return;
          try {
            const { slug, json } = JSON.parse(body || '{}');
            if (typeof slug !== 'string' || !SAFE.test(slug)) return deny(400, 'invalid slug');
            if (typeof json !== 'string') return deny(400, 'invalid scene');

            const scene = JSON.parse(json);
            if (!scene || !Array.isArray(scene.elements)) return deny(400, 'scene missing elements');

            const dir = path.resolve('src/data/scenes');
            await fs.mkdir(dir, { recursive: true });
            const file = path.join(dir, `${slug}.json`);
            await fs.writeFile(file, JSON.stringify(scene, null, 2) + '\n');

            res.statusCode = 200;
            res.end('ok');
          } catch (err) {
            deny(400, String(err));
          }
        });
      });
    },
  };
}
