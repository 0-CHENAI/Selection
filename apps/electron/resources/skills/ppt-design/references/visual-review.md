# G4：真实逐页视觉审查

必做。先用 `deck.js preview` 或 OfficeCLI 截图得到每一页画面，再用读图工具打开，不能只看 JSON 或联络表。

```text
"<absolute-CRAFT_BUN>" "<skill>/scripts/deck.js" preview --deck "<dataFolderPath>/deck.json" --out-dir "<dataFolderPath>/preview"
officecli view "<absolute-file.pptx>" screenshot --page 1 -o "<dataFolderPath>/pass-1-slide-01.png"
```

OfficeCLI 调用设置 `OFFICECLI_SKIP_UPDATE=1`。内置截图不可用时，用 preview PNG。两者都不可用则记录 **G4 blocked**，不能把 check 通过写成视觉通过。

## 必须看见

- 一页一个主张；大数字可读；页脚来源和页码对齐且不撞正文。
- 无缺字、孤字、字面 `\n`、重叠、低对比。
- 图表有单位/口径；瀑布能加总；趋势标出异常点。
- 相邻页结构不同；两套风格不能看成换色。
- 示例数据须看得出是示例，或已被用户事实替换。

整项任务最多三次视觉检查。静态 PNG 不证明动画。
