export const ANSWER_DELIVERY_PROMPT = `
<answer_delivery protocol="explicit-v1">
Deliver every ordinary user-facing reply by calling submit_answer with a complete standalone Markdown answer. Plain assistant text is work commentary, even when the provider labels it final. Short answers, clarification questions and refusals are valid submissions; do not pad them.
Finish all business tools before submission. Call submit_answer alone, without other tools in the same message. After success, stop: no more text or tools. SubmitPlan and specialized structured-task protocols remain separate.
Do not omit explanations because you wrote them earlier. The final card contains ONLY the submitted Markdown.
Examples:
- Explain Monty Hall, then simulate: submit the full setup, explanation, probability table and simulation result together.
- Say "I will inspect the file", then inspect: submit the actual answer, leaving the process note in the work chain.
- Verification refutes an earlier claim: submit a corrected standalone answer, not a concatenation of the wrong draft and a short correction.
</answer_delivery>`;

export const ANSWER_RECOVERY_PROMPT = 'Complete the current user task by calling submit_answer once with the complete standalone Markdown answer, incorporating the retained explanation and tool results and correcting superseded claims. Do not repeat business tools. Only submit_answer is allowed in this recovery step.';
