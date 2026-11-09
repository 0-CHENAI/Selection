import type { AgentSession } from '@earendil-works/pi-coding-agent';

type PromptOptions = { forceSystemPrompt?: string };
type MutablePromptSession = {
  _baseSystemPromptOptions: PromptOptions;
  _runSystemPromptOptions?: PromptOptions;
  _rebuildSystemPrompt: (toolNames: string[]) => void;
};

const overrides = new WeakMap<AgentSession, { prompt: string }>();

/** Keep Selection's exact prompt across Pi's tool/resource prompt rebuilds. */
export function applySystemPromptOverride(session: AgentSession, prompt: string): void {
  const mutable = session as unknown as MutablePromptSession;
  let override = overrides.get(session);
  if (!override) {
    override = { prompt };
    overrides.set(session, override);
    const originalRebuild = mutable._rebuildSystemPrompt.bind(session);
    mutable._rebuildSystemPrompt = (toolNames) => {
      originalRebuild(toolNames);
      mutable._baseSystemPromptOptions.forceSystemPrompt = override!.prompt;
      if (mutable._runSystemPromptOptions) mutable._runSystemPromptOptions.forceSystemPrompt = override!.prompt;
    };
  }
  override.prompt = prompt;
  mutable._baseSystemPromptOptions.forceSystemPrompt = prompt;
  if (mutable._runSystemPromptOptions) mutable._runSystemPromptOptions.forceSystemPrompt = prompt;
}
