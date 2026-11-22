// How long each press takes to show on screen, split into its parts, for finding what makes the board feel slow
// on a given computer. Ctrl+Shift+L shows the slowest recent presses in a small box (and again hides it).
//   wait: the page was busy when the press came · work: the board's own handling · draw: until the screen showed it

type Row = { t: number; what: string; wait: number; work: number; draw: number; total: number };

export function mountLatency() {
  const rows: Row[] = [];
  try {
    new PerformanceObserver(list => {
      for (const e of list.getEntries() as any[]) {
        if (!/pointer|click|key/.test(e.name) || e.duration < 50) continue;
        const end = e.startTime + e.duration;
        rows.push({ t: Math.round(e.startTime), what: e.name, wait: Math.round(e.processingStart - e.startTime), work: Math.round(e.processingEnd - e.processingStart), draw: Math.round(end - e.processingEnd), total: Math.round(e.duration) });
        if (rows.length > 60) rows.shift();
      }
    }).observe({ type: 'event', durationThreshold: 48, buffered: true } as any);
  } catch { /* this browser does not say */ }
  let box: HTMLDivElement | null = null;
  const show = () => {
    if (box) { box.remove(); box = null; return; }
    box = document.createElement('div');
    box.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:99999;background:rgba(28,28,30,.92);color:#f2f2f7;font:11px/1.5 ui-monospace,Menlo,Consolas,monospace;padding:10px 12px;border-radius:10px;max-height:60vh;overflow:auto;white-space:pre;pointer-events:auto';
    const top = [...rows].sort((a, b) => b.total - a.total).slice(0, 14);
    box.textContent = top.length ? 'slowest presses (ms)   wait  work  draw  total\n' + top.map(r => `${r.what.padEnd(22)} ${String(r.wait).padStart(5)} ${String(r.work).padStart(5)} ${String(r.draw).padStart(5)} ${String(r.total).padStart(6)}`).join('\n') : 'no slow presses yet';
    document.body.append(box);
  };
  addEventListener('keydown', e => { if (e.ctrlKey && e.shiftKey && (e.key === 'L' || e.key === 'l')) { e.preventDefault(); show(); } }, true);
}
