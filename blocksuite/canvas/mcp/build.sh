#!/usr/bin/env bash
# Build the canvas MCP package: one bundled server.mjs + the built canvas app, zipped.
# Deps live outside the monorepo (blocksuite/** is a yarn workspace glob).
set -e
HERE=$(cd "$(dirname "$0")" && pwd); B=${MCP_BUILD:-/tmp/canvas-mcp-build}
mkdir -p "$B" && cd "$B" && [ -d node_modules ] || npm i --silent @modelcontextprotocol/sdk@1.17.4 ws@8.18.3 zod@3.25.76 esbuild@0.25.9
mkdir -p out/canvas-mcp
npx esbuild "$HERE/server.ts" --bundle --platform=node --format=esm --target=node18 --outfile=out/canvas-mcp/server.mjs \
  --banner:js="import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);"
(cd "$HERE/.." && rm -rf dist && npx vite build)
rm -rf out/canvas-mcp/app && cp -r "$HERE/../dist" out/canvas-mcp/app
cp "$HERE/README.md" out/canvas-mcp/ 2>/dev/null || true
(cd out && rm -f canvas-mcp.zip && zip -qr canvas-mcp.zip canvas-mcp)
echo "built $B/out/canvas-mcp.zip"
