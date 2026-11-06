# 写入 Word

## 工具

套用 `government-notice` 时用 `office_template` / `office_template_write`，不要先加载 OfficeCLI。无案例、守卫失败需要改结构、或用户要求从零重做时：

1. 阅读 [OfficeCLI 路由](../../../officecli/SKILL.md)。
2. 读取 OfficeCLI 路由中的精简 Word 指南。
3. 不安装、不调用 python-docx，不使用 Python，不使用 LibreOffice Kit。

## 原件

`cases/government-notice/example.docx` 是用户提供的样例，含嵌入字体，只作版式参照。sha256 必须保持清单中的值。任何填写都发生在工作区副本上。

套用这份案例时：

- 版头文字改成当前任务的发文机关名称，颜色保持红色。
- 标题换成当前事由和文种。
- 示例里已经标成「待补充」的项，在新稿中继续留空，除非用户这次提供了对应事实。
- 不把示例通知的机关名称、活动专题和正文句子写入新稿。

## 写入方式

先调用 `office_template(template_id="government-notice")`，拿到 `editable_paragraphs`。再用 `office_template_write` 写出新的 DOCX：

- replacements 按段落 ID 替换文字，版头发文机关必须在其中。
- additions 用 `style_from` 让新段落继承原样式。
- removals 只删 `can_remove=true` 的段落；版头、红线、绘图、分节和表格单元格受保护，宿主会拒绝。
- 宿主写出时跑 7 项版式守卫，交付前再跑一次。未通过不写文件、不能完成，按返回的诊断修正后重写。

页边距目标见 [05-layout.md](05-layout.md)。若 OfficeCLI 改动了节属性，读回 top/right/bottom/left，对照 2098/1474/1984/1587 twip。

## 看页面

`office_template_write` 成功且版式守卫通过后，不要默认 `office_render` / screenshot。仅当用户要求检查排版，或宿主返回 needs_revision 之后，再用 `office_render` 看首页版头和末页版记，原生读图，最多三轮。禁止 OCR。宿主暂时没有页图时，结论写「视觉检查未做」，不要写成通过。预览以产品内置 Office 预览为准，不要把 `view screenshot` 当交付前置。PDF 按已定的原生优先顺序；这一步没接上时说明边界，不假装已经导出。

成品路径使用用户指定的位置；用户没指定时放在当前工作目录。中间文件放进会话的 `dataFolderPath`。由 Selection 的文件卡片呈现 DOCX。
