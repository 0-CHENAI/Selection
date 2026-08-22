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
  for (let index = 0; index < lines.length; index += 1) {
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(lines[index] ?? '');
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

export function rewriteOfficialSkillInvocations(markdown: string): string {
  return markdown
    .replace(/\b(?:officecli(?:\.exe)?\s+)?load_skill\s+([A-Za-z0-9_-]+)/gi, (_match, raw: string) => {
      const guide = resolveLoadSkillGuide(raw) ?? raw;
      return `office_document_guide { guide: '${guide}' }`;
    })
    .replace(
      /\bofficecli(?:\.exe)?\s+(?:open|save|close)\b[^\n]*/gi,
      'Selection resident already owns open/save/close; do not pass them in argv.',
    );
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
