// KEYS: meanings the user has accepted (or turned down), with where they hold.
//
// When the user keeps an answer, the board remembers "here, this form meant that". Next time the same form
// appears in the same place, that is the strongest cue the model gets. A meaning holds in its own scope (the
// section it was made in, or the area around it); outside it the form is read afresh. Kept in the board's
// own document, beside who-made-what and the comments, so it survives reloads and travels with the board.

import type { Box, Reading } from './reading';

export type Key = {
  id: string;
  scope: { kind: 'section' | 'region' | 'board'; id?: string; title?: string; box?: Box };
  form: string;          // the form's signature, in words
  means: string;         // the function, in the model's words
  source: 'accepted' | 'dismissed' | 'chosen' | 'not-chosen';
  at: number;
};

const KEY = 'cx:keys';
const mapOf = (store: any) => store?.spaceDoc?.getMap?.(KEY) ?? store?.doc?.spaceDoc?.getMap?.(KEY);

export function allKeys(store: any): Key[] {
  const m = mapOf(store); if (!m) return [];
  return ([...m.values()] as Key[]).sort((a, b) => a.at - b.at);
}
export function addKey(store: any, k: Omit<Key, 'id' | 'at'>) {
  const m = mapOf(store); if (!m) return;
  // one meaning per form and scope: a newer decision replaces an older one
  for (const [id, o] of [...m.entries()] as [string, Key][]) if (o.form === k.form && sameScope(o.scope, k.scope) && o.means.toLowerCase() === k.means.toLowerCase()) m.delete(id);
  const id = 'k' + Math.random().toString(36).slice(2, 9);
  m.set(id, { ...k, id, at: Date.now() });
}
export function removeKey(store: any, id: string) { mapOf(store)?.delete(id); }
const sameScope = (a: Key['scope'], b: Key['scope']) => a.kind === b.kind && (a.id ?? '') === (b.id ?? '') && JSON.stringify(a.box ?? null) === JSON.stringify(b.box ?? null);

/** Was this form, in this scope, turned down a moment ago? (the board then stays quiet for a while) */
export function dismissedRecently(store: any, signature: string, ms = 5 * 60_000): boolean {
  return allKeys(store).some(k => k.source === 'dismissed' && k.form === signature && Date.now() - k.at < ms);
}

/** The KEYS section, in plain words, with refs from this reading. */
export function serialiseKeys(store: any, r: Reading): string[] {
  const clock = (t: number) => new Date(t).toTimeString().slice(0, 5);
  const keys = allKeys(store).slice(-12);
  const where = (k: Key) => {
    if (k.scope.kind === 'section') { const f = k.scope.id ? r.byId.get(k.scope.id) : undefined; return f ? `in ${f.ref} "${f.text.trim()}"` : `in a section "${k.scope.title ?? ''}" (now gone)`; }
    if (k.scope.kind === 'region' && k.scope.box) { const b = k.scope.box; return `in the area @${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.w)}×${Math.round(b.h)}`; }
    return 'board';
  };
  const lines = keys.map(k => {
    const verdict = k.source === 'accepted' ? 'accepted' : k.source === 'chosen' ? 'chosen over the other reading' : k.source === 'not-chosen' ? 'not chosen' : 'dismissed';
    const eq = k.source === 'accepted' || k.source === 'chosen' ? '=' : '≠';
    return `- ${where(k)}: ${k.form} ${eq} ${k.means} (${verdict} ${clock(k.at)})`;
  });
  // legends the user drew are meanings too
  for (const l of r.relations.legend) lines.push(`- legend ${l.ref}: ${l.colour} = ${l.label}${l.usedBy.length ? ` (used by ${l.usedBy.slice(0, 6).join(' ')})` : ''}`);
  return lines;
}

/** Plain sentences for the Key card ("Here, arrows from a note to blanks = break into parts"). */
export function keySentence(k: Key): string {
  const form = k.form.replace(/ · /g, ' ').replace(/\bfan-out\b/, 'arrows out of').replace(/\bfan-in\b/, 'arrows into').replace(/\bshort-concept\b/, 'a short note').replace(/\bblank\b/, 'to blanks');
  return `${k.scope.kind === 'section' ? `In “${k.scope.title ?? 'this section'}”` : 'Here'}, ${form} = ${k.means}`;
}
