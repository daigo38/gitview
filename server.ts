import { Hono } from 'hono';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { serveStatic } from 'hono/bun';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import mime from 'mime';
import * as git from './git.ts';
import type { ScanConfig, RepoSummary } from './git.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface ServerConfig extends ScanConfig {
  port?: number;
}

interface FileListBody {
  files?: string[];
}

let config: ServerConfig;
const configPath = path.join(__dirname, 'config.json');
try {
  const raw = fs.readFileSync(configPath, 'utf-8');
  config = JSON.parse(raw) as ServerConfig;
} catch {
  console.warn(
    `[GitView] config.json not found at ${configPath}.\n` +
      `         Copy config.example.json to config.json and edit it.\n` +
      `         Starting with empty repo list.`,
  );
  config = { scanDirs: [], repos: [], port: 10001, ignoreDirs: [] };
}

const PORT = config.port ?? 10001;
const CLIENT_DIST = path.join(__dirname, 'client', 'dist');

// キャッシュ: 起動時に構築し、/api/repos/refresh で更新
let summaryCache: RepoSummary[] | null = null;
let repoPaths: string[] = [];
let isRefreshing = false;

async function buildCache(): Promise<void> {
  if (isRefreshing) return;
  isRefreshing = true;
  try {
    repoPaths = await git.scanRepos(config);
    const summaries = await Promise.all(
      repoPaths.map(r => git.getRepoSummary(r).catch((): null => null)),
    );
    summaryCache = summaries
      .filter((s): s is RepoSummary => s !== null)
      .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
  } finally {
    isRefreshing = false;
  }
}

// 起動時にバックグラウンドでキャッシュ構築
void buildCache();

function validateRepoId(id: string): string {
  const decoded = git.decodeId(id);
  if (!repoPaths.includes(decoded)) throw new Error('Unknown repository');
  return decoded;
}

function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function errorResponse(c: Context, e: unknown, fallback: ContentfulStatusCode = 500) {
  const msg = errorMessage(e);
  const status: ContentfulStatusCode = msg === 'Unknown repository' ? 403 : fallback;
  return c.json({ error: msg }, status);
}

async function readJsonBody<T>(c: Context, fallback: T): Promise<T> {
  try {
    return (await c.req.json()) as T;
  } catch {
    return fallback;
  }
}

const app = new Hono();

// 常にキャッシュから即返す
app.get('/api/repos', c => c.json(summaryCache ?? []));

// 更新: キャッシュを再構築して返す
app.post('/api/repos/refresh', async c => {
  await buildCache();
  return c.json(summaryCache ?? []);
});

app.get('/api/repos/:id', async c => {
  try {
    const repoPath = validateRepoId(c.req.param('id'));
    const detail = await git.getRepoDetail(repoPath);
    return c.json(detail);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/repos/:id/log', async c => {
  try {
    const repoPath = validateRepoId(c.req.param('id'));
    const countParam = c.req.query('count');
    const parsed = countParam ? parseInt(countParam, 10) : NaN;
    const count = Math.min(Number.isFinite(parsed) ? parsed : 30, 100);
    const log = await git.getLog(repoPath, count);
    return c.json(log);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/repos/:id/tree', async c => {
  try {
    const repoPath = validateRepoId(c.req.param('id'));
    const subPath = c.req.query('path') ?? '';
    const tree = await git.getFileTree(repoPath, subPath, config.ignoreDirs ?? []);
    return c.json(tree);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/repos/:id/file', async c => {
  try {
    const repoPath = validateRepoId(c.req.param('id'));
    const filePath = c.req.query('path') ?? '';
    if (!filePath) return c.json({ error: 'path required' }, 400);
    const content = await git.getFileContent(repoPath, filePath);
    return c.json(content);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/repos/:id/raw', async c => {
  try {
    const repoPath = validateRepoId(c.req.param('id'));
    const filePath = c.req.query('path') ?? '';
    if (!filePath) return c.json({ error: 'path required' }, 400);

    const fullPath = git.validatePathPublic(repoPath, filePath);
    const stat = await fs.promises.stat(fullPath);
    const total = stat.size;
    const mimeType = mime.getType(fullPath) ?? 'application/octet-stream';
    const range = c.req.header('range');
    const file = Bun.file(fullPath);

    if (range) {
      const [startStr, endStr] = range.replace(/bytes=/, '').split('-');
      const start = parseInt(startStr ?? '0', 10);
      const end = endStr
        ? parseInt(endStr, 10)
        : Math.min(start + 1024 * 1024 - 1, total - 1);
      return new Response(file.slice(start, end + 1), {
        status: 206,
        headers: {
          'Content-Range': `bytes ${start}-${end}/${total}`,
          'Accept-Ranges': 'bytes',
          'Content-Length': String(end - start + 1),
          'Content-Type': mimeType,
        },
      });
    }

    return new Response(file, {
      status: 200,
      headers: {
        'Content-Length': String(total),
        'Content-Type': mimeType,
        'Accept-Ranges': 'bytes',
      },
    });
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/repos/:id/diff', async c => {
  try {
    const repoPath = validateRepoId(c.req.param('id'));
    const filePath = c.req.query('path') ?? '';
    const staged = c.req.query('staged') === 'true';
    const diff = await git.getDiff(repoPath, filePath, staged);
    return c.json({ diff });
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.get('/api/repos/:id/commits/:hash', async c => {
  try {
    const repoPath = validateRepoId(c.req.param('id'));
    const hash = c.req.param('hash');
    if (!/^[0-9a-f]{4,64}$/i.test(hash)) return c.json({ error: 'Invalid hash' }, 400);
    const detail = await git.getCommitDetail(repoPath, hash);
    return c.json(detail);
  } catch (e) {
    return errorResponse(c, e);
  }
});

app.post('/api/repos/:id/stage', async c => {
  try {
    const repoPath = validateRepoId(c.req.param('id'));
    const body = await readJsonBody<FileListBody>(c, {});
    await git.stageFiles(repoPath, body.files);
    return c.json(await git.getRepoDetail(repoPath));
  } catch (e) {
    return errorResponse(c, e, 400);
  }
});

app.post('/api/repos/:id/unstage', async c => {
  try {
    const repoPath = validateRepoId(c.req.param('id'));
    const body = await readJsonBody<FileListBody>(c, {});
    await git.unstageFiles(repoPath, body.files);
    return c.json(await git.getRepoDetail(repoPath));
  } catch (e) {
    return errorResponse(c, e, 400);
  }
});

app.post('/api/repos/:id/discard', async c => {
  try {
    const repoPath = validateRepoId(c.req.param('id'));
    const body = await readJsonBody<FileListBody>(c, {});
    await git.discardFiles(repoPath, body.files);
    return c.json(await git.getRepoDetail(repoPath));
  } catch (e) {
    return errorResponse(c, e, 400);
  }
});

app.post('/api/repos/:id/clean', async c => {
  try {
    const repoPath = validateRepoId(c.req.param('id'));
    const body = await readJsonBody<FileListBody>(c, {});
    await git.cleanFiles(repoPath, body.files);
    return c.json(await git.getRepoDetail(repoPath));
  } catch (e) {
    return errorResponse(c, e, 400);
  }
});

// 静的配信 + SPAフォールバック
if (fs.existsSync(CLIENT_DIST)) {
  app.use('/*', serveStatic({ root: './client/dist' }));
  app.get('*', c => {
    if (c.req.path.startsWith('/api')) return c.notFound();
    const indexPath = path.join(CLIENT_DIST, 'index.html');
    return new Response(Bun.file(indexPath), {
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  });
} else {
  app.get('/', c => c.html('<h2>GitView: client not built yet. Run <code>cd client && bun install && bun run build</code></h2>'));
}

Bun.serve({
  port: PORT,
  hostname: '127.0.0.1',
  fetch: app.fetch,
});
console.log(`\nGitView started on http://localhost:${PORT}`);
console.log('Use `tailscale serve` for tailnet HTTPS access.\n');
