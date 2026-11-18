// Reaching Claude.
//  · In the preview (a claude.ai artifact) the page asks Claude on the viewer's own account (`sample`).
//  · In the desktop app, through the local server, which holds the user's own API key in a file on
//    this computer (claude-key.txt next to the app). The key never reaches the page.

const KEY = 'cx:anthropic-key';
const MODEL = 'cx:model';

export function apiKey(): string | null { try { return localStorage.getItem(KEY); } catch { return null; } }
export function setApiKey(k: string | null) { try { k ? localStorage.setItem(KEY, k) : localStorage.removeItem(KEY); } catch { /* storage blocked */ } }

let sampleFn: any;
async function viaArtifact(): Promise<any> {
  if (sampleFn !== undefined) return sampleFn;
  const cl = (window as any).claude;
  sampleFn = cl?.use ? await cl.use('sample').catch(() => null) : null;
  return sampleFn;
}

// the desktop app's own server forwards to Anthropic with the key it keeps; ask it once whether it has one
const LOCAL = /^(127\.0\.0\.1|localhost)$/.test(location.hostname);
let proxyOk: boolean | null = LOCAL ? null : false;
const proxyReady: Promise<boolean> = LOCAL
  ? fetch('/__claude', { cache: 'no-store' }).then(r => r.ok ? r.json() : { ok: false }).then(j => (proxyOk = !!j.ok)).catch(() => (proxyOk = false))
  : Promise.resolve(false);

export class ModelError extends Error { constructor(public code: string, msg: string) { super(msg); } }

export async function available(): Promise<boolean> { return !!apiKey() || (await proxyReady) || !!(await viaArtifact()); }
/** Whether answers can use the web (own API key: yes; the claude.ai preview: no). */
export const online = () => !!apiKey() || proxyOk === true;

export async function ask(system: string, user: string, image?: Blob | null, signal?: AbortSignal): Promise<string> {
  const key = apiKey();
  if (key) return viaApi(key, system, user, image, signal);
  if (await proxyReady) return viaApi(null, system, user, image, signal);
  const sample = await viaArtifact();
  if (sample) {
    let images: Blob[] | undefined;
    if (image) { try { const lim = await sample.limits?.(); if (lim?.images) images = [image]; } catch { /* text only */ } }
    try {
      const r = await sample(`${system}\n\n${user}`, { modelTier: 'complex', cache: false, images, signal });
      return r.text;
    } catch (e: any) { throw new ModelError(e?.code ?? 'failed', e?.message ?? 'Claude did not answer'); }
  }
  throw new ModelError('no_model', 'Claude is not connected on this computer');
}

async function viaApi(key: string | null, system: string, user: string, image?: Blob | null, signal?: AbortSignal): Promise<string> {
  const content: any[] = [];
  if (image) content.push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: await b64(image) } });
  content.push({ type: 'text', text: user });
  let model = 'claude-sonnet-5-5'; try { model = localStorage.getItem(MODEL) || model; } catch { /* default */ }
  // the board can go online: Claude may search and read pages while answering
  const tools = [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }];
  const messages: any[] = [{ role: 'user', content }];
  let out = '';
  for (let turn = 0; turn < 4; turn++) {
    const res = await fetch(key ? 'https://api.anthropic.com/v1/messages' : '/__claude/v1/messages', {
      method: 'POST', signal,
      headers: key
        ? { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' }
        : { 'content-type': 'application/json', 'x-canvas': 'claude' },
      body: JSON.stringify({ model, max_tokens: 8000, system, messages, tools }),
    });
    if (!res.ok) throw new ModelError(res.status === 401 ? 'bad_key' : 'failed', `Claude answered ${res.status}`);
    const j = await res.json();
    out = (j.content ?? []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('');
    if (j.stop_reason !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: j.content });   // a long search: let it continue
  }
  return out;
}
const b64 = (b: Blob) => new Promise<string>((res, rej) => { const fr = new FileReader(); fr.onload = () => res(String(fr.result).split(',')[1]); fr.onerror = rej; fr.readAsDataURL(b); });

/** Pull the JSON object out of an answer, tolerating code fences or a stray sentence. */
export function parseAnswer(text: string): any {
  const t = text.replace(/```(?:json)?/g, '');
  const s = t.indexOf('{'), e = t.lastIndexOf('}');
  if (s < 0 || e < s) throw new ModelError('bad_answer', 'No answer to place');
  return JSON.parse(t.slice(s, e + 1));
}
