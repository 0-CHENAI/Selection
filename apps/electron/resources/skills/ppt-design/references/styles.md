# 三套风格与真实字体

在选择风格时只读本页概览及所选条目；机器值在 [styles/catalog.json](../styles/catalog.json)，不要求一次加载所有条目。颜色值无 `#`，字号为 pt。风格同时决定配色、字体角色和整页构图；不能把各套漂亮部分拼成第四套，也不能只换色。

## 选择概览

| ID | 适合 | 识别特征 |
|---|---|---|
| `business` | 商务汇报、方案、决策材料 | 海军蓝满版分隔页、内容页标题色带、等分证据卡片、侧栏读数 |
| `dark-tech` | 技术说明、产品系统、深色舞台展示 | 深色场、同心环、角括号、节点脊线、不对称模块 |
| `fresh-editorial` | 研究解读、内容策划、杂志式叙事 | 陶土/森林出血色块、衬线标题、超大序号、竖向阅读 |

这不是场景强绑定；以用户目标与内容密度为准。同一 layout 名称在三套里表示同一种信息关系，几何各自设计。画布仍是 33.8667 × 19.05 cm。内容标题至少 32 pt，封面和数字用 hero/number，正文 18 pt，来源 12 pt。不要在规格 JSON 里写坐标。

## business

背景 `FFFFFF`；surface `F3F6FA`；正文/满版 `0E2744`；次要文字 `5C6F82`；accent `1D6FB8`；secondary `8FB4D4`；rule `D3DDE6`；inverse `FFFFFF`；满版上次要字 `D6E4F2`。封面左侧满版，章节和结尾整页色场，内容页用海军蓝标题带。图表无网格、无数值轴，直接标数据。

| 平台 | Latin 标题 / 正文 | CJK 标题 / 正文 |
|---|---|---|
| Windows | Aptos Display / Aptos | Microsoft YaHei / Microsoft YaHei |
| macOS | Helvetica Neue / Helvetica Neue | PingFang SC / PingFang SC |
| Linux | Noto Sans / Noto Sans | Noto Sans CJK SC / Noto Sans CJK SC |

实际渲染角色：title 32、hero 40、body 18、heading 22、number 64、label 16、footer 12、quote 28。章节大号可以更大。不要把未使用的 metadata token 当成另一套字号。

## dark-tech

背景 `07111A`；surface `122033`；正文 `F4F8FC`；次要文字 `B7C6D6`；accent `3EE0C7`；secondary `7AA2FF`；rule `2C4158`；inverse `07111A`；mist `9FB4C8`。封面用同心环和底部信息条，章节用强调轨加圆角面板，KPI 用轨道环，时间线脊线在右侧。强调色只标节点和读数。

| 平台 | Latin 标题 / 正文 | CJK 标题 / 正文 |
|---|---|---|
| Windows | Bahnschrift / Aptos | Microsoft YaHei / Microsoft YaHei |
| macOS | Menlo / Helvetica Neue | PingFang SC / PingFang SC |
| Linux | DejaVu Sans Mono / Noto Sans | Noto Sans CJK SC / Noto Sans CJK SC |

实际渲染角色：title 32、hero 44、body 18、heading 22、number 72、label 16、footer 12、quote 28。等宽 Latin 标题不意味着用等宽西文字体覆盖中文。

## fresh-editorial

背景 `F7F3EA`；surface `EFE6D6`；正文 `1A1916`；次要文字 `5C564C`；accent `C2452D`；secondary `1B4336`；rule `D9D0C0`；inverse `FFFCF7`；mist `F6E7D4`。封面右侧陶土出血，章节为森林满版加大号裁切，对比页左右各半出血，流程竖排。标题衬线且非粗体。没有照片时用色块出血。

| 平台 | Latin 标题 / 正文 | CJK 标题 / 正文 |
|---|---|---|
| Windows | Georgia / Aptos | SimSun / Microsoft YaHei |
| macOS | Georgia / Helvetica Neue | Songti SC / PingFang SC |
| Linux | Noto Serif / Noto Sans | Noto Serif CJK SC / Noto Sans CJK SC |

实际渲染角色：title 34、hero 42、body 18、heading 22、number 68、label 16、footer 12、quote 30。个别大号可以更大。标题衬线与正文无衬线是设计身份；不要为了统一 CJK 参数抹掉这个差异。

## 字体解析与跨平台边界

上表是候选名，不保证机器已经安装。锁定前检查实际渲染环境的字体清单；用系统可用的字体检查能力，不能只看某个路径存在或假设 macOS/Windows 都有最新 Office 字体。把最终选用的真实字族分别记入设计锁；运行结果的实际字体应与锁一致。

- Windows：Aptos/Aptos Display 或 Bahnschrift 不存在时不能静默接受渲染器代选；先选已安装的同角色替代并更新锁。CJK 以 Microsoft YaHei 为默认候选，缺失时可选已安装 DengXian 等完整 CJK 字族；编辑式标题需要保留衬线角色，不把所有字体改成微软雅黑。
- macOS：用真实可用的 Helvetica Neue、PingFang SC；编辑式中文标题用 Songti SC。不能把一个 CSS fallback 列表当作 OfficeCLI 已设置多字族的证据。
- Linux：默认无衬线是 Noto Sans CJK SC；编辑式中文标题 Noto Serif CJK SC、正文 Noto Sans CJK SC，Latin 标题 Noto Serif。未安装时先明确缺失和可用替代，不能把缺字方块视为通过。
- `--font-cjk` 是显式覆盖，使用时必须了解其角色影响并记入锁；默认可满足时不要用它统一覆盖所有 CJK 角色。字体替换改变字宽，须重新做适配与 G4。
- 通过当前 `officecli help` 支持的 theme/font 属性及实际文本角色设置 CJK 字体；不要把未验证的属性拼写、字体栈或字体嵌入开关写进命令。
- 本机画面正确不证明接收者安装相同字体或 PPTX 已嵌入字体。交付时如实说明依赖，不宣称跨平台像素一致。

字号 floor、中文标点压缩能力边界、断行与孤字检查见 [typography.md](typography.md)，在字体和内容锁定阶段按需读取。
配方按平台 catalog 选名，**不探测安装情况或自动解析 fallback**。Windows 的 Latin 替代可显式选已安装 Arial（商务/科技标题及正文），编辑风保留 Georgia 标题；macOS Latin 缺失时可显式选 Arial，编辑风仍保留已安装 Georgia。任何替换都需记录实际值，并在生成前对相应 catalog/受控字体配置作明确调整；JSON 没有 Latin 字体覆盖字段，不可声称脚本自动检测并完成了替换。`--font-cjk` 同时覆盖 CJK 标题和正文，编辑风通常应省略该参数以保留衬线/无衬线区分。
