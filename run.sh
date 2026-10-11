#!/usr/bin/env bash
# Agent Wire: collect + build offline snapshot, then serve on 127.0.0.1:4291.
#   ./run.sh           build + serve
#   ./run.sh --shots   build + screenshot + serve
set -euo pipefail
cd "$(dirname "$0")"
PORT=4291
python3 build.py
if [[ "${1:-}" == "--shots" ]]; then bash tests/screenshot.sh; fi
if ss -ltn | grep -q "127.0.0.1:$PORT "; then
  echo "already serving on http://127.0.0.1:$PORT/"
else
  nohup python3 server.py > /tmp/agent-wire-$PORT.log 2>&1 &
  sleep 1
  echo "serving http://127.0.0.1:$PORT/ (pid $!)  ·  offline file: dist/agent-wire.html"
fi
