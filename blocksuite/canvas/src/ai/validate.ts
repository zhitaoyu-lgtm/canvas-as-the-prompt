// Invariants, in code. The prompt asks for them; code makes sure. Every answer passes here before it
// reaches the board: unknown refs are dropped, quotes that are not word-for-word lose their quote marks,
// the user's own things are never rewritten, geometry words never become labels, and sizes are capped.

import { cleanRefs } from './actions';
import { isBlank, type Form } from './forms';
import type { Box, Item, Reading } from './reading';
import type { Opening } from './openings';

export type Card = { slot?: string | null; text: string; source?: string; quote?: string | null; parent?: string | null; role?: string;
  at?: string | null;        // the opening this card completes (the model's addressing)
  // resolved by code from the opening:
  spot?: Box;                // the exact place (the exemplar's place, carried over)
  likeRef?: string;          // the exemplar to look like
  endLine?: string;          // the line whose free end it lands on
};
export type V5 = {
  noticed?: string; form?: string;
  functions?: { name: string; for?: string[]; against?: string[] }[];
  function: string | null;
  strength: 'full' | 'ghost' | 'fork' | 'ask' | 'silent';
  grammar: { child?: string; rules?: string; evidence?: string; layout?: string; insight_about?: string } | null;
  read: string;
  cards: Card[];
  links: { from: string; to: string; label?: string }[];
  arrow_labels: { line: string; label: string }[];
  fork: { function: string; read: string; cards: Card[] }[];
  ask: { question: string; options: [string, string] } | null;
  excluded: { item: string; kind?: string; why?: string }[];
  insight: string | null;
  keep: string | null;
  /** which kind of response this is, in the model's own judgement (for the log and for learning) */
  move?: string;
  /** anything beyond cards and links, in the board's full part grammar (a figure, a tag, a loop, a comment) */
  actions?: any[];
};

const norm = (s: string) => s.toLowerCase().replace(/[\s ]+/g, ' ').replace(/[“”"]/g, '"').replace(/[‘’']/g, "'").trim();
const REF = /\b([a-z]{1,2}\d{1,3}|G\d{1,3}|F\d{1,2}|L\d{1,3})\b/;
// a label that only names element kinds: "checklist → blank slot", "note to note", "list -> cards"
const GEOMETRY = /^(the\s+)?(\w+\s*){0,2}(→|->|to|into|=>)\s*(the\s+)?(\w+\s*)?(blank|slot|slots|note|notes|sticky|stickies|card|cards|list|checklist|box|boxes|item|items|empty)\s*$/i;
const KINDS_ONLY = /^(blank|slot|note|sticky|card|list|checklist|box|item|arrow|line)s?$/i;

/** Make whatever came back into the schema, or null if it cannot be used. */
export function coerce(raw: any): V5 | null {
  if (!raw || typeof raw !== 'object') return null;
  const arr = (v: any) => (Array.isArray(v) ? v : []);
  const strength = ['full', 'ghost', 'fork', 'ask', 'silent'].includes(raw.strength) ? raw.strength : 'silent';
  const card = (c: any): Card | null => c && typeof c.text === 'string' && c.text.trim() ? { slot: typeof c.slot === 'string' ? c.slot : null, at: typeof c.at === 'string' ? c.at.trim() : null, text: c.text.trim(), source: typeof c.source === 'string' ? c.source : undefined, quote: typeof c.quote === 'string' && c.quote.trim() ? c.quote.trim() : null, parent: typeof c.parent === 'string' ? c.parent : null, role: typeof c.role === 'string' ? c.role : undefined } : null;
  return {
    noticed: raw.built ?? raw.noticed, form: raw.form, functions: arr(raw.could_be ?? raw.functions),
    function: typeof raw.function === 'string' ? raw.function : null,
    strength,
    grammar: raw.grammar && typeof raw.grammar === 'object' ? raw.grammar : null,
    read: typeof raw.read === 'string' ? raw.read.trim() : '',
    cards: arr(raw.cards).map(card).filter(Boolean) as Card[],
    links: arr(raw.links).filter((l: any) => l && typeof l.from === 'string' && typeof l.to === 'string'),
    arrow_labels: arr(raw.arrow_labels).filter((l: any) => l && typeof l.line === 'string' && typeof l.label === 'string'),
    fork: arr(raw.fork).map((f: any) => ({ function: String(f?.function ?? ''), read: String(f?.read ?? f?.function ?? '').trim(), cards: arr(f?.cards).map(card).filter(Boolean) as Card[] })).filter((f: any) => f.cards.length),
    ask: raw.ask && typeof raw.ask.question === 'string' && Array.isArray(raw.ask.options) && raw.ask.options.length >= 2 ? { question: raw.ask.question, options: [String(raw.ask.options[0]), String(raw.ask.options[1])] } : null,
    excluded: arr(raw.excluded).filter((e: any) => e && typeof e.item === 'string'),
    insight: typeof raw.insight === 'string' && raw.insight.trim() ? raw.insight.trim() : null,
    keep: typeof raw.keep === 'string' ? raw.keep : null,
    move: typeof raw.move === 'string' ? raw.move : undefined,
    actions: arr(raw.actions).filter((x: any) => x && typeof x.do === 'string'),
  };
}

/** Apply the invariants. Returns the cleaned answer and what was changed (for the debug log). */
export function validate(a: V5, r: Reading, forms: Form[], openings: Opening[] = []): { answer: V5; edits: string[] } {
  const edits: string[] = [];
  const item = (ref?: string | null) => (ref ? r.byRef.get(ref) : undefined);
  const scopeRefs = new Set<string>();
  for (const f of forms) {
    [f.hub, ...f.targets, ...f.lines].forEach(x => x && scopeRefs.add(x));
    // the answer may also use the other blanks of the same container
    if (f.facts.container) for (const i of r.items) if (i.parent === f.facts.container.ref && isBlank(i)) scopeRefs.add(i.ref);
  }
  const ops = new Map(openings.map(o => [o.id, o]));
  for (const o of openings) [o.ref, o.into, o.about, o.beside].forEach(x => x && scopeRefs.add(x));
  const usedAt = new Set<string>();
  const bare = (t?: string) => !!t && !/ — |\n/.test(t) && t.length <= 24;
  const allText = r.items.map(i => ({ ref: i.ref, t: norm(i.text) }));
  const quoted = (q: string, src?: Item) => { const n = norm(q).replace(/^["']|["']$/g, ''); return n.length >= 3 && (src ? norm(src.text).includes(n) : allText.some(x => x.t.includes(n))); };
  const visible = (s: string) => {
    let t = cleanRefs(s, r);
    // quote marks only around words that really are on the board
    t = t.replace(/[“"]([^”"]{3,200})[”"]/g, (m, inner) => (quoted(inner) ? m : (edits.push(`unquoted "${inner.slice(0, 30)}"`), inner)));
    return t.replace(new RegExp(REF.source, 'g'), m => (r.byRef.has(m) ? '' : m)).replace(/\(\s*\)/g, '').replace(/\s{2,}/g, ' ').trim();
  };
  const evidenceNone = /^(none|no|not needed|ideas need no)/i.test(a.grammar?.evidence ?? '');
  const usedSlots = new Set<string>();
  const demo = forms.map(f => f.facts.firstFilled).find(Boolean) ?? '';

  const fixCards = (cards: Card[], label: string): Card[] => {
    const out: Card[] = [];
    for (const c0 of cards) {
      const c = { ...c0 };
      // the card names the opening it completes: code knows where that is and what it should look like
      let shown: string | undefined;
      if (c.at) {
        const o = ops.get(c.at);
        if (!o || usedAt.has(c.at)) { edits.push(`${label}: ${c.at} ${o ? 'answered twice' : 'is not an opening'} → placed by context`); c.at = null; }
        else {
          usedAt.add(c.at); shown = o.like?.text; c.likeRef = o.like?.ref;
          if (o.into) { c.slot = o.into; c.parent = null; }
          else if (o.tip) { c.parent = o.about ?? null; c.endLine = o.ref; c.slot = null; }
          else if (o.spot) { c.spot = o.spot; c.parent = null; c.slot = null; }
          else if (o.beside && !c.parent) c.parent = o.beside;
          if (c.source && /general knowledge|none/i.test(c.source)) c.source = undefined;
        }
      }
      // an answer aimed at a blank the user made belongs IN that blank, not on a card beside it
      if (!c.slot && c.parent) { const pb = item(c.parent); if (pb && isBlank(pb) && scopeRefs.has(c.parent) && !usedSlots.has(c.parent)) { edits.push(`${label}: card for blank ${c.parent} → written into it`); c.slot = c.parent; c.parent = null; c.role = undefined; if (c.source && /general knowledge|none/i.test(c.source)) c.source = undefined; } }
      // only the user's blanks may be written into, each once, and only those this form is about
      if (c.slot) {
        const s = item(c.slot);
        if (!s || !isBlank(s) || usedSlots.has(c.slot) || !scopeRefs.has(c.slot)) { edits.push(`${label}: slot ${c.slot} not a blank of this form → new card`); c.slot = null; }
        else usedSlots.add(c.slot);
      }
      // sources: a board ref, or an honest label
      const src = item(c.source);
      if (c.source && !src && !/suggested|general knowledge|none/i.test(c.source)) c.source = /\b(19|20)\d{2}\b|et al|·/.test(c.source) ? `${c.source} (suggested — verify)` : c.source;
      if (c.quote && !quoted(c.quote, src)) { edits.push(`${label}: quote not word-for-word → dropped`); c.quote = null; if (src && !c.source) c.source = 'none'; }
      if (evidenceNone) { c.source = undefined; c.quote = null; }
      c.text = visible(c.text);
      // the user showed the format with their own filled note: a bare name gets a bare name back
      // the filled sibling shows the format: a bare name gets a bare name back
      if ((c.slot && bare(demo)) || bare(shown)) c.text = c.text.split(/ — |\n/)[0].trim();
      if (!c.text || KINDS_ONLY.test(c.text) || GEOMETRY.test(c.text)) { edits.push(`${label}: card text names geometry → dropped`); continue; }
      if (c.parent && !item(c.parent) && !cards.some(o => o !== c0 && (o as any).id === c.parent)) c.parent = null;
      out.push(c);
    }
    return out;
  };

  a = { ...a };
  if (a.strength === 'silent') return { answer: { ...a, cards: [], links: [], arrow_labels: [], fork: [], ask: null, insight: null, actions: [] }, edits };
  a.cards = fixCards(a.cards, 'card').slice(0, 12);
  if (a.fork.length) {
    a.fork = a.fork.slice(0, 2).map((f, i) => { usedSlots.clear(); return { ...f, read: visible(f.read).slice(0, 40), cards: fixCards(f.cards, `fork ${i + 1}`).slice(0, 3) }; }).filter(f => f.cards.length);
    usedSlots.clear();
  }
  if (a.strength === 'fork' && a.fork.length < 2) { edits.push('fork without two previews → ghost'); a.strength = 'ghost'; if (!a.cards.length && a.fork[0]) a.cards = a.fork[0].cards; a.fork = []; }
  if (a.strength !== 'fork') a.fork = [];
  if (a.strength === 'ask' && !a.ask) { edits.push('ask without a question → silent'); a.strength = 'silent'; }
  // links: both ends must exist; at least one end must be part of what the user just drew or its container
  a.links = a.links.filter(l => {
    const f = item(l.from), t = item(l.to);
    if (!f || !t || f === t) { edits.push(`link ${l.from}→${l.to} unknown`); return false; }
    return true;
  }).map(l => ({ ...l, label: l.label ? visible(l.label) : '' })).slice(0, 12);
  // arrow labels: only on the lines of this form, never geometry
  a.arrow_labels = a.arrow_labels.filter(l => {
    if (!scopeRefs.has(l.line) || item(l.line)?.kind !== 'connector') { edits.push(`label on ${l.line} out of scope`); return false; }
    if (item(l.line)?.arrow?.label) { edits.push(`label on ${l.line}: the user already labelled it`); return false; }
    const t = visible(l.label);
    if (!t || GEOMETRY.test(t) || KINDS_ONLY.test(t)) { edits.push(`label "${l.label}" names geometry → dropped`); return false; }
    l.label = t.slice(0, 40); return true;
  });
  // a one-to-one reading that does not fit the counts is shown as a judgement, not a fact
  const f0 = forms[0];
  if (f0?.facts.listItems && f0.facts.count !== f0.facts.listItems && /one[- ]to[- ]one|1\s*:\s*1|each (list )?item|strict/i.test(a.grammar?.rules ?? '') && a.strength === 'full') {
    edits.push('one-to-one with uneven counts → ghost'); a.strength = 'ghost';
  }
  a.read = visible(a.read).replace(/[.。]$/, '').slice(0, 64);
  a.insight = a.insight ? visible(a.insight) : null;
  if (a.ask) a.ask = { question: visible(a.ask.question), options: [visible(a.ask.options[0]), visible(a.ask.options[1])] };
  a.excluded = a.excluded.filter(e => item(e.item)).slice(0, 8);
  // unasked, the board may only gain things: parts that add (a figure, a tag, a loop, a comment, a line).
  // Moving, recolouring or rewriting what the user made waits for a typed request.
  const ADDS = new Set(['add', 'connect', 'ref', 'pair', 'note', 'tag', 'circle', 'frame', 'legend', 'number', 'diagram', 'journey', 'matrix', 'bars', 'funnel', 'section', 'branch', 'milestone']);
  a.actions = (a.actions ?? []).filter(x => { if (ADDS.has(String(x.do))) return true; edits.push(`action "${x.do}" changes the user's things → dropped (needs a typed request)`); return false; }).slice(0, 6);
  const nothing = !a.actions.length && !a.cards.length && !a.links.length && !a.arrow_labels.length && !a.fork.length && !a.ask && !(a.excluded.length);
  if (nothing && a.strength !== 'silent') { edits.push('nothing left to show → silent'); a.strength = 'silent'; }
  return { answer: a, edits };
}
