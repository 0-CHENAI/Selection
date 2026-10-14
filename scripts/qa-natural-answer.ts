#!/usr/bin/env bun
/**
 * Real-model acceptance for natural-v1 answer delivery.
 * Usage: QA_MODELS=MO,Laufry bun run scripts/qa-natural-answer.ts
 * Records, per turn: delta timeline by phase, commit latency, recovery use and
 * whether the committed answer equals the streamed body. Answer text itself is
 * only summarised (length + head) in the log.
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getWorkspaces, getLlmConnections, getDefaultLlmConnection } from '@craft-agent/shared/config';
import { setBundledAssetsRoot } from '@craft-agent/shared/utils';
import { SessionManager, setSessionPlatform } from '@craft-agent/server-core/sessions';
import { createHeadlessPlatform } from '@craft-agent/server-core/runtime';

const repo = resolve(import.meta.dir, '..');
setBundledAssetsRoot(join(repo, 'apps/electron'));
setSessionPlatform(createHeadlessPlatform());
const ws = getWorkspaces()[0]!;
const connection = getLlmConnections().find(c => c.slug === (process.env.QA_CONNECTION ?? getDefaultLlmConnection()))!;
const models = (process.env.QA_MODELS ?? connection.defaultModel ?? '').split(',').filter(Boolean);
const turns: string[] = process.env.QA_PROMPTS ? JSON.parse(process.env.QA_PROMPTS) : [
  '你知道蒙提霍尔问题么？简要解释一下。',
  '用 Python 实际模拟 20000 次，验证换门和不换门的胜率，然后给出结论和一张对比表。',
];

type Ev = { type: string; [key: string]: any };
const manager = new SessionManager();
let events: Ev[] = [];
manager.setEventSink((_channel, _target, ...args) => {
  const event = args.find(e => e && typeof e === 'object' && 'type' in e) as Ev | undefined;
  if (event) events.push({ ...event, at: Date.now() });
});
const results: unknown[] = [];
const dumps: Array<{ model: string; prompt: string; startedAt: number; events: Ev[] }> = [];
try {
  await manager.reinitializeAuth();
  for (const model of models) {
    const workDir = mkdtempSync(join(tmpdir(), 'natural-answer-'));
    const session = await manager.createSession(ws.id, { name: `natural-v1 QA ${model}`, hidden: true, swarmEnabled: false,
      workMode: 'NORM', permissionMode: 'allow-all', thinkingLevel: 'low', workingDirectory: workDir, model, llmConnection: connection.slug });
    for (const prompt of turns) {
      events = [];
      const startedAt = Date.now();
      let error: string | undefined;
      try { await manager.sendMessage(session.id, prompt) } catch (e) { error = String(e) }
      await manager.flushAllSessions();
      const actual = await manager.getSession(session.id);
      const owner = actual?.messages.findLast(m => m.role === 'user');
      const deltas = events.filter(e => e.type === 'text_delta');
      const committed = events.find(e => e.type === 'text_complete' && e.answerCommitted);
      const finalDeltas = deltas.filter(d => d.phase === 'final');
      const streamedAnswer = deltas.filter(d => d.turnId === committed?.turnId).map(d => d.delta).join('');
      const complete = events.find(e => e.type === 'complete');
      const result = {
        model, prompt: prompt.slice(0, 20), sessionId: session.id, error,
        recoveryUsed: !!owner?.answerRecoveryAttempted,
        tools: actual?.messages.filter(m => m.role === 'tool').map(m => m.toolName),
        deltaCount: deltas.length,
        notePhaseDeltas: deltas.filter(d => d.phase === 'intermediate').length,
        finalPhaseDeltas: finalDeltas.length,
        markerUsed: finalDeltas.length > 0,
        firstDeltaMs: deltas[0] ? deltas[0].at - startedAt : null,
        firstAnswerDeltaMs: (finalDeltas[0] ?? deltas.find(d => d.turnId === committed?.turnId))?.at - startedAt,
        commitMs: committed ? committed.at - startedAt : null,
        commitAfterLastDeltaMs: committed && deltas.length ? committed.at - deltas.at(-1)!.at : null,
        completeMs: complete ? complete.at - startedAt : null,
        committedChars: committed?.text.length ?? 0,
        committedHead: committed?.text.slice(0, 40),
        streamedEqualsCommitted: streamedAnswer.trim() === committed?.text.trim(),
        markerLeaked: !!committed?.text.includes('<<<FINAL_ANSWER>>>'),
        answerPreviewEvents: events.filter(e => e.type === 'answer_preview').length,
        errors: actual?.messages.filter(m => m.role === 'error').map(m => m.content.slice(0, 80)),
      };
      results.push(result);
      if (process.env.QA_DUMP) dumps.push({ model, prompt, startedAt, events: structuredClone(events) });
      console.log(JSON.stringify(result));
    }
  }
} finally {
  await manager.flushAllSessions();
  manager.cleanup();
  if (process.env.QA_DUMP) (await import('node:fs')).writeFileSync(process.env.QA_DUMP, JSON.stringify(dumps));
}
process.exit(0);
