# 来源与适配

此技能的正文来自 [AIScientists-Dev/academic-humanizer](https://github.com/AIScientists-Dev/academic-humanizer) v0.3.3。上游仓库没有与该版本对应的 git tag。获取的 `main` 提交是 `94b88b23703bed7df507acae7d6d5876209a0cdf`（2026-07-03），当时 `SKILL.md` frontmatter 的 `version` 为 `0.3.3`。同目录 `LICENSE` 是上游 MIT 许可证原文，含对 blader/humanizer 与 ARMS 的署名前言。

Selection 适配：

- frontmatter 只保留 `name` 与 `description`。描述限定英文论文、学位论文、审稿回复和 NSF/NIH 等基金申请，不用于博客、营销、文档、回复、PR 说明、中文正文、普通问答、代码、逐字引用、逐字翻译或纯排版。Word 学术版式仍由 `officecli` 的 academic-paper 指南负责。
- 破折号：上游要求删除全部 em dash。这里改成与 `natural-writing`（Humanizer-zh）和 `humanizer` 一致的做法：按作者样本的使用频率保留；破折号承担插入、转折或修正含义时也保留；不要替作者新增破折号。代码、引用和数字范围里的破折号不动。六层结构（含 claim-evidence 与 funding-proposal mode）和上游的返回格式未改。
- 未收录上游 `examples/before-after.md`。技能目录只把 `SKILL.md` 的名称和描述放进每轮上下文；显式选择时也只注入 `SKILL.md`。旁边的示例文件不会自动进入上下文，而上游正文没有引用该文件，因此不另加读取步骤。

本文件和 `LICENSE` 只用于来源追溯，不要加载到模型上下文。
