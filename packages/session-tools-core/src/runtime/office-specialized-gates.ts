import type {
  FinalizationCheck,
  OfficeGuideName,
  OfficeStructuredError,
  StructuredWarning,
} from '../office-types.ts';
import {
  officeQueryMatchCount,
  officeTextHaystack,
  outlineFormulaCount,
  outlineSlideCount,
  skillPageRequired,
} from './office-delivery-gates.ts';
import { checkMorphGhostAccumulation, verifyMorphSlide } from './office-recipes.ts';

export const FORM_EXTRA_LEAK_PATTERN = /_{3,}|\bTBD\b|\(fill in\)|coming soon/i;
export const PITCH_STRIP_PATTERN = /(?:^|[^A-Za-z0-9])M (ARR|raised|Series|runway|round|raise)|Series [A-C] · M(?: |$)|runway · M|raised · M|raising ·? M/i;
export const PITCH_EXTRA_LEAK_PATTERN = /\bTBD\b|\(fill in\)|coming soon/i;
export const PITCH_PRIOR_PATTERN = /\b(ex-|former|prior|previously)\b/i;
export const PPTX_EMPTY_PLACEHOLDER_PATTERN = /\(\s*\)|\[\s*\]/;
export const EXCEL_EXTRA_LEAK_PATTERN = /\bTBD\b|\(fill in\)|coming soon/i;
export const MORPH_PRICE_LEAK_PATTERN = /\$[0-9]+(?:\.[0-9]+)?(?:\/(?:mo|month|yr|year|day|wk|week|hr|hour))?|\$\{[A-Z_]+\}/i;
export const EXCEL_CLIPPED_HASH_PATTERN = /###/;
export const FINANCIAL_FAIL_SELECTORS = [
  'cell:contains("IMBALANCED")',
  'cell:contains("CF !=")',
  'cell:contains("S&U IMBALANCE")',
  'cell:contains("#OCLI_NOTEVAL!")',
  'cell:contains("\\\\!")',
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function queryRecords(data: unknown): Record<string, unknown>[] {
  if (!isRecord(data) || !Array.isArray(data.results)) return [];
  return data.results.filter(isRecord);
}

function formatString(record: Record<string, unknown>, key: string): string {
  const format = isRecord(record.format) ? record.format : undefined;
  const value = format?.[key] ?? record[key];
  return typeof value === 'string' ? value : '';
}

function countMatches(pattern: RegExp, text: string): number {
  return text.match(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))?.length ?? 0;
}

function visibleOfficeText(data: unknown): string {
  if (typeof data === 'string') return data;
  if (!isRecord(data)) return '';
  if (typeof data.text === 'string') return data.text;
  if (typeof data.content === 'string') return data.content;
  if (Array.isArray(data.results)) {
    return data.results.flatMap(item => {
      if (typeof item === 'string') return [item];
      if (isRecord(item) && typeof item.text === 'string') return [item.text];
      return [];
    }).join('\n');
  }
  return officeTextHaystack(data);
}

function firstRecord(data: unknown): Record<string, unknown> | undefined {
  return queryRecords(data)[0] ?? (isRecord(data) ? data : undefined);
}

function formatValue(record: Record<string, unknown>, key: string): unknown {
  const format = isRecord(record.format) ? record.format : record;
  return format[key];
}

function numericFormat(record: Record<string, unknown>, key: string): number {
  const value = formatValue(record, key);
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

function autoNamedSeriesCount(record: Record<string, unknown>): number {
  const children = Array.isArray(record.children) ? record.children.filter(isRecord) : [];
  return children.filter(child => {
    if (String(child.type ?? '') !== 'series') return false;
    const name = formatString(child, 'name');
    return /^Series[0-9]+$/i.test(name);
  }).length;
}

function outlineMaxSheetRows(outline: unknown): number {
  if (!isRecord(outline) || !Array.isArray(outline.sheets)) return 0;
  return outline.sheets.reduce((max, sheet) => {
    if (!isRecord(sheet)) return max;
    const rows = typeof sheet.rows === 'number' && Number.isFinite(sheet.rows) ? sheet.rows : 0;
    return Math.max(max, rows);
  }, 0);
}

function sheetDashboardIndex(records: Record<string, unknown>[]): number {
  return records.findIndex(record => {
    const path = String(record.path ?? '');
    const preview = String(record.preview ?? record.name ?? '');
    return path === '/Dashboard' || preview === 'Dashboard';
  });
}

export function uniqueCitationMarkers(text: string): string[] {
  return [...new Set([...text.matchAll(/\[(\d+)\]/g)].map(match => match[1] ?? ''))].filter(Boolean);
}

export function figureTableLabels(text: string): string[] {
  return [...text.matchAll(/\b(?:Figure|Table|Fig\.?)\s+[0-9]+\b/gi)].map(match => match[0] ?? '');
}

export function looksLikeAcademicPaper(text: string): boolean {
  const citations = uniqueCitationMarkers(text);
  if (citations.length >= 2) return true;
  if (citations.length >= 1 && /references|bibliography|参考文献/i.test(text)) return true;
  return figureTableLabels(text).length >= 1;
}

export function looksLikePitchNarrative(text: string, loadedGuides: readonly OfficeGuideName[]): boolean {
  return loadedGuides.includes('pitch-deck')
    || /use of funds|series [abc]|\$\d+m\b|\bTAM\b|\bCAC\b|\bLTV\b/i.test(text);
}

export function looksLikeMorphDeck(text: string, loadedGuides: readonly OfficeGuideName[]): boolean {
  return loadedGuides.includes('morph-ppt')
    || loadedGuides.includes('morph-ppt-3d')
    || /!!actor-|#s\d+-/.test(text);
}

export function outlineHasNamedSheet(outline: unknown, name: string): boolean {
  if (!isRecord(outline) || !Array.isArray(outline.sheets)) return false;
  return outline.sheets.some(sheet => isRecord(sheet) && String(sheet.name ?? '') === name);
}

export function skillContactSheetArgs(
  extension: string,
  outline: unknown,
): { page?: string; grid?: 'auto' } {
  if (extension === '.xlsx') return { page: '1' };
  if (extension === '.pptx') return outlineSlideCount(outline) > 1 ? { grid: 'auto' } : { page: '1' };
  return skillPageRequired(outline) ? { grid: 'auto' } : { page: '1' };
}

function blockingCheck(
  name: string,
  ok: boolean,
  data: unknown,
  error?: Omit<OfficeStructuredError, 'retriable'> & { retriable?: boolean },
): FinalizationCheck {
  return {
    name,
    ok,
    blocking: true,
    data,
    ...(!ok && error ? {
      error: {
        category: error.category,
        code: error.code,
        message: error.message,
        retriable: error.retriable ?? true,
        ...(error.recovery ? { recovery: error.recovery } : {}),
      },
    } : {}),
  };
}

export interface SpecializedGateQuery {
  (selector: string): Promise<{ ok: boolean; data: unknown }>;
}

export interface SpecializedGateGet {
  (path: string, options?: { depth?: number }): Promise<{ ok: boolean; data: unknown }>;
}

function warningCheck(
  name: string,
  ok: boolean,
  data: unknown,
  warning?: StructuredWarning,
): FinalizationCheck {
  return {
    name,
    ok,
    blocking: false,
    data,
    ...(!ok && warning ? { warnings: [warning] } : {}),
  };
}

export async function collectSpecializedSkillChecks(input: {
  extension: string;
  text: unknown;
  outline: unknown;
  loadedGuides: readonly OfficeGuideName[];
  query: SpecializedGateQuery;
  get?: SpecializedGateGet;
}): Promise<FinalizationCheck[]> {
  const checks: FinalizationCheck[] = [];
  const text = visibleOfficeText(input.text);
  const { extension, outline, loadedGuides, query } = input;

  if (extension === '.docx' && looksLikeAcademicPaper(text)) {
    const citations = uniqueCitationMarkers(text);
    const entries = await query('paragraph[hangingIndent]');
    const entryCount = entries.ok ? officeQueryMatchCount(entries.data) : 0;
    const citationOk = citations.length <= entryCount;
    checks.push(blockingCheck(
      'skill_academic_citations',
      citationOk,
      { citations: citations.length, bibliographyEntries: entryCount },
      {
        code: 'academic_citation_roundtrip',
        category: 'conflict',
        message: `Academic Gate 4: ${citations.length} in-text citation markers but only ${entryCount} bibliography entries.`,
        recovery: 'Add the missing reference-list entries, or remove unmatched in-text citations. See academic-paper Delivery Gate 4.',
      },
    ));

    const labels = figureTableLabels(text);
    if (labels.length > 0) {
      const seq = await query('field[fieldType=seq]');
      const seqCount = seq.ok ? officeQueryMatchCount(seq.data) : 0;
      const distinct = new Set(labels.map(label => label.toLowerCase())).size;
      const seqOk = seqCount > 0 && seqCount <= distinct;
      checks.push(blockingCheck(
        'skill_academic_seq',
        seqOk,
        { seqCount, visibleLabels: labels.length, distinctLabels: distinct },
        {
          code: 'academic_seq_mismatch',
          category: 'conflict',
          message: seqCount === 0
            ? `Academic Gate 5a: ${labels.length} Figure/Table labels but 0 SEQ fields.`
            : `Academic Gate 5a: ${seqCount} SEQ fields but only ${distinct} distinct rendered labels.`,
          recovery: 'Insert live SEQ fields and run set / --prop recalcFields=seq. See academic-paper Delivery Gate 5a.',
        },
      ));
    }
  }

  if (extension === '.docx' && (
    loadedGuides.includes('word-form')
    || countMatches(FORM_EXTRA_LEAK_PATTERN, text) > 0
  )) {
    const sdt = await query('sdt');
    const formfield = await query('formfield');
    const fields = await query('field');
    const sdtRecords = sdt.ok ? queryRecords(sdt.data) : [];
    const formfieldCount = formfield.ok ? officeQueryMatchCount(formfield.data) : 0;
    const fieldCount = fields.ok ? officeQueryMatchCount(fields.data) : 0;
    if (sdtRecords.length + formfieldCount + fieldCount > 0 || loadedGuides.includes('word-form')) {
      const missingIdentity = sdtRecords.filter(record => !formatString(record, 'alias') || !formatString(record, 'tag')).length;
      const checkboxes = sdtRecords.filter(record => formatString(record, 'type') === 'checkbox').length;
      const extraLeaks = countMatches(FORM_EXTRA_LEAK_PATTERN, text);
      const rootOutcome = input.get ? await input.get('/') : undefined;
      const root = rootOutcome?.ok ? rootOutcome.data : undefined;
      const protection = formatString(
        (isRecord(root) && Array.isArray(root.results) ? queryRecords(root)[0] : isRecord(root) ? root : {}) ?? {},
        'protection',
      ) || (isRecord(root) && isRecord(root.format) ? String(root.format.protection ?? '') : '');
      checks.push(blockingCheck(
        'skill_form_fields',
        sdtRecords.length + formfieldCount + fieldCount > 0,
        { sdt: sdtRecords.length, formfield: formfieldCount, field: fieldCount },
        {
          code: 'word_form_missing_fields',
          category: 'conflict',
          message: 'Word-form Gate 3: 0 structured fields — this is not a form.',
          recovery: 'Add at least one SDT or formfield. See word-form Delivery Gate.',
        },
      ));
      checks.push(blockingCheck(
        'skill_form_identity',
        missingIdentity === 0,
        { missingIdentity },
        {
          code: 'word_form_sdt_identity',
          category: 'conflict',
          message: `Word-form Gate 4: ${missingIdentity} SDT(s) missing alias or tag.`,
          recovery: 'Set alias and tag on every SDT at add time. See word-form Delivery Gate.',
        },
      ));
      checks.push(blockingCheck(
        'skill_form_protection',
        protection === 'forms',
        { protection: protection || 'none' },
        {
          code: 'word_form_protection',
          category: 'conflict',
          message: `Word-form Gate 5: protection is '${protection || 'none'}', expected 'forms'.`,
          recovery: 'Set / --prop protection=forms. See word-form Delivery Gate.',
        },
      ));
      checks.push(blockingCheck(
        'skill_form_checkbox',
        checkboxes === 0,
        { checkboxes },
        {
          code: 'word_form_sdt_checkbox',
          category: 'conflict',
          message: `Word-form Gate 6: ${checkboxes} SDT with type=checkbox.`,
          recovery: 'Use formfield checkboxes instead of SDT type=checkbox.',
        },
      ));
      checks.push(blockingCheck(
        'skill_form_placeholder_leak',
        extraLeaks === 0,
        { extraLeaks },
        {
          code: 'word_form_placeholder_leak',
          category: 'conflict',
          message: `Word-form Gate 2: ${extraLeaks} underscore / TBD / fill-in leak(s).`,
          recovery: 'Replace visual underscores and TBD copy with real field labels.',
        },
      ));
    }
  }

  if (extension === '.xlsx' && outlineFormulaCount(outline) > 0) {
    let failMatches = 0;
    const selectors: string[] = [];
    for (const selector of FINANCIAL_FAIL_SELECTORS) {
      const outcome = await query(selector);
      const matches = outcome.ok ? officeQueryMatchCount(outcome.data) : 0;
      if (matches > 0) {
        failMatches += matches;
        selectors.push(selector);
      }
    }
    if (failMatches > 0 || loadedGuides.includes('financial-model')) {
      checks.push(blockingCheck(
        'skill_financial_integrity',
        failMatches === 0,
        { failMatches, selectors },
        {
          code: 'xlsx_financial_imbalance',
          category: 'conflict',
          message: `Financial Gate 4/5: ${failMatches} imbalance, recon, or unevaluated valuation cell(s).`,
          recovery: 'Fix IMBALANCED / CF != / S&U / #OCLI_NOTEVAL! / mangled \\\\! formulas. See financial-model Audit & Delivery Gate.',
        },
      ));
    }
    if (loadedGuides.includes('financial-model')) {
      const named = await query('namedrange');
      const namedCount = named.ok ? officeQueryMatchCount(named.data) : 0;
      checks.push(warningCheck(
        'skill_financial_named_ranges',
        namedCount >= 3,
        { namedCount },
        {
          code: 'xlsx_financial_named_ranges',
          message: `Financial Gate 6: only ${namedCount} named ranges (official floor is 3).`,
          severity: 'high',
          recovery: 'Declare named ranges for model drivers. See financial-model Audit & Delivery Gate 6.',
        },
      ));
    }
  }

  if (extension === '.xlsx') {
    const clipped = countMatches(EXCEL_CLIPPED_HASH_PATTERN, text);
    if (clipped > 0) {
      checks.push(blockingCheck(
        'skill_excel_clipped_hash',
        false,
        { clipped },
        {
          code: 'xlsx_clipped_hash',
          category: 'conflict',
          message: `Excel visual floor: ${clipped} ### clipped-value leak(s).`,
          recovery: 'Widen the column or set wrapText. See excel Visual delivery floor.',
        },
      ));
    }
    const extraLeaks = countMatches(EXCEL_EXTRA_LEAK_PATTERN, text);
    if (extraLeaks > 0) {
      checks.push(blockingCheck(
        'skill_excel_placeholder_extra',
        false,
        { extraLeaks },
        {
          code: 'xlsx_placeholder_extra',
          category: 'conflict',
          message: `Excel / financial Gate 6.1: ${extraLeaks} TBD / fill-in / coming-soon leak(s).`,
          recovery: 'Replace TBD and fill-in tokens with real values. See excel visual floor and financial-model Gate 6.1.',
        },
      ));
    }
  }

  if (extension === '.xlsx' && (outlineHasNamedSheet(outline, 'Dashboard') || loadedGuides.includes('data-dashboard'))) {
    const kpi = await query('Dashboard!:has(formula)');
    const charts = await query('chart');
    const kpiCount = kpi.ok ? officeQueryMatchCount(kpi.data) : 0;
    const chartRecords = charts.ok ? queryRecords(charts.data) : [];
    const chartCount = charts.ok ? officeQueryMatchCount(charts.data) : 0;
    checks.push(blockingCheck(
      'skill_dashboard_kpis',
      kpiCount >= 2,
      { kpiCount },
      {
        code: 'xlsx_dashboard_kpi_formulas',
        category: 'conflict',
        message: `Dashboard Gate 1: ${kpiCount} formula cells on Dashboard (need ≥ 2).`,
        recovery: 'Give every planned KPI a formula. See data-dashboard Delivery Gate.',
      },
    ));
    checks.push(blockingCheck(
      'skill_dashboard_charts',
      chartCount >= 1,
      { chartCount },
      {
        code: 'xlsx_dashboard_charts',
        category: 'conflict',
        message: 'Dashboard Gate 2: zero charts.',
        recovery: 'Add at least one titled chart with data. See data-dashboard Delivery Gate.',
      },
    ));
    if (chartCount >= 1) {
      let untitled = 0;
      let autoNamed = 0;
      for (let index = 0; index < Math.max(chartRecords.length, chartCount); index += 1) {
        const fallback = chartRecords[index] ?? {};
        const path = typeof fallback.path === 'string' && fallback.path
          ? fallback.path
          : `/Dashboard/chart[${index + 1}]`;
        const detailOutcome = input.get ? await input.get(path) : undefined;
        const detail = detailOutcome?.ok
          ? (firstRecord(detailOutcome.data) ?? fallback)
          : fallback;
        const seriesCount = numericFormat(detail, 'seriesCount');
        const title = formatString(detail, 'title') || (typeof detail.title === 'string' ? detail.title : '');
        if (seriesCount === 0 || !title) untitled += 1;
        autoNamed += autoNamedSeriesCount(detail);
      }
      checks.push(blockingCheck(
        'skill_dashboard_chart_quality',
        untitled === 0,
        { untitled },
        {
          code: 'xlsx_dashboard_chart_untitled',
          category: 'conflict',
          message: `Dashboard Gate 2: ${untitled} chart(s) missing seriesCount or title.`,
          recovery: 'Give every chart a title and at least one series. See data-dashboard Delivery Gate 2.',
        },
      ));
      checks.push(blockingCheck(
        'skill_dashboard_series_names',
        autoNamed === 0,
        { autoNamed },
        {
          code: 'xlsx_dashboard_series1',
          category: 'conflict',
          message: `Dashboard Gate 3: ${autoNamed} auto-named SeriesN legend item(s).`,
          recovery: 'Name every chart series. See data-dashboard Delivery Gate 3.',
        },
      ));
    }
    if (outlineMaxSheetRows(outline) >= 10) {
      const cf = await query('conditionalformatting');
      const cfCount = cf.ok ? officeQueryMatchCount(cf.data) : 0;
      checks.push(blockingCheck(
        'skill_dashboard_conditional_format',
        cfCount >= 1,
        { cfCount },
        {
          code: 'xlsx_dashboard_cf_missing',
          category: 'conflict',
          message: 'Dashboard Gate 4: zero conditional-formatting rules on a 10+ row data sheet.',
          recovery: 'Add at least one CF rule on the Data sheet. See data-dashboard Delivery Gate 4.',
        },
      ));
    }
    if (input.get) {
      const sheets = await query('sheet');
      const workbook = await input.get('/workbook');
      const sheetRecords = sheets.ok ? queryRecords(sheets.data) : [];
      const dashIdx = sheetDashboardIndex(sheetRecords);
      const workbookRecord = workbook.ok ? (firstRecord(workbook.data) ?? {}) : {};
      const activeTab = numericFormat(workbookRecord, 'activeTab');
      const fullCalc = formatValue(workbookRecord, 'calc.fullCalcOnLoad') === true
        || formatValue(workbookRecord, 'calc.fullCalcOnLoad') === 'true'
        || formatValue(workbookRecord, 'fullCalcOnLoad') === true
        || formatValue(workbookRecord, 'fullCalcOnLoad') === 'true';
      const tabOk = dashIdx < 0 || activeTab === dashIdx;
      checks.push(blockingCheck(
        'skill_dashboard_workbook',
        tabOk && fullCalc,
        { activeTab, dashboardIndex: dashIdx, fullCalcOnLoad: fullCalc },
        {
          code: 'xlsx_dashboard_workbook',
          category: 'conflict',
          message: `Dashboard Gate 5: activeTab=${activeTab} Dashboard=${dashIdx} fullCalcOnLoad=${fullCalc}.`,
          recovery: 'Set workbook activeTab to Dashboard and calc.fullCalcOnLoad=true. See data-dashboard Delivery Gate 5.',
        },
      ));
    }
  }

  if (extension === '.pptx') {
    const emptyPlaceholders = countMatches(PPTX_EMPTY_PLACEHOLDER_PATTERN, text);
    if (emptyPlaceholders > 0) {
      checks.push(blockingCheck(
        'skill_pptx_empty_placeholder',
        false,
        { emptyPlaceholders },
        {
          code: 'pptx_empty_placeholder',
          category: 'conflict',
          message: `pptx Gate 2b: ${emptyPlaceholders} empty () / [] leftover(s).`,
          recovery: 'Fill or remove empty parentheses and brackets. See pptx Delivery Gate 2b.',
        },
      ));
    }
    const strip = countMatches(PITCH_STRIP_PATTERN, text);
    const pitchNarrative = looksLikePitchNarrative(text, loadedGuides);
    if (strip > 0 || pitchNarrative) {
      checks.push(blockingCheck(
        'skill_pitch_strip',
        strip === 0,
        { strip },
        {
          code: 'pptx_pitch_dollar_strip',
          category: 'conflict',
          message: `Pitch Gate 2b: ${strip} $ strip signature(s) (bare "M ARR" / "Series · M").`,
          recovery: 'Re-issue the text with single quotes so $ amounts survive. See pitch-deck Delivery Gate.',
        },
      ));
    }
    if (pitchNarrative) {
      const extraLeaks = countMatches(PITCH_EXTRA_LEAK_PATTERN, text);
      checks.push(blockingCheck(
        'skill_pitch_placeholder_extra',
        extraLeaks === 0,
        { extraLeaks },
        {
          code: 'pptx_pitch_placeholder_extra',
          category: 'conflict',
          message: `Pitch Gate 6.1: ${extraLeaks} TBD / fill-in / coming-soon leak(s).`,
          recovery: 'Replace TBD and fill-in tokens. See pitch-deck Delivery Gate 6.1.',
        },
      ));
      const funds = await query('shape:contains("Use of Funds")');
      const fundsCount = funds.ok ? officeQueryMatchCount(funds.data) : 0;
      checks.push(blockingCheck(
        'skill_pitch_use_of_funds',
        fundsCount >= 1,
        { fundsCount },
        {
          code: 'pptx_pitch_use_of_funds',
          category: 'conflict',
          message: 'Pitch Gate 6.4: ask slide missing Use of Funds.',
          recovery: 'Add a Use of Funds block on the ask slide. See pitch-deck Delivery Gate 6.',
        },
      ));
      const prior = countMatches(PITCH_PRIOR_PATTERN, text);
      checks.push(blockingCheck(
        'skill_pitch_prior_company',
        prior >= 1,
        { prior },
        {
          code: 'pptx_pitch_prior_company',
          category: 'conflict',
          message: 'Pitch Gate 6.5: team slide has no prior-company credentials.',
          recovery: 'Add ex- / former / prior / previously on the team slide. See pitch-deck Delivery Gate 6.5.',
        },
      ));
      const tam = await query('shape:contains("TAM")');
      const cac = await query('shape:contains("CAC")');
      const ltv = await query('shape:contains("LTV")');
      const charts = await query('chart');
      const tamCount = tam.ok ? officeQueryMatchCount(tam.data) : 0;
      const unitEcon = (cac.ok ? officeQueryMatchCount(cac.data) : 0)
        + (ltv.ok ? officeQueryMatchCount(ltv.data) : 0);
      const axisMin = charts.ok
        ? queryRecords(charts.data).filter(record => {
          const value = formatValue(record, 'axisMin') ?? formatValue(record, 'axismin');
          return value === 0 || value === '0';
        }).length
        : 0;
      checks.push(warningCheck(
        'skill_pitch_tam',
        tamCount >= 1,
        { tamCount },
        {
          code: 'pptx_pitch_tam',
          message: 'Pitch Gate 6.2: no TAM mention — confirm stage is Seed / Bridge if intentional.',
          severity: 'high',
          recovery: 'Add a TAM / SAM / SOM slide for Series A+. See pitch-deck Delivery Gate 6.2.',
        },
      ));
      checks.push(warningCheck(
        'skill_pitch_unit_econ',
        unitEcon >= 1,
        { unitEcon },
        {
          code: 'pptx_pitch_unit_econ',
          message: 'Pitch Gate 6.3: no CAC / LTV — confirm stage Seed/A if intentional, REJECT if Series B+.',
          severity: 'high',
          recovery: 'Surface CAC or LTV on the model slide. See pitch-deck Delivery Gate 6.3.',
        },
      ));
      checks.push(warningCheck(
        'skill_pitch_axis_min',
        axisMin >= 1,
        { axisMin },
        {
          code: 'pptx_pitch_axis_min',
          message: 'Pitch Gate 6.6: no chart sets axisMin=0 — confirm no ARR/revenue line chart, or add --prop axismin=0.',
          severity: 'high',
          recovery: 'Set axismin=0 on traction charts. See pitch-deck Delivery Gate 6.6.',
        },
      ));
    }

    if (looksLikeMorphDeck(text, loadedGuides)) {
      const priceLeaks = countMatches(MORPH_PRICE_LEAK_PATTERN, text);
      checks.push(blockingCheck(
        'skill_morph_price_leak',
        priceLeaks === 0,
        { priceLeaks },
        {
          code: 'pptx_morph_price_leak',
          category: 'conflict',
          message: `Morph Gate 2: ${priceLeaks} price / \${VAR} token leak(s).`,
          recovery: 'Single-quote --prop text so $9/mo survives. See morph-ppt Delivery Gate.',
        },
      ));
      if (input.get) {
        const totalSlides = Math.min(outlineSlideCount(outline) || 0, 20);
        const slides = [];
        let previousData: unknown;
        for (let slide = 1; slide <= totalSlides; slide += 1) {
          const current = await input.get(`/slide[${slide}]`, { depth: 1 });
          if (!current.ok) {
            slides.push({ slide, ok: false, issues: [{ code: 'missing_morph_transition', message: 'Slide get failed.', blocking: true }] });
            continue;
          }
          slides.push({ slide, ...verifyMorphSlide(current.data, previousData, slide > 1 ? slide - 1 : undefined) });
          previousData = current.data;
        }
        const ghosts = totalSlides < 1
          ? { ok: true, issues: [] }
          : await (async () => {
            const outcome = await query('shape[x>=34cm]');
            return outcome.ok
              ? checkMorphGhostAccumulation(outcome.data, totalSlides)
              : { ok: false, issues: [{ code: 'ghost_accumulation' as const, message: 'Ghost query failed.', blocking: true }] };
          })();
        const morphOk = slides.every(slide => slide.ok) && ghosts.ok;
        checks.push(blockingCheck(
          'skill_morph_final_check',
          morphOk,
          { totalSlides, failedSlides: slides.filter(slide => !slide.ok).map(slide => slide.slide), accumulation: ghosts.ok },
          {
            code: 'pptx_morph_final_check',
            category: 'conflict',
            message: 'Morph Gate 5b: transition, ghost, or accumulation issues.',
            recovery: 'Use office_document_inspect recipe.final-check, then ghost leftover #sN- actors. See morph-ppt Delivery Gate.',
          },
        ));
      }
    }
  }

  return checks;
}

export function formDocumentSkipsIssueGate(checks: readonly FinalizationCheck[]): boolean {
  return checks.some(check => check.name.startsWith('skill_form_'));
}

export function cachedPreviewMatchesSkillVisual(
  data: unknown,
  intended: { page?: string; grid?: 'auto' },
): boolean {
  if (!isRecord(data) || !isRecord(data.render)) return false;
  const grid = data.render.grid;
  const page = data.render.page;
  if (intended.grid === 'auto') return grid === 'auto';
  return page === intended.page && grid === undefined;
}
