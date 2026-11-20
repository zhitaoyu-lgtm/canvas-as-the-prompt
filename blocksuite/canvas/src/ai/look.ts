// Seeing and context, shared by every way of asking (a typed request, a drawn form).
//
// The model is as good as what it is shown. Two things were missing whenever the canvas answered worse than a
// chat would: a picture it could actually read (in stacking order, close enough to see what a sticker sits on),
// and permission to think about this board before filling in a format. Both live here.

import type { Box, Item, Reading } from './reading';
import { snapshot } from './snapshot';

const area = (b: Box) => b.w * b.h;
const hit = (a: Box, b: Box) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/** The pictures for one call: the area as it looks, then a close-up of each photo in it that has things on it
 *  (or that the form speaks about). Returns the blobs and one line telling the model which is which. */
export async function pictures(rootEl: any, r: Reading, box: Box, refs: string[] = []): Promise<{ blobs: Blob[]; note: string }> {
  const blobs: Blob[] = [], notes: string[] = [];
  const over = box.w > 0 && box.h > 0 ? await snapshot(rootEl, box, 1400, 32) : null;
  if (over) { blobs.push(over); notes.push(`Picture ${blobs.length}: this part of the board as it looks now.`); }
  const asked = new Set(refs);
  const photos = r.items.filter(i => i.kind === 'image' && hit(i.box, { x: box.x - 40, y: box.y - 40, w: box.w + 80, h: box.h + 80 }))
    .map(i => ({ i, on: r.items.filter(o => o !== i && area(o.box) < area(i.box) * 0.3 && o.box.x + o.box.w / 2 >= i.box.x && o.box.x + o.box.w / 2 <= i.box.x + i.box.w && o.box.y + o.box.h / 2 >= i.box.y && o.box.y + o.box.h / 2 <= i.box.y + i.box.h).length }))
    .filter(x => x.on > 0 || asked.has(x.i.ref) || area(x.i.box) < area(box) * 0.5)
    .sort((a, b) => (asked.has(b.i.ref) ? 1 : 0) - (asked.has(a.i.ref) ? 1 : 0) || b.on - a.on).slice(0, 2);
  for (const ph of photos) {
    // the whole board was already one picture of mostly this photo: a second copy adds nothing
    if (over && area(ph.i.box) > area(box) * 0.8) continue;
    const b = await snapshot(rootEl, ph.i.box, 1400, 10);
    if (b) { blobs.push(b); notes.push(`Picture ${blobs.length}: close-up of ${ph.i.ref} with everything stuck or drawn on it${ph.on ? ` (${ph.on} thing${ph.on > 1 ? 's' : ''})` : ''}.`); }
  }
  return { blobs, note: notes.join(' ') };
}

/** What a statement also speaks about without touching it: the other copies of its signs (the same sticker
 *  elsewhere) and the pictures those copies lie on. They belong in the picture the model is shown. */
export function related(r: Reading, refs: string[]): Item[] {
  const out = new Set<Item>();
  for (const ref of refs) {
    const it = r.byRef.get(ref); if (!it?.asset) continue;
    for (const twin of r.items) if (twin !== it && twin.asset === it.asset) {
      out.add(twin);
      const host = r.items.filter(h => h.kind === 'image' && h !== twin && area(h.box) > area(twin.box) * 3 && twin.box.x + twin.box.w / 2 >= h.box.x && twin.box.x + twin.box.w / 2 <= h.box.x + h.box.w && twin.box.y + twin.box.h / 2 >= h.box.y && twin.box.y + twin.box.h / 2 <= h.box.y + h.box.h).sort((a, b) => area(a.box) - area(b.box))[0];
      if (host) out.add(host);
    }
  }
  return [...out];
}

export const MEANING = `
MEANING COMES FROM THIS BOARD (this outranks every general habit of reading below)
A sign has no fixed meaning. A star, a colour, an arrow, a tick, a loop mean what THIS board makes them mean.
Work out what a sign means in this order, and stop at the first that answers:
 1. what the user said: the request, words on the board, a legend or key they made ("star = nucleus");
 2. what the user showed: a completed example of the same thing (PRECEDENTS);
 3. what was settled here before (KEYS), then what this person usually does (HABITS);
 4. what the sign touches. A sticker, loop, stroke or note lying on a part of a picture (or on a line of a text)
    refers to THAT part: look at the pictures and say what is under it. The same sticker or mark in two places is
    one sign used twice: when it also stands in a list, a key or beside an arrow or a gap, that place asks for (or
    names) what its twin on the picture sits on. Colours work the same way: a note the colour of a part speaks
    about that part;
 5. only when none of these says anything: a general convention, offered as a guess.
When the user gives one mapping ("the star is the nucleus"), it is the pattern for the others: answer each of
the others the same way (the thing under ITS twin), in the same kind of words.
A generic answer (star = highlight, question mark = open question, rocket = next step) when the board gives a
specific referent is a failure.`;

export const LOOK = `
LOOK BEFORE YOU ANSWER
Before the JSON, write a section that starts with the word LOOK: plain sentences, no curly braces, at most 120
words, never shown to the user. Say: what the pictures show; for every small sign that lies on a picture, what
is under it; which signs are the same sign in two places; what the user said or demonstrated; and therefore what
they want from you. Then give the JSON object. If the pictures and the text disagree, trust the pictures.`;

/** The words before the JSON (the LOOK section), for the developer log. */
export const lookOf = (raw: any): string => (typeof raw === 'string' ? raw.slice(0, Math.max(0, raw.indexOf('{'))).replace(/```(?:json)?/g, '').trim() : '');

export type { Item };
