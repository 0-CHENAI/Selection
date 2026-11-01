/**
 * dsh-desktop 588412b 的用户可见能力行。
 * 对齐只看 Selection 是否提供同样的结果，不要求同一技术栈。
 * excluded 不进分母。partial 记 0.5。
 */

export type ParityDomain = 'ppt' | 'word' | 'excel' | 'shared'
export type ParityStatus = 'aligned' | 'partial' | 'missing' | 'excluded'

export interface ParityItem {
  id: string
  domain: ParityDomain
  capability: string
  status: ParityStatus
  /** dsh 588412b 里的行为来源 */
  dsh: string
  /** Selection 证据，仓库相对路径 */
  evidence: string[]
  /** 证据文件里必须出现的子串。缺省只检查文件存在 */
  needle?: string
  reason?: string
}

export const PARITY_ITEMS: ParityItem[] = [
  {
    id: 'PPT-GALLERY',
    domain: 'ppt',
    capability: '内置模板库、按页预览，并在输入框附上所选模板',
    status: 'aligned',
    dsh: 'ppt-runtime adapter client：模板目录与预览',
    evidence: ['apps/electron/resources/skills/ppt-design/SKILL.md', 'docs/qa/selection-3.2-office-o3.md'],
    needle: '每次最多读 12 页参考',
  },
  {
    id: 'PPT-UNDERSTAND',
    domain: 'ppt',
    capability: '先定受众、结论、材料和页数，再动手改',
    status: 'aligned',
    dsh: 'dsh-ppt/SKILL.md 工作过程',
    evidence: ['apps/electron/resources/skills/ppt-design/references/workflow.md'],
    needle: '受众',
  },
  {
    id: 'PPT-ROUTE',
    domain: 'ppt',
    capability: '定点修改、改版式、整套换风格三条路由，导入与定点冲突时只提醒',
    status: 'aligned',
    dsh: 'dsh-ppt 灵活编辑；Selection 把路由写进宿主',
    evidence: ['packages/shared/src/prompts/ppt-routing.ts', 'packages/server-core/src/services/ppt-route.ts'],
    needle: '路由提醒',
  },
  {
    id: 'PPT-BRIEF',
    domain: 'ppt',
    capability: '外来 PPTX 先读结构摘要再编辑，原件不被覆盖',
    status: 'aligned',
    dsh: '上传后理解再导入',
    evidence: ['docs/qa/selection-3.2-office-o4.md', 'packages/shared/src/prompts/ppt-routing.ts'],
    needle: 'ppt_import',
  },
  {
    id: 'PPT-IMPORT',
    domain: 'ppt',
    capability: 'PPTX 导入为可编辑 deck.json；写不进的对象按原位置保留并诊断',
    status: 'aligned',
    dsh: 'pptx-converter.js 有边界导入',
    evidence: ['apps/electron/resources/skills/ppt-design/engine/import/pptx-to-deck.ts', 'apps/electron/resources/skills/ppt-design/engine/import/pptx-import.test.ts'],
    needle: 'retained',
  },
  {
    id: 'PPT-PERSONAL',
    domain: 'ppt',
    capability: '个人模板登记、预览，并用 ppt_template_create_project 复制成任务工程',
    status: 'aligned',
    dsh: 'personal-templates.js 与 ppt_template_create_project',
    evidence: ['packages/server-core/src/services/ppt-template-project.ts', 'packages/server-core/src/services/ppt-template-project.test.ts'],
    needle: 'createTemplateTaskProject',
  },
  {
    id: 'PPT-IMAGE',
    domain: 'ppt',
    capability: '模板配图槽合同、复用组和无提供方时的占位图；图内不写文字',
    status: 'aligned',
    dsh: 'template-image-contract.js 与 generate-image',
    evidence: ['docs/qa/selection-3.2-office-stage-12.md', 'packages/session-tools-core/src/handlers/ppt-tools.ts'],
    needle: 'reuse_group',
  },
  {
    id: 'PPT-PREFLIGHT',
    domain: 'ppt',
    capability: '预检：连续同版式、封面焦点、图表数据与颜色、图片适配裁切、远程图、缺素材、文字遮挡',
    status: 'aligned',
    dsh: 'validation.js 同名规则',
    evidence: ['apps/electron/resources/skills/ppt-design/engine/preflight.test.ts', 'apps/electron/resources/skills/ppt-design/references/dsh-ppt-parity.md'],
    needle: 'layout_repetition',
  },
  {
    id: 'PPT-GATE',
    domain: 'ppt',
    capability: '预检 error 不把 PPTX 标成就绪；warning 仍可导出',
    status: 'aligned',
    dsh: 'needs_revision 按文件拦截',
    evidence: ['docs/qa/selection-3.2-office-stage-13.md'],
    needle: 'needs_revision',
  },
  {
    id: 'PPT-VISUAL',
    domain: 'ppt',
    capability: '生成后 office_render 读图再改，同一文件最多三轮，禁止 OCR',
    status: 'aligned',
    dsh: '渲染后看页再修',
    evidence: ['packages/session-tools-core/src/handlers/office-render.ts', 'packages/server-core/src/reliability/office-tool-policy.ts'],
    needle: 'Never run OCR',
  },
  {
    id: 'PPT-FONT',
    domain: 'ppt',
    capability: '中西文字体按主题记号回退，不把缺字当成已验收',
    status: 'aligned',
    dsh: 'dsh-ppt 语言和字体',
    evidence: ['apps/electron/resources/skills/ppt-design/references/dsh-ppt-parity.md'],
    needle: '$cjk',
  },
  {
    id: 'PPT-MIDUPLOAD',
    domain: 'ppt',
    capability: 'PPT 会话中途仍可附加图片和文件',
    status: 'aligned',
    dsh: 'PPT 模式允许中途上传',
    evidence: ['apps/electron/resources/release-notes/next.md'],
    needle: 'PPT 中途附件',
  },
  {
    id: 'PPT-ANIM',
    domain: 'ppt',
    capability: '动画、SmartArt、OLE、EMF 解码成可编辑对象',
    status: 'excluded',
    dsh: 'pptx 导入器里的 EMF 解码与对象覆盖',
    evidence: ['docs/plans/pptx-to-deck-mapping.md'],
    needle: '不移植',
    reason: '#707 决定不移植 PPTD。这些对象只诊断并保留不可编辑，Epic 明确不承诺还原。',
  },
  {
    id: 'PPT-ENGINE',
    domain: 'ppt',
    capability: '把 PPTD 引擎或 YAML 工程码搬进安装包',
    status: 'excluded',
    dsh: 'pptd.js 与 YAML 工程',
    evidence: ['docs/qa/selection-3.2-office-stage-13.md'],
    needle: '不把 dsh 的 YAML',
    reason: '#707 / #716：deck.json 的 schema 一次报完语法问题，不另造一套 YAML 码，也不移植演示引擎。',
  },
  {
    id: 'PPT-SYNC',
    domain: 'ppt',
    capability: '个人模板跨设备同步',
    status: 'excluded',
    dsh: '个人模板只在本机目录',
    evidence: ['docs/qa/selection-3.2-office-stage-11.md'],
    needle: '不跨设备同步',
    reason: 'Epic 非目标。模板写在本机用户数据目录。',
  },

  {
    id: 'WORD-CASES',
    domain: 'word',
    capability: '会议纪要、咖啡调研、公司研报、公文通知四个案例可预览并附到输入框',
    status: 'aligned',
    dsh: 'sources/catalog.json 四个 Word 案例',
    evidence: ['apps/electron/resources/skills/office-business/catalog.json', 'apps/electron/src/renderer/components/office/OfficeCaseGallery.tsx'],
    needle: 'meeting-minutes',
  },
  {
    id: 'WORD-PREVIEW',
    domain: 'word',
    capability: '案例样例在 Office 协同面板只读打开，原件 sha256 被改动能恢复',
    status: 'aligned',
    dsh: 'client.js 按页预览',
    evidence: ['packages/server-core/src/services/office-case-preview.ts', 'docs/qa/selection-3.2-office-stage-06.md'],
    needle: 'exampleSha256',
  },
  {
    id: 'WORD-INJECT',
    domain: 'word',
    capability: 'Word 模式按案例 revision 注入指南和业务技能，重复轮次不叠加',
    status: 'aligned',
    dsh: 'modes.js 指纹去重',
    evidence: ['packages/server-core/src/services/office-catalog.ts', 'packages/server-core/src/services/office-catalog.test.ts'],
    needle: 'fingerprint',
  },
  {
    id: 'WORD-TEMPLATE',
    domain: 'word',
    capability: 'office_template 复制案例并返回可编辑段落，不改原件',
    status: 'aligned',
    dsh: 'template-tool.js office_template',
    evidence: ['packages/session-tools-core/src/handlers/office-template.ts', 'packages/server-core/src/services/office-template/service.ts'],
    needle: 'editable_paragraphs',
  },
  {
    id: 'WORD-WRITE',
    domain: 'word',
    capability: 'office_template_write 按段落替换、追加并继承样式，受保护段落不能删',
    status: 'aligned',
    dsh: 'docx-workflow.js replacements / additions / removals',
    evidence: ['packages/session-tools-core/src/handlers/office-template.ts'],
    needle: 'style_from',
  },
  {
    id: 'WORD-GUARD',
    domain: 'word',
    capability: '交付前七项版式核对：字体、样式、页面几何、边框、段落样式、可编辑版头',
    status: 'aligned',
    dsh: 'docx-layout.py validate',
    evidence: ['packages/server-core/src/services/office-template/docx-layout.ts', 'packages/server-core/src/services/office-template/docx-layout.test.ts'],
    needle: 'page-geometry',
  },
  {
    id: 'WORD-STREAM',
    domain: 'word',
    capability: '流式最终答复也走交付守卫，未通过则退回模型',
    status: 'aligned',
    dsh: 'present 前 validate',
    evidence: ['packages/server-core/src/sessions/SessionManager.ts', 'docs/qa/selection-3.2-office-stage-13.md'],
    needle: 'commitDraftAnswer',
  },
  {
    id: 'WORD-MINUTES',
    domain: 'word',
    capability: '会议纪要结构校验与 dsh 脚本同输入同退出码，安装后的会话用 office_business 调用',
    status: 'aligned',
    dsh: 'validate_minutes.py',
    evidence: ['packages/office-business-runtime/src/validate-minutes.ts', 'packages/session-tools-core/src/handlers/office-business.ts'],
    needle: 'validate-minutes',
  },
  {
    id: 'WORD-SKILLS',
    domain: 'word',
    capability: 'meeting-recap、work-report-writer、research-writer 三份业务技能可被注入',
    status: 'aligned',
    dsh: 'business-skills 三份 MIT / Apache 技能',
    evidence: ['packages/shared/src/skills/office-business-skills.ts'],
    needle: 'meeting-recap',
  },
  {
    id: 'WORD-GOV15',
    domain: 'word',
    capability: '十五个法定文种各自的用途、标题、主送、结尾和易错点',
    status: 'aligned',
    dsh: 'gov-doc-writing 结构册法定文种',
    evidence: ['apps/electron/resources/skills/office-business/business-skills/gov-doc-writing/volumes/03-structures.md'],
    needle: '## 纪要',
  },
  {
    id: 'WORD-TXN',
    domain: 'word',
    capability: '讲话稿、述职、方案、简报、通报材料、对照检查的骨架和事实索取清单',
    status: 'aligned',
    dsh: '结构册事务文书与事实索取清单',
    evidence: ['apps/electron/resources/skills/office-business/business-skills/gov-doc-writing/volumes/09-transactions.md'],
    needle: '事实索取',
  },
  {
    id: 'WORD-PARAMS',
    domain: 'word',
    capability: '六个参数（含单位性质和角色）以及「你看着写」时的追问',
    status: 'aligned',
    dsh: 'SKILL.md 第 1–2 步与资产册追问',
    evidence: ['apps/electron/resources/skills/office-business/business-skills/gov-doc-writing/volumes/08-parameters.md', 'apps/electron/resources/skills/office-business/business-skills/gov-doc-writing/SKILL.md'],
    needle: '你看着写',
  },
  {
    id: 'WORD-SIX',
    domain: 'word',
    capability: '六维质检和随单位性质变化的权重，真实性不过不能交付',
    status: 'aligned',
    dsh: '主册六维质量模型',
    evidence: ['apps/electron/resources/skills/office-business/business-skills/gov-doc-writing/volumes/10-quality.md'],
    needle: '权重',
  },
  {
    id: 'WORD-SAFE',
    domain: 'word',
    capability: 'S1–S6 安全红线、脱敏和公开度分级',
    status: 'aligned',
    dsh: '安全保密规则库',
    evidence: ['apps/electron/resources/skills/office-business/business-skills/gov-doc-writing/volumes/11-safety.md'],
    needle: 'S1',
  },
  {
    id: 'WORD-STD',
    domain: 'word',
    capability: 'GB/T 15834 标点和 GB/T 15835 数字的公文操作口径',
    status: 'aligned',
    dsh: '格式册第二、三部分',
    evidence: ['apps/electron/resources/skills/office-business/business-skills/gov-doc-writing/volumes/12-standards.md'],
    needle: 'GB/T 15834',
  },
  {
    id: 'WORD-FIX',
    domain: 'word',
    capability: '病文按真实性、合法性、逻辑、实效、表达、政治和安全改稿',
    status: 'aligned',
    dsh: '素材册病文纠错库',
    evidence: ['apps/electron/resources/skills/office-business/business-skills/gov-doc-writing/volumes/13-corrections.md'],
    needle: '病',
  },
  {
    id: 'WORD-ROUTE',
    domain: 'word',
    capability: '口语能路由到法定文种，也能路由到讲话稿、述职、方案、简报和对照检查',
    status: 'aligned',
    dsh: '文种选用速判',
    evidence: ['packages/shared/src/skills/office-document-routing.ts', 'packages/shared/src/skills/__tests__/office-document-routing.test.ts'],
    needle: '对照检查',
  },
  {
    id: 'WORD-CORPUS',
    domain: 'word',
    capability: '范文样本、金句库、政治口号库和国标原文照录',
    status: 'excluded',
    dsh: 'gov-doc-writing 无 LICENSE 的分册与素材库，约 348KB',
    evidence: ['apps/electron/resources/skills/office-business/NOTICE'],
    needle: '未复用其内容',
    reason: 'LinNai 在 #704 决定公文能力自写、不照搬原文。这些库是无许可正文，不能为了凑字节数复制。',
  },
  {
    id: 'WORD-EMBED',
    domain: 'word',
    capability: '把 government-notice 样例里的嵌入商用字体复制进每一份新稿',
    status: 'excluded',
    dsh: 'example.docx 约 18.5MB，含嵌入字体',
    evidence: ['docs/qa/selection-3.2-office-stage-07.md'],
    needle: '嵌入字体',
    reason: '样例原件按确认保留。新稿不把该文件里的嵌入字体扩散到其他单位的稿件。版式守卫只在套用模板副本时核对字体未被删改。',
  },

  {
    id: 'XLS-CASES',
    domain: 'excel',
    capability: '年度经营、港口货运、荧光酶三个案例和预览区域',
    status: 'aligned',
    dsh: 'catalog.json 三个 Excel 案例与 previewPages',
    evidence: ['apps/electron/resources/skills/office-business/catalog.json'],
    needle: 'annual-business',
  },
  {
    id: 'XLS-METRICS',
    domain: 'excel',
    capability: 'SaaS 指标、Quick Ratio、单位经济与 dsh 脚本同输入同输出，会话用 office_business',
    status: 'aligned',
    dsh: 'saas-metrics-coach 三个 Python 计算器',
    evidence: ['packages/office-business-runtime/src/stage09-parity.test.ts', 'packages/session-tools-core/src/handlers/office-business.ts'],
    needle: 'quick-ratio',
  },
  {
    id: 'XLS-AUDIT',
    domain: 'excel',
    capability: '数据体检 12 个维度、加权总分和等级',
    status: 'aligned',
    dsh: 'data_quality_checker.py DIMENSION_WEIGHTS',
    evidence: ['packages/office-business-runtime/src/stage09-parity.test.ts', 'apps/electron/resources/skills/dataset-health-audit/SKILL.md'],
    needle: 'data-quality',
  },
  {
    id: 'XLS-VIZ',
    domain: 'excel',
    capability: '指名调色板的信息图与 OfficeCLI 原生图表命令，不把图写成图片',
    status: 'aligned',
    dsh: 'build_infographic.py',
    evidence: ['apps/electron/resources/skills/data-viz-gen/SKILL.md', 'docs/qa/selection-3.2-office-stage-09.md'],
    needle: 'native_chart',
  },
  {
    id: 'XLS-RECALC',
    domain: 'excel',
    capability: '公式写回缓存，未重算或 checks 不一致不能交付',
    status: 'aligned',
    dsh: 'LibreOffice 重算后的结果；Selection 用 OfficeCLI 求值器',
    evidence: ['packages/server-core/src/services/excel-delivery/xlsx-tool.ts', 'packages/session-tools-core/src/handlers/office-template.ts'],
    needle: 'xlsx_recalculate',
  },
  {
    id: 'XLS-CHECKS',
    domain: 'excel',
    capability: '港口与荧光酶 checks.json 在容差内核对',
    status: 'aligned',
    dsh: 'port-cargo/checks.json 与 bio-assay/checks.json',
    evidence: ['docs/qa/selection-3.2-office-stage-09.md'],
    needle: 'checks.json',
  },
  {
    id: 'XLS-VISUAL',
    domain: 'excel',
    capability: '纯数据或公式任务不做视觉检查；格式、图表、打印必须读图',
    status: 'aligned',
    dsh: '区域渲染；LinNai 2026-10-31 收窄了何时截图',
    evidence: ['packages/session-tools-core/src/handlers/office-template.ts'],
    needle: 'not-needed',
  },
  {
    id: 'XLS-PAGE',
    domain: 'excel',
    capability: '年度经营副本使用 A3、宽度一页；另外两个案例不改打印区域',
    status: 'aligned',
    dsh: '案例页面设置',
    evidence: ['docs/qa/selection-3.2-office-stage-08.md'],
    needle: 'A3',
  },
  {
    id: 'XLS-PERSONAL',
    domain: 'excel',
    capability: '报价、预算、对账、项目计划和目标考核五类个人表，含公式或图表',
    status: 'aligned',
    dsh: 'dsh 没有这些类型；#728 要求纳入',
    evidence: ['docs/qa/selection-3.2-office-personal-728.md', 'packages/shared/src/skills/office-document-routing.ts'],
    needle: '报价单',
  },
  {
    id: 'XLS-CHART-CACHE',
    domain: 'excel',
    capability: '原生图表缓存与 Excel CalculateFull 一致',
    status: 'partial',
    dsh: 'LibreOffice / Excel 重算图表缓存',
    evidence: ['docs/qa/selection-3.2-office-stage-09.md'],
    needle: '不重算图表缓存',
    reason: '单元格公式已重算。图表缓存留到装有 Excel 的真机，本环境没有 Excel。',
  },
  {
    id: 'XLS-HASH',
    domain: 'excel',
    capability: 'palette=auto 与 Python 进程哈希逐字节一致',
    status: 'excluded',
    dsh: 'build_infographic.py 使用 Python hash()',
    evidence: ['docs/adr/office-python-features-in-ts.md'],
    needle: 'hash()',
    reason: 'Python hash 带进程盐，不能当稳定结果。指名调色板时结构一致；未指名时用稳定哈希。',
  },
  {
    id: 'XLS-SAMPLE',
    domain: 'excel',
    capability: '数据体检 --sample 与 pandas RandomState 同序列',
    status: 'excluded',
    dsh: 'data_quality_checker.py --sample',
    evidence: ['docs/qa/selection-3.2-office-stage-09.md'],
    needle: 'RandomState',
    reason: '对拍不使用这个参数。全量 12 维仍对齐。',
  },

  {
    id: 'SHR-MODE',
    domain: 'shared',
    capability: '同一会话在 PPT、Word、Excel 之间切换，并与 NORM / PRO 分开',
    status: 'aligned',
    dsh: 'modes.js documentMode',
    evidence: ['docs/qa/selection-3.2-office-stage-05.md', 'packages/shared/src/protocol/office.ts'],
    needle: 'OfficeDocumentState',
  },
  {
    id: 'SHR-GALLERY',
    domain: 'shared',
    capability: '首页统一选择器：模板或案例卡片、预览、再次点击取消',
    status: 'aligned',
    dsh: 'dsh-desktop-office client.js',
    evidence: ['apps/electron/src/renderer/components/office/OfficeCaseGallery.tsx', 'docs/qa/selection-3.2-office-stage-06.md'],
    needle: 'OfficeCaseGallery',
  },
  {
    id: 'SHR-PANEL',
    domain: 'shared',
    capability: 'Office 协同面板打开案例样例，修订期间不把预览当可写编辑器',
    status: 'aligned',
    dsh: '预览面板',
    evidence: ['docs/qa/selection-3.2-office-stage-06.md'],
    needle: '只读',
  },
  {
    id: 'SHR-LOOP',
    domain: 'shared',
    capability: '生成、office_render、读图、返工；修订期间拦截 OCR 和裸截图',
    status: 'aligned',
    dsh: 'LibreOffice 渲染后的看页回路',
    evidence: ['packages/server-core/src/reliability/office-tool-policy.ts', 'packages/server-core/src/reliability/office-tool-policy.test.ts'],
    needle: '禁止 OCR',
  },
  {
    id: 'SHR-RECALC',
    domain: 'shared',
    capability: '公式重算不依赖 LibreOffice Kit，离线用 OfficeCLI 求值器',
    status: 'aligned',
    dsh: 'libreoffice-kit 重算',
    evidence: ['docs/adr/office-render-recalc-path.md'],
    needle: 'computedValue',
  },
  {
    id: 'SHR-FONT',
    domain: 'shared',
    capability: '缺字体时列出文档用到而本机没有的字体',
    status: 'aligned',
    dsh: '字体快照诊断',
    evidence: ['docs/qa/selection-3.2-office-stage-08.md'],
    needle: 'font_warnings',
  },
  {
    id: 'SHR-HASH',
    domain: 'shared',
    capability: '案例和模板原件在全流程后 sha256 不变',
    status: 'aligned',
    dsh: '模板原件只读',
    evidence: ['packages/office-business-runtime/src/word-cases.test.ts'],
    needle: 'sha256',
  },
  {
    id: 'SHR-PERSONAL',
    domain: 'shared',
    capability: '十一类个人办公文档的路由和技能注入',
    status: 'aligned',
    dsh: 'dsh 没有；#728 纳入验收',
    evidence: ['packages/shared/src/skills/__tests__/office-document-routing.test.ts', 'docs/qa/selection-3.2-office-personal-728.md'],
    needle: 'gov-doc-writing',
  },
  {
    id: 'SHR-PACK',
    domain: 'shared',
    capability: '安装包不含 LibreOffice Kit、Python 办公运行时和 PPTD',
    status: 'aligned',
    dsh: 'dsh 内置这些运行时；Selection 按 #705–#707 不打包',
    evidence: ['packages/office-business-runtime/src/no-python.test.ts', 'apps/electron/electron-builder.yml'],
    needle: 'bundledPython',
  },
  {
    id: 'SHR-CHART-HTML',
    domain: 'shared',
    capability: 'Excel 浮动图表在 HTML 预览里的位置与 Excel 自身一致',
    status: 'partial',
    dsh: 'LibreOffice 高保真渲染',
    evidence: ['docs/qa/selection-3.2-office-stage-06.md'],
    needle: '浮动图表',
    reason: '预览与 office_render 共用 OfficeCLI HTML。浮动图表的位置和 Excel 有差异，面板里也一样。原生高保真被 LinNai 延后。',
  },
  {
    id: 'SHR-PDF',
    domain: 'shared',
    capability: '用户路径上的 PDF 导出',
    status: 'excluded',
    dsh: 'dsh-office-to-pdf 加 LibreOffice Kit',
    evidence: ['packages/shared/src/prompts/system.ts', 'docs/qa/selection-3.2-office-stage-06.md'],
    needle: 'No PDF export',
    reason: '阶段 06 记录 LinNai 把 PDF 导出和原生高保真延后。系统提示仍写没有 PDF 导出，且 system.ts 只剩约 7 个 token，本阶段不加字。PoC 的 printToPDF 不在用户路径上。',
  },
]

export interface DomainScore {
  domain: ParityDomain
  aligned: number
  partial: number
  missing: number
  excluded: number
  counted: number
  points: number
  percent: number
}

export interface ParityScore {
  domains: DomainScore[]
  overall: DomainScore
}

const DOMAINS: ParityDomain[] = ['ppt', 'word', 'excel', 'shared']

function round1(value: number): number {
  return Math.round(value * 10) / 10
}

export function scoreItems(items: readonly ParityItem[], domain?: ParityDomain): DomainScore {
  const rows = domain ? items.filter(item => item.domain === domain) : items
  const aligned = rows.filter(item => item.status === 'aligned').length
  const partial = rows.filter(item => item.status === 'partial').length
  const missing = rows.filter(item => item.status === 'missing').length
  const excluded = rows.filter(item => item.status === 'excluded').length
  const counted = aligned + partial + missing
  const points = aligned + partial * 0.5
  const percent = counted === 0 ? 0 : round1((points / counted) * 100)
  return { domain: domain ?? 'shared', aligned, partial, missing, excluded, counted, points, percent }
}

export function scoreParity(items: readonly ParityItem[] = PARITY_ITEMS): ParityScore {
  const domains = DOMAINS.map(domain => scoreItems(items, domain))
  const overall = scoreItems(items)
  overall.domain = 'shared'
  return { domains, overall }
}
