# 来源与适配

此技能参考并精简改写了 [blader/humanizer](https://github.com/blader/humanizer)，调研版本 commit `9862685f575c65a8247f90369951df1b3416e3d6`（2026-09-21 获取）。上游 MIT 许可证保留在同目录 LICENSE。

Selection 适配：面向中文文档正文，默认轻改，保留专业文体和证据；不加载完整模式库、不做多稿输出或检测评分、不添加作者扮演流程。调研也参考了 [humanizer-chinese](https://github.com/jiji262/humanizer-chinese)、[humanizer-zh](https://github.com/ai-zixun/humanizer-zh) 和 [社区使用反馈](https://www.reddit.com/r/claudeskills/comments/1v8wa5r/whats_the_best_humanizer_skill_out_there/)，未复制其技能或运行脚本。

运行时由现有技能目录根据任务语义选取，只读取 SKILL.md；不做关键词硬匹配或额外模型分类调用。本文件与 LICENSE 用于来源追溯，不需要加载到模型上下文。开源热度和社区评价不是写作效果的基准测试，效果仍受模型、材料与文体影响。
