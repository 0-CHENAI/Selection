/**
 * bun scripts/evals/prompt-context-eval.ts [--live] [--models=Laufry,Opus] [--out=/tmp/prompt-context-eval.json]
 * Read-only local measurements by default. --live sends only synthetic policy probes
 * to the existing configured endpoint. No agent tools execute, no user history is sent.
 */
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import matter from 'gray-matter';
import { getSystemPrompt } from '../../packages/shared/src/prompts/system.ts';
import { estimateTextTokensConservatively as tokens } from '../../packages/shared/src/agent/backend/pi/context-budget.ts';
import { getSessionToolProxyDefs } from '../../packages/shared/src/agent/backend/pi/session-tool-defs.ts';
import { modelVisibleTools } from '../../packages/shared/src/agent/backend/pi/model-visible-tools.ts';
import { promptContextCases, scorePolicyResponse } from './prompt-context-cases.ts';
import { formatSkillCatalog } from '../../packages/shared/src/skills/catalog.ts';
import { loadSkillBySlug } from '../../packages/shared/src/skills/storage.ts';

const root = resolve(import.meta.dir, '../..');
const arg = (name: string, fallback: string) => process.argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3) ?? fallback;
const baseline = arg('baseline', '0ad04d4a');
const caseGroup = arg('cases', 'all');
if (!['all', 'writing'].includes(caseGroup)) throw new Error('Pass --cases=all or --cases=writing');
const selectedCases = caseGroup === 'writing'
  ? promptContextCases.filter(([id]) => id.startsWith('writing-'))
  : promptContextCases;
// Target one failed request without replacing successful observations.
const only = arg('only', '');
const out = arg('out', resolve(tmpdir(), 'selection-prompt-context-eval.json'));
// A sibling file preserves relative imports. Always remove it, including failed runs.
const baselineFile = resolve(root, `packages/shared/src/prompts/.eval-baseline-${process.pid}.ts`);
const writingSkill = loadSkillBySlug('/evaluation/workspace', 'natural-writing');
if (!writingSkill) throw new Error('Bundled natural-writing skill is unavailable');
const writingCatalogFor = (description: string) => formatSkillCatalog([{
  slug: writingSkill.slug,
  title: writingSkill.metadata.name,
  description,
  skillMdPath: join(writingSkill.path, 'SKILL.md'),
}])!;
const priorSkill = execFileSync('git', ['show', `${baseline}:apps/electron/resources/skills/natural-writing/SKILL.md`], { cwd: root, encoding: 'utf8' });
const oldWritingDescription = matter(priorSkill).data.description;
if (typeof oldWritingDescription !== 'string') throw new Error('Baseline natural-writing description is unavailable');
let oldCorePrompt: string;
let createdBaselineFile = false;
const promptArgs = ['', undefined, '/evaluation/workspace', undefined, 'default', 'Selection Backend', false, undefined, false, false] as const;
if (caseGroup === 'writing') {
  // Isolate the skill description change from unrelated system-prompt edits.
  oldCorePrompt = getSystemPrompt(...promptArgs);
} else {
  try {
    writeFileSync(baselineFile, execFileSync('git', ['show', `${baseline}:packages/shared/src/prompts/system.ts`], { cwd: root }), { flag: 'wx' });
    createdBaselineFile = true;
    oldCorePrompt = (await import(baselineFile)).getSystemPrompt(...promptArgs);
  } finally { if (createdBaselineFile) unlinkSync(baselineFile); }
}
const oldPrompt = oldCorePrompt + '\n\n' + writingCatalogFor(oldWritingDescription);
const newPrompt = getSystemPrompt(...promptArgs) + '\n\n' + writingCatalogFor(writingSkill.metadata.description);
const tools = getSessionToolProxyDefs();
const report: { measurement: unknown; scope: string; runs: unknown[] } = {
  measurement: { baseline, system: { before: tokens(oldPrompt), after: tokens(newPrompt) }, toolFactory: { before: tokens(JSON.stringify(tools)), after: tokens(JSON.stringify(modelVisibleTools(tools))) } },
  scope: `${selectedCases.length} synthetic ${caseGroup} policy-comprehension questions with each revision's natural-writing catalog${caseGroup === 'writing' ? ' and the same current system prompt' : ''}, batched per request; three repetitions per prompt/model. Not end-to-end agent execution or document quality.`,
  runs: [],
};
console.log(JSON.stringify(report.measurement));
if (process.argv.includes('--live')) {
  const { CONFIG_DIR } = await import('../../packages/shared/src/config/paths.ts');
  const config = JSON.parse(readFileSync(resolve(CONFIG_DIR, 'config.json'), 'utf8'));
  const connection = config.llmConnections?.find((c: { slug: string }) => c.slug === config.defaultLlmConnection);
  if (connection?.customEndpoint?.api !== 'openai-completions' || !connection.baseUrl) throw new Error('Evaluation requires a configured OpenAI-completions endpoint');
  const models = arg('models', '').split(',').filter(Boolean);
  if (models.length < 1) throw new Error('Pass at least one configured model ID via --models');
  const configured = new Set((connection.models ?? []).map((m: string | { id: string }) => typeof m === 'string' ? m : m.id));
  if (models.some(model => !configured.has(model))) throw new Error('Requested model is not in the configured connection');
  const { getCredentialManager } = await import('../../packages/shared/src/credentials/index.ts');
  const key = await getCredentialManager().getLlmApiKey(connection.slug);
  if (!key) throw new Error('No usable connection credential');
  for (const model of models) {
    for (let repetition = 0; repetition < 3; repetition++) {
      const expected = selectedCases.map((_, i) => ((i * 17 + repetition * 13) % 31) % 2 === 0 ? 'A' : 'B');
      const questions = selectedCases.map(([id, question, correct, wrong], i) => ({ id, question,
        A: expected[i] === 'A' ? correct : wrong, B: expected[i] === 'B' ? correct : wrong }));
      for (const [variant, system] of [['baseline', oldPrompt], ['optimized', newPrompt]] as const) {
        if (only && only !== `${model}:${variant}:${repetition}`) continue;
        const started = Date.now();
        try {
          const response = await fetch(connection.baseUrl.replace(/\/$/, '') + '/chat/completions', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
            body: JSON.stringify({ model, messages: [{ role: 'system', content: system }, { role: 'user', content:
              'Policy comprehension check: choose the better action under your instructions for each hypothetical scenario. Do not execute actions. Reply only with a JSON array of A/B choices in the supplied order.\n' + JSON.stringify(questions) }], max_tokens: 4096, stream: false }),
            signal: AbortSignal.timeout(90000),
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const data = await response.json() as any;
          const text = data.choices?.[0]?.message?.content ?? '';
          const score = scorePolicyResponse(text, expected, selectedCases);
          const writingFailures = score.failures.filter(id => id.startsWith('writing-'));
          const result = { model, repetition, variant, ...score, rawText: text,
            writingFailures,
            latencyMs: Date.now() - started, usage: data.usage };
          report.runs.push(result);
          console.log(JSON.stringify({ model, repetition, variant, passed: result.passed, exactFormat: result.exactFormat, writingFailures, failures: result.failures }));
        } catch (error) {
          // Never persist request headers, endpoint details, or raw provider error bodies.
          report.runs.push({ model, repetition, variant, error: error instanceof Error && /^HTTP \d+$/.test(error.message) ? error.message : 'request, timeout or response parse failure' });
          console.log(JSON.stringify({ model, repetition, variant, failed: true }));
        }
        writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
      }
    }
  }
}
writeFileSync(out, JSON.stringify(report, null, 2) + '\n');
console.log(`Report: ${out}`);
