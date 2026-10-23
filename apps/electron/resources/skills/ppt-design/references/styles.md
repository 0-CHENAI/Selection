# 三套风格与真实字体

在选择风格时只读本页概览及所选条目；机器值在 [styles/catalog.json](../styles/catalog.json)，不要求一次加载所有条目。颜色值无 `#`，字号为 pt。风格同时决定配色、字体角色与装饰方式；不能把各套漂亮部分拼成第四套。

## 选择概览

| ID | 适合 | 识别特征 |
|---|---|---|
| `business` | 商务汇报、方案、决策材料 | 白底深蓝标题、蓝色重点、浅色矩形面板、顶部带与短线 |
| `dark-tech` | 技术说明、产品系统、深色舞台展示 | 深海军蓝底、青色重点、轮廓模块、左侧轨线与方形节点 |
| `fresh-editorial` | 研究解读、内容策划、清新编辑式叙事 | 暖纸色底、衬线标题、绿正文、陶土色 kicker、开放栏与细线 |

这不是场景强绑定；以用户目标与内容密度为准。相同 layout 在三套里复用语义与固定坐标，装饰由 tokens 控制，不额外发明图标、光晕、照片或渐变配额。

三套共用固定栅格：33.8667 × 19.05 cm；左边距 1.4 cm、右边距 1.6667 cm，正文 y=5.3–16.9 cm（有副标题时从 6.15 cm 开始），页脚 y≥17.65 cm。双栏宽 15 cm、栏沟 0.8 cm；流程模块按 30.8 cm 内容宽等分、间隔 0.55 cm；其他布局使用 catalog 的固定槽位，不逐页重算坐标。风格只改变颜色、字体角色和装饰，不改变安全区。

## business

背景 `FFFFFF`；surface `F0F4F8`；正文 `142D4E`；次要文字 `536477`；accent `1464A5`；secondary `6D91B4`；rule `CBD6E2`；inverse `FFFFFF`。实色编号、浅色矩形面板，不使用阴影/图标/装饰图表。

| 平台 | Latin 标题 / 正文 | CJK 标题 / 正文 |
|---|---|---|
| Windows | Aptos Display / Aptos | Microsoft YaHei / Microsoft YaHei |
| macOS | Helvetica Neue / Helvetica Neue | PingFang SC / PingFang SC |
| Linux | Noto Sans / Noto Sans | Noto Sans CJK SC / Noto Sans CJK SC |

实际渲染角色：title 36、hero 48、body 18、面板 heading 23、number 78、eyebrow 14、source/footer 12；quote 30。不要把未使用的 metadata token 当成实际对象字号。

## dark-tech

背景 `0B1220`；surface `152238`；正文 `F0F6FF`；次要文字 `C1CFE0`；accent `60E6D2`；secondary `93B8FF`；rule `3B506C`；inverse `0B1220`。深色负空间与青色轨线建立秩序；不用文字后光晕、背景网格墙、阴影或装饰图标。

| 平台 | Latin 标题 / 正文 | CJK 标题 / 正文 |
|---|---|---|
| Windows | Bahnschrift / Aptos | Microsoft YaHei / Microsoft YaHei |
| macOS | Menlo / Helvetica Neue | PingFang SC / PingFang SC |
| Linux | DejaVu Sans Mono / Noto Sans | Noto Sans CJK SC / Noto Sans CJK SC |

实际渲染角色：title 36、hero 46、body 18、面板 heading 23、number 76、eyebrow 14、source/footer 12；quote 30。等宽 Latin 标题不意味着用等宽西文字体覆盖中文。

## fresh-editorial

背景 `F7F5EE`；surface `EBF0E7`；正文 `173F35`；次要文字 `50635A`；accent `B44F39`；secondary `5A887B`；rule `C4CCBE`；inverse `FFFFFF`。纸色、衬线标题、拉引文字与绿色细线；开放栏优先，不在所有页塞满填色卡片，不加装饰照片或阴影。

| 平台 | Latin 标题 / 正文 | CJK 标题 / 正文 |
|---|---|---|
| Windows | Georgia / Aptos | SimSun / Microsoft YaHei |
| macOS | Georgia / Helvetica Neue | Songti SC / PingFang SC |
| Linux | Noto Serif / Noto Sans | Noto Serif CJK SC / Noto Sans CJK SC |

实际渲染角色：title 36、hero 49、body 18、面板 heading 23、number 80、eyebrow 14、source/footer 12；quote 30。catalog 的 heading 24 等未使用 metadata 不表示渲染器采用该字号。标题衬线与正文无衬线是设计身份；不要为了统一 CJK 参数抹掉这个差异。

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
