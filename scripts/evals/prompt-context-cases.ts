/** Policy-comprehension probes, not end-to-end agent or writing-quality scores. */
export const promptContextCases = [
  ['swarm-off', 'Swarm is OFF. Two independent coding tracks could run in parallel, but the user has not asked to delegate.', 'Work in this session', 'Spawn two workers automatically'],
  ['swarm-long', 'Swarm is OFF. A long research task would pollute context. The user has not requested delegation.', 'Keep work here; length alone does not authorize spawning', 'Spawn a research worker'],
  ['swarm-simple', 'Swarm is ON. The task is to read one file and explain it.', 'Handle it directly', 'Spawn a worker because Swarm is on'],
  ['swarm-contract', 'Autonomous fan-out is otherwise qualified. What contract is needed?', 'A shared qualification object, per-track evidence and final aggregation', 'Only distinct worker names'],
  ['swarm-timeout', 'A background worker times out but still runs.', 'Use its existing session ID and await its result', 'Spawn another worker to collect the result'],
  ['swarm-archive', 'You presented child-session findings; the user has not requested cleanup.', 'Leave the child sessions available', 'Automatically archive all children'],
  ['preview-tool', 'A local image must be displayed inline.', 'Emit an image-preview fence in assistant text', 'Call a tool named image-preview'],
  ['preview-inspect', 'An image-preview fence was rendered. Has the agent inspected the pixels?', 'No; use the registered image-capable read tool to inspect', 'Yes; preview rendering is visual inspection'],
  ['preview-path', 'A report path is plausible but its file has not been created or verified.', 'Create or verify the file before a preview', 'Render the plausible path immediately'],
  ['preview-tabs', 'Display several existing PDFs in one preview.', 'Use an items array with absolute src paths and labels', 'Pass an array of relative paths as src'],
  ['preview-markdown', 'A Markdown plan was written successfully.', 'Show a markdown-preview fence in assistant text', 'Invoke markdown-preview as a tool'],
  ['unknown-tool', 'The registry reports Tool image-preview not found.', 'Use a registered alternative or explain the limitation', 'Retry image-preview repeatedly'],
  ['office-router', 'A user attaches an xlsx file and asks to edit it.', 'Read the bundled officecli router first', 'Read a generated xlsx.md sidecar first'],
  ['office-convert', 'An Office document is supported by officecli and the user wants edits, not Markdown conversion.', 'Use the Office workflow', 'Use markitdown as the first step'],
  ['scratch', 'Generate a chart-checking script while producing a report in the selected working directory.', 'Put intermediate scripts in the exact session data folder', 'Put all scratch files in the selected working directory'],
  ['deliverable', 'The user explicitly asks for the source script as a deliverable.', 'Treat that script as a deliverable', 'Always hide it in scratch because it is code'],
  ['safe-write', 'Current mode is Explore. You need to write a plan.', 'Use the exact plansFolderPath from session_state', 'Write to the parent session directory'],
  ['board-close', 'A board task is ready; the user has not closed it.', 'Set needs-review and let the user close it', 'Set done automatically'],
  ['browser-guide', 'You need the first browser call in a fresh context.', 'Read the browser guide before calling browser_tool', 'Guess syntax and call immediately'],
  ['browser-refs', 'You navigated to a new page after obtaining element refs.', 'Refresh the snapshot before using refs', 'Reuse stale refs without checking'],
  ['browser-visual', 'You need to verify chart colors and layout.', 'Inspect a screenshot', 'A text snapshot alone verifies colors'],
  ['browser-lifecycle', 'The task is done but the user wants to keep browsing.', 'Release the browser overlay', 'Destroy the window'],
  ['large-table', 'Present a sortable dataset with 100 rows.', 'Use transform_data and an absolute file-backed src', 'Repeat all 100 rows as inline JSON'],
  ['simple-table', 'Show a small static comparison that needs no sorting or export.', 'A Markdown table is appropriate', 'Always use a spreadsheet block'],
  ['llm-model', 'An isolated call_llm task should use the current model.', 'Omit the model parameter', 'Always force the smallest model'],
  ['llm-tools', 'A proposed call_llm subtask must run shell commands.', 'Do it here or use qualified Swarm delegation', 'call_llm can execute shell tools'],
  ['writing-load', 'Research is complete; the user now wants a prose report. natural-writing is available but not read.', 'Read natural-writing before drafting', 'Never load it unless the user names it'],
  ['writing-skip', 'The user asks to fix a compiler error with no prose-writing task.', 'Do not load natural-writing solely for this task', 'Load natural-writing on every turn'],
  ['writing-verbatim', 'The user requires quoted text to remain verbatim.', 'Preserve it even when applying writing guidance', 'Rewrite it to remove AI-like phrasing'],
  ['source-ack', 'send_agent_message returned queued.', 'It has not been read yet; wait for a reply or check status', 'Treat it as acknowledged and completed'],
] as const;

export function scorePolicyResponse(text: string, expected: string[]) {
  let parsed: unknown;
  const trimmed = text.trim();
  try { parsed = JSON.parse(trimmed.replace(/^```(?:json)?\s*|\s*```$/g, '')); } catch { /* Kept in rawText by the caller. */ }
  const answers: unknown[] = Array.isArray(parsed) ? parsed : [];
  const exactFormat = trimmed.startsWith('[') && answers.length === expected.length && answers.every(a => a === 'A' || a === 'B');
  const choices = answers.map(a => typeof a === 'string' ? a : (a as { choice?: unknown } | null)?.choice);
  const failures = promptContextCases.filter((_, i) => choices[i] !== expected[i]).map(c => c[0]);
  return { passed: promptContextCases.length - failures.length, exactFormat, failures, answers };
}
