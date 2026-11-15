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

import './board.css';

import { editorSetting, parseDocUrl, whiteboardOnly } from './services';

itEffects();
const storeManager = getTestStoreManager();
const viewManager = getTestViewManager();
new Schema().register(AffineSchemas);

const BOARD = 'board:main';

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
  editor.edgelessSpecs = [...viewManager.get('edgeless'), ...common];
  editor.mode = 'edgeless';
  document.getElementById('app')!.append(editor);
  await editor.updateComplete;
  (window as any).editor = editor; (window as any).collection = collection;
}

// White or gray board, remembered per device.
function boardSwitch() {
  const KEY = 'cx-board';
  let cur = 'white';
  try { cur = localStorage.getItem(KEY) || 'white'; } catch {}
  const set = (v: string) => {
    cur = v;
    document.documentElement.dataset.board = v;
    try { localStorage.setItem(KEY, v); } catch {}
    bar.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === v)));
  };
  const bar = document.createElement('div');
  bar.className = 'cx-board-switch';
  bar.innerHTML = `<button data-v="white"><i style="background:#fff"></i>白</button><button data-v="gray"><i style="background:#f4f4f2"></i>灰</button>`;
  bar.addEventListener('click', e => { const b = (e.target as HTMLElement).closest('button'); if (b) set(b.dataset.v!); });
  document.body.append(bar);
  set(cur);
}
boardSwitch();

main().catch((e) => { console.error(e); document.body.insertAdjacentHTML('beforeend', `<pre style="position:fixed;bottom:0;left:0;color:#b00;font:12px monospace;padding:8px">${String(e?.stack ?? e)}</pre>`); });
