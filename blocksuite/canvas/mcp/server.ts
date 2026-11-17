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

function startOwner(): Promise<boolean> {
  return new Promise(resolve => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url || '/', URL_);
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
async function boot() { if (!(await startOwner())) joinOwner(); }

function openBrowser() {
  const cmd = process.platform === 'win32' ? ['cmd', ['/c', 'start', '', URL_]] : process.platform === 'darwin' ? ['open', [URL_]] : ['xdg-open', [URL_]];
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
await mcp.connect(new StdioServerTransport());
log('ready');
