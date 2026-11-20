// Ask → read the board → Claude → place the answer as a proposal.

import { execute, type Answer } from './actions';
import { systemPrompt, userPrompt } from './grammar';
import { ask, online, parseAnswer, ModelError } from './model';
import { toast } from './proposals';
import { readBoard, toPrompt, type Box } from './reading';
import { pictures, lookOf } from './look';
import { addKey } from './keys';

export function createAssistant(rootEl: any) {
  const gfx = rootEl.gfx, store = rootEl.std.store;
  const log: any[] = [];
  (window as any).cxLog = log;    // last exchanges, for the developer view

  const TIDY = /(tidy|clean\s*up|organi[sz]e|align|fix the layout|neaten|整理|排版|对齐|理一下|收拾)/i, MORE = /(find|add|more|search|suggest|找|添加|补充|更多|搜|推荐)/i;
  return async function onSubmit(request: string, ids: string[]) {
    const reading = readBoard(gfx, { selection: ids });
    // "tidy this" on a selected section is a layout repair, done exactly and at once, with no model in between
    const frames = ids.filter(id => (gfx.getElementById(id) as any)?.flavour === 'affine:frame');
    if (frames.length && TIDY.test(request) && !MORE.test(request) && request.length <= 40) {
      store.captureSync();
      const res = await execute(rootEl, reading, { actions: [{ do: 'tidy', refs: frames.map(id => reading.byId.get(id)?.ref).filter(Boolean) as string[] }] });
      store.captureSync();
      if (res.errors.length) console.warn('[ai] tidy:', res.errors);
      return false;
    }
    const text = toPrompt(reading);
    // always look as well as read: a quiet off-screen picture of what is asked about (or the view)
    const focusBoxes = [...reading.focus.map(r => reading.byRef.get(r)?.box), ...reading.structures.filter(st => reading.focus.includes(st.ref)).map(st => st.box)].filter(Boolean) as Box[];
    const area = focusBoxes.length ? unionBox(focusBoxes) : reading.viewport;
    const seen = await pictures(rootEl, reading, area, reading.focus).catch(() => ({ blobs: [] as Blob[], note: '' }));
    const picture = seen.blobs.length ? seen.blobs : null;
    let context = ''; try { context = (window as any).cxIntent?.context?.(reading) ?? ''; } catch { context = ''; }
    const entry: any = { at: new Date().toISOString(), request, reading: text, context, picture: !!picture, pictures: seen.blobs };
    log.unshift(entry); log.length = Math.min(log.length, 10);
    try {
      const mock = (window as any).cxMockAnswer;   // tests only: a fixed answer instead of the model
      const raw = mock ? (typeof mock === 'function' ? await mock(text, request) : mock) : await ask(systemPrompt(), userPrompt(text, request, !!picture, online(), context, seen.note), picture);
      entry.raw = raw; entry.look = lookOf(raw);
      const answer: Answer = typeof raw === 'string' ? parseAnswer(raw) : raw;
      // what the user just told us a sign means is kept for the rest of this board
      for (const k of (Array.isArray((answer as any).remember) ? (answer as any).remember : []).slice(0, 6)) if (k?.sign && k?.means) addKey(store, { scope: { kind: 'board' }, form: String(k.sign).slice(0, 60), means: String(k.means).slice(0, 80), source: 'accepted' });
      store.captureSync();
      const result = await execute(rootEl, reading, answer);
      store.captureSync();
      entry.result = result;
      if (result.errors.length) console.warn('[ai] some parts did not apply:', result.errors);
      if (!result.created.length && !result.changed.length) { toast(answer.say || 'Nothing to change here.', anchor(ids)); return true; }
      return false;
    } catch (e: any) {
      entry.error = String(e?.message ?? e);
      const code = e instanceof ModelError ? e.code : '';
      toast(code === 'no_model' ? 'Connect Claude in the side panel (Chat) first.'
        : code === 'not_granted' ? 'Claude was not allowed for this page.'
        : code === 'rate_limited' ? 'Claude is busy. Try again in a moment.'
        : code === 'bad_answer' || e instanceof SyntaxError ? 'Claude’s answer could not be placed. Try again.'
        : 'Couldn’t reach Claude.', anchor(ids));
      console.warn('[ai]', e);
      return true;
    }
  };

  function anchor(ids: string[]) {
    const els = ids.map(id => gfx.getElementById(id)).filter(Boolean) as any[];
    if (!els.length) return undefined;
    const b = unionBox(els.map(e => e.elementBound));
    const rr = rootEl.getBoundingClientRect();
    const [x, y] = gfx.viewport.toViewCoord(b.x + b.w / 2, b.y + b.h);
    return { x: rr.left + x, y: rr.top + y + 16 };
  }
}

function unionBox(bs: Box[]): Box {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const b of bs) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}
