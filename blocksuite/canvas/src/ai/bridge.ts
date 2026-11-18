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
      if (msg?.event === 'updated') { updatedToast(msg); return; }
      if (!msg?.id) return;
      try { ws?.send(JSON.stringify({ id: msg.id, ok: true, result: await handle(msg.op, msg.args ?? {}) })); }
      catch (e: any) { ws?.send(JSON.stringify({ id: msg.id, ok: false, error: String(e?.message ?? e) })); }
    };
  };
  // the desktop app fetched a new version in the background: offer to load it
  const updatedToast = (m: any) => {
    if (document.querySelector('.cx-update')) return;
    const t = document.createElement('div'); t.className = 'cx-update';
    t.innerHTML = `<span>${m.restart ? 'A new version is ready. Quit and reopen Canvas to use it.' : 'A new version is ready.'}</span>`;
    if (!m.restart) { const b = document.createElement('button'); b.textContent = 'Reload'; b.onclick = () => location.reload(); t.append(b); }
    const x = document.createElement('button'); x.className = 'x'; x.textContent = '×'; x.onclick = () => t.remove(); t.append(x);
    document.body.append(t);
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
      case 'apply': return place(fewLines(args.actions ?? []));
      case 'import': return place(importActions(args));
      case 'export': { const v = (window as any).cxPanel; if (!v) throw new Error('the document is not ready'); return { markdown: v.markdown() }; }
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

/** Lines between cards are kept to one per request; the rest of the relations should be said by placement or in words. */
function fewLines(actions: Action[]): Action[] {
  let n = 0;
  return actions.filter(a => !['connect', 'ref'].includes(a.do) || ++n <= 1);
}

const HUES = ['blue', 'yellow', 'purple', 'teal', 'orange', 'green', 'pink'];

export function importActions(x: Import): Action[] {
  const themes: Theme[] = [...(x.themes ?? [])];
  if (x.sources?.length) themes.push({ title: themes.length ? 'Other sources' : 'Sources', sources: x.sources });
  const all = themes.flatMap(t => t.sources ?? []);
  const short = (id: string) => { const s = all.find(s => String(s.id) === String(id)); return s ? shortTitle(s.title) : ''; };
  // relations are said on the card in a few words, not drawn as lines: lines between cards clutter the board
  const said = new Map<Source, string[]>();
  for (const r of x.relations ?? []) {
    const from = all.find(s => String(s.id) === String(r.from)), to = short(r.to);
    if (!from || !to || String(r.from) === String(r.to)) continue;
    const verb = (r.label || r.kind || 'related to').trim();
    (said.get(from) ?? said.set(from, []).get(from)!).push(`${cap(verb)} ${to}.`);
  }
  const items: any[] = [];
  if (x.summary) items.push({ kind: 'summary', text: x.summary });
  themes.forEach((t, ti) => {
    const cols = (t.sources ?? []).map(s => {
      const meta = [s.venue, s.year, s.authors].filter(Boolean).join(' · ');
      const note = [s.note, ...(said.get(s) ?? [])].filter(Boolean).join(' ');
      const head = s.url ? { kind: 'link', title: s.title, url: s.url, meta, note } : { kind: 'card', title: s.title, meta, body: note };
      const notes = (s.insights ?? []).slice(0, 4).map(text => ({ kind: 'sticky', text, colour: 'yellow' }));
      // a source and the notes stuck under it read as one thing: no box of their own
      return { kind: 'section', bare: true, layout: 'column', gap: 12, items: notes.length ? [head, { kind: 'section', bare: true, layout: 'grid', cols: 2, gap: 10, items: notes }] : [head] };
    });
    if (cols.length) items.push({ kind: 'section', title: t.title, subtitle: t.note, colour: HUES[ti % HUES.length], layout: 'row', items: cols });
  });
  const side: any[] = [];
  if (x.decisions?.length) side.push({ kind: 'panel', title: 'Decisions', colour: 'green', style: 'tint', items: x.decisions.map(d => ({ title: d.title, text: d.why ?? '' })) });
  if (x.questions?.length) side.push({ kind: 'panel', title: 'Open questions', colour: 'gray', style: 'dashed', items: x.questions });
  if (x.notes?.length) side.push({ kind: 'panel', title: 'Notes', colour: 'yellow', style: 'tint', items: x.notes });
  if (side.length) items.push({ kind: 'section', bare: true, layout: 'row', gap: 24, items: side });
  return [{ do: 'section', name: 'chat-import', title: x.title || 'From a Claude chat', subtitle: x.summary ? undefined : `Imported ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`, colour: 'white', layout: 'column', items }];
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** "VIKI: Spatial Hypertext Supporting …" → "VIKI"; long titles → their first few words. */
function shortTitle(t: string) {
  const head = t.split(/[:\u2013\u2014-]\s/)[0].trim();
  const w = head.split(/\s+/);
  return w.length <= 3 ? head : w.slice(0, 3).join(' ') + '…';
}
