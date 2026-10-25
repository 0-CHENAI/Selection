# Renderer development startup and initial viewport

Base: remote `test` at `6bac5088447b716a71890f6e1c350f5fab82b855`.
The reported source development environment is macOS / Node 24.18.0. The exact
Vite failure below was reproduced here on Linux / Node 24.19.0, with an empty
dependency cache and the actual renderer entry graph, without mocking imports.

## Root cause and fix

The cold dependency scanner follows this actual import chain:

```text
main.tsx → App → AppShell → useViews
  → @craft-agent/shared/views → views/evaluator.ts
  → utils/debug.ts → require('electron-log/main')
  → electron-log/src/node/transports/remote.js → require('https')
```

The runtime environment guard and try/catch in the shared debug helper do not
stop esbuild's static dependency scan. Vite tries to resolve the installed
`https` npm entry from a Node transport and fails before startup. Renderer
logging's legitimate `electron-log/renderer` import is not the offending edge.

The shared helper now has no Node logger import. The main process registers its
existing `log.info` sink through a browser-safe leaf export. Main-process file
logging and stderr, renderer console output, and CLI JSON-only suppression are
covered by an isolated routing test. No polyfill, Node permission change,
dependency exclusion, exception suppression or `https` package installation was
used.

Before application CSS loads, the browser's default 8px body margin combines
with the inline loader's `100vh`. At a 720px viewport the document was 736px
high and the loader started at `(8, 8)`. The bootstrap HTML now supplies the
existing root viewport constraints before module loading; the loader fills
that root rather than adding another viewport height. At 720px, document and
loader are exactly 720px with origin `(0, 0)`. This changes only document/root
overflow; conversation and template detail scroll containers still scroll.

## Introduction point and previous test gap

- The shared logger's literal main-process require predates PR #645:
  `git blame` traces it to `36a5c9de6` (2026-02-08); the renderer view-evaluation
  import exists from `011e75ec0` (2026-01-23).
- The inline `100vh` loader dates to `6c9bb510b` (2026-01-24).
- PR #645 did not modify these files or import edges. There is no evidence here
  that the earlier missing PPT entry and this cold-start failure share a cause.
- Earlier component checks used a warm manually started Vite server and a host
  bridge fixture; production builds use a different optimizer. They missed the
  cold dev scan. `electron:dev` deliberately cleans its generated Vite cache,
  so that startup path must be checked independently.

## Validation

- `bun run test:renderer-startup`: real Vite server, fresh temporary dependency
  cache, actual index/main requests, completed prebundle; renderer logger stays
  optimized and Node logger is absent. Added to `validate:dev`, and therefore
  the existing `validate:ci` merge gate. The test uses no browser/host mocks.
- `scripts/check-startup-layout.cjs`: passes with main.tsx deliberately
  unavailable (so no application CSS reset), at 980×720, 320×640 and 2048×1316.
  No horizontal/vertical document overflow; loader fills the viewport; wheel
  input cannot scroll the body. Real conversation history and 12-page template
  details retain internal scrolling. The app/preview portions mock IPC only.
- `scripts/check-ppt-entry.cjs`: real complete AppShell and ChatPage across new,
  existing and project NORM, PRO, independent PPT, and return navigation.
  Sidebar PPT stays visible; the ordinary composer picker works; independent
  PPT suppresses only its duplicate picker and PRO badge. No runtime errors.
- 12 focused tests / 53 assertions pass, including logger routing, draft
  context isolation and sidebar preservation.
- Full typecheck and lint pass (existing repository warnings, no errors).

## Visually inspected evidence

| State | Screenshot |
| --- | --- |
| Initial loading before fix | [loading-before.png](loading-before.png) |
| Initial loading after fix, 980px | [loading-980.png](loading-980.png) |
| Narrow loading, 320px | [loading-320.png](loading-320.png) |
| Large loading, 2048px | [loading-2048.png](loading-2048.png) |
| Message list internal scroll | [messages-scroll.png](messages-scroll.png) |
| Template detail internal scroll | [template-scroll.png](template-scroll.png) |
| Ordinary NORM | [navigation/norm.png](navigation/norm.png) |
| Existing NORM | [navigation/norm-existing.png](navigation/norm-existing.png) |
| Project NORM | [navigation/norm-project.png](navigation/norm-project.png) |
| PRO | [navigation/pro.png](navigation/pro.png) |
| Independent PPT | [navigation/ppt.png](navigation/ppt.png) |

Screenshots were opened and visually inspected. Browser layout uses Chromium;
native macOS Electron and the user's local application/data are not available
inside this Linux environment. No real model requests were sent.

## Source user's restart after the merge

Stop the current development process, update `test`, and restart normally:

```sh
cd /path/to/Selection
git switch test
git pull --ff-only origin test
bun run electron:dev
```

The normal dev launcher rebuilds its generated dependency cache. No deletion
of configuration, workspaces, sessions or user data is needed.
