/**
 * CredentialsStep - Onboarding step wrapper for API key or OAuth flow
 *
 * Thin wrapper that composes ApiKeyInput or OAuthConnect controls
 * with StepFormLayout for the onboarding wizard context.
 */

import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { Check, ExternalLink } from "lucide-react"
import type { ApiSetupMethod } from "./APISetupStep"
import { StepFormLayout, BackButton, ContinueButton } from "./primitives"
import { OrderWordmark } from "@/components/icons/OrderWordmark"
import { isOrderCredentialPrefill } from "./order-prefill"
import {
  ApiKeyInput,
  type ApiKeyStatus,
  type ApiKeySubmitData,
  type OAuthStatus,
  type OAuthSetupMethod,
} from "../apisetup"
import type { CustomEndpointApi } from '@config/llm-connections'

export type CredentialStatus = ApiKeyStatus | OAuthStatus

interface CredentialsStepProps {
  apiSetupMethod: ApiSetupMethod
  status: CredentialStatus
  errorMessage?: string
  onSubmit: (data: ApiKeySubmitData) => void
  onStartOAuth?: (methodOverride?: ApiSetupMethod) => void
  onBack: () => void
  /**
   * Switch the credentials step to another setup method (e.g. API key -> OAuth).
   * When provided together with `allowOAuthSwitch`, the API-key endpoint
   * dropdown also offers ChatGPT / GitHub Copilot account sign-in.
   */
  onSelectApiSetupMethod?: (method: ApiSetupMethod) => void
  /** Offer OAuth providers from the API-key form (disabled when editing an existing connection). */
  allowOAuthSwitch?: boolean
  // Two-step OAuth flow
  isWaitingForCode?: boolean
  onSubmitAuthCode?: (code: string) => void
  onCancelOAuth?: () => void
  // Device flow (GitHub Copilot / Kimi Code)
  copilotDeviceCode?: { userCode: string; verificationUri: string }
  // Edit mode (pre-fill existing connection values)
  editInitialValues?: {
    apiKey?: string
    baseUrl?: string
    connectionDefaultModel?: string
    activePreset?: string
    models?: string[]
    modelImageCaps?: Record<string, boolean>
    modelThinkingLevels?: Record<string, Array<'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'>>
    modelContextWindows?: Record<string, number>
    modelMaxTokens?: Record<string, number>
    customApi?: CustomEndpointApi
  }
}

export function CredentialsStep({
  apiSetupMethod,
  status,
  errorMessage,
  onSubmit,
  onStartOAuth,
  onBack,
  onSelectApiSetupMethod,
  allowOAuthSwitch,
  copilotDeviceCode,
  editInitialValues,
}: CredentialsStepProps) {
  const { t } = useTranslation()
  const isChatGptOAuth = apiSetupMethod === 'pi_chatgpt_oauth'
  const isCopilotOAuth = apiSetupMethod === 'pi_copilot_oauth'
  const isKimiOAuth = apiSetupMethod === 'pi_kimi_oauth'
  const isDeviceFlowOAuth = isCopilotOAuth || isKimiOAuth
  const isPiApiKey = apiSetupMethod === 'pi_api_key'
  const isApiKey = isPiApiKey

  // Remember whether an OAuth page was reached from the API-key endpoint
  // dropdown, so "Back" returns to that form instead of the provider list.
  const cameFromApiKeyFormRef = useRef(false)
  if (isApiKey) cameFromApiKeyFormRef.current = false

  const canSwitchToOAuth = !!allowOAuthSwitch && !!onSelectApiSetupMethod
  const handleSelectOAuthMethod = canSwitchToOAuth
    ? (method: OAuthSetupMethod) => {
        cameFromApiKeyFormRef.current = true
        onSelectApiSetupMethod!(method)
      }
    : undefined

  const handleOAuthBack = () => {
    if (cameFromApiKeyFormRef.current && onSelectApiSetupMethod) {
      cameFromApiKeyFormRef.current = false
      onSelectApiSetupMethod('pi_api_key')
      return
    }
    onBack()
  }

  // Device-flow (Copilot / Kimi Code) device code clipboard handling
  const [copiedCode, setCopiedCode] = useState(false)

  // Auto-copy device code to clipboard when it appears
  useEffect(() => {
    if (copilotDeviceCode?.userCode) {
      navigator.clipboard.writeText(copilotDeviceCode.userCode).then(() => {
        setCopiedCode(true)
        setTimeout(() => setCopiedCode(false), 2000)
      }).catch(() => {
        // Clipboard write failed, user can still click to copy
      })
    }
  }, [copilotDeviceCode?.userCode])

  const handleCopyCode = () => {
    if (copilotDeviceCode?.userCode) {
      navigator.clipboard.writeText(copilotDeviceCode.userCode).then(() => {
        setCopiedCode(true)
        setTimeout(() => setCopiedCode(false), 2000)
      })
    }
  }

  // --- ChatGPT OAuth flow (native browser OAuth) ---
  if (isChatGptOAuth) {
    return (
      <StepFormLayout
        title={t("onboarding.credentials.connectChatGPT")}
        description={t("onboarding.credentials.connectChatGPTDesc")}
        actions={
          <>
            <BackButton onClick={handleOAuthBack} disabled={status === 'validating'} />
            <ContinueButton
              onClick={() => onStartOAuth?.()}
              className="gap-2"
              loading={status === 'validating'}
              loadingText={t("common.connecting")}
            >
              <ExternalLink className="size-4" />
              {t("onboarding.credentials.signInChatGPT")}
            </ContinueButton>
          </>
        }
      >
        <div className="space-y-4">
          <div className="rounded-xl bg-foreground-2 p-4 text-sm text-muted-foreground">
            <p>{t("onboarding.credentials.chatGPTInstructions")}</p>
          </div>
          {status === 'error' && errorMessage && (
            <div className="rounded-lg bg-destructive/10 text-destructive text-sm p-3">
              {errorMessage}
            </div>
          )}
          {status === 'success' && (
            <div className="rounded-lg bg-success/10 text-success text-sm p-3">
              {t("onboarding.credentials.chatGPTConnected")}
            </div>
          )}
        </div>
      </StepFormLayout>
    )
  }

  // --- Device-flow OAuth (GitHub Copilot / Kimi Code) ---
  if (isDeviceFlowOAuth) {
    const copy = isKimiOAuth
      ? {
          title: t("onboarding.credentials.connectKimi"),
          description: t("onboarding.credentials.connectKimiDesc"),
          signIn: t("onboarding.credentials.signInKimi"),
          enterCode: t("onboarding.credentials.enterCodeOnKimi"),
          browserOpened: t("onboarding.credentials.browserOpenedKimi"),
          clickToSignIn: t("onboarding.credentials.clickToSignInKimi"),
          connected: t("onboarding.credentials.kimiConnected"),
        }
      : {
          title: t("onboarding.credentials.connectGitHub"),
          description: t("onboarding.credentials.connectGitHubDesc"),
          signIn: t("onboarding.credentials.signInGitHub"),
          enterCode: t("onboarding.credentials.enterCodeOnGitHub"),
          browserOpened: t("onboarding.credentials.browserOpenedGitHub"),
          clickToSignIn: t("onboarding.credentials.clickToSignInGitHub"),
          connected: t("onboarding.credentials.copilotConnected"),
        }
    return (
      <StepFormLayout
        title={copy.title}
        description={copy.description}
        actions={
          <>
            <BackButton onClick={handleOAuthBack} disabled={status === 'validating'} />
            <ContinueButton
              onClick={() => onStartOAuth?.()}
              className="gap-2"
              loading={status === 'validating'}
              loadingText={t("onboarding.credentials.waitingForAuth")}
            >
              <ExternalLink className="size-4" />
              {copy.signIn}
            </ContinueButton>
          </>
        }
      >
        <div className="space-y-4">
          {copilotDeviceCode ? (
            <div className="rounded-xl bg-foreground-2 p-4 text-sm space-y-3">
              <p className="text-muted-foreground text-center">
                {copy.enterCode}
              </p>
              <div className="flex flex-col items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={handleCopyCode}
                  className="text-2xl font-mono font-bold tracking-widest text-foreground px-4 py-2 rounded-lg bg-background border border-border hover:bg-foreground-2 transition-colors cursor-pointer"
                >
                  {copilotDeviceCode.userCode}
                </button>
                <span className={`text-xs text-muted-foreground flex items-center gap-1 transition-opacity ${copiedCode ? 'opacity-100' : 'opacity-0'}`}>
                  <Check className="size-3" />
                  {t("onboarding.credentials.copiedToClipboard")}
                </span>
              </div>
              <p className="text-muted-foreground text-xs text-center">
                {copy.browserOpened}
              </p>
            </div>
          ) : (
            <div className="rounded-xl bg-foreground-2 p-4 text-sm text-muted-foreground text-center">
              <p>{copy.clickToSignIn}</p>
            </div>
          )}
          {status === 'error' && errorMessage && (
            <div className="rounded-lg bg-destructive/10 text-destructive text-sm p-3 text-center">
              {errorMessage}
            </div>
          )}
          {status === 'success' && (
            <div className="rounded-lg bg-success/10 text-success text-sm p-3 text-center">
              {copy.connected}
            </div>
          )}
        </div>
      </StepFormLayout>
    )
  }

  // --- API Key flow ---
  const providerType = 'pi_api_key'
  const isOrderPrefill = isOrderCredentialPrefill(editInitialValues)
  const apiKeyDescription = isOrderPrefill
    ? t('onboarding.credentials.orderDesc')
    : isPiApiKey
      ? t('onboarding.credentials.piApiKeyDesc')
      : t('onboarding.credentials.apiKeyDesc')

  const apiKeyInputKey = [
    apiSetupMethod,
    editInitialValues?.activePreset ?? '',
    editInitialValues?.baseUrl ?? '',
    editInitialValues?.connectionDefaultModel ?? '',
    (editInitialValues?.models ?? []).join('|'),
    editInitialValues?.customApi ?? '',
  ].join('::')

  return (
    <StepFormLayout
      iconElement={isOrderPrefill ? (
        <OrderWordmark className="text-[4.7rem] leading-[0.85]" />
      ) : undefined}
      title={isOrderPrefill ? undefined : t("onboarding.credentials.apiConfiguration")}
      description={apiKeyDescription}
      actions={
        <>
          <BackButton onClick={onBack} disabled={status === 'validating'} />
          <ContinueButton
            type="submit"
            form="api-key-form"
            disabled={false}
            loading={status === 'validating'}
            loadingText={t("common.validating")}
          />
        </>
      }
    >
      <ApiKeyInput
        key={apiKeyInputKey}
        status={status as ApiKeyStatus}
        errorMessage={errorMessage}
        onSubmit={onSubmit}
        providerType={providerType}
        presetFilter={isOrderPrefill ? 'order' : undefined}
        onSelectOAuthMethod={isOrderPrefill ? undefined : handleSelectOAuthMethod}
        initialValues={editInitialValues}
      />
    </StepFormLayout>
  )
}
