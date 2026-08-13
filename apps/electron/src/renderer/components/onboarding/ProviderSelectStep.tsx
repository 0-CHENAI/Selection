import { useTranslation } from "react-i18next"
import { cn } from "@/lib/utils"
import { CraftAgentsSymbol } from "@/components/icons/CraftAgentsSymbol"
import { OrderWordmark } from "@/components/icons/OrderWordmark"
import { StepFormLayout } from "./primitives"

/**
 * The high-level provider choice the user makes on first launch.
 * This maps to one or more ApiSetupMethods downstream.
 */
export type ProviderChoice = 'order' | 'api_key' | 'local'

/** ORDER gateway base (Anthropic-compatible path — no /v1). */
export const ORDER_BASE_URL = 'https://order.ai.jxepdi.top'
/** ORDER OpenAI-compatible base URL (requires /v1). */
export const ORDER_OPENAI_BASE_URL = 'https://order.ai.jxepdi.top/v1'

interface ProviderOption {
  id: ProviderChoice
  name: string
  description: string
}

interface ProviderSelectStepProps {
  /** Called when the user selects a provider */
  onSelect: (choice: ProviderChoice) => void
  /** Called when the user chooses to skip setup */
  onSkip?: () => void
}

/**
 * ProviderSelectStep — First screen after install.
 *
 * Welcomes the user and asks them to pick their connection method.
 * Selecting a card immediately advances to the next step.
 */
export function ProviderSelectStep({ onSelect, onSkip }: ProviderSelectStepProps) {
  const { t } = useTranslation()

  const PROVIDER_OPTIONS: ProviderOption[] = [
    {
      id: 'order',
      name: t("onboarding.providerSelect.order"),
      description: t("onboarding.providerSelect.orderDesc"),
    },
    {
      id: 'api_key',
      name: t("onboarding.providerSelect.otherProvider"),
      description: t("onboarding.providerSelect.otherProviderDesc"),
    },
    {
      id: 'local',
      name: t("onboarding.providerSelect.localModel"),
      description: t("onboarding.providerSelect.localModelDesc"),
    },
  ]

  return (
    <StepFormLayout
      iconElement={
        <div className="flex size-16 items-center justify-center">
          <CraftAgentsSymbol className="size-10 text-accent" />
        </div>
      }
      title={t("onboarding.providerSelect.title")}
      description={t("onboarding.providerSelect.description")}
    >
      <div className="space-y-2 sm:space-y-3">
        {PROVIDER_OPTIONS.map((option) => {
          const isOrder = option.id === 'order'
          return (
            <button
              key={option.id}
              onClick={() => onSelect(option.id)}
              className={cn(
                "flex w-full flex-col items-start rounded-xl bg-foreground-2 text-left transition-all",
                isOrder ? "px-4 py-3.5 sm:px-4 sm:py-3.5" : "p-3 sm:p-4",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                "hover:bg-foreground/[0.02] shadow-minimal",
              )}
            >
              {isOrder ? (
                <OrderWordmark className="block text-[2.15rem] sm:text-[2.35rem] leading-[0.85]" />
              ) : (
                <span className="font-medium text-sm">{option.name}</span>
              )}
              <p className={cn(
                "hidden sm:block text-xs text-muted-foreground",
                isOrder ? "mt-2" : "mt-1",
              )}>
                {option.description}
              </p>
            </button>
          )
        })}
      </div>

      {onSkip && (
        <div className="mt-4 text-center">
          <button
            onClick={onSkip}
            className="text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            {t("onboarding.providerSelect.setupLater")}
          </button>
        </div>
      )}
    </StepFormLayout>
  )
}
