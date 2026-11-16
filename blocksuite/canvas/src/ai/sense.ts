// Spatial intent: the board watches what the user builds, and once a category has settled it offers a
// whole set of things for it, as copies, in one pending box. Nothing is asked for in words.
//
//   section   a frame gets a real name                       → copies of what belongs, inside it
//   group     a sticky in open space + the first thing beside it → copies of what belongs, close by
//   mark      the same mark (pill, dot, emoji, small note, word) on two things → the same mark on similar things
//
// The user's originals never move. One ✓ keeps the set, one ✕ removes it; unwanted copies are deleted later
// like anything else. While the user is typing, dragging or a set is pending, nothing happens.

import * as Y from 'yjs';
import { Text } from '@blocksuite/affine/store';
import { generateKeyBetween } from '@blocksuite/affine/std/gfx';
import { ask, online, parseAnswer } from './model';
import { readBoard, toPrompt, type Box, type Item, type Reading } from './reading';
import { addComment, removeCommentsOn } from './comments';
import { toast } from './proposals';

const STABLE_MS = 1800, POLL_MS = 600, NEAR = 48;
const DEFAULT_FRAME = /^(frame|section|untitled)(\s*\d+)?$/i;

type Intent =
  | { type: 'section'; key: string; frame: any; title: string; inside: Set<string> }
  | { type: 'group'; key: string; anchor: Item; members: Item[] }
  | { type: 'mark'; key: string; sig: string; label: string; marks: { mark: Item; host: Item }[] };

const box = (e: any): Box => { const b = e.elementBound; return { x: b.x, y: b.y, w: b.w, h: b.h }; };
const gap = (a: Box, b: Box) => Math.max(0, Math.max(a.x, b.x) - Math.min(a.x + a.w, b.x + b.w), Math.max(a.y, b.y) - Math.min(a.y + a.h, b.y + b.h));
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const contains = (o: Box, i: Box) => i.x >= o.x - 2 && i.y >= o.y - 2 && i.x + i.w <= o.x + o.w + 2 && i.y + i.h <= o.y + o.h + 2;
const union = (bs: Box[]): Box => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const b of bs) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); } return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };
const xywh = (b: Box) => `[${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}]`;
const prop = (e: any, k: string) => e?.props?.[k] ?? e?.[k];
const str = (v: any) => (v == null ? '' : typeof v === 'string' ? v : v.toString?.() ?? '');

export function mountSense(rootEl: any) {
  const gfx = rootEl.gfx, store = rootEl.std.store, surf = gfx.surface;
  const handled = new Set<string>();
  const failed = new Map<string, number>();   // key → when it failed; tried again after a minute
  const retry = (key: string) => { const t = failed.get(key); return !!t && Date.now() - t > 60_000; };
  let base = new Map<string, string>(), last = new Map<string, string>(), recent = new Set<string>();
  let quietSince = 0, busy = false, pointerDown = false, pending: Pending | null = null;
  const dev: any = (window as any).cxSense = { log: [] as any[], enabled: true };

  addEventListener('pointerdown', () => { pointerDown = true; }, true);
  addEventListener('pointerup', () => { pointerDown = false; quietSince = Date.now(); }, true);

  // ── watching: a cheap signature of every element; a change resets the quiet clock ──
  const sigOf = (e: any) => {
    const b = e.elementBound;
    return `${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}|${str(prop(e, 'title') ?? e.text).slice(0, 80)}|${e.fillColor ?? prop(e, 'background') ?? ''}`;
  };
  const snapshot = () => { const m = new Map<string, string>(); for (const e of gfx.gfxElements as any[]) if (e.flavour !== 'affine:surface') m.set(e.id, sigOf(e)); return m; };
  const rebase = () => { base = snapshot(); last = base; recent.clear(); };
  rebase();

  const editing = () => {
    let a: any = document.activeElement;
    while (a?.shadowRoot?.activeElement) a = a.shadowRoot.activeElement;
    return !!a && (a.isContentEditable || a.tagName === 'INPUT' || a.tagName === 'TEXTAREA');
  };

  setInterval(async () => {
    if (!dev.enabled || busy || pending) return;
    const now = snapshot();
    let changed = false;
    for (const [id, s] of now) if (last.get(id) !== s) { changed = true; if (base.get(id) !== s) recent.add(id); }
    if (now.size !== last.size) changed = true;
    last = now;
    if (changed) { quietSince = Date.now(); return; }
    if (!recent.size || pointerDown || editing() || Date.now() - quietSince < STABLE_MS) return;
    const touched = new Set(recent); base = now; recent.clear();
    const intent = detect(touched);
    if (!intent) return;
    busy = true;
    const stop = thinking(intent);
    try { await respond(intent); failed.delete(intent.key); }
    catch (e: any) {
      console.warn('[sense]', e); failed.set(intent.key, Date.now());
      const code = e?.code ?? '';
      toast(code === 'no_model' ? 'Connect Claude in settings to let the board help.' : code === 'not_granted' ? 'Claude was not allowed for this page.' : 'Couldn’t reach Claude just now.', undefined);
    }
    finally { stop(); busy = false; rebase(); }
  }, POLL_MS);

  // While Claude thinks: the 2×2 dots breathe at the top-left of the place it is thinking about. Nothing else.
  function thinking(intent: Intent): () => void {
    const area = intent.type === 'section' ? box(intent.frame) : intent.type === 'group' ? union([intent.anchor.box, ...intent.members.map(m => m.box)]) : intent.marks[intent.marks.length - 1].host.box;
    const d = document.createElement('div'); d.className = 'cx-sense-think'; d.innerHTML = '<i></i><i></i><i></i><i></i>'; document.body.append(d);
    let raf = 0;
    const tick = () => { const rr = rootEl.getBoundingClientRect(); const [x, y] = gfx.viewport.toViewCoord(area.x, area.y); d.style.left = (rr.left + x - 16) + 'px'; d.style.top = (rr.top + y - 16) + 'px'; raf = requestAnimationFrame(tick); };
    tick();
    return () => { cancelAnimationFrame(raf); d.remove(); };
  }

  // ── reading the settled board for a category ──
  function detect(touched: Set<string>): Intent | null {
    const r = readBoard(gfx);
    const touchedItems = r.items.filter(i => touched.has(i.id));
    // 1 · a frame that now has a real name
    for (const i of touchedItems) if (i.kind === 'frame') {
      const f = gfx.getElementById(i.id) as any; const title = str(prop(f, 'title')).trim();
      if (!title || DEFAULT_FRAME.test(title) || title.length < 2) continue;
      const key = `section:${i.id}:${title.toLowerCase()}`; if (handled.has(key)) continue;
      const fb = box(f); const inside = new Set(r.items.filter(o => o.id !== i.id && contains(fb, o.box)).map(o => o.id));
      return { type: 'section', key, frame: f, title, inside };
    }
    // 2 · the same mark beside two or more things
    const marks = new Map<string, { mark: Item; host: Item }[]>();
    for (const [mRef, hRef] of r.relations.attached) {
      const mark = r.byRef.get(mRef)!, host = r.byRef.get(hRef)!; if (!mark || !host) continue;
      const s = markSig(mark); if (!s) continue;
      (marks.get(s.sig) ?? marks.set(s.sig, []).get(s.sig)!).push({ mark, host });
    }
    for (const [sig, list] of marks) {
      const hosts = new Set(list.map(l => l.host.id));
      if (hosts.size < 2 || !list.some(l => touched.has(l.mark.id) || touched.has(l.host.id))) continue;
      const key = `mark:${sig}`; if (handled.has(key)) continue;
      return { type: 'mark', key, sig, label: markSig(list[0].mark)!.label, marks: list };
    }
    // 3 · a named sticky with material set close to it, standing apart from the rest: a topic.
    // The group is everything chained to the sticky by short gaps (a card beside a card beside the sticky).
    const free = (i: Item) => !['frame', 'connector', 'group'].includes(i.kind) && !r.relations.attached.has(i.ref);
    const loose = r.items.filter(free);
    const chainFrom = (start: Item) => {
      const seen = new Set<Item>([start]), queue = [start];
      while (queue.length && seen.size <= 9) { const c = queue.shift()!; for (const o of loose) if (!seen.has(o) && gap(o.box, c.box) <= NEAR) { seen.add(o); queue.push(o); } }
      return [...seen];
    };
    const stickies = loose.filter(s => s.kind === 'sticky' && s.text.trim().length > 1);
    for (const a of stickies) {
      const comp = chainFrom(a);
      if (comp.length < 2 || comp.length > 9) continue;                    // alone, or part of a pile
      if (!comp.some(o => touched.has(o.id))) continue;                     // nothing here just changed
      if (comp.filter(o => o.kind === 'sticky').length > 2) continue;       // several notes together read as a cluster of ideas
      if (!comp.some(o => o.kind !== 'sticky')) continue;                   // needs material beside it
      const cl = union(comp.map(o => o.box));
      const clear = loose.every(o => comp.includes(o) || gap(o.box, cl) >= 72);
      if (!clear) continue;                                                 // it has to stand apart, in open space
      const key = `group:${a.id}:${a.text.trim().toLowerCase()}`; if (handled.has(key) && !retry(key)) continue;
      return { type: 'group', key, anchor: a, members: comp.filter(o => o !== a) };
    }
    return null;
  }

  function markSig(m: Item): { sig: string; label: string } | null {
    const el: any = gfx.getElementById(m.id);
    const t = m.text.trim().toLowerCase();
    switch (m.kind) {
      case 'tag': return { sig: `tag:${t}`, label: `“${m.text.trim()}”` };
      case 'dot': return { sig: `dot:${m.colour}`, label: `a ${m.colour ?? ''} dot` };
      case 'badge': return { sig: `badge:${m.colour}`, label: `a ${m.colour ?? ''} badge` };
      case 'sticker': return { sig: `sticker:${prop(el, 'sourceId') ?? t}`, label: 'this sticker' };
      case 'sticky': return t ? { sig: `note:${t}`, label: `“${m.text.trim()}”` } : null;
      case 'text': return t && t.length <= 24 ? { sig: `text:${t}`, label: `“${m.text.trim()}”` } : null;
      case 'shape': return { sig: `shape:${m.shape}:${m.colour}`, label: `a ${m.colour ?? ''} ${m.shape ?? 'mark'}` };
    }
    return null;
  }

  // ── asking Claude which things belong ──
  async function respond(intent: Intent) {
    handled.add(intent.key);
    const r = readBoard(gfx);
    const reading = toPrompt(r);
    const refOf = (id: string) => r.byId.get(id)?.ref;
    let task = '', exclude = new Set<string>();
    if (intent.type === 'section') {
      exclude = new Set([...intent.inside, intent.frame.id]);
      task = `The user drew a section and named it "${intent.title}". Pick the things on the board, outside it, that belong in it.`;
    } else if (intent.type === 'group') {
      exclude = new Set([intent.anchor.id, ...intent.members.map(m => m.id)]);
      task = `The user put a sticky "${intent.anchor.text.trim()}" (${intent.anchor.ref}) in open space and set ${intent.members.map(m => m.ref).join(', ')} beside it. The sticky names a topic, and what sits beside it is material on that topic. Gather more for this topic to sit beside it: things already on the board (refs) and literature or cases on the topic (found). Then sort the rest of the board the same way: propose other topics (more), each a short sticky title with its own refs and found, so every loose thing ends up in some topic.`;
    } else {
      exclude = new Set(intent.marks.flatMap(l => [l.host.id, l.mark.id]));
      task = `The user marked ${intent.marks.map(l => l.host.ref).join(', ')} with the same mark (${intent.label}): it labels them as one kind. Work out what they have in common, then pick the other things on the board that deserve the same mark, each with a one-line reason.`;
    }
    const foundRule = online()
      ? 'real sources you verified with search, with their real URL'
      : 'only well-known, real works you are sure of (classic papers, books, products), with venue · year · authors; leave url out (you cannot browse here; never invent a work)';
    const sys = `You help someone sort material on a whiteboard. They set up a category with space alone (a named section, a sticky with things beside it, or a repeated mark); you decide what else belongs.
Answer with JSON only:
{"refs":[{"ref":"s3","why":"one short line"}],"found":[{"title":"…","meta":"venue · year · authors","summary":"one line on why it matters here","url":"https://… (optional)"}],
 "more":[{"title":"2–4 word topic","refs":["n4"],"found":[…]}]}
- refs: things already on the board that clearly belong. Judge by their words and pictures, not by position. At most 8. Never refs that are marks, frames or lines, never the ones listed as already in. "why": only for the one or two picks whose tie is not obvious, a few words in the user's language; leave it out for the rest.
- found: up to ${intent.type === 'mark' ? 0 : 3}; ${foundRule}. In the language the board uses for its titles.
- more: ${intent.type === 'group' ? 'up to 4 other topics that sort the remaining loose things on the board (each ref appears once overall); 1–2 found each' : 'always []'}.
- Few and right beats many: if nothing fits, return {"refs":[],"found":[],"more":[]}.`;
    const user = `BOARD\n${reading}\n\nCATEGORY\n${task}\nAlready in it: ${[...exclude].map(refOf).filter(Boolean).join(', ') || 'nothing'}`;
    const mock = (window as any).cxMockSense;
    const raw = mock ? (typeof mock === 'function' ? await mock(intent, user) : mock) : await ask(sys, user);
    const ans = typeof raw === 'string' ? parseAnswer(raw) : raw;
    dev.log.unshift({ intent: intent.key, task, answer: ans }); dev.log.length = Math.min(dev.log.length, 10);
    const used = new Set<string>(exclude);
    const take = (list: any[]): { it: Item; why: string }[] => (list ?? []).map((x: any) => {
      const ref = typeof x === 'string' ? x : x?.ref; const it = r.byRef.get(String(ref));
      if (!it || used.has(it.id) || ['frame', 'connector', 'group'].includes(it.kind) || r.relations.attached.has(it.ref)) return null;
      used.add(it.id); return { it, why: typeof x === 'string' ? '' : String(x?.why ?? '') };
    }).filter(Boolean) as any;
    const picks = take(ans.refs);
    const found: any[] = Array.isArray(ans.found) ? ans.found.slice(0, 3) : [];
    const more = intent.type === 'group' && Array.isArray(ans.more) ? ans.more.slice(0, 4).map((m: any) => ({ title: String(m.title ?? '').trim(), picks: take(m.refs), found: Array.isArray(m.found) ? m.found.slice(0, 2) : [] })).filter((m: any) => m.title && (m.picks.length || m.found.length)) : [];
    if (!picks.length && !found.length && !more.length) return;
    store.captureSync();
    const made = intent.type === 'mark' ? placeMarks(intent, picks) : intent.type === 'group' ? placeGroup(intent, picks.map(p => p.it), found, more, r) : placeCopies(intent, picks.map(p => p.it), found, r);
    store.captureSync();
    if (made.ids.length) pending = new Pending(rootEl, made, intent, () => { pending = null; rebase(); });
  }

  // ── placing: copies in a grid inside the section, or close beside the group ──
  type Made = { ids: string[]; restore?: () => void; label: string; onKeep?: () => void; notes?: readonly (readonly [string, string])[] };
  function placeCopies(intent: Intent, picks: Item[], found: any[], r: Reading): Made {
    const sizes = picks.map(p => p.box);
    const foundW = 260;
    const all = [...sizes.map(b => ({ w: b.w, h: b.h })), ...found.map(() => ({ w: foundW, h: 140 }))];
    const GAP = 16;
    let x0: number, y0: number, width: number, restore: (() => void) | undefined;
    if (intent.type === 'section') {
      const f = intent.frame, fb = box(f);
      const inside = r.items.filter(o => intent.inside.has(o.id));
      x0 = fb.x + 32; y0 = inside.length ? Math.max(...inside.map(o => o.box.y + o.box.h)) + 24 : fb.y + 32;
      width = Math.max(fb.w - 64, Math.max(...all.map(a => a.w)));
      const needH = flowHeight(all, width, GAP);
      const old = prop(f, 'xywh');
      const nb = { x: fb.x, y: fb.y, w: Math.max(fb.w, width + 64), h: Math.max(fb.h, y0 - fb.y + needH + 32) };
      if (nb.w !== fb.w || nb.h !== fb.h) { store.updateBlock(f, { xywh: xywh(nb) }); restore = () => store.updateBlock(f, { xywh: old }); }
    } else {
      const cl = union([intent.anchor.box, ...intent.members.map(m => m.box)]);
      width = Math.max(cl.w, 520);
      const below = { x: cl.x, y: cl.y + cl.h + GAP, w: width, h: flowHeight(all, width, GAP) };
      const others = r.items.filter(o => !['frame', 'connector'].includes(o.kind) && !contains(cl, o.box));
      const vb = gfx.viewport.viewportBounds;
      const offView = below.y + below.h > vb.y + vb.h && cl.x + cl.w + 40 + width < vb.x + vb.w;   // keep the offer where the user is looking
      if (offView || others.some(o => overlaps(o.box, below))) { x0 = cl.x + cl.w + 40; y0 = cl.y; } else { x0 = below.x; y0 = below.y; }
    }
    const spots = flow(all, x0, y0, width, GAP);
    const ids: string[] = [];
    picks.forEach((p, i) => { const id = duplicate(p.id, spots[i]); if (id) ids.push(id); });
    found.forEach((s, i) => ids.push(sourceCard(s, spots[picks.length + i])));
    if (intent.type === 'section') {
      const f = intent.frame; const kids = { ...(prop(f, 'childElementIds') ?? {}) }; ids.forEach(id => { kids[id] = true; });
      try { store.updateBlock(f, { childElementIds: kids }); } catch { /* older frame model */ }
    }
    const n = ids.length, label = intent.type === 'section' ? `for “${intent.title}”` : `for “${intent.anchor.text.trim()}”`;
    return { ids, restore, label: `${n} ${label}` };
  }

  // A topic sticky with its material: more of the same right beside it, then the rest of the board sorted
  // into new topics laid out the same way underneath (a new sticky, its things to the right).
  function placeGroup(intent: Extract<Intent, { type: 'group' }>, picks: Item[], found: any[], more: { title: string; picks: { it: Item }[]; found: any[] }[], r: Reading): Made {
    const GAP = 16, CARD = 260;
    const a = intent.anchor, cl = union([a.box, ...intent.members.map(m => m.box)]);
    const sz = (list: Item[], f: any[]) => [...list.map(p => ({ w: p.box.w, h: p.box.h })), ...f.map(() => ({ w: CARD, h: 140 }))];
    const W = Math.max(3 * CARD + 2 * GAP, cl.w - a.box.w - GAP);
    const ids: string[] = [];
    const lay = (list: Item[], f: any[], x0: number, y0: number) => {
      const spots = flow(sz(list, f), x0, y0, W, GAP);
      list.forEach((p, i) => { const id = duplicate(p.id, spots[i]); if (id) ids.push(id); });
      f.forEach((s0, i) => ids.push(sourceCard(s0, spots[list.length + i])));
      return spots.length ? Math.max(...spots.map(b => b.y + b.h)) : y0;
    };
    // 1 · more for the user's own topic: next to what they already put there
    let bottom = cl.y + cl.h;
    if (picks.length || found.length) bottom = Math.max(bottom, lay(picks, found, cl.x + cl.w + GAP, cl.y));
    // 2 · the other topics, one row each, starting under the user's
    let y = bottom + 56;
    for (const m of more) {
      const sid = duplicate(a.id, { x: a.box.x, y, w: a.box.w, h: a.box.h }, m.title);
      if (sid) ids.push(sid);
      const end = lay(m.picks.map(p => p.it), m.found, a.box.x + a.box.w + GAP, y);
      y = Math.max(end, y + a.box.h) + 48;
    }
    const n = picks.length + found.length;
    return { ids, label: `${n} for “${a.text.trim()}”` + (more.length ? ` · ${more.length} more topics` : '') };
  }

  function placeMarks(intent: Extract<Intent, { type: 'mark' }>, picksWhy: { it: Item; why: string }[]): Made {
    const picks = picksWhy.map(p => p.it);
    const { mark, host } = intent.marks[intent.marks.length - 1];
    // keep the mark's relation to its host's nearest corner
    const right = mark.box.x + mark.box.w / 2 > host.box.x + host.box.w / 2, bottom = mark.box.y + mark.box.h / 2 > host.box.y + host.box.h / 2;
    const dx = right ? mark.box.x - (host.box.x + host.box.w) : mark.box.x - host.box.x;
    const dy = bottom ? mark.box.y - (host.box.y + host.box.h) : mark.box.y - host.box.y;
    const ids: string[] = [];
    for (const p of picks) {
      const x = (right ? p.box.x + p.box.w : p.box.x) + dx, y = (bottom ? p.box.y + p.box.h : p.box.y) + dy;
      const id = duplicate(mark.id, { x, y, w: mark.box.w, h: mark.box.h }); if (id) ids.push(id);
    }
    // why each one got the mark: a comment pin on the new mark, opened with a click
    const notes = picksWhy.map((p, i) => [ids[i], p.why] as const).filter(([id, why]) => id && why).slice(0, 2);   // comments only where they matter
    notes.forEach(([id, why]) => addComment(store, id, why));   // shown at once, so the reason is there before deciding
    return { ids, label: `${ids.length} more get ${intent.label}` };
  }

  function flow(sz: { w: number; h: number }[], x0: number, y0: number, width: number, g: number): Box[] {
    const out: Box[] = []; let x = x0, y = y0, rowH = 0;
    for (const s of sz) { if (x > x0 && x + s.w > x0 + width) { x = x0; y += rowH + g; rowH = 0; } out.push({ x, y, w: s.w, h: s.h }); x += s.w + g; rowH = Math.max(rowH, s.h); }
    return out;
  }
  const flowHeight = (sz: { w: number; h: number }[], width: number, g: number) => { const b = flow(sz, 0, 0, width, g); return b.length ? Math.max(...b.map(v => v.y + v.h)) : 0; };

  // ── copying anything on the board ──
  let topKey: string | null = null;
  const nextTop = () => {
    if (topKey == null) for (const e of gfx.gfxElements as any[]) if (e.index && (topKey == null || e.index > topKey)) topKey = e.index;
    topKey = generateKeyBetween(topKey, null); return topKey;
  };
  const cloneVal = (v: any): any => v instanceof Text ? new Text(v.toDelta() as any) : v instanceof Y.Text ? (() => { const t = new Y.Text(); t.insert(0, v.toString()); return t; })() : v && typeof v === 'object' && !Array.isArray(v) && v.constructor === Object ? JSON.parse(JSON.stringify(v)) : Array.isArray(v) ? JSON.parse(JSON.stringify(v)) : v;

  function duplicate(id: string, at: Box, text?: string): string | null {
    const el: any = gfx.getElementById(id); if (!el) return null;
    if (!el.flavour) {                                   // a surface element: shape, text, brush …
      const src = el.serialize ? el.serialize() : {};
      const props: any = {};
      for (const [k, v] of Object.entries(src)) if (!['id', 'index', 'seed'].includes(k)) props[k] = v;
      if (el.text || text) { const t = new Y.Text(); t.insert(0, text ?? str(el.text)); props.text = t; }
      props.xywh = xywh(at); props.index = nextTop();
      try { return surf.addElement(props); } catch (e) { console.warn('[sense] copy', e); return null; }
    }
    const model = store.getBlock(id)?.model; if (!model) return null;
    const parent = store.getParent(model)?.id ?? store.root.id;
    return copyBlock(model, parent, at);
  }
  function copyBlock(model: any, parent: string, at?: Box): string {
    const props: any = {};
    for (const k of model.keys ?? Object.keys(model.props ?? {})) { if (k === 'index') continue; props[k] = cloneVal(model.props?.[k] ?? model[k]); }
    if (at) { props.xywh = xywh(at); props.index = nextTop(); }
    const id = store.addBlock(model.flavour, props, parent);
    for (const c of model.children ?? []) copyBlock(c, id);
    return id;
  }
  function sourceCard(s: any, at: Box): string {
    const id = store.addBlock('affine:note', { xywh: xywh({ ...at, h: 120 }), background: '#ffffff', index: nextTop(),
      edgeless: { style: { borderRadius: 12, borderSize: 0, borderStyle: 'none', shadowType: '--affine-note-shadow-box' } } } as any, store.root.id);
    const gray = { color: 'var(--affine-text-secondary-color)' };
    const P = (t: string, a?: any) => new Text(a ? [{ insert: t, attributes: a }] as any : t);
    store.addBlock('affine:paragraph', { text: P('FOUND ONLINE' + (s.meta ? ' · ' + s.meta : ''), gray) }, id);
    store.addBlock('affine:paragraph', { text: P(String(s.title ?? ''), { bold: true, ...(s.url ? { link: String(s.url) } : {}) }) }, id);
    if (s.summary) store.addBlock('affine:paragraph', { text: P(String(s.summary), gray) }, id);
    return id;
  }

  // dev: re-arm, or seed the sorting board
  dev.reset = () => { handled.clear(); rebase(); };
  dev.rebase = rebase;
  dev.detect = (ids?: string[]) => detect(new Set(ids ?? (gfx.gfxElements as any[]).map(e => e.id)));
  dev.state = () => ({ recent: [...recent], busy, pointerDown, editing: editing(), quiet: Date.now() - quietSince });
  dev.pending = () => pending;
}

// ── the pending set: a veil and a thin box with the 2×2 dots over the copies, one ✓ and one ✕ ──
const TICK = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L19 7"/></svg>';
const CROSS = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#6e6e73" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

class Pending {
  private veils: HTMLElement[] = [];
  private ring = document.createElement('div');
  private bar = document.createElement('div');
  private raf = 0;
  private spread: boolean;
  constructor(private rootEl: any, private made: { ids: string[]; restore?: () => void; label: string; onKeep?: () => void; notes?: readonly (readonly [string, string])[] }, intent: Intent, private done: () => void) {
    // marks are scattered over the user's things: each copy fades on its own and only the bar carries the dots
    // marks and topic groups sit among the user's own things: each copy fades on its own (one box would
    // fade the user's things too), and the bar carries the dots
    this.spread = intent.type !== 'section';
    this.ring.className = 'cx-sense-ring';
    this.ring.innerHTML = '<span class="cx-sense-dots"><i></i><i></i><i></i><i></i></span>';
    this.bar.className = 'cx-sense-bar';
    this.bar.innerHTML = `${this.spread ? '<span class="cx-sense-dots"><i></i><i></i><i></i><i></i></span>' : ''}<span class="cx-sense-label"></span><button class="ok" aria-label="Keep all">${TICK}</button><button aria-label="Remove all">${CROSS}</button>`;
    (this.bar.querySelector('.cx-sense-label') as HTMLElement).textContent = made.label;
    (this.bar.querySelector('.ok') as HTMLElement).onclick = () => this.keep();
    (this.bar.querySelectorAll('button')[1] as HTMLElement).onclick = () => this.drop();
    const n = this.spread ? made.ids.length : 1;
    for (let i = 0; i < n; i++) { const v = document.createElement('div'); v.className = 'cx-sense-veil'; this.veils.push(v); }
    document.body.append(...this.veils, ...(this.spread ? [] : [this.ring]), this.bar);
    const tick = () => { this.place(); this.raf = requestAnimationFrame(tick); };
    tick();
  }
  private boxes(): Box[] { const g = this.rootEl.gfx; return this.made.ids.map(id => g.getElementById(id)).filter(Boolean).map((e: any) => box(e)); }
  private screen(b: Box, pad: number) {
    const g = this.rootEl.gfx, rr = this.rootEl.getBoundingClientRect(), z = g.viewport.zoom;
    const [vx, vy] = g.viewport.toViewCoord(b.x, b.y);
    return { L: rr.left + vx - pad, T: rr.top + vy - pad, W: b.w * z + pad * 2, H: b.h * z + pad * 2 };
  }
  private place() {
    const bs = this.boxes(); if (!bs.length) { this.close(); this.done(); return; }
    const u = this.screen(union(bs), 12);
    const set = (el: HTMLElement, r: { L: number; T: number; W: number; H: number }) => Object.assign(el.style, { left: r.L + 'px', top: r.T + 'px', width: r.W + 'px', height: r.H + 'px' });
    if (this.spread) bs.forEach((b, i) => this.veils[i] && set(this.veils[i], this.screen(b, 2)));
    else { set(this.veils[0], u); set(this.ring, u); }
    const bw = this.bar.offsetWidth || 220;
    if (this.spread && this.made.label.includes('get ')) { const l = this.screen(bs[bs.length - 1], 2); Object.assign(this.bar.style, { left: (l.L + l.W + 10) + 'px', top: (l.T + l.H / 2 - 17) + 'px' }); }   // beside the last new mark
    else Object.assign(this.bar.style, { left: Math.max(8, u.L + u.W - bw) + 'px', top: (u.T + u.H + 10) + 'px' });
  }
  private close() { cancelAnimationFrame(this.raf); this.veils.forEach(v => v.remove()); this.ring.remove(); this.bar.remove(); }
  keep() { this.close(); this.made.onKeep?.(); this.done(); }
  drop() {
    const store = this.rootEl.std.store, g = this.rootEl.gfx;
    store.captureSync();
    for (const id of this.made.ids) { const el: any = g.getElementById(id); if (!el) continue; if (el.flavour) store.deleteBlock(store.getBlock(id)!.model); else g.surface.deleteElement(id); }
    this.made.restore?.();
    removeCommentsOn(store, this.made.ids);
    store.captureSync();
    this.close(); this.done();
  }
}
