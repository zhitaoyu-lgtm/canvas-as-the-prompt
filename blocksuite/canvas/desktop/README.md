# Canvas as the Prompt · desktop

## Open
Double-click **Canvas.vbs** once: it also puts a **Canvas** shortcut (with the app icon) on the Desktop and in the Start menu; use that from then on. The board opens in its own window (no browser tabs or address bar).
For a desktop icon: right-click Canvas.vbs → Send to → Desktop (create shortcut).

Nothing to install: Node is included (`node/`). Everything runs on this computer at 127.0.0.1:7357.

## Claude
- Once, before the first start: double-click **Set Claude key.cmd** and paste your Anthropic API key. It is saved as `claude-key.txt` in this folder; the board's server sends it only to Anthropic, and the page itself never sees it. There is no key screen inside the app.
  (Or create `claude-key.txt` yourself with the key on one line. Updates don't touch this file.)
- From Claude Desktop (put chat content on the board, read it, export it): Settings → Developer → Edit Config, add
```json
{ "mcpServers": { "canvas": { "command": "C:\\Users\\<you>\\canvas-desktop\\node\\node.exe",
  "args": ["C:\\Users\\<you>\\canvas-desktop\\server.mjs"] } } }
```
  then quit and reopen Claude Desktop. Both use the same board.

## Update
Automatic. Each time Canvas opens it checks the project's `desktop-app` branch on GitHub, downloads only the files that changed (each checked against its sha256) and shows "A new version is ready · Reload". Offline, it simply opens the version it has. The board's content stays: it lives in the window's own storage, not in these files.

## Stop
Close the window. To stop the background server too, run **Quit Canvas.cmd**.
