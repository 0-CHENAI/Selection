---
name: officecli
description: "Selection Office 文件入口：按文档类型读取唯一制作流程。Word 模板填写或已有文件定点修改；Excel 计算；PowerPoint 设计。"
---

# Selection Office 路由

只读取本次文档类型的指南；已在上下文中则复用。各类型的检查、修复和交付规则由其指南唯一规定，本入口不追加检查。

| 任务 | 唯一工作流 |
| --- | --- |
| 新建或修改 Word | [Word](guides/word.md) |
| Excel / XLSM | [Excel](guides/excel.md) |
| PowerPoint | [PowerPoint](guides/powerpoint.md) |

用户明确指定工具或提出对照实验时遵循该要求；否则新建 Word 默认模板工具，已有文件修改使用捆绑 OfficeCLI。不要安装或自更新 OfficeCLI，不读取用户目录中同名 Office 技能。

业务技能只补内容要求，不追加制作或 QA 流程。学术引文、表单、金融等专用指南仅在需要相应功能时按需读其语法。

最终文件按用户指定位置交付，否则放用户选择的项目目录；未选择项目目录时放会话根目录的 `outputs/`（按需创建）。最终产物禁止写入 `data/`、`plans/` 或 `long_responses/`；脚本、草稿、检查输出放 `<session_state>` 的精确 dataFolderPath。保留用户原件，不清理已有工作目录。

中文新写正文按需用 natural-writing；英文普通正文用 humanizer；英文学术正文用 academic-humanizer。只转换或原样排版不加载写作技能。
