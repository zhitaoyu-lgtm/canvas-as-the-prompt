// Checks with the real model.
//
// Everything the framework claims has to be seen on real answers, not on stand-ins. This replays a fixed set of
// small boards beside the user's own board (far to the right, never touching their things), lets the real model
// read each one, and records what happened at every layer: what code found open, what the model saw (LOOK), what
// it decided (built, lacks, move, function, strength), what it put where, and a picture of the result. Each
// board is removed again before the next. Nothing is learned from a check and nothing remembered is used in one.
//
// Results go to the artifact's database (runs/<run>/results/<scene>), so they can be read back and compared
// run to run. Open with Ctrl+Shift+K (or cxCheck.open()).

import * as Y from 'yjs';
import { Text } from '@blocksuite/affine/store';
import { STAMPS } from '../stickers';
import { SCENES } from './check-scenes';
import { readBoard } from './reading';
import { snapshot } from './snapshot';
import { frames2, wait } from './timer';

type Box = { x: number; y: number; w: number; h: number };
// @ts-ignore vite's glob import (same as stickers.ts)
const cellUrl = Object.values(import.meta.glob('../assets/check/*.jpg', { eager: true, query: '?url', import: 'default' }) as Record<string, string>)[0];
const sleep = wait;
const frames = frames2;
const FILL: Record<string, string> = { yellow: '#ffe299', orange: '#ffd3a8', pink: '#ffa8db', blue: '#a8daff', green: '#b3efbd', red: '#ffafa3', white: '#ffffff', teal: '#b3f4ef', gray: '#e6e6e6', purple: '#d1b8ff' };

export function mountCheck(rootEl: any, assistant: (req: string, ids: string[]) => Promise<any>) {
  const gfx = rootEl.gfx, store = rootEl.std.store, surf = gfx.surface;
  const W = window as any;
  const yt = (t: string) => { const y = new Y.Text(); y.insert(0, t); return y; };
  const surfId = () => store.getBlocksByFlavour('affine:surface')[0].id;
  let stop = false, running = false;
  const state = { run: '', done: 0, total: 0, now: '', note: '', results: [] as any[] };

  // ── building a scene the way a person would ──
  async function build(els: any[], ids: Record<string, string>, o: { x: number; y: number }): Promise<string[]> {
    const made: string[] = [];
    for (const e of els) {
      const X = (e.x ?? 0) + o.x, Yy = (e.y ?? 0) + o.y;
      let id = '';
      if (e.kind === 'frame') id = store.addBlock('affine:frame', { xywh: `[${X},${Yy},${e.w},${e.h}]`, title: new Text(e.text || ''), background: '--affine-palette-transparent', index: gfx.layer.generateIndex(true) }, surfId());
      else if (e.kind === 'sticky') { const w = e.w || 184, h = e.h || 184;
        id = surf.addElement({ type: 'shape', shapeType: 'rect', xywh: `[${X},${Yy},${w},${h}]`, radius: 0.04, filled: true, fillColor: FILL[e.colour || 'yellow'], strokeColor: 'transparent', strokeWidth: 0, color: '#1e1e1e', fontSize: e.text && e.text.length > 60 ? 14 : 16, fontFamily: 'blocksuite:surface:Inter', textAlign: 'left', textHorizontalAlign: 'left', textVerticalAlign: 'top', padding: [16, 16], shadow: { blur: 6, offsetX: 0, offsetY: 2, color: 'rgba(0,0,0,0.06)' }, text: yt(e.text || '') }); }
      else if (e.kind === 'card') {
        id = store.addBlock('affine:note', { xywh: `[${X},${Yy},${e.w || 260},${e.h || 160}]`, background: '#ffffff', edgeless: { style: { borderRadius: 8, borderSize: 0, borderStyle: 'none', shadowType: '--affine-note-shadow-box' } } } as any, store.root.id);
        const gray = { color: 'var(--affine-text-secondary-color)' }; const P = (t: string, a?: any) => new Text(a ? [{ insert: t, attributes: a }] as any : t);
        if (e.meta) store.addBlock('affine:paragraph', { text: P(e.meta, gray) }, id);
        if (e.title) store.addBlock('affine:paragraph', { text: P(e.title, { bold: true }) }, id);
        for (const line of String(e.text || '').split('\n').filter(Boolean)) store.addBlock('affine:paragraph', { text: P(line) }, id);
        if (!e.meta && !e.title && !e.text) store.addBlock('affine:paragraph', { text: P('') }, id);
      }
      else if (e.kind === 'text') id = surf.addElement({ type: 'text', xywh: `[${X},${Yy},${e.w || 300},${e.h || 30}]`, text: yt(e.text), fontSize: e.size || 20, fontWeight: e.bold ? '700' : '400', color: '#1e1e1e', fontFamily: 'blocksuite:surface:Inter' });
      else if (e.kind === 'line') {
        const at = (p?: number[]) => (p ? [p[0] + o.x, p[1] + o.y] : undefined);
        const props: any = { type: 'connector', mode: ({ straight: 0, elbow: 1, curve: 2 } as any)[e.mode || 'elbow'], stroke: '#6e6e73', strokeWidth: 2, strokeStyle: 'solid', source: e.from ? { id: ids[e.from] } : { position: at(e.fromAt) }, target: e.to ? { id: ids[e.to] } : { position: at(e.toAt) }, rearEndpointStyle: 'Arrow', frontEndpointStyle: e.both ? 'Arrow' : 'None' };
        if (e.label) Object.assign(props, { text: yt(e.label), labelDisplay: true, labelOffset: { distance: 0.5, anchor: 'center' }, labelXYWH: [0, 0, e.label.length * 8 + 14, 20], labelStyle: { color: '#3a3a3c', fontSize: 12, fontFamily: 'blocksuite:surface:Inter', fontWeight: '400', fontStyle: 'normal', textAlign: 'center' } });
        id = surf.addElement(props);
      }
      else if (e.kind === 'image') {
        const url = e.asset === 'cell' ? cellUrl : STAMPS.find(s => s.name.toLowerCase() === String(e.asset).toLowerCase())?.url;
        if (!url) continue;
        const blob = await (await fetch(url)).blob(); const sourceId = await store.blobSync.set(blob);
        id = store.addBlock('affine:image', { sourceId, xywh: `[${X},${Yy},${e.w},${e.h}]`, width: e.w, height: e.h, size: blob.size } as any, surfId());
      }
      else if (e.kind === 'stroke') { const xs = e.pts.map((p: number[]) => p[0] + o.x), ys = e.pts.map((p: number[]) => p[1] + o.y); const x0 = Math.min(...xs), y0 = Math.min(...ys);
        id = surf.addElement({ type: 'brush', points: e.pts.map((p: number[]) => [p[0] + o.x - x0, p[1] + o.y - y0]), xywh: `[${x0},${y0},${Math.max(4, Math.max(...xs) - x0)},${Math.max(4, Math.max(...ys) - y0)}]`, color: '#1e1e1e', lineWidth: 4 }); }
      else if (e.kind === 'loop' || e.kind === 'circle') { const n = 40, pts: number[][] = []; for (let k = 0; k <= n; k++) { const a = (k / n) * Math.PI * 2; pts.push([e.w / 2 + Math.cos(a) * (e.w / 2) * (1 + 0.03 * Math.sin(k)), e.h / 2 + (Math.sin(a) * e.h) / 2]); }
        id = surf.addElement({ type: 'brush', points: pts, xywh: `[${X},${Yy},${e.w},${e.h}]`, color: '#1e1e1e', lineWidth: 4 }); }
      if (!id) continue;
      ids[e.id] = id; made.push(id);
      if (e.ai) store.spaceDoc.getMap('cx:author').set(id, 'ai');
    }
    return made;
  }

  const inZone = (zoneX: number) => (gfx.gfxElements as any[]).filter(e => e.flavour !== 'affine:surface' && e.elementBound.x >= zoneX - 800);
  function clear(zoneX: number) {
    store.captureSync();
    for (const e of inZone(zoneX)) { try { if (e.flavour) store.deleteBlock(store.getBlock(e.id)!.model); else surf.deleteElement(e.id); } catch { /* gone with its parent */ } }
    store.captureSync();
  }
  const boundsOf = (zoneX: number): Box | null => { const bs = inZone(zoneX).map(e => e.elementBound); if (!bs.length) return null; let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9; for (const b of bs) { x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.w); y1 = Math.max(y1, b.y + b.h); } return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }; };
  async function shot(zoneX: number): Promise<string | null> {
    const b = boundsOf(zoneX); if (!b) return null;
    const png = await snapshot(rootEl, b, 900, 24).catch(() => null); if (!png) return null;
    const bmp = await createImageBitmap(png); const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height; const g = c.getContext('2d')!; g.fillStyle = '#f4f4f4'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0);
    return c.toDataURL('image/jpeg', 0.55);
  }
  const slim = (a: any) => (a ? {
    built: a.noticed ?? a.built, lacks: a.lacks, move: a.move, function: a.function, strength: a.strength, read: a.read,
    could_be: (a.functions ?? a.could_be ?? []).map((f: any) => f?.wants ?? f?.name).filter(Boolean).slice(0, 4),
    cards: (a.cards ?? []).map((c: any) => ({ at: c.at ?? null, slot: c.slot ?? null, parent: c.parent ?? null, text: c.text, source: c.source ?? null })),
    fork: (a.fork ?? []).map((f: any) => ({ read: f.read, cards: (f.cards ?? []).map((c: any) => c.text) })),
    links: a.links ?? [], arrow_labels: a.arrow_labels ?? [], ask: a.ask ?? null, insight: a.insight ?? null,
    actions: (a.actions ?? []).map((x: any) => ({ do: x.do, title: x.title ?? x.text ?? null })),
  } : null);

  async function scene(sc: any, zone: { x: number; y: number }): Promise<any> {
    const ids: Record<string, string> = {}, t0 = Date.now(), I = W.cxIntent, rec: any = { id: sc.id, title: sc.title, expect: sc.expect, at: new Date().toISOString() };
    try {
      await build(sc.context ?? [], ids, zone); await frames(); await sleep(350);
      const b0 = boundsOf(zone.x); if (b0) gfx.viewport.setViewportByBound({ x: b0.x - 200, y: b0.y - 200, w: b0.w + 900, h: b0.h + 500 }, [40, 40, 40, 40], false);
      await sleep(500); I.forget();
      const touched = new Set<string>(); let typed: { request: string; ids: string[] } | null = null;
      for (const st of sc.steps ?? []) {
        if (st.add) (await build([st.add], ids, zone)).forEach(id => touched.add(id));
        else if (st.text) { const el: any = gfx.getElementById(ids[st.text[0]]); el?.text?.insert(0, st.text[1]); touched.add(ids[st.text[0]]); }
        else if (st.move) { const el: any = gfx.getElementById(ids[st.move[0]]); if (el) { surf.updateElement(el.id, { xywh: `[${st.move[1] + zone.x},${st.move[2] + zone.y},${el.w},${el.h}]` }); touched.add(el.id); } }
        else if (st.ask) typed = { request: st.ask, ids: (st.select ?? []).map((k: string) => ids[k]).filter(Boolean) };
        await sleep(260); I.trace.poll();
      }
      await frames(); await sleep(500); I.trace.poll();
      if (typed) {
        rec.gate = 'typed'; rec.request = typed.request;
        if (typed.ids.length) gfx.selection.set({ elements: typed.ids, editing: false });
        const l0 = W.cxLog?.[0];
        await assistant(typed.request, typed.ids);
        const l = W.cxLog?.[0]; if (l && l !== l0) { rec.look = l.look; rec.context = String(l.context ?? '').slice(0, 1500); rec.error = l.error; const a = typeof l.raw === 'string' ? (() => { try { return JSON.parse(l.raw.slice(l.raw.indexOf('{'), l.raw.lastIndexOf('}') + 1)); } catch { return null; } })() : l.raw;
          rec.answer = a ? { read: a.read, say: a.say, remember: a.remember, actions: (a.actions ?? []).map((x: any) => ({ do: x.do, text: x.text ?? x.title ?? x.label ?? null, place: x.place ?? null })) } : null; rec.result = l.result ? { created: l.result.created?.length, changed: l.result.changed?.length, errors: l.result.errors } : null; }
        gfx.selection.clear?.();
      } else {
        const r = readBoard(gfx); const intent = I.detect(r, touched);
        if (!intent) { rec.gate = 'quiet'; rec.note = 'code found nothing to ask about'; }
        else {
          rec.gate = 'asked';
          const l0 = I.last;
          const set = await I.run(intent, () => {});
          const l = I.last !== l0 ? I.last : null;
          if (l) { rec.openings = l.openings; rec.arranged = l.arranged; rec.features = l.features; rec.look = l.look; rec.raw = slim(l.raw); rec.answer = slim(l.answer); rec.edits = l.edits; rec.result = l.result; rec.pictures = (l.pictures ?? []).length; }
          await sleep(1600); await frames();
          rec.picture = await shot(zone.x);
          try { set?.drop(true); } catch { /* already closed */ }
        }
      }
      if (!rec.picture) { await sleep(900); rec.picture = await shot(zone.x); }
    } catch (e: any) { rec.error = String(e?.code ?? '') + ' ' + String(e?.message ?? e); }
    rec.ms = Date.now() - t0;
    await sleep(200); clear(zone.x); await frames();
    return rec;
  }

  // a mark in the board itself, seen by every open copy: "checks are running, do not react to what appears"
  const flag = (on: boolean) => { try { const m = store.spaceDoc.getMap('cx:flags'); if (on) m.set('checking', Date.now()); else m.delete('checking'); } catch { /* older doc */ } };
  async function runAll(only?: string[]) {
    if (running) return; running = true; stop = false;
    const S = W.cxSense, I = W.cxIntent;
    const list = SCENES.filter(s => !only?.length || only.includes(s.id));
    const run = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    Object.assign(state, { run, done: 0, total: list.length, now: '', note: '', results: [] }); paint();
    const cl = W.claude; let db: any = null; try { db = cl?.use ? await cl.use('db') : null; } catch { db = null; }
    const put = async (path: string, data: any) => { if (!db) return; try { await db.doc(path).set(data); } catch (e) { state.note = 'could not save: ' + String((e as any)?.message ?? e).slice(0, 60); } };
    // a clear place far to the right of everything on the board
    let right = 0, top = 0; for (const e of gfx.gfxElements as any[]) { if (e.flavour === 'affine:surface') continue; const b = e.elementBound; right = Math.max(right, b.x + b.w); top = Math.min(top, b.y); }
    const zone = { x: Math.ceil(right / 1000) * 1000 + 8000, y: top };
    const view0 = { ...gfx.viewport.viewportBounds }, zoom0 = gfx.viewport.zoom, cx0 = gfx.viewport.centerX, cy0 = gfx.viewport.centerY;
    // (the page's own tests may keep their stand-in answers to exercise the runner itself)
    const sense0 = S.enabled, mockI = W.cxMockIntent, mockA = W.cxMockAnswer; S.enabled = false; I.dry = true; if (!W.cxCheckKeepMocks) { W.cxMockIntent = undefined; W.cxMockAnswer = undefined; }
    await put(`runs/${run}`, { run, startedAt: new Date().toISOString(), total: list.length, done: 0, status: 'running', agent: navigator.userAgent.slice(0, 120) });
    W.cxCheckRunning = true;
    try {
      for (const sc of list) {
        if (stop) break;
        state.now = `${sc.id} · ${sc.title}`; paint();
        flag(true);                                // other open copies of this board stay out of it
        const rec = await scene(sc, zone);
        const { picture, ...rest } = rec;
        state.results.push(rest); state.done++; paint();
        await put(`runs/${run}/results/${sc.id}`, rest);
        if (picture) await put(`runs/${run}/pictures/${sc.id}`, { id: sc.id, jpeg: picture });
        await put(`runs/${run}`, { run, total: list.length, done: state.done, status: 'running', last: sc.id, updatedAt: new Date().toISOString() });
        // a rate limit or a refusal will not get better by hammering
        if (/rate_limited|not_granted|no_model/.test(rec.error ?? '')) { state.note = rec.error; break; }
        await sleep(700);
      }
    } finally {
      clear(zone.x); flag(false); W.cxCheckRunning = false;
      S.enabled = sense0; I.dry = false; W.cxMockIntent = mockI; W.cxMockAnswer = mockA; S.rebase?.(); I.forget();
      try { gfx.viewport.setViewport(zoom0, [cx0, cy0], false); } catch { try { gfx.viewport.setViewportByBound(view0, [0, 0, 0, 0], false); } catch { /* stay */ } }
      await put(`runs/${run}`, { run, total: list.length, done: state.done, status: stop ? 'stopped' : 'finished', finishedAt: new Date().toISOString(), saved: !!db });
      state.now = stop ? 'Stopped' : `Finished${db ? '' : ' (results not saved: no database here)'}`; running = false; paint();
    }
  }

  // ── a small panel ──
  const panel = document.createElement('div'); panel.className = 'cx-check'; panel.hidden = true;
  panel.innerHTML = `<div class="cx-check-h"><b>Checks with the real model</b><button data-x aria-label="Close">×</button></div><p class="cx-check-p"></p><div class="cx-check-bar"><i></i></div><p class="cx-check-n"></p><div class="cx-check-a"><button data-go class="go">Run all</button><button data-stop>Stop</button></div>`;
  document.body.append(panel);
  const $ = (s: string) => panel.querySelector(s) as HTMLElement;
  function paint() {
    $('.cx-check-p').textContent = running ? state.now : state.now || `${SCENES.length} small boards are built beside yours, read by Claude, recorded and removed. Your board is not touched.`;
    ($('.cx-check-bar i') as HTMLElement).style.width = state.total ? `${Math.round((state.done / state.total) * 100)}%` : '0%';
    const asked = state.results.filter(r => r.gate !== 'quiet').length, errs = state.results.filter(r => r.error).length;
    $('.cx-check-n').textContent = state.total ? `${state.done} / ${state.total}${state.done ? ` · ${asked} read by Claude${errs ? ` · ${errs} failed` : ''}` : ''}${state.note ? ` · ${state.note}` : ''}` : '';
    ($('[data-go]') as HTMLButtonElement).disabled = running; ($('[data-stop]') as HTMLButtonElement).disabled = !running;
  }
  $('[data-x]').onclick = () => { panel.hidden = true; };
  $('[data-go]').onclick = () => { void runAll(); };
  $('[data-stop]').onclick = () => { stop = true; state.now = 'Stopping after this board…'; paint(); };
  addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'k') { e.preventDefault(); panel.hidden = !panel.hidden; paint(); } }, true);
  // a tab used for checks does not also react to the user's own board
  new MutationObserver(() => { if (!panel.hidden) W.cxCheckOpen = true; }).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  W.cxCheck = { open: () => { panel.hidden = false; paint(); }, run: (only?: string[]) => runAll(only), stop: () => { stop = true; }, state, scenes: SCENES.map(s => s.id) };
  paint();
}
