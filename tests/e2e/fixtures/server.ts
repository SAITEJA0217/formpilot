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
  // Built by tests/e2e/apps/build.mjs; real React, Vue and Angular bundles.
  { prefix: '/apps', dir: path.join(ROOT, 'tests/e2e/apps/dist') },
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
  /**
   * Top-level keys of the `profile` object as it actually arrived.
   *
   * Recorded rather than the values, so a spec can assert data minimisation end to end —
   * that `documents` and the user's alternate personas never reached the endpoint — without
   * the test fixture holding a copy of anything sensitive.
   */
  profileKeys: string[];
  /** Keys of `profile.basicProfile` as it actually arrived. */
  basicProfileKeys: string[];
  /** Whether a page URL was included in the form context. */
  sentPageUrl: boolean;
  /** Field labels as they arrived. These are the form's questions, never the user's answers. */
  fieldLabels: string[];
}

export interface TestServer {
  server: Server;
  origin: string;
  /**
   * The same server seen from a different origin.
   *
   * `localhost` and `127.0.0.1` resolve to the same socket but are distinct origins, so a
   * frame loaded from here is subject to the real same-origin policy while still serving
   * the fixture content.
   */
  foreignOrigin: string;
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

/**
 * Labels for a generated form: a mix the ontology knows and a mix it does not, so matching
 * does real work at both ends. Kept in step with `research/performance/run.ts`.
 */
const GEN_KNOWN = [
  'Full Name', 'Email Address', 'Phone Number', 'Date of Birth', 'City', 'State',
  'PIN Code', 'Country', 'Current Company', 'Job Title', 'Highest Qualification',
  'College Name', 'Graduation Year', 'LinkedIn Profile', 'GitHub Profile',
];
const GEN_UNKNOWN = [
  'Referral code', 'Preferred interview slot', 'Favourite ice cream flavour',
  'Vehicle registration', 'Employee ID', 'Locker number', 'Badge colour',
];

/** A form with `count` labelled text inputs, sectioned every ten fields. */
function generateForm(count: number): string {
  const rows: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const pool = i % 3 !== 2 ? GEN_KNOWN : GEN_UNKNOWN;
    const suffix = i >= pool.length ? ` ${Math.floor(i / pool.length) + 1}` : '';
    if (i % 10 === 0) rows.push(`${i > 0 ? '</section>' : ''}<section><h2>Section ${i / 10 + 1}</h2>`);
    rows.push(`<label for="f${i}">${pool[i % pool.length]}${suffix}</label><input id="f${i}" name="f${i}" />`);
  }
  rows.push('</section>');
  return (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    `<title>Generated form (${count} fields)</title></head><body>` +
    `<h1>Generated form</h1><p>Local performance fixture, ${count} fields.</p>` +
    `<form>${rows.join('')}</form></body></html>`
  );
}

/** Where the Next.js dev server listens, and the prefix it serves everything under. */
const NEXT_ORIGIN = 'http://127.0.0.1:3100';
const NEXT_BASE_PATH = '/next';

/**
 * Forward a request to the Next dev server and stream the response back unchanged.
 *
 * Deliberately transparent: status, headers and body are passed through so hydration, HMR
 * polling and asset requests behave as they would against Next directly. The only thing that
 * changes is the origin the browser sees, which is the whole point.
 */
async function proxyToNext(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  const target = `${NEXT_ORIGIN}${url.pathname}${url.search}`;
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(req.headers)) {
    // Hop-by-hop and host headers must not be forwarded verbatim.
    if (key === 'host' || key === 'connection' || key === 'content-length') continue;
    if (typeof value === 'string') headers[key] = value;
  }
  const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : await readBody(req);

  try {
    const upstream = await fetch(target, { method: req.method, headers, body, redirect: 'manual' });
    const out: Record<string, string> = {};
    upstream.headers.forEach((value, key) => {
      if (key === 'content-encoding' || key === 'transfer-encoding' || key === 'content-length') return;
      out[key] = value;
    });
    res.writeHead(upstream.status, out);
    res.end(Buffer.from(await upstream.arrayBuffer()));
  } catch (error) {
    // A clear message beats a socket hang-up when the dev server is not up yet.
    send(
      res,
      502,
      `next dev unreachable at ${target}: ${error instanceof Error ? error.message : String(error)}`,
      'text/plain; charset=utf-8',
    );
  }
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
        let parsed: {
          fields?: AiField[];
          questions?: unknown[];
          profile?: Record<string, unknown>;
          formContext?: { url?: string };
        } = {};
        try {
          parsed = JSON.parse(raw);
        } catch {
          send(res, 400, JSON.stringify({ error: 'bad json' }), MIME['.json']);
          return;
        }
        const fields = parsed.fields ?? [];
        const profile = parsed.profile ?? {};
        const basic = profile.basicProfile;
        aiCalls.push({
          at: Date.now(),
          fieldIds: fields.map((f) => f.fieldId),
          modes: fields.map((f) => f.mode ?? 'unknown'),
          shape: parsed.fields ? 'v2' : parsed.questions ? 'legacy' : 'unknown',
          profileKeys: Object.keys(profile).sort(),
          basicProfileKeys:
            basic && typeof basic === 'object' ? Object.keys(basic as object).sort() : [],
          sentPageUrl: typeof parsed.formContext?.url === 'string' && parsed.formContext.url.length > 0,
          fieldLabels: fields.map((f) => f.label ?? ''),
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

      // ── Reverse proxy to the Next.js dev server ─────────────────────────────
      // Everything under /next is the real `next dev` server, served from this origin so the
      // extension can inject into it. See NEXT_BASE_PATH in playwright.config.ts for why.
      if (pathname === NEXT_BASE_PATH || pathname.startsWith(`${NEXT_BASE_PATH}/`)) {
        await proxyToNext(req, res, url);
        return;
      }

      // A form of any size, generated on demand, for the in-browser performance spec. The
      // same generator shape as research/performance/run.ts so the jsdom curve and the real
      // browser numbers describe the same pages.
      if (pathname === '/__generated-form') {
        const count = Math.min(1000, Math.max(1, Number(url.searchParams.get('fields') ?? '100')));
        send(res, 200, generateForm(count), MIME['.html']);
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
    // Bound to all interfaces, not just 127.0.0.1, so the same content is reachable as
    // `http://localhost:<port>` too. `localhost` and `127.0.0.1` are *different origins* to
    // the browser even though they are the same server, which is how the suite gets a
    // genuinely cross-origin iframe that actually loads. Pointing one at a real external
    // site would only prove that a blocked request fails.
    server.listen(port, '0.0.0.0', () => resolve());
  });

  return {
    server,
    origin: `http://127.0.0.1:${port}`,
    /** The same server under a different origin, for cross-origin isolation tests. */
    foreignOrigin: `http://localhost:${port}`,
    aiCalls,
    stubAnswers,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
