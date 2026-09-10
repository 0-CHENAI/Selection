# Issue #332 模型选择器提示残留修复

## 问题

桌面输入栏点开模型选择器后，用点击别处、选中模型、按 Esc、或关闭思考等级子菜单再关闭的方式收起菜单，「模型」悬浮提示会重新出现在模型按钮上方并一直保持显示；同时输入框失去焦点，紧接着打字不会进入输入框。只有再点一次别处（按钮 blur），或把鼠标移入再移出按钮，提示才会消失。

## 根因

模型按钮是「Tooltip 包住下拉菜单触发器」的组合，这是输入栏里唯一一处（`FreeFormInput.tsx` 的 `Tooltip` + `DropdownMenuTrigger`）。收起菜单时发生如下时序：

1. `onOpenChange(false)` → `handleModelDropdownOpenChange` → `focusComposerAfterPicker()`（`setTimeout 0`）先把焦点交还输入框。此时菜单内容还在播放退出动画（`data-[state=closed]:animate-out`，约 150ms），并未卸载。
2. 退出动画结束、内容卸载时，Radix Menu 的 `onCloseAutoFocus` 执行 `context.triggerRef.current?.focus()`；modal 菜单下左键外部点击不会跳过这次聚焦。
3. 触发器拿到 focus → `TooltipTrigger.onFocus` → `handleOpen()`（无延迟，即 `instant-open`）→ 提示打开。
4. 此时鼠标已不在按钮上，不会再产生 `pointerleave`；焦点停在按钮上也不会 blur。没有任何事件去关闭它，提示持续显示。

实测采样（真实 Chromium，逐帧记录提示节点与焦点）：

| 关闭方式 | 提示重新出现 | 出现时的 `document.activeElement` |
| --- | --- | --- |
| 点击别处 | t+229ms | 模型按钮 |
| 选择模型 | t+59ms | 模型按钮 |
| Esc | t+23ms | 模型按钮 |

`restoreComposerFocus` 的注释原本假设「延后一个任务就能跑赢触发器的焦点回收」，但第 2 步发生在退出动画之后，晚于这个定时器，所以 #26 的输入框失焦也随之回归。

## 修复

`keepComposerFocusOnPickerClose`（`restore-composer-focus.ts`）在 `onCloseAutoFocus` 阶段拒绝这次焦点回收，焦点留在第 1 步已经交还的输入框上；`FreeFormInput.tsx` 把它接到模型菜单的 `StyledDropdownMenuContent` 上。提示本身、悬停行为、键盘聚焦行为都不改动。

选择拒绝而不是「把焦点还给触发器后再关掉提示」，是因为触发器的 focus 会立刻重新打开提示，只能靠动画时长之类的时序猜测去关，属于同一类脆弱修复。

## 验证记录（2026-09-10）

环境：checkout `test` @ `0a7311fe`，macOS 26.6.2，Playground（`apps/electron/src/renderer/playground.html`）+ 真实 Chromium，驱动真实 `FreeFormInput`（CHAT INPUTS → Slash Command Demo；入口需要 `playground.html`，`/playground/` 会回落到应用入口并因缺少 `electronAPI` 而白屏）。

19 项断言全部通过：

- 悬停仍按原延迟显示提示（`delayed-open`），移开鼠标仍消失；
- 点击别处 / 选中模型 / Esc / 打开思考等级子菜单后关闭：菜单确实打开过，关闭后提示保持关闭，焦点回到输入框，随后的打字进入输入框；
- 关闭菜单后把鼠标移回按钮，悬停提示仍正常显示；
- 键盘聚焦触发器（与 Tab 聚焦同为「无 pointerdown 的 focus」）仍会显示提示。

修复前用同一脚本在三条路径上均复现残留；修复后全部通过。仓库级检查：`bash scripts/run-tracked-tests.sh` 全部通过，`apps/electron` 的 `tsc --noEmit` 通过，`eslint` 无新增告警（仅存量 `react-hooks/exhaustive-deps` 警告）。

## 提交前审查

- 新增的接线测试按「模型菜单区块」切片，改为从 `<DropdownMenu open={modelDropdownOpen}` 切到**其后**的 `</StyledDropdownMenuContent>`，并在区块为空时直接失败，避免 `indexOf` 返回 -1 时静默通过。
- `disabled` 分支：输入栏被禁用时 `focusComposerAfterPicker` 直接返回（模型按钮此时仍可点开，与来源/工作目录/附件按钮不同），所以焦点会落到 `body`。仍选择无条件拒绝焦点回收，让「提示不残留」在所有状态下成立；这一取舍由代码推导，未在 Playground 中复现该状态。
- 相邻选择器现状（实测）：来源选择器是自定义 popover，关闭后输入框保持焦点，无需改动；工作目录 popover 关闭后焦点落在 `<body>`，没有残留提示，若要让光标也回到输入框需要单独接线，未纳入本次修复；附件按钮按 #33 的既有设计主动 blur 触发器。
- 未删除 Tooltip（提示是模型按钮唯一的用途说明），接线测试同时锁定这一点。
