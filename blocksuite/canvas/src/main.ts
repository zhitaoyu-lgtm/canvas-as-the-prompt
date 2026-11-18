import '@toeverything/theme/style.css';
import '@toeverything/theme/fonts.css';

import { AffineSchemas } from '@blocksuite/affine/schemas';
import { CommunityCanvasTextFonts, DocModeProvider, EditorSettingExtension, FontConfigExtension, ParseDocUrlExtension } from '@blocksuite/affine/shared/services';
import { nanoid, Schema, Text } from '@blocksuite/affine/store';
import { TestWorkspace } from '@blocksuite/affine/store/test';
import { BroadcastChannelAwarenessSource, IndexedDBBlobSource, IndexedDBDocSource } from '@blocksuite/affine/sync';
import { effects as itEffects } from '@blocksuite/integration-test/effects';
import { getTestStoreManager } from '@blocksuite/integration-test/store';
import { getTestViewManager } from '@blocksuite/integration-test/view';

import * as Y from 'yjs';

import './board.css';

import './stickers';
import { aiToolbarExtension, mountAiBar } from './ai-bar';
import { mountToolbar } from './toolbar';
import { mountInspector } from './ai/inspect';
import { mountDemos } from './ai/demo';
import { mountSense } from './ai/sense';
import { setTemplateHost } from './stickers';
import { mountComments } from './ai/comments';
import { mountBridge } from './ai/bridge';
import { createAssistant } from './ai/assistant';
import { linkPreviewExtension } from './ai/links';
import { ImageProxyService } from '@blocksuite/affine/shared/adapters';

import { editorSetting, parseDocUrl, whiteboardOnly } from './services';
import { mountPanel } from './exit/panel';

// Always the light look. A host page (e.g. a dark-mode preview) may set
// data-theme="dark" on <html>; AFFiNE would then turn every component dark.
const root = document.documentElement;
const pinLight = () => { if (root.dataset.theme !== 'light') root.dataset.theme = 'light'; };
pinLight();
new MutationObserver(pinLight).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
root.style.colorScheme = 'light';

itEffects();
const storeManager = getTestStoreManager();
const viewManager = getTestViewManager();
new Schema().register(AffineSchemas);

const BOARD = 'board:main';

// Small text when the board is zoomed out: by default the browser snaps each letter to whole pixels, so at small
// sizes letters crowd into each other. Ask for exact glyph positions instead, for text drawn on the canvas
// (stickies, headings, line labels); board.css asks the same for the cards.
{ const proto: any = CanvasRenderingContext2D.prototype;
  for (const fn of ['fillText', 'strokeText', 'measureText']) { const orig = proto[fn];
    proto[fn] = function (this: any, ...a: any[]) { if (this.textRendering !== 'geometricPrecision') { try { this.textRendering = 'geometricPrecision'; this.fontKerning = 'normal'; } catch { /* older engine */ } } return orig.apply(this, a); }; } }

async function main() {
  // One workspace, one board, kept in the app's own local storage (IndexedDB), so it is still there next time.
  const collection = new TestWorkspace({
    id: 'canvas', idGenerator: nanoid,
    docSources: { main: new IndexedDBDocSource('canvas-as-the-prompt') },
    blobSources: { main: new IndexedDBBlobSource('canvas-as-the-prompt'), shadows: [] },
    awarenessSources: [new BroadcastChannelAwarenessSource('canvas')],
  });
  collection.storeExtensions = storeManager.get('store');
  collection.start();
  await collection.waitForSynced?.();
  collection.meta.initialize();

  let doc = collection.getDoc(BOARD);
  if (!doc) {
    doc = collection.createDoc(BOARD);
    const store = doc.getStore();
    doc.load(() => { const root = store.addBlock('affine:page', { title: new Text() }); store.addBlock('affine:surface', {}, root); });
    store.resetHistory();
  }
  if (!doc.loaded) doc.load();
  const store = doc.getStore();
  // Undo / redo: this store's history never gets its "loaded" hook here, so its can-undo flags stay false and
  // the keyboard shortcut does nothing. Keep the flags in step with the undo stack ourselves.
  { const h: any = (store as any).history; const sync = () => { try { h._updateCanUndoRedoSignals(); h.onUpdated?.next?.(); } catch { /* engine changed */ } };
    for (const ev of ['stack-cleared', 'stack-item-added', 'stack-item-popped', 'stack-item-updated']) h?.undoManager?.on(ev, sync); sync(); }

  const editor = document.createElement('affine-editor-container') as any;
  editor.autofocus = true;
  editor.doc = store;
  const common = [
    FontConfigExtension(CommunityCanvasTextFonts),
    EditorSettingExtension({ setting$: editorSetting() }),
    ParseDocUrlExtension(parseDocUrl(collection)),
    { setup: (di: any) => { di.override(DocModeProvider, whiteboardOnly()); } },
  ];
  editor.pageSpecs = [...viewManager.get('page'), ...common];
  editor.edgelessSpecs = [...viewManager.get('edgeless'), ...common, aiToolbarExtension, linkPreviewExtension];
  editor.mode = 'edgeless';
  document.getElementById('app')!.append(editor);
  await editor.updateComplete;
  const waitRoot = async () => { for (let i = 0; i < 200; i++) { const r = document.querySelector('affine-edgeless-root') as any; if (r?.std && r.gfx) return r; await new Promise(r => setTimeout(r, 50)); } throw new Error('edgeless root not ready'); };
  const rootEl = await waitRoot();
  try { rootEl.std.store.get(ImageProxyService).setImageProxyURL(''); } catch { /* older store */ }
  await mountToolbar(rootEl);
  const assistant = createAssistant(rootEl);
  mountAiBar(rootEl, assistant);
  (window as any).cxAsk = (req: string) => assistant(req, (rootEl.gfx.selection.selectedElements as any[]).map(e => e.id));   // dev: ask without the bar
  mountInspector(rootEl);
  mountDemos(rootEl);
  mountSense(rootEl);
  setTemplateHost(rootEl);
  mountComments(rootEl);
  mountBridge(rootEl);
  mountPanel(rootEl);
  (window as any).editor = editor; (window as any).collection = collection; (window as any).cxDev = { Text, Y: Y.Text, rootEl };
}

main().catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;bottom:0;left:0;color:#b00;font:12px monospace;padding:8px">${String(e?.stack ?? e)}</pre>`); });
