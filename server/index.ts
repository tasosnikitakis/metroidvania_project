/**
 * Game server.
 *  - Serves the built client (dist/) in production.
 *  - Content API: JSON files under CONTENT_DIR (default ./content).
 *
 * Environment:
 *  PORT          port to listen on (Railway sets this)        default 3001 dev / 3000 prod
 *  CONTENT_DIR   where content JSON lives. Point this at a Railway volume
 *                (e.g. /data/content) to keep editor changes across deploys.
 *                On first boot an empty CONTENT_DIR is seeded from ./content.
 *  EDITOR_TOKEN  password required to save from the editors in production.
 *                If unset in production, the editors are read-only.
 */
import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import { promises as fs, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROD = process.env.NODE_ENV === 'production';
const PORT = Number(process.env.PORT ?? (PROD ? 3000 : 3001));
const BUNDLED_CONTENT = path.join(ROOT, 'content');
const CONTENT_DIR = path.resolve(process.env.CONTENT_DIR ?? BUNDLED_CONTENT);
const EDITOR_TOKEN = process.env.EDITOR_TOKEN ?? '';
const DIST = path.join(ROOT, 'dist');

const app = Fastify({ logger: { level: PROD ? 'info' : 'warn' }, bodyLimit: 20 * 1024 * 1024 });

function canWrite(token: unknown): boolean {
  if (!PROD) return true;
  return EDITOR_TOKEN !== '' && token === EDITOR_TOKEN;
}

/** Resolve a request path safely inside CONTENT_DIR; only .json files allowed. */
function resolveContent(rel: string): string | null {
  if (!/^[\w\-./]+\.json$/.test(rel) || rel.includes('..')) return null;
  const full = path.resolve(CONTENT_DIR, rel);
  if (!full.startsWith(CONTENT_DIR + path.sep)) return null;
  return full;
}

async function listJson(dir: string, prefix = ''): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(await listJson(path.join(dir, entry.name), rel)));
    else if (entry.name.endsWith('.json')) out.push(rel);
  }
  return out.sort();
}

async function seedContent(): Promise<void> {
  if (CONTENT_DIR === BUNDLED_CONTENT) return;
  await fs.mkdir(CONTENT_DIR, { recursive: true });
  // Copy any bundled file that does not exist yet (never overwrites edits).
  for (const rel of await listJson(BUNDLED_CONTENT)) {
    const dest = path.join(CONTENT_DIR, rel);
    if (!existsSync(dest)) {
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.copyFile(path.join(BUNDLED_CONTENT, rel), dest);
    }
  }
}

app.get('/api/health', async () => ({ ok: true }));

app.get('/api/content', async (req) => ({
  files: await listJson(CONTENT_DIR),
  writable: canWrite(req.headers['x-editor-token']),
}));

app.get('/api/content/*', async (req, reply) => {
  const file = resolveContent((req.params as { '*': string })['*']);
  if (!file) return reply.code(400).send({ error: 'bad path' });
  try {
    const text = await fs.readFile(file, 'utf8');
    return reply.header('cache-control', 'no-store').type('application/json').send(text);
  } catch {
    return reply.code(404).send({ error: 'not found' });
  }
});

app.put('/api/content/*', async (req, reply) => {
  if (!canWrite(req.headers['x-editor-token'])) return reply.code(403).send({ error: 'read-only' });
  const file = resolveContent((req.params as { '*': string })['*']);
  if (!file) return reply.code(400).send({ error: 'bad path' });
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(req.body, null, 2) + '\n', 'utf8');
  await fs.rename(tmp, file);
  return { ok: true };
});

app.delete('/api/content/*', async (req, reply) => {
  if (!canWrite(req.headers['x-editor-token'])) return reply.code(403).send({ error: 'read-only' });
  const file = resolveContent((req.params as { '*': string })['*']);
  if (!file) return reply.code(400).send({ error: 'bad path' });
  await fs.rm(file, { force: true });
  return { ok: true };
});

if (existsSync(DIST)) {
  await app.register(fastifyStatic, {
    root: DIST,
    setHeaders(reply, filePath) {
      // Hashed build assets can be cached forever; everything else revalidates.
      // (@fastify/static v10 passes the Fastify reply here, so it is .header(), not .setHeader().)
      const immutable = filePath.includes(`${path.sep}assets${path.sep}`) && /-[\w-]{8,}\.\w+$/.test(filePath);
      reply.header('cache-control', immutable ? 'public, max-age=31536000, immutable' : 'no-cache');
    },
  });
} else if (PROD) {
  app.log.warn('dist/ not found - run "npm run build" first');
}

await seedContent();
await app.listen({ port: PORT, host: '0.0.0.0' });
console.log(`[server] http://localhost:${PORT}  content: ${CONTENT_DIR}  ${PROD ? 'production' : 'dev'}`);
