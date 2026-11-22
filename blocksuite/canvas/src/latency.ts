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
  // what the page was busy with: the longest frames of late, with the code that ran in them
  const frames: string[] = [];
  try {
    new PerformanceObserver(list => {
      for (const f of list.getEntries() as any[]) {
        if (f.duration < 200) continue;
        const sc = [...(f.scripts ?? [])].sort((a: any, b: any) => b.duration - a.duration).slice(0, 3)
          .map((x: any) => `${Math.round(x.duration)}ms ${x.invokerType ?? ''}:${String(x.invoker ?? '').slice(0, 40)} ${x.sourceFunctionName || '?'}@${String(x.sourceURL ?? '').split('/').pop()}:${x.sourceCharPosition}${x.forcedStyleAndLayoutDuration > 20 ? ' layout ' + Math.round(x.forcedStyleAndLayoutDuration) : ''}`);
        frames.push(`${Math.round(f.duration)}ms frame (style/layout ${f.styleAndLayoutStart ? Math.round(f.startTime + f.duration - f.styleAndLayoutStart) : 0})\n   ` + (sc.join('\n   ') || 'no script: drawing or the browser'));
        if (frames.length > 8) frames.shift();
      }
    }).observe({ type: 'long-animation-frame', buffered: true } as any);
  } catch { /* this browser does not say */ }
  let box: HTMLDivElement | null = null;
  const show = () => {
    if (box) { box.remove(); box = null; return; }
    box = document.createElement('div');
    box.style.cssText = 'position:fixed;right:12px;bottom:12px;z-index:99999;background:rgba(28,28,30,.92);color:#f2f2f7;font:11px/1.5 ui-monospace,Menlo,Consolas,monospace;padding:10px 12px;border-radius:10px;max-height:80vh;max-width:70vw;overflow:auto;white-space:pre;pointer-events:auto';
    const top = [...rows].sort((a, b) => b.total - a.total).slice(0, 14);
    box.textContent = top.length ? 'slowest presses (ms)   wait  work  draw  total\n' + top.map(r => `${r.what.padEnd(22)} ${String(r.wait).padStart(5)} ${String(r.work).padStart(5)} ${String(r.draw).padStart(5)} ${String(r.total).padStart(6)}`).join('\n') : 'no slow presses yet';
    box.textContent += '\n\nlongest frames\n' + (frames.length ? [...frames].reverse().join('\n') : 'none over 200 ms');
    document.body.append(box);
  };
  addEventListener('keydown', e => { if (e.ctrlKey && e.shiftKey && (e.key === 'L' || e.key === 'l')) { e.preventDefault(); show(); } }, true);
}
