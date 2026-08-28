import type { ComponentEntry } from './types'
import { ApiKeyInput, type ApiKeySubmitData } from '@/components/apisetup/ApiKeyInput'

const logSubmit = (data: ApiKeySubmitData) => console.log('[Playground] Submit:', JSON.stringify(data, null, 2))

export const apiKeyInputComponents: ComponentEntry[] = [
  {
    id: 'api-key-custom-endpoint',
    name: 'Custom Endpoint',
    category: 'Agent Setup',
    description: 'ApiKeyInput with Custom preset — OpenAI Compatible base URL and comma-separated models',
    component: ApiKeyInput,
    props: [
      {
        name: 'status',
        description: 'Validation status',
        control: {
          type: 'select',
          options: [
            { label: 'Idle', value: 'idle' },
            { label: 'Validating', value: 'validating' },
            { label: 'Success', value: 'success' },
            { label: 'Error', value: 'error' },
          ],
        },
        defaultValue: 'idle',
      },
      {
        name: 'errorMessage',
        description: 'Error message when status is error',
        control: { type: 'string', placeholder: 'Error message' },
        defaultValue: '',
      },
    ],
    variants: [
      {
        name: 'Empty (OpenAI compat)',
        description: 'Custom preset, no values filled',
        props: {
          providerType: 'pi_api_key',
          initialValues: {
            activePreset: 'custom',
            baseUrl: 'https://your-endpoint.com/v1',
            customApi: 'openai-completions',
          },
        },
      },
      {
        name: 'Empty (OpenAI Compatible)',
        description: 'Custom preset with an OpenAI Compatible endpoint',
        props: {
          providerType: 'pi_api_key',
          initialValues: {
            activePreset: 'custom',
            baseUrl: 'https://your-proxy.com',
            customApi: 'openai-completions',
          },
        },
      },
      {
        name: 'Alibaba DashScope (OpenAI)',
        description: 'Alibaba/Qwen endpoint — OpenAI compatible with 3 models',
        props: {
          providerType: 'pi_api_key',
          initialValues: {
            activePreset: 'custom',
            baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            connectionDefaultModel: 'qwen3-coder-plus, qwen3-coder-flash, qwen-max',
            customApi: 'openai-completions',
          },
        },
      },
      {
        name: 'Custom limits (auto + edited)',
        description: 'Shows per-model context/output cards with default and saved overrides',
        props: {
          providerType: 'pi_api_key',
          initialValues: {
            activePreset: 'custom',
            baseUrl: 'https://order.ai.jxepdi.top/v1',
            connectionDefaultModel: 'Laufry, Opus, MO',
            customApi: 'openai-completions',
            modelContextWindows: { Laufry: 1_000_448, Opus: 1_536 * 1_024 },
            modelMaxTokens: { Laufry: 128 * 1_024, Opus: 128 * 1_024, MO: 128 * 1_024 },
            modelImageCaps: { Laufry: true, Opus: true, MO: true },
          },
        },
      },
      {
        name: 'Ollama Local (OpenAI)',
        description: 'Local Ollama endpoint — OpenAI compatible',
        props: {
          providerType: 'pi_api_key',
          initialValues: {
            activePreset: 'custom',
            baseUrl: 'http://localhost:11434/v1',
            connectionDefaultModel: 'qwen3-coder',
            customApi: 'openai-completions',
          },
        },
      },
      {
        name: 'OpenAI Compatible Proxy',
        description: 'Custom OpenAI Compatible proxy endpoint',
        props: {
          providerType: 'pi_api_key',
          initialValues: {
            activePreset: 'custom',
            baseUrl: 'https://my-openai-proxy.internal/v1',
            connectionDefaultModel: 'gpt-4o',
            customApi: 'openai-completions',
          },
        },
      },
      {
        name: 'Via Selection Backend API Key flow',
        description: 'Custom endpoint accessed through the Pi API key flow',
        props: {
          providerType: 'pi_api_key',
          initialValues: {
            activePreset: 'custom',
            baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
            connectionDefaultModel: 'qwen3-coder-plus, qwen3-coder-flash',
            customApi: 'openai-completions',
          },
        },
      },
      {
        name: 'No Base URL',
        description: 'Custom preset but no base URL',
        props: {
          providerType: 'pi_api_key',
          initialValues: {
            activePreset: 'custom',
          },
        },
      },
      {
        name: 'Validation Error',
        description: 'Custom endpoint with connection error',
        props: {
          status: 'error',
          errorMessage: 'Connection failed: ECONNREFUSED 127.0.0.1:11434',
          providerType: 'pi_api_key',
          initialValues: {
            activePreset: 'custom',
            baseUrl: 'http://localhost:11434/v1',
            connectionDefaultModel: 'qwen3-coder',
            customApi: 'openai-completions',
          },
        },
      },
    ],
    wrapper: ({ children }) => (
      <div className="h-full w-full overflow-auto bg-foreground-2 p-6">{children}</div>
    ),
    mockData: () => ({
      onSubmit: logSubmit,
      providerType: 'pi_api_key',
      initialValues: {
        activePreset: 'custom',
        baseUrl: 'https://your-endpoint.com/v1',
        customApi: 'openai-completions',
      },
    }),
  },
]
