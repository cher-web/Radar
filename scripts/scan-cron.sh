#!/bin/bash
# Daily Radar scan wrapper — invoked by launchd.
# launchd gives us a sparse env, so we set PATH + cwd explicitly.

set -e

cd /Users/cher/Radar

# Make sure Homebrew node is on PATH (launchd default PATH is minimal).
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

echo "=== $(date '+%Y-%m-%d %H:%M:%S') — starting scan ==="
node bin/radar.js scan
echo "=== $(date '+%Y-%m-%d %H:%M:%S') — done ==="
