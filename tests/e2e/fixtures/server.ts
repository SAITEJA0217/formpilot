/**
 * Local test server for end-to-end runs.
 *
 * Serves on 127.0.0.1:3000 because that is the origin the shipped manifest already trusts
 * (`host_permissions` + the dashboard-sync content script). Using the real trusted origin
 * means the run exercises the real permission and sync paths instead of a relaxed build.
 *
 * It also answers the two API endpoints the extension calls. The AI endpoint is an
 * explicitly labelled **deterministic stub**: it proves the request/response plumbing,
 * the batching, and the merge path. It says nothing about model quality, and no result
 * derived from it is reported as a model evaluation.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../../..');

/** Directories served, in order, as siblings under the document root. */
const MOUNTS: { prefix: string; dir: string }[] = [
  { prefix: '/test-forms', dir: path.join(ROOT, 'frontend/public/test-forms') },
  { prefix: '/pages', dir: path.join(ROOT, 'tests/e2e/pages') },
];

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.map': 'application/json; charset=utf-8',
};

export interface AiCallRecord {
  at: number;
  fieldIds: string[];
  modes: string[];
  /** Whether the request used the v2 `fields` shape or the legacy `questions` shape. */
  shape: 'v2' | 'legacy' | 'unknown';
}

export interface TestServer {
  server: Server;
  origin: string;
  /** Every request the extension made to the stub AI endpoint, in order. */
  aiCalls: AiCallRecord[];
  /** Answers the stub will return, keyed by field id. Set per test. */
  stubAnswers: Map<string, string | string[] | null>;
  close(): Promise<void>;
}

interface AiField {
  fieldId: string;
  label?: string;
  mode?: string;
  options?: { label: string; value: string }[];
}

function send(res: ServerResponse, status: number, body: string | Buffer, type: string): void {
  res.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    // The extension's service worker sends an Origin of chrome-extension://<id>.
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  });
  res.end(body);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<boolean> {
  for (const mount of MOUNTS) {
    if (!pathname.startsWith(`${mount.prefix}/`)) continue;
    const relative = pathname.slice(mount.prefix.length + 1);
    // Reject traversal outright rather than normalizing it away.
    if (relative.includes('..')) return false;
    const file = path.join(mount.dir, relative);
    try {
      const info = await stat(file);
      if (!info.isFile()) return false;
      const body = await readFile(file);
      send(res, 200, body, MIME[path.extname(file)] ?? 'application/octet-stream');
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export async function startTestServer(port = 3000): Promise<TestServer> {
  const aiCalls: AiCallRecord[] = [];
  const stubAnswers = new Map<string, string | string[] | null>();

  const server = createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      const pathname = url.pathname;

      if (req.method === 'OPTIONS') {
        send(res, 204, '', 'text/plain');
        return;
      }

      // ── Stub AI endpoint ────────────────────────────────────────────────────
      if (pathname === '/api/ai/generate' && req.method === 'POST') {
        const raw = await readBody(req);
        let parsed: { fields?: AiField[]; questions?: unknown[] } = {};
        try {
          parsed = JSON.parse(raw);
        } catch {
          send(res, 400, JSON.stringify({ error: 'bad json' }), MIME['.json']);
          return;
        }
        const fields = parsed.fields ?? [];
        aiCalls.push({
          at: Date.now(),
          fieldIds: fields.map((f) => f.fieldId),
          modes: fields.map((f) => f.mode ?? 'unknown'),
          shape: parsed.fields ? 'v2' : parsed.questions ? 'legacy' : 'unknown',
        });

        const answers = fields.map((field) => {
          const override = stubAnswers.has(field.fieldId) ? stubAnswers.get(field.fieldId) : undefined;
          const value =
            override !== undefined
              ? override
              : field.options && field.options.length > 0
                ? field.options[0].label
                : `[stub answer for ${field.label ?? field.fieldId}]`;
          return {
            fieldId: field.fieldId,
            value,
            confidence: 80,
            explanation: 'Deterministic test stub — not a model.',
          };
        });
        send(res, 200, JSON.stringify({ answers, model: 'test-stub', provider: 'stub' }), MIME['.json']);
        return;
      }

      if (pathname === '/api/ai/corrections') {
        if (req.method === 'GET') {
          send(res, 200, JSON.stringify({ corrections: [] }), MIME['.json']);
          return;
        }
        send(res, 200, JSON.stringify({ success: true, type: 'phrasing-level' }), MIME['.json']);
        return;
      }

      // ── Instrumentation the specs read ──────────────────────────────────────
      if (pathname === '/__ai-calls') {
        send(res, 200, JSON.stringify(aiCalls), MIME['.json']);
        return;
      }

      if (await serveStatic(pathname, res)) return;

      send(res, 404, `not found: ${pathname}`, 'text/plain; charset=utf-8');
    })().catch((error: unknown) => {
      send(res, 500, String(error), 'text/plain; charset=utf-8');
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });

  return {
    server,
    origin: `http://127.0.0.1:${port}`,
    aiCalls,
    stubAnswers,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
