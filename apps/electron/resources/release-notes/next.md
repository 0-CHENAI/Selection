# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

## Improvements

## Bug Fixes

- **Swarm Markdown delivery no longer dies on `_content` / fake preview tools** — Compatible endpoints that emit `write({ path, _content })` are recovered to `{ path, content }` before schema validation, without loosening extra-field rejection or bypassing PreToolUse / path permissions. The system prompt now states that `markdown-preview` is fenced reply syntax, not a tool, and those pseudo-tool calls are counted by provider/model instead of being rewritten into text. ([#255](https://github.com/0-CHENAI/Selection/issues/255))
