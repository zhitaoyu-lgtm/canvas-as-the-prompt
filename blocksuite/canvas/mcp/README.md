# Canvas MCP

Lets Claude (Claude Desktop, or Claude Code) read your canvas and put things on it, the way Claude works in Figma through Figma's MCP.

## What you need
- Node.js 18 or newer (https://nodejs.org). Check in a terminal: `node -v`
- This folder somewhere stable, e.g. `C:\Users\<you>\canvas-mcp`

## Connect it to Claude Desktop
1. Claude Desktop → Settings → Developer → Edit Config. This opens `claude_desktop_config.json`.
2. Add (keep any servers already there; on Windows use double backslashes):
```json
{
  "mcpServers": {
    "canvas": {
      "command": "node",
      "args": ["C:\\Users\\<you>\\canvas-mcp\\server.mjs"]
    }
  }
}
```
3. Quit Claude Desktop fully and reopen it. "canvas" should appear among the chat's tools.

Claude Code instead: `claude mcp add canvas -- node C:\Users\<you>\canvas-mcp\server.mjs`

## Use it
- In a chat, say e.g. "Put the papers we discussed and their insights on my canvas."
- The canvas opens by itself at http://127.0.0.1:7357 (keep that tab open). Material arrives to the right of what is already there.
- Tools: `canvas_status`, `canvas_read` (the board as text), `canvas_import` (sources + insights + relations + decisions + open questions), `canvas_add` (any canvas part).

## Notes
- Everything stays on your computer: the server listens only on 127.0.0.1.
- The board at 127.0.0.1:7357 is stored in that browser and is separate from the claude.ai preview's board.
- Ask (the canvas's own AI bar) on this local page needs your API key in the canvas settings.
