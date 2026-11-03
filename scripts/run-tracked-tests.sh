#!/bin/bash
# Run source tests without discovering ignored Electron release/build artifacts.
# Isolated tests remain serial because they intentionally mutate process-global state.

set -euo pipefail

KEEP_GOING=false
if [ "${1:-}" = "--keep-going" ] && [ "$#" -eq 1 ]; then
  KEEP_GOING=true
elif [ "$#" -ne 0 ]; then
  echo "Usage: $0 [--keep-going]" >&2
  exit 2
fi

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

FAILED_FILES=()

for file in ${TEST_FILES[@]+"${TEST_FILES[@]}"} ${ISOLATED_FILES[@]+"${ISOLATED_FILES[@]}"}; do
  if bun test "$file"; then
    continue
  fi
  FAILED_FILES+=("${file#"$REPO_ROOT"/}")
  if [ "$KEEP_GOING" = false ]; then
    break
  fi
done

if [ "${#FAILED_FILES[@]}" -gt 0 ]; then
  printf '\nFailed test files (%s):\n' "${#FAILED_FILES[@]}" >&2
  printf '  %s\n' "${FAILED_FILES[@]}" >&2
  exit 1
fi
