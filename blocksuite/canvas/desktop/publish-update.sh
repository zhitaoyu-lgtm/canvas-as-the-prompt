#!/usr/bin/env bash
# Publish the built app as an update: the desktop app reads the `desktop-app` branch (version.json + files).
# Run after mcp/build.sh. Needs push access to the repo.
set -e
B=${MCP_BUILD:-/tmp/canvas-mcp-build}; SRC="$B/out/canvas-mcp"; W="$B/update-branch"
REPO=${CANVAS_REPO:-https://github.com/zhitaoyu-lgtm/canvas-as-the-prompt.git}
HERE_D=$(cd "$(dirname "$0")" && pwd)
rm -rf "$W" && mkdir -p "$W" && cd "$W" && git init -q && git checkout -q -b desktop-app
cp -r "$SRC/app" "$SRC/server.mjs" "$SRC/version.json" .
cp "$HERE_D/Canvas.vbs" "$HERE_D/canvas.ico" "$HERE_D/README.md" "$HERE_D/Quit Canvas.cmd" "$HERE_D/Set Claude key.cmd" .
python3 - <<'PY'
import hashlib, json, time
m = json.load(open('version.json'))
m['version'] = time.strftime('%Y%m%d%H%M%S', time.gmtime())   # every publish is a new version
for f in ['Canvas.vbs', 'canvas.ico', 'README.md', 'Quit Canvas.cmd', 'Set Claude key.cmd']:
    m['files'][f] = hashlib.sha256(open(f, 'rb').read()).hexdigest()
json.dump(m, open('version.json', 'w'), indent=0)
PY
git add -A && git -c user.name=${GIT_NAME:-canvas} -c user.email=${GIT_EMAIL:-noreply@github.com} commit -qm "Desktop app $(python3 -c "import json;print(json.load(open('version.json'))['version'])")"
git push -qf "$REPO" desktop-app
echo "published $(python3 -c "import json;print(json.load(open('version.json'))['version'])")"
