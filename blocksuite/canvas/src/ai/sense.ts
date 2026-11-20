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
import { cleanRefs } from './actions';
import { addComment, removeCommentsOn } from './comments';
import { toast } from './proposals';
import { snapshot as shot } from './snapshot';
import { markAi } from './provenance';
import { Trace } from './trace';
import { mountIntent, type GeneralIntent } from './intent';
import { mountEvidence } from './evidence';

const STABLE_MS = 1800, POLL_MS = 600, NEAR = 48;
const DEFAULT_FRAME = /^(frame|section|untitled)(\s*\d+)?$/i;

type Intent =
  | GeneralIntent
  | { type: 'section'; key: string; frame: any; title: string; inside: Set<string> }
  | { type: 'group'; key: string; anchor: Item; members: Item[] }
  | { type: 'mark'; key: string; sig: string; label: string; marks: { mark: Item; host: Item }[] }
  | { type: 'link'; key: string; from: Item; to: Item; line: Item; drawn: boolean; style: string }
  | { type: 'label'; key: string; members: Item[] }
  | { type: 'point'; key: string; label: Item; image: Item; line: Item; spot: [number, number] }   // a label with an arrow to a spot on a picture
  | { type: 'more'; key: string; item: Item }        // one thing circled: more like it
  | { type: 'stress'; key: string; item: Item };     // one thing underlined: why it matters

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
  let quietSince = 0, busy = false, pointerDown = false, pending: any = null;
  const dev: any = (window as any).cxSense = { log: [] as any[], enabled: true };
  const trace = new Trace(gfx, store);
  const general = mountIntent(rootEl, trace);
  mountEvidence(rootEl);
  // an "ask" answered with one of its options runs the general path again, with that option as the request
  general.dev.followUp = (i: GeneralIntent) => { if (busy || pending) return; busy = true; const stop = thinking(i); general.run(i, () => { pending = null; rebase(); }).then(p => { if (p && !p.isClosed()) pending = p; }).catch(e => console.warn('[intent]', e)).finally(() => { stop(); busy = false; }); };

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
    trace.poll(); general.tick();
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
      toast(code === 'no_model' ? 'Connect Claude in the side panel (Chat) to let the board help.' : code === 'not_granted' ? 'Claude was not allowed for this page.' : 'Couldn’t reach Claude just now.', undefined);
    }
    finally { stop(); busy = false; rebase(); }
  }, POLL_MS);

  // While Claude thinks: the 2×2 dots breathe at the top-left of the place it is thinking about. Nothing else.
  function thinking(intent: Intent): () => void {
    const area = intent.type === 'general' ? intent.area : intent.type === 'point' ? intent.label.box : intent.type === 'section' ? box(intent.frame) : intent.type === 'group' ? union([intent.anchor.box, ...intent.members.map(m => m.box)]) : intent.type === 'link' ? intent.line.box : intent.type === 'label' ? union(intent.members.map(m => m.box)) : intent.type === 'more' || intent.type === 'stress' ? intent.item.box : intent.marks[intent.marks.length - 1].host.box;
    const d = document.createElement('div'); d.className = 'cx-sense-think'; d.innerHTML = '<i></i><i></i><i></i><i></i>'; document.body.append(d);
    let raf = 0;
    const tick = () => { const rr = rootEl.getBoundingClientRect(); const [x, y] = gfx.viewport.toViewCoord(area.x, area.y); d.style.left = (rr.left + x - 18) + 'px'; d.style.top = (rr.top + y) + 'px'; /* level with the top edge */ raf = requestAnimationFrame(tick); };
    tick();
    return () => { cancelAnimationFrame(raf); d.remove(); };
  }

  // ── reading the settled board for a category ──
  function detect(touched: Set<string>): Intent | null {
    const r = readBoard(gfx);
    // only what the user made counts as the user saying something: the AI's own answers never set off another
    const touchedItems = r.items.filter(i => touched.has(i.id) && i.author === 'user');
    // 1 · a frame that now has a real name
    for (const i of touchedItems) if (i.kind === 'frame') {
      const f = gfx.getElementById(i.id) as any; const title = str(prop(f, 'title')).trim();
      if (!title || DEFAULT_FRAME.test(title) || title.length < 2) continue;
      const key = `section:${i.id}:${title.toLowerCase()}`; if (handled.has(key)) continue;
      const fb = box(f); const inside = new Set(r.items.filter(o => o.id !== i.id && contains(fb, o.box)).map(o => o.id));
      return { type: 'section', key, frame: f, title, inside };
    }
    // 2 · a line between two things: an arrow, or a pen stroke that starts on one thing and ends on another
    // several lines sharing an end are one form (a fan), not separate links: the general path reads them together
    { const g = general.detect(r, touched); if (g && g.forms.some(f => f.kind === 'fan-in' || f.kind === 'fan-out') && (!handled.has(g.key) || retry(g.key))) return g; }
    for (const i of touchedItems) {
      const el: any = gfx.getElementById(i.id); if (!el) continue;
      let from: Item | undefined, to: Item | undefined, drawn = false, style = 'line';
      if (i.kind === 'connector') {
        const s0 = el.source?.id, t0 = el.target?.id; if (!s0 || !t0) continue;
        from = r.byId.get(s0); to = r.byId.get(t0);
        if (str(el.text).trim()) continue;                                 // the user already said what it is
        const head = el.rearEndpointStyle && el.rearEndpointStyle !== 'None', tail = el.frontEndpointStyle && el.frontEndpointStyle !== 'None';
        style = head && tail ? 'two-way arrow' : head || tail ? 'arrow' : 'line';
        if (el.strokeStyle === 'dash') style = 'dashed ' + style;
      } else if (i.kind === 'drawing' || i.kind === 'highlight') {
        const pts: number[][] = el.points ?? []; if (pts.length < 4) continue;
        const b = el.elementBound, P = pts.map(q => [b.x + q[0], b.y + q[1]]);
        const things = r.items.filter(o => !['connector', 'drawing', 'highlight', 'frame', 'group'].includes(o.kind) && !r.relations.attached.has(o.ref));
        const near = (pt: number[], o: Item, pad: number) => pt[0] >= o.box.x - pad && pt[0] <= o.box.x + o.box.w + pad && pt[1] >= o.box.y - pad && pt[1] <= o.box.y + o.box.h + pad;
        const diag = Math.hypot(b.w, b.h), closed = Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < Math.max(40, diag * 0.28);
        // a loop around things: one thing → more like it; several → name them as a group
        // a loop with a line leaving it is part of a bigger statement: the general path reads the whole
        if (closed && b.w > 60 && b.h > 40 && r.items.some(c => c.kind === 'connector' && (c.arrow?.from === i.ref || c.arrow?.to === i.ref))) continue;
        if (closed && b.w > 60 && b.h > 40) {
          const inside = things.filter(o => { const cx = o.box.x + o.box.w / 2, cy = o.box.y + o.box.h / 2; let c = false; for (let k = 0, j = P.length - 1; k < P.length; j = k++) { const [xi, yi] = P[k], [xj, yj] = P[j]; if ((yi > cy) !== (yj > cy) && cx < (xj - xi) * (cy - yi) / (yj - yi) + xi) c = !c; } return c; });
          const key = `loop:${i.id}`; if (handled.has(key) && !retry(key)) continue;
          if (inside.length === 1) return { type: 'more', key, item: inside[0] };
          if (inside.length >= 2 && inside.length <= 12) return { type: 'label', key, members: inside };
          continue;
        }
        // a flat stroke just under one thing: it matters
        if (b.h < 28 && b.w > 40) {
          const over = things.find(o => b.y >= o.box.y + o.box.h - 12 && b.y <= o.box.y + o.box.h + 28 && Math.min(b.x + b.w, o.box.x + o.box.w) - Math.max(b.x, o.box.x) > Math.min(b.w, o.box.w) * 0.5);
          if (over && !things.some(o => o !== over && P.some(q => near(q, o, 4)))) { const key = `under:${i.id}`; if (!handled.has(key) || retry(key)) return { type: 'stress', key, item: over }; continue; }
        }
        // a line from one thing to another (arrow heads drawn in the same stroke are fine): the thing nearest the
        // start, and the other thing the last part of the stroke comes closest to
        from = things.filter(o => near(P[0], o, 24)).sort((a2, b2) => a2.box.w * a2.box.h - b2.box.w * b2.box.h)[0];
        const tail = P.slice(Math.floor(P.length * 0.5));
        to = things.filter(o => o.id !== from?.id && tail.some(q => near(q, o, 24))).sort((a2, b2) => Math.min(...tail.map(q => Math.hypot(q[0] - (a2.box.x + a2.box.w / 2), q[1] - (a2.box.y + a2.box.h / 2)))) - Math.min(...tail.map(q => Math.hypot(q[0] - (b2.box.x + b2.box.w / 2), q[1] - (b2.box.y + b2.box.h / 2)))))[0];
        drawn = true; style = 'hand-drawn arrow';
      } else continue;
      if (!from || !to || from.id === to.id || ['frame', 'group'].includes(from.kind) || ['frame', 'group'].includes(to.kind)) continue;
      // a short label with an arrow to a picture: the user is naming what they see at that spot
      { const img = [from, to].find(o => o.kind === 'image'), lab = [from, to].find(o => o !== img && ['text', 'sticky', 'shape', 'tag'].includes(o.kind) && o.text.trim().length >= 2 && o.text.trim().length <= 60);
        if (img && lab) {
          const key = `point:${i.id}`; if (handled.has(key) && !retry(key)) continue;
          let spot: [number, number] = [0.5, 0.5];
          if (i.kind === 'connector') { const end = el.source?.id === img.id ? el.source : el.target; if (Array.isArray(end?.position)) spot = [Number(end.position[0]) || 0.5, Number(end.position[1]) || 0.5]; }
          else { const pts: number[][] = el.points ?? [], b = el.elementBound, tip = img === to ? pts[pts.length - 1] : pts[0]; if (tip) spot = [Math.min(1, Math.max(0, (b.x + tip[0] - img.box.x) / img.box.w)), Math.min(1, Math.max(0, (b.y + tip[1] - img.box.y) / img.box.h))]; }
          return { type: 'point', key, label: lab, image: img, line: i, spot };
        } }
      if (i.kind === 'connector') continue;                            // lines the user draws with the tool: the general path reads them
      const key = `link:${i.id}`; if (handled.has(key) && !retry(key)) continue;
      return { type: 'link', key, from, to, line: i, drawn, style };
    }
    // 2b · any other form the user just settled (arrows into blanks, out of a list, into one thing, a line
    //      between two things, a tension, an open slot, a question …): the model decides what it means
    { const g = general.detect(r, touched); if (g && (!handled.has(g.key) || retry(g.key))) return g; }
    // 3 · the same mark beside two or more things
    const marks = new Map<string, { mark: Item; host: Item }[]>();
    for (const [mRef, hRef] of r.relations.attached) {
      const mark = r.byRef.get(mRef)!, host = r.byRef.get(hRef)!; if (!mark || !host) continue;
      const s = markSig(mark); if (!s) continue;
      (marks.get(s.sig) ?? marks.set(s.sig, []).get(s.sig)!).push({ mark, host });
    }
    for (const [sig, list] of marks) {
      const hosts = new Set(list.map(l => l.host.id));
      if (hosts.size < 2 || !list.some(l => l.mark.author === 'user' && (touched.has(l.mark.id) || touched.has(l.host.id)))) continue;
      const key = `mark:${sig}`; if (handled.has(key)) continue;
      return { type: 'mark', key, sig, label: markSig(list[0].mark)!.label, marks: list };
    }
    // 4 · a label with material set close to it, standing apart from the rest: a topic. A label is whatever
    // names a group the user's way: a sticky of any shape (a narrow strip on top counts), a shape with words,
    // a short heading, a pill. The group is everything chained to it by short gaps.
    const free = (i: Item) => !['frame', 'connector', 'group', 'drawing'].includes(i.kind) && !r.relations.attached.has(i.ref);
    const loose = r.items.filter(free);
    const isLabel = (o: Item) => o.text.trim().length > 1 && (o.kind === 'sticky' || o.kind === 'tag' || (o.kind === 'shape' && o.text.length <= 80) || (o.kind === 'text' && o.text.length <= 60));
    const chainFrom = (start: Item, max = 13) => {
      const seen = new Set<Item>([start]), queue = [start];
      while (queue.length && seen.size <= max) { const c = queue.shift()!; for (const o of loose) if (!seen.has(o) && gap(o.box, c.box) <= NEAR) { seen.add(o); queue.push(o); } }
      return [...seen];
    };
    const apart = (comp: Item[]) => { const cl = union(comp.map(o => o.box)); return loose.every(o => comp.includes(o) || gap(o.box, cl) >= 72); };
    for (const a of loose.filter(isLabel)) {
      const comp = chainFrom(a, 9);
      if (comp.length < 2 || comp.length > 9) continue;                    // alone, or part of a pile
      if (a.author !== 'user' || !comp.some(o => touched.has(o.id) && o.author === 'user')) continue;   // nothing here just changed (by the user)
      if (comp.filter(isLabel).length > 2) continue;                        // several labels together read as a cluster of ideas
      if (!comp.some(o => !isLabel(o))) continue;                           // needs material beside it
      if (!apart(comp)) continue;                                           // it has to stand apart, in open space
      const key = `group:${a.id}:${a.text.trim().toLowerCase()}`; if (handled.has(key) && !retry(key)) continue;
      return { type: 'group', key, anchor: a, members: comp.filter(o => o !== a) };
    }
    // 5 · material gathered by hand with nothing naming it: offer a label on top of the group
    for (const t of touchedItems.filter(o => free(o) && !isLabel(o))) {
      const comp = chainFrom(t);
      if (comp.length < 3 || comp.length > 12 || comp.some(isLabel) || !apart(comp)) continue;
      const key = 'label:' + comp.map(o => o.id).sort().join(','); if (handled.has(key) && !retry(key)) continue;
      return { type: 'label', key, members: comp };
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
    if (intent.type === 'general') { const p = await general.run(intent, () => { pending = null; rebase(); }); if (p && !p.isClosed()) pending = p; return; }
    if (intent.type === 'link') return respondLink(intent);
    if (intent.type === 'label') return respondLabel(intent);
    if (intent.type === 'stress') return respondStress(intent);
    if (intent.type === 'point') return respondPoint(intent);
    if (intent.type === 'more') { const it = intent.item; return respond({ type: 'group', key: intent.key + ':g', anchor: it, members: [], circled: true } as any); }
    const r = readBoard(gfx);
    const reading = toPrompt(r);
    const refOf = (id: string) => r.byId.get(id)?.ref;
    let task = '', exclude = new Set<string>();
    if (intent.type === 'section') {
      exclude = new Set([...intent.inside, intent.frame.id]);
      const inside = r.items.filter(o => intent.inside.has(o.id));
      const material = inside.filter(o => o.kind !== 'sticky');
      task = `The user drew a section and named it "${intent.title}".` + (material.length
        ? ` They already put ${material.map(o => o.ref).join(', ')} in it` + (inside.some(o => o.kind === 'sticky') ? `, and a sticky that labels it (${inside.filter(o => o.kind === 'sticky').map(o => o.ref).join(', ')}): that sticky is the criterion, not content` : '') + `. Find more material of the same kind (papers, links, cases) for it: pick such things on the board outside it, never stickies, and add sources.`
        : ` Pick the things on the board, outside it, that belong in it.`);
    } else if (intent.type === 'group') {
      exclude = new Set([intent.anchor.id, ...intent.members.map(m => m.id)]);
      task = (intent as any).circled ? `The user circled ${intent.anchor.ref} (${intent.anchor.text.slice(0, 120)}): they want more like it. Gather things like it: from the board (refs) and literature or cases (found), to sit beside it.` : `The user put a sticky "${intent.anchor.text.trim()}" (${intent.anchor.ref}) in open space and set ${intent.members.map(m => m.ref).join(', ')} beside it. The sticky names a topic, and what sits beside it is material on that topic. Gather more for this topic to sit beside it: things already on the board (refs) and literature or cases on the topic (found). Only this one topic: do not sort the rest of the board.`;
      if ((intent as any).circled) task = task.split(' The user put a sticky')[0];
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
- refs: things already on the board that clearly belong. Judge by their words and pictures, not by position. At most 8. Never refs that are marks, frames or lines, never the ones listed as already in. "why": only for the one or two picks where the tie is an insight (a tension, a link to a person or goal on the board, something non-obvious), a few words in English; never bookkeeping (missing year, author, format); leave it out for the rest.
- found: up to ${intent.type === 'mark' ? 0 : 3}; ${foundRule}. In English.
- more: always [].
- Few and right beats many: if nothing fits, return {"refs":[],"found":[],"more":[]}.`;
    const byText = new Map<string, string[]>();
    for (const it of r.items) { const t = it.text.toLowerCase().replace(/\s+/g, ' ').trim(); if (t.length > 8 && !['connector', 'frame'].includes(it.kind)) (byText.get(t) ?? byText.set(t, []).get(t)!).push(it.ref); }
    const copies = [...byText.values()].filter(v => v.length > 1).map(v => v.join(' = '));
    const user = `BOARD\n${reading}\n` + (copies.length ? `\nCOPIES (the same thing pasted more than once; count each as one, pick at most one of them, and none if one is already in): ${copies.join('; ')}\n` : '') + `\nCATEGORY\n${task}\nAlready in it: ${[...exclude].map(refOf).filter(Boolean).join(', ') || 'nothing'}`;
    const mock = (window as any).cxMockSense;
    const raw = mock ? (typeof mock === 'function' ? await mock(intent, user) : mock) : await ask(sys, user);
    const ans = typeof raw === 'string' ? parseAnswer(raw) : raw;
    dev.log.unshift({ intent: intent.key, task, answer: ans }); dev.log.length = Math.min(dev.log.length, 10);
    const used = new Set<string>(exclude);
    const take = (list: any[]): { it: Item; why: string }[] => (list ?? []).map((x: any) => {
      const ref = typeof x === 'string' ? x : x?.ref; const it = r.byRef.get(String(ref));
      if (!it || used.has(it.id) || ['frame', 'connector', 'group'].includes(it.kind) || r.relations.attached.has(it.ref)) return null;
      used.add(it.id); return { it, why: typeof x === 'string' ? '' : cleanRefs(String(x?.why ?? ''), r) };
    }).filter(Boolean) as any;
    const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();
    const have = new Set([...exclude].map(id => norm(r.byId.get(id)?.text ?? '')).filter(Boolean));
    const holdsMaterial = intent.type === 'section' ? r.items.some(o => intent.inside.has(o.id) && o.kind !== 'sticky')
      : intent.type === 'group' ? intent.members.some(m => m.kind !== 'sticky') : false;
    const picks = take(ans.refs).filter(p => {
      if (holdsMaterial && p.it.kind === 'sticky') return false;          // stickies are labels here, not content
      const t = norm(p.it.text); if (t && have.has(t)) return false;       // already there (a copy of a copy)
      if (t) have.add(t); return true;
    });
    const found: any[] = Array.isArray(ans.found) ? ans.found.slice(0, 3) : [];
    const more = false && Array.isArray(ans.more) ? ans.more.slice(0, 4).map((m: any) => ({ title: String(m.title ?? '').trim(), picks: take(m.refs), found: Array.isArray(m.found) ? m.found.slice(0, 2) : [] })).filter((m: any) => m.title && (m.picks.length || m.found.length)) : [];
    if (!picks.length && !found.length && !more.length) return;
    store.captureSync();
    const made = intent.type === 'mark' ? placeMarks(intent, picks) : intent.type === 'group' ? await placeGroup(intent, picks.map(p => p.it), found, r) : await placeCopies(intent, picks.map(p => p.it), found, r);
    store.captureSync();
    if (made.ids.length) pending = new Pending(rootEl, made, intent, () => { pending = null; rebase(); });
  }

  // ── placing: copies in a grid inside the section, or close beside the group ──
  type Made = { ids: string[]; restore?: () => void; label: string; onKeep?: () => void; focus?: () => Box[]; spread?: boolean; beside?: boolean };
  const frames2 = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
  // Make the copies where the user is looking (off-screen notes never get their real height), wait for the
  // words to lay out, then place them by their real sizes.
  async function build(picks: Item[], found: any[]): Promise<{ ids: string[]; sizes: { w: number; h: number }[] }> {
    const vb = gfx.viewport.viewportBounds; const stage = { x: vb.x + vb.w * 0.4, y: vb.y + vb.h * 0.3 };
    const ids: string[] = [];
    for (const p of picks) { const id = duplicate(p.id, { ...stage, w: p.box.w, h: p.box.h }); if (id) ids.push(id); }
    for (const f of found) ids.push(sourceCard(f, { ...stage, w: 260, h: 120 }));
    await frames2(); await frames2();
    return { ids, sizes: ids.map(id => { const e: any = gfx.getElementById(id); const b = e?.elementBound; return { w: b?.w ?? 260, h: b?.h ?? 140 }; }) };
  }
  const moveTo = (id: string, b: Box) => { const e: any = gfx.getElementById(id); if (!e) return; const v = xywh(b); if (e.flavour) store.updateBlock(e, { xywh: v }); else surf.updateElement(id, { xywh: v }); };

  async function placeCopies(intent: Extract<Intent, { type: 'section' }>, picks: Item[], found: any[], r: Reading): Promise<Made> {
    const GAP = 16, PAD = 32;
    const { ids, sizes } = await build(picks, found);
    const f = intent.frame, fb = box(f);
    const inside = r.items.filter(o => intent.inside.has(o.id));
    const x0 = fb.x + PAD, y0 = inside.length ? Math.max(...inside.map(o => o.box.y + o.box.h)) + 24 : fb.y + PAD;
    const width = Math.max(fb.w - PAD * 2, ...sizes.map(a => a.w));
    const spots = flow(sizes, x0, y0, width, GAP);
    ids.forEach((id, i) => moveTo(id, { ...spots[i], w: sizes[i].w, h: sizes[i].h }));
    await frames2();
    // the section grows to wrap everything it now holds
    const all = [...ids.map(id => box(gfx.getElementById(id))), ...inside.map(o => o.box)];
    const u = union(all);
    const old = prop(f, 'xywh');
    const nb = { x: fb.x, y: fb.y, w: Math.max(fb.w, u.x + u.w + PAD - fb.x), h: Math.max(fb.h, u.y + u.h + PAD - fb.y) };
    let restore: (() => void) | undefined;
    if (nb.w !== fb.w || nb.h !== fb.h) { store.updateBlock(f, { xywh: xywh(nb) }); restore = () => store.updateBlock(f, { xywh: old }); }
    const kids = { ...(prop(f, 'childElementIds') ?? {}) }; ids.forEach(id => { kids[id] = true; });
    try { store.updateBlock(f, { childElementIds: kids }); } catch { /* older frame model */ }
    return { ids, restore, label: `${ids.length} for “${intent.title}”` };
  }

  // A topic sticky with its material: more of the same, close beside it, nothing else on the board touched.
  async function placeGroup(intent: Extract<Intent, { type: 'group' }>, picks: Item[], found: any[], r: Reading): Promise<Made> {
    const GAP = 16;
    const a = intent.anchor, cl = union([a.box, ...intent.members.map(m => m.box)]);
    const { ids, sizes } = await build(picks, found);
    const W = Math.max(cl.w, 3 * 260 + 2 * GAP);
    const h = (x: number, y: number) => { const sp = flow(sizes, x, y, W, GAP); return { sp, box: union(sp) }; };
    const others = r.items.filter(o => !['frame', 'connector'].includes(o.kind) && o.id !== a.id && !intent.members.some(m => m.id === o.id));
    const clearOf = (b: Box) => !others.some(o => overlaps(o.box, { x: b.x - 8, y: b.y - 8, w: b.w + 16, h: b.h + 16 }));
    // follow the user's own arrangement: material stacked in a column continues down that column,
    // a row continues to the right; otherwise a grid below the group, or to its right
    const mat = intent.members.filter(m => m.kind !== 'sticky').sort((p, q) => p.box.y - q.box.y || p.box.x - q.box.x);
    const along = (dir: 'col' | 'row') => {
      const last = mat[mat.length - 1].box; const sp: Box[] = []; let x = dir === 'col' ? Math.min(...mat.map(m => m.box.x)) : last.x + last.w + GAP, y = dir === 'col' ? last.y + last.h + GAP : Math.min(...mat.map(m => m.box.y));
      for (const z of sizes) { sp.push({ x, y, w: z.w, h: z.h }); if (dir === 'col') y += z.h + GAP; else x += z.w + GAP; }
      return { sp, box: union(sp) };
    };
    const xs = mat.map(m => m.box.x), ys = mat.map(m => m.box.y);
    const isCol = mat.length >= 1 && Math.max(...xs) - Math.min(...xs) < 24 && (mat.length > 1 || mat[0].box.x > a.box.x + a.box.w - 4);
    const isRow = mat.length >= 2 && Math.max(...ys) - Math.min(...ys) < 24;
    const tries = [...(isCol ? [along('col')] : isRow ? [along('row')] : []), h(cl.x, cl.y + cl.h + GAP), h(cl.x + cl.w + GAP * 2, cl.y)];
    const pick = tries.find(t => sizes.length && clearOf(t.box)) ?? tries[0];
    ids.forEach((id, i) => moveTo(id, { ...pick.sp[i], w: sizes[i].w, h: sizes[i].h }));
    return { ids, label: `${ids.length} for “${a.text.trim()}”` };
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

  // ── a line between two things: name the relation on the line, explain it when there is more to say,
  // and offer extensions behind a small "+n" on the line (not opened until asked) ──
  const LINE = { color: '#6e6e73', width: 2 };
  const labelProps = (text: string) => {
    const c = document.createElement('canvas').getContext('2d')!; c.font = '12px Inter, sans-serif';
    const t = new Y.Text(); t.insert(0, text);
    return { text: t, labelDisplay: true, labelOffset: { distance: 0.5, anchor: 'center' }, labelXYWH: [0, 0, Math.ceil(c.measureText(text).width) + 14, 20],
      labelStyle: { color: '#3a3a3c', fontSize: 12, fontFamily: 'blocksuite:surface:Inter', fontWeight: '400', fontStyle: 'normal', textAlign: 'center' } };
  };
  const labelBox = (id: string): Box[] => { const e: any = gfx.getElementById(id); const l = e?.labelXYWH; return l ? [{ x: l[0], y: l[1], w: l[2], h: l[3] }] : e ? [box(e)] : []; };

  async function respondLink(intent: Extract<Intent, { type: 'link' }>) {
    const r = readBoard(gfx);
    const sys = `Someone drew a ${intent.style} on a whiteboard from one thing to another. Read what the two things are and say what the line means.
Answer with JSON only: {"label":"2–4 words","comment":"","extensions":[{"type":"bridge|next|counter","ref":"s3 (optional, a thing already on the board)","title":"…","meta":"venue · year · authors","summary":"one line"}]}
- Never write internal refs (s3, n12 …) in label, comment or summaries: name things by their words.
- label: the relation, in English, short enough to sit on the line ("instruction → vision", "counterexample", "same idea, 30 years apart"). An arrow reads from the first thing to the second.
- comment: 1–2 sentences, only an insight: a tension, a shift, a conflict with the people or goals on the board, a step that is missing. Never bookkeeping (missing year or author, format) and never a restatement of the label. Otherwise "".
- extensions: up to 3 things worth adding because of this link: a bridge between the two, the next step after the second, or a counterpoint. Prefer things already on the board (ref); otherwise ${online() ? 'real sources you verified with search, with url' : 'only well-known real works you are sure of, no url'}.`;
    const user = `BOARD\n${toPrompt(r)}\n\nLINE\n${intent.style} from ${intent.from.ref} (${intent.from.text.slice(0, 160)}) to ${intent.to.ref} (${intent.to.text.slice(0, 160)}).`;
    const mock = (window as any).cxMockSense;
    const raw = mock ? (typeof mock === 'function' ? await mock(intent, user) : mock) : await ask(sys, user);
    const ans = typeof raw === 'string' ? parseAnswer(raw) : raw;
    dev.log.unshift({ intent: intent.key, answer: ans }); dev.log.length = Math.min(dev.log.length, 10);
    const label = cleanRefs(String(ans.label ?? ''), r); if (!label) return;
    store.captureSync();
    let lineId: string, made: Made;
    if (intent.drawn) {
      // a pen stroke becomes a proper arrow; the stroke goes once the arrow is kept
      lineId = surf.addElement({ type: 'connector', source: { id: intent.from.id }, target: { id: intent.to.id }, mode: 2, stroke: LINE.color, strokeWidth: LINE.width,
        strokeStyle: 'solid', rearEndpointStyle: 'Arrow', frontEndpointStyle: 'None', index: nextTop(), ...labelProps(label) });
      const stroke = intent.line.id;
      made = { ids: [lineId], label: `“${label}”`, focus: () => labelBox(lineId), spread: true, beside: true,
        onKeep: () => { try { surf.deleteElement(stroke); } catch { /* already gone */ } } };
    } else {
      lineId = intent.line.id;
      surf.updateElement(lineId, labelProps(label));
      made = { ids: [], label: `“${label}”`, focus: () => labelBox(lineId), spread: true, beside: true,
        restore: () => { surf.updateElement(lineId, { text: new Y.Text(), labelDisplay: false }); removeCommentsOn(store, [lineId]); } };
    }
    store.captureSync();
    const comment = cleanRefs(String(ans.comment ?? ''), r); if (comment) addComment(store, lineId, comment);
    const ext = Array.isArray(ans.extensions) ? ans.extensions.slice(0, 3) : [];
    const keep0 = made.onKeep;
    made.onKeep = () => { keep0?.(); if (ext.length) chip(lineId, ext, r, intent); };
    pending = new Pending(rootEl, made, intent, () => { pending = null; rebase(); });
  }

  // A label pointed at a spot on a picture: cards beside the label — what it means there, a source, and what
  // else on the board shows the same idea (tied to it with a dashed line).
  async function respondPoint(intent: Extract<Intent, { type: 'point' }>) {
    const r = readBoard(gfx);
    const word = intent.label.text.trim().replace(/\s+/g, ' ');
    const [px, py] = intent.spot;
    const sys = `Someone studying pictures on a whiteboard typed a short label and drew an arrow from it to a spot on one picture: they are naming what they see there (light, shadow, anatomy, pose or composition). You are shown that picture. The spot is about ${Math.round(px * 100)}% from the left and ${Math.round(py * 100)}% from the top.
Answer with JSON only: {"cards":[{"kind":"insight|source|related","title":"…","meta":"","summary":"…","url":"","ref":""}]}
- At most 3 cards, at most one of each kind, in this order.
- insight: what the label means at that spot in this very picture, and what to look at. title 2–5 words, summary at most 28 words.
- source: one real reading on it (a book, a paper, a museum page). meta = author · year. ${online() ? 'Give url only if you verified it with search.' : 'No url; only a well-known work you are sure of.'} summary: one line on why it helps.
- related: one other thing already on the board that shows the same idea or its opposite: ref = its id from the board text, title = its name in words, summary = how it relates. Leave it out if nothing fits.
- English. Never invent facts. Never write refs (s3, n12) inside title or summary.`;
    const user = `BOARD\n${toPrompt(r)}\n\nLABEL\n"${word}"\n\nPICTURE\n${intent.image.ref}${intent.image.text ? ': ' + intent.image.text.slice(0, 160) : ''}`;
    const mock = (window as any).cxMockSense;
    let picture: Blob | null = null; try { picture = await shot(rootEl, intent.image.box, 1024, 0); } catch { /* words only */ }
    const raw = mock ? (typeof mock === 'function' ? await mock(intent, user) : mock) : await ask(sys, user, picture);
    const ans = typeof raw === 'string' ? parseAnswer(raw) : raw;
    dev.log.unshift({ intent: intent.key, answer: ans }); dev.log.length = Math.min(dev.log.length, 10);
    const cards = (Array.isArray(ans.cards) ? ans.cards : []).filter((c: any) => c && String(c.title ?? '').trim()).slice(0, 3);
    if (!cards.length) return;
    store.captureSync();
    const lb = intent.label.box, W = 240, ids: string[] = [];
    const gray = { color: 'var(--affine-text-secondary-color)' };
    const P = (t: string, a?: any) => new Text(a ? [{ insert: t, attributes: a }] as any : t);
    let y = lb.y + lb.h + 16;
    for (const c of cards) {
      const kind = String(c.kind ?? 'insight'), title = cleanRefs(String(c.title), r), sum = cleanRefs(String(c.summary ?? ''), r);
      const kicker = kind === 'source' ? 'SOURCE' + (c.meta ? ' · ' + String(c.meta) : '') : kind === 'related' ? 'ON THIS BOARD' : 'INSIGHT';
      const id = store.addBlock('affine:note', { xywh: xywh({ x: lb.x, y, w: W, h: 120 }), background: '#ffffff', index: nextTop(),
        edgeless: { style: { borderRadius: 8, borderSize: 0, borderStyle: 'none', shadowType: '--affine-note-shadow-box' } } } as any, store.root.id);
      store.addBlock('affine:paragraph', { text: P(kicker, gray) }, id);
      store.addBlock('affine:paragraph', { text: P(title, { bold: true, ...(c.url && /^https?:/.test(String(c.url)) ? { link: String(c.url) } : {}) }) }, id);
      if (sum) store.addBlock('affine:paragraph', { text: P(sum, gray) }, id);
      ids.push(id);
      const other = kind === 'related' && c.ref ? r.byRef.get(String(c.ref)) : null;
      if (other && other.id !== intent.image.id) ids.push(surf.addElement({ type: 'connector', source: { id }, target: { id: other.id }, mode: 2, stroke: LINE.color, strokeWidth: LINE.width, strokeStyle: 'dash', rearEndpointStyle: 'None', frontEndpointStyle: 'None', index: nextTop() }));
      y += 58 + Math.ceil((title.length * 8.2) / (W - 40)) * 22 + Math.ceil((sum.length * 7.2) / (W - 40)) * 22 + 28;
    }
    markAi(store, ids);
    store.captureSync();
    pending = new Pending(rootEl, { ids, label: `${cards.length} on “${word.slice(0, 24)}”`, focus: () => ids.map(id => gfx.getElementById(id)).filter(Boolean).map((e: any) => box(e)), spread: true, beside: false }, intent, () => { pending = null; rebase(); });
  }

  // An underline says "this matters": one comment with the insight (how it connects, what it conflicts with)
  async function respondStress(intent: Extract<Intent, { type: 'stress' }>) {
    const r = readBoard(gfx);
    const sys = `Someone underlined one thing on a whiteboard: it matters to them. Say in 1–2 sentences the insight about it that the board supports: what it connects to, what it conflicts with (people, goals, other material), or what follows from it. Never bookkeeping, never a summary of the thing. If there is no insight, answer "".
Answer with JSON only: {"comment":"…"}. In English. Never write refs (s3, n12): name things by their words.`;
    const user = `BOARD\n${toPrompt(r)}\n\nUNDERLINED\n${intent.item.ref}: ${intent.item.text.slice(0, 300)}`;
    const mock = (window as any).cxMockSense;
    const raw = mock ? (typeof mock === 'function' ? await mock(intent, user) : mock) : await ask(sys, user);
    const ans = typeof raw === 'string' ? parseAnswer(raw) : raw;
    dev.log.unshift({ intent: intent.key, answer: ans });
    const c0 = cleanRefs(String(ans.comment ?? ''), r); if (c0) addComment(store, intent.item.id, c0);
  }

  // A label for a group the user gathered by hand: a white card with a colour chip, a bold name and a quiet
  // line on what unites them, set just above the group (FigJam's section header, as a thing of its own).
  async function respondLabel(intent: Extract<Intent, { type: 'label' }>) {
    const r = readBoard(gfx);
    const sys = `Someone gathered a few things on a whiteboard into one group by hand, without naming it. Name the group.
Answer with JSON only: {"title":"2–4 words","subtitle":"what unites them, at most 8 words","colour":"blue|teal|green|yellow|orange|red|pink|violet"}
- Specific, not generic ("AI answers away from the board", not "Group 1"). In English. Never write refs (s3, n12).`;
    const user = `BOARD\n${toPrompt(r)}\n\nGROUP\n${intent.members.map(m => `${m.ref}: ${m.text.replace(/\s+/g, ' ').slice(0, 140)}`).join('\n')}`;
    const mock = (window as any).cxMockSense;
    const raw = mock ? (typeof mock === 'function' ? await mock(intent, user) : mock) : await ask(sys, user);
    const ans = typeof raw === 'string' ? parseAnswer(raw) : raw;
    dev.log.unshift({ intent: intent.key, answer: ans }); dev.log.length = Math.min(dev.log.length, 10);
    const title = cleanRefs(String(ans.title ?? ''), r), sub = cleanRefs(String(ans.subtitle ?? ''), r);
    if (!title) return;
    store.captureSync();
    const ids = labelCard(union(intent.members.map(m => m.box)), title, sub, String(ans.colour ?? 'blue'), r, intent.members);
    store.captureSync();
    pending = new Pending(rootEl, { ids, label: `Name this group “${title}”`, focus: () => [box(gfx.getElementById(ids[0]))], spread: true, beside: false }, intent, () => { pending = null; rebase(); });
  }
  const TINTS: Record<string, [string, string, string]> = {   // bar, title, subtitle
    blue: ['#e8f4ff', '#0f4c86', '#5d87b0'], teal: ['#e3f8f6', '#0e5e58', '#4f8f89'], green: ['#e9f8ec', '#1f6b2f', '#5f9a6b'],
    yellow: ['#fff7dd', '#7a5a00', '#a68a3c'], orange: ['#fff1e5', '#8a4b0f', '#b07a48'], red: ['#ffece8', '#8f2a17', '#bd6a5a'],
    pink: ['#ffeef8', '#8a2463', '#b46a96'], violet: ['#f3edff', '#4b2a99', '#8a72c4'], purple: ['#f3edff', '#4b2a99', '#8a72c4'],
  };
  function labelCard(over: Box, title: string, sub: string, colour: string, r: Reading, members: Item[]): string[] {
    const [bar, ink, soft] = TINTS[colour.toLowerCase()] ?? TINTS.blue;
    const c = document.createElement('canvas').getContext('2d')!;
    c.font = '600 18px Inter, sans-serif'; const tw = c.measureText(title).width; c.font = '400 12px Inter, sans-serif'; const sw = sub ? c.measureText(sub).width : 0;
    const w = Math.max(over.w, Math.ceil(Math.max(tw, sw)) + 32), h = sub ? 62 : 44;
    const others = r.items.filter(o => !members.includes(o) && !['frame', 'connector', 'drawing', 'highlight'].includes(o.kind));   // the user's own loop is not in the way
    const nw = Math.ceil(Math.max(tw, sw)) + 32;   // beside the group it is only as wide as its words
    const cands = [{ x: over.x, y: over.y - h - 12, w, h }, { x: over.x, y: over.y + over.h + 12, w, h }, { x: over.x - nw - 16, y: over.y, w: nw, h }, { x: over.x + over.w + 16, y: over.y, w: nw, h }];
    const at = cands.find(b0 => !others.some(o => overlaps(o.box, { x: b0.x - 4, y: b0.y - 4, w: b0.w + 8, h: b0.h + 8 }))) ?? cands[0];
    const tx = (s0: string, y: number, size: number, weight: string, color: string, wd: number) => { const t = new Y.Text(); t.insert(0, s0); return surf.addElement({ type: 'text', index: nextTop(), xywh: xywh({ x: at.x + 16, y, w: wd + 8, h: Math.round(size * 1.3) }), text: t, color, fontSize: size, fontWeight: weight, fontFamily: 'blocksuite:surface:Inter', textAlign: 'left' }); };
    const ids = [surf.addElement({ type: 'shape', shapeType: 'rect', radius: 0.14, index: nextTop(), xywh: xywh(at), filled: true, fillColor: bar, strokeColor: 'transparent', strokeWidth: 0, text: new Y.Text() })];
    ids.push(tx(title, at.y + (sub ? 10 : 11), 18, '600', ink, tw));
    if (sub) ids.push(tx(sub, at.y + 37, 12, '400', soft, sw));
    return ids;
  }

  // "+n" on the line: opens the extensions as a pending set below the line, tied to it by a dashed stem
  function chip(lineId: string, ext: any[], r: Reading, intent: Extract<Intent, { type: 'link' }>) {
    const c = document.createElement('button'); c.className = 'cx-link-chip'; c.textContent = '+' + ext.length; c.setAttribute('aria-label', `${ext.length} more on this link`);
    document.body.append(c);
    let raf = 0;
    const tick = () => {
      const e: any = gfx.getElementById(lineId); if (!e) { cancelAnimationFrame(raf); c.remove(); return; }
      const l = labelBox(lineId)[0]; const rr = rootEl.getBoundingClientRect(); const [x, y] = gfx.viewport.toViewCoord(l.x + l.w, l.y + l.h / 2);
      c.style.left = (rr.left + x + 6) + 'px'; c.style.top = (rr.top + y - 10) + 'px'; raf = requestAnimationFrame(tick);
    };
    tick();
    c.onclick = async () => {
      cancelAnimationFrame(raf); c.remove();
      if (pending) return;
      busy = true;
      try {
        const picks = ext.map(x => x.ref && r.byRef.get(String(x.ref))).filter(Boolean) as Item[];
        const found = ext.filter(x => !(x.ref && r.byRef.get(String(x.ref)))).map(x => ({ ...x, meta: [x.type === 'bridge' ? 'Bridge' : x.type === 'next' ? 'Next step' : x.type === 'counter' ? 'Counterpoint' : '', x.meta].filter(Boolean).join(' · ') }));
        store.captureSync();
        const { ids, sizes } = await build(picks, found);
        const e: any = gfx.getElementById(lineId); const mid: number[] = e.getPointByOffsetDistance ? e.getPointByOffsetDistance(0.5) : [box(e).x + box(e).w / 2, box(e).y + box(e).h / 2];
        const totalW = sizes.reduce((a, b) => a + b.w, 0) + 16 * (sizes.length - 1);
        const others = readBoard(gfx).items.filter(o => !['connector', 'frame', 'drawing'].includes(o.kind) && !ids.includes(o.id));
        let y = Math.max(intent.from.box.y + intent.from.box.h, intent.to.box.y + intent.to.box.h, mid[1]) + 72, x0 = mid[0] - totalW / 2;
        for (let k = 0; k < 30; k++) { const row = { x: x0, y, w: totalW, h: Math.max(...sizes.map(z => z.h)) }; if (!others.some(o => overlaps(o.box, row))) break; y += 48; }
        let x = x0; ids.forEach((id, i) => { moveTo(id, { x, y, w: sizes[i].w, h: sizes[i].h }); x += sizes[i].w + 16; });
        const stem = surf.addElement({ type: 'connector', source: { position: [mid[0], mid[1]] }, target: { id: ids[Math.floor(ids.length / 2)] }, mode: 2, stroke: '#aeaeb2', strokeWidth: 1.5,
          strokeStyle: 'dash', rearEndpointStyle: 'None', frontEndpointStyle: 'None', index: nextTop() });
        store.captureSync();
        const cards = [...ids];
        // bring them into view, with the line they came from
        const shown = union([...cards.map(id => box(gfx.getElementById(id))), intent.from.box, intent.to.box]); const vb = gfx.viewport.viewportBounds;
        if (shown.y + shown.h > vb.y + vb.h || shown.x < vb.x || shown.x + shown.w > vb.x + vb.w) try { gfx.viewport.setViewportByBound(shown, [60, 60, 140, 60], true); } catch { /* keep view */ }
        pending = new Pending(rootEl, { ids: [...cards, stem], label: `${cards.length} from this link`, focus: () => cards.map(id => gfx.getElementById(id)).filter(Boolean).map((el: any) => box(el)) }, intent, () => { pending = null; rebase(); });
      } finally { busy = false; }
    };
  }

  function flow(sz: { w: number; h: number }[], x0: number, y0: number, width: number, g: number): Box[] {
    const out: Box[] = []; let x = x0, y = y0, rowH = 0;
    for (const s of sz) { if (x > x0 && x + s.w > x0 + width) { x = x0; y += rowH + g; rowH = 0; } out.push({ x, y, w: s.w, h: s.h }); x += s.w + g; rowH = Math.max(rowH, s.h); }
    return out;
  }

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
  constructor(private rootEl: any, private made: { ids: string[]; restore?: () => void; label: string; onKeep?: () => void; focus?: () => Box[]; spread?: boolean; beside?: boolean }, intent: Intent, private done: () => void) {
    // marks are scattered over the user's things: each copy fades on its own and only the bar carries the dots
    // marks and topic groups sit among the user's own things: each copy fades on its own (one box would
    // fade the user's things too), and the bar carries the dots
    this.spread = made.spread ?? (intent.type !== 'section' && intent.type !== 'link');
    this.ring.className = 'cx-sense-ring';
    this.ring.innerHTML = '<span class="cx-sense-dots"><i></i><i></i><i></i><i></i></span>';
    this.bar.className = 'cx-sense-bar';
    this.bar.innerHTML = `${this.spread ? '<span class="cx-sense-dots"><i></i><i></i><i></i><i></i></span>' : ''}<span class="cx-sense-label"></span><button class="ok" aria-label="Keep all">${TICK}</button><button aria-label="Remove all">${CROSS}</button>`;
    (this.bar.querySelector('.cx-sense-label') as HTMLElement).textContent = made.label;
    (this.bar.querySelector('.ok') as HTMLElement).onclick = () => this.keep();
    (this.bar.querySelectorAll('button')[1] as HTMLElement).onclick = () => this.drop();
    const n = this.spread ? (made.focus ? made.focus().length : made.ids.length) : 1;
    for (let i = 0; i < n; i++) { const v = document.createElement('div'); v.className = 'cx-sense-veil'; this.veils.push(v); }
    document.body.append(...this.veils, ...(this.spread ? [] : [this.ring]), this.bar);
    const tick = () => { this.place(); this.raf = requestAnimationFrame(tick); };
    tick();
  }
  private boxes(): Box[] { if (this.made.focus) return this.made.focus(); const g = this.rootEl.gfx; return this.made.ids.map(id => g.getElementById(id)).filter(Boolean).map((e: any) => box(e)); }
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
    if (this.spread && (this.made.beside || this.made.label.includes('get '))) { const l = this.screen(bs[bs.length - 1], 2); Object.assign(this.bar.style, { left: (l.L + l.W + 10) + 'px', top: (l.T + l.H / 2 - 17) + 'px' }); }   // beside the last new mark
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
