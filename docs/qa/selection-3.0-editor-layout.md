# #321 编排编辑器布局验收

编辑器现在按所在面板的宽度响应：宽面板提供定义/对话与节点两栏，各自滚动；窄面板依次展示全部定义和节点，顶部导航、视图标签及主操作始终可见。AI 对话随标签切换保留，应用提案仍不保存或运行。

子界面的返回/取消位于固定底部，按返回、取消、其他操作顺序从左到右排列，整体右对齐。模板保存、v3 迁移确认、运行修订确认只滚动内容区。未保存确认也保留可见底部操作和焦点返回。图和 YAML 沿用相同外观；图使用应用颜色，并在面板尺寸变化时重新适配所有节点。

## 真实组件验收

本次浏览器加载实际 `TaskEditor`、`TaskYamlImport`、`TaskTemplateLibrary`、`TaskTemplateSaveDialog`、`ApplyRunRevisionDialog`、`ConfirmationHost` 和 `ConductorWorkbench`，传输为固定验收数据。没有运行模型或真实工作流。

窄窗口前后均使用 375×700、同一输入和容器；前图临时加载 #320 提交中的真实编辑器源，隐藏测试页面侧栏，以准确比较组件。临时旧实现已删除。常规面板截图使用 800×600 预览区域；修正验收容器为 h-full 后，后图没有旧测试容器固定 760px 导致的额外滚动。

| 场景 | 结果 |
| --- | --- |
| 新建空状态、已有三节点 | 主操作、模板入口、定义和节点层级清晰；窄面板无水平溢出 |
| 12 节点与长提示词/目标 | 定义和全部节点可滚动浏览，顶部操作保持可见；0 保存、0 创建、0 运行 |
| 定义/图/YAML 标签切换 | 草稿和对话保留；图/YAML 适配窄面板，图在窗口变化后全部节点仍在视口内 |
| 模板保存 | 375×700 下取消和保存同排可见，位于内容区之外 |
| YAML 导入 | 底部 y=617.25–669；取消后的未保存确认可保留 YAML，继续后返回编辑器 |
| 模板库列表/详情/返回 | 15 项列表滚动前后底部均 y=623–669；详情返回、取消、使用顺序不变，无自动创建 |
| 运行修订长差异 | 30 条新增节点滚动前后底部均 y=568.5–614.5；取消不写定义 |
| v3 迁移确认 | 窄窗口可读，取消不保存；迁移说明已改为本地化的行为说明 |
| 未保存确认 | 取消保留标题和草稿，操作顺序和焦点返回沿用原控制器 |
| 显式保存 / 创建 | 分别只计 1 次，随后按原流程关闭编辑器，运行均为 0 |

模板库验收发现 StrictMode 重挂载后 `mounted` 未恢复，导致已获取列表被丢弃；已修正并用实际列表与详情验收。图的主题直接使用现有 CSS 变量，保持组件可在现有 Bun 渲染测试中使用，无新增主题运行时依赖。

## 前后截图

| 场景 | 优化前 | 优化后 |
| --- | --- | --- |
| 常规编辑器 | [前图](selection-3.0-editor-images/321-before-editor.png) | [后图](selection-3.0-editor-images/321-after-editor.png) |
| 375×700 编辑器 | [前图](selection-3.0-editor-images/321-before-narrow-editor.png) | [后图](selection-3.0-editor-images/321-after-narrow-editor.png) |

另外提供 [模板保存](selection-3.0-editor-images/321-after-narrow-template.png)、[运行修订](selection-3.0-editor-images/321-after-narrow-revision.png)、[模板详情](selection-3.0-editor-images/321-after-narrow-template-detail.png)。导入、长内容、迁移、确认、空状态和窄图/YAML 截图在 `/tmp/selection-version-3.0/321-*.png`，均已目视检查。

## 检查

- 93 tests / 0 failures / 315 assertions：全部 kanban 组件测试与 confirmation 控制器。
- 八包类型检查通过，最后图尺寸适配变更后的 Electron 类型检查通过。
- lint 0 errors，既有 Electron 86 / shared 8 warnings；i18n 2312 keys 一致且排序正确。
- 完整 Electron 构建通过；最终图适配和主题样式再次 renderer 构建通过；diff check 通过。
