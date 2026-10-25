# Missing PPT entry investigation

Investigated `test` at `6bac5088447b716a71890f6e1c350f5fab82b855`, the
official `v3.1.0-beta76` release target. Treat the user's application as current
test; its actual renderer identity is not independently known.

**Result: not reproduced. No production logic was changed.**

## Source and production artifact

- PR #645 changes only the composer visibility conditions and standalone draft
  context reset, plus tests/evidence. It does not change `AppShell` or sidebar
  ordering.
- `AppShell` unconditionally defines `nav:ppt`; the ordinary-sidebar transform
  explicitly keeps it between projects and sources. NORM/PRO, workspace session
  count and collapsed-project preferences do not gate that root entry.
- `FreeFormInput` shows its PPT picker whenever `pptMode` is false, in both
  desktop and compact layouts. Only an independent PPT view/session suppresses
  the duplicate composer control. No source, model or skill availability gate
  hides this control.
- No PPT visibility preference or CSS rule hiding those two entries was found.
  The relevant saved sidebar preference controls expandable children; it does
  not remove the PPT root.
- The official macOS ARM64 release ZIP was downloaded without installing it or touching
  user data. Its SHA-256 matches the published checksum:
  `d60d0adaceb5197598f216816222bcb0727c0889813650415cd3a514d756e0b2`.
  This was a static inspection; the packaged macOS application was not run on
  Linux, and the Windows installer's bytes have not been inspected.
- Its actual `renderer/index.html` loads `assets/main-BZmDXVyE.js` and
  `assets/styles-B34OWuty.js`. The main chunk contains the unconditional PPT
  sidebar definition and ordering. The styles chunk contains the real PPT
  picker and both `!pptMode` call sites; the entry has not been removed by
  production bundling.
- Packaging cleans prior release output and rebuilds the renderer. Packaged
  window restoration loads the current application's renderer file, not the
  previously saved file path. Development mode uses `VITE_DEV_SERVER_URL`.

## Real-component reproduction

The fixture's `?shell=1` mode mounts the production `AppShell`, `LeftSidebar`,
`MainContentPanel`, `ChatPage` and composer. Only IPC is stubbed. A project named
Redundant mirrors the reported navigation layout. No live model is called.

`scripts/check-ppt-entry.cjs` passed with no page runtime errors:

- New NORM: global PPT entry and composer picker are visible.
- Existing NORM: both remain visible.
- Project-scoped NORM: both remain visible.
- Clicking global PPT opens the actual PPT page and gallery, retains global
  navigation, and hides only the duplicate picker/PRO badge in the composer.
- Returning to ordinary chat restores the picker; it opens its template popover.
- Switching to PRO and back to NORM retains both entries.
- Legacy `collapsed-sidebar-items` preferences, including `nav:ppt`, do not
  remove the global entry. Preferences are seeded only in an isolated browser
  context, never in the user's data.

Screenshots were opened and visually inspected:

| State | Image |
| --- | --- |
| New NORM | [norm.png](norm.png) |
| Existing NORM | [norm-existing.png](norm-existing.png) |
| Project NORM | [norm-project.png](norm-project.png) |
| PRO | [pro.png](pro.png) |
| Independent PPT | [ppt.png](ppt.png) |

The prior sidebar-order suite also passed: 7 tests, 30 assertions. Electron
typecheck passed. No fix was invented or rollback applied because neither
source nor the inspected official production artifact reproduces the reported
missing global entry. The baseline merge's Validate and Package Desktop
Installers workflows remain successful.

## Remaining evidence needed

Identify how the affected current-test window is running: installed package,
local development launch, or browser/remote WebUI. If still necessary, the
following read-only console probe identifies renderer filenames without
returning file paths, server addresses, query tokens, project names or messages:

```js
JSON.stringify({
  runtime: window.electronAPI?.getRuntimeEnvironment?.(),
  protocol: location.protocol,
  modules: [...document.querySelectorAll('script[type="module"][src]')]
    .map(s => new URL(s.src).pathname.split('/').pop()),
  sidebarPpt: [...document.querySelectorAll('nav[aria-label="Main navigation"] button')]
    .some(b => /^PPT(?:\s*\d+)?$/.test(b.textContent.trim())),
  composerPpt: document.querySelectorAll('[data-testid="ppt-picker-button"]').length
})
```

Do not infer an old installed version from this investigation. No update,
reinstall, preference reset or user-data modification was performed. This
diagnostic branch carries verification/evidence only; it is not a claimed fix.
