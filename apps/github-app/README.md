# Selection 的 GitHub App 服务

桌面端通过 GitHub 设备授权确认使用者身份。创建、评论和关闭 Issue 时，服务先核验用户令牌属于当前 App，并检查用户在目标仓库至少有 triage 权限。随后服务为该仓库单独签发具有 Issues 写权限的安装令牌，以 App 机器人身份执行一次操作。

## 用户授权仓库

SeLection 内置官方 GitHub App `selection-agent[bot]`。在「设置 → 外部连接 → GitHub」点击「授权 GitHub 仓库」，在 GitHub 确认账户并输入设备码。首次安装时选择要授权的仓库，已有安装可通过「管理仓库授权」调整范围。设置会显示实际授权账户。组织要求审批时，由组织管理员批准。

## 发布者配置

官方 App 启用 Device flow，允许其他账户安装，并申请 Issues、Contents 和 Pull requests 读写、Metadata 只读。签名服务由 SeLection 维护者部署一次：

1. 在服务的密钥管理器配置官方 App 的 `GITHUB_APP_CLIENT_SECRET` 和 `GITHUB_APP_PRIVATE_KEY`。
2. 在安装了 Git 和项目 Bun 依赖的服务运行 `bun apps/github-app/server.ts`。可用 `PORT` 设置监听端口，默认 3000。生产使用 HTTPS，并关闭请求正文和 Authorization 头日志。
3. 将签名服务的公开 HTTPS 源地址设置为仓库 Actions 变量 `SELECTION_GITHUB_RELEASE_ORIGIN`。桌面打包流程将该地址写入客户端。该变量仅含公开地址，App 私钥和 Client Secret 仅存放于服务端。本机开发或独立宿主可用 `SELECTION_GITHUB_APP_URL`，HTTP 仅限回环地址。已内置的服务地址优先。

容器部署可在安装了仓库锁定依赖的工作区运行 `bash apps/github-app/build-image.sh -t selection-github-signer`。该命令将服务和依赖打包，再构建包含 Git 的非 root 镜像。运行时通过平台的密钥管理器注入上述两个密钥，提供可写的临时目录，并将 HTTPS 流量转发到 `PORT`。上线后核对公开 `GET /info` 返回的 `slug` 和 `clientId` 与官方 App 一致，再设置发布变量并构建桌面安装包。

授权保存在 Selection 宿主的加密凭据存储中。有效期内自动续期。设置中的「断开」清除该宿主的连接；GitHub 的安装和仓库访问范围在 GitHub 中管理。共享宿主的连接面向该宿主的受信任使用者。请为不同信任边界使用独立宿主。

维护者可在测试仓库创建、评论、关闭同一条 Issue，并在时间线核实三项操作的身份均为 `<app-slug>[bot]`。断开后再次请求创建 Issue，应收到连接提示。

已有安装需要由仓库管理员在 GitHub 接受新增权限。创建 PR 仅申请目标仓库的 Pull requests 写权限；提交和推送校验用户对仓库的写权限，并申请单仓库 Contents 写权限。

在目标项目里暂存文件后，可以要求 Selection 提交改动。作者和提交者使用 GitHub 返回的 App 机器人身份。明确要求推送时，Selection 将当前分支相对基准提交的增量 Git bundle 发送给服务，单次上限为 12 MiB。服务在临时仓库中校验提交历史，并在远端分支仍为预期版本时发布。新分支默认以仓库默认分支为基准，也可指定已有分支。创建 PR 时指定同仓库内已经推送的源分支和目标分支。仓库的分支保护和签名要求适用。
