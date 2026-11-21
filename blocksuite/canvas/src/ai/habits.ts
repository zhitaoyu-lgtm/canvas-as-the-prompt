// Cases: one memory of what this person meant, and what they did, in moments like this one.
//
// A case is a moment the board was read: the situation in plain words ("HCI" with 3 lines into empty space),
// its general features (which kinds of openings, about what kind of thing, drawn how, with what nearby), what
// was offered, what became of the offer (kept, dismissed, a choice between two, nothing offered), and what the
// user did next by hand in the following minute, described by code in plain geometry.
//
// Retrieval is by likeness of features, not by a named form: a moment that shares most features with an old
// one brings that case back, on any board. So the memory also works for structures no code has a name for.
// A case never decides a meaning: it is evidence the model weighs, and words on the board outrank it.

import { authorOf } from './provenance';
import type { Trace } from './trace';


export type Case = { t: number; features: string[]; situation: string; outcome: 'accepted' | 'dismissed' | 'chose' | 'not offered' | 'pending'; fn?: string; next?: string };
export type Moment = { features: string[]; situation: string; ids: string[]; blanks: string[]; box: { x: number; y: number; w: number; h: number }; ends: { x: number; y: number }[] };
type Watch = { key: string; t0: number; ids: Set<string>; blanks: Set<string>; box: { x: number; y: number; w: number; h: number }; ends: { x: number; y: number }[]; habit: Case };

const KEY = 'cx:cases', KEEP = 80, WATCH_MS = 75_000;
const read = (): Case[] => { try { const v = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const write = (b: Case[]) => { try { if (b.length > KEEP) b.length = KEEP; localStorage.setItem(KEY, JSON.stringify(b)); } catch { /* storage may be off: memory is a convenience */ } };
/** How alike two moments are: shared features over all features (0…1). */
export const likeness = (a: string[], b: string[]) => { const A = new Set(a), B = new Set(b); let n = 0; for (const x of A) if (B.has(x)) n++; const u = A.size + B.size - n; return u ? n / u : 0; };

export class Habits {
  private book: Case[] = read();
  private watches: Watch[] = [];
  private aiAt = new Map<string, number>();   // notes the AI wrote into, and when: its own writing is not the user's act
  constructor(private gfx: any, private store: any) {}

  /** A moment reached the model. Open its case and start watching what follows. */
  open(m: Moment): void {
    const key = m.features.join(' ');
    const same = this.watches.find(w => w.key === key && m.ids.some(id => w.ids.has(id)));
    if (same) { m.ids.forEach(id => same.ids.add(id)); return; }
    const habit: Case = { t: Date.now(), features: m.features, situation: m.situation, outcome: 'pending' };
    this.book.unshift(habit);
    this.watches.push({ key, t0: Date.now(), ids: new Set(m.ids), blanks: new Set(m.blanks), box: m.box, ends: m.ends, habit });
    write(this.book);
  }

  /** The AI just wrote into these (the user's blanks). Later changes to them are the user correcting it. */
  aiWrote(ids: string[]): void { const t = Date.now(); for (const id of ids) this.aiAt.set(id, t); }

  /** What became of the offer for the moment now being watched. */
  settle(features: string[], outcome: Case['outcome'], fn?: string): void {
    const key = features.join(' ');
    const w = [...this.watches].reverse().find(x => x.key === key);
    if (w) { w.habit.outcome = outcome; if (fn) w.habit.fn = fn.slice(0, 60); }
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
    if (this.watches.length !== before) { for (const h of this.book) if (h.outcome === 'pending' && now - h.t > WATCH_MS) h.outcome = 'not offered'; dirty = true; }
    if (dirty) write(this.book);
  }

  /** CASES for this moment: earlier moments that share most of its features, most alike first. */
  serialise(features: string[]): string[] {
    const line = (h: Case) => `${h.outcome === 'accepted' ? `kept "${h.fn}"` : h.outcome === 'dismissed' ? `dismissed "${h.fn}"` : h.outcome === 'chose' ? `chose "${h.fn}" from two` : 'nothing was offered'}${h.next ? `, then ${h.next}` : ''}`;
    const live = new Set(this.watches.filter(w => w.habit.outcome === 'pending' && !w.habit.next).map(w => w.habit));
    const hits = this.book.filter(h => !live.has(h) && (h.fn || h.next)).map(h => ({ h, s: likeness(features, h.features) })).filter(x => x.s >= 0.5).sort((a, b) => b.s - a.s || b.h.t - a.h.t).slice(0, 5);
    return hits.map(({ h, s }) => `${s >= 0.99 ? 'the same kind of moment' : s >= 0.75 ? 'a very similar moment' : 'a similar moment'}: ${h.situation} → ${line(h)}`);
  }

  all(): Case[] { return this.book; }
  clear(): void { this.book = []; this.watches = []; write(this.book); }
}
