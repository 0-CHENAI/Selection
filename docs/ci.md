# Selection CI 布局

这份说明对应 `.github/workflows` 和 `.github/actions/setup-selection-ci`。目标：PR 门禁少等稀缺 macOS runner，失败信息能分清「机器/排队」和「产品断言」。

## 每次 PR 都会跑（合并门禁）

| 检查名 | 工作流 | Runner | 做什么 |
| --- | --- | --- | --- |
| `validation-checks` | Validate | `ubuntu-latest` | 文件名、OfficeCLI 资源/策略、Linux bubblewrap 隔离、typecheck、renderer 冷启动、共享/Pi/文档工具测试、lint、i18n |
| `tracked-tests` | Validate | `ubuntu-latest` | `scripts/run-tracked-tests.sh`（每个文件单独进程；CI 下最多 4 个进程并行，`.isolated.ts` 仍串行） |
| `validate` | Validate | `ubuntu-latest` | 聚合上面两个 job。失败文案会标明 Infra（取消/跳过）还是 Product（job 已开始后失败） |
| `artifact-windows` | Validate | `windows-2025` | Windows 产物投递相关单测 |

`packages/ui`、Electron renderer、typecheck、lint、tracked tests 都在这条 Linux/Windows 门禁上。改 UI 仍然会跑 `validation-checks` / `tracked-tests`。

同一 PR 分支的新 push 会取消进行中的 Validate / OfficeCLI / 路径过滤工作流，避免把分钟数耗在过期 commit 上。推到 `test` / `main` 的 Validate **不会**被取消。

tracked tests 不能把很多文件丢进同一个 `bun test` 进程。Electron 的 `mock.module`、模块加载时读的 `CRAFT_CONFIG_DIR`、以及 i18n 单例都会串台。CI 用多个进程并行，每个文件仍是单独进程。

## 路径过滤（只有相关 diff 才跑）

| 检查名 | 何时跑 | Runner |
| --- | --- | --- |
| `officecli (windows-x64)` | OfficeCLI 运行时、技能、包装脚本、相关 shared/agent/skills、session-tools-core 等 | `windows-2025` |
| `conductor-recovery (*)` | 任务 / kanban / pi-agent-server 恢复路径 | `ubuntu-latest` + `windows-2025` |
| `skill-install (*)` | skills / agent / session-tools / session-mcp-server | `ubuntu-latest` + `windows-2025` |

OfficeCLI 的路径过滤**不再**包含整棵 `packages/ui/src/**`、`packages/core/**`、`packages/server-core/src/**`。聊天 UI 或权限徽章这类 diff（例如 #787–#790）不应再排队 `officecli (macos-arm64)`。

改 `packages/ui` 仍走 Validate。改 OfficeCLI 资源、包装脚本或 `packages/shared/src/utils/officecli.ts` 仍走 Windows OfficeCLI 集成。

## 定时 / 手动（不挡 PR）

| 检查名 | 何时跑 | Runner | 说明 |
| --- | --- | --- | --- |
| `officecli (macos-arm64)` | 每天 04:41 UTC，或手动 | `macos-15` | 打包运行时的 Darwin 集成。PR 上不再申请这台机器 |
| `macos-native-validation` | 每天 02:17 UTC，或手动 | `macos-15` | `sandbox-exec` 隔离 + 带 Darwin-only 用例的 tracked tests |
| Package Desktop Installers | 推到 `test` / `main`，或手动 | `macos-15` + `windows-2025` | 出安装包，不是 PR 门禁 |
| Validate Server | 仅手动 | ubuntu / macos / windows | 需要已有密钥，不在 PR 上跑 |
| OfficeCLI Upgrade Draft | 每天 03:23 UTC，或手动 | `ubuntu-latest` | 开升级 draft PR；权限保持 `contents` / `pull-requests` / `actions` write |

## 取舍（请读）

以前 PR 门禁跑在 `xcode-27`（macOS 27 Apple Silicon）上，是为了原生隔离（`sandbox-exec`）。近期 PR 上这些 job 经常排队约 15 分钟后以 0 个 step 被取消，Windows 同 PR 却是绿的。这不是产品代码红。

现在的替换：

- Linux 安装 bubblewrap，并优先只给 `/usr/bin/bwrap` 加 AppArmor userns 例外；探测失败才在这台一次性 runner 上关掉 `apparmor_restrict_unprivileged_userns`。
- `createIsolatedShell` 在 Linux 上走 bwrap，在 macOS 上走 sandbox-exec。Darwin 专属用例本身就有 `test.skipIf(process.platform !== 'darwin')`。
- 因此 PR 不再证明「macOS 27 + sandbox-exec」这一条。这条改由 nightly `macos-native-validation` 覆盖。

OfficeCLI 的 Linux 二进制命令契约**没有**加进 PR 门禁（`sync-officecli.ts --check` 在 Linux 上不带 `--download-runtime`）。平台二进制仍由 Windows 集成和 nightly macOS 验证，避免第一次把 linux-x64 schema 变成全员红灯。

## 分支保护（本 PR 改不了，需要仓库设置）

`test` 上建议保持 **required**：

1. `validate` — 主聚合，必须留
2. `validation-checks` — 如果已经勾了就留；和 `validate` 重复但名字没变
3. `tracked-tests` — 同上
4. `artifact-windows` — 如果已经勾了就留，这是 Windows 产物覆盖

建议 **不要** 再 required：

- `officecli (macos-arm64)` — PR 上不再出现；勾了会让无关 PR 卡在缺失检查上
- `macos-native-validation`
- `Package macOS ARM64` / `Package Windows x64` / `Publish desktop release`
- `conductor-recovery (*)`、`skill-install (*)`（路径过滤；勾了会让无关 PR 卡住）

`officecli (windows-x64)` 不要设成 required，除非你们接受「没改 OfficeCLI 路径时这条检查根本不会出现」。路径过滤的 required check 会把无关 PR 卡成一直 pending。

## 本地改工作流时

无法在本机完整模拟 GitHub runner 排队和 macOS 容量。改 YAML 后至少：

```bash
actionlint .github/workflows
bash -n scripts/run-tracked-tests.sh
```

`uv` 缓存保持关闭：仓库里曾经把它当成无效缓存拿掉，这里没有重新打开。
