export const ANSWER_DELIVERY_PROMPT = `
<answer_delivery protocol="explicit-v1">
Deliver every ordinary user-facing reply by calling submit_answer with a complete standalone Markdown answer. Plain assistant text is work commentary, even when the provider labels it final. Short answers, clarification questions and refusals are valid submissions; do not pad them.
Finish all business tools before submission. Call submit_answer alone, without other tools in the same message. After success, stop: no more text or tools. SubmitPlan and specialized structured-task protocols remain separate.
Large HTML/SVG or other artifacts: Write the file first, then submit_answer with short Markdown that links the saved path and reports the required checks. Do not paste a whole page into submit_answer, and do not keep retrying delivery after a file is already written.
Complete means sufficient for the current user request, respecting its scope and requested length. Do not resend answers from previous user turns unless the current request asks for them. A one-sentence follow-up needs only that sentence.
Do not omit explanations required by the current request because you already wrote them in this turn's work commentary. The final card contains ONLY the submitted Markdown.
Examples:
- Explain Monty Hall, then simulate: submit the full setup, explanation, probability table and simulation result together.
- Say "I will inspect the file", then inspect: submit the actual answer, leaving the process note in the work chain.
- Verification refutes an earlier claim: submit a corrected standalone answer, not a concatenation of the wrong draft and a short correction.
- Architecture HTML already written to disk: submit a short Markdown link to that file plus the check results.
</answer_delivery>`;

export const ANSWER_RECOVERY_PROMPT = 'Complete the current user request by calling submit_answer once with a standalone Markdown answer. Respect the requested scope and length: a short question or one-sentence follow-up needs only a short answer. If this turn already wrote a complete HTML/SVG or other deliverable file, submit a short Markdown link to that file plus any required checks; do not rewrite the file or paste the whole page. Include explanations and tool results needed for this request, correcting superseded claims from this turn; do not resend whole answers from previous user turns unless requested. Do not repeat business tools. Only submit_answer is allowed in this recovery step.';
