# PPT composer context controls

Base: remote `test` at `d559dcf50e37b840a9135b3efe152fe4dddb95b4`.

The production `ChatPage`, `ChatDisplay`, input, source selector, directory
control and project mark run in Chromium. Only the host bridge is stubbed;
the fixture records the real page's creation options, send arguments and
session commands. The catalog contains one synthetic template. No live model
request, external source credentials or native OS dialog is used.

## Results

- PPT mode hides only the redundant input PPT button and PRO badge in desktop
  and compact layouts. Ordinary chat retains its PPT button, and ordinary PRO
  chat retains its PRO badge.
- Source selection and `/work/ppt-input` reach the first session's creation
  options. `workMode: PRO`, `ppt-design` and the chosen template reach the real
  page's creation/send boundary. Existing PPT follow-ups target the same session.
- Existing-session clear sends `updateWorkingDirectory` with its session root;
  draft clear sends explicit `none`. Source toggling updates the displayed
  session's selection.
- A second standalone creation receives `enabledSourceSlugs: []` and
  `workingDirectory: none`, with PRO execution retained. The previous session's
  directory and sources do not leak into the next draft.
- The fixed project folder remains a read-only mark without picker or clear.
- Controls remain reachable at 480px in desktop and compact layouts. No browser
  runtime errors occurred.
- All screenshots below were opened and visually inspected, including the
  original component before modification. Labels truncate in the narrow view;
  source/folder icons, model picker and send remain available.

## Screenshots

| State | Evidence |
| --- | --- |
| Before (before the synthetic catalog was populated) | [before.png](before.png) |
| New PPT after fix | [after.png](after.png) |
| Template, source and folder selected | [selected.png](selected.png) |
| Existing PPT conversation | [existing.png](existing.png) |
| Fresh draft after creation and clear | [new-isolated.png](new-isolated.png) |
| Narrow desktop, 480px | [narrow.png](narrow.png) |
| Compact, 480px | [compact.png](compact.png) |
| Fixed project folder | [project.png](project.png) |

## Validation

- `bun run typecheck:all`: passed.
- `bun run lint`: passed, with existing repository warnings and no errors.
- i18n parity, sorting and coverage: passed.
- Focused draft, directory, source reconciliation and PPT handover suite:
  28 tests passed, 117 assertions.
- `scripts/check-ppt-composer.cjs`: passed all browser assertions above.
- Local `bun run test` reaches `packages/pi-agent-server/src/isolated-shell.test.ts`
  and stops on three OfficeCLI integration cases (DOCX/XLSX/PPTX), because the
  checkout has no bundled Linux OfficeCLI runtime (exit 127). No checks or tests
  were weakened. The repository's macOS/Windows CI remains the merge gate.

Run the browser regression with Vite serving `apps/electron/vite.config.ts`:

```sh
NODE_PATH=/path/to/runner/node_modules CHROMIUM_PATH=/usr/bin/chromium \
  SCREENSHOT_DIR=docs/qa/ppt-composer node scripts/check-ppt-composer.cjs
```

Library reference materialization failed twice (the second attempt used a local
destination), and the supported screenshot batch upload failed before transfer
because Library's hosted tools could not be reached. These checked-in images are
the durable visual evidence. The user-supplied screenshot description was used
alongside the reproduced, visually inspected component.
