#!/bin/sh
# Snapshot draft/ onto the local-dev branch WITHOUT switching branches.
#
# Why this exists: `git checkout local-dev` silently OVERWRITES ignored-untracked
# files (draft/* on main) with the branch's committed versions — git treats
# ignored files as expendable, so draft edits made on main's worktree are LOST
# on switch (this bit us once, 2026-07-09). This script commits the worktree's
# draft/ to local-dev through a temporary index: no checkout, no clobber.
set -e
cd "$(git rev-parse --show-toplevel)"
MSG="${1:-local: draft snapshot}"
TMP_INDEX=".git/ice-snapshot-index"
trap 'rm -f "$TMP_INDEX"' EXIT

GIT_INDEX_FILE="$TMP_INDEX" git read-tree local-dev
GIT_INDEX_FILE="$TMP_INDEX" git add -f draft
TREE=$(GIT_INDEX_FILE="$TMP_INDEX" git write-tree)
if [ "$TREE" = "$(git rev-parse 'local-dev^{tree}')" ]; then
  echo "snapshot-drafts: no draft changes vs local-dev — nothing to do."
  exit 0
fi
COMMIT=$(git commit-tree "$TREE" -p local-dev -m "$MSG")
git update-ref refs/heads/local-dev "$COMMIT"
echo "snapshot-drafts: local-dev -> $COMMIT"
