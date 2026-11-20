// Drawing a general-path answer on the board, in the board's own visual language.
//
// The model says what each child is and roughly how the set is laid out (tidy, radial, in sequence, beside
// each list item, stacked under a heading, on a line). This file decides where exactly, from the user's own
// geometry: their blanks are filled first; new cards copy the user's own sticky (size, colour, font) and
// continue their column, row or ring at their spacing; lines copy the user's own line style. Nothing ever
// lands on top of anything else. Everything stays pending until one ✓, and a fork lets the user flip between
// two readings in place before choosing.

import * as Y from 'yjs';
import { Text } from '@blocksuite/affine/store';
import { generateKeyBetween } from '@blocksuite/affine/std/gfx';
import { CARD_STYLE, FILL, TEXT, snap } from '../design';
import { addComment, removeCommentsOn } from './comments';
import { setEvidence, clearEvidence } from './evidence';
import { isBlank, type Form } from './forms';
import { markAi } from './provenance';
import type { Box, Item, Reading } from './reading';
import type { Card, V5 } from './validate';

const TICK = '<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.2l2.3 2.3L9.5 3.8" stroke="#fff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CROSS = '<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2l-6 6" stroke="#6e6e73" stroke-width="1.4" stroke-linecap="round"/></svg>';

const xywh = (b: Box) => `[${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}]`;
const union = (bs: Box[]): Box => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const b of bs) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); } return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };
const hit = (a: Box, b: Box, m = 12) => a.x < b.x + b.w + m && a.x + a.w + m > b.x && a.y < b.y + b.h + m && a.y + a.h + m > b.y;
const cx = (b: Box) => b.x + b.w / 2, cy = (b: Box) => b.y + b.h / 2;
const median = (v: number[]) => { if (!v.length) return 0; const s = [...v].sort((a, b) => a - b); return s[s.length >> 1]; };
const frames2 = () => new Promise(res => requestAnimationFrame(() => requestAnimationFrame(res)));
/** The largest type size (from the user's own, down to 12) at which the words fit the note. */
function fit(w: number, h: number, text: string, max = 16): number {
  for (let size = Math.min(max, 20); size > 12; size--) {
    const perLine = Math.max(4, (w - 32) / (size * 0.54));
    const lines = text.split('\n').reduce((n, p) => n + Math.max(1, Math.ceil([...p].reduce((a, ch) => a + (/[\u2e80-\uffff]/.test(ch) ? 1.85 : 1), 0) / perLine)), 0);
    if (lines * size * 1.32 <= h - 30) return size;
  }
  return 12;
}
const split = (t: string) => { const i = t.indexOf(' — '); return i > 0 ? [t.slice(0, i).trim(), t.slice(i + 3).trim()] : [t.trim(), '']; };

export type Callbacks = {
  onKeep: (fn: string, chosenFrom?: string) => void;
  onDrop: (fn: string) => void;
  onAsk?: (option: string) => void;
  done: () => void;
};

type Preview = { ids: string[]; focus: () => Box[]; anchor?: () => Box[]; undo: () => void };

export function renderAnswer(rootEl: any, r: Reading, forms: Form[], ans: V5, cb: Callbacks): PendingSet | null {
  const gfx = rootEl.gfx, store = rootEl.std.store, surf = gfx.surface;
  const form = forms[0];
  const hub = form?.hub ? r.byRef.get(form.hub) : undefined;
  const targets = (form?.targets ?? []).map(t => r.byRef.get(t)!).filter(Boolean);
  let topKey: string | null = null;
  for (const e of gfx.gfxElements as any[]) { const k = e.index ?? e.props?.index; if (typeof k === 'string' && (!topKey || k > topKey)) topKey = k; }
  const nextTop = () => { try { topKey = generateKeyBetween(topKey, null); } catch { topKey = (topKey ?? 'a0') + 'V'; } return topKey!; };
  const box = (id: string): Box | null => { const e: any = gfx.getElementById(id); if (!e) return null; const b = e.elementBound; return { x: b.x, y: b.y, w: b.w, h: b.h }; };

  // the user's own sticky to copy (size, colour, font, corner, shadow), and the user's own line
  const template: Item | undefined = targets.find(t => (t.kind === 'sticky' || t.kind === 'shape') && isBlank(t))
    ?? targets.find(t => t.kind === 'sticky')
    ?? r.items.find(i => i.kind === 'sticky' && i.author === 'user' && form && hit(i.box, form.box, 400));
  const userLine = form?.lines.map(l => r.byRef.get(l)).find(c => c && c.author === 'user' && c.arrow?.from && c.arrow?.to);
  const layout = String(ans.grammar?.layout ?? '').toLowerCase();

  // things nothing may land on
  const formLines = new Set(form?.lines ?? []);
  const obstacles: Box[] = r.items.filter(i => !formLines.has(i.ref) && !['frame', 'connector', 'group'].includes(i.kind) && !(i.kind === 'drawing' && i.box.w * i.box.h > 90000) && !(i.children?.length && i.kind !== 'card')).map(i => i.box);
  // the user's lines are obstacles too: sampled along their path
  const lineDots: Box[] = [];
  for (const c of r.items.filter(i => i.kind === 'connector')) { const e: any = gfx.getElementById(c.id); if (!e?.getPointByOffsetDistance) continue; for (let k = 1; k < 16; k++) { try { const p = e.getPointByOffsetDistance(k / 16); lineDots.push({ x: p[0] - 6, y: p[1] - 6, w: 12, h: 12 }); } catch { break; } } }
  const placed: Box[] = [];
  const free = (b: Box) => !obstacles.some(o => hit(b, o, 14)) && !placed.some(o => hit(b, o, 14));

  // ── building blocks ──
  function stickyLike(text: string, at: Box): string {
    const src: any = template ? gfx.getElementById(template.id) : null;
    const props: any = {};
    if (src?.serialize && !src.flavour) for (const [k, v] of Object.entries(src.serialize())) if (!['id', 'index', 'seed', 'text', 'xywh'].includes(k)) props[k] = v;
    if (!props.shapeType) Object.assign(props, { type: 'shape', shapeType: 'rect', radius: 0.04, filled: true, fillColor: FILL.yellow, strokeColor: 'transparent', strokeWidth: 0, color: TEXT.ink, fontFamily: 'blocksuite:surface:Inter', textAlign: 'left', textHorizontalAlign: 'left', textVerticalAlign: 'top', padding: [16, 16] });
    props.type = 'shape';
    const [a, b] = split(text); const t = new Y.Text(); t.insert(0, b ? `${a}\n${b}` : a);
    props.text = t; props.xywh = xywh(at); props.index = nextTop();
    props.fontSize = fit(at.w, at.h, b ? `${a}\n${b}` : a, Number(src?.fontSize) || 16);
    return surf.addElement(props);
  }
  function noteCard(c: Card, at: Box, meta?: string): string {
    const id = store.addBlock('affine:note', { xywh: xywh({ ...at, h: 80 }), background: '#ffffff', index: nextTop(), edgeless: { style: CARD_STYLE } } as any, store.root.id);
    const gray = { color: 'var(--affine-text-secondary-color)' };
    const P = (t: string, a?: any) => new Text(a ? [{ insert: t, attributes: a }] as any : t);
    const [title, sub] = split(c.text);
    if (meta) store.addBlock('affine:paragraph', { text: P(meta.toUpperCase(), gray) }, id);
    store.addBlock('affine:paragraph', { text: P(title, { bold: true }) }, id);
    if (sub) store.addBlock('affine:paragraph', { text: P(sub, gray) }, id);
    return id;
  }
  function lineLike(from: string, to: string, label?: string, dashed = false): string {
    const src: any = userLine ? gfx.getElementById(userLine.id) : null;
    const base = src?.serialize ? src.serialize() : {};
    const props: any = { type: 'connector', mode: base.mode ?? 2, stroke: base.stroke ?? '#6e6e73', strokeWidth: base.strokeWidth ?? 2, strokeStyle: dashed ? 'dash' : base.strokeStyle ?? 'solid',
      rearEndpointStyle: base.rearEndpointStyle ?? 'Arrow', frontEndpointStyle: base.frontEndpointStyle ?? 'None', source: { id: from }, target: { id: to }, index: nextTop() };
    if (label) Object.assign(props, labelProps(label));
    return surf.addElement(props);
  }
  const labelProps = (text: string) => {
    const c = document.createElement('canvas').getContext('2d')!; c.font = '12px Inter, sans-serif';
    const t = new Y.Text(); t.insert(0, text);
    return { text: t, labelDisplay: true, labelOffset: { distance: 0.5, anchor: 'center' }, labelXYWH: [0, 0, Math.ceil(c.measureText(text).width) + 14, 20],
      labelStyle: { color: '#3a3a3c', fontSize: 12, fontFamily: 'blocksuite:surface:Inter', fontWeight: '400', fontStyle: 'normal', textAlign: 'center' } };
  };
  const moveTo = (id: string, b: Box) => { const e: any = gfx.getElementById(id); if (!e) return; if (e.flavour) store.updateBlock(e, { xywh: xywh(b) }); else surf.updateElement(id, { xywh: xywh(b) }); };
  const sourceName = (s?: string) => {
    if (!s || /^none$/i.test(s)) return '';
    const it = r.byRef.get(s);
    if (!it) return s.replace(/\(?suggested — verify\)?/i, '').trim() ? s : 'Suggested — verify';
    const sp = /^\s*([A-Z]\d{1,2}(?:\s*\([^)]{1,24}\))?|[A-Z][a-z]+(?:\s*\([^)]{1,24}\))?)\s*[:：]/.exec(it.text); if (sp) return sp[1];
    const first = it.text.split('\n').map(l => l.trim()).filter(Boolean);
    // a paper card: "PAPER · 2004 · Lee & See · …" → "Lee & See 2004"
    const meta = first.find(l => /\b(19|20)\d{2}\b/.test(l)) ?? first[0] ?? '';
    const yr = /\b(19|20)\d{2}\b/.exec(meta)?.[0];
    const who = meta.split(/·|—|-/).map(x => x.trim()).find(x => /[A-Z][a-z]+.*(et al|&|and)|^[A-Z][a-z]+$/.test(x));
    if (yr && who) return `${who} ${yr}`;
    const t = first.join(' ');
    return t.length > 42 ? t.slice(0, 40).trim() + '…' : t;
  };

  // ── where new cards go ──
  const along = (() => {
    const filledTargets = targets.length ? targets : [];
    if (!filledTargets.length) return null;
    const xs = filledTargets.map(t => t.box.x), ys = filledTargets.map(t => t.box.y);
    const spreadX = Math.max(...xs) - Math.min(...xs), spreadY = Math.max(...ys) - Math.min(...ys);
    if (filledTargets.length >= 2 && spreadX <= 16) { const s = [...filledTargets].sort((a, b) => a.box.y - b.box.y); const gaps = s.slice(1).map((t, i) => t.box.y - (s[i].box.y + s[i].box.h)); return { dir: 'down' as const, last: s[s.length - 1].box, gap: Math.max(16, median(gaps) || 24) }; }
    if (filledTargets.length >= 2 && spreadY <= 16) { const s = [...filledTargets].sort((a, b) => a.box.x - b.box.x); const gaps = s.slice(1).map((t, i) => t.box.x - (s[i].box.x + s[i].box.w)); return { dir: 'right' as const, last: s[s.length - 1].box, gap: Math.max(16, median(gaps) || 24) }; }
    return null;
  })();
  function nextAlong(w: number, h: number): Box | null {
    if (!along) return null;
    let b = along.dir === 'down' ? { x: along.last.x, y: along.last.y + along.last.h + along.gap, w, h } : { x: along.last.x + along.last.w + along.gap, y: along.last.y, w, h };
    for (let k = 0; k < 30 && !free(b); k++) b = along.dir === 'down' ? { ...b, y: b.y + 24 } : { ...b, x: b.x + 24 };
    along.last = b; return b;
  }
  // free ends of the user's lines: an answer lands where the line points, its near edge on the tip
  const ends = [...(form?.ends ?? [])].map(e => {
    // which way an end points: away from the thing its line leaves (a curve's last stretch can mislead)
    if (!hub) return { ...e, edge: null as number | null };
    const vx = e.x - cx(hub.box), vy = e.y - cy(hub.box);
    return Math.abs(vx) >= Math.abs(vy) * 0.6 ? { ...e, dx: Math.sign(vx) || 1, dy: 0, edge: null as number | null } : { ...e, dx: 0, dy: Math.sign(vy) || 1, edge: null as number | null };
  }).sort((a, b) => (Math.abs(a.dy) > Math.abs(a.dx) ? a.x - b.x : a.y - b.y));
  // several ends on one side line up on one edge, like a column the user would have made
  for (const side of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const g = ends.filter(e => e.dx === side[0] && e.dy === side[1]); if (g.length < 2) continue;
    const edge = side[0] > 0 ? Math.max(...g.map(e => e.x)) : side[0] < 0 ? Math.min(...g.map(e => e.x)) : side[1] > 0 ? Math.max(...g.map(e => e.y)) : Math.min(...g.map(e => e.y));
    g.forEach(e => { e.edge = edge; });
  }
  const endSize = (() => {
    if (ends.length < 2) return null;
    let d = 1e9; for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) d = Math.min(d, Math.max(Math.abs(ends[i].x - ends[j].x), Math.abs(ends[i].y - ends[j].y)));
    return Math.max(112, snap(d - 24));
  })();
  let endK = 0;
  function atEnd(w: number, h: number): Box | null {
    while (endK < ends.length) {
      const e = ends[endK++], G = 16;
      const horiz = Math.abs(e.dx) >= Math.abs(e.dy);
      const ex = horiz && e.edge != null ? e.edge : e.x, ey = !horiz && e.edge != null ? e.edge : e.y;
      const b = horiz ? { x: e.dx >= 0 ? ex + G : ex - G - w, y: e.y - h / 2, w, h } : { x: e.x - w / 2, y: e.dy >= 0 ? ey + G : ey - G - h, w, h };
      if (free(b)) return b;
      for (let k = 1; k < 8; k++) { const c = horiz ? { ...b, x: b.x + Math.sign(e.dx || 1) * k * 16 } : { ...b, y: b.y + Math.sign(e.dy || 1) * k * 16 }; if (free(c)) return c; }
    }
    return null;
  }
  function onRing(w: number, h: number): Box | null {
    if (!hub || targets.length < 2) return null;
    const c = { x: cx(hub.box), y: cy(hub.box) };
    const radius = median(targets.map(t => Math.hypot(cx(t.box) - c.x, cy(t.box) - c.y))) * 1.25;
    const taken = [...targets.map(t => t.box), ...placed].map(b => Math.atan2(cy(b) - c.y, cx(b) - c.x)).sort((a, b) => a - b);
    // the widest free angle first
    const gaps = taken.map((a, i) => { const nxt = i + 1 < taken.length ? taken[i + 1] : taken[0] + Math.PI * 2; return { mid: (a + nxt) / 2, size: nxt - a }; }).sort((a, b) => b.size - a.size);
    for (const g of gaps) for (const jitter of [0, 0.26, -0.26, 0.5, -0.5]) for (const rk of [1, 1.15, 0.9, 1.3]) {
      const ang = g.mid + jitter, b = { x: snap(c.x + Math.cos(ang) * radius * rk - w / 2), y: snap(c.y + Math.sin(ang) * radius * rk - h / 2), w, h };
      if (free(b)) return b;
    }
    return null;
  }
  function nearLine(w: number, h: number, k: number, n: number): Box | null {
    if (!form || form.kind === 'fan-out' || form.kind === 'fan-in') return null;
    const a = hub ?? targets[0], b = targets[targets.length - 1];
    if (!a || !b || a === b) return null;
    const mx = (cx(a.box) + cx(b.box)) / 2, my = (cy(a.box) + cy(b.box)) / 2;
    const totalW = n * w + (n - 1) * 24;
    let bx = { x: snap(mx - totalW / 2 + k * (w + 24)), y: snap(my - h / 2), w, h };
    if (!free(bx)) bx = { ...bx, y: snap(Math.max(a.box.y + a.box.h, b.box.y + b.box.h, my) + 56) };
    for (let s = 0; s < 30 && !free(bx); s++) bx = { ...bx, y: bx.y + 24 };
    return bx;
  }
  // references stack beside the thing they support: a short column to its right (or below it, in a row),
  // moved clear of whatever is already there
  const stacks = new Map<string, Box>();
  function beside(parent: Box, w: number, h: number): Box {
    const key = `${parent.x},${parent.y}`;
    const clear = (b: Box) => !obstacles.some(o => o !== parent && hit(b, o, 6)) && !placed.some(o => hit(b, o, 6)) && !lineDots.some(o => hit(b, o, 4));
    const prev = stacks.get(key);
    const sides: Box[] = prev
      ? [{ x: prev.x, y: prev.y + prev.h + 10, w, h }, { x: prev.x + prev.w + 12, y: prev.y, w, h }]
      : [{ x: parent.x + parent.w + 16, y: parent.y, w, h }, { x: parent.x + parent.w + 16, y: parent.y + parent.h - h, w, h }, { x: parent.x, y: parent.y + parent.h + 12, w, h }, { x: parent.x - w - 16, y: parent.y, w, h }, { x: parent.x, y: parent.y - h - 12, w, h }];
    if (along && along.dir === 'right' && !prev) sides.unshift(sides.splice(2, 1)[0]);
    let b = sides.find(clear) ?? sides[0];
    for (let s2 = 0; s2 < 60 && !clear(b); s2++) b = { ...b, x: b.x + 24 };
    stacks.set(key, b);
    return b;
  }
  function anywhere(w: number, h: number): Box {
    const f = form?.box ?? { x: 0, y: 0, w: 0, h: 0 };
    let b = { x: snap(f.x + f.w + 64), y: snap(f.y), w, h };
    for (let s = 0; s < 60 && !free(b); s++) b = { ...b, y: b.y + 32 };
    return b;
  }

  // ── one preview: fill the blanks, add the rest, connect, label ──
  async function apply(cards: Card[], _ghost: boolean): Promise<Preview> {
    const created: string[] = [], filled: { id: string; font?: number; blocks?: string[] }[] = [];
    const focus: string[] = [];
    store.captureSync();
    // 1 · the user's blanks, in order
    for (const c of cards.filter(c => c.slot)) {
      const it = r.byRef.get(c.slot!)!; const el: any = gfx.getElementById(it.id); if (!el) continue;
      const [a, b] = split(c.text);
      if (el.flavour === 'affine:note') {
        const gray = { color: 'var(--affine-text-secondary-color)' };
        const P = (t: string, at?: any) => new Text(at ? [{ insert: t, attributes: at }] as any : t);
        const kids = [...(el.children ?? [])];
        const empty = kids.length === 1 && !String(kids[0].props?.text ?? kids[0].text ?? '').trim() ? kids[0] : null;
        const blocks: string[] = [];
        if (empty) store.updateBlock(empty, { text: P(a, { bold: true }) }); else blocks.push(store.addBlock('affine:paragraph', { text: P(a, { bold: true }) }, el.id));
        if (b) blocks.push(store.addBlock('affine:paragraph', { text: P(b, gray) }, el.id));
        filled.push({ id: el.id, blocks: empty ? [...blocks, '__first:' + empty.id] : blocks });
      } else if (el.text instanceof Y.Text) {
        const font = el.fontSize;
        el.text.insert(0, b ? `${a}\n${b}` : a);
        surf.updateElement(el.id, { fontSize: fit(el.elementBound.w, el.elementBound.h, b ? `${a}\n${b}` : a, Number(font) || 16) });
        filled.push({ id: el.id, font });
      } else continue;
      focus.push(el.id);
      const ev = { source: sourceName(c.source), quote: c.quote ?? '' };
      if (ev.source || ev.quote) setEvidence(store, el.id, ev);
    }
    // 2 · new cards: references stack beside their parent, the rest continue the user's arrangement
    const rest = cards.filter(c => !c.slot);
    let sticky = template ? { w: template.box.w, h: template.box.h } : { w: 184, h: 184 };
    if (endSize && Math.max(sticky.w, sticky.h) > endSize) { const k = endSize / Math.max(sticky.w, sticky.h); sticky = { w: snap(sticky.w * k), h: snap(sticky.h * k) }; }
    const vb = gfx.viewport.viewportBounds, stage = { x: vb.x + vb.w * 0.4, y: vb.y + vb.h * 0.3 };
    const notes: { id: string; card: Card; parent?: Box }[] = [];
    let ringN = 0;
    for (let k = 0; k < rest.length; k++) {
      const c = rest[k];
      const parentItem = c.parent ? r.byRef.get(c.parent) : undefined;
      const slotParent = c.parent ? cards.find(o => o.slot === c.parent) : undefined;
      const isRef = !!parentItem || /reference|source|paper|evidence|quote/i.test(c.role ?? '') || (!!c.source && !/general knowledge|none/i.test(c.source) && !!c.parent);
      if (isRef || slotParent) {
        const meta = sourceName(c.source);
        const id = noteCard({ ...c, text: c.text }, { ...stage, w: 220, h: 80 }, meta && meta !== c.text ? meta : undefined);
        notes.push({ id, card: c, parent: parentItem?.box });
        created.push(id); continue;
      }
      let at: Box | null = atEnd(sticky.w, sticky.h); const landed = !!at;
      if (at) { /* on a free end */ }
      else if (/radial|loose|ring/.test(layout)) at = onRing(sticky.w, sticky.h) ?? nextAlong(sticky.w, sticky.h);
      else if (/line|bridge|midpoint/.test(layout) || form?.kind === 'bridge' || form?.kind === 'pair' || form?.kind === 'link') at = nearLine(sticky.w, sticky.h, k, rest.length);
      else at = nextAlong(sticky.w, sticky.h) ?? onRing(sticky.w, sticky.h);
      at = at ?? anywhere(sticky.w, sticky.h);
      placed.push(at);
      const id = stickyLike(c.text, at);
      created.push(id); focus.push(id); ringN++;
      if (!landed && hub && (form.kind === 'fan-out' || form.kind === 'fan-in') && !/line|midpoint/.test(layout)) created.push(form.kind === 'fan-in' ? lineLike(id, hub.id) : lineLike(hub.id, id));
      const ev = { source: sourceName(c.source), quote: c.quote ?? '' }; if (ev.source || ev.quote) setEvidence(store, id, ev);
    }
    if (notes.length) {
      await frames2(); await frames2();
      // a set's references keep the set's own order: one tidy column beside a column of labels (each card level
      // with its label when there is room, otherwise stacked in order), or under each label of a row
      const setCol = form?.kind === 'set' && form.facts.arrangement === 'column', setRow = form?.kind === 'set' && form.facts.arrangement === 'row';
      const tRefs = new Set(form?.targets ?? []);
      if (setCol || setRow) notes.sort((a, b) => { const pa = a.card.parent ? r.byRef.get(a.card.parent)?.box : null, pb = b.card.parent ? r.byRef.get(b.card.parent)?.box : null; return (pa ? (setCol ? pa.y : pa.x) : 1e9) - (pb ? (setCol ? pb.y : pb.x) : 1e9); });
      const leftOfHub = !!hub && targets.length > 0 && cx(hub.box) > cx(targets[0].box), aboveHub = !!hub && targets.length > 0 && cy(hub.box) > cy(targets[0].box);
      const edgeX = targets.length ? (leftOfHub ? Math.min(...targets.map(t => t.box.x)) - 24 - 220 : Math.max(...targets.map(t => t.box.x + t.box.w)) + 24) : 0;
      let curY = -1e9; const colY = new Map<string, number>();
      for (const n of notes) {
        if ((setCol || setRow) && n.card.parent && tRefs.has(n.card.parent)) {
          const pb = r.byRef.get(n.card.parent)!.box, b1 = box(n.id)!;
          let at: Box;
          if (setCol) { at = { x: edgeX, y: Math.max(pb.y, curY), w: 220, h: b1.h }; curY = at.y + at.h + 12; }
          else { const edgeY = aboveHub ? Math.min(...targets.map(t => t.box.y)) : Math.max(...targets.map(t => t.box.y + t.box.h)) + 16; const y0 = colY.get(n.card.parent) ?? edgeY; at = aboveHub ? { x: pb.x, y: y0 - b1.h - 16, w: 220, h: b1.h } : { x: pb.x, y: y0, w: 220, h: b1.h }; colY.set(n.card.parent, aboveHub ? at.y : at.y + at.h + 12); }
          placed.push(at); moveTo(n.id, at); focus.push(n.id);
          const ev0 = { source: sourceName(n.card.source), quote: n.card.quote ?? '' }; if (ev0.quote) setEvidence(store, n.id, ev0);
          continue;
        }
        const b0 = box(n.id)!; const parent = n.parent ?? (n.card.parent ? (() => { const s = r.byRef.get(n.card.parent!); return s ? s.box : null; })() : null);
        const at = parent ? beside(parent, 220, b0.h) : (nextAlong(220, b0.h) ?? anywhere(220, b0.h));
        placed.push(at); moveTo(n.id, at); focus.push(n.id);
        const ev = { source: sourceName(n.card.source), quote: n.card.quote ?? '' }; if (ev.quote) setEvidence(store, n.id, ev);
      }
    }
    // cards answering a line hang from its middle on a quiet dashed stem
    if (form && ['bridge', 'pair', 'link'].includes(form.kind) && form.lines[0]) {
      const le: any = gfx.getElementById(r.byRef.get(form.lines[0])!.id);
      const firstNew = created.find(id => { const e: any = gfx.getElementById(id); return e && e.type !== 'connector'; });
      if (le?.getPointByOffsetDistance && firstNew) { const m = le.getPointByOffsetDistance(0.5); created.push(surf.addElement({ type: 'connector', source: { position: [m[0], m[1]] }, target: { id: firstNew }, mode: 0, stroke: '#aeaeb2', strokeWidth: 1.5, strokeStyle: 'dash', rearEndpointStyle: 'None', frontEndpointStyle: 'None', index: nextTop() })); }
    }
    // a section grows to hold what was added to it (and shrinks back if the answer is dismissed)
    let regrow: (() => void) | null = null;
    const fr: any = form?.facts.container ? gfx.getElementById(form.facts.container.id) : null;
    if (fr && placed.length) {
      const fb = fr.elementBound, u = union([{ x: fb.x, y: fb.y, w: fb.w, h: fb.h }, ...placed.map(b => ({ x: b.x - 32, y: b.y - 32, w: b.w + 64, h: b.h + 64 }))]);
      if (u.w > fb.w + 1 || u.h > fb.h + 1) { const before = xywh({ x: fb.x, y: fb.y, w: fb.w, h: fb.h }); store.updateBlock(fr, { xywh: xywh(u) }); regrow = () => { const f2: any = gfx.getElementById(fr.id); if (f2) store.updateBlock(f2, { xywh: before }); }; }
    }
    markAi(store, created);
    store.captureSync();
    return {
      ids: created,
      focus: () => focus.map(box).filter(Boolean) as Box[],
      undo: () => {
        store.captureSync();
        for (const id of created) { const el: any = gfx.getElementById(id); if (!el) continue; if (el.flavour) store.deleteBlock(store.getBlock(id)!.model); else surf.deleteElement(id); }
        for (const f of filled) {
          const el: any = gfx.getElementById(f.id); if (!el) continue;
          if (el.flavour === 'affine:note') {
            for (const b of f.blocks ?? []) { if (b.startsWith('__first:')) { const m = store.getBlock(b.slice(8))?.model; if (m) store.updateBlock(m, { text: new Text('') }); } else { const m = store.getBlock(b)?.model; if (m) store.deleteBlock(m); } }
          } else if (el.text instanceof Y.Text) { el.text.delete(0, el.text.length); if (f.font) surf.updateElement(el.id, { fontSize: f.font }); }
        }
        regrow?.();
        clearEvidence(store, [...created, ...filled.map(f => f.id)]);
        removeCommentsOn(store, [...created, ...filled.map(f => f.id)]);
        store.captureSync();
      },
    };
  }

  // links between things already on the board (owners → tasks), and labels on the user's own lines
  function applyLinks(): Preview {
    const ids: string[] = [], labelled: string[] = [];
    for (const l of ans.links) { const f = r.byRef.get(l.from)!, t = r.byRef.get(l.to)!; ids.push(lineLike(f.id, t.id, l.label || undefined, ans.strength === 'ghost')); }
    for (const l of ans.arrow_labels) { const c = r.byRef.get(l.line)!; surf.updateElement(c.id, labelProps(l.label)); labelled.push(c.id); }
    markAi(store, ids);
    const lbox = (id: string): Box | null => { const e: any = gfx.getElementById(id); const l = e?.labelXYWH; return l && e.labelDisplay ? { x: l[0], y: l[1], w: l[2], h: l[3] } : box(id); };
    return {
      ids, focus: () => [...ids, ...labelled].map(id => { const e: any = gfx.getElementById(id); const l = e?.labelXYWH; return l && e.labelDisplay ? { x: l[0], y: l[1], w: l[2], h: l[3] } : null; }).filter(Boolean) as Box[],
      anchor: () => [...ids, ...labelled].map(lbox).filter(Boolean) as Box[],
      undo: () => { for (const id of ids) { try { surf.deleteElement(id); } catch { /* gone */ } } for (const l of labelled) surf.updateElement(l, { text: new Y.Text(), labelDisplay: false }); },
    };
  }

  const set = new PendingSet(rootEl, ans, cb);
  void (async () => {
    try {
      if (ans.strength === 'ask') { set.showAsk(form?.box ?? null); return; }
      const extra = applyLinks();
      if (ans.strength === 'fork') {
        const previews = ans.fork.map(f => f.cards);
        let cur = await apply(previews[0], false);
        set.showFork(ans.fork.map(f => f.read), async (i: number) => { cur.undo(); placed.length = 0; stacks.clear(); cur = await apply(previews[i], false); return cur; }, cur, extra);
      } else {
        const p = await apply(ans.cards, ans.strength === 'ghost');
        set.show(p, extra, ans.strength === 'ghost');
      }
      // the one insight: a comment on the thing the form grew from (or the first answer)
      const on = hub?.id ?? set.firstId();
      if (ans.insight && on) addComment(store, on, ans.insight), set.commentOn(on);
      if (set.empty()) set.drop(true);
    } catch (e) { console.warn('[intent] render', e); set.drop(true); }
  })();
  return set;
}

// ── the pending set: veils over each new or filled thing, one bar (✓ ✕, or a fork switch, or an ask) ──
export class PendingSet {
  private veils: HTMLElement[] = [];
  private bar = document.createElement('div');
  private raf = 0;
  private previews: Preview[] = [];
  private ghost = false;
  private fork: { reads: string[]; i: number; swap: (i: number) => Promise<Preview> } | null = null;
  private comments: string[] = [];
  private closed = false;
  private mouse = { x: -1, y: -1 };
  private onMouse = (e: PointerEvent) => { this.mouse = { x: e.clientX, y: e.clientY }; };
  constructor(private rootEl: any, private ans: V5, private cb: Callbacks) {
    this.bar.className = 'cx-sense-bar cx-intent-bar';
    addEventListener('pointermove', this.onMouse, true);
  }
  isClosed() { return this.closed; }
  firstId(): string | undefined { for (const p of this.previews) { const b = p.ids[0]; if (b) return b; } return undefined; }
  commentOn(id: string) { this.comments.push(id); }
  empty() { return !this.fork && !this.ans.ask && this.previews.every(p => !p.focus().length && !(p.anchor?.().length)); }

  show(p: Preview, extra: Preview, ghost: boolean) {
    this.previews = [p, extra]; this.ghost = ghost;
    this.bar.innerHTML = `<span class="cx-sense-dots"><i></i><i></i><i></i><i></i></span><span class="cx-sense-label"></span><button class="ok" aria-label="Keep">${TICK}</button><button aria-label="Dismiss">${CROSS}</button>`;
    (this.bar.querySelector('.cx-sense-label') as HTMLElement).textContent = this.ans.read || this.ans.function || '';
    this.wire(); this.mount();
  }
  showFork(reads: string[], swap: (i: number) => Promise<Preview>, first: Preview, extra: Preview) {
    this.fork = { reads, i: 0, swap }; this.previews = [first, extra];
    this.bar.innerHTML = `<span class="cx-sense-dots"><i></i><i></i><i></i><i></i></span><span class="cx-seg" role="tablist">${reads.map((_t, i) => `<button role="tab" data-i="${i}" class="${i === 0 ? 'on' : ''}"></button>`).join('')}</span><button class="ok" aria-label="Keep this one">${TICK}</button><button aria-label="Dismiss">${CROSS}</button>`;
    this.bar.querySelectorAll<HTMLElement>('.cx-seg button').forEach((b, i) => { b.textContent = reads[i]; b.onclick = () => this.flip(i); });
    this.wire(); this.mount();
  }
  showAsk(near: Box | null) {
    const a = this.ans.ask!;
    this.bar.innerHTML = `<span class="cx-sense-dots"><i></i><i></i><i></i><i></i></span><span class="cx-sense-label"></span><span class="cx-ask">${a.options.map((_, i) => `<button data-i="${i}"></button>`).join('')}</span><button aria-label="Dismiss">${CROSS}</button>`;
    (this.bar.querySelector('.cx-sense-label') as HTMLElement).textContent = a.question;
    this.bar.querySelectorAll<HTMLElement>('.cx-ask button').forEach((b, i) => { b.textContent = a.options[i]; b.onclick = () => { this.close(); this.cb.done(); this.cb.onAsk?.(a.options[i]); }; });
    (this.bar.querySelector('button[aria-label="Dismiss"]') as HTMLElement).onclick = () => this.drop();
    this.askAt = near; this.mount();
  }
  private askAt: Box | null = null;
  private async flip(i: number) {
    if (!this.fork || this.fork.i === i) return;
    this.fork.i = i;
    this.bar.querySelectorAll('.cx-seg button').forEach((b, k) => b.classList.toggle('on', k === i));
    this.previews[0] = await this.fork.swap(i);
  }
  private wire() {
    (this.bar.querySelector('.ok') as HTMLElement).onclick = () => this.keep();
    (this.bar.querySelector('button[aria-label="Dismiss"]') as HTMLElement).onclick = () => this.drop();
  }
  private mount() {
    document.body.append(this.bar);
    const tick = () => { if (this.closed) return; this.place(); this.raf = requestAnimationFrame(tick); };
    tick();
  }
  private screen(b: Box, pad: number) {
    const g = this.rootEl.gfx, rr = this.rootEl.getBoundingClientRect(), z = g.viewport.zoom;
    const [vx, vy] = g.viewport.toViewCoord(b.x, b.y);
    return { L: rr.left + vx - pad, T: rr.top + vy - pad, W: b.w * z + pad * 2, H: b.h * z + pad * 2 };
  }
  private place() {
    const bs = this.previews.flatMap(p => p.focus());
    const anchors = this.previews.flatMap(p => (p.anchor ? p.anchor() : []));
    const area = bs.length || anchors.length ? [...bs, ...anchors] : this.askAt ? [this.askAt] : [];
    if (!area.length) return;
    while (this.veils.length < bs.length) { const v = document.createElement('div'); v.className = 'cx-sense-veil' + (this.ghost ? ' ghost' : ''); document.body.append(v); this.veils.push(v); }
    while (this.veils.length > bs.length) this.veils.pop()!.remove();
    bs.forEach((b, i) => {
      const s = this.screen(b, 2), v = this.veils[i];
      Object.assign(v.style, { left: s.L + 'px', top: s.T + 'px', width: s.W + 'px', height: s.H + 'px' });
      // a ghost card comes into full view under the pointer
      if (this.ghost) v.classList.toggle('near', this.mouse.x >= s.L && this.mouse.x <= s.L + s.W && this.mouse.y >= s.T && this.mouse.y <= s.T + s.H);
    });
    const u = this.screen(union(area), 12);
    const bw = this.bar.offsetWidth || 240;
    // the bar stays reachable even when the answer runs off the screen
    Object.assign(this.bar.style, { left: Math.min(innerWidth - bw - 12, Math.max(8, u.L + u.W - bw)) + 'px', top: Math.min(innerHeight - 110, Math.max(12, u.T + u.H + 10)) + 'px' });
  }
  private close() { this.closed = true; cancelAnimationFrame(this.raf); this.veils.forEach(v => v.remove()); this.bar.remove(); removeEventListener('pointermove', this.onMouse, true); }
  keep() {
    if (this.closed) return;
    const fn = this.fork ? this.ans.fork[this.fork.i]?.function ?? this.ans.function ?? '' : this.ans.function ?? '';
    const other = this.fork ? this.ans.fork[1 - this.fork.i]?.function : undefined;
    this.close(); this.cb.onKeep(fn, other); this.cb.done();
  }
  drop(quiet = false) {
    if (this.closed) return;
    for (const p of this.previews) p.undo();
    removeCommentsOn(this.rootEl.std.store, this.comments);
    this.close();
    if (!quiet) this.cb.onDrop(this.ans.function ?? '');
    this.cb.done();
  }
}
