// Waiting that still works when the tab is in the background.
// A hidden tab's own timers are slowed to once a second, and after five minutes to once a minute; frames stop
// altogether. A worker's timers are not slowed, so the wait is kept there and the page is told when it is over.

let worker: Worker | null | undefined;
const pending = new Map<number, () => void>();
let seq = 0;

function get(): Worker | null {
  if (worker !== undefined) return worker;
  try {
    const src = 'onmessage=e=>setTimeout(()=>postMessage(e.data[0]),e.data[1])';
    worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
    worker.onmessage = e => { const f = pending.get(e.data); pending.delete(e.data); f?.(); };
    worker.onerror = () => { worker = null; for (const f of pending.values()) f(); pending.clear(); };
  } catch { worker = null; }
  return worker;
}

/** Resolves after about `ms`, in the foreground or the background. */
export const wait = (ms: number) => new Promise<void>(res => {
  const w = get();
  if (!w) { setTimeout(res, ms); return; }
  const id = ++seq; pending.set(id, res); w.postMessage([id, ms]);
});

/** Two frames when the tab is showing; a short wait when it is not. */
export const frames2 = () => new Promise<void>(res => {
  let done = false; const go = () => { if (!done) { done = true; res(); } };
  if (!document.hidden) requestAnimationFrame(() => requestAnimationFrame(go));
  void wait(150).then(go);
});
