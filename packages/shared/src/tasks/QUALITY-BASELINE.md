# Swarm / Conductor quality baseline

Recorded against `origin/test` at `f0a13504` before v3 scheduling changes.
Phase 0 metrics are additive; v1/v2 contracts stay in `TaskRunner.test.ts`.

## Locked scenarios

1. Fixed Swarm split — coordinator only splits when independent tool tracks exist.
2. Reject invalid split — stay in the parent session when the spawn bar is not met.
3. DAG parallel — ready session nodes honor `max_parallel` and definition order on v1/v2.
4. Data transforms — filter / aggregate / parallel / route stay local (no model call).
5. Verify + repair — FAIL re-runs named nodes and dependents within `max_iterations`.
6. Approval cleanup — reject/timeout fails the node; stop still runs ready `finally`.
7. Crash recovery — scan marks in-flight nodes `interrupted` and does not auto-schedule.

## Pre-change measurement notes

- Token accounting is per child session delta at completion.
- v2 orchestrate checkpoints notify the coordinator and continue immediately.
- Same-run `cache:pure` is in-memory only.
- Swarm chat budget is fixed at 262144 tokens and is not user-editable.

Swarm split / reject-invalid-split stay in `spawn-session-orchestration`
(`assessSpawnQualification`) plus `quality-scenarios.test.ts`. They are not
TaskRunner fixtures.

Real-model 21/21, packaged Electron, and dogfood results must be recorded
separately; unit-test green is not a substitute.
