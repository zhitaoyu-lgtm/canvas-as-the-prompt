#!/usr/bin/env bash
# Publish the built app as an update: the desktop app reads the `desktop-app` branch (version.json + files).
# Run after mcp/build.sh. Needs push access to the repo.
set -e
B=${MCP_BUILD:-/tmp/canvas-mcp-build}; SRC="$B/out/canvas-mcp"; W="$B/update-branch"
REPO=${CANVAS_REPO:-https://github.com/zhitaoyu-lgtm/canvas-as-the-prompt.git}
rm -rf "$W" && mkdir -p "$W" && cd "$W" && git init -q && git checkout -q -b desktop-app
cp -r "$SRC/app" "$SRC/server.mjs" "$SRC/version.json" .
git add -A && git -c user.name=${GIT_NAME:-canvas} -c user.email=${GIT_EMAIL:-noreply@github.com} commit -qm "Desktop app $(python3 -c "import json;print(json.load(open('version.json'))['version'])")"
git push -qf "$REPO" desktop-app
echo "published $(python3 -c "import json;print(json.load(open('version.json'))['version'])")"
