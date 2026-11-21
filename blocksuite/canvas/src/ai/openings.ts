// Openings: the unit the whole framework turns on.
//
// A statement made by arranging things is a structure with something left open in it: an empty note, a line
// that ends nowhere, a member of a row that lacks what its neighbours have, a heading with nothing under it,
// a mark nobody explained. The user built the structure and stopped at the opening. That stop is the request.
//
// So code never asks "which form is this?" (an endless list). It asks three things it can answer from geometry:
//   1. what is open here, and where exactly would a completion go            → Opening.place
//   2. is the same opening already filled somewhere beside it                → Opening.like  (the exemplar)
//   3. did the user just touch it                                           → Opening.touched
// What the opening is FOR is the model's reading. Where the answer lands and what it looks like comes back to
// code: in the opening, looking like the exemplar.
//
// Sources of openings:
//   · the forms code already describes (lines, runs, sets): their blanks and free ends
//   · counterparts: in a row or column of like things, some have a neighbour on one side and some do not
//   · held places: a blank note set against something with content
//   · marks: a sticker or pen mark on a part of something, with no words

import type { Box, Item, Reading } from './reading';
import { isBlank, sourceTypeOf, type Form } from './forms';
import type { Trace } from './trace';

export type OpeningKind = 'empty' | 'loose-end' | 'missing' | 'heading' | 'relation' | 'mark' | 'question';
export type Opening = {
  id: string;
  kind: OpeningKind;
  /** the open thing itself: the blank, the line, the heading, the mark */
  ref?: string;
  /** what the opening speaks about: the thing the line leaves, the row member that lacks a neighbour */
  about?: string;
  /** the same opening, already filled: a sibling's note. The completion copies its place, look and wording. */
  like?: { ref: string; text: string; by: 'user' | 'ai'; of?: string };
  /** where a completion goes */
  into?: string;                                              // write into this blank
  tip?: { x: number; y: number; dx: number; dy: number };     // at this free end
  spot?: Box;                                                 // in this place (the exemplar's place, carried over)
  beside?: string;                                            // next to this thing
  form?: string;                                              // the form it came from, if any
  refs: string[];                                             // everything that makes it up (for "touched")
  touched: boolean;
  /** strong: the user made a place for an answer. weak: nothing is literally empty; the structure may be the statement. */
  strong: boolean;
  line: string;                                               // one sentence, geometry and words only
};

const area = (b: Box) => b.w * b.h;
const cx = (b: Box) => b.x + b.w / 2, cy = (b: Box) => b.y + b.h / 2;
const gap = (a: Box, b: Box) => Math.max(0, Math.max(a.x - (b.x + b.w), b.x - (a.x + a.w)), Math.max(a.y - (b.y + b.h), b.y - (a.y + a.h)));
const q = (s: string, n = 40) => JSON.stringify(s.length > n ? s.slice(0, n - 1) + '…' : s);
const THING = (i: Item) => !['connector', 'drawing', 'highlight', 'frame', 'group'].includes(i.kind);
const words = (i?: Item) => (i ? i.text.trim() : '');
const name = (i: Item) => `${i.ref}${words(i) ? ' ' + q(words(i), 28) : i.kind === 'sticker' || i.kind === 'image' ? ` (${i.kind})` : ''}`;

export function findOpenings(r: Reading, forms: Form[], touchedNow: Set<string>): Opening[] {
  const out: Opening[] = [];
  const isNow = (refs: (string | undefined)[]) => refs.some(ref => { const it = ref ? r.byRef.get(ref) : undefined; return !!it && touchedNow.has(it.id); });
  const add = (o: Omit<Opening, 'id' | 'touched'>) => { const full = { ...o, id: 'O' + (out.length + 1), touched: isNow(o.refs) } as Opening; out.push(full); return full; };
  const taken = new Set<string>();       // blanks and abouts already covered

  // ── 1 · from forms: their blanks, their free ends, and what stays open when nothing is empty ──
  for (const f of forms) {
    const hub = f.hub ? r.byRef.get(f.hub) : undefined;
    const all = [f.hub, ...f.targets, ...f.lines, ...(f.context ?? [])].filter(Boolean) as string[];
    const targets = f.targets.map(t => r.byRef.get(t)!).filter(Boolean);
    const pre = f.facts.precedents?.find(p => p.by === 'user') ?? f.facts.precedents?.[0];
    const filledSib = targets.find(t => !isBlank(t) && words(t)) ?? (f.context ?? []).map(c => r.byRef.get(c)).find(c => c && THING(c) && c.kind !== 'image' && words(c));
    const like = pre ? { ref: pre.to, text: pre.text, by: pre.by, of: pre.from } : filledSib ? { ref: filledSib.ref, text: words(filledSib), by: filledSib.author } : undefined;
    let n = 0;
    for (const t of targets.filter(isBlank)) {
      taken.add(t.ref); n++;
      add({ kind: 'empty', ref: t.ref, into: t.ref, about: hub?.ref, like, form: f.id, refs: all, strong: true,
        line: `${t.ref} is an empty ${t.kind}${t.colour ? ` [${t.colour}]` : ''}${hub ? `, at the end of a line from ${name(hub)}` : f.kind === 'slot' ? ', left blank in a run of filled notes' : f.kind === 'pair' && f.facts.marker ? `: ${f.facts.marker}` : ''}` });
    }
    // (a line that ends on the middle of another line is aimed at that line, not into empty space)
    for (const e of f.kind === 'pair' ? [] : f.ends ?? []) {
      n++;
      add({ kind: 'loose-end', ref: e.line, tip: { x: e.x, y: e.y, dx: e.dx, dy: e.dy }, about: hub?.ref, like, form: f.id, refs: all, strong: true,
        line: `line ${e.line}${hub ? ` leaves ${name(hub)} and` : ''} ends in empty space` });
    }
    // the blank a line starts FROM (a third note aimed at the middle of a line between two others) is the place left
    if (hub && isBlank(hub) && hub.author === 'user' && !taken.has(hub.ref)) {
      n++;
      add({ kind: 'empty', ref: hub.ref, into: hub.ref, about: targets[0]?.ref, like, form: f.id, refs: all, strong: true,
        line: `${hub.ref} is an empty ${hub.kind}${hub.colour ? ` [${hub.colour}]` : ''}${f.facts.marker ? `: ${f.facts.marker}` : ' that a line starts from'}${targets.length >= 2 ? `, the line between ${targets.slice(0, 2).map(name).join(' and ')}` : ''}` });
    }
    if (hub) taken.add(hub.ref);
    if (n) continue;
    // nothing empty: what the structure leaves unsaid
    if (f.kind === 'question') { add({ kind: 'question', ref: f.hub, beside: f.hub, form: f.id, refs: all, strong: true, line: `${hub ? name(hub) : f.id} asks a question in words` }); continue; }
    if (f.kind === 'set') {
      // a set is a deliberate arrangement (one thing set off an aligned run): shaped, not just gathered
      for (const t of targets) add({ kind: 'heading', ref: t.ref, about: t.ref, beside: t.ref, form: f.id, refs: all, strong: true, line: `${name(t)} stands in a set (one thing set off against an aligned run of others) with nothing under or beside it` });
      continue;
    }
    const unlabelled = f.lines.filter(l => !f.facts.labels.some(x => x.line === l));
    add({ kind: 'relation', ref: unlabelled[0] ?? f.lines[0], about: hub?.ref, form: f.id, refs: all, strong: false,
      line: unlabelled.length ? `${unlabelled.length > 1 ? `${unlabelled.length} lines` : `line ${unlabelled[0]}`} between things that already have words, with no label: the relation is not said` : `the lines of ${f.id} are all labelled and every end has words: nothing is empty` });
  }

  // ── 2 · counterparts: in a row or column of like things, some have a neighbour on one side, some do not ──
  // (a key whose first sign has its meaning written beside it; column heads where one column has notes; a table
  //  drawn with notes where one row is done). The filled one is the exemplar; the others are open in the same place.
  {
    // only around what was just touched: a row far away is not what the user is speaking with now (and a big
    // board must not be combed end to end at every pause)
    const tb = r.items.filter(i => touchedNow.has(i.id)).map(i => i.box);
    const nearTouched = (b: Box) => tb.some(t => gap(t, b) <= 1400);
    const pool = r.items.filter(i => THING(i) && i.author === 'user' && nearTouched(i.box));
    const around = r.items.filter(i => THING(i) && nearTouched(i.box));
    const seen = new Set<string>();
    // the thing a whole structure hangs from (the source of its lines, the head of a set) is nobody's neighbour
    const heads = new Set(forms.map(f => f.hub).filter(Boolean) as string[]);
    for (const t of pool) {
      if (seen.has(t.ref) || !touchedNow.size) continue;
      // like things: same kind and size (a line of text is as wide as its words, so only its height counts)
      const like = (o: Item) => o.kind === t.kind && o.parent === t.parent && (t.kind === 'text' || Math.abs(o.box.w - t.box.w) <= Math.max(12, t.box.w * 0.25)) && Math.abs(o.box.h - t.box.h) <= Math.max(12, t.box.h * 0.25);
      for (const col of [true, false]) {
        const run = [t], queue = [t];
        while (queue.length && run.length < 10) { const c = queue.shift()!; for (const o of pool) if (!run.includes(o) && like(o) && (Math.abs(col ? o.box.x - c.box.x : o.box.y - c.box.y) <= 14 || Math.abs(col ? cx(o.box) - cx(c.box) : cy(o.box) - cy(c.box)) <= 10) && gap(o.box, c.box) <= 360) { run.push(o); queue.push(o); } }
        if (run.length < 3) continue;                       // two things side by side are not yet a pattern
        run.sort((a, b) => (col ? a.box.y - b.box.y : a.box.x - b.box.x));
        // a run keeps one beat: evenly spaced, whether tight (a list) or wide (column heads)
        { const steps = run.slice(1).map((m, k) => (col ? m.box.y - run[k].box.y : m.box.x - run[k].box.x)); if (Math.max(...steps) > Math.min(...steps) * 1.4 + 8) continue; }
        // the neighbour of a member on the cross side: the nearest thing level with it, not itself in the run
        for (const side of [1, -1]) {
          const cp = (m: Item) => around.filter(o => !run.includes(o) && !heads.has(o.ref) && o.parent === m.parent && area(o.box) <= Math.max(area(m.box) * 40, 90000)
            && (col ? (side > 0 ? o.box.x >= m.box.x + m.box.w - 4 : o.box.x + o.box.w <= m.box.x + 4) : (side > 0 ? o.box.y >= m.box.y + m.box.h - 4 : o.box.y + o.box.h <= m.box.y + 4))
            && gap(o.box, m.box) <= Math.max(220, (col ? m.box.w : m.box.h) * 2)
            && (col ? Math.min(o.box.y + o.box.h, m.box.y + m.box.h) - Math.max(o.box.y, m.box.y) >= Math.min(o.box.h, m.box.h) * 0.5 : Math.min(o.box.x + o.box.w, m.box.x + m.box.w) - Math.max(o.box.x, m.box.x) >= Math.min(o.box.w, m.box.w) * 0.5))
            .sort((a, b) => gap(a.box, m.box) - gap(b.box, m.box))[0];
          const pairs = run.map(m => ({ m, c: cp(m) }));
          const done = pairs.filter(p => p.c && !isBlank(p.c) && words(p.c));
          const open = pairs.filter(p => !p.c || isBlank(p.c));
          if (!done.length || !open.length) continue;
          // one neighbour shared by the whole run (a picture beside a column) is not a counterpart per member
          if (new Set(done.map(p => p.c!.ref)).size < done.length) continue;
          const refs = [...run.map(m => m.ref), ...pairs.map(p => p.c?.ref).filter(Boolean) as string[]];
          if (!isNow(refs)) continue;
          run.forEach(m => seen.add(m.ref));
          for (const p of open) {
            if (p.c ? taken.has(p.c.ref) : taken.has(p.m.ref)) continue;
            // the exemplar: the filled member nearest in the run
            const ex = done.slice().sort((a, b) => Math.abs(run.indexOf(a.m) - run.indexOf(p.m)) - Math.abs(run.indexOf(b.m) - run.indexOf(p.m)))[0];
            const lk = { ref: ex.c!.ref, text: words(ex.c), by: ex.c!.author, of: ex.m.ref };
            const where = col ? (side > 0 ? 'to its right' : 'to its left') : (side > 0 ? 'under it' : 'above it');
            if (p.c) { taken.add(p.c.ref); add({ kind: 'empty', ref: p.c.ref, into: p.c.ref, about: p.m.ref, like: lk, refs, strong: true, line: `${p.c.ref} is an empty ${p.c.kind} ${where.replace('its', name(p.m) + "'s")}; ${name(ex.m)} has ${q(lk.text)} in the same place` }); }
            else { taken.add(p.m.ref); add({ kind: 'missing', about: p.m.ref, like: lk, refs, strong: true,
              spot: { x: p.m.box.x + (ex.c!.box.x - ex.m.box.x), y: p.m.box.y + (ex.c!.box.y - ex.m.box.y), w: ex.c!.box.w, h: ex.c!.box.h },
              line: `${name(p.m)} has nothing ${where}; its neighbour ${name(ex.m)} has ${q(lk.text)} there` }); }
          }
        }
      }
    }
  }

  // ── 3 · held places: a blank the user set against something with content, outside any form ──
  for (const b of r.items.filter(i => isBlank(i) && i.author === 'user' && !taken.has(i.ref))) {
    const near = r.items.filter(o => o !== b && THING(o) && o.parent === b.parent && !isBlank(o) && (words(o) || o.kind === 'image') && gap(o.box, b.box) <= 64).sort((a, c) => gap(a.box, b.box) - gap(c.box, b.box))[0];
    if (!near) continue;
    const sib = near.kind === b.kind && words(near) ? { ref: near.ref, text: words(near), by: near.author } : undefined;
    add({ kind: 'empty', ref: b.ref, into: b.ref, about: near.ref, like: sib, refs: [b.ref, near.ref], strong: false, line: `${b.ref} is an empty ${b.kind}${b.colour ? ` [${b.colour}]` : ''} set against ${name(near)} (${Math.round(gap(near.box, b.box))} px apart)` });
    taken.add(b.ref);
  }

  // ── 4 · marks: a sticker or pen mark on a part of something, with no words and no line ──
  {
    const lined = new Set(forms.flatMap(f => [f.hub, ...f.targets]).filter(Boolean) as string[]);
    for (const m of r.items.filter(i => i.kind === 'sticker' && i.author === 'user' && !lined.has(i.ref) && !taken.has(i.ref))) {
      const host = r.items.filter(h => THING(h) && h !== m && area(h.box) > area(m.box) * 3 && cx(m.box) >= h.box.x && cx(m.box) <= h.box.x + h.box.w && cy(m.box) >= h.box.y && cy(m.box) <= h.box.y + h.box.h).sort((a, b) => area(a.box) - area(b.box))[0];
      if (!host) continue;
      // a twin in a key that already has its meaning beside it: said, not open
      const twins = r.items.filter(o => o !== m && o.asset && o.asset === m.asset);
      if (twins.some(tw => out.some(o => o.about === tw.ref))) continue;
      add({ kind: 'mark', ref: m.ref, about: host.ref, beside: m.ref, refs: [m.ref], strong: false, line: `${m.ref} (sticker) lies on ${name(host)} at ${Math.round(((cx(m.box) - host.box.x) / host.box.w) * 100)}% across, ${Math.round(((cy(m.box) - host.box.y) / host.box.h) * 100)}% down, with no words` });
    }
  }
  return out;
}

/** OPENINGS for the model: what is open, what the same opening looks like where it is already filled. */
export function serialiseOpenings(os: Opening[], r: Reading): string[] {
  const L: string[] = [];
  for (const o of os) {
    let s = `${o.id} ${o.kind}${o.strong || o.kind === 'empty' ? '' : ' (nothing is literally empty)'}: ${o.line}`;
    if (o.like) { const ex = r.byRef.get(o.like.ref); s += `\n   already filled beside it: ${o.like.of ? `${o.like.of} → ` : ''}${o.like.ref} ${q(o.like.text, 60)}${ex ? ` (${ex.kind}${ex.colour ? ', ' + ex.colour : ''}, written by ${o.like.by})` : ''}`; }
    L.push(s);
  }
  return L;
}

/** The situation in a few general tokens: what kinds of openings, about what kind of thing, with what around.
 *  Two situations that share most tokens are "the same kind of moment" for memory, whatever form they took. */
export function featuresOf(os: Opening[], forms: Form[], r: Reading): string[] {
  const F = new Set<string>();
  const count = new Map<string, number>(); for (const o of os) count.set(o.kind, (count.get(o.kind) ?? 0) + 1);
  for (const [k, n] of count) F.add(`open:${k}${n >= 3 ? '×many' : n === 2 ? '×2' : ''}`);
  for (const o of os) { const a = o.about ? r.byRef.get(o.about) : undefined; if (a) F.add('about:' + sourceTypeOf(a).type); if (o.like) F.add('shown'); }
  for (const f of forms) {
    if (f.lines.length) F.add('line:' + (/hand-drawn/.test(f.facts.lineStyle) ? 'hand' : 'tool'));
    if (f.facts.container) F.add('in-section');
    for (const m of f.facts.neighbourhood.match(/\b(paper|quote|idea|task|person|image|question)/g) ?? []) F.add('near:' + m);
  }
  if (os.some(o => [o.about, o.ref].some(x => { const it = x ? r.byRef.get(x) : undefined; return it?.kind === 'image' || it?.kind === 'sticker'; }))) F.add('picture');
  return [...F].sort();
}

/** One line a person would recognise: the words involved and what was left open. */
export function situationOf(os: Opening[], r: Reading): string {
  const abouts = [...new Set(os.map(o => o.about).filter(Boolean) as string[])].map(a => r.byRef.get(a)).filter(Boolean) as Item[];
  const subject = abouts.map(a => words(a) ? q(words(a), 24) : a.kind === 'drawing' ? 'a circled part' : `a ${a.kind}`).slice(0, 3).join(', ');
  const kinds = new Map<string, number>(); for (const o of os) kinds.set(o.kind, (kinds.get(o.kind) ?? 0) + 1);
  const NAMES: Record<string, [string, string]> = { empty: ['empty note', 'empty notes'], 'loose-end': ['line into empty space', 'lines into empty space'], missing: ['missing neighbour', 'missing neighbours'], heading: ['bare label', 'bare labels'], relation: ['unlabelled relation', 'unlabelled relations'], mark: ['unexplained mark', 'unexplained marks'], question: ['question', 'questions'] };
  const what = [...kinds].map(([k, n]) => `${n} ${(NAMES[k] ?? [k, k + 's'])[n > 1 ? 1 : 0]}`).join(', ');
  const shown = os.find(o => o.like)?.like;
  return `${subject || 'a structure'} with ${what}${shown ? `, one already filled with ${q(shown.text, 24)}` : ''}`.slice(0, 180);
}


// ── Arranging is speaking too ──
// Not every statement leaves a place empty. Dragging a note next to two others says "this belongs with those";
// lining five things up says "these are one sequence"; giving three notes one colour says "these are one kind".
// Code reports the change in relations (what a thing was beside, what it is beside now). What the change means,
// and whether it wants anything, is the model's call.
export type Arranged = { line: string; refs: string[]; joined: boolean; strong: boolean };

export function findArranged(r: Reading, trace: Trace, withinMs = 45_000): Arranged[] {
  const out: Arranged[] = [];
  const cut = Date.now() - withinMs;
  const things = r.items.filter(THING);
  const near = (b: Box, skip: Item) => things.filter(o => o !== skip && o.parent === skip.parent && gap(o.box, b) <= 48 && area(o.box) <= Math.max(area(b) * 6, 60000));
  const moved: { it: Item; from: Box }[] = [];
  for (const a of trace.acts) {
    if (a.t < cut || a.kind !== 'move' || !a.from) continue;
    const it = r.byId.get(a.ids[0]); if (!it || !THING(it) || it.author !== 'user') continue;
    if (Math.hypot(it.box.x - a.from.x, it.box.y - a.from.y) < 40) continue;                 // a nudge
    const i = moved.findIndex(m => m.it === it); if (i >= 0) moved[i].from = moved[i].from; else moved.push({ it, from: a.from });
  }
  const movedSet = new Set(moved.map(m => m.it));
  for (const m of moved) {
    const was = near(m.from, m.it).filter(o => !movedSet.has(o)), now = near(m.it.box, m.it);
    const wasR = was.map(o => o.ref).sort().join(' '), nowR = now.map(o => o.ref).sort().join(' ');
    if (wasR === nowR) continue;
    const say = (xs: Item[]) => xs.slice(0, 4).map(name).join(', ') + (xs.length > 4 ? ` and ${xs.length - 4} more` : '');
    const colours = now.length >= 2 && new Set(now.map(o => o.colour ?? '')).size === 1 && m.it.colour && now[0].colour !== m.it.colour ? ` (they are all ${now[0].colour}; it is ${m.it.colour})` : '';
    out.push({ refs: [m.it.ref, ...now.map(o => o.ref)], joined: now.length >= 2, strong: now.length >= 2 && !now.every(o => movedSet.has(o)),
      line: `${name(m.it)} was moved${was.length ? ` away from ${say(was)}` : ' from open space'} ${now.length ? `to sit with ${say(now)}${colours}` : 'to stand alone'}` });
  }
  // several things put into one line
  if (moved.length >= 3) {
    const its = moved.map(m => m.it);
    const row = its.every(i => Math.abs(cy(i.box) - cy(its[0].box)) <= 16), col = its.every(i => Math.abs(cx(i.box) - cx(its[0].box)) <= 16);
    if (row || col) { const ord = its.slice().sort((a, b) => (row ? a.box.x - b.box.x : a.box.y - b.box.y)); out.push({ refs: ord.map(i => i.ref), joined: true, strong: true, line: `${ord.length} things were put into one ${row ? 'row, left to right' : 'column, top to bottom'}: ${ord.map(name).join(' → ')}` }); }
  }
  // one colour given to several things
  const tinted = new Map<string, Item[]>();
  for (const a of trace.acts) { if (a.t < cut || a.kind !== 'recolour') continue; const it = r.byId.get(a.ids[0]); if (it && it.author === 'user' && it.colour) (tinted.get(it.colour) ?? tinted.set(it.colour, []).get(it.colour)!).push(it); }
  for (const [colour, its0] of tinted) {
    const its = [...new Set(its0)]; const others = things.filter(o => !its.includes(o) && o.colour === colour && o.kind === its[0].kind);
    if (its.length < 2 && !others.length) continue;
    out.push({ refs: its.map(i => i.ref), joined: false, strong: false, line: `${its.map(name).join(', ')} ${its.length > 1 ? 'were' : 'was'} made ${colour}${others.length ? `, the colour of ${others.slice(0, 4).map(name).join(', ')}` : ''}` });
  }
  return out;
}
