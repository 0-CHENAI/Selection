# 阶段 12 验收记录：图片槽和生图

对应 [#715](https://github.com/0-CHENAI/Selection/issues/715)。合同字段与 dsh `dsh.template-images/v1` 一致，写在 deck.json 的页级 `imageSlots` 或备注 JSON。不移植演示引擎。

## 代码入口

| 能力 | 入口 |
| --- | --- |
| 合同校验 | `engine/schema-v2-draft.ts` 的 `parseImageContract` |
| 建议合同，不改页面 | `engine/image-slots.ts` 的 `proposeImageContract` |
| 样例扩展 | `styles/image-slots.extension.json`。十六套随包 deck 的 sha256 锁在 `shipped-decks.test.ts` |
| 生图 | 会话工具 `image_generate`，实现 `services/ppt-image-generate.ts` |
| 预检 | `image_fit`、`image_crop`、`remote_image`、`missing_asset` |

没有 `image-generation.json` 里的 https 端点时，工具写入 `selection-placeholder-*.png`，预检只给 warning，不给 error。同一 `reuse_group` 复用。一份稿件最多 12 次。`provided-portrait` 和 `native-graphic` 直接拒绝生图。

人物照片只用用户提供的文件。图片内文字要求为 0。看整页用 `office_render`，最多 3 轮，不用 OCR。

## 验收命令

```bash
bun test apps/electron/resources/skills/ppt-design/engine/image-contract.test.ts \
  apps/electron/resources/skills/ppt-design/engine/preflight.test.ts \
  apps/electron/resources/skills/ppt-design/engine/shipped-decks.test.ts \
  packages/server-core/src/services/ppt-image-generate.test.ts
```

| 案例 | 结果 |
| --- | --- |
| 合同 | 合法合同通过。10 种非法合同都返回可读原因。 |
| G1 | 同一 `reuse_group` 第二次调用返回已有路径，不再生成。 |
| G2 | 无提供方时得到占位图，`missing_asset` 为 warning。 |
| G3 | 配图后的读图走 `office_render`，轮次记在 `data/visual-qa.json`。本阶段没有调用外部生图服务，所以没有声称看过真实成稿。 |

## 本阶段明确不做

- 不把图片槽写进十六套随包模板。那些 deck 没有图片元素。
- 不生成带文字的图片，也不做通用图片编辑器。
- 建议合同在 `confirmed: false` 时不写回模板。
