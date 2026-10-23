# 从故事线到可交付 PPTX

此流程只适用于新建或整套重设计。既有文件局部编辑保留原设计，遵循 [Selection 覆盖规则](../../officecli/ppt-selection-override.md)。所有会话材料使用 `<session_state>` 的绝对 `dataFolderPath`。

## 1. 形成一个完整故事

先读用户材料，不用参考页示例填补事实。记录受众、场景、目标、核心结论、篇幅、语言、品牌和交付位置。区分事实、估算、假设、建议。

在 scratch 的 `design-plan.md` 写：

- 简报：这套演示要让谁理解什么、作何决定。
- 故事线：结论 → 证据 → 权衡 → 下一步。
- 逐页表：稳定页 ID、顺序、唯一主张、可见内容、来源、备注、layout、节奏角色（`anchor` / `dense` / `breathing`）。

相邻页不同 layout。选择 [布局](layouts.md) 的理由是关系，不是“这个模板好看”。

## 2. 锁定风格并读取参考几何

锁定 `swiss-signal` 或 `navy-brief`。先读该套 `design.md`，再读对应参考页 JSON（元素 id、bounds、textCapacity）。把用户内容填进参考几何；超容量则拆页或换 layout，不缩小字号。

在 `spec-lock.md` 记录受众、风格、实际字体、页序映射、deck/PPTX 路径、G4 次数。

把完整 deck 写成 `dataFolderPath/deck.json`，遵守 [规格契约](spec-schema.md)。

## 3. 预检 → 渲染 → 自查

```text
"<absolute-CRAFT_BUN>" "<skill>/scripts/deck.js" check --deck "<dataFolderPath>/deck.json"
"<absolute-CRAFT_BUN>" "<skill>/scripts/deck.js" render --deck "<dataFolderPath>/deck.json" --out "<dataFolderPath>/deck.pptx" --folder "<dataFolderPath>" --preview-dir "<dataFolderPath>/preview"
```

check 失败必须先改 deck。render 失败且 `needs_revision` 时不要交付。输出必须在 `dataFolderPath` 内，不覆盖已有文件；再次生成用 `deck-repair-1.pptx`。

已有 PPTX 的局部修改仍走 OfficeCLI，并设置 `OFFICECLI_SKIP_UPDATE=1`。

## 4. G1–G5

- **G1**：outline/页序与计划一致。
- **G2**：`deck_check` 全绿；一套风格；正文不低于该套 floor。
- **G3**：打开 PPTX，核对文字、图表数值、备注、来源。可用 `officecli validate` 与 `view text`。
- **G4**：逐页看 preview PNG 或 `officecli view screenshot`。整项任务最多三次。
- **G5**：最终路径存在并再读一次。

## 5. 交付

将已审查 PPTX 复制到用户指定路径（未指定则有效工作目录），不默默覆盖。只交付 PPTX。
