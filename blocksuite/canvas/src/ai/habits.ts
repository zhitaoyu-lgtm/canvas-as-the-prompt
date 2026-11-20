// Habits: a light memory of what this person does with a form.
//
// Every time a form is noticed, one line is kept: what the form was (its signature: kind · source · targets ·
// line), what the AI offered and what happened to it (accepted, dismissed, a fork choice, or nothing offered),
// and what the user did next around it in the following minute, described by code in plain geometry
// ("wrote 3 notes at the free ends", "pasted 2 things beside it", "erased it"). The next time the same form
// appears, on any board, those lines go to the model as HABITS: a prior for which function is meant.
// Nothing here decides a meaning: it is evidence, and words on the board still outrank it.

import { authorOf } from './provenance';
import type { Form } from './forms';
import type { Trace } from './trace';

export type Habit = { t: number; outcome: 'accepted' | 'dismissed' | 'chose' | 'not offered' | 'pending'; fn?: string; next?: string };
type Book = Record<string, Habit[]>;
type Watch = { sig: string; t0: number; ids: Set<string>; blanks: Set<string>; box: { x: number; y: number; w: number; h: number }; ends: { x: number; y: number }[]; habit: Habit };

const KEY = 'cx:habits', PER = 6, SIGS = 60, WATCH_MS = 75_000;
const read = (): Book => { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { return {}; } };
const write = (b: Book) => { try { const keys = Object.keys(b); if (keys.length > SIGS) for (const k of keys.sort((x, y) => (b[x][0]?.t ?? 0) - (b[y][0]?.t ?? 0)).slice(0, keys.length - SIGS)) delete b[k]; localStorage.setItem(KEY, JSON.stringify(b)); } catch { /* storage may be off: habits are a convenience */ } };

export class Habits {
  private book: Book = read();
  private watches: Watch[] = [];
  private aiAt = new Map<string, number>();   // notes the AI wrote into, and when: its own writing is not the user's act
  constructor(private gfx: any, private store: any) {}

  /** A form was noticed (and maybe answered). Start watching what follows. */
  open(forms: Form[], idsOf: (f: Form) => string[], blanksOf: (f: Form) => string[] = () => []): void {
    for (const f of forms) {
      const ids = new Set(idsOf(f));
      const same = this.watches.find(w => w.sig === f.signature && [...ids].some(id => w.ids.has(id)));
      if (same) { ids.forEach(id => same.ids.add(id)); continue; }
      const habit: Habit = { t: Date.now(), outcome: 'pending' };
      (this.book[f.signature] ??= []).unshift(habit); this.book[f.signature].length = Math.min(this.book[f.signature].length, PER);
      this.watches.push({ sig: f.signature, t0: Date.now(), ids, blanks: new Set(blanksOf(f)), box: f.box, ends: (f.ends ?? []).map(e => ({ x: e.x, y: e.y })), habit });
    }
    write(this.book);
  }

  /** The AI just wrote into these (the user's blanks). Later changes to them are the user correcting it. */
  aiWrote(ids: string[]): void { const t = Date.now(); for (const id of ids) this.aiAt.set(id, t); }

  /** What became of the AI's offer for these forms. */
  settle(forms: Form[], outcome: Habit['outcome'], fn?: string): void {
    for (const f of forms) { const w = [...this.watches].reverse().find(x => x.sig === f.signature); if (w) { w.habit.outcome = outcome; if (fn) w.habit.fn = fn.slice(0, 60); } }
    write(this.book);
  }

  /** Called on every look at the board: describe what the user did next around each watched form. */
  tick(trace: Trace, aiIds?: Set<string>): void {
    if (!this.watches.length) return;
    const now = Date.now(); let dirty = false;
    for (const w of this.watches) {
      const acts = trace.acts.filter(a => a.t > w.t0 + 400 && a.kind !== 'accept' && a.kind !== 'dismiss');
      const near = (id: string) => { const e: any = this.gfx.getElementById(id); if (!e) return false; const b = e.elementBound, P = 360; return b.x + b.w >= w.box.x - P && b.x <= w.box.x + w.box.w + P && b.y + b.h >= w.box.y - P && b.y <= w.box.y + w.box.h + P; };
      const atEnd = (id: string) => { const e: any = this.gfx.getElementById(id); if (!e || !w.ends.length) return false; const b = e.elementBound; return w.ends.some(p => Math.hypot(Math.max(b.x - p.x, 0, p.x - (b.x + b.w)), Math.max(b.y - p.y, 0, p.y - (b.y + b.h))) < 90); };
      const words = (id: string, d?: string) => { if (d) return d.slice(0, 24); const e: any = this.gfx.getElementById(id); const t = e?.text ?? e?.props?.title ?? ''; return String(typeof t === 'string' ? t : t?.toString?.() ?? '').replace(/\s+/g, ' ').trim().slice(0, 24); };
      const mine = (id: string) => authorOf(this.store, id) === 'user' && !aiIds?.has(id);
      const wrote: string[] = [], bits: string[] = [], fixed: string[] = [], filledIn: string[] = []; let shifted = 0; let ends = 0, blanks = 0, pasted = 0, lines = 0, erased = 0, moved = 0, edited = 0;
      for (const a of acts) {
        if (a.kind === 'delete') { if (a.ids.some(id => w.ids.has(id))) erased++; continue; }
        { const t0 = Math.max(0, ...a.ids.map(id => this.aiAt.get(id) ?? 0)); if (t0) { if (a.t <= t0 + 2500) continue; if (a.kind === 'edit') { fixed.push(words(a.ids[0], a.detail)); continue; } } }
        // corrections to what the AI put there are the clearest lesson
        const ai = a.ids.filter(id => !mine(id) && near(id));
        if (ai.length && a.kind === 'edit') { fixed.push(words(ai[0], a.detail)); continue; }
        if (ai.length && (a.kind === 'move' || a.kind === 'resize')) { shifted++; continue; }
        const ids = a.ids.filter(id => mine(id) && (w.ids.has(id) || near(id))); if (!ids.length) continue;
        if (a.kind === 'add' && !a.blank && !w.ids.has(ids[0])) { wrote.push(words(ids[0], a.detail)); if (atEnd(ids[0])) ends++; }
        else if (a.kind === 'add' && a.blank) blanks++;
        else if (a.kind === 'edit' && !w.ids.has(ids[0])) { wrote.push(words(ids[0], a.detail)); if (atEnd(ids[0])) ends++; if (blanks) blanks--; }
        else if (a.kind === 'edit' && w.blanks.has(ids[0])) filledIn.push(words(ids[0], a.detail));
        else if (a.kind === 'edit') edited++;
        else if (a.kind === 'paste') { const w2 = ids.filter(id => words(id).length > 0 && words(id).length <= 24 && atEnd(id)); if (w2.length) { w2.forEach(id => wrote.push(words(id))); ends += w2.length; } pasted += ids.length - w2.length; }
        else if (a.kind === 'connect' || a.kind === 'draw') lines += ids.filter(id => !w.ids.has(id)).length;
        else if (a.kind === 'move' && w.ids.has(ids[0])) moved++;
      }
      if (erased) bits.push('erased it');
      if (fixed.length) bits.push(`rewrote the AI's text to ${[...new Set(fixed)].filter(Boolean).slice(0, 3).map(t => JSON.stringify(t)).join(', ')}`);
      if (shifted) bits.push(`moved ${shifted > 1 ? 'the AI\'s cards' : 'an AI card'}`);
      if (filledIn.length) bits.push(`filled the blank${filledIn.length > 1 ? 's' : ''} themselves: ${[...new Set(filledIn)].filter(Boolean).slice(0, 4).map(t => JSON.stringify(t)).join(', ')}`);
      if (wrote.length) bits.push(`wrote ${wrote.length} note${wrote.length > 1 ? 's' : ''} ${ends >= Math.max(1, wrote.length - 1) ? 'at the free ends' : 'beside it'}: ${wrote.filter(Boolean).slice(0, 4).map(t => JSON.stringify(t)).join(', ')}`);
      if (blanks > 0) bits.push(`added ${blanks} blank note${blanks > 1 ? 's' : ''}`);
      if (pasted) bits.push(`pasted ${pasted} thing${pasted > 1 ? 's' : ''} beside it`);
      if (lines) bits.push(`drew ${lines} more line${lines > 1 ? 's' : ''}`);
      if (edited) bits.push('rewrote its own words');
      if (moved && !bits.length) bits.push('rearranged it');
      const next = bits.join('; ') || (now - w.t0 > 30_000 ? 'left it as it was' : '');
      if (next && next !== w.habit.next) { w.habit.next = next; dirty = true; }
    }
    const before = this.watches.length;
    this.watches = this.watches.filter(w => now - w.t0 < WATCH_MS);
    if (this.watches.length !== before) { for (const hs of Object.values(this.book)) for (const h of hs) if (h.outcome === 'pending' && now - h.t > WATCH_MS) h.outcome = 'not offered'; dirty = true; }
    if (dirty) write(this.book);
  }

  /** HABITS lines for these forms: exact signature first, then the same kind of form with other facts. */
  serialise(forms: Form[]): string[] {
    const L: string[] = [];
    const line = (h: Habit) => `${h.outcome === 'accepted' ? `accepted "${h.fn}"` : h.outcome === 'dismissed' ? `dismissed "${h.fn}"` : h.outcome === 'chose' ? `chose "${h.fn}" from two` : 'nothing was offered'}${h.next ? `, then ${h.next}` : ''}`;
    const tally = (hs: Habit[]) => { const m = new Map<string, number>(); for (const h of hs) { const k = line(h); m.set(k, (m.get(k) ?? 0) + 1); } return [...m].map(([k, n]) => (n > 1 ? `${k} ×${n}` : k)); };
    for (const f of forms) {
      const exact = (this.book[f.signature] ?? []).filter(h => h.fn || h.next);
      if (exact.length) L.push(`${f.id} same form before (${f.signature}), newest first: ${tally(exact).join(' | ')}`);
      const kin = Object.entries(this.book).filter(([sig]) => sig !== f.signature && sig.split(' · ')[0] === f.kind).flatMap(([sig, hs]) => hs.filter(h => h.fn && h.outcome !== 'pending').slice(0, 2).map(h => `${sig}: ${line(h)}`)).slice(0, 3);
      if (kin.length) L.push(`${f.id} similar forms (weaker): ${kin.join(' | ')}`);
    }
    return L;
  }

  all(): Book { return this.book; }
  clear(): void { this.book = {}; this.watches = []; write(this.book); }
}
