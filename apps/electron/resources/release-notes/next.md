# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

## Improvements

## Bug Fixes

- **Automation creation context isolation** — Scheduled, app-event, and agent-event creation dialogs now use separate category contexts and titles. Unfinished drafts remain resumable, new automation requests no longer inherit completed creation conversations, and detail edits target the selected rule ID. Fixes #362.
