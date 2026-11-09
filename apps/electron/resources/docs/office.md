# Office 使用说明

Selection 3.2 的 Office 模式用 OfficeCLI 和 TypeScript 做 PPT、Word 和 Excel。安装包里没有 LibreOffice、Python 或 PPTD。

## 进入 Office 模式

首页输入框上方切到 Office，再选 PPT、Word 或 Excel。这个开关和 NORM / PRO 分开，同一会话里可以来回切。

点一张模板或案例卡片，会把它附到输入框；再点一次取消。预览在 Office 协同面板里只读打开，原件不会被改动。

## Word

- 案例：会议纪要、咖啡市场调研、公司研报、公文通知，以及合同、简历、请示等个人办公类。
- 模型先调用 `office_template` 复制案例，拿到可编辑段落，再用 `office_template_write` 按段落替换或追加，生成新文件。原件 sha256 不变。
- 交付前有七项版式核对：字体、样式与主题、页面几何、边框、段落样式、可编辑版头等。没通过就退回模型改，不会标成就绪。
- 公文按 GB/T 9704 的版式写。缺的文号、日期、联系人写成「待补充」，不编造。
- 会议纪要的结构校验用 `office_business`（validate-minutes）。

## Excel

- 案例：年度经营、港口货运、荧光酶筛选，以及报价、预算、对账、项目计划、目标考核。
- 模型在工作区副本上改输入格，交付前必须调用 `xlsx_recalculate`。OfficeCLI 把公式结果写回缓存。装了 Excel 的 Windows / macOS 上再跑一次 CalculateFull。有 `checks.json` 的案例逐项核对，其他的双读关键单元格。没重算或核对不一致不能交付。
- 数据体检、SaaS 指标、Quick Ratio、单位经济和信息图用 `office_business`。数据体检可以直接给 .xlsx，并指定工作表和区域。
- 预览里的浮动图表按工作簿锚点放置。HTML 的列宽比 Excel 略窄，很宽的图可能压住右边的表，以 Excel 打开为准。

## PPT

- 十六套随包风格模板和若干完整示例，可以上传自己的模板，也可以中途追加图片和文件。
- 外来 PPTX 先读结构摘要，再导入成可编辑的 deck.json。动画、SmartArt、OLE、EMF 保留原样并给出诊断，不转成可编辑对象。
- 导出前有预检：孤字、对比度、遮挡、图表数据、图片裁切、缺素材等。error 级问题不改完就不会标成就绪。
- 生成后用 `office_render` 读页图再改，同一文件最多三轮。全程不用 OCR。
- 配图：Selection 不生成图片。用户附了图片，就选有图片位的页面，图片保持原比例完整放进去，不裁切、不拉伸，多出的地方留白；没附图片，就只用没有图片位的页面，成稿里不留空框。

## 已知限制

- 用户路径上还没有 PDF 导出。
- 原生图表缓存没有跟 Excel 的 CalculateFull 逐项核对过。
- 部分随包 PPT 风格模板原样会被预检判成 needs_revision，需要先改一轮再导出。
