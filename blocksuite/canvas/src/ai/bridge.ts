// Entry: a link from any chat (Claude first) into this board, through the canvas MCP server.
// The server (mcp/server.mjs) runs on the user's own computer next to Claude; this page connects to it
// over a local WebSocket and carries out what the chat asks: read the board, or put material on it.
// Only on a local page (the claude.ai preview cannot reach the computer, so there is nothing to connect to).

import { execute, type Action } from './actions';
import { readBoard, toPrompt, type Box } from './reading';

const PORT = 7357;

export function mountBridge(rootEl: any) {
  const host = location.hostname;
  const local = host === 'localhost' || host === '127.0.0.1' || new URLSearchParams(location.search).has('bridge');
  if (!local) return;
  const url = location.port === String(PORT) ? `ws://${location.host}/bridge` : `ws://127.0.0.1:${PORT}/bridge`;
  const gfx = rootEl.gfx, store = rootEl.std.store;
  let ws: WebSocket | null = null, wait = 1000;
  const state = { connected: false };
  (window as any).cxBridge = state;

  const connect = () => {
    try { ws = new WebSocket(url); } catch { return retry(); }
    ws.onopen = () => { state.connected = true; wait = 1000; ws!.send(JSON.stringify({ hello: 'canvas', title: document.title })); };
    ws.onclose = () => { state.connected = false; retry(); };
    ws.onerror = () => { /* onclose follows */ };
    ws.onmessage = async (ev) => {
      let msg: any; try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (!msg?.id) return;
      try { ws?.send(JSON.stringify({ id: msg.id, ok: true, result: await handle(msg.op, msg.args ?? {}) })); }
      catch (e: any) { ws?.send(JSON.stringify({ id: msg.id, ok: false, error: String(e?.message ?? e) })); }
    };
  };
  const retry = () => { setTimeout(connect, wait); wait = Math.min(wait * 2, 15000); };
  connect();

  async function handle(op: string, args: any): Promise<any> {
    switch (op) {
      case 'status': {
        const r = readBoard(gfx, {});
        return { items: r.items.length, empty: r.items.length === 0 };
      }
      case 'read': {
        const r = readBoard(gfx, {});
        return { board: r.items.length ? toPrompt(r) : 'The board is empty.' };
      }
      case 'apply': return place(args.actions ?? []);
      case 'import': return place(importActions(args));
      default: throw new Error(`unknown request "${op}"`);
    }
  }

  // put a set of parts on the board, then show the user where it went
  async function place(actions: Action[]) {
    if (!actions.length) throw new Error('nothing to place');
    const reading = readBoard(gfx, {});
    // new material goes to the right of everything already there, top-aligned; parts that place themselves keep their place
    const spot = freeSpot(reading.items.map(i => i.box));
    const acts = actions.map((a, i) => i === 0 && a.place == null && ['section', 'diagram', 'matrix', 'add', 'legend'].includes(a.do) ? { ...a, place: { at: [spot.x, spot.y] } } : a);
    store.captureSync();
    const res = await execute(rootEl, reading, { actions: acts });
    store.captureSync();
    if (res.box) { try { gfx.viewport.setViewportByBound(res.box, [80, 80, 160, 80], true); } catch { /* keep the view */ } }
    return { placed: res.created.length, errors: res.errors };
  }

  function freeSpot(boxes: Box[]): { x: number; y: number } {
    if (!boxes.length) { const c = gfx.viewport.center ?? { x: 0, y: 0 }; return { x: Math.round(c.x - 400), y: Math.round(c.y - 300) }; }
    const x1 = Math.max(...boxes.map(b => b.x + b.w)), y0 = Math.min(...boxes.map(b => b.y));
    return { x: Math.round(x1 + 240), y: Math.round(y0) };
  }
}


// ---- what a chat hands over → the board's own grammar --------------------------------------------
// A theme is a section; each source is a column: its link card with the insights placed under it (a note
// on a source = an insight about that source); relations between sources are labelled lines; decisions
// and open questions keep their own areas. Layout and sizes are worked out by the board, not the chat.

type Source = { id?: string; title: string; url?: string; authors?: string; venue?: string; year?: string | number; note?: string; insights?: string[] };
type Theme = { title: string; note?: string; sources: Source[] };
export type Import = {
  title?: string; summary?: string;
  themes?: Theme[]; sources?: Source[];
  relations?: { from: string; to: string; label?: string; kind?: 'supports' | 'contrasts' | 'builds on' | 'related' }[];
  decisions?: { title: string; why?: string }[];
  questions?: string[];
  notes?: string[];
};

const HUES = ['blue', 'yellow', 'purple', 'teal', 'orange', 'green', 'pink'];

export function importActions(x: Import): Action[] {
  const themes: Theme[] = [...(x.themes ?? [])];
  if (x.sources?.length) themes.push({ title: themes.length ? 'Other sources' : 'Sources', sources: x.sources });
  const ids = new Set<string>();
  const nameOf = (s: Source, i: number, t: number) => {
    let n = String(s.id ?? `src-${t + 1}-${i + 1}`).replace(/[^\w-]/g, '-');
    while (ids.has(n)) n += '-b';
    ids.add(n); s.id = s.id ?? n; return n;
  };
  const byId = new Map<string, string>();
  const items: any[] = [];
  if (x.summary) items.push({ kind: 'summary', text: x.summary });
  themes.forEach((t, ti) => {
    const cols = (t.sources ?? []).map((s, i) => {
      const name = nameOf(s, i, ti); byId.set(String(s.id), name);
      const meta = [s.venue, s.year, s.authors].filter(Boolean).join(' · ');
      const head = s.url
        ? { kind: 'link', name, title: s.title, url: s.url, meta, note: s.note ?? '' }
        : { kind: 'card', name, title: s.title, meta, body: s.note ?? '' };
      return { kind: 'section', title: '', colour: 'white', layout: 'column', items: [head, ...(s.insights ?? []).map(text => ({ kind: 'sticky', text, colour: 'yellow' }))] };
    });
    if (cols.length) items.push({ kind: 'section', title: t.title, subtitle: t.note, colour: HUES[ti % HUES.length], layout: 'row', items: cols });
  });
  const side: any[] = [];
  if (x.decisions?.length) side.push({ kind: 'section', title: 'Decisions', colour: 'green', layout: 'column', items: x.decisions.map(d => ({ kind: 'card', title: d.title, body: d.why ?? '' })) });
  if (x.questions?.length) side.push({ kind: 'panel', title: 'Open questions', style: 'dashed', colour: 'gray', items: x.questions });
  if (x.notes?.length) side.push({ kind: 'section', title: 'Notes', colour: 'gray', layout: 'grid', cols: 2, items: x.notes.map(text => ({ kind: 'sticky', text, colour: 'yellow' })) });
  if (side.length) items.push({ kind: 'section', title: 'Decisions and questions', colour: 'white', layout: 'row', items: side });

  const acts: Action[] = [{ do: 'section', name: 'chat-import', title: x.title || 'From a Claude chat', subtitle: `Imported ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, colour: 'white', layout: 'column', items }];
  for (const r of x.relations ?? []) {
    const from = byId.get(String(r.from)), to = byId.get(String(r.to));
    if (!from || !to || from === to) continue;
    acts.push({ do: 'connect', from, to, label: r.label ?? r.kind ?? '', dashed: r.kind === 'related' });
  }
  return acts;
}
