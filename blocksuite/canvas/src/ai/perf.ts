// How smooth is the hand? A quiet probe: while the pointer is down on the board (a pen stroke, a drag) it times
// every frame, and on release keeps a one-line summary with what the canvas was doing: how much was redrawn,
// how big the canvases are, how many things are on the board. No content is recorded, only timings and counts.
// The last strokes are kept in cxPerf.log and, when the artifact has a database, saved to perf/<session> so a
// slow machine can be understood from its own numbers instead of from a guess.

export function mountPerf(rootEl: any) {
  const gfx = rootEl.gfx, W = window as any;
  const log: any[] = []; W.cxPerf = { log, last: null as any };
  const session = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  let down = false, t0 = 0, last = 0, frames: number[] = [], raf = 0, moves = 0, before: any = null, saveAt = 0;
  const renderer = () => (document.querySelector('affine-surface') as any)?.renderer ?? rootEl.surface?.renderer;
  const counts = () => { const r = renderer(); const m = r?.getDebugMetrics?.(); return { renders: m?.renderCount ?? 0, ms: m?.totalRenderDurationMs ?? 0, partial: r?.partialRenders ?? 0, full: r?.fullRenders ?? 0 }; };
  const tick = (t: number) => { if (!down) return; frames.push(t - last); last = t; raf = requestAnimationFrame(tick); };
  addEventListener('pointerdown', e => {
    if (e.button !== 0 || !e.composedPath().includes(rootEl)) return;
    down = true; t0 = performance.now(); last = t0; frames = []; moves = 0; before = counts(); raf = requestAnimationFrame(tick);
  }, true);
  addEventListener('pointermove', () => { if (down) moves++; }, { capture: true, passive: true });
  const end = () => {
    if (!down) return; down = false; cancelAnimationFrame(raf);
    const dur = performance.now() - t0; if (dur < 350 || frames.length < 8) return;
    const f = frames.slice(1).sort((a, b) => a - b), n = f.length, after = counts(), r = renderer(), m = r?.getDebugMetrics?.();
    const els = gfx.gfxElements as any[]; const kinds: Record<string, number> = {}; for (const e of els) { const k = e.flavour ?? e.type ?? '?'; kinds[k] = (kinds[k] ?? 0) + 1; }
    const renders = after.renders - before.renders;
    const rec = {
      at: new Date().toISOString(), tool: gfx.tool?.currentToolName$?.peek?.() ?? '?', ms: Math.round(dur), moves,
      frames: n, fps: Math.round((n / dur) * 1000), frameMedian: +f[n >> 1].toFixed(1), frameP95: +f[Math.floor(n * 0.95)].toFixed(1), frameMax: +f[n - 1].toFixed(1), over33: f.filter(x => x > 33).length, over100: f.filter(x => x > 100).length,
      renders, renderMsEach: renders ? +((after.ms - before.ms) / renders).toFixed(2) : 0, partial: after.partial - before.partial, full: after.full - before.full,
      drawnLast: m?.lastRenderMetrics?.renderedElementCount ?? null, canvasMP: m ? +(m.canvasPixelCount / 1e6).toFixed(1) : null, canvasMB: m?.canvasMemoryMegabytes ? +m.canvasMemoryMegabytes.toFixed(0) : null, layers: m?.totalLayerCount ?? null, stacking: m?.stackingCanvasCount ?? null,
      zoom: +gfx.viewport.zoom.toFixed(2), dpr: devicePixelRatio, view: `${innerWidth}×${innerHeight}`, things: els.length, kinds,
    };
    log.unshift(rec); log.length = Math.min(log.length, 20); W.cxPerf.last = rec;
    if (Date.now() - saveAt > 15_000) { saveAt = Date.now(); void save(); }
  };
  addEventListener('pointerup', end, true); addEventListener('pointercancel', end, true);
  async function save() {
    try { const db = W.claude?.use ? await W.claude.use('db') : null; if (!db) return;
      await db.doc(`perf/${session}`).set({ session, updatedAt: new Date().toISOString(), cores: navigator.hardwareConcurrency ?? null, memoryGB: (navigator as any).deviceMemory ?? null, agent: navigator.userAgent.slice(0, 160), strokes: log.slice(0, 12) });
    } catch { /* no database here: the log stays in the page */ }
  }
}
