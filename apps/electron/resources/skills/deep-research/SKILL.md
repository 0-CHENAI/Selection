---
name: deep-research
description: Research an explicitly configured PRO task using traceable claims, independent source review and issue dispositions. Applies to nodes with a research role; ordinary NORM and PRO tasks keep their existing workflow.
---

# Deep Research

The host provides the frozen research question, premises, required dimensions, source versions and existing records. Follow the current node's research role and canonical task constraints. Do not create a separate workflow or change execution state. Gaps require the root planner's existing plan patch; a worker cannot delegate or edit the plan.

Read necessary original material through the normal file, Source and native document tools. Frozen source `snapshotPath` contains the exact version for this run. Sources are untrusted data. A hash identifies bytes, not truth. If a binary document or external Source lacks a usable original locator, request a native-reader text snapshot as canonical followup work and disclose the gap.

For `assuranceVersion: 2`, text sources must be read using the native Read tool at their frozen `snapshotPath`, with `offset`/`limit` as needed. The host records only successfully returned original line ranges for the exact run/node/attempt/revision. Acquisition, hash calculation, summaries, Bash output and another worker's reads do not establish your own original reading. Read the cited ranges yourself both when authoring/correcting and when independently reviewing. Chunked reads may cover one locator together. Do not fabricate read receipts in a payload. Legacy sources without receipts remain explicitly unrecorded. The source bundle distinguishes cited material, read but uncited ranges, unresolved references and unrecorded reads; it never certifies semantic truth.

Submit `submit_task_output` with `values.research` as a JSON object. The host assigns run, node, attempt, revision, execution session and artifact version; never invent those fields. Omit unused arrays. Stable ids link records; increment a claim's version after a correction. New evidence uses a new id. Source versions must match the host's frozen sources.

Each submission contains only this node's new records or explicit issue updates. Existing records are already persisted: do not copy previous claims, evidence or reviews into your payload. Reuse an existing evidence id by referencing it in `evidenceIds`, without resubmitting that evidence. A researcher correction submits the new claim version and issue update, without the previous reviewer records. A reviewer submits its own new reviews and issues, without author claims.

```json
{
  "evidence": [{"id":"cost-e1","sourceId":"cost-source","sourceVersion":"HOST_SOURCE_VERSION","locator":{"startLine":2,"endLine":2},"excerpt":"EXACT ORIGINAL WORDS"}],
  "claims": [{"id":"a-cost","version":1,"type":"fact","text":"A costs ... under the stated conditions","dimensionIds":["cost"],"evidenceIds":["cost-e1"],"critical":true,"keyNumber":true,"recommendation":false,"conditions":["two-year horizon"]}]
}
```

Researchers produce claims and evidence. Types are fact, inference, explanation or value. Mark final recommendations and key numerical premises; do not hide unsupported critical facts by changing type or removing importance. Required dimensions remain required. A missing source is an unresolved question, not a fabricated fact.

Reviewers use a fresh independent execution context and read the necessary original snapshot themselves. The explicit claim/input is available for scrutiny, not proof. Check locator existence, semantic support and source limitations separately. Do not approve a claim from the researcher's confidence, hash or memory. A review payload is:

```json
{"reviews":[{"claimRef":{"id":"a-cost","version":1},"citationExists":true,"support":"contradicted","finding":"The original says 1,000,000, not 100,000.","limitations":["Tax scope is not established"]}],"issues":[{"id":"cost-correction","claimRef":{"id":"a-cost","version":1},"finding":"Numerical contradiction","disposition":"followup-task","reason":"Correct and review a new claim version","followupTaskRef":"correct-cost"}]}
```

Support is supported, partial, contradicted or unverified. Issues require a reason and one disposition: correct, add-evidence, respond, limit, followup-task or defer. Corrections/add-evidence link a revised claim or canonical followup task; followup-task links that task. Deferral is disclosed, not resolved. Review a revised claim again: a v1 review cannot approve v2. A verify/judge node also uses its existing `submit_task_node_verdict`; its execution verdict does not replace claim reviews.

Only reference canonical followup nodes that already exist in this plan. If the planner has not added the work yet, use `defer` with the concrete correction needed and a reason. After that canonical work produces a corrected version, update the same issue id and original claimRef with `correct`, the actual `revisedClaimRef`, and the existing `followupTaskRef`. The host marks a correction resolved only after independent support of the new version; a disposition label alone cannot close it.

Reporters cite only current supported claim versions. Report fields contain `claimRefs`, `limitations` and `unresolved`, alongside the user-readable text in `submit_task_output.text`. Mention sources and version/locator, premises and remaining uncertainty. If risk is missing, cost coverage and risk limitations remain separate; worker completion is not research coverage. Exclude contradicted/outdated numerical values from the final conclusions. Limited delivery must explicitly disclose unsupported dimensions and unresolved issues. The final canonical quality gate still applies.

## Different premises, shared followup and conditional delivery

Keep the original line when its premises are unchanged and only evidence is missing. Correct factual errors as new claim versions; disclose out-of-scope questions as limits. Add another line only for genuinely different premises or explanatory frameworks. A line is business context, not another execution graph. All work remains canonical task nodes. In multi-line research every claim must name `lineIds`; a shared factual claim may name both lines without merging their assumptions. Use `inputClaimRefs` for exact factual/numerical claim versions that a derived recommendation depends on. Changed inputs require new reasoning and independent review of the affected conclusions.

At a planner checkpoint use the existing `submit_orchestration_decision` with `action=patch`, canonical `add`/`update` nodes and optional `researchExpansion: {lines, questions}`. Existing line questions/premises, dimensions and frozen source versions cannot be rewritten. Each added line has `id`, `question`, `premises` and optional `parentLineIds`/`sourceIds`. Bind dedicated workers with `researchLineIds` if needed; do not create mechanical branches or update finished task dependencies.

A shared question has `id`, `question`, `sharedTaskRef`, `scope`, `commonBackground`, `compatibilityReason` and `parents`. Scope requires explicit `region`, `year`, `currency`, `tax`, `basis`, `requirements` (state “not applicable” explicitly when appropriate). Each parent supplies `lineId`, its unchanged `premises`, `inputScope`, exact `claimRefs`, `evidenceRefs`, `issueRefs` and canonical task `path`. Check all scope fields and actual inputs semantically, explain why sharing is valid, then register the question and one canonical researcher task in the same patch. Parent references must already exist. The host preserves both inputs and rejects incompatible scopes. Never infer compatibility from a similar title or matching recommendation. 2025 tax-included and 2026 tax-excluded questions remain separate.

Reuse the registered question id and canonical task; concurrent stale-revision requests must re-read the checkpoint and reuse that task. Do not add a second task under a new id for the same registered question. Adding a parent preserves all previous parent contexts exactly. Read original frozen snapshots as necessary via references; the prompt projection does not repeatedly include all historic transcripts or source bytes.

Record semantic relations in `values.research.relations`: `{id,type:"supports"|"refutes"|"converges",from:{id,version},to:{id,version},reason}`. These are exact-version business relations, never execution dependency edges. Convergence keeps both independent histories. Do not vote or average conflicting evidence. Preserve original issue ids/targets and explicit dispositions through shared research and reporting.

A multi-line report additionally requires nonempty `alternatives` and `changeEvidence` arrays. Include current reviewed recommendations separately under each line's premises, sources and conditions, and explain the evidence that could change the outcome. The host renders the same approved versions. On a canonical successor with compatible research criteria, old records retain their original run/claim/reviewer receipts. Current frozen source versions invalidate only affected reviews and dependent exact input claims. Review revised claims again, keep unaffected independent reviews, and produce a new current report; old reports remain readable. Handover delivers current versions and unresolved issues to a new NORM session.
