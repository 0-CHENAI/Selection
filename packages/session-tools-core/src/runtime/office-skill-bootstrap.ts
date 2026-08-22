import type { OfficeGuideName } from '../office-types.ts';

export const OFFICE_SKILL_BOOTSTRAP_MAX_CHARS = 40_000;

const LOAD_SKILL_ALIASES: Record<string, OfficeGuideName> = {
  word: 'word',
  docx: 'word',
  excel: 'excel',
  xlsx: 'excel',
  pptx: 'pptx',
  ppt: 'pptx',
  powerpoint: 'pptx',
  'academic-paper': 'academic-paper',
  'financial-model': 'financial-model',
  'data-dashboard': 'data-dashboard',
  'pitch-deck': 'pitch-deck',
  'word-form': 'word-form',
  'morph-ppt': 'morph-ppt',
  'morph-ppt-3d': 'morph-ppt-3d',
};

const BASE_BOOTSTRAP_TITLES = [
  'Requirements for Outputs',
  'Visual delivery floor',
  'Common Workflow',
  'QA',
] as const;

const EXTRA_BOOTSTRAP_TITLES: Partial<Record<OfficeGuideName, readonly string[]>> = {
  word: ['Delivery Gate', 'Table of Contents'],
  pptx: ['Delivery Gate'],
  excel: ['QA (Required)'],
  'academic-paper': ['Delivery Gate', 'Requirements', 'Workflow'],
  'word-form': ['Delivery Gate', 'Requirements'],
  'financial-model': ['Audit & Delivery Gate', 'Three-zone architecture', 'Core Principles'],
  'data-dashboard': ['Delivery Gate', 'Requirements', 'Core Principles'],
  'pitch-deck': ['Delivery Gate', 'QA — Delivery Gate'],
  'morph-ppt': ['Delivery Gate'],
  'morph-ppt-3d': [
    '3D Model Compatibility Gate',
    'Hard Rules',
    '3D Model Insertion Rules',
    'Workflow Integration',
    'Visual Design System',
    'Model-Content Layout',
    'Camera Language',
  ],
};

export interface GuideHeadingSection {
  level: number;
  title: string;
  start: number;
  end: number;
}

export function normalizeGuideSearch(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/[\s_\-—–]+/g, ' ');
}

function compactGuideTitle(value: string): string {
  return normalizeGuideSearch(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

const SKIP_BOOTSTRAP_TITLES = /display notes|honest limit|minimum cycle|field \/ cached|formula verification|template qa|fresh eyes/;

export function guideTitleMatchesNeedle(sectionTitle: string, needle: string): boolean {
  const title = normalizeGuideSearch(sectionTitle);
  const want = normalizeGuideSearch(needle);
  const compactTitle = compactGuideTitle(sectionTitle);
  const compactWant = compactGuideTitle(needle);
  if (!want || !compactWant) return false;
  if (title === want || compactTitle === compactWant) return true;
  if (title.startsWith(`${want} `) || compactTitle.startsWith(`${compactWant} `)) return true;
  return compactTitle.endsWith(` ${compactWant}`) || compactTitle.includes(` ${compactWant} `);
}

export function guideSections(markdown: string): GuideHeadingSection[] {
  const lines = markdown.split(/\r?\n/);
  const headings: Array<Omit<GuideHeadingSection, 'end'>> = [];
  let inFence = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (/^( {0,3})```[^`]*$/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (!match) continue;
    headings.push({ level: match[1]!.length, title: match[2]!, start: index });
  }
  return headings.map((heading, index) => {
    let end = lines.length;
    for (let next = index + 1; next < headings.length; next += 1) {
      if (headings[next]!.level <= heading.level) {
        end = headings[next]!.start;
        break;
      }
    }
    return { ...heading, end };
  });
}

export function skillBootstrapTitles(guide: OfficeGuideName): string[] {
  return [...BASE_BOOTSTRAP_TITLES, ...(EXTRA_BOOTSTRAP_TITLES[guide] ?? [])];
}

export function extractNamedGuideSections(
  markdown: string,
  titles: readonly string[],
  maxChars = OFFICE_SKILL_BOOTSTRAP_MAX_CHARS,
): { matched: string[]; content: string } {
  const lines = markdown.split(/\r?\n/);
  const all = guideSections(markdown);
  const needles = titles.map(normalizeGuideSearch);
  const matches = all.filter(section => {
    if (SKIP_BOOTSTRAP_TITLES.test(normalizeGuideSearch(section.title))) return false;
    return needles.some(needle => guideTitleMatchesNeedle(section.title, needle));
  }).filter((section, _, selected) => !selected.some(other => (
    other !== section && other.start < section.start && other.end >= section.end
  )));
  const content = matches
    .map(section => lines.slice(section.start, section.end).join('\n').trim())
    .filter(Boolean)
    .join('\n\n');
  return {
    matched: matches.map(section => section.title),
    content: content.slice(0, maxChars),
  };
}

export function extractSkillBootstrap(
  markdown: string,
  guide: OfficeGuideName,
  maxChars = OFFICE_SKILL_BOOTSTRAP_MAX_CHARS,
): { matched: string[]; content: string } {
  return extractNamedGuideSections(markdown, skillBootstrapTitles(guide), maxChars);
}

export function resolveLoadSkillGuide(name: string): OfficeGuideName | undefined {
  return LOAD_SKILL_ALIASES[name.trim().toLowerCase()];
}

const SKILL_FILE = String.raw`(?:"\$FILE"|"<file>"|\$FILE|<file>)`;

function isFinalizeOwnedDeliveryGateShell(body: string): boolean {
  return /Delivery Gate PASS|REJECT Gate 1: validate failed|field\[fieldType=page\]|CITATIONS=|SEQ_COUNT=|VISIBLE_FIG=|KPI_FORMULAS=|SDT_N=|SDT_MISSING=|VAL_ERRS=|BAD_CB=|BS_FAIL=|HARDCODE=|namedrange|#OCLI_NOTEVAL|STRIP=\$\(|PRIOR_HIT=\$\(|LEAKS=\$\(|LEAK=\$\(|UOF_HIT=|NSLIDES=|5b-morph|shape\[x>=34cm\]|startswith\("!!|startswith\("#s/i.test(body);
}

function collapseFinalizeOwnedDeliveryGateShells(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const out: string[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? '';
    const open = /^( {0,3})```([\w-]*)[ \t]*$/.exec(line);
    if (!open) {
      out.push(line);
      index += 1;
      continue;
    }
    const language = open[2] ?? '';
    const body: string[] = [];
    index += 1;
    let closed = false;
    while (index < lines.length) {
      const current = lines[index] ?? '';
      if (/^( {0,3})```[ \t]*$/.test(current)) {
        closed = true;
        index += 1;
        break;
      }
      body.push(current);
      index += 1;
    }
    const bodyText = body.join('\n');
    const collapsible = language === '' || /^(bash|sh|zsh)$/i.test(language);
    if (collapsible && isFinalizeOwnedDeliveryGateShell(bodyText)) {
      out.push(
        '```',
        'office_document_finalize',
        'Official skill Delivery Gate. Do not recreate these greps with inspect or Bash.',
        'Re-run only if finalize returns a blocking recovery.',
        '```',
      );
      continue;
    }
    out.push(line, ...body);
    if (closed) out.push('```');
  }
  return out.join('\n');
}

const SKILL_MINIMUM_CYCLE = `### Minimum cycle before "done"

1. After the build batch, at most one outline or \`view issues\`.
2. \`office_document_finalize\` is the official Delivery Gate. Do not repeat validate / issues / text / PAGE / TOC / Excel-error / specialized-gate queries unless it returns a blocking recovery.
3. Visual evidence is the finalize contact sheet (\`grid: auto\` for multi-page Word or multi-slide PowerPoint). Do not Read HTML or screenshot every page yourself.

`;

export function rewriteOfficialSkillInvocations(markdown: string): string {
  return collapseFinalizeOwnedDeliveryGateShells(markdown)
    .replace(
      /### Minimum cycle before "done"[\s\S]*?(?=### |\n## |$)/g,
      SKILL_MINIMUM_CYCLE,
    )
    .replace(/\b(?:officecli(?:\.exe)?\s+)?load_skill\s+([A-Za-z0-9_-]+)/gi, (_match, raw: string) => {
      const guide = resolveLoadSkillGuide(raw) ?? raw;
      return `office_document_guide { guide: '${guide}' }`;
    })
    .replace(
      /(?:^|\n)(?:officecli(?:\.exe)?\s+)?(?:open|save|close)\b[^\n]*/gi,
      '\nSelection resident already owns open/save/close; do not pass them in argv',
    )
    .replace(
      /\bofficecli(?:\.exe)?\s+(?:open|save|close)\b(?:\s+\S+)?/gi,
      'Selection resident already owns open/save/close',
    )
    .replace(
      /After each structural op,\s*`get` it back before stacking on top\./gi,
      'After a batch of structural adds, view outline or get the new parent once before the next burst. Do not get after every add.',
    )
    .replace(
      /After each structural op,\s*`get \/slide\[N\] --depth 1` to confirm shape IDs\./gi,
      'After a slide batch, get `/slide[N] --depth 1` once to confirm shape IDs. Do not get after every add.',
    )
    .replace(
      /Screenshot each slide in turn[^.]*\./gi,
      'office_document_finalize captures a contact sheet (`grid: auto`). Do not screenshot every slide as a separate tool call.',
    )
    .replace(
      /Copy-paste, set `FILE`, and refuse to declare done until every gate prints OK\./gi,
      'Call office_document_finalize and refuse to declare done until it returns deliveryReady. Do not copy-paste these shells.',
    )
    .replace(
      /Copy-paste the docx v2 gate block first\.[^\n]*/gi,
      'Gates 1–5a are office_document_finalize (inherited docx gates plus citation round-trip and SEQ). Do not recreate them with inspect or Bash.',
    )
    .replace(
      /Copy-paste the full block:[\s\S]*?Do not skip or reorder these five\.[^\n]*/i,
      'Gates 1–5a are office_document_finalize (inherited pptx Delivery Gate plus pitch strip / narrative checks). Do not copy-paste the pptx gate block.',
    )
    .replace(
      new RegExp(String.raw`(?:officecli(?:\.exe)?\s+)?view\s+${SKILL_FILE}\s+screenshot\b[^\n]*`, 'gi'),
      'office_document_finalize contact sheet (`grid: auto`) — do not screenshot every page as a separate tool call',
    )
    .replace(
      new RegExp(String.raw`(?:officecli(?:\.exe)?\s+)?view\s+${SKILL_FILE}\s+html\b`, 'gi'),
      'office_document_preview.render',
    )
    .replace(
      new RegExp(String.raw`(?:officecli(?:\.exe)?\s+)?watch\s+${SKILL_FILE}`, 'gi'),
      'office_document_preview.start',
    )
    .replace(
      new RegExp(String.raw`(?:officecli(?:\.exe)?\s+)?validate\s+${SKILL_FILE}(?:\s+\|[^\n]*)?`, 'gi'),
      'office_document_finalize',
    )
    .replace(
      new RegExp(String.raw`(?:officecli(?:\.exe)?\s+)?query\s+${SKILL_FILE}\s+'cell:contains\("#(?:REF!|DIV\/0!|VALUE!|NAME\?|N\/A)"\)'`, 'gi'),
      'office_document_finalize  # Excel error-cell gate',
    )
    .replace(
      new RegExp(String.raw`(?:officecli(?:\.exe)?\s+)?view\s+${SKILL_FILE}\s+text[^\n]*\|[^\n]*`, 'gi'),
      "office_document_inspect argv: ['view', file, 'text'] then scan the returned text (do not pipe through Bash)",
    )
    .replace(
      new RegExp(String.raw`(?:officecli(?:\.exe)?\s+)?query\s+${SKILL_FILE}[^\n]*\|[^\n]*`, 'gi'),
      "office_document_inspect argv: ['query', file, ...] then read JSON (do not pipe through jq/Bash)",
    )
    .replace(/Read the returned HTML path/gi, 'use the preview image')
    .replace(/Read the returned HTML\b/gi, 'use the preview image')
    .replace(/Run every gate below after every form\.[^\n]*/gi, 'Call office_document_finalize after every form. deliveryReady must be true.')
    .replace(/Each gate must print its `OK` line\.[^\n]*/gi, 'Do not recreate these greps with inspect or Bash.')
    .replace(/Refuse to declare done until every pptx Gate 1–5a prints its OK message\./gi, 'Call office_document_finalize and refuse to declare done until deliveryReady.')
    .replace(/Walk every slide and answer/gi, 'Use the finalize contact sheet and answer')
    .replace(/For every page of the paper, answer/gi, 'On the finalize contact sheet, answer')
    .replace(/Walk every sheet \(inherits xlsx v2 visual floor\)/gi, 'Use the finalize contact sheet (inherits xlsx v2 visual floor)')
    .replace(/\bofficecli(?:\.exe)?\s+/gi, '')
    .replace(/\bview html\b/gi, 'office_document_preview.render');
}

export function guideNameForCreateArgv(argv: readonly string[]): OfficeGuideName | undefined {
  const typeIndex = argv.indexOf('--type');
  const typed = typeIndex >= 0 ? argv[typeIndex + 1]?.toLowerCase() : undefined;
  const file = (argv[1] ?? '').toLowerCase();
  if (typed === 'docx' || file.endsWith('.docx')) return 'word';
  if (typed === 'xlsx' || file.endsWith('.xlsx')) return 'excel';
  if (typed === 'pptx' || file.endsWith('.pptx')) return 'pptx';
  return undefined;
}

export function forbiddenCommandRecovery(command: string): string {
  if (command === 'load_skill' || command === 'skills') {
    return 'Use office_document_guide with guide set to word, excel, pptx, academic-paper, word-form, financial-model, data-dashboard, pitch-deck, morph-ppt, or morph-ppt-3d.';
  }
  if (command === 'open' || command === 'save' || command === 'close') {
    return 'Selection owns the resident lease. Continue with office_document_inspect or office_document_edit argv; do not pass open, save, or close.';
  }
  if (command === 'install' || command === 'update' || command === 'config') {
    return 'OfficeCLI is the app-managed runtime. Do not install or configure it from the agent.';
  }
  if (command === 'watch' || command === 'unwatch') {
    return 'Use office_document_preview.start or office_document_preview.stop.';
  }
  return 'Use the matching office_document_* tool instead of this managed OfficeCLI command.';
}
