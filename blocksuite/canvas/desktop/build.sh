#!/usr/bin/env bash
# Desktop package = canvas-mcp build + portable Windows Node + launchers.
set -e
HERE=$(cd "$(dirname "$0")" && pwd); B=${MCP_BUILD:-/tmp/canvas-mcp-build}
MCP_BUILD=$B "$HERE/../mcp/build.sh"
D=$B/out/canvas-desktop; rm -rf "$D"; mkdir -p "$D/node"
cp -r "$B/out/canvas-mcp/app" "$B/out/canvas-mcp/server.mjs" "$B/out/canvas-mcp/version.json" "$D/"
cp "$HERE/Canvas.vbs" "$HERE/Quit Canvas.cmd" "$HERE/Set Claude key.cmd" "$HERE/README.md" "$HERE/canvas.ico" "$D/"
NODE=${NODE_WIN:-/tmp/node-win/package/bin/node.exe}
[ -f "$NODE" ] || (mkdir -p /tmp/node-win && cd /tmp/node-win && npm pack node-win-x64@22.23.5 --silent && tar xzf node-win-x64-22.23.5.tgz)
cp "$NODE" "$D/node/node.exe"
(cd "$B/out" && rm -f canvas-desktop.zip && zip -qr canvas-desktop.zip canvas-desktop)
echo "built $B/out/canvas-desktop.zip"
