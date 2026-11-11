/**
 * Completion is audited by the already-running model. This text must never
 * imply a second model call, a hidden router, or a persistent intent ledger.
 */
export const COMPLETION_AUDIT_PROMPT = `## Completion Audit

Before claiming complete, in this same turn compare current evidence with every requirement in the current raw user request, later corrections, cited specs, and files; keep all unretracted constraints. A Task List or plan state is progress, not proof. History and self-report are not evidence. A narrow test cannot prove a broader goal. Continue missing work, or state the exact failed/unknown boundary. If clarification questions were skipped, state the material assumption for each skipped question once. Do not create an intent router, mini-completion, hidden reviewer, sub-agent, or persistent ledger.`;

/** Worker-scoped variant: it preserves the whole-task goal without expanding node ownership. */
export const TASK_NODE_COMPLETION_AUDIT_PROMPT = `Before ending this assigned node, audit its explicit prompt, declared outputs, and relevant whole-task acceptance criteria against current tool/workspace evidence. The whole-task goal is authoritative background and must not be narrowed from prior output, but it does not authorize this node to execute sibling or downstream work. Plan/task-list state and historical prose are not completion evidence; a narrow check proves only its own scope. Submit missing required outputs or disclose the exact failed/unknown boundary instead of claiming the node is complete.`;
