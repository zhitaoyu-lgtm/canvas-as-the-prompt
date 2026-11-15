// Bottom toolbar, built from the Figma "FigJam · Home (empty board)" toolbar (google-2026, node 2052:2316)
// and its trays ("Tool tray / Sticky", "Tool tray / Shape"). It drives AFFiNE's own tools, so drawing,
// zoom, snapping and undo stay the engine's.

import { addImages } from '@blocksuite/affine/blocks/image';
import { EdgelessCRUDIdentifier } from '@blocksuite/affine/blocks/surface';
import { mountShapeTextEditor } from '@blocksuite/affine/gfx/shape';
import { TableDataManager } from '@blocksuite/affine/blocks/table';
import { EditPropsStore } from '@blocksuite/affine/shared/services';
import { GfxControllerIdentifier } from '@blocksuite/affine/std/gfx';

import { GLYPH, ICON, PEN_3D, STICKY_3D } from './icons';
import { STAMPS } from './stickers';

const STICKY = [
  ['White', '#ffffff'], ['Gray', '#e6e6e6'], ['Red', '#ffafa3'], ['Orange', '#ffd3a8'], ['Yellow', '#ffe299'],
  ['Green', '#b3efbd'], ['Teal', '#b3f4ef'], ['Blue', '#a8daff'], ['Violet', '#d3bdff'], ['Pink', '#ffa8db'],
] as const;
const MARKER = [
  ['Black', '#1e1e1e'], ['Red', '#f24822'], ['Orange', '#ff9e42'], ['Yellow', '#ffc943'],
  ['Green', '#66d575'], ['Blue', '#3dadff'], ['Violet', '#874fff'], ['White', '#ffffff'],
] as const;
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
  let placing: null | 'sticky' | 'stamp' | 'table' = null;
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
  const trayEl = h('div', { class: 'cx-tray', hidden: true });
  wrap.append(trayEl, bar);
  document.body.append(wrap);

  // Exact geometry of the Figma toolbar (node 2052:2316, 664 × 55). Every slot is placed where Figma has it.
  // [id, label, x, y, w, h, kind]; kind: flat icon (24px), dim (dimensional art), more (round + button)
  const LAYOUT: [string, string, number, number, number, number, 'flat' | 'dim' | 'more', string][] = [
    ['select', 'Select · V', 15, 15, 24, 24, 'flat', ICON.cursor],
    ['hand', 'Hand · H', 59, 15, 24, 24, 'flat', ICON.hand],
    ['pen', 'Pen · P', 117.5, 7.5, 39, 48, 'dim', PEN_3D],
    ['sticky', 'Sticky note · S', 170.63, 5.7, 75, 50, 'dim', STICKY_3D],
    ['text', 'Text · T', 275, 15.5, 24, 24, 'flat', ICON.text],
    ['shape', 'Shapes & connectors · O', 320.8, 15.5, 24, 24, 'flat', ICON.shapes],
    ['frame', 'Frame · F', 366.6, 15.5, 24, 24, 'flat', ICON.section],
    ['table', 'Table', 412.4, 15.5, 24, 24, 'flat', ICON.table],
    ['stamp', 'Stamp', 458.2, 15.5, 24, 24, 'flat', ICON.stamp],
    ['image', 'Image', 504, 15.5, 24, 24, 'flat', ICON.image],
    ['templates', 'Templates & stickers', 549.8, 15.5, 24, 24, 'flat', ICON.templates],
    ['more', 'More', 592.8, 13.5, 28, 28, 'more', ICON.plus],
  ];
  const BAR_W = 637;
  const DIM_BG: Record<string, [number, number]> = { pen: [108, 58], sticky: [168, 78] };
  const slots: Record<string, El> = {};
  for (const [id, label, x, y, w, hh, kind, svg] of LAYOUT) {
    if (kind === 'dim') {
      const [bx, bw] = DIM_BG[id];
      bar.append(h('span', { class: 'cx-dimbg', 'data-for': id, style: `left:${bx}px;width:${bw}px` }));
    }
    const b = h('button', {
      class: `cx-s cx-${kind}`, 'data-id': id, 'aria-label': label, 'data-tip': label,
      style: kind === 'flat' ? `left:${x - 6}px;top:${y - 6}px` : `left:${x}px;top:${y}px;width:${w}px;height:${hh}px`,
      html: kind === 'more' ? `<span>${svg}</span>` : svg,
      onclick: () => pick(id),
    });
    slots[id] = b; bar.append(b);
  }
  bar.append(h('span', { class: 'cx-div', style: 'left:100px' }), h('span', { class: 'cx-div', style: 'left:253px' }));
  wrap.style.width = `${BAR_W}px`;

  // Tooltip (Figma "Tooltip": dark, 9px above the hovered tool). Drawn outside the bar, which clips.
  const tipEl = h('div', { class: 'cx-tip', hidden: true });
  wrap.append(tipEl);
  let noteT = 0;
  function showTip(target: El, text: string) {
    tipEl.textContent = text; tipEl.hidden = false;
    const d = wrap.getBoundingClientRect(), r = target.getBoundingClientRect();
    const top = target.closest('.cx-tray') ? r.top : d.top;
    tipEl.style.left = `${r.left + r.width / 2 - d.left - tipEl.offsetWidth / 2}px`;
    tipEl.style.top = `${top - d.top - tipEl.offsetHeight - 9}px`;
  }
  wrap.addEventListener('pointerover', e => {
    const t = (e.target as El).closest?.('[data-tip]') as El | null;
    if (t && !(tray && t.closest('.cx-bar'))) showTip(t, t.dataset.tip!);
  });
  wrap.addEventListener('pointerdown', () => { if (!noteT) tipEl.hidden = true; }, true);
  wrap.addEventListener('pointerout', e => { if (!(e.relatedTarget as El)?.closest?.('[data-tip]')) tipEl.hidden = true; });

  // ── trays ────────────────────────────────────────────────────────────
  function openTray(id: string | null) {
    tray = id; trayEl.textContent = ''; trayEl.className = 'cx-tray';
    if (!id) { trayEl.hidden = true; paint(); return; }
    trayEl.hidden = false;
    if (id === 'sticky') {
      trayEl.classList.add('cx-tray-sticky');
      for (const [name, c] of STICKY) trayEl.append(swatch(name, c, c === sticky, () => { sticky = c; armSticky(); render(); }));
    } else if (id === 'pen') {
      // Figma kit "Tool tray / Marker": sub-tools | stroke presets | colours
      trayEl.classList.add('cx-tray-shape');
      const kinds: ['brush' | 'highlighter' | 'eraser', string, string][] = [['brush', 'Marker', GLYPH.marker], ['highlighter', 'Highlighter', GLYPH.highlighter], ['eraser', 'Eraser · E', GLYPH.eraser]];
      for (const [k, label, g] of kinds) trayEl.append(icon(label, g, penKind === k, () => { penKind = k; armPen(); render(); }, 'cx-ti cx-glyph'));
      trayEl.append(h('span', { class: 'cx-tdiv' }, h('i')));
      const kind = penKind === 'highlighter' ? 'highlighter' : 'brush';
      const off = penKind === 'eraser';
      SIZE_NAMES.forEach((n, i) => trayEl.append(icon(`${n} stroke`, ICON.squiggle(i), !off && size[kind] === i, () => { size[kind] = i; armPen(); render(); }, 'cx-ti' + (off ? ' off' : ''))));
      trayEl.append(h('span', { class: 'cx-tdiv' }, h('i')));
      const pal = kind === 'highlighter' ? HILITE : MARKER;
      const cur = kind === 'highlighter' ? hilite : ink;
      for (const [name, c] of pal) {
        const sw = swatch(name, c, !off && c === cur, () => { if (kind === 'highlighter') hilite = c; else ink = c; armPen(); render(); });
        if (off) sw.classList.add('off');
        trayEl.append(sw);
      }
    } else if (id === 'shape') {
      trayEl.classList.add('cx-tray-shape');
      trayEl.append(h('button', { class: 'cx-fillbtn', 'aria-label': filled ? 'Filled shapes' : 'Outline shapes', 'data-tip': filled ? 'Filled' : 'Outline', html: (filled ? ICON.fillSolid : ICON.fill) + ICON.chevron,
        onclick: () => { filled = !filled; armShape(); render(); } }), h('span', { class: 'cx-tdiv' }, h('i')));
      const C: [string, string, string][] = [['elbow', 'Elbow connector', ICON.elbow], ['curve', 'Curved connector', ICON.curve], ['arrow', 'Arrow', ICON.arrow], ['line', 'Line', ICON.line]];
      for (const [n, label, ic] of C) trayEl.append(icon(label, ic, shape.kind === 'connector' && shape.name === n, () => { shape = { kind: 'connector', name: n }; armShape(); render(); }));
      const S: [string, string, string][] = [['rect', 'Square', ICON.rect], ['ellipse', 'Ellipse', ICON.ellipse], ['diamond', 'Diamond', ICON.diamond], ['triangle', 'Triangle', ICON.triangle], ['triangleDown', 'Triangle down', ICON.triangleDown], ['roundedRect', 'Rounded', ICON.rounded]];
      for (const [n, label, ic] of S) trayEl.append(icon(label, ic, shape.kind === 'shape' && shape.name === n, () => { shape = { kind: 'shape', name: n }; armShape(); render(); }));
      trayEl.append(icon('Mind map', ICON.mindmap, false, () => { insertMindmap(); }));
    } else if (id === 'stamp') {
      // FigJam-style stamps: pick one, then click the board to stamp it (stays armed until Esc).
      trayEl.classList.add('cx-tray-stamp');
      for (const st of STAMPS) trayEl.append(h('button', { class: 'cx-stamp' + (st === stamp ? ' on' : ''), 'aria-label': st.name, 'data-tip': st.name, onclick: () => { stamp = st; placing = 'stamp'; setTool('default'); render(); } }, h('img', { src: st.url, alt: '' })));
    } else if (id === 'more') {
      trayEl.classList.add('cx-tray-shape');
      trayEl.append(
        icon('Mind map', ICON.mindmap, false, () => insertMindmap()),
        h('span', { class: 'cx-tdiv' }, h('i')),
        icon('Zoom out · Ctrl −', ICON.minus, false, () => zoomBy(1 / 1.25)),
        icon('Zoom in · Ctrl +', ICON.plusThin, false, () => zoomBy(1.25)),
        icon('Fit to screen · Shift 1', ICON.fit, false, () => { try { rootEl.service?.setZoomByAction?.('fit'); } catch {} openTray(null); }),
      );
    }
    placeTray();
    paint();
  }
  const render = () => openTray(tray);
  function swatch(name: string, c: string, on: boolean, f: () => void) {
    const ring = on ? '<circle cx="16" cy="16" r="14" stroke="#9747FF" stroke-width="2"/>' : '';
    return h('button', { class: 'cx-sw', 'aria-label': name, 'aria-pressed': String(on), 'data-tip': name, onclick: f,
      html: `<svg width="32" height="32" viewBox="0 0 32 32" fill="none">${ring}<circle cx="16" cy="16" r="11" fill="${c}"/><circle cx="16" cy="16" r="10.5" stroke="black" stroke-opacity="0.08"/></svg>` });
  }
  function icon(label: string, svg: string, on: boolean, f: () => void, cls = 'cx-ti') {
    return h('button', { class: cls + (on ? ' on' : ''), 'aria-label': label, 'aria-pressed': String(on), 'data-tip': label, html: svg, onclick: f });
  }
  function zoomBy(k: number) {
    const vp = gfx.viewport; const c = vp.center;
    vp.setZoom(Math.max(0.1, Math.min(6, vp.zoom * k)), { x: c.x, y: c.y } as any, true);
  }
  function placeTray() {
    const w = trayEl.offsetWidth;
    trayEl.style.left = `${(bar.offsetWidth - w) / 2}px`;
    trayEl.style.bottom = `${55 + (tray === 'sticky' ? 13 : 10)}px`;
    // keep inside the window
    const r = wrap.getBoundingClientRect(); let x = (bar.offsetWidth - w) / 2;
    x = Math.max(12 - r.left, Math.min(x, innerWidth - 12 - r.left - w));
    trayEl.style.left = `${x}px`;
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
    if (id !== 'templates') closeTemplates();
    switch (id) {
      case 'select': placing = null; setTool('default'); mode = id; openTray(null); break;
      case 'hand': placing = null; setTool('pan', { panning: false }); mode = id; openTray(null); break;
      case 'text': placing = null; setTool('text'); mode = id; openTray(null); break;
      case 'frame': placing = null; setTool('frame'); mode = id; openTray(null); break;
      case 'pen': mode = id; armPen(); openTray(tray === 'pen' ? null : 'pen'); break;
      case 'sticky': mode = id; armSticky(); openTray(tray === 'sticky' ? null : 'sticky'); break;
      case 'shape': mode = id; armShape(); openTray(tray === 'shape' ? null : 'shape'); break;
      case 'more': openTray(tray === 'more' ? null : 'more'); break;
      case 'templates': openTray(null); toggleTemplates(); break;
      case 'table': mode = id; placing = 'table'; setTool('default'); openTray(null); break;
      case 'stamp': mode = id; placing = 'stamp'; setTool('default'); openTray(tray === 'stamp' ? null : 'stamp'); break;
      case 'image': placing = null; openTray(null); pickImage(); break;
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
      const id = crud.addElement('shape', {
        shapeType: 'rect', xywh: `[${x - 92},${y - 92},184,184]`, radius: 0.04, filled: true, fillColor: sticky,
        strokeColor: 'transparent', strokeWidth: 0, color: '#1e1e1e', fontSize: 16, fontFamily: 'blocksuite:surface:Inter',
        textAlign: 'left', textHorizontalAlign: 'left', textVerticalAlign: 'top', padding: [16, 16],
        shadow: { blur: 8, offsetX: 0, offsetY: 3, color: 'rgba(0,0,0,0.10)' },
      }) as string;
      done();
      setTimeout(() => { const el = gfx.getElementById(id); if (el) mountShapeTextEditor(el as any, rootEl); }, 30);
    } else if (placing === 'stamp') {
      placeStamp(x, y);
    } else if (placing === 'table') {
      placeTable(x, y); done();
    }
  }, true);
  function done() { placing = null; mode = 'select'; openTray(null); setTool('default'); paint(); }

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

  // Templates: AFFiNE's own template library, opened above the bar.
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
      const a = slots.templates.getBoundingClientRect();
      const w = panel.offsetWidth || 467, hgt = panel.offsetHeight || 568;
      panel.style.position = 'fixed';
      panel.style.left = `${Math.max(12, Math.min(a.left + a.width / 2 - w / 2, innerWidth - w - 12))}px`;
      panel.style.top = `${Math.max(12, bar.getBoundingClientRect().top - hgt - 12)}px`;
      const arrow = panel.renderRoot?.querySelector('.arrow'); if (arrow) arrow.style.display = 'none';
    });
  }

  // Close trays on Escape; keep the bar in sync with keyboard shortcuts (V, H, P, T, F, E…).
  addEventListener('keydown', e => { if (e.key === 'Escape') { openTray(null); closeTemplates(); placing = null; paint(); } });
  addEventListener('resize', () => tray && placeTray());
  gfx.tool.currentToolName$.subscribe((name: string) => {
    const map: Record<string, string> = { default: 'select', pan: 'hand', brush: 'pen', highlighter: 'pen', eraser: 'pen', text: 'text', frame: 'frame', shape: 'shape', connector: 'shape', template: 'templates' };
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
      const on = id === mode || (id === 'more' && tray === 'more');
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', String(on));
    }
    bar.classList.toggle('tray-open', !!tray);
    bar.querySelectorAll<HTMLElement>('.cx-dimbg').forEach(e => e.classList.toggle('on', e.dataset.for === mode));
    const tip = slots.pen.querySelector('.tip') as SVGPathElement | null;
    if (tip) tip.setAttribute('fill', penKind === 'eraser' ? '#c9c9c9' : ink);
  }
  paint();
}
