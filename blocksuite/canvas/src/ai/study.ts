// A used board for one scenario: studying light and composition in Greek sculpture.
// Pictures are fetched from Wikipedia when the board is made (the page must be online); the notes, the
// worked examples and the legend of triggers are written here. Alt+Shift+G makes it again.

import * as Y from 'yjs';
import { Text } from '@blocksuite/affine/store';
import { CARD_STYLE, FILL, stickyProps } from '../design';
import { markAi } from './provenance';

type Pic = { page: string; title: string; meta: string; note: string; colour: keyof typeof FILL };
const PICS: Pic[] = [
  { page: 'Kritios Boy', title: 'Kritios Boy', meta: 'c. 480 BC · marble · Acropolis Museum, Athens', note: 'First time the weight sits on one leg', colour: 'yellow' },
  { page: 'Doryphoros', title: 'Doryphoros (Spear-Bearer)', meta: 'Polykleitos, c. 440 BC · Roman marble copy', note: 'Hips tilt one way, shoulders the other', colour: 'orange' },
  { page: 'Discobolus', title: 'Discobolus (Discus Thrower)', meta: 'Myron, c. 450 BC · Roman copy', note: 'Two arcs: the arms, and the body bent under them', colour: 'orange' },
  { page: 'Artemision Bronze', title: 'Artemision Bronze', meta: 'c. 460 BC · bronze · National Archaeological Museum, Athens', note: 'A cross: arms level, stride wide', colour: 'yellow' },
  { page: 'Winged Victory of Samothrace', title: 'Winged Victory of Samothrace', meta: 'c. 190 BC · Parian marble · Louvre', note: 'Raking light: the folds are drawn by their shadows', colour: 'red' },
  { page: 'Laocoön and His Sons', title: 'Laocoön and His Sons', meta: 'Hellenistic · marble · Vatican Museums', note: 'Everything runs along one diagonal', colour: 'red' },
];

const TRIGGERS: [string, string, string, string][] = [
  ['ACTIVE', 'Circle and ask', 'Draw a loop around part of a picture, select the loop, click the blue dot (or press /) and type a question.', 'Claude looks at what is inside the loop and answers beside it.'],
  ['PASSIVE', 'Point and name', 'Type a short label. Draw an arrow from the label to a spot on a picture. Wait two seconds.', 'Up to three cards beside the label: an insight about that spot, a source, and what else on the board shows the same idea.'],
  ['PASSIVE', 'Link two things', 'Draw an arrow from one picture or card to another, with no words on it.', 'The line gets a short label for the relation; “+n” on it opens bridges and counterpoints.'],
  ['PASSIVE', 'Name a section', 'Draw a section and give it a real name (not “Frame 1”).', 'Copies of what belongs in it, and sources, appear inside as one pending set.'],
  ['PASSIVE', 'Underline', 'Draw a flat pen stroke just under one thing.', 'A comment pin on it says why it matters on this board.'],
  ['PASSIVE', 'Same mark twice', 'Put the same small mark (a dot, an emoji, a short note) on two things.', 'The same mark is offered on the other things that are alike.'],
];

async function pictureOf(page: string): Promise<Blob | null> {
  const get = async (u: string) => { const r = await fetch(u); if (!r.ok) throw new Error(String(r.status)); return r; };
  try {
    const j = await (await get(`https://en.wikipedia.org/w/api.php?action=query&redirects=1&titles=${encodeURIComponent(page)}&prop=pageimages&piprop=thumbnail&pithumbsize=1280&format=json&origin=*`)).json();
    const src = (Object.values(j?.query?.pages ?? {})[0] as any)?.thumbnail?.source;
    if (src) { const b = await (await get(src)).blob(); if (b.type.startsWith('image/')) return b; }
  } catch { /* try the summary */ }
  try {
    const j = await (await get(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(page.replace(/ /g, '_'))}`)).json();
    const src = j?.originalimage?.width <= 2400 ? j.originalimage.source : j?.thumbnail?.source;
    if (src) { const b = await (await get(src)).blob(); if (b.type.startsWith('image/')) return b; }
  } catch { /* no picture */ }
  return null;
}

export async function studyBoard(rootEl: any) {
  const gfx = rootEl.gfx, s = gfx.surface, store = rootEl.std.store;
  const b = gfx.elementsBound; const ox = b && b.w ? Math.round(b.x) : 0, oy = b && b.w ? Math.round(b.y + b.h + 400) : 0;
  const yt = (t: string) => { const y = new Y.Text(); y.insert(0, t); return y; };
  const gray = { color: 'var(--affine-text-secondary-color)' };
  const P = (t: string, a?: any) => new Text(a ? [{ insert: t, attributes: a }] as any : t);
  const ai: string[] = [];
  const card = (x: number, y: number, w: number, lines: [string, any?][]) => {
    const id = store.addBlock('affine:note', { xywh: `[${ox + x},${oy + y},${w},80]`, background: '#ffffff', edgeless: { style: CARD_STYLE } } as any, store.root.id);
    for (const [t, a] of lines) store.addBlock('affine:paragraph', { text: P(t, a) }, id);
    return id as string;
  };
  const text = (x: number, y: number, t: string, size: number, o: { bold?: boolean; muted?: boolean; w?: number } = {}) =>
    s.addElement({ type: 'text', xywh: `[${ox + x},${oy + y},${o.w ?? 900},${Math.round(size * 1.4)}]`, text: yt(t), fontSize: size, fontWeight: o.bold ? '700' : '400', color: o.muted ? '#8e8e93' : '#1e1e1e', hasMaxWidth: !!o.w }) as string;
  const note = (x: number, y: number, c: keyof typeof FILL, t: string) => s.addElement({ type: 'shape', ...stickyProps(FILL[c], ox + x, oy + y, 160), text: yt(t) }) as string;
  const arrow = (from: any, to: any, label?: string, dashed = false) => s.addElement({ type: 'connector', source: from, target: to, mode: 2, stroke: '#6e6e73', strokeWidth: 2, strokeStyle: dashed ? 'dash' : 'solid',
    rearEndpointStyle: 'Arrow', frontEndpointStyle: 'None', ...(label ? { text: yt(label), labelDisplay: true, labelStyle: { color: '#1e1e1e', fontSize: 14, fontFamily: 'blocksuite:surface:Inter', fontWeight: '500', fontStyle: 'normal', textAlign: 'center' } } : {}) }) as string;

  // nothing here is something the user just did: the board does not react while it is being laid out
  const sense: any = (window as any).cxSense; const was = sense?.enabled; if (sense) sense.enabled = false;
  const blobs = await Promise.all(PICS.map(p => pictureOf(p.page)));
  store.captureSync();
  text(0, -150, 'Figure study · light and composition in Greek sculpture', 32, { bold: true });
  text(0, -96, 'A used board: pictures collected, notes placed beside them, and six ways the board answers what you draw.', 16, { muted: true });

  // the legend: what to draw, and what comes back
  text(0, 0, 'Spatial grammar · what triggers what', 20, { bold: true });
  TRIGGERS.forEach(([mode, name, trig, ans], k) => card(0, 52 + k * 300, 340, [[`${k + 1} · ${mode}`, gray], [name, { bold: true }], ['Trigger: ' + trig], ['Answer: ' + ans, gray]]));

  // the pictures: three to a row, each with its caption and the note written beside it
  const W = 380, GAP = 260, X0 = 440;
  const ids: (string | null)[] = []; const boxes: { x: number; y: number; w: number; h: number }[] = [];
  let y = 52;
  for (let row = 0; row < 2; row++) {
    let rowH = 0;
    for (let col = 0; col < 3; col++) {
      const k = row * 3 + col, p = PICS[k], x = X0 + col * (W + GAP); let h = 300, id: string | null = null;
      const blob = blobs[k];
      if (blob) {
        try {
          const bmp = await createImageBitmap(blob); h = Math.round(W * bmp.height / bmp.width);
          const sourceId = await store.blobSync.set(blob);
          id = store.addBlock('affine:image', { sourceId, xywh: `[${ox + x},${oy + y},${W},${h}]`, width: bmp.width, height: bmp.height } as any, s.id) as string;
        } catch { id = null; }
      }
      if (!id) { h = 170; id = card(x, y, W, [['PICTURE NOT LOADED', gray], [p.title, { bold: true }], ['Paste the image here: en.wikipedia.org/wiki/' + p.page.replace(/ /g, '_'), gray]]); }
      ids.push(id); boxes.push({ x, y, w: W, h });
      text(x, y + h + 14, p.title, 16, { bold: true, w: W });
      text(x, y + h + 40, p.meta, 13, { muted: true, w: W });
      note(x + W + 32, y + 24, p.colour, p.note);
      rowH = Math.max(rowH, h);
    }
    y += rowH + 150;
  }

  // worked examples, so the board reads as used
  // · point and name: a label, an arrow to the hips of the Doryphoros, and the cards that came back
  const d = boxes[1]; const lx = d.x + W + 32, ly = d.y + 230;
  const lab = text(lx, ly, 'contrapposto', 18, { bold: true, w: 170 });
  if (ids[1]) arrow({ id: lab }, { id: ids[1], position: [0.52, 0.5] });
  ai.push(card(lx, ly + 44, 210, [['INSIGHT', gray], ['Weight on one leg', { bold: true }], ['The standing leg pushes its hip up; the shoulders tilt the other way, so the spine becomes a soft S.', gray]]));
  ai.push(card(lx, ly + 300, 210, [['SOURCE · Kenneth Clark · 1956', gray], ['The Nude: A Study in Ideal Form', { bold: true }], ['On Polykleitos and the balance of tension and rest.', gray]]));
  // · link two things: the earlier figure and the one that made a rule of it
  if (ids[0] && ids[1]) ai.push(arrow({ id: ids[0], position: [1, 0.35] }, { id: ids[1], position: [0, 0.35] }, 'first step → canon'));
  // · same idea in another picture, tied by a dashed line
  if (ids[4] && ids[5]) ai.push(arrow({ id: ids[4], position: [1, 0.3] }, { id: ids[5], position: [0, 0.3] }, 'light makes the form', true));

  markAi(store, ai);
  store.captureSync();
  sense?.rebase?.(); if (sense) sense.enabled = was ?? true;
  const h = Math.max(y, 52 + TRIGGERS.length * 300) + 40;
  try { gfx.viewport.setViewportByBound({ x: ox - 80, y: oy - 220, w: X0 + 3 * (W + GAP) + 80, h: h + 260 }, [40, 40, 120, 40], true); } catch { /* keep view */ }
  return blobs.filter(Boolean).length;
}
