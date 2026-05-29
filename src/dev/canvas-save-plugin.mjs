import { promises as fs } from 'node:fs';
import path from 'node:path';

/**
 * Dev-only Vite plugin: persists canvas drag-edits to per-page layout JSON.
 *
 * `apply: 'serve'` means it is mounted ONLY by the dev server — it is never part
 * of a production build, so the save endpoint cannot exist after deploy.
 *
 * POST /__canvas/save  { page, id, breakpoint, patch: { x, y, rotate } }
 *   → merges patch into src/data/layouts/<page>.json at data[id][breakpoint].
 *
 * Hardening (the dev server can be exposed over a public tunnel via
 * `allowedHosts`, so this write endpoint is treated as reachable):
 *   - localhost-only: reject unless Host is 127.0.0.1 / ::1 / localhost
 *   - same-origin only: reject cross-origin Origin/Referer (CSRF)
 *   - require Content-Type: application/json, cap body size
 *   - key allowlist + prototype-pollution guard on page/id/breakpoint
 */
const SAFE = /^[a-z0-9-]+$/i;
const BREAKPOINTS = new Set(['desktop', 'tablet', 'mobile']);
const RESERVED = new Set(['__proto__', 'prototype', 'constructor']);
const MAX_BODY = 4096; // a layout patch is a few small numbers

const hostname = (hostHeader) => String(hostHeader ?? '').split(':')[0].replace(/^\[|\]$/g, '');
const isLocalHost = (h) => h === 'localhost' || h === '127.0.0.1' || h === '::1';

function sameOrigin(req) {
  const host = req.headers.host;
  const src = req.headers.origin || req.headers.referer;
  if (!src) return true; // non-browser client (curl/editor fetch sets Origin in browsers)
  try {
    return new URL(src).host === host;
  } catch {
    return false;
  }
}

const safeKey = (k) => typeof k === 'string' && SAFE.test(k) && !RESERVED.has(k.toLowerCase());

export function canvasSavePlugin() {
  return {
    name: 'canvas-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__canvas/save', (req, res, next) => {
        if (req.method !== 'POST') return next();

        const deny = (code, msg) => {
          res.statusCode = code;
          res.end(msg);
        };

        // Reachability guards: localhost host + same-origin + JSON content-type.
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
            const { page, id, breakpoint, patch } = JSON.parse(body || '{}');
            if (!safeKey(page) || !safeKey(id) || !BREAKPOINTS.has(breakpoint)) {
              return deny(400, 'invalid payload');
            }
            const clean = {};
            for (const k of ['x', 'y', 'rotate', 'z', 'w']) {
              if (typeof patch?.[k] === 'number' && Number.isFinite(patch[k])) clean[k] = patch[k];
            }
            const dir = path.resolve('src/data/layouts');
            await fs.mkdir(dir, { recursive: true });
            const file = path.join(dir, `${page}.json`);

            // Read existing into a null-prototype object so reserved keys that
            // somehow exist on disk can't poison lookups.
            let data = Object.create(null);
            try {
              data = Object.assign(Object.create(null), JSON.parse(await fs.readFile(file, 'utf8')));
            } catch {
              /* first write for this page */
            }
            const entry = Object.assign(Object.create(null), data[id]);
            entry[breakpoint] = { ...entry[breakpoint], ...clean };
            data[id] = entry;

            await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n');
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
