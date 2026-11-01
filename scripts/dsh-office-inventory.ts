/**
 * Read-only inventory of dsh-desktop Office assets at a pinned commit.
 *
 *   bun scripts/dsh-office-inventory.ts \
 *     --repo /path/to/dsh-desktop \
 *     --commit 588412b9002fcb3ac88751fab7915e050c965563 \
 *     --out docs/plans/dsh-office-inventory.json \
 *     --markdown docs/plans/dsh-office-inventory.md
 *
 * Hashes are SHA-256 of git blob bytes, matching `git show <commit>:<path> | sha256sum`.
 * The script never writes into the dsh checkout. Regenerating the same commit
 * must reproduce the committed JSON byte for byte.
 */
import { createHash } from 'node:crypto'
import { pathToFileURL } from 'node:url'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

export const DSH_REPO_NAME = '0-CHENAI/dsh-desktop'
export const DSH_BASELINE = '588412b9002fcb3ac88751fab7915e050c965563'
export const DSH_PREVIOUS_SNAPSHOT = '8dec631777c34fbbcc7d45af787bdd2c468d2cfb'
const EXPAND_TARBALL_MAX_BYTES = 2_000_000
const MAX_BUFFER = 96 * 1024 * 1024

const TREE_ROOTS = [
  'packages/dsh-desktop-office',
  'packages/ppt-runtime',
  'packages/dsh-image-generation',
  'scripts/ppt',
]

const DOC_PATHS = [
  'docs/office-runtime.md',
  'docs/office-template-sources.md',
  'docs/office-templates-v012.md',
  'docs/ppt-personal-templates.md',
  'docs/ppt-template-conversion-review.md',
  'docs/ppt-template-v012-investigation.md',
  'docs/ppt-implementation-provenance-and-remediation-2026-09-06.md',
]

const CASE_PROVENANCE: Record<string, string> = {
  'meeting-minutes': 'catalog 没有使用「模拟数据 / 示例文稿 / 用户提供的样例」。design.md：用户于 2026-10-12 认可的成品，内容底稿来自飞书官方“发布会筹备对齐”演示并重新整理。dsh docs/office-template-sources.md 记载的 example.docx SHA-256 b6183bbe83637defb3efe220fbfba6ddc9e5070a1e42aacf1168f9040f0deb5a 与本提交文件不一致，以本清单 sha256 为准。',
  'coffee-market': 'catalog：以公开披露为基础的 2024 年市场研究。design.md：4 张图表为随包 PNG，资料截至 2025-04-15。不是「模拟数据」标签。',
  'equity-research': 'catalog 标注「示例文稿」。',
  'government-notice': 'catalog 标注「用户提供的样例」（2025 年公文生成样例）。design.md 写明 DOCX 与用户源文件字节一致。',
  'annual-business': 'catalog 标注「模拟数据」。design.md：澄云软件及经营数据均为模拟案例。',
  'port-cargo': 'catalog：365 天、2,190 条模拟装卸记录。',
  'bio-assay': 'catalog：3 批次、288 个模拟孔位。',
}

export type Category = '案例' | '技能' | '工具' | '引擎' | 'UI' | '运行时'
export type Language = 'JS' | 'Python' | '二进制' | '文档'
export type Disposition = '原样搬' | '改写' | '决策后再定' | '不搬'
export type Gap = '1' | '2' | '3' | '4' | '5' | '对照'

export type InventoryFile = {
  path: string
  origin: 'git' | 'tar'
  sha256: string
  bytes: number
  category: Category
  language: Language
  license: 'MIT' | 'Apache-2.0' | 'MPL-2.0' | 'NOASSERTION'
  licenseEvidence: string
  stage: string
  issue: number
  gap: Gap
  disposition: Disposition
  note: string
  provenance: string
}

export type Inventory = {
  schemaVersion: 1
  dshRepo: typeof DSH_REPO_NAME
  dshCommit: string
  readOnly: true
  files: InventoryFile[]
  summary: {
    fileCount: number
    dshDesktopOfficeCount: number
    byStage: Array<{ key: string; count: number }>
    byCategory: Array<{ key: string; count: number }>
    byLanguage: Array<{ key: string; count: number }>
    byLicense: Array<{ key: string; count: number }>
    byDisposition: Array<{ key: string; count: number }>
    byGap: Array<{ key: string; count: number }>
  }
}

type Classified = Omit<InventoryFile, 'path' | 'origin' | 'sha256' | 'bytes' | 'language'>

const GOV_NOTE = '能力参照 dsh-desktop gov-doc-writing，未复用其内容。LinNai 2026-10-30（issue #704 评论）允许公文写作能力对齐：文种识别、GB/T 9704 版式要素、行文规范与用语、结构模板、交付前格式自检。禁止照搬技能正文、模板文本与示例。阶段 07 在 Selection 自写，本阶段不搬入任何文件。'
const GOV_CASE_NOTE = '与 gov-doc-writing 配套的用户样例。验收只对照版式与结构（版头、红线、主体、版记、字体字号、行距、页边距），不复制文本。不进入阶段 07 的搬入清单。'

function git(repo: string, args: string[], encoding: 'buffer'): Buffer
function git(repo: string, args: string[], encoding: 'utf8'): string
function git(repo: string, args: string[], encoding: 'buffer' | 'utf8'): Buffer | string {
  const result = spawnSync('git', ['-C', repo, ...args], {
    encoding: encoding === 'buffer' ? undefined : 'utf8',
    maxBuffer: MAX_BUFFER,
  })
  if (result.error) throw result.error
  if (result.status !== 0) {
    const err = encoding === 'utf8' ? String(result.stderr) : Buffer.from(result.stderr ?? '').toString('utf8')
    throw new Error(`git ${args.join(' ')} failed: ${err.trim()}`)
  }
  return encoding === 'buffer' ? Buffer.from(result.stdout) : String(result.stdout)
}

function resolveCommit(repo: string, commit: string): string {
  return git(repo, ['rev-parse', `${commit}^{commit}`], 'utf8').trim()
}

function listed(repo: string, commit: string, prefix: string): string[] {
  const out = git(repo, ['ls-tree', '-r', '--name-only', commit, '--', prefix], 'utf8')
  return out.split('\n').filter(Boolean)
}

function blob(repo: string, commit: string, path: string): Buffer {
  return git(repo, ['cat-file', 'blob', `${commit}:${path}`], 'buffer')
}

function sha256(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function languageOf(path: string): Language {
  const name = path.split('!').pop() ?? path
  if (name.endsWith('.py')) return 'Python'
  if (/\.(png|jpe?g|gif|webp|docx|xlsx|tgz|woff2?|ttf|otf|bin|wasm)$/i.test(name)) return '二进制'
  if (/\.(mjs|cjs|js|tsx?)$/.test(name)) return 'JS'
  return '文档'
}

function caseId(path: string): string | undefined {
  const match = path.match(/\/sources\/(?:curated|legacy)\/([^/]+)\//)
  return match?.[1]
}

function provenanceOf(path: string): string {
  const id = caseId(path)
  return id ? CASE_PROVENANCE[id] ?? '' : ''
}

function excelSkill(path: string): boolean {
  return /\/(saas-metrics-coach|dataset-health-audit|data-viz-gen)\//.test(path)
}

function skillHome(path: string): { stage: string; issue: number } {
  return excelSkill(path) ? { stage: '09', issue: 712 } : { stage: '07', issue: 710 }
}

function licenseOf(path: string): Pick<InventoryFile, 'license' | 'licenseEvidence'> {
  if (path.includes('/gov-doc-writing/')) {
    return {
      license: 'NOASSERTION',
      licenseEvidence: '目录内没有 LICENSE、NOTICE 或 COPYING。dsh docs/office-template-sources.md 称其为用户授权的 WorkBuddy 公文技能 2.0.4，但本提交没有随附许可证文件。',
    }
  }
  if (path.includes('/government-notice/')) {
    return {
      license: 'NOASSERTION',
      licenseEvidence: '案例目录没有 LICENSE。父包 package.json 的 license 字段是 MIT，但 catalog 把本案例标成用户提供的样例，不能把包级 MIT 当成这份公文原文的分发许可。',
    }
  }
  if (path.includes('/research-writer/')) {
    return {
      license: 'Apache-2.0',
      licenseEvidence: 'LICENSE.txt 为 Apache-2.0。版权行仍是未填写的 “Copyright [yyyy] [name of copyright owner]” 模板。SKILL.md 写明原文为 ComposioHQ/awesome-claude-skills 的 content-research-writer（Apache-2.0），正文有中文翻译。',
    }
  }
  if (path.includes('/meeting-recap/')) {
    return {
      license: 'MIT',
      licenseEvidence: 'LICENSE 正文是 MIT，版权 meeting-minutes contributors。文件以 Markdown 代码围栏开头，后续原样保留，不在本阶段改写。',
    }
  }
  if (path.includes('/work-report-writer/')) {
    return {
      license: 'MIT',
      licenseEvidence: 'LICENSE 为 MIT，版权 weekly-report-generator contributors。',
    }
  }
  if (path.includes('/saas-metrics-coach/')) {
    return {
      license: 'MIT',
      licenseEvidence: 'LICENSE 为 MIT，版权 Abbas Mir。',
    }
  }
  if (path.includes('/dataset-health-audit/')) {
    return {
      license: 'MIT',
      licenseEvidence: 'LICENSE 为 MIT，版权 data-quality-checker contributors。',
    }
  }
  if (path.includes('/data-viz-gen/')) {
    return {
      license: 'MIT',
      licenseEvidence: 'LICENSE 为 MIT，版权 infographic-builder contributors。',
    }
  }
  if (path.includes('libreoffice-kit')) {
    return {
      license: 'MPL-2.0',
      licenseEvidence: '六个 0.1.3 包的 package.json license 均为 MPL-2.0。元包 LICENSE 为 Mozilla Public License 2.0；原生包另有 licenses/LibreOffice-MPL-2.0.txt 与 licenses/DeepSeek-Harness-MIT.txt。NOTICE 记录 LibreOffice Core fontdefs.cxx（bce0998）的 MPL-2.0 与其中 Apache-2.0 字体名数据。',
    }
  }
  if (path.includes('dsh-skill-office') || path.includes('dsh-office-to-pdf')) {
    return {
      license: 'MIT',
      licenseEvidence: '包内 package/LICENSE 为 MIT，版权 DeepSeek（2026）。',
    }
  }
  if (path.includes('/upstream/html-anything/')) {
    return {
      license: 'Apache-2.0',
      licenseEvidence: 'packages/ppt-runtime/upstream/html-anything/LICENSE 为 Apache-2.0。THIRD_PARTY_NOTICES 指向 nexu-io/html-anything@c312045。',
    }
  }
  if (path.includes('/upstream/zara/')) {
    return {
      license: 'MIT',
      licenseEvidence: 'packages/ppt-runtime/upstream/zara/LICENSE 为 MIT，版权 Zara Zhang（2026），固定版本 beautiful-html-templates@e5e204fb。',
    }
  }
  if (path.includes('/ppt-runtime/')) {
    return {
      license: 'MIT',
      licenseEvidence: 'core/LICENSE 与 adapter/LICENSE 为 MIT，版权 DeepSeek and WorkBuddy PPT contributors（2026）。README 写明重命名不改变来源，也不构成法律清理。搬运必须同时保留 THIRD_PARTY_NOTICES.md。模板内容是混合来源，不能把这份 MIT 当成全部模板的唯一许可。',
    }
  }
  if (path.includes('/dsh-image-generation/')) {
    return {
      license: 'MIT',
      licenseEvidence: 'packages/dsh-image-generation/LICENSE 为 MIT，版权 DataElement（2026）。',
    }
  }
  if (path.includes('/dsh-desktop-office/')) {
    return {
      license: 'MIT',
      licenseEvidence: 'packages/dsh-desktop-office/package.json 的 license 字段为 MIT。该包根目录没有 LICENSE 文件。仓库根 LICENSE 为 MIT，版权 DataElement（2026）。案例原文若另有来源说明，以该条目的 provenance 为准。',
    }
  }
  if (path.startsWith('docs/office')) {
    return {
      license: 'NOASSERTION',
      licenseEvidence: '文档自身没有 SPDX 标识。仓库根 LICENSE 为 MIT，版权 DataElement（2026）。根 MIT 不自动覆盖文中转述的第三方技能或用户样例。本阶段不整篇搬入。',
    }
  }
  if (path.startsWith('scripts/ppt/') || path.startsWith('docs/')) {
    return {
      license: 'NOASSERTION',
      licenseEvidence: '路径自身没有 SPDX 标识。仓库根 LICENSE 为 MIT，但 PPT 模板种子是混合来源，见 ppt-runtime/core/THIRD_PARTY_NOTICES.md。本阶段不把根 MIT 写成这些模板的全部许可。',
    }
  }
  return {
    license: 'NOASSERTION',
    licenseEvidence: '未匹配到许可证文件。',
  }
}

function classified(path: string, fields: Omit<Classified, 'license' | 'licenseEvidence' | 'provenance'> & { provenance?: string }): Classified {
  const license = licenseOf(path)
  return {
    ...fields,
    ...license,
    provenance: fields.provenance ?? provenanceOf(path),
  }
}

function baseName(path: string): string {
  return path.split('!').pop()?.split('/').pop() ?? path
}

export function classifyPath(path: string): Classified {
  const base = baseName(path)
  if (path.includes('/gov-doc-writing/')) {
    return classified(path, { category: '技能', stage: '07', issue: 710, gap: '1', disposition: '不搬', note: GOV_NOTE, provenance: 'WorkBuddy 公文技能。无许可证文件。只作能力参照。' })
  }
  if (path.includes('/government-notice/')) {
    return classified(path, { category: '案例', stage: '07', issue: 710, gap: '1', disposition: '不搬', note: GOV_CASE_NOTE })
  }
  if (path.includes('libreoffice-kit')) {
    return classified(path, {
      category: '引擎', stage: '02', issue: 705, gap: '5', disposition: '决策后再定',
      note: '渲染、PDF 与公式重算候选引擎。MPL-2.0，分发义务与体积由 #705 决定。本提交有元包、darwin-arm64、darwin-x64、win32-arm64、win32-x64、wasm 共 6 个包，没有 linux 原生包；wasm 包的 os 字段为 linux。本阶段不搬入。',
    })
  }
  if (path.includes('dsh-office-to-pdf')) {
    return classified(path, {
      category: '引擎', stage: '02', issue: 705, gap: '5', disposition: '决策后再定',
      note: 'Office 转 PDF 的队列适配器，真正转换依赖 LibreOffice Kit。是否采用由 #705 决定。不整包搬入 Cordis 插件。',
    })
  }
  if (path.includes('check_office.py')) {
    return classified(path, {
      category: '工具', stage: '05', issue: 708, gap: '对照', disposition: '不搬',
      note: 'ZIP、XML 与关系的结构检查。Selection 已有 OfficeCLI validate。#708 注入现有检查器，不迁这份 Python。',
    })
  }
  if (path.includes('/office-docx/')) {
    return classified(path, {
      category: '技能', stage: '05', issue: 708, gap: '对照', disposition: '不搬',
      note: 'python-docx 格式指南。Selection OfficeCLI docx 指南更全。#708 注入现有指南，不搬这份正文。',
    })
  }
  if (path.includes('/office-pptx/')) {
    return classified(path, {
      category: '技能', stage: '13', issue: 716, gap: '对照', disposition: '不搬',
      note: '普通会话的 python-pptx 指南。PPT 模式对照 dsh-ppt。Selection 保留三分路由，不搬这份正文。',
    })
  }
  if (path.includes('/office-xlsx/')) {
    return classified(path, {
      category: '技能', stage: '09', issue: 712, gap: '对照', disposition: '不搬',
      note: 'openpyxl 与 pandas 指南。Selection OfficeCLI xlsx 指南保留。pandas 分析与真重算不靠这份正文，重算归 #705。',
    })
  }
  if (path.includes('dsh-skill-office')) {
    return classified(path, {
      category: '运行时', stage: '05', issue: 708, gap: '对照', disposition: '不搬',
      note: 'Cordis 技能包壳。格式指南由 #708 用 Selection 现有技能注入，不 vendoring 该包。',
    })
  }
  if (/\/sources\/(curated\/meeting-minutes|legacy\/coffee-market|legacy\/equity-research)\//.test(path)) {
    return classified(path, {
      category: '案例', stage: '07', issue: 710, gap: '1', disposition: '原样搬',
      note: 'Word 案例资产。阶段 07 搬入时保留字节与许可说明，只在工作区副本上填写，禁止覆盖原件。本阶段不搬入。',
    })
  }
  if (/\/sources\/legacy\/(annual-business|port-cargo|bio-assay)\//.test(path)) {
    return classified(path, {
      category: '案例', stage: '09', issue: 712, gap: '1', disposition: '原样搬',
      note: 'Excel 案例资产，含模拟数据与 checks.json。阶段 09 搬入时保留字节，禁止覆盖原件。公式真重算归 #705。本阶段不搬入。',
    })
  }
  if (path.endsWith('packages/dsh-desktop-office/sources/catalog.json')) {
    return classified(path, {
      category: '案例', stage: '06', issue: 709, gap: '2',
      disposition: '改写',
      note: '七个案例的目录合同，选择器、注入和验收共用。接入时改写到 Selection 的 catalog，不覆盖既有虚构样例。案例字节本身归阶段 07 与 09。',
      provenance: '索引 meeting-minutes、coffee-market、equity-research、government-notice、annual-business、port-cargo、bio-assay。',
    })
  }
  if (path.endsWith('/lib/modes.js') || path.endsWith('/lib/business-skills.js')) {
    return classified(path, {
      category: '运行时', stage: '05', issue: 708, gap: '2', disposition: '改写',
      note: '对齐文档模式、案例与业务技能注入、指纹去重和 revision 失效。宿主不是 Cordis，按行为改写。',
    })
  }
  if (path.endsWith('/lib/templates.js')) {
    return classified(path, {
      category: '运行时', stage: '06', issue: 709, gap: '2', disposition: '改写',
      note: '案例目录与预览装载。由 Office Composer 承接，不搬 Cordis 客户端。',
    })
  }
  if (path.endsWith('/lib/template-tool.js') || path.endsWith('/lib/template-writer.js') || path.endsWith('/lib/docx-workflow.js')) {
    return classified(path, {
      category: '工具', stage: '08', issue: 711, gap: '3', disposition: '改写',
      note: '以 OfficeCLI 的 paraId 实现 office_template、office_template_write（replacements、additions、removals，新段落继承样式）和交付前守卫的等价行为。',
    })
  }
  if (path.endsWith('docx-layout.py')) {
    return classified(path, {
      category: '工具', stage: '08', issue: 711, gap: '3', disposition: '决策后再定',
      note: '交付前核对嵌入字体、样式、节、边框、表格和页脚。核对规则属 #711，Python 运行时属 #706。',
    })
  }
  if (path.endsWith('packages/dsh-desktop-office/client.js')) {
    return classified(path, {
      category: 'UI', stage: '06', issue: 709, gap: '2', disposition: '改写',
      note: 'Word 与 Excel 的选模板、按页预览和做同款。UI 用 Selection 组件重做。',
    })
  }
  if (path.includes('packages/dsh-desktop-office/index.') || path.endsWith('packages/dsh-desktop-office/package.json')) {
    return classified(path, {
      category: '运行时', stage: '05', issue: 708, gap: '2', disposition: '不搬',
      note: 'Cordis 插件入口与包声明。不整包 vendoring。模式行为由 #708 在 Selection 宿主重做。',
    })
  }
  if (path.includes('/business-skills/') && path.endsWith('.py')) {
    const home = skillHome(path)
    return classified(path, {
      category: '技能', ...home, gap: '1', disposition: '决策后再定',
      note: '业务计算或校验脚本。技能归属阶段 07 或 09；内置 Python 还是改写为 TS 或 Bun 由 #706 决定，之后与 dsh 原版对拍。',
    })
  }
  if (path.includes('/business-skills/')) {
    const home = skillHome(path)
    return classified(path, {
      category: '技能', ...home, gap: '1', disposition: '原样搬',
      note: '保留原 LICENSE 与版权行。本阶段不搬入。阶段 07 或 09 搬入时不改许可文本。',
    })
  }
  if (path.includes('/dsh-image-generation/skills/generate-image/') || path.endsWith('/lib/provider.js') || path.endsWith('/lib/writer.js')) {
    return classified(path, {
      category: path.includes('/skills/') ? '技能' : '工具',
      stage: '12', issue: 715, gap: '4', disposition: '改写',
      note: '模板配图槽的生图实现参照。按 dsh.template-images/v1 接到 Selection，不搬 Cordis 插件壳。',
    })
  }
  if (path.endsWith('packages/dsh-image-generation/LICENSE')) {
    return classified(path, {
      category: '运行时', stage: '12', issue: 715, gap: '4', disposition: '原样搬',
      note: '生图改写落地时保留这份 MIT 声明。本阶段不搬入。',
    })
  }
  if (path.includes('/dsh-image-generation/')) {
    return classified(path, {
      category: '运行时',
      stage: '12', issue: 715, gap: '4', disposition: '不搬',
      note: 'Cordis 插件壳、预览和桌面存储。生图能力在 #715 按合同重做。',
    })
  }
  if (path.includes('personal-template') || path.endsWith('catalog-policy.json')) {
    return classified(path, {
      category: path.includes('/client/') ? 'UI' : '工具',
      stage: '11', issue: 714, gap: '4', disposition: '改写',
      note: '个人模板上传、预览、登记和 ppt_template_create_project 的行为参照。在 Selection 的模板库上重做，不搬 Cordis client。',
    })
  }
  if (path.includes('template-image-contract')) {
    return classified(path, {
      category: '工具', stage: '12', issue: 715, gap: '4', disposition: '改写',
      note: 'dsh.template-images/v1 图片槽合同。语义对齐后接入 Selection 生图。',
    })
  }
  if (path.includes('/core/skills/dsh-ppt/') || /^(validation|pptx-geometry-budget|text-wrap|text-escapes|rich-text-layout|source-layout|font-family)\.(js|d\.ts)$/.test(base)) {
    return classified(path, {
      category: path.includes('/skills/') ? '技能' : '工具',
      stage: '13', issue: 716, gap: '对照', disposition: '改写',
      note: '与 Selection 的 deck check 和 composition 逐条对照后改写。不引入 PPTD 运行时。保留 THIRD_PARTY_NOTICES。',
    })
  }
  if (
    /^(pptx-converter|imported-font-style|imported-shape-export|imported-text-export|imported-text-layout|pptx-geometry|pptx-groups|pptx-layers|pptx-media|pptx-object-coverage|pptx-package|pptx-resources|pptx-shape-style|drawingml-shapes|emf-image|image-crop)\.js$/.test(base)
    || base.includes('pptd-convert')
  ) {
    return classified(path, {
      category: '引擎', stage: '10', issue: 713, gap: '4', disposition: '决策后再定',
      note: '有边界的 PPTX 导入与回写。承载格式由 #707 决定后再移植行为。不承诺动画、多媒体和 SmartArt 还原。本阶段不搬代码。',
    })
  }
  if (/office-preview|office-template-preview|preview-assets|raster-preview|office-font/.test(base)) {
    return classified(path, {
      category: '引擎', stage: '02', issue: 705, gap: '5', disposition: '决策后再定',
      note: '页预览、区域预览和字体诊断依赖渲染引擎。引擎选型归 #705，选择器呈现归 #709。',
    })
  }
  if (base === 'cordis.patch.yml' || path.includes('/ppt-runtime/adapter/')) {
    return classified(path, {
      category: path.includes('/adapter/') && base === 'client.js' ? 'UI' : '运行时',
      stage: path.includes('/adapter/') && base === 'client.js' ? '06' : '04',
      issue: path.includes('/adapter/') && base === 'client.js' ? 709 : 707,
      gap: path.includes('/adapter/') && base === 'client.js' ? '2' : '4',
      disposition: '不搬',
      note: 'Cordis 适配层。无论 #707 如何选择 PPTD 与 deck.json 的关系，都不搬 Cordis 补丁。选择器由 #709 用 Selection 组件重做。',
    })
  }
  if (path.endsWith('excluded-assets.json')) {
    return classified(path, {
      category: '运行时', stage: '15', issue: 718, gap: '对照', disposition: '不搬',
      note: '已撤回社区模板与预览的哈希回归清单（23 套、345 张图）。这些文件不得重新分发。#718 核对清单仍然缺席。',
    })
  }
  if (base === 'THIRD_PARTY_NOTICES.md' || base === 'LICENSE' || base === 'LICENSE.txt' || base === 'NOTICE') {
    return classified(path, {
      category: '运行时', stage: '15', issue: 718, gap: '对照', disposition: '原样搬',
      note: '随被搬资产保留原文，不单独当作功能。ppt-runtime 的任何代码或模板搬运都必须带上 THIRD_PARTY_NOTICES。本阶段不搬入。',
    })
  }
  if (path.includes('/upstream/') || path.startsWith('scripts/ppt/base-templates/')) {
    return classified(path, {
      category: '案例', stage: '15', issue: 718, gap: '对照', disposition: '不搬',
      note: 'O3 已从 8dec631 把 16 套模板转入 Selection。这里只冻结 588412b 的种子哈希，供 #718 核对漂移。禁止覆盖 Selection 原模板或把样例写回原页。',
    })
  }
  if (path.startsWith('scripts/ppt/') && (path.endsWith('.mjs') || path.endsWith('.json'))) {
    return classified(path, {
      category: '工具', stage: '13', issue: 716, gap: '对照', disposition: '改写',
      note: '组合、英文排版和富布局的生成输入。#716 对照后改写进 Selection composition，不覆盖已导入模板。',
    })
  }
  if (path.startsWith('scripts/ppt/')) {
    return classified(path, {
      category: '工具', stage: '15', issue: 718, gap: '对照', disposition: '不搬',
      note: 'PPT 构建说明。只作漂移核对，不搬入，不覆盖原模板。',
    })
  }
  if (path.endsWith('docs/office-runtime.md')) {
    return classified(path, {
      category: '工具', stage: '03', issue: 706, gap: '5', disposition: '不搬',
      note: '安装级 Python 运行时的事实来源。#706 据此决定内置还是改写，不把这篇文档拷进 Selection。',
    })
  }
  if (path.endsWith('docs/office-template-sources.md') || path.endsWith('docs/office-templates-v012.md')) {
    return classified(path, {
      category: '工具', stage: '07', issue: 710, gap: '1', disposition: '不搬',
      note: '案例与业务技能的来源记录。Selection 写自己的 ATTRIBUTION，不整篇搬入。公文部分只取能力范围。',
    })
  }
  if (path.endsWith('docs/ppt-personal-templates.md')) {
    return classified(path, {
      category: '工具', stage: '11', issue: 714, gap: '4', disposition: '不搬',
      note: '个人模板产品规则。#714 按规则重做，不搬这篇文档。',
    })
  }
  if (path.endsWith('docs/ppt-template-conversion-review.md') || path.endsWith('docs/ppt-template-v012-investigation.md')) {
    return classified(path, {
      category: '工具', stage: '10', issue: 713, gap: '4', disposition: '不搬',
      note: 'PPTX 转换边界的调查记录。#713 作输入，不搬原文。',
    })
  }
  if (path.startsWith('docs/')) {
    return classified(path, {
      category: '工具', stage: '15', issue: 718, gap: '对照', disposition: '不搬',
      note: '来源与法律清理说明。搬运 ppt-runtime 前必须阅读，不把文档本身当资产拷入。',
    })
  }
  if (/pptd|ppt-service|ppt-tools|ppt-store|protocol\.d\.ts|template-reference|template-semantics|ppt-template/.test(path)) {
    return classified(path, {
      category: '引擎', stage: '04', issue: 707, gap: '4', disposition: '决策后再定',
      note: 'PPTD 类型、服务和模板引用。与 deck.json 的字段关系由 #707 决定。README 写明手头是提取后的 JS，没有完整 TS 源码。',
    })
  }
  if (path.includes('/ppt-runtime/')) {
    return classified(path, {
      category: '运行时', stage: '04', issue: 707, gap: '4', disposition: '决策后再定',
      note: '未单列的 ppt-runtime 文件归入 PPTD 承载决策。本阶段不搬代码。',
    })
  }
  throw new Error(`dsh Office 路径没有归属阶段: ${path}`)
}

function trackedPaths(repo: string, commit: string): string[] {
  const paths = new Set<string>()
  for (const root of TREE_ROOTS) for (const path of listed(repo, commit, root)) paths.add(path)
  for (const path of listed(repo, commit, 'docs')) if (DOC_PATHS.includes(path)) paths.add(path)
  for (const path of listed(repo, commit, 'packages/harness-0.2.0-rc.2')) {
    const name = path.split('/').pop() ?? ''
    if (
      name === 'deepseek-ai-dsh-skill-office-0.2.0-rc.2.tgz'
      || name === 'deepseek-ai-dsh-office-to-pdf-0.2.0-rc.2.tgz'
      || /^deepseek-ai-libreoffice-kit-.*0\.1\.3\.tgz$/.test(name)
    ) paths.add(path)
  }
  return [...paths].sort()
}

function tarMembers(bytes: Buffer): Array<{ name: string; bytes: Buffer }> {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-office-inventory-'))
  const file = join(dir, 'package.tgz')
  try {
    writeFileSync(file, bytes)
    const listedNames = spawnSync('tar', ['-tzf', file], { encoding: 'utf8', maxBuffer: MAX_BUFFER })
    if (listedNames.status !== 0) throw new Error(String(listedNames.stderr))
    const names = listedNames.stdout.split('\n').map(name => name.replace(/^\.\//, '')).filter(name => name && !name.endsWith('/'))
    const members: Array<{ name: string; bytes: Buffer }> = []
    for (const name of names.sort()) {
      const extracted = spawnSync('tar', ['-xOzf', file, name], { maxBuffer: MAX_BUFFER })
      if (extracted.status !== 0) throw new Error(`tar ${name}: ${Buffer.from(extracted.stderr ?? '').toString('utf8')}`)
      members.push({ name, bytes: Buffer.from(extracted.stdout) })
    }
    return members
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

function entry(path: string, origin: 'git' | 'tar', bytes: Buffer): InventoryFile {
  const meta = classifyPath(path)
  return {
    path,
    origin,
    sha256: sha256(bytes),
    bytes: bytes.length,
    category: meta.category,
    language: languageOf(path),
    license: meta.license,
    licenseEvidence: meta.licenseEvidence,
    stage: meta.stage,
    issue: meta.issue,
    gap: meta.gap,
    disposition: meta.disposition,
    note: meta.note,
    provenance: meta.provenance,
  }
}

export function buildInventory(repo: string, commit: string): Inventory {
  const dshCommit = resolveCommit(repo, commit)
  const files: InventoryFile[] = []
  for (const path of trackedPaths(repo, dshCommit)) {
    const bytes = blob(repo, dshCommit, path)
    files.push(entry(path, 'git', bytes))
    const expandable = path.endsWith('.tgz') && bytes.length <= EXPAND_TARBALL_MAX_BYTES
    if (!expandable) continue
    for (const member of tarMembers(bytes)) files.push(entry(`${path}!${member.name}`, 'tar', member.bytes))
  }
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0))
  return {
    schemaVersion: 1,
    dshRepo: DSH_REPO_NAME,
    dshCommit,
    readOnly: true,
    files,
    summary: summarize(files),
  }
}

function tally(files: InventoryFile[], key: keyof InventoryFile): Array<{ key: string; count: number }> {
  const counts: Record<string, number> = {}
  for (const file of files) {
    const label = String(file[key])
    counts[label] = (counts[label] ?? 0) + 1
  }
  return Object.keys(counts).sort().map(label => ({ key: label, count: counts[label]! }))
}

function summarize(files: InventoryFile[]): Inventory['summary'] {
  return {
    fileCount: files.length,
    dshDesktopOfficeCount: files.filter(file => file.path.startsWith('packages/dsh-desktop-office/')).length,
    byStage: tally(files, 'stage'),
    byCategory: tally(files, 'category'),
    byLanguage: tally(files, 'language'),
    byLicense: tally(files, 'license'),
    byDisposition: tally(files, 'disposition'),
    byGap: tally(files, 'gap'),
  }
}

export function serializeInventory(inventory: Inventory): string {
  return `${JSON.stringify(inventory, null, 2)}\n`
}

function cell(value: string | number): string {
  return String(value).replace(/\|/g, '／').replace(/\n/g, ' ')
}

export function renderInventoryMarkdown(inventory: Inventory): string {
  const lines: string[] = []
  lines.push('# dsh Office 资产清单')
  lines.push('')
  lines.push(`本文件由 \`scripts/dsh-office-inventory.ts\` 从 \`${inventory.dshRepo}@${inventory.dshCommit}\` 生成，不要手改。`)
  lines.push('只读对照，不是 dsh 的运行验收，也没有把任何资产搬进 Selection。')
  lines.push('人读说明、差距表和验收记录见 [selection-3.2-office-dsh-parity-baseline.md](selection-3.2-office-dsh-parity-baseline.md)。许可审计见 [dsh-office-licenses.md](dsh-office-licenses.md)。')
  lines.push('')
  lines.push('## 汇总')
  lines.push('')
  lines.push(`- 条目 ${inventory.summary.fileCount}，其中 \`packages/dsh-desktop-office/\` ${inventory.summary.dshDesktopOfficeCount}。`)
  const show = (rows: Array<{ key: string; count: number }>) => rows.map(row => `${row.key}=${row.count}`).join('，')
  lines.push(`- 阶段：${show(inventory.summary.byStage)}`)
  lines.push(`- 类别：${show(inventory.summary.byCategory)}`)
  lines.push(`- 语言：${show(inventory.summary.byLanguage)}`)
  lines.push(`- 许可：${show(inventory.summary.byLicense)}`)
  lines.push(`- 处理：${show(inventory.summary.byDisposition)}`)
  lines.push(`- 差距：${show(inventory.summary.byGap)}`)
  lines.push('')
  lines.push('阶段 14（#717）不占 dsh 源文件，它消费本清单做对齐度量。')
  lines.push('')
  lines.push('## 全文件')
  lines.push('')
  lines.push('| 路径 | sha256 | 字节 | 类别 | 语言 | 许可 | 阶段 | Issue | 差距 | 处理 | 说明 |')
  lines.push('| --- | --- | ---: | --- | --- | --- | --- | ---: | --- | --- | --- |')
  for (const file of inventory.files) {
    lines.push(`| ${cell(file.path)} | ${file.sha256} | ${file.bytes} | ${file.category} | ${file.language} | ${file.license} | ${file.stage} | ${file.issue} | ${file.gap} | ${file.disposition} | ${cell(file.note)} |`)
  }
  lines.push('')
  return lines.join('\n')
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name)
  if (index === -1) return undefined
  const value = process.argv[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`${name} 需要参数`)
  return value
}

function main(): void {
  const repo = argument('--repo')
  const commit = argument('--commit') ?? DSH_BASELINE
  if (!repo) {
    console.error('用法: bun scripts/dsh-office-inventory.ts --repo <dsh-desktop> [--commit <sha>] [--out file.json] [--markdown file.md]')
    process.exit(2)
  }
  const inventory = buildInventory(repo, commit)
  const json = serializeInventory(inventory)
  const markdown = renderInventoryMarkdown(inventory)
  const out = argument('--out')
  const markdownOut = argument('--markdown')
  if (out) writeFileSync(out, json)
  else process.stdout.write(json)
  if (markdownOut) writeFileSync(markdownOut, markdown)
  console.error(`inventory ${inventory.dshCommit} files=${inventory.summary.fileCount} dsh-desktop-office=${inventory.summary.dshDesktopOfficeCount}`)
}

const invokedDirectly = import.meta.url === pathToFileURL(process.argv[1] ?? '').href
if (invokedDirectly) main()
