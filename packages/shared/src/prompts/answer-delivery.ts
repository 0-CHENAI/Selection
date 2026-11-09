export const COORDINATION_TURN_PROMPT = 'This is an internal coordinator checkpoint, not a user-facing answer turn. Submit the required orchestration decision. After an accepted decision, end this assistant turn immediately without writing a user-facing answer. Do not poll or wait for workers; the host will send the next checkpoint or final verification turn.';

/**
 * natural-v1: the reply is the plain text of the final assistant message — the
 * one that ends the turn without tool calls. The host commits it; there is no
 * delivery tool, so the answer streams exactly as the model writes it.
 */
export const ANSWER_DELIVERY_PROMPT = `
<answer_delivery protocol="natural-v1">
Your user-facing reply is the plain text of your FINAL assistant message: the message that ends your turn without any tool call. The app commits that text as the answer card. There is no submit tool; never wrap the answer in a tool call.
Write the final message as the complete standalone Markdown answer, with no preamble about delivering it.
Text you write before or between tool calls is a transient progress note: it is shown while you write it and then folded into the work log. Keep such notes to one short sentence and never draft the answer there. If no tools are needed, just write the answer.
Finish all tool work first. After the final answer, stop: no more text or tools. SubmitPlan and specialized structured-task protocols remain separate.
Large HTML/SVG or other artifacts: Write the file first, then give a short final answer that links the saved path and reports the required checks. Do not paste a whole page into the answer.
File cards are generated automatically from supported document formats created or modified during this conversation turn.
Complete means sufficient for the current user request, respecting its scope and requested length. Do not resend answers from previous user turns unless the current request asks for them. A one-sentence follow-up needs only that sentence.
Do not omit explanations required by the current request because you already wrote them in a progress note. The answer card contains ONLY the final message.
For ordinary web-researched chat answers, put citations next to the claims they support. The app has a separate source panel; do not append a Sources/数据来源 list after the answer unless the user explicitly requests a bibliography.
Examples:
- Explain Monty Hall, then simulate: run the simulation first, then write one final message with the full setup, explanation, probability table and simulation result.
- Say "I will inspect the file", then inspect: the final message is the actual answer; the progress note stays in the work log.
- Verification refutes an earlier claim: write a corrected standalone answer, not the wrong draft plus a short correction.
- Architecture HTML already written to disk: the final answer is a short Markdown link to that file plus the check results.
</answer_delivery>`;

export const ANSWER_RECOVERY_PROMPT = 'Your previous turn ended without a final answer. Write it now as plain text: a standalone Markdown answer to the current user request. Tools are unavailable in this step. Respect the requested scope and length: a short question or one-sentence follow-up needs only a short answer. If this turn already wrote a complete HTML/SVG or other deliverable file, give a short Markdown link to that file plus any required checks; do not rewrite the file or paste the whole page. Include explanations and tool results needed for this request, correcting superseded claims from this turn; do not resend whole answers from previous user turns unless requested.';
