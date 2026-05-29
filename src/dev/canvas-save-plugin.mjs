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
 */
const SAFE = /^[a-z0-9-]+$/i;
const BREAKPOINTS = new Set(['desktop', 'tablet', 'mobile']);

export function canvasSavePlugin() {
  return {
    name: 'canvas-save',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__canvas/save', (req, res, next) => {
        if (req.method !== 'POST') return next();
        let body = '';
        req.on('data', (c) => (body += c));
        req.on('end', async () => {
          try {
            const { page, id, breakpoint, patch } = JSON.parse(body || '{}');
            if (!SAFE.test(page) || !SAFE.test(id) || !BREAKPOINTS.has(breakpoint)) {
              res.statusCode = 400;
              return res.end('invalid payload');
            }
            const clean = {};
            for (const k of ['x', 'y', 'rotate', 'z', 'w']) {
              if (typeof patch?.[k] === 'number' && Number.isFinite(patch[k])) clean[k] = patch[k];
            }
            const dir = path.resolve('src/data/layouts');
            await fs.mkdir(dir, { recursive: true });
            const file = path.join(dir, `${page}.json`);
            let data = {};
            try {
              data = JSON.parse(await fs.readFile(file, 'utf8'));
            } catch {
              /* first write for this page */
            }
            data[id] ??= {};
            data[id][breakpoint] = { ...data[id][breakpoint], ...clean };
            await fs.writeFile(file, JSON.stringify(data, null, 2) + '\n');
            res.statusCode = 200;
            res.end('ok');
          } catch (err) {
            res.statusCode = 400;
            res.end(String(err));
          }
        });
      });
    },
  };
}
