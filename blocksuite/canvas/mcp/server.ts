// Canvas MCP server: lets a chat (Claude Desktop, Claude Code, or any MCP client) read the user's board
// and put material on it, the way Figma's MCP lets Claude work in a Figma file.
//
// One small program on the user's own computer, started by the chat app:
//   · speaks MCP to the chat over stdio;
//   · serves the canvas app at http://127.0.0.1:7357 (the board itself lives in that browser tab);
//   · holds a local WebSocket the open board connects to, and passes each request to it.
// If a second chat app starts its own copy, that copy hands its requests to the first one (relay).
// Nothing leaves the computer: the server only listens on 127.0.0.1.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { PARTS } from '../src/ai/grammar';

const PORT = Number(process.env.CANVAS_PORT || 7357);
const URL_ = `http://127.0.0.1:${PORT}/`;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = process.env.CANVAS_APP_DIR || path.join(HERE, 'app');
const log = (...a: any[]) => console.error('[canvas-mcp]', ...a);    // stdout belongs to MCP

// ---------------------------------------------------------------- the link to the board
type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: NodeJS.Timeout };
let boards: WebSocket[] = [];            // open board tabs, newest last
let upstream: WebSocket | null = null;   // when another copy owns the port
const pending = new Map<string, Pending>();
let seq = 0;

function send(op: string, args: any = {}, timeoutMs = 60000): Promise<any> {
  const id = `${process.pid}-${++seq}`;
  const target = upstream ?? boards[boards.length - 1];
  if (!target || target.readyState !== WebSocket.OPEN) return Promise.reject(new Error('no-board'));
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error('The board did not answer in time.')); }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    target.send(JSON.stringify({ id, op, args }));
  });
}
function settle(msg: any) {
  const p = pending.get(msg?.id); if (!p) return false;
  clearTimeout(p.timer); pending.delete(msg.id);
  msg.ok ? p.resolve(msg.result) : p.reject(new Error(msg.error || 'The board could not do that.'));
  return true;
}

const MIME: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.wasm': 'application/wasm', '.ico': 'image/x-icon' };

// ---------------------------------------------------------------- Claude for the board
// The user's own Anthropic key, kept in a file next to the app (or ANTHROPIC_API_KEY). The page never sees it:
// it posts to /__claude/v1/messages and this server forwards the call to Anthropic.
function claudeKey(): string | null {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY.trim();
  for (const f of [path.join(HERE, 'claude-key.txt'), path.join(HERE, '..', 'claude-key.txt')]) {
    try { const k = fs.readFileSync(f, 'utf8').trim(); if (k) return k; } catch { /* not there */ }
  }
  return null;
}
async function claude(req: http.IncomingMessage, res: http.ServerResponse, u: URL) {
  // only the board itself may use it: same origin, and a header a plain cross-site form cannot send
  const origin = String(req.headers.origin || '');
  const own = origin === `http://127.0.0.1:${PORT}` || origin === `http://localhost:${PORT}`;
  if (u.pathname === '/__claude') { res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: !!claudeKey() })); return; }
  if (req.method !== 'POST' || !own || req.headers['x-canvas'] !== 'claude') { res.writeHead(403).end(); return; }
  const key = claudeKey(); if (!key) { res.writeHead(401).end('no key'); return; }
  const chunks: Buffer[] = []; for await (const c of req) chunks.push(c as Buffer);
  try {
    const r = await fetch('https://api.anthropic.com' + u.pathname.slice('/__claude'.length), {
      method: 'POST', body: Buffer.concat(chunks),
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
    });
    res.writeHead(r.status, { 'content-type': r.headers.get('content-type') || 'application/json' }).end(Buffer.from(await r.arrayBuffer()));
  } catch (e: any) { res.writeHead(502).end(String(e?.message || e)); }
}

// ---------------------------------------------------------------- pictures for the board
// The board asks for a drawing or a photo it can put down ("a section of the Pantheon"): this server looks it up in
// Wikimedia Commons (free pictures with their source and licence) and hands back the picture itself, so the page
// never needs another site's permission to show it. Only the board may ask (same origin, own header).
const UA = 'CanvasAsThePrompt/1.0 (thesis prototype; https://github.com/zhitaoyu-lgtm/canvas-as-the-prompt)';
const ownPage = (req: http.IncomingMessage) => { const o = String(req.headers.origin || req.headers.referer || ''); return /^https?:\/\/(127\.0\.0\.1|localhost):\d+/.test(o) && req.headers['x-canvas'] === 'picture'; };
const strip = (v: any) => String(v ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
// Picture archives title drawings in many languages and rank photos first; so several searches are made (the
// words as given; the subject with the kind of drawing in other languages) and drawings of the asked kind come first.
const KINDS: [RegExp, string[]][] = [
  [/\b(cross[- ]?)?sections?\b|剖面|断面|cutaway/i, ['section', 'sección', 'schnitt', 'coupe', 'sezione', 'cross-section']],
  [/\bfloor ?plans?\b|\bground ?plans?\b|\bplans?\b|平面/i, ['plan', 'plano', 'grundriss', 'pianta', 'floor plan']],
  [/\belevations?\b|立面/i, ['elevation', 'alzado', 'ansicht', 'prospetto']],
  [/\bdetails?\b|节点|细部/i, ['detail', 'detalle']],
  [/\baxonometr\w*|\bisometr\w*|轴测/i, ['axonometric', 'isometric']],
];
const FILLER = /\b(drawing|drawings|photo|photos|picture|image|of|the|a|an|cross|line|architectural|diagram|view)\b/gi;
async function commons(q: string): Promise<any[]> {
  const api = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ action: 'query', format: 'json', generator: 'search', gsrnamespace: '6', gsrlimit: '15', gsrsearch: q + ' filetype:bitmap',
    prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: '1600', origin: '*' });
  const r = await fetch(api, { headers: { 'user-agent': UA }, signal: AbortSignal.timeout(12000) });
  const j: any = await r.json();
  return (Object.values(j?.query?.pages ?? {}) as any[]).sort((a, b) => (a.index ?? 0) - (b.index ?? 0)).map(p => { const ii = p.imageinfo?.[0] ?? {}, m = ii.extmetadata ?? {}; return {
    file: String(p.title || ''), title: strip(m.ObjectName?.value) || String(p.title || '').replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''),
    url: ii.thumburl || ii.url, page: ii.descriptionurl, w: ii.width, h: ii.height, mime: ii.mime,
    author: strip(m.Artist?.value).slice(0, 80), licence: strip(m.LicenseShortName?.value), what: strip(m.ImageDescription?.value).slice(0, 300), cats: strip(m.Categories?.value).slice(0, 300) }; });
}
async function pictures(req: http.IncomingMessage, res: http.ServerResponse, u: URL) {
  if (!ownPage(req)) { res.writeHead(403).end(); return; }
  const q = (u.searchParams.get('q') || '').slice(0, 200).trim(); if (!q) { res.writeHead(400).end(); return; }
  try {
    const kind = KINDS.find(([re]) => re.test(q)), subject = q.replace(kind ? kind[0] : /$^/, ' ').replace(FILLER, ' ').replace(/\s+/g, ' ').trim();
    const queries = [q, ...(kind ? kind[1].map(w => `${subject} ${w}`) : [subject])].filter((v, i, a) => v && a.indexOf(v) === i).slice(0, 6);
    const lists = await Promise.all(queries.map(x => commons(x).catch(() => [])));
    const seen = new Set<string>(), all: any[] = [];
    lists.forEach((l, qi) => l.forEach((c, ri) => { if (!seen.has(c.file)) { seen.add(c.file); all.push({ ...c, rank: qi * 0.5 + ri * 0.15 }); } }));
    const words = subject.toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const score = (c: any) => {
      const t = `${c.file} ${c.title} ${c.what} ${c.cats}`.toLowerCase();
      let s = -c.rank;
      if (kind && kind[1].some(w => t.includes(w.toLowerCase()))) s += 6;              // a drawing of the kind asked for
      if (kind && /photograph|photo\b|\bp\d{6,}|img_\d|dsc_?\d/i.test(t)) s -= 3;     // a snapshot, when a drawing was asked for
      s += words.filter(w => t.includes(w)).length;
      return s;
    };
    const out = all.filter(c => c.url && /image\/(jpeg|png|gif|webp)/.test(c.mime || '') && (c.w || 0) >= 300 && (c.h || 0) >= 200)
      .map(c => ({ ...c, score: score(c) })).sort((a, b) => b.score - a.score).slice(0, 12);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
  } catch (e: any) { res.writeHead(502).end(String(e?.message || e)); }
}
async function picture(req: http.IncomingMessage, res: http.ServerResponse, u: URL) {
  if (!ownPage(req)) { res.writeHead(403).end(); return; }
  let target: URL; try { target = new URL(u.searchParams.get('u') || ''); } catch { res.writeHead(400).end(); return; }
  // pictures only, from the open web (never this computer or its network)
  if (target.protocol !== 'https:' || /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[)/.test(target.hostname)) { res.writeHead(403).end(); return; }
  try {
    const r = await fetch(target, { headers: { 'user-agent': UA, accept: 'image/*' }, redirect: 'follow', signal: AbortSignal.timeout(15000) });
    const type = r.headers.get('content-type') || '';
    if (!r.ok || !/^image\/(jpeg|png|gif|webp|svg\+xml)/.test(type)) { res.writeHead(415).end(); return; }
    const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 20 * 1024 * 1024) { res.writeHead(413).end(); return; }
    res.writeHead(200, { 'content-type': type, 'cache-control': 'max-age=3600' }).end(buf);
  } catch (e: any) { res.writeHead(502).end(String(e?.message || e)); }
}

// ---------------------------------------------------------------- updates
// The desktop app updates itself from the project's GitHub branch `desktop-app`: a manifest (version.json) lists
// every file with its sha256; only files that changed are downloaded, checked against that hash and written in
// place. Only app/… and server.mjs can be written. The open board is told, so it can offer to reload.
const UPDATES = process.env.CANVAS_UPDATE_URL || 'https://raw.githubusercontent.com/zhitaoyu-lgtm/canvas-as-the-prompt/desktop-app/';
let updated: { version: string; restart: boolean } | null = null;
async function selfUpdate() {
  if (process.env.CANVAS_NO_UPDATE || !process.argv.includes('--app')) return;
  const crypto = await import('node:crypto');
  const sha = (b: Buffer) => crypto.createHash('sha256').update(b).digest('hex');
  let local: any = { version: '0', files: {} };
  try { local = JSON.parse(fs.readFileSync(path.join(HERE, 'version.json'), 'utf8')); } catch { /* first run */ }
  try {
    // The raw-file service keeps a branch's files for a few minutes; pinned to the branch's newest commit, it
    // serves exactly what was published (asked of GitHub, which answers at once). Otherwise the branch as before.
    let base = UPDATES;
    const gh = /^https:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/$/.exec(UPDATES);
    if (gh) try {
      const c = await fetch(`https://api.github.com/repos/${gh[1]}/${gh[2]}/commits/${gh[3]}`, { headers: { accept: 'application/vnd.github.sha', 'user-agent': UA }, signal: AbortSignal.timeout(8000) });
      const id = c.ok ? (await c.text()).trim() : ''; if (/^[0-9a-f]{40}$/.test(id)) base = `https://raw.githubusercontent.com/${gh[1]}/${gh[2]}/${id}/`;
    } catch { /* the branch, then */ }
    const r = await fetch(base + 'version.json?t=' + Date.now(), { signal: AbortSignal.timeout(10000) });
    if (!r.ok) return;
    const m = await r.json();
    if (!m?.version || m.version <= local.version) return;
    const want = Object.entries(m.files as Record<string, string>).filter(([p, h]) => {
      if (!/^(app\/[\w.\-\/]+|server\.mjs|Canvas\.vbs|canvas\.ico|README\.md|Quit Canvas\.cmd|Set Claude key\.cmd)$/.test(p) || p.includes('..')) return false;
      try { return sha(fs.readFileSync(path.join(HERE, p))) !== h; } catch { return true; }   // what is on disk decides
    });
    log(`update ${local.version} → ${m.version}: ${want.length} files`);
    if (!want.length) { fs.writeFileSync(path.join(HERE, 'version.json'), JSON.stringify(m)); return; }
    const got: [string, Buffer][] = [];
    for (const [p, h] of want) {
      const f = await fetch(base + p.split('/').map(encodeURIComponent).join('/'), { signal: AbortSignal.timeout(60000) });
      if (!f.ok) throw new Error(`${p}: ${f.status}`);
      const b = Buffer.from(await f.arrayBuffer());
      if (sha(b) !== h) throw new Error(`${p}: checksum`);
      got.push([p, b]);
    }
    // everything arrived and checked: now write (index.html last, so the page never points at a missing file)
    got.sort((a, b) => (a[0] === 'app/index.html' ? 1 : 0) - (b[0] === 'app/index.html' ? 1 : 0));
    for (const [p, b] of got) { const f = path.join(HERE, p); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, b); }
    fs.writeFileSync(path.join(HERE, 'version.json'), JSON.stringify(m));
    updated = { version: m.version, restart: want.some(([p]) => p === 'server.mjs') };
    if (want.every(([p]) => !p.startsWith('app/') && p !== 'server.mjs')) updated = null;   // only launcher files: nothing to reload
    // a new server: this one hands over to it by itself (the open board just offers a reload)
    if (updated?.restart && process.argv.includes('--app')) {
      updated = { ...updated, restart: false };
      for (const b of boards) b.send(JSON.stringify({ event: 'updated', ...updated }));
      log('restarting on the new server');
      setTimeout(() => { try { spawn(process.execPath, process.argv.slice(1), { cwd: HERE, detached: true, stdio: 'ignore', env: { ...process.env, CANVAS_RESTARTED: '1' } }).unref(); } finally { process.exit(0); } }, 400);
      return;
    }
    if (updated) for (const b of boards) b.send(JSON.stringify({ event: 'updated', ...updated }));
  } catch (e: any) { log('update skipped:', e?.message || e); }
}

function startOwner(): Promise<boolean> {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url || '/', URL_);
      if (u.pathname === '/__quit' && req.headers['x-canvas'] === 'quit') { res.writeHead(200).end('bye'); setTimeout(() => process.exit(0), 100); return; }
      if (u.pathname === '/__claude' || u.pathname.startsWith('/__claude/')) { void claude(req, res, u); return; }
      if (u.pathname === '/__version') { let v = ''; try { v = JSON.parse(fs.readFileSync(path.join(HERE, 'version.json'), 'utf8')).version ?? ''; } catch { /* a copy never updated */ } res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify({ version: v })); return; }
      if (u.pathname === '/__pictures') { void pictures(req, res, u); return; }
      if (u.pathname === '/__picture') { void picture(req, res, u); return; }
      let f = path.normalize(path.join(APP, decodeURIComponent(u.pathname)));
      if (!f.startsWith(path.normalize(APP))) { res.writeHead(403).end(); return; }
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(APP, 'index.html');
      fs.readFile(f, (err, data) => {
        if (err) { res.writeHead(404).end('Canvas app not found next to the server.'); return; }
        res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream', 'cache-control': 'no-cache' }).end(data);
      });
    });
    const wss = new WebSocketServer({ noServer: true });
    srv.on('upgrade', (req, socket, head) => {
      const p = new URL(req.url || '/', URL_).pathname;
      const origin = String(req.headers.origin || '');
      // only pages on this computer may connect (a website cannot drive the board)
      if (origin && !/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)) { socket.destroy(); return; }
      wss.handleUpgrade(req, socket, head, ws => {
        if (p === '/bridge') {
          boards.push(ws); log('board connected');
          if (updated) ws.send(JSON.stringify({ event: 'updated', ...updated }));
          ws.on('message', d => { let m: any; try { m = JSON.parse(String(d)); } catch { return; } if (!settle(m)) relayBack(m); });
          ws.on('close', () => { boards = boards.filter(b => b !== ws); log('board closed'); });
        } else if (p === '/relay') {
          // another copy of this server (another chat app) passes requests through us
          ws.on('message', d => {
            let m: any; try { m = JSON.parse(String(d)); } catch { return; }
            const b = boards[boards.length - 1];
            if (!b) { ws.send(JSON.stringify({ id: m.id, ok: false, error: 'no-board' })); return; }
            relays.set(m.id, ws); b.send(JSON.stringify(m));
          });
          ws.on('close', () => { for (const [k, v] of relays) if (v === ws) relays.delete(k); });
        } else socket.destroy();
      });
    });
    srv.once('error', (e: any) => { if (e.code === 'EADDRINUSE') resolve(false); else { log(e); resolve(false); } });
    srv.listen(PORT, '127.0.0.1', () => { log(`serving the canvas at ${URL_}`); resolve(true); });
  });
}
const relays = new Map<string, WebSocket>();
function relayBack(m: any) { const ws = relays.get(m?.id); if (ws) { relays.delete(m.id); ws.send(JSON.stringify(m)); } }

function joinOwner() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/relay`, { headers: { origin: `http://127.0.0.1:${PORT}` } });
  ws.on('open', () => { upstream = ws; log('relaying through the copy already running'); });
  ws.on('message', d => { try { settle(JSON.parse(String(d))); } catch { /* ignore */ } });
  ws.on('close', () => { if (upstream === ws) upstream = null; setTimeout(boot, 2000); });
  ws.on('error', () => { /* close follows */ });
}
async function boot() {
  // started by an older copy of itself that is just leaving: wait for the port rather than join the old one
  if (process.env.CANVAS_RESTARTED) { for (let i = 0; i < 40; i++) { if (await startOwner()) return; await new Promise(r => setTimeout(r, 250)); } }
  if (!(await startOwner())) joinOwner();
}

function openBrowser() {
  // on Windows the board opens as its own app window (Edge app mode), the same window the desktop launcher uses
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', 'msedge', `--app=${URL_}`, '--window-size=1440,900']] : process.platform === 'darwin' ? ['open', [URL_]] : ['xdg-open', [URL_]];
  try { spawn(cmd[0] as string, cmd[1] as string[], { detached: true, stdio: 'ignore' }).unref(); } catch { /* the user opens it */ }
}

/** Ask the board; if none is open, open it in the browser and wait for it. */
async function ask(op: string, args: any = {}) {
  try { return await send(op, args); }
  catch (e: any) {
    if (e.message !== 'no-board') throw e;
    openBrowser();
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (upstream || boards.length) { await new Promise(r => setTimeout(r, 1500)); try { return await send(op, args); } catch (e2: any) { if (e2.message !== 'no-board') throw e2; } }
    }
    throw new Error(`No board is open. Open ${URL_} in a browser, then try again.`);
  }
}

// ---------------------------------------------------------------- MCP tools
const mcp = new McpServer({ name: 'canvas', version: '0.1.0' });
const text = (t: string) => ({ content: [{ type: 'text' as const, text: t }] });
const fail = (e: any) => ({ content: [{ type: 'text' as const, text: String(e?.message ?? e) }], isError: true });

mcp.tool('canvas_status', 'Check that the user\'s spatial canvas (Canvas as the Prompt) is open, and how much is on it. Opens it in the browser if it is not.',
  {}, async () => { try { const r = await ask('status'); return text(r.empty ? 'The canvas is open and empty.' : `The canvas is open with ${r.items} things on it.`); } catch (e) { return fail(e); } });

mcp.tool('canvas_read', 'Read what is on the user\'s canvas, as a structured description of its spatial grammar (groups, sections, lines, colours, empty slots). Each thing has a ref (s3, f1, G2) that canvas_add can point at. Read before adding next to existing work.',
  {}, async () => { try { return text((await ask('read')).board); } catch (e) { return fail(e); } });

const source = z.object({
  id: z.string().optional().describe('short id, used by relations (e.g. "kirsh95")'),
  title: z.string().describe('exact title'),
  url: z.string().optional().describe('real link, if there is one'),
  authors: z.string().optional(), venue: z.string().optional(), year: z.union([z.string(), z.number()]).optional(),
  note: z.string().optional().describe('one line: why it matters here'),
  insights: z.array(z.string()).optional().describe('the insights or key points from the chat about THIS source; each becomes a note placed under it'),
});

mcp.tool('canvas_import',
  `Move the important content of this chat onto the user's spatial canvas, as non-linear notes in the canvas's own spatial grammar.
Use when the user asks to put, save, organise or move what was discussed (papers, sources, insights, decisions, open questions) into their canvas or board.
Distil; never paste the transcript. Keep only what the user would want to work with spatially:
- themes: one per topic that came up; each holds the sources discussed under it. A source discussed under two themes goes in the one it matters most to.
- each source's insights are what was said about THAT source in the chat (its point, finding, how it relates to the user's work). They are placed under the source, so a note on a source means an insight about it.
- relations: only those the chat actually established between sources, with a 2–3 word label (supports, contrasts, builds on). They are written on the source card in a few words; no lines are drawn.
- decisions: what the user decided, with the reason. questions: what was left open.
All text in English, short (titles 2–6 words, insights ≤ 20 words). Use real titles and URLs only; never invent a reference.
The canvas lays everything out itself, to the right of what is already there.`,
  {
    title: z.string().optional().describe('a short name for this set, e.g. "Spatial grammar: related work"'),
    summary: z.string().optional().describe('1–2 sentences: the takeaway of the discussion'),
    themes: z.array(z.object({ title: z.string(), note: z.string().optional(), sources: z.array(source) })).optional(),
    sources: z.array(source).optional().describe('sources that belong to no theme'),
    relations: z.array(z.object({ from: z.string(), to: z.string(), label: z.string().optional(), kind: z.enum(['supports', 'contrasts', 'builds on', 'related']).optional() })).optional(),
    decisions: z.array(z.object({ title: z.string(), why: z.string().optional() })).optional(),
    questions: z.array(z.string()).optional(),
    notes: z.array(z.string()).optional().describe('other important points that are not about one source'),
  },
  async (args) => {
    try {
      const r = await ask('import', args);
      return text(`Placed ${r.placed} things on the canvas.` + (r.errors?.length ? ` Some parts did not apply: ${r.errors.join('; ')}` : ''));
    } catch (e) { return fail(e); }
  });

mcp.tool('canvas_add',
  `Add to the user's canvas with the canvas's own parts, for anything canvas_import does not fit (a diagram, a 2×2, stickies next to the user's own work, a comment on one of their notes). Call canvas_read first when you refer to things already there. All text in English.
Keep it refined: few, well-chosen parts in one clear structure (a section with sub-sections and consistent cards), short titles, no filler.
Avoid lines between cards. Show a relation by placement (side by side, in the same section, a note under the card) or in a few words on the card. At most one line per request, and only when nothing else is clear; extra lines are dropped.
${PARTS}`,
  { actions: z.array(z.record(z.any())).describe('the parts, in order, e.g. [{"do":"section","title":"…","items":[…]}]') },
  async ({ actions }) => {
    try {
      const r = await ask('apply', { actions });
      return text(`Placed ${r.placed} things on the canvas.` + (r.errors?.length ? ` Some parts did not apply: ${r.errors.join('; ')}` : ''));
    } catch (e) { return fail(e); }
  });

mcp.tool('canvas_export',
  'Get the user\'s canvas as a linear Markdown document, translated from its spatial grammar (sections → headings, notes placed on a source → points citing it, stressed notes → highlighted key points, arrows → relation lines, empty notes → open questions). Use when the user wants to continue from their board in this chat, or asks what is on it in prose. If they edited the document view, their version is returned.',
  {}, async () => { try { return text((await ask('export')).markdown); } catch (e) { return fail(e); } });

await boot();
void selfUpdate();
// keep checking while the app stays open, so an update reaches a window that was never closed
if (process.argv.includes('--app')) setInterval(() => { if (!updated) void selfUpdate(); }, 10 * 60 * 1000);
// `--app`: started by the desktop launcher, not by a chat app; serve the board only
if (!process.argv.includes('--app')) {
  // a chat app started this copy: leave a line beside the program, so it is easy to tell whether that ever happened
  const note = (t: string) => { try { fs.appendFileSync(path.join(HERE, 'mcp-start.log'), `${new Date().toISOString()} ${t}\n`); } catch { /* read-only folder */ } };
  note('started by a chat app (pid ' + process.pid + ', parent ' + process.ppid + ')');
  try { await mcp.connect(new StdioServerTransport()); note('speaking MCP over stdio'); } catch (e: any) { note('could not start MCP: ' + (e?.message ?? e)); throw e; }
}
log('ready');
