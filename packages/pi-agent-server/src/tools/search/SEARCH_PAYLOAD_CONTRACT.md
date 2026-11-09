# Search Payload Contract

Last updated: 2026-11-01

This file documents the **known-good request shape** for provider-native web search calls in `pi-agent-server`.

## Routing and credential boundary

Native search is selected only for exact built-in provider ids and official endpoints:

| Provider id | Native search |
| --- | --- |
| `openai-codex` | ChatGPT Codex Responses backend |
| `openai` | OpenAI Responses API with `web_search` |
| `anthropic` | Anthropic Messages API server-side web search |
| `deepseek` | DeepSeek Search API (`/v1/tools/search`) |
| `google` | Gemini Google Search grounding |
| `moonshotai`, `moonshotai-cn` | Kimi Web Search Basic (`/v1/tools/search`) |

User-defined endpoints, Kimi Coding OAuth, Claude subscription OAuth, malformed ChatGPT tokens, and unknown providers stay on AnySearch. A failure from a selected native provider falls back to AnySearch, except when the user cancelled the call.

## ChatGPT backend (openai-codex)

Implementation: [providers/chatgpt.ts](./providers/chatgpt.ts)

Endpoint:
- `POST https://chatgpt.com/backend-api/codex/responses`

Required headers:
- `Authorization: Bearer <oauth-access-token>`
- `chatgpt-account-id: <JWT claim https://api.openai.com/auth.chatgpt_account_id>`
- `originator: pi` (Pi SDK Codex client identity; not `codex_cli_rs`)
- `User-Agent` from `formatUserAgent()` (`@earendil-works/pi-ai`). Pi 1.4.0 removed `getPiUserAgent()`; the detailed value is `pi/<version> (<platform>; <runtime>; <arch>)`, the same identity the Codex Responses client sends.
- `OpenAI-Beta: responses=experimental`
- `Content-Type: application/json`

Known-good body fields for search:
- `model`: active connection model, else `PI_PREFERRED_DEFAULTS['openai-codex']` (leads with `gpt-6.1-sol`)
- `store: false`
- `stream: true`
- `instructions: string`
- `tools: [{ type: "web_search" }]` (fallback retry: `web_search_preview`)
- `tool_choice: "required"` (the `web_search` tool must run; source citations are not optional)
- `parallel_tool_calls: true`
- `text: { verbosity: "medium" }`
- `input: [{ role, content: [{ type: "input_text", text }] }]`

### Why `stream: true` here?
The backend may reply with either JSON or SSE-like payloads depending on edge behavior. The provider parses both formats and treats parse failures as retryable across `web_search` → `web_search_preview` attempts before surfacing an aggregated error.

## Regression Checklist

If search starts failing again (HTTP or parse path):
1. Verify this payload shape in tests (`providers/chatgpt.test.ts`).
2. Compare against current upstream SDK behavior (`@earendil-works/pi-ai` codex responses provider).
3. Confirm the model is still in the Codex ChatGPT catalog (`gpt-6.1-sol`, `gpt-6-*`, `gpt-5.6-*`). Pi 1.4.0 removed `gpt-5.5` and `gpt-5.3-codex-spark`.
4. Inspect error fingerprint in thrown error (`tool/model/stream/tool_choice/text.verbosity`) and parse metadata (`content-type`, compact response snippet).
