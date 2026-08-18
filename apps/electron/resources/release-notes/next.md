# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

- **Native Office document tools** — Word / Excel / PowerPoint inspection and editing now use an always-available, structured runtime backed by the bundled `officecli` binary, without exposing OfficeCLI as a skill.

## Improvements

## Bug Fixes

## Breaking Changes

- **Anthropic official API / Claude Max OAuth / `anthropic-messages` are no longer supported** — leftover connections stay on disk but cannot send, become the default, or be selected for new sessions. Reconfigure with OpenAI Compatible or another Selection Backend provider. The Claude Agent SDK runtime and native binary are removed.
