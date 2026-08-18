import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { Check, Key, Cpu } from "lucide-react"
import { StepFormLayout, BackButton, ContinueButton } from "./primitives"
import type { LlmAuthType, LlmProviderType } from "@craft-agent/shared/config/llm-connections"

const BetaBadge = ({ label }: { label: string }) => (
  <span className="inline px-1.5 pt-[2px] pb-[3px] text-[10px] font-accent font-bold rounded-[4px] bg-accent text-background ml-1 relative -top-[1px]">
    {label}
  </span>
)

/**
 * API setup method for onboarding.
 * Maps to specific LlmProviderType + LlmAuthType combinations.
 *
 * - 'pi_chatgpt_oauth' → pi + oauth
 * - 'pi_copilot_oauth' → pi + oauth
 * - 'pi_api_key' → pi + api_key
 */
export type ApiSetupMethod =
  | 'pi_chatgpt_oauth'
  | 'pi_copilot_oauth'
  | 'pi_api_key'

/**
 * Map ApiSetupMethod to the underlying LLM connection types.
 */
export function apiSetupMethodToConnectionTypes(method: ApiSetupMethod): {
  providerType: LlmProviderType;
  authType: LlmAuthType;
} {
  switch (method) {
    case 'pi_chatgpt_oauth':
      return { providerType: 'pi', authType: 'oauth' };
    case 'pi_copilot_oauth':
      return { providerType: 'pi', authType: 'oauth' };
    case 'pi_api_key':
      return { providerType: 'pi', authType: 'api_key' };
  }
}

interface ApiSetupOption {
  id: ApiSetupMethod
  name: string
  description: string
  icon: React.ReactNode
}

const API_SETUP_ICONS: Record<ApiSetupMethod, React.ReactNode> = {
  pi_chatgpt_oauth: <Cpu className="size-4" />,
  pi_copilot_oauth: <Cpu className="size-4" />,
  pi_api_key: <Key className="size-4" />,
}

interface APISetupStepProps {
  selectedMethod: ApiSetupMethod | null
  onSelect: (method: ApiSetupMethod) => void
  onContinue: () => void
  onBack: () => void
}

function OptionButton({
  option,
  isSelected,
  onSelect,
}: {
  option: ApiSetupOption
  isSelected: boolean
  onSelect: (method: ApiSetupMethod) => void
}) {
  return (
    <button
      onClick={() => onSelect(option.id)}
      className={cn(
        "flex w-full items-start gap-4 rounded-xl p-4 text-left transition-all",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        "hover:bg-foreground/[0.02] shadow-minimal",
        isSelected
          ? "bg-background"
          : "bg-foreground-2"
      )}
    >
      <div
        className={cn(
          "flex size-10 shrink-0 items-center justify-center rounded-lg",
          isSelected ? "bg-foreground/10 text-foreground" : "bg-muted text-muted-foreground"
        )}
      >
        {option.icon}
      </div>

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{option.name}</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          {option.description}
        </p>
      </div>

      <div
        className={cn(
          "flex size-5 shrink-0 items-center justify-center rounded-full border-2 transition-colors",
          isSelected
            ? "border-foreground bg-foreground text-background"
            : "border-muted-foreground/20"
        )}
      >
        {isSelected && <Check className="size-3" strokeWidth={3} />}
      </div>
    </button>
  )
}

/**
 * APISetupStep - Choose how to connect your AI agents.
 * Only Pi / OpenAI Compatible paths remain.
 */
export function APISetupStep({
  selectedMethod,
  onSelect,
  onContinue,
  onBack,
}: APISetupStepProps) {
  const { t } = useTranslation()

  const API_SETUP_OPTIONS: ApiSetupOption[] = [
    {
      id: 'pi_chatgpt_oauth',
      name: 'ChatGPT Plus',
      description: t("onboarding.apiSetup.chatGPTPlusDesc"),
      icon: API_SETUP_ICONS.pi_chatgpt_oauth,
    },
    {
      id: 'pi_copilot_oauth',
      name: 'GitHub Copilot',
      description: t("onboarding.apiSetup.githubCopilotDesc"),
      icon: API_SETUP_ICONS.pi_copilot_oauth,
    },
    {
      id: 'pi_api_key',
      name: t("onboarding.apiSetup.apiKey"),
      description: t("onboarding.apiSetup.apiKeyDesc"),
      icon: API_SETUP_ICONS.pi_api_key,
    },
  ]

  return (
    <StepFormLayout
      title={t("onboarding.apiSetup.title")}
      description={t("onboarding.apiSetup.description")}
      actions={
        <>
          <BackButton onClick={onBack} />
          <ContinueButton onClick={onContinue} disabled={!selectedMethod} />
        </>
      }
    >
      <div className="bg-foreground-2 rounded-[8px] p-4 mb-3">
        <p className="text-sm text-muted-foreground text-center">
          {t("onboarding.apiSetup.piDesc")}
          <BetaBadge label={t("onboarding.apiSetup.beta")} />
        </p>
      </div>

      <div className="space-y-3 min-h-[180px]">
        {API_SETUP_OPTIONS.map((option) => (
          <OptionButton
            key={option.id}
            option={option}
            isSelected={option.id === selectedMethod}
            onSelect={onSelect}
          />
        ))}
      </div>
    </StepFormLayout>
  )
}
