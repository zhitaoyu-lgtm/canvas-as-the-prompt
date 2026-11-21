// What the user just did, in order: the ACT section of the board text.
//
// The board is polled (cheaply) and every change between two looks becomes an act: add, delete, move,
// resize, recolour, edit text, connect, draw. Drags merge into one move, typing into one edit. The model
// reads the last ~20 acts with their times, so it can tell "still collecting" from "just drew a question".
// Who did it (user or AI) is looked up when the acts are written out, so AI answers never count as the
// user demonstrating something.

import { authorOf } from './provenance';
import type { Reading } from './reading';

export type ActKind = 'add' | 'paste' | 'delete' | 'move' | 'resize' | 'recolour' | 'edit' | 'connect' | 'draw' | 'label' | 'accept' | 'dismiss';
export type Act = { t: number; kind: ActKind; ids: string[]; detail?: string; blank?: boolean; from?: { x: number; y: number; w: number; h: number } };

type State = { kind: string; x: number; y: number; w: number; h: number; text: string; fill: string; src?: string; tgt?: string };

const KEEP_MS = 120_000;
const str = (v: any) => (v == null ? '' : typeof v === 'string' ? v : v.toString?.() ?? '');
const prop = (e: any, k: string) => e?.props?.[k] ?? e?.[k];

function stateOf(e: any): State {
  const b = e.elementBound;
  const kind = e.flavour ?? e.type ?? 'item';
  let text = '';
  if (kind === 'affine:note') {
    const walk = (m: any): string => [str(m.props?.text ?? m.text), ...(m.children ?? []).map(walk)].filter(Boolean).join(' ');
    try { text = walk(e); } catch { text = ''; }
  } else text = str(prop(e, 'title') ?? e.text);
  return {
    kind, x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.w), h: Math.round(b.h),
    text: text.replace(/\s+/g, ' ').trim().slice(0, 80),
    fill: String(e.fillColor ?? prop(e, 'background') ?? e.color ?? ''),
    src: e.source?.id, tgt: e.target?.id,
  };
}

export class Trace {
  acts: Act[] = [];
  private last = new Map<string, State>();
  private store: any;
  constructor(private gfx: any, store: any) { this.store = store; this.last = this.look(); }

  private look() {
    const m = new Map<string, State>();
    for (const e of this.gfx.gfxElements as any[]) if (e.flavour !== 'affine:surface') { try { m.set(e.id, stateOf(e)); } catch { /* half-made */ } }
    return m;
  }

  /** Compare with the last look and record what changed. Returns true if anything did. */
  poll(): boolean {
    const now = this.look(), t = Date.now(), before = this.last;
    const added: string[] = [];
    let changed = false;
    for (const [id, s] of now) {
      const o = before.get(id);
      if (!o) { added.push(id); changed = true; continue; }
      if (o.x === s.x && o.y === s.y && o.w === s.w && o.h === s.h && o.text === s.text && o.fill === s.fill && o.src === s.src && o.tgt === s.tgt) continue;
      changed = true;
      if (s.kind === 'connector') {
        if (o.src !== s.src || o.tgt !== s.tgt) this.push({ t, kind: 'connect', ids: [id] });
        else if (o.text !== s.text) this.push({ t, kind: 'label', ids: [id], detail: s.text });
        continue;     // a line that follows its ends around is not an act of its own
      }
      if (o.text !== s.text) this.push({ t, kind: 'edit', ids: [id], detail: s.text.slice(0, 60) });
      else if (o.fill !== s.fill) this.push({ t, kind: 'recolour', ids: [id], detail: s.fill });
      else if (o.w !== s.w || o.h !== s.h) this.push({ t, kind: 'resize', ids: [id] });
      else this.push({ t, kind: 'move', ids: [id], from: { x: o.x, y: o.y, w: o.w, h: o.h } });   // one drag keeps where it started
    }
    for (const id of before.keys()) if (!now.has(id)) { changed = true; this.push({ t, kind: 'delete', ids: [id] }); }
    if (added.length) {
      const conns = added.filter(id => now.get(id)!.kind === 'connector');
      const draws = added.filter(id => /brush|highlighter/.test(now.get(id)!.kind));
      const things = added.filter(id => !conns.includes(id) && !draws.includes(id));
      // several things with words appearing at once: a paste (or a duplicate)
      const worded = things.filter(id => now.get(id)!.text);
      if (things.length) {
        if (worded.length >= 2) this.push({ t, kind: 'paste', ids: things });
        else for (const id of things) this.push({ t, kind: 'add', ids: [id], blank: !now.get(id)!.text });
      }
      if (conns.length) this.push({ t, kind: 'connect', ids: conns });
      if (draws.length) this.push({ t, kind: 'draw', ids: draws });
    }
    this.last = now;
    const cut = t - KEEP_MS; while (this.acts.length && this.acts[0].t < cut) this.acts.shift();
    return changed;
  }

  /** Merge repeats: one drag is one move, one typing session is one edit. */
  private push(a: Act) {
    const p = this.acts[this.acts.length - 1];
    const same = p && p.ids.length === 1 && a.ids.length === 1 && p.ids[0] === a.ids[0];
    if (same && p.kind === a.kind && (a.kind === 'move' || a.kind === 'edit' || a.kind === 'resize' || a.kind === 'label') && a.t - p.t < 8000) { p.t = a.t; p.detail = a.detail; return; }
    // a new blank that is typed into straight away is just an add with words
    if (same && p.kind === 'add' && a.kind === 'edit' && a.t - p.t < 8000) { p.blank = !a.detail; p.detail = a.detail; p.t = a.t; return; }
    // a line whose end is attached a moment after it was drawn
    if (same && p.kind === 'connect' && a.kind === 'connect' && a.t - p.t < 4000) { p.t = a.t; return; }
    this.acts.push(a);
  }

  note(kind: 'accept' | 'dismiss', ids: string[], detail?: string) { this.acts.push({ t: Date.now(), kind, ids, detail }); }

  /** Ids the user (not the AI) touched in the last `ms`. */
  touchedBy(ms: number): Set<string> {
    const cut = Date.now() - ms, out = new Set<string>();
    for (const a of this.acts) if (a.t >= cut && a.kind !== 'accept' && a.kind !== 'dismiss') for (const id of a.ids) if (authorOf(this.store, id) === 'user') out.add(id);
    return out;
  }

  /** collecting: pasting / typing material dominates the last 30 s (and nothing blank was just made). */
  phase(): 'collecting' | 'connecting' | 'unknown' {
    const cut = Date.now() - 30_000;
    const recent = this.acts.filter(a => a.t >= cut && authorOf(this.store, a.ids[0]) === 'user');
    if (!recent.length) return 'unknown';
    const material = recent.filter(a => a.kind === 'paste' || (a.kind === 'add' && !a.blank) || (a.kind === 'edit' && (a.detail ?? '').length > 12)).length;
    const shaping = recent.filter(a => a.kind === 'connect' || a.kind === 'draw' || (a.kind === 'add' && a.blank)).length;
    const lastIsPaste = recent[recent.length - 1].kind === 'paste';
    if ((material >= 2 && material > shaping * 2) || (lastIsPaste && !shaping)) return 'collecting';
    if (shaping) return 'connecting';
    return 'unknown';
  }

  /** The ACT section: last ~20 acts, oldest first, refs from this reading, repeats collapsed. */
  serialise(r: Reading, max = 20): string[] {
    const refOf = (id: string) => r.byId.get(id)?.ref;
    const clock = (t: number) => new Date(t).toTimeString().slice(0, 8);
    const acts = this.acts.slice(-max * 2);
    type Row = { t: number; who: string; kind: ActKind; blank: boolean; parts: string[]; tail: string };
    const rows: Row[] = [];
    const verb: Record<ActKind, string> = { add: 'add', paste: 'paste', delete: 'delete', move: 'move', resize: 'resize', recolour: 'recolour', edit: 'type in', connect: 'draw line', draw: 'draw', label: 'label line', accept: 'accept AI answer', dismiss: 'dismiss AI answer' };
    for (const a of acts) {
      const refs = a.ids.map(refOf).filter(Boolean) as string[];
      if (!refs.length && a.kind !== 'delete' && a.kind !== 'accept' && a.kind !== 'dismiss') continue;
      const who = a.kind === 'accept' || a.kind === 'dismiss' ? 'user' : authorOf(this.store, a.ids[0]);
      const what = a.kind === 'connect'
        ? refs.map(ref => { const c = r.byRef.get(ref); return c?.arrow ? `${ref} ${c.arrow.from ?? '(free)'}→${c.arrow.to ?? '(free)'}` : ref; }).join(', ')
        : a.kind === 'delete' ? `${a.ids.length} thing${a.ids.length > 1 ? 's' : ''}` : refs.join(' ');
      const tail = a.kind === 'edit' || a.kind === 'label' ? ` "${(a.detail ?? '').slice(0, 60)}"` : a.kind === 'recolour' ? ` to ${a.detail}` : a.detail && (a.kind === 'accept' || a.kind === 'dismiss') ? ` (${a.detail})` : '';
      const p = rows[rows.length - 1];
      if (p && p.who === who && p.kind === a.kind && p.blank === !!a.blank && ['add', 'connect', 'move', 'draw'].includes(a.kind)) { p.parts.push(what); p.t = a.t; continue; }
      rows.push({ t: a.t, who, kind: a.kind, blank: !!a.blank, parts: [what], tail });
    }
    const lines = rows.map(w => `${clock(w.t)} [${w.who}] ${verb[w.kind]}${w.parts.length > 1 ? ` ×${w.parts.length}` : ''} ${w.parts.join(w.kind === 'connect' ? ', ' : ' ')}${w.blank ? ' (blank)' : ''}${w.tail}`);
    const lastT = this.acts.length ? this.acts[this.acts.length - 1].t : 0;
    if (lastT) lines.push(`${clock(Date.now())} pause (${Math.round((Date.now() - lastT) / 1000)} s)`);
    return lines.slice(-max);
  }

  /** How long ago a thing was last touched, in seconds (for stamps "by user, 2 min ago"). */
  ageOf(id: string): number | null {
    for (let i = this.acts.length - 1; i >= 0; i--) if (this.acts[i].ids.includes(id)) return Math.round((Date.now() - this.acts[i].t) / 1000);
    return null;
  }
}
