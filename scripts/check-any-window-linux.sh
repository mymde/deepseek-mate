#!/bin/sh
# Invoke inside xvfb-run; a window manager is required to actually minimise/restore/raise windows.
set -eu
openbox >/dev/null 2>&1 &
wm_pid=$!
sleep 1
xcompmgr -c &
compositor_pid=$!
trap 'kill "$wm_pid" "$compositor_pid" 2>/dev/null || true' EXIT
sleep 1
kill -0 "$wm_pid" "$compositor_pid"
"$1" --no-sandbox "$(dirname "$0")/check-any-window.cjs"
