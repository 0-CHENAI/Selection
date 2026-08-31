#!/bin/bash
# Run source tests without discovering ignored Electron release/build artifacts.
# Isolated tests remain serial because they intentionally mutate process-global state.

set -euo pipefail

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

TEST_FILES=()
ISOLATED_FILES=()

while IFS= read -r -d '' file; do
  case "$file" in
    *.isolated.ts) ISOLATED_FILES+=("$REPO_ROOT/$file") ;;
    *.test.ts|*.test.tsx|*.test.js|*.test.jsx|*.spec.ts|*.spec.tsx|*.spec.js|*.spec.jsx)
      TEST_FILES+=("$REPO_ROOT/$file")
      ;;
  esac
done < <(
  git ls-files -z --cached --others --exclude-standard
)

for file in "${TEST_FILES[@]}"; do
  bun test "$file"
done

for file in "${ISOLATED_FILES[@]}"; do
  bun test "$file"
done
