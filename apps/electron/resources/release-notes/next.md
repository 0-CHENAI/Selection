# Pending Release Notes

This file accumulates release notes for the next unreleased version. PRs that add user-visible behavior should append a bullet to the relevant section here. Versioned files (`X.Y.Z.md`) are owned by the release skill — never create them in feature commits.

## Features

## Improvements

- **Streamlined messaging integrations** — Removed the retired Telegram and WhatsApp integrations, their setup surfaces, background worker, and packaged dependencies. Existing installations now discard only those integrations' obsolete credentials and local state while preserving Lark / Feishu configuration and bindings. (#280)

## Bug Fixes
