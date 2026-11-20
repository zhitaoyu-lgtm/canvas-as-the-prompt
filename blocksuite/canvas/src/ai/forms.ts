// Forms: what was just drawn, and what surrounds it. Geometry only.
//
// Code says "one note with three elbow arrows into three blank notes, the note is a list of four items,
// they sit in a section called Ideas". It never says what that means: the model decides, from the form
// and its context. The same form can ask for parts, ideas, causes, a plan by day or a translation.

import type { Box, Item, Reading } from './reading';
import type { Trace } from './trace';

export type FormKind = 'fan-out' | 'fan-in' | 'link' | 'bridge' | 'pair' | 'slot' | 'open' | 'question' | 'set';
export type Form = {
  id: string;
  kind: FormKind;
  hub?: string;                 // ref: fan-out source / fan-in sink / link start
  targets: string[];            // refs
  lines: string[];              // connector refs
  box: Box;                     // everything in the form
  context?: string[];           // refs that belong to the statement without being its targets: siblings in a run, the thing it stands beside
  ends?: { line: string; x: number; y: number; dx: number; dy: number }[];   // free ends of its lines: where an answer can land
  facts: {
    targetState: 'blank' | 'open-ended' | 'existing' | 'mixed';
    count: number;
    sourceType?: string;
    listItems?: number;
    lineStyle: string;
    arrangement: string;
    aligned: boolean; equalSize: boolean;
    direction?: string;
    labels: { line: string; text: string; by: 'user' | 'ai' }[];
    upstream: string[];
    container?: { ref: string; id: string; title: string };
    neighbourhood: string;
    firstFilled?: string;       // the only target the user already typed in ("Day 1")
    marker?: string;            // what sits on a bridge: a small drawn circle, a blank note
    precedents?: { line: string; from: string; to: string; text: string; by: 'user' | 'ai'; ageSec: number }[];   // the same form, already completed nearby
    authorAll: 'user' | 'ai' | 'mixed';
    ageSec: number;
  };
  signature: string;            // kind · sourceType · targetState · lineStyle (for KEYS and back-off)
};

const area = (b: Box) => b.w * b.h;
const cx = (b: Box) => b.x + b.w / 2, cy = (b: Box) => b.y + b.h / 2;
const union = (bs: Box[]): Box => { let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const b of bs) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); } return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };
const inside = (i: Box, o: Box, pad = 4) => i.x >= o.x - pad && i.y >= o.y - pad && i.x + i.w <= o.x + o.w + pad && i.y + i.h <= o.y + o.h + pad;
const q = (s: string, n = 60) => JSON.stringify(s.length > n ? s.slice(0, n - 1) + '…' : s);

/** An empty note, sticky or box: a slot the user made to be filled. */
export const isBlank = (it?: Item) => !!it && ['sticky', 'shape', 'doc', 'card'].includes(it.kind) && !it.text.trim() && !it.children?.length && area(it.box) >= 2500;

const LIST = /^\s*(\d+[.)、]|[-•*·])\s+\S/;
const QUESTION = /\?\s*$|？\s*$|^(how|why|what|which|who|when|where|should|can|could|如何|为什么|怎么|哪些|什么|是否)\b|^how might we/i;
const PERSON = /\((pm|eng|design|designer|lead|manager|founder|ceo|cto|coo|student|engineer|researcher|[a-z]{2,12})\)\s*$|^p\d+\b/i;
const PAPERISH = /\b(19|20)\d{2}\b[\s\S]*(paper|et al|arxiv|chi|uist|cscw|doi|journal|proceedings|acm|ieee|hypertext|·)|^(paper|found online|pdf)\b/i;

export function sourceTypeOf(it?: Item): { type: string; listItems?: number } {
  if (!it) return { type: 'none' };
  if (it.kind === 'image') return { type: 'image' };
  if (it.kind === 'sticker') return { type: 'sticker' };
  if (it.kind === 'drawing') return { type: 'loop' };
  if (it.kind === 'connector') return { type: 'line' };
  const t = it.text.trim();
  if (!t) return { type: 'empty' };
  const lines = t.split('\n').filter(l => l.trim());
  const listed = lines.filter(l => LIST.test(l)).length;
  if (listed >= 2) return { type: 'list', listItems: listed };
  if (PAPERISH.test(t)) return { type: 'paper' };
  if (QUESTION.test(t)) return { type: 'question' };
  if (PERSON.test(t) && t.length <= 40) return { type: 'person' };
  const words = t.split(/\s+/).length;
  if (/\d/.test(t) && /(%|\$|¥|€|from \d+ to \d+|\d+\s*(→|->)\s*\d+)/i.test(t)) return { type: 'number' };
  if (words <= 6 || (/[一-鿿]/.test(t) && t.length <= 14)) return { type: 'short-concept' };
  return { type: 'sentence' };
}

function lineStyleOf(gfx: any, c: Item): string {
  const el: any = gfx.getElementById(c.id); if (!el) return 'line';
  if (c.kind === 'drawing' || c.kind === 'highlight') return (c as any).handStyle ?? 'hand-drawn';
  const m = ['straight', 'elbow', 'curve'][el.mode ?? 0] ?? 'line';
  const both = (el.frontEndpointStyle ?? 'None') !== 'None' && (el.rearEndpointStyle ?? 'None') !== 'None';
  return (el.strokeStyle === 'dash' ? 'dashed ' : '') + m + (both ? ' double-headed' : '');
}

function arrangementOf(hub: Item | undefined, ts: Item[]): { arrangement: string; aligned: boolean; equalSize: boolean; direction?: string } {
  if (!ts.length) return { arrangement: 'none', aligned: false, equalSize: false };
  const xs = ts.map(t => t.box.x), ys = ts.map(t => t.box.y), ws = ts.map(t => t.box.w), hs = ts.map(t => t.box.h);
  const spread = (v: number[]) => Math.max(...v) - Math.min(...v);
  const equalSize = spread(ws) <= 8 && spread(hs) <= 8;
  let arrangement = 'scattered', aligned = false;
  if (ts.length >= 2 && spread(xs) <= 16) { arrangement = 'column'; aligned = true; }
  else if (ts.length >= 2 && spread(ys) <= 16) { arrangement = 'row'; aligned = true; }
  let direction: string | undefined;
  if (hub) {
    const angles = ts.map(t => Math.atan2(cy(t.box) - cy(hub.box), cx(t.box) - cx(hub.box)));
    const dx = ts.reduce((a, t) => a + cx(t.box) - cx(hub.box), 0) / ts.length, dy = ts.reduce((a, t) => a + cy(t.box) - cy(hub.box), 0) / ts.length;
    // around the hub on many sides: radial
    const sides = new Set(angles.map(a => Math.round(((a + Math.PI) / (Math.PI / 2))) % 4));
    if (ts.length >= 3 && sides.size >= 3 && arrangement === 'scattered') { arrangement = 'radial'; direction = 'radial'; }
    else direction = Math.abs(dx) >= Math.abs(dy) ? (dx >= 0 ? 'right' : 'left') : (dy >= 0 ? 'down' : 'up');
    if (arrangement === 'scattered' && ts.length >= 3) {
      const ds = ts.map(t => Math.hypot(cx(t.box) - cx(hub.box), cy(t.box) - cy(hub.box)));
      if (spread(ds) > Math.min(...ds) * 0.5) arrangement = 'scattered (different distances)';
    }
  }
  return { arrangement, aligned, equalSize, direction };
}

function neighbourhood(r: Reading, area0: Box, container: Item | undefined, exclude: Set<string>): string {
  const grow = (b: Box, k: number): Box => ({ x: b.x - b.w * (k - 1) / 2 - 200, y: b.y - b.h * (k - 1) / 2 - 200, w: b.w * k + 400, h: b.h * k + 400 });
  const zone = container ? container.box : grow(area0, 1.5);
  const touches = (b: Box) => b.x < zone.x + zone.w && b.x + b.w > zone.x && b.y < zone.y + zone.h && b.y + b.h > zone.y;
  const near = r.items.filter(i => !exclude.has(i.ref) && i.kind !== 'connector' && i.kind !== 'frame' && (container ? i.parent === container.ref || inside(i.box, zone, 2) : touches(i.box)));
  const papers = near.filter(i => (i.kind === 'doc' || i.kind === 'card' || i.kind === 'embed') && PAPERISH.test(i.text));
  const quotes = near.filter(i => /["“”'‘’「」]|^p\d+\b|^\w+ ?\(\w+\):/i.test(i.text.trim()) && !papers.includes(i));
  const people = near.filter(i => sourceTypeOf(i).type === 'person' && !quotes.includes(i));
  const ideas = near.filter(i => (i.kind === 'sticky' || i.kind === 'shape') && i.text.trim() && !quotes.includes(i) && !people.includes(i));
  const blanks = near.filter(i => isBlank(i));
  const docs = near.filter(i => i.kind === 'doc' && !papers.includes(i) && i.text.length > 80);
  const images = near.filter(i => i.kind === 'image');
  const diagrams = r.structures.filter(s => inside(s.box, zone, 20));
  const bits: string[] = [];
  const say = (n: Item[] | any[], what: string) => { if (n.length) bits.push(`${n.length} ${what}${n.length <= 6 ? ` (${n.map((x: any) => x.ref).join(' ')})` : ''}`); };
  say(papers, 'paper cards'); say(quotes, 'quotes'); say(docs, 'long docs'); say(people, 'people'); say(ideas, 'stickies with words'); say(blanks, 'other blanks'); say(images, 'images'); say(diagrams, 'drawn structures');
  const colours = [...new Set(near.filter(i => i.kind === 'sticky' || i.kind === 'shape').map(i => i.colour).filter(Boolean))];
  if (colours.length) bits.push('colours ' + colours.join(', '));
  return bits.join(' · ') || 'nothing else nearby';
}

/** Forms the user just made (touched = ids changed by the user in the last ~30 s). */
export function detectForms(gfx: any, r: Reading, touched: Set<string>, trace?: Trace): Form[] {
  const forms: Form[] = [];
  const conns = r.items.filter(i => i.kind === 'connector' && i.arrow);
  const freeEnds = new Map<string, { x: number; y: number; dx: number; dy: number }>();
  const heads = new Set<string>();
  const regionOf = new Map<string, string>();   // loop ref → the thing it circles a part of
  // lines drawn by hand count as lines: a pen stroke that leaves a thing (or arrives at one). A small stroke at
  // its far end is its arrowhead. Loops and scribbles are not lines.
  {
    const things = r.items.filter(i => !['connector', 'drawing', 'highlight', 'frame', 'group'].includes(i.kind));
    const at = (p: number[]) => { let best: Item | undefined, bd = 30; for (const o of things) { const dx = Math.max(o.box.x - p[0], 0, p[0] - (o.box.x + o.box.w)), dy = Math.max(o.box.y - p[1], 0, p[1] - (o.box.y + o.box.h)); const d = Math.hypot(dx, dy); if (d < bd) { bd = d; best = o; } } return best; };
    const strokes = r.items.filter(i => i.kind === 'drawing' || i.kind === 'highlight').map(i => {
      const el: any = gfx.getElementById(i.id); const pts: number[][] = el?.points ?? []; if (pts.length < 2) return null;
      const b = el.elementBound, P = pts.map(q0 => [b.x + q0[0], b.y + q0[1]]);
      let len = 0; for (let k = 1; k < P.length; k++) len += Math.hypot(P[k][0] - P[k - 1][0], P[k][1] - P[k - 1][1]);
      return { i, P, len, a: P[0], z: P[P.length - 1], size: Math.max(b.w, b.h) };
    }).filter(Boolean) as { i: Item; P: number[][]; len: number; a: number[]; z: number[]; size: number }[];
    // a loop drawn on part of a bigger thing (a region of a picture, a paragraph of a note) marks that part
    const loops = strokes.filter(s0 => s0.size > 50 && s0.P.length >= 6 && Math.hypot(s0.a[0] - s0.z[0], s0.a[1] - s0.z[1]) < Math.max(40, s0.len * 0.2)).map(s0 => {
      const over = (o: Item) => Math.max(0, Math.min(s0.i.box.x + s0.i.box.w, o.box.x + o.box.w) - Math.max(s0.i.box.x, o.box.x)) * Math.max(0, Math.min(s0.i.box.y + s0.i.box.h, o.box.y + o.box.h) - Math.max(s0.i.box.y, o.box.y));
      const host = things.filter(o => over(o) >= area(s0.i.box) * 0.8 && area(s0.i.box) < area(o.box) * 0.7).sort((a, b) => area(a.box) - area(b.box))[0];
      return { ...s0, host };
    });
    const loopAt = (p: number[]) => loops.find(l => p[0] >= l.i.box.x - 14 && p[0] <= l.i.box.x + l.i.box.w + 14 && p[1] >= l.i.box.y - 14 && p[1] <= l.i.box.y + l.i.box.h + 14);
    for (const l of loops) if (l.host) regionOf.set(l.i.ref, l.host.ref);
    const long = strokes.filter(s0 => s0.size > 70 && Math.hypot(s0.a[0] - s0.z[0], s0.a[1] - s0.z[1]) > Math.max(60, s0.len * 0.45));
    const small = strokes.filter(s0 => s0.size <= 70);
    for (const s0 of long) {
      if (loops.some(l => l.i === s0.i)) continue;
      let A = at(s0.a), Z = at(s0.z);
      // a line that starts (or ends) on a circled region speaks about that region, not the whole thing
      const la = loopAt(s0.a), lz = loopAt(s0.z);
      if (la && (!A || la.host === A)) A = la.i; if (lz && lz !== la && (!Z || lz.host === Z)) Z = lz.i;
      if (!A && !Z) continue;
      const headAt = (p: number[]) => small.filter(h => Math.hypot(cx(h.i.box) - p[0], cy(h.i.box) - p[1]) < 46);
      const hz = headAt(s0.z), ha = headAt(s0.a);
      // drawn in one go with its head: the stroke doubles back at the end
      let from = A, to = Z, tip = s0.z, tail = s0.a;
      if (ha.length && !hz.length) { from = Z; to = A; tip = s0.a; tail = s0.z; }
      if (from && to && from === to) continue;
      [...hz, ...ha].forEach(h => heads.add(h.i.ref));
      const headed = hz.length + ha.length > 0;
      const k = Math.max(0, s0.P.length - 1 - Math.ceil(s0.P.length / 5)), q0 = tip === s0.z ? s0.P[k] : s0.P[Math.min(s0.P.length - 1, Math.ceil(s0.P.length / 5))];
      const n = Math.hypot(tip[0] - q0[0], tip[1] - q0[1]) || 1;
      if (!to || !from) freeEnds.set(s0.i.ref, { x: tip[0], y: tip[1], dx: (tip[0] - q0[0]) / n, dy: (tip[1] - q0[1]) / n });
      // curved or straight, by how far the path strays from its chord
      const chord = Math.hypot(tip[0] - tail[0], tip[1] - tail[1]);
      const pseudo: any = { ...s0.i, arrow: { from: from?.ref, to: to?.ref, directed: true }, handStyle: `hand-drawn ${s0.len > chord * 1.03 ? 'curve' : 'line'}${headed ? ' with a drawn arrowhead' : ''}` };
      conns.push(pseudo);
    }
    for (const c of r.items.filter(i => i.kind === 'connector' && i.arrow && (!i.arrow.to || !i.arrow.from))) {
      const el: any = gfx.getElementById(c.id); const p = (c.arrow!.to ? el?.source?.position : el?.target?.position) as number[] | undefined; if (!p) continue;
      const o = c.arrow!.to ?? c.arrow!.from, ob = o ? r.byRef.get(o)?.box : undefined; const vx = ob ? p[0] - cx(ob) : 1, vy = ob ? p[1] - cy(ob) : 0, n = Math.hypot(vx, vy) || 1;
      freeEnds.set(c.ref, { x: p[0], y: p[1], dx: vx / n, dy: vy / n });
    }
  }
  const isTouched = (it?: Item) => !!it && touched.has(it.id);
  const used = new Set<string>();
  const out = new Map<string, Item[]>(), inn = new Map<string, Item[]>();
  for (const c of conns) {
    const { from, to, directed } = c.arrow!;
    if (from) (out.get(from) ?? out.set(from, []).get(from)!).push(c);
    if (to && directed) (inn.get(to) ?? inn.set(to, []).get(to)!).push(c);
  }
  const containerOf = (it?: Item): Item | undefined => {
    let p = it?.parent ? r.byRef.get(it.parent) : undefined;
    while (p && p.kind !== 'frame') p = p.parent ? r.byRef.get(p.parent) : undefined;
    return p;
  };
  const labelsOf = (ls: Item[]) => ls.filter(c => c.arrow?.label).map(c => ({ line: c.ref, text: c.arrow!.label!, by: c.author }));
  const ageOf = (ids: string[]) => Math.min(...ids.map(id => trace?.ageOf(id) ?? 9999));
  const make = (kind: FormKind, hub: Item | undefined, targets: Item[], lines: Item[], extra: Partial<Form['facts']> = {}): Form => {
    const all = [...(hub ? [hub] : []), ...targets, ...lines];
    const st = sourceTypeOf(hub);
    const blanks = targets.filter(isBlank).length, open = lines.filter(c => !c.arrow?.to || !c.arrow?.from).length;
    const targetState = targets.length && blanks === targets.length ? 'blank' : open && !targets.length ? 'open-ended' : blanks || open ? 'mixed' : 'existing';
    const styles = [...new Set(lines.map(c => lineStyleOf(gfx, c)))];
    const hand = styles.length > 1 && styles.every(x => x.startsWith('hand-drawn'));
    const lineStyle = styles.length === 1 ? styles[0] : hand ? `hand-drawn ${styles.some(x => /curve/.test(x)) ? 'curve' : 'line'}${styles.some(x => /arrowhead/.test(x)) ? ' with a drawn arrowhead' : ''}` : styles.length ? 'mixed' : 'none';
    const container = containerOf(hub ?? targets[0]);
    const up = hub ? (inn.get(hub.ref) ?? []).filter(c => !lines.includes(c)).map(c => `${c.arrow!.from ?? '(free)'} → ${hub.ref}${c.arrow!.label ? ` labelled ${q(c.arrow!.label)} [by ${c.author}]` : ''}`) : [];
    const filled = targets.filter(t => !isBlank(t) && t.text.trim());
    const authors = new Set(all.map(i => i.author));
    const f: Form = {
      id: 'F' + (forms.length + 1), kind, hub: hub?.ref, targets: targets.map(t => t.ref), lines: lines.map(c => c.ref),
      box: union(all.map(i => i.box)),
      facts: {
        targetState, count: lines.length || targets.length, sourceType: st.type, listItems: st.listItems, lineStyle,
        ...arrangementOf(hub, targets), labels: labelsOf(lines), upstream: up,
        container: container ? { ref: container.ref, id: container.id, title: container.text.trim() } : undefined,
        neighbourhood: '', firstFilled: blanks && filled.length === 1 ? filled[0].text.trim().slice(0, 40) : undefined,
        authorAll: authors.size === 1 ? [...authors][0] : 'mixed', ageSec: ageOf(all.map(i => i.id)),
        ...extra,
      },
      signature: '',
    };
    const ends = lines.map(c => ({ line: c.ref, ...(freeEnds.get(c.ref) as any) })).filter(e => typeof e.x === 'number'); if (ends.length) f.ends = ends;
    if (hub && regionOf.has(hub.ref)) { const host = r.byRef.get(regionOf.get(hub.ref)!)!; f.facts.marker = `${hub.ref} is a hand-drawn loop around one part of ${host.ref} (${host.kind}${host.text.trim() ? ' ' + q(host.text.trim(), 30) : ''}): the line speaks about that part` + (f.facts.marker ? '; ' + f.facts.marker : ''); }
    else if (hub?.kind === 'drawing') { const inL = r.items.filter(i => i.parent === hub.ref && i.kind !== 'connector'); if (inL.length) f.facts.marker = `${hub.ref} is a hand-drawn loop around ${inL.map(i => i.ref).join(' ')}` + (f.facts.marker ? '; ' + f.facts.marker : ''); }
    f.facts.neighbourhood = neighbourhood(r, f.box, container, new Set(all.map(i => i.ref)));
    f.signature = [kind, st.type, targetState, lineStyle.replace(/^dashed /, '').replace(/^hand-drawn.*$/, 'hand-drawn')].join(' · ');
    all.forEach(i => used.add(i.ref));
    forms.push(f);
    return f;
  };

  // fan-out: one thing is the start of 2+ lines, one of them (or an end) just made
  for (const [hubRef, ls] of out) {
    const hub = r.byRef.get(hubRef); if (!hub || ls.length < 2) continue;
    const targets = ls.map(c => c.arrow!.to && r.byRef.get(c.arrow!.to)).filter(Boolean) as Item[];
    if (!ls.some(isTouched) && !targets.some(isTouched) && !isTouched(hub)) continue;
    if (!targets.some(isBlank) && !ls.some(c => !c.arrow!.to) && !ls.some(isTouched)) continue;
    make('fan-out', hub, targets, ls);
  }
  // fan-in: 2+ arrows end at one thing
  for (const [hubRef, ls] of inn) {
    const hub = r.byRef.get(hubRef); if (!hub || ls.length < 2 || used.has(hubRef)) continue;
    const sources = ls.map(c => c.arrow!.from && r.byRef.get(c.arrow!.from)).filter(Boolean) as Item[];
    if (!ls.some(isTouched) && !sources.some(isTouched) && !isTouched(hub)) continue;
    make('fan-in', hub, sources, ls);
  }
  // single lines just drawn: a link, a link to a blank, a line with a marker on it, a two-way tension
  for (const c of conns.filter(isTouched)) {
    if (used.has(c.ref)) continue;
    const from = c.arrow!.from ? r.byRef.get(c.arrow!.from) : undefined, to = c.arrow!.to ? r.byRef.get(c.arrow!.to) : undefined;
    const el: any = gfx.getElementById(c.id);
    const both = el && (el.frontEndpointStyle ?? 'None') !== 'None' && (el.rearEndpointStyle ?? 'None') !== 'None';
    // something small set on the middle of the line: a drawn circle, a blank note
    const mid = from && to ? { x: (cx(from.box) + cx(to.box)) / 2, y: (cy(from.box) + cy(to.box)) / 2 } : null;
    const marker = mid ? r.items.find(o => o !== from && o !== to && o.kind !== 'connector' && o.kind !== 'frame' && Math.hypot(cx(o.box) - mid.x, cy(o.box) - mid.y) < Math.max(60, Math.max(o.box.w, o.box.h)) && (o.kind === 'drawing' ? Math.max(o.box.w, o.box.h) <= 120 : isBlank(o))) : undefined;
    // a line from a blank to the middle of another line (a third thing pointing at a tension)
    if (!from || !to) {
      const end = from ?? to;
      const lineEnd = conns.find(o => o !== c && o.arrow?.from && o.arrow?.to && (() => { const a = r.byRef.get(o.arrow!.from!), b = r.byRef.get(o.arrow!.to!); if (!a || !b) return false; const m = { x: (cx(a.box) + cx(b.box)) / 2, y: (cy(a.box) + cy(b.box)) / 2 }; const g = el?.elementBound; return g && Math.hypot(Math.max(0, Math.abs(cx(g) - m.x) - g.w / 2), Math.max(0, Math.abs(cy(g) - m.y) - g.h / 2)) < 60; })());
      if (lineEnd && end) {
        const a = r.byRef.get(lineEnd.arrow!.from!)!, b = r.byRef.get(lineEnd.arrow!.to!)!;
        make('pair', end, [a, b], [lineEnd, c], { marker: `${end.ref} points at the middle of ${lineEnd.ref}` });
        continue;
      }
      if (end) { make('open', end, [], [c]); continue; }
      continue;
    }
    if (both) {
      const third = conns.find(o => o !== c && !used.has(o.ref) && (!o.arrow?.to || !o.arrow?.from));
      const tip = third ? r.byRef.get((third.arrow!.from ?? third.arrow!.to)!) : undefined;
      const f = make('pair', undefined, [from, to], [c, ...(third ? [third] : [])], tip ? { marker: `${tip.ref}${isBlank(tip) ? ' (blank)' : ''} points at the middle of the two-way line` } : {});
      if (tip) { f.targets.push(tip.ref); used.add(tip.ref); if (isBlank(tip)) f.facts.targetState = 'blank'; f.signature = f.signature.replace('existing', 'blank').replace('mixed', 'blank'); }
      continue;
    }
    if (marker) { make('bridge', from, [to], [c], { marker: marker.kind === 'drawing' ? `small drawn circle ${marker.ref} on the middle of the line` : `blank ${marker.ref} on the middle of the line` }); continue; }
    make('link', from, [to], [c]);
  }
  // a blank left in a run of filled notes (a column or row of like-sized notes, whatever their colours): an open
  // slot. What the run stands beside (a picture, a table, a paper) is part of the statement.
  {
    const gapOf = (a: Box, b: Box) => Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)), Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)));
    const noteLike = (i: Item) => ['sticky', 'shape', 'doc', 'card'].includes(i.kind) && !i.children?.length;
    const lined = new Set<string>(); for (const c of conns) { if (c.arrow!.from) lined.add(c.arrow!.from); if (c.arrow!.to) lined.add(c.arrow!.to); }
    const pool = r.items.filter(i => noteLike(i) && !used.has(i.ref) && !lined.has(i.ref));
    for (const b0 of pool.filter(i => isBlank(i) && i.author === 'user')) {
      if (used.has(b0.ref)) continue;
      const like = (o: Item) => o.kind === b0.kind && o.parent === b0.parent && Math.abs(o.box.w - b0.box.w) <= b0.box.w * 0.2 && Math.abs(o.box.h - b0.box.h) <= b0.box.h * 0.2;
      const grow = (col: boolean) => {
        const run = [b0], queue = [b0];
        while (queue.length) { const c = queue.shift()!; for (const o of pool) if (!run.includes(o) && like(o) && Math.abs(col ? o.box.x - c.box.x : o.box.y - c.box.y) <= 14 && gapOf(o.box, c.box) <= Math.max(60, (col ? c.box.h : c.box.w) * 0.5)) { run.push(o); queue.push(o); } }
        return run.sort((a, b) => (col ? a.box.y - b.box.y : a.box.x - b.box.x));
      };
      const colRun = grow(true), rowRun = grow(false), col = colRun.length >= rowRun.length, run = col ? colRun : rowRun;
      const filled = run.filter(o => !isBlank(o) && o.text.trim()), blanks = run.filter(o => isBlank(o));
      if (filled.length < 2 || run.length > 9 || !run.some(isTouched)) continue;
      const u = union(run.map(o => o.box));
      const beside = r.items.filter(o => !run.includes(o) && !['frame', 'connector', 'drawing', 'highlight', 'group'].includes(o.kind) && o.parent === b0.parent && gapOf(o.box, u) <= 200 && area(o.box) >= area(b0.box) * 1.5
        && (col ? Math.min(o.box.y + o.box.h, u.y + u.h) - Math.max(o.box.y, u.y) : Math.min(o.box.x + o.box.w, u.x + u.w) - Math.max(o.box.x, u.x)) >= Math.min(col ? o.box.h : o.box.w, col ? u.h : u.w) * 0.5).sort((a, b) => gapOf(a.box, u) - gapOf(b.box, u))[0];
      const side = beside ? (col ? (cx(beside.box) < cx(u) ? 'to its left' : 'to its right') : (cy(beside.box) < cy(u) ? 'above it' : 'below it')) : '';
      const hues = new Set(run.map(o => o.colour ?? ''));
      const f = make('slot', undefined, blanks, [], { arrangement: `${col ? 'column' : 'row'} of ${run.length} notes`, neighbourhood: '' });
      f.facts.upstream = [
        `the run, ${col ? 'top to bottom' : 'left to right'}: ${run.map(o => `${o.ref} ${isBlank(o) ? 'BLANK' : q(o.text.trim(), 30)}${o.colour ? ` [${o.colour}]` : ''}`).join(' · ')}` + (hues.size === run.length && run.length > 1 ? ' — every note a different colour' : hues.size === 1 ? ' — all one colour' : ''),
        ...(beside ? [`the run stands beside ${beside.ref} (${beside.kind}${beside.text.trim() ? ' ' + q(beside.text.trim(), 40) : ''}), ${side}, ${Math.round(gapOf(beside.box, u))} px away${beside.kind === 'image' ? ' — look at the attached picture' : ''}`] : []),
      ];
      f.context = [...run.filter(o => !blanks.includes(o)).map(o => o.ref), ...(beside ? [beside.ref] : [])];
      f.box = union([u, ...(beside ? [beside.box] : [])]);
      run.forEach(o => used.add(o.ref));
      const shortAll = filled.every(o => o.text.trim().length <= 24 && !/\n/.test(o.text.trim()));
      if (shortAll) f.facts.firstFilled = filled[0].text.trim();
      f.signature = ['slot', beside ? beside.kind : 'none', 'blank', hues.size === run.length ? 'colour-coded' : 'plain'].join(' · ');
    }
  }
  // a blank set into a line, row or grid of filled things: an open slot
  for (const it of r.items.filter(i => isTouched(i) && isBlank(i) && !used.has(i.ref))) {
    const g = r.groups.find(g => g.members.includes(it.ref));
    if (!g || g.members.length < 3) continue;
    const filled = g.members.map(m => r.byRef.get(m)!).filter(m => m && !isBlank(m) && m.kind === it.kind);
    if (filled.length < 2) continue;
    make('slot', undefined, [it], [], { arrangement: `${g.layout}${g.rows ? ` ${g.rows}×${g.cols}` : ''} of ${g.kinds}`, neighbourhood: '' });
    const f = forms[forms.length - 1]; f.facts.upstream = [`in ${g.ref} with ${filled.slice(0, 6).map(m => `${m.ref} ${q(m.text, 30)}`).join(', ')}`];
  }
  // a set: short labels placed tightly with no lines, one of them standing off an aligned run of the others
  // (to its side, above it, another colour). Geometry only: what the one is to the many is the model's call.
  {
    const lined = new Set<string>(); for (const c of conns) { if (c.arrow!.from) lined.add(c.arrow!.from); if (c.arrow!.to) lined.add(c.arrow!.to); }
    const gapOf = (a: Box, b: Box) => Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)), Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)));
    const label = (i: Item) => ['sticky', 'shape', 'text', 'tag'].includes(i.kind) && i.author === 'user' && !used.has(i.ref) && !lined.has(i.ref) && i.text.trim().length >= 1 && i.text.trim().length <= 48 && !i.children?.length;
    const pool = r.items.filter(label), seenSet = new Set<string>();
    for (const t of pool.filter(isTouched)) {
      if (seenSet.has(t.ref)) continue;
      const comp = [t], queue = [t];
      while (queue.length && comp.length <= 10) { const c = queue.shift()!; for (const o of pool) if (!comp.includes(o) && o.parent === t.parent && gapOf(o.box, c.box) <= Math.max(48, Math.min(c.box.w, c.box.h) * 0.4)) { comp.push(o); queue.push(o); } }
      comp.forEach(o => seenSet.add(o.ref));
      if (comp.length < 3 || comp.length > 9) continue;
      // nothing else may crowd it: material in between means a pile, not a set
      const u = union(comp.map(o => o.box));
      if (r.items.some(o => !comp.includes(o) && !['frame', 'connector', 'group', 'drawing', 'highlight'].includes(o.kind) && o.parent === t.parent && gapOf(o.box, u) < 24)) continue;
      const tryAxis = (col: boolean) => {
        const c0 = (o: Item) => col ? cx(o.box) : cy(o.box), span = (o: Item) => col ? o.box.w : o.box.h;
        let best: Item[] = [];
        for (const a of comp) { const e0 = (o: Item) => col ? o.box.x : o.box.y; const run = comp.filter(o => Math.abs(c0(o) - c0(a)) <= Math.min(span(a), span(o)) * 0.2 || Math.abs(e0(o) - e0(a)) <= 10); if (run.length > best.length) best = run; }
        return best;
      };
      const colRun = tryAxis(true), rowRun = tryAxis(false);
      const run = (colRun.length >= rowRun.length ? colRun : rowRun), col = run === colRun;
      const rest = comp.filter(o => !run.includes(o));
      if (run.length < 2 || rest.length !== 1) continue;
      const head = rest[0];
      run.sort((a, b) => col ? a.box.y - b.box.y : a.box.x - b.box.x);
      const sameHue = new Set(run.map(o => o.colour ?? '')).size === 1;
      const facts = [`${head.ref} stands off a ${col ? 'column' : 'row'} of ${run.length}`, `no lines drawn`,
        sameHue && head.colour && head.colour !== run[0].colour ? `${head.ref} is ${head.colour}, the ${run.length} are all ${run[0].colour}` : sameHue ? 'all one colour' : 'mixed colours',
        `gaps ${Math.round(Math.min(...run.map(o => gapOf(o.box, head.box))))}–${Math.round(Math.max(...run.slice(1).map((o, k) => gapOf(o.box, run[k].box)), 0))} px (set tightly)`,
        `words: ${head.ref} ${q(head.text.trim(), 30)} · ${run.map(o => `${o.ref} ${q(o.text.trim(), 30)}`).join(' · ')}`];
      const f = make('set', head, run, [], { marker: facts.join('; ') });
      f.facts.count = run.length; f.facts.targetState = 'existing';
    }
  }
  // a question title that just received material
  for (const f of r.items.filter(i => i.kind === 'frame' && /\?\s*$|？\s*$|^(why|what|which|how|who|为什么|哪些|怎么|如何|是否)/i.test(i.text.trim()))) {
    const kids = r.items.filter(i => i.parent === f.ref && i.kind !== 'connector');
    if (kids.length < 2 || !kids.some(isTouched)) continue;
    make('question', f, kids, []);
  }
  // precedents: the same form, already completed close by. A line of the same family, leaving the same kind of
  // thing, that ends at a note with words. Code only pairs them up; what was demonstrated is the model's call.
  {
    const fam = (c: Item) => (c.kind === 'connector' ? 'tool' : 'hand');
    const alike = (a?: Item, b?: Item) => !!a && !!b && a !== b && a.kind === b.kind && (regionOf.has(a.ref) || regionOf.has(b.ref) ? regionOf.get(a.ref) === regionOf.get(b.ref) : a.parent === b.parent && sourceTypeOf(a).type === sourceTypeOf(b).type);
    for (const f of forms) {
      if (!['blank', 'open-ended', 'mixed'].includes(f.facts.targetState)) continue;
      const hub = f.hub ? r.byRef.get(f.hub) : undefined; if (!hub) continue;
      const mine = conns.filter(c => f.lines.includes(c.ref));
      const pres: NonNullable<Form['facts']['precedents']> = [];
      for (const c of conns) {
        if (f.lines.includes(c.ref) || !c.arrow?.from || !mine.some(m => fam(m) === fam(c))) continue;
        const from = r.byRef.get(c.arrow.from); if (!(from === hub && !f.targets.includes(c.arrow.to ?? '')) && !alike(from, hub)) continue;
        let to = c.arrow.to ? r.byRef.get(c.arrow.to) : undefined;
        if (!to) { const e = freeEnds.get(c.ref); if (e) to = r.items.find(o => !['connector', 'drawing', 'highlight', 'frame', 'group'].includes(o.kind) && o.text.trim() && Math.hypot(Math.max(o.box.x - e.x, 0, e.x - (o.box.x + o.box.w)), Math.max(o.box.y - e.y, 0, e.y - (o.box.y + o.box.h))) < 90); }
        if (!to || isBlank(to) || !to.text.trim() || to.text.trim().length > 120) continue;
        pres.push({ line: c.ref, from: from!.ref, to: to.ref, text: to.text.trim(), by: to.author, ageSec: Math.min(trace?.ageOf(to.id) ?? 9999, 9999) });
      }
      if (pres.length) { f.facts.precedents = pres.slice(0, 4); if (!f.facts.firstFilled) { const u = pres.find(x => x.by === 'user'); if (u) f.facts.firstFilled = u.text.slice(0, 40); } }
    }
  }
  return forms;
}

export function serialiseForms(forms: Form[], r: Reading): string[] {
  const L: string[] = [];
  for (const f of forms) {
    const x = f.facts;
    const nb = f.targets.filter(t => isBlank(r.byRef.get(t))).length;
    const tState = x.targetState === 'blank' ? `blank ×${nb || f.targets.length}` : x.targetState;
    const head = f.kind === 'fan-in' ? `${f.id} fan-in into ${f.hub} ← ${f.targets.join(' ')}` : f.kind === 'pair' ? `${f.id} pair (two-way line) between ${f.targets.join(' and ')}` : f.kind === 'slot' ? `${f.id} slot ${f.targets.join(' ')}` : f.kind === 'set' ? `${f.id} set (no lines): ${f.hub} beside ${f.targets.join(' ')}` : f.kind === 'question' ? `${f.id} question container ${f.hub} ${q(r.byRef.get(f.hub!)!.text)} holds ${f.targets.join(' ')}` : `${f.id} ${f.kind} from ${f.hub ?? '?'} → ${f.targets.join(' ') || '(free end)'}`;
    const bits = [`targets ${tState}`];
    if (x.arrangement !== 'none') bits.push(x.arrangement + (x.aligned ? ', aligned' : ''), x.equalSize && f.targets.length > 1 ? 'equal size' : '');
    if (f.lines.length) bits.push(x.lineStyle + (f.lines.length > 1 ? ` ×${f.lines.length}` : ''));
    if (x.direction) bits.push('direction ' + x.direction);
    L.push(`${head} · ${bits.filter(Boolean).join(', ')}`);
    const hub = f.hub ? r.byRef.get(f.hub) : undefined;
    if (hub && f.kind !== 'question') {
      let s = `   source ${hub.ref} is ${x.sourceType === 'list' ? `a list of ${x.listItems} items` : x.sourceType === 'short-concept' ? 'a short concept' : x.sourceType === 'empty' ? 'blank' : `a ${x.sourceType}`}`;
      if (x.sourceType === 'list' && f.kind === 'fan-out') s += ` (count ${x.count} ${x.count === x.listItems ? '=' : '≠'} ${x.listItems})`;
      L.push(s);
    }
    if (x.precedents?.length) L.push(`   precedent${x.precedents.length > 1 ? 's' : ''} (the same form, already completed): ${x.precedents.map(p0 => `${p0.from} → ${p0.to} ${q(p0.text, 50)} [written by ${p0.by}]`).join('; ')}`);
    else if (x.firstFilled && f.kind === 'slot') L.push(`   the filled notes show the format: short bare labels like ${q(x.firstFilled)}`);
    else if (x.firstFilled) L.push(`   one target already typed by the user: ${q(x.firstFilled)}; the others are blank`);
    if (x.marker) L.push(`   ${x.marker}`);
    if (x.labels.length) L.push(`   labels: ${x.labels.map(l => `${l.line} ${q(l.text)} [by ${l.by}]`).join('; ')}`);
    if (x.upstream.length) L.push(...(f.kind === 'slot' ? x.upstream.map(u0 => `   ${u0}`) : [`   upstream: ${x.upstream.join('; ')}`]));
    L.push(`   container: ${x.container ? `${x.container.ref} ${q(x.container.title)}` : 'none'} · neighbourhood: ${x.neighbourhood}`);
    L.push(`   ${x.authorAll === 'user' ? 'all by user' : x.authorAll === 'ai' ? 'all by ai' : 'by user and ai'} · settled ${x.ageSec >= 9999 ? 'just now' : x.ageSec + ' s ago'}`);
  }
  return L;
}

/** QUESTIONS: containers whose title is a question, and what they hold. */
export function serialiseQuestions(r: Reading): string[] {
  return r.items.filter(i => i.kind === 'frame' && /\?\s*$|？\s*$|^(why|what|which|how|who|为什么|哪些|怎么|如何|是否)/i.test(i.text.trim()))
    .map(f => `${f.ref} ${q(f.text.trim())} contains ${r.items.filter(i => i.parent === f.ref && i.kind !== 'connector').map(i => i.ref).join(' ') || 'nothing yet'}`);
}
