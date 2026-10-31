---
name: gov-doc-writing
description: 按机关、文种和现有材料起草通知、请示、报告、函、纪要等公文，核对 GB/T 9704 版式要素，缺失事实标为待补充，并用 OfficeCLI 交付可编辑 Word。
---

# 公文写作

能力参照 dsh-desktop gov-doc-writing，未复用其内容。

本技能由 Selection 自写，覆盖文种识别、GB/T 9704-2012 版式、行文关系和用语、结构骨架、交付前自检。正文、分册、例句和版式数字都按公开的公文处理规则重新编写，不搬入无许可证的技能原文、模板或范文。

## 先遵守的边界

- 事实只来自用户材料和用户点名的附件。文号、主送、成文日期、签发人、印章、电话、数据没有出处时，写成「待补充：需要的内容」，不补造。
- 一次主送事项只办一件事。请示不夹报告，报告不夹请示。
- 文种由行文目的决定，不靠标题里的习惯叫法。拿不准时先问用途：要对方办理、批准、知晓，还是只留会议记录。
- 涉密材料和证件号、手机号、家庭住址不写入可外发的稿。用户贴出这类内容时，先指出风险，再改成可公开的范围说明。
- 本技能给出的是通用机关和企事业单位写法，不为单个行业预置政策口径。行业数字和文件依据由使用单位提供。

## 何时读哪一册

分册放在本目录 `volumes/`。先读本页，再按需要打开一册，不要一次读完全部。

| 何时 | 文件 |
| --- | --- |
| 动笔前，核对文种、材料和缺口 | [01-before-writing.md](volumes/01-before-writing.md) |
| 确定能不能这样行文、请示和报告如何分开 | [02-rules.md](volumes/02-rules.md) |
| 已经选定文种，要列提纲 | [03-structures.md](volumes/03-structures.md) |
| 需要上行、下行或平行的说法 | [04-wording.md](volumes/04-wording.md) |
| 要排版头、主体、版记、字体和页边距 | [05-layout.md](volumes/05-layout.md) |
| 写入 Word 并做交付前检查 | [06-delivery.md](volumes/06-delivery.md) |
| 成稿复核，决定能不能交 | [07-review.md](volumes/07-review.md) |

案例 `government-notice` 只提供版式参照。做另一单位的通知时，版头改成当前机关名称，原文里的「待补充」继续保留，不把示例机关和示例专题抄进新稿。

## Selection 文件交付

用 OfficeCLI 写 DOCX，步骤见第 6 册。不使用 python-docx，不调用 Python，不调用 LibreOffice Kit。案例原件只读。Word 用 `office_template` 拿到段落 ID，再用 `office_template_write` 写出新的 DOCX；版头发文机关必须替换，受保护段落（版头、红线、绘图、分节、表格单元格）不能删除。宿主在写出和交付前自动跑版式守卫。PDF 与逐页渲染等 #705 选定路径，未选定前不依赖它们，也不用 OCR。
