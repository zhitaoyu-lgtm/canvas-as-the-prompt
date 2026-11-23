import { CARD_STYLE, FILL, HUES, INK, TEXT, stickyProps, type Hue } from './design';
// The toolbar: a small vertical bar at the middle of the left edge. Everyday tools are in the bar as gray line
// icons; the rest (doc note, image, table, mind map, templates) is behind "+".
// Each tool's options open as a narrow two-column panel beside the bar, never across the board.
// It drives AFFiNE's own tools, so drawing, zoom, snapping and undo stay the engine's.

import { addImages } from '@blocksuite/affine/blocks/image';
import { EdgelessCRUDIdentifier } from '@blocksuite/affine/blocks/surface';
import { mountShapeTextEditor } from '@blocksuite/affine/gfx/shape';
import { TableDataManager } from '@blocksuite/affine/blocks/table';
import { focusTextModel } from '@blocksuite/affine/rich-text';
import { EditPropsStore } from '@blocksuite/affine/shared/services';
import { GfxControllerIdentifier } from '@blocksuite/affine/std/gfx';

import { GLYPH, ICON } from './icons';
import { STAMPS } from './stickers';
import { isDark, setLook } from './theme';

declare const __BUILT__: string;
// which copy this is: the time it was built, the same in the web preview and the desktop app (UTC, like the app's update names)
const appVersion = (() => { const b = typeof __BUILT__ === 'string' ? __BUILT__ : ''; if (b.length < 12) return '';
  const d = new Date(Date.UTC(+b.slice(0, 4), +b.slice(4, 6) - 1, +b.slice(6, 8), +b.slice(8, 10), +b.slice(10, 12))), p = (n: number) => String(n).padStart(2, '0');
  return `build ${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}`; })();   // in the viewer's own time

// Palettes come from the shared design system, so hand-made and AI-made things share one hue set.
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const STICKY = HUES.map(h => [cap(h), FILL[h]] as const);
const MARKER = [['Black', TEXT.ink] as const, ...(['red', 'orange', 'yellow', 'green', 'blue', 'violet', 'white'] as Hue[]).map(h => [cap(h), INK[h]] as const)];
const HILITE = [
  ['Gray', '#b2b2b2'], ['Pink', '#ffa0f9'], ['Orange', '#ffb868'], ['Yellow', '#fff234'],
  ['Green', '#aeff61'], ['Teal', '#7efff7'], ['Violet', '#bc9bff'], ['White', '#ffffff'],
] as const;
// Stroke presets (FigJam-style): thin / medium / thick, in the engine's allowed widths.
const SIZES = { brush: [2, 4, 8], highlighter: [14, 22, 30] } as const;
const SIZE_NAMES = ['Thin', 'Medium', 'Thick'];

type El = HTMLElement;
function h(tag: string, attrs: Record<string, any> = {}, ...kids: (Node | string)[]): El {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'html') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : String(v));
  }
  e.append(...kids);
  return e;
}

export async function mountToolbar(rootEl: any) {
  const std = rootEl.std;
  const gfx = std.get(GfxControllerIdentifier);
  const crud = std.get(EdgelessCRUDIdentifier);
  const props = std.get(EditPropsStore);
  const setTool = (name: string, options?: any) => gfx.tool.setTool({ toolName: name } as any, options);

  // state the bar shows
  let mode = 'select';           // which slot is lit
  let tray: string | null = null; // which tray is open
  let sticky: string = STICKY[4][1];
  let ink: string = MARKER[0][1];
  let hilite: string = HILITE[3][1];
  const size = { brush: 1, highlighter: 1 };   // index into SIZES
  let stamp = STAMPS[0];
  let placing: null | 'sticky' | 'stamp' | 'table' | 'doc' = null;
  let penKind: 'brush' | 'highlighter' | 'eraser' = 'brush';
  let shape: { kind: 'shape' | 'connector' | 'mindmap'; name: string } = { kind: 'shape', name: 'rect' };
  let filled = false;

  // Black-and-white defaults: dark outlines, white or light-gray fills, dark connectors.
  const SHAPES = ['rect', 'ellipse', 'diamond', 'triangle', 'roundedRect'];
  const shapeDefaults = () => {
    for (const n of SHAPES) {
      try { props.recordLastProps(`shape:${n}` as any, { strokeColor: '#1e1e1e', strokeWidth: 2, fillColor: filled ? '#e6e6e6' : '#ffffff', filled, color: '#1e1e1e', shapeStyle: 'General' } as any); } catch (e) { console.warn(e); }
    }
  };
  shapeDefaults();
  try { props.recordLastProps('connector' as any, { stroke: '#1e1e1e', strokeWidth: 2 } as any); } catch {}
  try { props.recordLastProps('brush' as any, { color: ink, lineWidth: SIZES.brush[size.brush] } as any); } catch {}
  try { props.recordLastProps('highlighter' as any, { color: hilite, lineWidth: SIZES.highlighter[size.highlighter] } as any); } catch {}
  // Frames like FigJam sections: a white sheet on the gray board instead of transparent.
  try { props.recordLastProps('affine:frame' as any, { background: '#ffffff' } as any); } catch {}

  const wrap = h('div', { class: 'cx-dock' });
  const bar = h('div', { class: 'cx-bar', role: 'toolbar', 'aria-label': 'Tools' });
  // the panel beside the bar: a box (surface, shadow, the fades) around a list that scrolls when it is long
  // One column, as wide as the bar. A few things show; the rest is reached by rolling, and fades at both ends.
  const trayEl = h('div', { class: 'cx-tray' });
  const headEl = h('div', { class: 'cx-trayhead' });                 // what stays put above the list (pen: kind, width)
  const scrollEl = h('div', { class: 'cx-trayscroll' }, trayEl);
  const trayBox = h('div', { class: 'cx-traybox', hidden: true }, headEl, scrollEl);
  wrap.append(trayBox, bar);
  // no scrollbar and no position dots: a long list simply fades out where there is more to roll to
  const fades = () => {
    scrollEl.classList.toggle('more-up', trayEl.scrollTop > 2);
    scrollEl.classList.toggle('more-down', trayEl.scrollTop + trayEl.clientHeight < trayEl.scrollHeight - 2);
  };
  trayEl.addEventListener('scroll', fades, { passive: true });
  document.body.append(wrap);

  // The bar, top to bottom. '|' is a thin rule. What is not here lives behind "+".
  const LAYOUT: ([string, string, string] | '|')[] = [
    ['select', 'Select · V', ICON.cursor],
    ['hand', 'Hand · H', ICON.hand],
    '|',
    ['pen', 'Pen · P', ICON.pen],
    ['sticky', 'Sticky note · S', ICON.sticky],
    ['text', 'Text · T', ICON.text],
    ['shape', 'Shapes & connectors · O', ICON.shapes],
    ['frame', 'Section · F', ICON.section],
    ['stamp', 'Stamp', ICON.stamp],
    '|',
    ['more', 'More', ICON.plus],
  ];
  const slots: Record<string, El> = {};
  for (const it of LAYOUT) {
    if (it === '|') { bar.append(h('span', { class: 'cx-div' })); continue; }
    const [id, label, svg] = it;
    const b = h('button', { class: 'cx-s' + (id === 'more' ? ' cx-more' : ''), 'data-id': id, 'aria-label': label, html: svg, onclick: () => { if (!dragGuard) pick(id); } });
    slots[id] = b; bar.append(b);
  }

  // ── trays ────────────────────────────────────────────────────────────
  function openTray(id: string | null) {
    const fresh = id !== tray, keep = trayEl.scrollTop;   // picking something must not roll the list back
    tray = id; trayEl.textContent = ''; headEl.textContent = ''; trayEl.className = 'cx-tray';
    if (!id) { trayBox.hidden = true; paint(); return; }
    trayBox.hidden = false;
    const rule = () => h('span', { class: 'cx-tdiv' }, h('i'));
    if (id === 'sticky') {
      for (const [name, c] of STICKY) trayEl.append(swatch(name, c, c === sticky, () => { sticky = c; armSticky(); render(); }));
    } else if (id === 'pen') {
      // Kind and width are one cell each: a tap moves to the next (marker → highlighter → eraser; thin → medium → thick).
      // Colours are the list below them.
      const kinds: ['brush' | 'highlighter' | 'eraser', string, string][] = [['brush', 'Marker', GLYPH.marker], ['highlighter', 'Highlighter', GLYPH.highlighter], ['eraser', 'Eraser · E', GLYPH.eraser]];
      const ki = kinds.findIndex(k => k[0] === penKind), [, klabel, kglyph] = kinds[ki];
      const kind = penKind === 'highlighter' ? 'highlighter' : 'brush';
      const off = penKind === 'eraser';
      headEl.append(
        icon(`${klabel} · tap for the next`, kglyph, false, () => { penKind = kinds[(ki + 1) % kinds.length][0]; armPen(); render(); }, 'cx-ti cx-glyph'),
        icon(`${SIZE_NAMES[size[kind]]} stroke · tap for the next`, ICON.squiggle(size[kind]), false, () => { size[kind] = (size[kind] + 1) % SIZE_NAMES.length; armPen(); render(); }, 'cx-ti' + (off ? ' off' : '')),
        rule(),
      );
      const pal = kind === 'highlighter' ? HILITE : MARKER;
      const cur = kind === 'highlighter' ? hilite : ink;
      for (const [name, c] of pal) {
        const sw = swatch(name, c, !off && c === cur, () => { if (kind === 'highlighter') hilite = c; else ink = c; armPen(); render(); });
        if (off) sw.classList.add('off');
        trayEl.append(sw);
      }
    } else if (id === 'shape') {
      // the ones reached for most come first; outline / filled is a setting, at the end
      const T: ['shape' | 'connector', string, string, string][] = [
        ['shape', 'rect', 'Square', ICON.rect], ['shape', 'ellipse', 'Ellipse', ICON.ellipse], ['connector', 'arrow', 'Arrow', ICON.arrow],
        ['connector', 'elbow', 'Elbow connector', ICON.elbow], ['shape', 'diamond', 'Diamond', ICON.diamond],
        ['connector', 'line', 'Line', ICON.line], ['connector', 'curve', 'Curved connector', ICON.curve], ['shape', 'triangle', 'Triangle', ICON.triangle],
        ['shape', 'triangleDown', 'Triangle down', ICON.triangleDown], ['shape', 'roundedRect', 'Rounded', ICON.rounded],
      ];
      for (const [k, n, label, ic] of T) trayEl.append(icon(label, ic, shape.kind === k && shape.name === n, () => { shape = { kind: k, name: n }; armShape(); render(); }));
      trayEl.append(rule(), icon(filled ? 'Filled shapes' : 'Outline shapes', filled ? ICON.fillSolid : ICON.fill, false, () => { filled = !filled; armShape(); render(); }));
    } else if (id === 'stamp') {
      // FigJam-style stamps: pick one, then click the board to stamp it (stays armed until Esc).
      for (const st of STAMPS) trayEl.append(h('button', { class: 'cx-stamp' + (st === stamp ? ' on' : ''), 'aria-label': st.name, onclick: () => { stamp = st; placing = 'stamp'; setTool('default'); render(); } }, h('img', { src: st.url, alt: '' })));
    } else if (id === 'more') {
      // what is used less: the same single column of icons as every other panel
      const place = (what: 'doc' | 'table') => () => { openTray(null); mode = what === 'doc' ? 'doc' : 'select'; placing = what; setTool('default'); paint(); };
      trayEl.append(
        icon('Doc note', ICON.doc, mode === 'doc', place('doc')),
        icon('Image', ICON.image, false, () => { placing = null; openTray(null); pickImage(); }),
        icon('Table', ICON.table, false, place('table')),
        icon('Mind map', ICON.mindmap, false, () => insertMindmap()),
        icon('Templates', ICON.templates, mode === 'templates', () => { openTray(null); toggleTemplates(); paint(); }),
        rule(),
        icon(isDark() ? 'Light board' : 'Dark board', ICON.look, false, () => { setLook(isDark() ? 'light' : 'dark', rootEl); render(); }),   // a test switch
      );
      // which copy this is, small, at the foot of the panel
      if (appVersion) trayEl.append(h('div', { class: 'cx-ver' }, appVersion));
    }
    placeTray();
    if (fresh) {   // opened: bring what is chosen into view
      const on = trayEl.querySelector('.on, [aria-pressed="true"]') as El | null;
      trayEl.scrollTop = on ? Math.max(0, on.offsetTop - (trayEl.clientHeight - on.offsetHeight) / 2) : 0;
    } else trayEl.scrollTop = keep;
    fades();
    paint();
  }
  const render = () => openTray(tray);
  function swatch(name: string, c: string, on: boolean, f: () => void) {
    const ring = '<circle class="sel" cx="16" cy="16" r="14" stroke-width="2"/>';   // gray ring when selected (CSS)
    return h('button', { class: 'cx-sw', 'aria-label': name, 'aria-pressed': String(on), onclick: f,
      html: `<svg width="32" height="32" viewBox="0 0 32 32" fill="none">${ring}<circle cx="16" cy="16" r="11" fill="${c}"/><circle cx="16" cy="16" r="10.5" stroke="black" stroke-opacity="0.08"/></svg>` });
  }
  function icon(label: string, svg: string, on: boolean, f: () => void, cls = 'cx-ti') {
    return h('button', { class: cls + (on ? ' on' : ''), 'aria-label': label, 'aria-pressed': String(on), html: svg, onclick: f });
  }
  // The panel is centred on the bar (CSS). A list shows five things (three under the pen's two cells) and a sliver
  // of the next, so it is plain there is more; the rest is reached by rolling.
  const CELL = 38;
  function placeTray() {
    if (tray === 'more') { trayEl.style.maxHeight = ''; return; }   // a short fixed list: all of it shows
    const rows = tray === 'pen' ? 3 : 5, n = trayEl.children.length;
    trayEl.style.maxHeight = n > rows ? `${rows * CELL + 6 + 16}px` : '';
  }

  // ── tools ────────────────────────────────────────────────────────────
  function armPen() {
    placing = null;
    if (penKind === 'eraser') { setTool('eraser'); paint(); return; }
    const k = penKind;
    try { props.recordLastProps(k as any, { color: k === 'highlighter' ? hilite : ink, lineWidth: SIZES[k][size[k]] } as any); } catch {}
    setTool(k); paint();
  }
  function armShape() {
    placing = null;
    if (shape.kind === 'connector') {
      const mode = shape.name === 'elbow' ? 1 : shape.name === 'curve' ? 2 : 0;
      try { props.recordLastProps('connector' as any, { mode, frontEndpointStyle: 'None', rearEndpointStyle: shape.name === 'line' ? 'None' : 'Arrow' } as any); } catch {}
      setTool('connector', { mode });
    } else {
      shapeDefaults();
      setTool('shape', { shapeName: shape.name === 'triangleDown' ? 'triangle' : shape.name });
    }
  }
  function armSticky() { placing = 'sticky'; setTool('default'); }
  function pick(id: string) {
    closeTemplates();
    switch (id) {
      case 'select': placing = null; setTool('default'); mode = id; openTray(null); break;
      case 'hand': placing = null; setTool('pan', { panning: false }); mode = id; openTray(null); break;
      case 'text': placing = null; setTool('text'); mode = id; openTray(null); break;
      case 'frame': placing = null; setTool('frame'); mode = id; openTray(null); break;
      case 'pen': { const was = mode === id; mode = id; armPen(); openTray(was ? (tray === 'pen' ? null : 'pen') : null); break; }   // first press: the tool; again: its choices
      case 'sticky': { const was = mode === id; mode = id; armSticky(); openTray(was ? (tray === 'sticky' ? null : 'sticky') : null); break; }   // first press: the tool; again: its choices
      case 'shape': { const was = mode === id; mode = id; armShape(); openTray(was ? (tray === 'shape' ? null : 'shape') : null); break; }   // first press: the tool; again: its choices
      case 'more': openTray(tray === 'more' ? null : 'more'); break;
      case 'stamp': { const was = mode === id; mode = id; placing = 'stamp'; setTool('default'); openTray(was ? (tray === 'stamp' ? null : 'stamp') : null); break; }
    }
    paint();
  }

  // Click-to-place tools. Sticky and table place once; stamps stay armed until Esc or another tool.
  rootEl.addEventListener('pointerdown', (e: PointerEvent) => {
    if (!placing || e.button !== 0) return;
    if ((e.target as El).closest?.('.cx-dock, edgeless-templates-panel')) return;
    e.stopPropagation(); e.preventDefault();
    const r = rootEl.getBoundingClientRect();
    const [x, y] = gfx.viewport.toModelCoord(e.clientX - r.left, e.clientY - r.top);
    if (placing === 'sticky') {
      const id = makeSticky(x, y);
      done();
      setTimeout(() => { const el = gfx.getElementById(id); if (el) mountShapeTextEditor(el as any, rootEl); }, 30);
    } else if (placing === 'stamp') {
      placeStamp(x, y);
    } else if (placing === 'table') {
      placeTable(x, y); done();
    } else if (placing === 'doc') {
      placeDoc(x, y); done();
    }
  }, true);
  // ── Sticky drag-out ─────────────────────────────────────────────────
  // Press the sticky stack and pull: a note peels off, grows to its real size and follows the pointer
  // with a soft spring; let go on the board and it lands there, ready to type. Release over the bar to cancel.
  let dragGuard = false;
  slots.sticky.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return;
    const sx = e.clientX, sy = e.clientY;
    let started = false, ghost: El | null = null, raf = 0;
    let tx = sx, ty = sy, cx = sx, cy = sy, vx = 0, vy = 0;
    const hold = window.setTimeout(() => begin(), 260);   // long-press also starts a drag
    const size = () => 184 * gfx.viewport.zoom;
    function begin() {
      if (started) return; started = true; clearTimeout(hold);
      openTray(null); placing = null;
      const r = slots.sticky.getBoundingClientRect();
      cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      ghost = h('div', { class: 'cx-ghost' });
      ghost.style.background = sticky;
      document.body.append(ghost);
      ghost.getBoundingClientRect();           // start small at the stack…
      ghost.classList.add('lift');               // …then grow to the note's size on the board
      ghost.style.setProperty('--s', `${size()}px`);
      const tick = () => {                        // critically-damped spring toward the pointer
        const k = 0.22, d = 0.62;
        vx = (vx + (tx - cx) * k) * d; vy = (vy + (ty - cy) * k) * d;
        cx += vx; cy += vy;
        const tilt = Math.max(-8, Math.min(8, vx * 0.6));
        ghost!.style.transform = `translate(${cx}px, ${cy}px) translate(-50%, -50%) rotate(${tilt}deg)`;
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      slots.sticky.classList.add('pulling');
    }
    const move = (ev: PointerEvent) => {
      tx = ev.clientX; ty = ev.clientY;
      if (!started && Math.hypot(tx - sx, ty - sy) > 4) begin();
      if (ghost) ghost.classList.toggle('over-bar', !!(document.elementFromPoint(tx, ty) as El)?.closest?.('.cx-dock'));
    };
    const up = (ev: PointerEvent) => {
      clearTimeout(hold);
      removeEventListener('pointermove', move); removeEventListener('pointerup', up); removeEventListener('pointercancel', up);
      if (!started) return;                       // plain click: normal tray behaviour
      dragGuard = true; setTimeout(() => { dragGuard = false; }, 0);
      cancelAnimationFrame(raf); slots.sticky.classList.remove('pulling');
      const g = ghost!;
      const overBar = (document.elementFromPoint(ev.clientX, ev.clientY) as El)?.closest?.('.cx-dock');
      if (overBar || ev.type === 'pointercancel') {   // put it back
        const r = slots.sticky.getBoundingClientRect();
        g.classList.add('back');
        g.style.transform = `translate(${r.left + r.width / 2}px, ${r.top + r.height / 2}px) translate(-50%, -50%) scale(.2)`;
        setTimeout(() => g.remove(), 220);
        return;
      }
      const rr = rootEl.getBoundingClientRect();
      const [mx, my] = gfx.viewport.toModelCoord(ev.clientX - rr.left, ev.clientY - rr.top);
      g.classList.add('land');                     // settle flat, then hand over to the real note
      g.style.transform = `translate(${ev.clientX}px, ${ev.clientY}px) translate(-50%, -50%) rotate(0deg)`;
      setTimeout(() => {
        const id = makeSticky(mx, my);
        g.classList.add('gone'); setTimeout(() => g.remove(), 120);
        mode = 'select'; setTool('default'); paint();
        setTimeout(() => { const el = gfx.getElementById(id); if (el) mountShapeTextEditor(el as any, rootEl); }, 30);
      }, 140);
    };
    addEventListener('pointermove', move); addEventListener('pointerup', up); addEventListener('pointercancel', up);
  });
  function makeSticky(x: number, y: number) {
    return crud.addElement('shape', stickyProps(sticky, x - 92, y - 92) as any) as string;
  }

  function done() { placing = null; mode = 'select'; openTray(null); setTool('default'); paint(); }
  // other parts of the app (the filmed scenes) hand the pointer back to selecting through this
  addEventListener('cx-tool-select', () => done());

  function dataUrlFile(url: string, name: string) {
    const [head, b64] = url.split(',');
    const type = /data:([^;]+)/.exec(head)?.[1] ?? 'image/webp';
    const bin = atob(b64); const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new File([buf], name, { type });
  }
  async function placeStamp(x: number, y: number) {
    const file = stamp.url.startsWith('data:') ? dataUrlFile(stamp.url, `${stamp.name}.webp`)
      : new File([await (await fetch(stamp.url)).blob()], `${stamp.name}.webp`, { type: 'image/webp' });
    const ids = await addImages(std, [file], { point: [x, y], shouldTransformPoint: false, maxWidth: 64 });
    if (ids?.[0]) { gfx.selection.set({ elements: [] }); }
  }
  // Doc note: a white card for longer text (interview notes, transcripts, briefs), ready to type.
  function placeDoc(x: number, y: number) {
    const store = std.store;
    const w = 560;
    const noteId = store.addBlock('affine:note', {
      xywh: `[${x - w / 2},${y - 40},${w},80]`, background: '#ffffff', index: gfx.layer.generateIndex(true),
      edgeless: { style: CARD_STYLE },
    } as any, store.root!.id);
    const pid = store.addBlock('affine:paragraph', {}, noteId);
    setTool('default');
    requestAnimationFrame(() => {   // same sequence AFFiNE's own note tool uses
      gfx.selection.set({ elements: [noteId], editing: true });
      focusTextModel(std, pid);
    });
  }

  function placeTable(x: number, y: number) {
    const store = std.store;
    const noteId = store.addBlock('affine:note', { xywh: `[${x - 310},${y - 50},620,80]`, background: '#ffffff', index: gfx.layer.generateIndex(true) } as any, store.root!.id);
    const tableId = store.addBlock('affine:table', {}, noteId);
    const model: any = store.getBlock(tableId)?.model;
    if (model) { const dm = new TableDataManager(model); dm.addNRow(3); dm.addNColumn(3); }
    gfx.selection.set({ elements: [noteId] });
  }

  function insertMindmap() {
    openTray(null);
    const b = gfx.viewport.viewportBounds;
    const cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    const kid = (i: number) => ({ text: 'Idea', children: [], xywh: `[${cx + 80},${cy - 16 + (i - 1) * 56},120,32]` });
    const id = crud.addElement('mindmap', {
      style: 4, children: { text: 'Topic', children: [kid(0), kid(1), kid(2)], xywh: `[${cx - 200},${cy - 22},140,44]` },
    }) as string;
    gfx.selection.set({ elements: [id] });
    mode = 'select'; setTool('default'); paint();
  }

  function pickImage() {
    openTray(null);
    const input = h('input', { type: 'file', accept: 'image/*', multiple: true, style: 'display:none' }) as HTMLInputElement;
    input.addEventListener('change', async () => {
      const files = [...(input.files ?? [])]; input.remove();
      if (!files.length) return;
      const b = gfx.viewport.viewportBounds;
      await addImages(std, files, { point: [b.x + b.w / 2, b.y + b.h / 2], shouldTransformPoint: false, maxWidth: 640 });
    });
    document.body.append(input); input.click();
  }

  // Templates: AFFiNE's own template library, opened beside the bar.
  let panel: any = null;
  function closeTemplates() { if (panel) { panel.remove(); panel = null; if (mode === 'templates') { mode = 'select'; setTool('default'); } } }
  function toggleTemplates() {
    if (panel) { closeTemplates(); paint(); return; }
    mode = 'templates';
    try { setTool('template'); } catch {}
    panel = document.createElement('edgeless-templates-panel');
    panel.edgeless = rootEl;
    panel.classList.add('cx-tpl-panel');
    panel.addEventListener('closepanel', () => { closeTemplates(); paint(); });
    document.body.append(panel);
    requestAnimationFrame(() => {
      const b = bar.getBoundingClientRect();
      const w = panel.offsetWidth || 467, hgt = panel.offsetHeight || 568;
      panel.style.position = 'fixed';
      panel.style.left = `${Math.min(b.right + 12, innerWidth - w - 12)}px`;
      panel.style.top = `${Math.max(12, Math.min(b.top + b.height / 2 - hgt / 2, innerHeight - hgt - 12))}px`;
      const arrow = panel.renderRoot?.querySelector('.arrow'); if (arrow) arrow.style.display = 'none';
    });
  }

  // Close trays on Escape; keep the bar in sync with keyboard shortcuts (V, H, P, T, F, E…).
  addEventListener('keydown', e => { if (e.key === 'Escape') { openTray(null); closeTemplates(); if (placing) { mode = 'select'; setTool('default'); } placing = null; paint(); } });
  addEventListener('resize', () => { if (tray) { placeTray(); fades(); } });
  gfx.tool.currentToolName$.subscribe((name: string) => {
    const map: Record<string, string> = { default: placing === 'doc' ? 'doc' : 'select', pan: 'hand', brush: 'pen', highlighter: 'pen', eraser: 'pen', text: 'text', frame: 'frame', shape: 'shape', connector: 'shape', template: 'templates' };
    if (placing && name === 'default') return;
    if (placing && name !== 'default') placing = null;
    const next = map[name];
    if (next && next !== mode) {
      mode = next;
      if (tray && tray !== 'more' && tray !== next) openTray(null);
      if (next !== 'templates') closeTemplates();
    }
    if (name === 'eraser') penKind = 'eraser';
    if (name === 'highlighter') penKind = 'highlighter';
    paint();
  });

  // Triangle-down: draw a triangle and flip it.
  gfx.surface?.elementAdded?.subscribe?.(({ id }: any) => {
    if (shape.kind === 'shape' && shape.name === 'triangleDown' && gfx.tool.currentToolName$.peek() === 'shape') {
      const el: any = gfx.getElementById(id);
      if (el?.type === 'shape' && el.shapeType === 'triangle') crud.updateElement(id, { rotate: 180 });
    }
  });

  function paint() {
    for (const [id, b] of Object.entries(slots)) {
      // what lives behind "+" lights the "+" while it is the tool in hand
      const on = id === mode || (id === 'more' && (tray === 'more' || mode === 'doc' || mode === 'templates'));
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    bar.classList.toggle('tray-open', !!tray);
  }
  paint();
}
