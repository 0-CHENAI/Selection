# Swarm / Conductor v3 acceptance record

## 2026-09-04 closure run

Status: **promotion blocked only on the fixed real-model gate**.

The run started from `origin/test` at `03caede0` on
`codex/swarm-conductor-quality-efficiency-v3`.

### Automated contracts

- `bun test packages/shared/src/tasks apps/electron/src/renderer/components/app-shell/kanban/__tests__ apps/electron/scripts/afterPack.test.ts`
  passed: 169 tests.
- `bun test packages/server-core/src/tasks/TaskRunner.test.ts packages/server-core/src/tasks/TaskRunner.v3.test.ts packages/server-core/src/tasks/quality-scenarios.test.ts packages/server-core/src/sessions/session-tool-usage.test.ts packages/shared/src/prompts/__tests__/system.test.ts`
  passed: 134 tests.
- Shared and Electron type checks passed.
- Electron lint completed with no errors. Its 86 warnings were pre-existing and
  none were in the files changed by this closure run.

These results cover the locked scheduler scenarios and renderer round trips;
they do not replace the real-model gate.

### Packaged Electron

- `bun run electron:build:swarm-preview` passed.
- The macOS distribution produced arm64 and x64 DMG/ZIP artifacts in
  `apps/electron/release-swarm-preview`.
- The packaged app identity is `Selection Swarm Preview` /
  `com.lukilabs.craft-agent.swarm-preview`.
- `codesign --verify --deep --strict` passed for the arm64 app (ad-hoc local
  signature; notarization is intentionally not part of this local preview).

### Packaged-app dogfood

The arm64 packaged app was launched and exercised through its real Electron UI:

- The Preview build exposed the V3 execution section.
- Coordinator checkpoints offered Default/Required/Off.
- Final verification offered Default/Required/Off.
- A newly added subtask exposed No cache/Same run/Across runs.
- Selecting Same run updated the control without saving or starting a task.
- An explicit `cache: none` value does not duplicate the No cache menu item.

This run found and fixed a build-only defect: dynamic `process.env[key]`
lookups were not replaced by Vite/esbuild, so Preview controls were hidden in a
packaged renderer even though the build environment enabled them. Dedicated
build-time globals now carry both preview flags, with regression coverage for
the preview fallback and explicit runtime override precedence. Build-time string
defines are JSON-escaped before being passed to esbuild.

The form round trip also preserves YAML-owned V3 tuning values
(`timeout_seconds` and `reserve_ratio`) while editing the visible mode/required
controls. Switching editor targets resets the source schema version before the
next spec is loaded, so stale V3 state cannot bypass the first-migration
confirmation for a V1/V2 or newly created task.

### Remaining gate

The required ORDER connection `pi-api-key-2` with model `Laufry` is not
available in the current acceptance environment. Therefore the seven fixed
scenarios, repeated three times each, have **not** been claimed as 21/21.

Do not substitute another model and do not promote V3 to a default-on feature.
Once that connection is available, run the seven scenarios three consecutive
times, attach per-run results here, and require 21/21 before promotion.
