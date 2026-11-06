# Selection Excel 快速制作与定点修改

使用捆绑 OfficeCLI；本指南替代完整 `officecli load_skill excel` 的制作/QA 流程。已加载就复用，只为不熟悉的操作查 `officecli help xlsx <command>`。不逐项探测已知语法，不默认加载财务/仪表盘全套指南。

## 默认流程

1. 新建时一次确定输入、公式、格式和必要图表；已有文件先读取工作表和目标区域，在工作区副本上修改，保留无关单元格、公式、样式、图表与 VBA。局部文字或数值修改不要重建工作簿。
2. 把相关 set/add 合为一个 batch；create（仅新建）→ open → batch → close。源数据多时批量导入/写入，不逐格调用工具。batch 和脚本放 dataFolderPath，成品按用户指定路径交付。
3. 完成全部修改（包括格式）并保存后，做一次 `validate`。含公式的 `.xlsx` 调用 `xlsx_recalculate`，默认 `visual_review: "not-needed"`。案例有 checks.json 时由宿主核对；没有时必须传 `key_cells`，填写关键公式单元格，例如 `["Sheet1!B3"]`。工具不接受预期值参数；已知业务预期在返回结果中核对。复用本次返回的检查，不再全表回读。
4. 无公式的静态表格只需回读修改区域，不调用重算工具。含公式工作簿的交付记录绑定完整文件哈希：重算后任何修改都会使记录失效，纯格式修改也不例外。因此先完成所有编辑，再重算一次；只有文件未再变化且已有成功记录时才能复用。
5. 发现具体错误才修复，并只复查受影响范围；未解决的错误明确说明，不能声称全部正确。

## 常用语法

路径如 `/Sheet1/A1`，列路径 `/Sheet1/col[A]`。batch 是 JSON 数组，单元格字体用完整属性名，不能把 `color` 当作字体色：

```json
[
  {"command":"set","path":"/Sheet1/A1","props":{"value":"项目","font.bold":true}},
  {"command":"set","path":"/Sheet1/B1","props":{"value":"金额","font.bold":true}},
  {"command":"set","path":"/Sheet1/A2","props":{"value":"收入"}},
  {"command":"set","path":"/Sheet1/B2","props":{"value":100,"numFmt":"0.00"}},
  {"command":"set","path":"/Sheet1/B3","props":{"formula":"SUM(B2:B2)","numFmt":"0.00"}},
  {"command":"set","path":"/Sheet1/col[A]","props":{"width":18}},
  {"command":"set","path":"/Sheet1/col[B]","props":{"width":14}}
]
```

执行：`officecli batch "$FILE" --input "$BATCH" --json`。回读：`officecli get "$FILE" /Sheet1/B3 --json`。公式使用 JSON 文件，避免 shell 展开 `$`/`!`；金额/日期/百分比设置对应 numFmt。图表、跨表范围、数据验证按需查 help。

无 checks.json 的 `.xlsx` 重算请求示例（工具 `xlsx_recalculate`，不是 Bash 命令）：

```json
{"path":"sample.xlsx","key_cells":["Sheet1!B3"],"visual_review":"not-needed"}
```

## 校验边界

- **不要默认截图、contact-sheet、office_render、图片缩放或 call_llm 视觉复审。** 列宽、格式、表头和冻结行在生成时设置；用户使用内置预览，不等于代理必须渲染。
- 只有用户要求视觉验收或存在具体显示问题时，检查受影响区域；修复后只复查该处。不得把 `visual_review: "reviewed"` 用在未看过的图上。
- `xlsx_recalculate` 目前只接受 `.xlsx`，不能传 `.xlsm`，也不能改扩展名绕过。XLSM 用 OfficeCLI 原格式定点编辑并保留宏部件；涉及公式时必须用支持原格式的计算能力验证，当前环境不能验证则明确未完成公式验收，不能声称已重算。
- 保留公式错误检测、关键业务结果核对和 XLSM 原有宏部件完整性检查；不能用减负为由跳过计算正确性。不要为“再确认一次”反复全表读取或调用第二个模型复核。
- 不默认运行 `view issues` 扫描并清空样式建议。非零退出、UNSUPPORTED、输出缺失、公式/结果不符必须处理；失败可能已写入部分内容，先读取相关范围再修复，不盲目重放。
- 财务模型、仪表盘等专门指南只在任务需要时加载，使用业务定义与语法；其通用视觉交付门、重复 QA 循环不覆盖本指南。不自行改用 openpyxl 或其他引擎。

默认重算使用无界面引擎，不打开本机 Excel，不运行 AppleScript/COM，也不要为自动化请求文件访问授权。不支持的公式按工具诊断处理，不用旧缓存冒充成功。
