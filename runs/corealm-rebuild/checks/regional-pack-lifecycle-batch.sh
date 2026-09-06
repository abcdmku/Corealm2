#!/usr/bin/env bash
# Serial regional pack lifecycle runs for one acceptance GPU slot. Only one Chromium at a time:
# other worktrees are running their own. Reports land under test-results/regional-pack-lifecycle/.
#
#   PORT=4183 node runs/corealm-rebuild/checks/stable-server.mjs
#   bash runs/corealm-rebuild/checks/regional-pack-lifecycle-batch.sh pack_a pack_b
set -u
URL="${COREALM_URL:-http://127.0.0.1:4183}"
errors="$(mktemp)"
for pack in "$@"; do
  start=$SECONDS
  if node --import tsx tools/regional-pack-lifecycle-test.ts --url "$URL" --pack "$pack" >/dev/null 2>"$errors"; then
    echo "PASS $pack ($((SECONDS - start))s)"
  else
    echo "FAIL $pack ($((SECONDS - start))s)"
    tail -5 "$errors"
  fi
done
rm -f "$errors"
