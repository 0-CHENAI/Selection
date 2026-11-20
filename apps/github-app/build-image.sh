#!/usr/bin/env bash
set -euo pipefail

service_dir="$(cd "$(dirname "$0")" && pwd)"
context="$(mktemp -d)"
trap 'rm -rf "$context"' EXIT

# Bundle with the workspace's locked dependencies. Only the bundle is sent to Docker.
bun build "$service_dir/server.ts" --target=bun --outfile="$context/server.js"
docker build -f "$service_dir/Dockerfile" "$@" "$context"
