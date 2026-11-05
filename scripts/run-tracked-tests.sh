#!/bin/bash
# Run source tests without discovering ignored Electron release/build artifacts.
# Regular files run in one bun test process per chunk (parallel inside the chunk).
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

# Stay under conservative ARG_MAX limits (especially if this script is ever
# invoked on Windows Git Bash). Each chunk still runs files in parallel.
CHUNK_SIZE=250
FAILED_FILES=()
status=0

run_bun_test() {
  if bun test "$@"; then
    return 0
  fi
  status=1
  return 1
}

if [ "${#TEST_FILES[@]}" -gt 0 ]; then
  echo "Running ${#TEST_FILES[@]} tracked test files in parallel chunks of ${CHUNK_SIZE}."
  chunk=()
  flush_chunk() {
    if [ "${#chunk[@]}" -eq 0 ]; then
      return 0
    fi
    if ! run_bun_test "${chunk[@]}"; then
      FAILED_FILES+=("(parallel tracked chunk of ${#chunk[@]} files — see bun test output above)")
      if [ "$KEEP_GOING" = false ]; then
        exit 1
      fi
    fi
    chunk=()
  }
  for file in "${TEST_FILES[@]}"; do
    chunk+=("$file")
    if [ "${#chunk[@]}" -ge "$CHUNK_SIZE" ]; then
      flush_chunk
    fi
  done
  flush_chunk
fi

if [ "${#ISOLATED_FILES[@]}" -gt 0 ]; then
  echo "Running ${#ISOLATED_FILES[@]} isolated test files serially."
fi

for file in ${ISOLATED_FILES[@]+"${ISOLATED_FILES[@]}"}; do
  if bun test "$file"; then
    continue
  fi
  FAILED_FILES+=("${file#"$REPO_ROOT"/}")
  status=1
  if [ "$KEEP_GOING" = false ]; then
    break
  fi
done

if [ "$status" -ne 0 ]; then
  printf '\nFailed test files (%s):\n' "${#FAILED_FILES[@]}" >&2
  printf '  %s\n' "${FAILED_FILES[@]}" >&2
  exit 1
fi
