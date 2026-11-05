#!/bin/bash
# Run source tests without discovering ignored Electron release/build artifacts.
#
# Each file gets its own `bun test` process. In-process parallelism is unsafe:
# Electron mocks, CRAFT_CONFIG_DIR captures, and i18n singletons leak across
# files in the same VM. --keep-going (CI) runs several of those processes at
# once. Default mode stays serial and stops at the first failure.
# Isolated files stay serial after the regular set because they mutate
# process-global state on purpose.

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

MAX_PROCS=${TRACKED_TEST_PROCS:-4}
case "$MAX_PROCS" in
  ''|*[!0-9]*|0) MAX_PROCS=4 ;;
esac

FAILED_FILES=()
status=0

record_failure() {
  FAILED_FILES+=("$1")
  status=1
}

run_one() {
  local file=$1
  if bun test "$file"; then
    return 0
  fi
  record_failure "${file#"$REPO_ROOT"/}"
  return 1
}

# Portable pool: wait for the oldest job (no bash-4 `wait -n` / array slices).
run_files_parallel() {
  local max=$1
  shift
  local pids=""
  local n=0
  local fail_list
  fail_list=$(mktemp)

  reap_one() {
    local oldest rest
    oldest=${pids%% *}
    rest=${pids#* }
    if [ "$oldest" = "$pids" ]; then
      rest=""
    fi
    wait "$oldest" || true
    pids=$rest
    n=$((n - 1))
  }

  for file in "$@"; do
    while [ "$n" -ge "$max" ]; do
      reap_one
    done
    (
      if ! bun test "$file"; then
        printf '%s\n' "${file#"$REPO_ROOT"/}" >> "$fail_list"
      fi
    ) &
    if [ -z "$pids" ]; then
      pids=$!
    else
      pids="$pids $!"
    fi
    n=$((n + 1))
  done
  while [ "$n" -gt 0 ]; do
    reap_one
  done
  if [ -s "$fail_list" ]; then
    status=1
    while IFS= read -r line; do
      [ -n "$line" ] && FAILED_FILES+=("$line")
    done < "$fail_list"
  fi
  rm -f "$fail_list"
}

if [ "${#TEST_FILES[@]}" -gt 0 ]; then
  if [ "$KEEP_GOING" = true ] && [ "$MAX_PROCS" -gt 1 ]; then
    echo "Running ${#TEST_FILES[@]} tracked test files in up to ${MAX_PROCS} processes (one file per process)."
    run_files_parallel "$MAX_PROCS" "${TEST_FILES[@]}"
  else
    echo "Running ${#TEST_FILES[@]} tracked test files serially (one file per process)."
    for file in "${TEST_FILES[@]}"; do
      if run_one "$file"; then
        continue
      fi
      if [ "$KEEP_GOING" = false ]; then
        break
      fi
    done
  fi
fi

if [ "$status" -ne 0 ] && [ "$KEEP_GOING" = false ]; then
  printf '\nFailed test files (%s):\n' "${#FAILED_FILES[@]}" >&2
  printf '  %s\n' "${FAILED_FILES[@]}" >&2
  exit 1
fi

if [ "${#ISOLATED_FILES[@]}" -gt 0 ]; then
  echo "Running ${#ISOLATED_FILES[@]} isolated test files serially."
fi

for file in ${ISOLATED_FILES[@]+"${ISOLATED_FILES[@]}"}; do
  if run_one "$file"; then
    continue
  fi
  if [ "$KEEP_GOING" = false ]; then
    break
  fi
done

if [ "$status" -ne 0 ]; then
  printf '\nFailed test files (%s):\n' "${#FAILED_FILES[@]}" >&2
  printf '  %s\n' "${FAILED_FILES[@]}" >&2
  exit 1
fi
