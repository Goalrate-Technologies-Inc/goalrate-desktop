import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import { open } from '@tauri-apps/plugin-shell';
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

const DEFAULT_AI_PROVIDER = 'github';
const MODEL_OPTION_SEPARATOR = '::';
const LOCAL_AI_PROVIDER = 'local';
const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000';
const STAGING_API_SECRET = import.meta.env.VITE_STAGING_API_SECRET || '';

const OAUTH_CONNECTABLE_PROVIDERS = new Set<string>(['github']);

type AiProviderPreset = {
  id: string;
  label: string;
  connectionType: AiProviderOption['connectionType'];
  message?: string;
};

const FALLBACK_AI_PROVIDER_PRESETS: AiProviderPreset[] = [
  {
    id: 'github',
    label: 'GitHub Models',
    connectionType: 'oauth_or_api_key',
    message: 'Connect GitHub with OAuth or add your API key.',
  },
  {
    id: LOCAL_AI_PROVIDER,
    label: 'Ollama',
    connectionType: 'api_key',
    message: 'Add your Ollama API key.',
  },
  {
    id: 'openai',
    label: 'OpenAI',
    connectionType: 'api_key',
    message: 'Add your OpenAI API key.',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    connectionType: 'api_key',
    message: 'Add your Anthropic API key.',
  },
  {
    id: 'gemini',
    label: 'Gemini',
    connectionType: 'api_key',
    message: 'Add your Gemini API key.',
  },
  {
    id: 'mistral',
    label: 'Mistral',
    connectionType: 'api_key',
    message: 'Add your Mistral API key.',
  },
  {
    id: 'perplexity',
    label: 'Perplexity',
    connectionType: 'api_key',
    message: 'Add your Perplexity API key.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    connectionType: 'api_key',
    message: 'Add your OpenRouter API key.',
  },
  {
    id: 'groq',
    label: 'Groq',
    connectionType: 'api_key',
    message: 'Add your Groq API key.',
  },
  {
    id: 'azure-openai',
    label: 'Azure OpenAI',
    connectionType: 'api_key',
    message: 'Add your Azure OpenAI API key and set GOALRATE_AZURE_OPENAI_ENDPOINT.',
  },
  {
    id: 'bedrock',
    label: 'Amazon Bedrock',
    connectionType: 'sdk',
    message: 'Configure AWS CLI credentials and region to use Bedrock.',
  },
  {
    id: 'vertex-ai',
    label: 'Google Vertex AI',
    connectionType: 'sdk',
    message: 'Configure gcloud authentication and project to use Vertex AI.',
  },
  {
    id: 'together',
    label: 'Together AI',
    connectionType: 'api_key',
    message: 'Add your Together AI API key.',
  },
];

export const AI_PROVIDER_ORDER = FALLBACK_AI_PROVIDER_PRESETS.map((provider) => provider.id);

export interface AiModelOption {
  id: string;
  label: string;
  providerId: string;
  provider?: string;
}

export interface AiProviderOption {
  id: string;
  label: string;
  connectionType: 'oauth' | 'local' | string;
  connected: boolean;
  ready: boolean;
  message?: string;
}

export interface AvailableAiModelsResult {
  models: AiModelOption[];
  providers: AiProviderOption[];
}

export interface GenerateAiGoalPlanInput {
  vaultId: string;
  title?: string;
  goalBrief: string;
  deadline?: string;
  priority?: string;
  modelId: string;
}

export interface GenerateAiGoalPlanResult {
  title: string;
  milestones: string[];
  summary?: string;
  goalOverview?: string;
  scopeIn?: string[];
  scopeOut?: string[];
  userJourneySpecs?: GenerateAiGoalJourneySpecResult[];
  systemJourneySpecs?: GenerateAiGoalJourneySpecResult[];
  milestoneBriefs?: string[];
  milestoneTasks?: string[][];
  taskBriefs?: string[][];
  acceptanceCriteria?: string[];
  guardrails?: string[];
  workingRules?: string[];
  qualityGates?: string[];
  definitionOfDone?: string[];
  schema?: string;
  flows?: string;
}

export interface GenerateAiGoalJourneySpecResult {
  name: string;
  actor?: string;
  trigger?: string;
  steps?: string[];
  successCriteria?: string[];
}

interface IntegrationConnectionResponse {
  provider: string;
  connected: boolean;
  connectedAt?: string;
}

interface AvailableModelsResponse {
  models: AiModelOption[];
  providers?: AiProviderOption[];
  total: number;
}

interface IntegrationAuthResponse {
  authorizationUrl: string;
  state: string;
  verificationCode?: string;
}

export type OAuthVerificationCodeHandler = (code: string) => void;

function parseTauriErrorMessage(error: unknown): string {
  if (!error) {
    return 'Unknown error while starting OAuth';
  }

  if (typeof error === 'string') {
    try {
      const parsed = JSON.parse(error) as { code?: string; message?: string };
      if (parsed?.message) {
        return parsed.message;
      }
    } catch {
      return error;
    }
    return error;
  }

  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object') {
    const payload = error as { message?: string };
    if (payload.message && payload.message.trim().length > 0) {
      return payload.message;
    }
    try {
      return JSON.stringify(error);
    } catch {
      return 'Unknown error while starting OAuth';
    }
  }

  return String(error);
}

function normalizeProvider(provider?: string): string {
  const normalized = provider?.trim().toLowerCase() ?? '';
  if (normalized === 'ollama') {
    return LOCAL_AI_PROVIDER;
  }
  return normalized;
}

function normalizeProviderList(providers?: AiProviderOption[]): AiProviderOption[] {
  if (!Array.isArray(providers)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized = providers
    .map((provider) => ({
      ...provider,
      id: normalizeProvider(provider.id),
      label: provider.label?.trim() || provider.id,
      connectionType: provider.connectionType || 'oauth',
      connected: Boolean(provider.connected),
      ready: Boolean(provider.ready),
      message: provider.message?.trim() || undefined,
    }))
    .filter((provider) => provider.id.length > 0)
    .filter((provider) => {
      if (seen.has(provider.id)) {
        return false;
      }
      seen.add(provider.id);
      return true;
    });

  return normalized;
}

function dedupeModels(models: AiModelOption[]): AiModelOption[] {
  const seen = new Set<string>();
  const deduped: AiModelOption[] = [];
  models.forEach((model) => {
    const id = model?.id?.trim();
    const providerId = normalizeProvider(model.providerId);
    if (!id || !providerId || seen.has(id)) {
      return;
    }
    seen.add(id);
    deduped.push({
      ...model,
      id,
      providerId,
    });
  });
  return deduped;
}

function fallbackProviderPresetToOption(preset: AiProviderPreset): AiProviderOption {
  return {
    id: preset.id,
    label: preset.label,
    connectionType: preset.connectionType,
    connected: false,
    ready: false,
    message: preset.message,
  };
}

function mergeProvidersWithFallback(providers: AiProviderOption[]): AiProviderOption[] {
  const fallbackProviders = getFallbackAiProviders();
  const mergedById = new Map<string, AiProviderOption>(
    fallbackProviders.map((provider) => [provider.id, provider])
  );

  providers.forEach((provider) => {
    const existing = mergedById.get(provider.id);
    mergedById.set(provider.id, {
      ...existing,
      ...provider,
      id: provider.id,
      label: provider.label || existing?.label || provider.id,
      connectionType: provider.connectionType || existing?.connectionType || 'oauth',
      connected: Boolean(provider.connected),
      ready: Boolean(provider.ready),
      message: provider.message ?? existing?.message,
    });
  });

  const ordered: AiProviderOption[] = [];
  const consumed = new Set<string>();

  AI_PROVIDER_ORDER.forEach((providerId) => {
    const provider = mergedById.get(providerId);
    if (!provider) {
      return;
    }
    ordered.push(provider);
    consumed.add(providerId);
  });

  providers.forEach((provider) => {
    if (consumed.has(provider.id)) {
      return;
    }
    const merged = mergedById.get(provider.id);
    if (merged) {
      ordered.push(merged);
      consumed.add(provider.id);
    }
  });

  return ordered;
}

async function listIntegrationConnections(
  vaultId?: string
): Promise<IntegrationConnectionResponse[]> {
  const trimmedVaultId = vaultId?.trim();
  return await invoke<IntegrationConnectionResponse[]>(
    'list_integration_connections',
    { vaultId: trimmedVaultId ?? null }
  );
}

export async function disconnectAiProviderForGoalAssignee(
  vaultId: string | undefined,
  provider: string
): Promise<void> {
  const normalizedProvider = normalizeProvider(provider);
  if (!normalizedProvider) {
    throw new Error('Select an integration provider to disconnect');
  }

  try {
    const trimmedVaultId = vaultId?.trim();
    await invoke('disconnect_integration', {
      vaultId: trimmedVaultId ?? null,
      provider: normalizedProvider,
    });
    await emit('integration-connected');
  } catch (error) {
    throw new Error(parseTauriErrorMessage(error));
  }
}

export function getProviderIdFromModelOptionId(modelOptionId: string): string {
  const trimmed = modelOptionId.trim();
  if (!trimmed) {
    return DEFAULT_AI_PROVIDER;
  }
  const [providerId] = trimmed.split(MODEL_OPTION_SEPARATOR);
  return normalizeProvider(providerId) || DEFAULT_AI_PROVIDER;
}

export function getFallbackAiProviders(): AiProviderOption[] {
  return FALLBACK_AI_PROVIDER_PRESETS.map(fallbackProviderPresetToOption);
}

export function getAiProviderLabel(providerId: string): string {
  const normalizedProviderId = normalizeProvider(providerId);
  const provider = getFallbackAiProviders().find((entry) => entry.id === normalizedProviderId);
  if (!provider) {
    return normalizedProviderId.charAt(0).toUpperCase() + normalizedProviderId.slice(1);
  }
  return provider.label;
}

export async function isAiProviderConnected(
  vaultId: string | undefined,
  provider = DEFAULT_AI_PROVIDER
): Promise<boolean> {
  if (!navigator.onLine) {
    return false;
  }

  try {
    const connections = await listIntegrationConnections(vaultId);
    const normalizedProvider = normalizeProvider(provider);
    return connections.some(
      (connection) =>
        normalizeProvider(connection.provider) === normalizedProvider && connection.connected
    );
  } catch (error) {
    console.warn('[AI Goal Planning] Failed to load integration connections:', error);
    return false;
  }
}

export async function connectAiProviderForGoalAssignee(
  vaultId: string | undefined,
  provider = DEFAULT_AI_PROVIDER,
  onVerificationCode?: OAuthVerificationCodeHandler
): Promise<void> {
  const normalizedProvider = normalizeProvider(provider);
  if (!normalizedProvider) {
    throw new Error('Select an AI provider before connecting');
  }
  if (normalizedProvider === LOCAL_AI_PROVIDER) {
    throw new Error('Ollama uses an API key. Click the Ollama icon to connect.');
  }
  if (normalizedProvider === 'openai') {
    throw new Error('OpenAI uses an API key. Click the OpenAI icon to connect.');
  }
  if (normalizedProvider === 'anthropic') {
    throw new Error('Anthropic uses an API key. Click the Anthropic icon to connect.');
  }
  if (normalizedProvider === 'gemini') {
    throw new Error('Gemini uses an API key. Click the Gemini icon to connect.');
  }
  if (normalizedProvider === 'mistral') {
    throw new Error('Mistral uses an API key. Click the Mistral icon to connect.');
  }
  if (normalizedProvider === 'perplexity') {
    throw new Error('Perplexity uses an API key. Click the Perplexity icon to connect.');
  }
  if (normalizedProvider === 'openrouter') {
    throw new Error('OpenRouter uses an API key. Click the OpenRouter icon to connect.');
  }
  if (normalizedProvider === 'groq') {
    throw new Error('Groq uses an API key. Click the Groq icon to connect.');
  }
  if (normalizedProvider === 'azure-openai') {
    throw new Error('Azure OpenAI uses an API key. Click the Azure OpenAI icon to connect.');
  }
  if (normalizedProvider === 'together') {
    throw new Error('Together AI uses an API key. Click the Together AI icon to connect.');
  }
  if (normalizedProvider === 'bedrock') {
    throw new Error('Amazon Bedrock uses your AWS CLI credentials. Configure AWS CLI and then refresh.');
  }
  if (normalizedProvider === 'vertex-ai') {
    throw new Error('Vertex AI uses gcloud credentials. Configure gcloud and then refresh.');
  }
  if (!OAUTH_CONNECTABLE_PROVIDERS.has(normalizedProvider)) {
    throw new Error('OAuth is not available for this provider. Use its configured connection method.');
  }

  let auth: IntegrationAuthResponse;
  try {
    const trimmedVaultId = vaultId?.trim();
    const payload: {
      provider: string;
      vaultId: string | null;
      apiBaseUrl: string;
      stagingApiSecret: string | null;
    } = {
      provider: normalizedProvider,
      vaultId: trimmedVaultId ?? null,
      apiBaseUrl: API_BASE_URL,
      stagingApiSecret: STAGING_API_SECRET.trim().length > 0 ? STAGING_API_SECRET : null,
    };
    auth = await invoke<IntegrationAuthResponse>('start_integration_oauth', payload);
  } catch (error) {
    throw new Error(parseTauriErrorMessage(error));
  }

  if (normalizedProvider === DEFAULT_AI_PROVIDER) {
    try {
      const verificationCode = auth.verificationCode?.trim();
      if (verificationCode && onVerificationCode) {
        onVerificationCode(verificationCode);
      }
      try {
        await open(auth.authorizationUrl);
      } catch {
        const fallbackLabel = `integration-oauth-${auth.state}`;
        const existingWindow = await WebviewWindow.getByLabel(fallbackLabel);
        if (existingWindow) {
          await existingWindow.setFocus();
        } else {
          new WebviewWindow(fallbackLabel, {
            url: auth.authorizationUrl,
            title: 'Connect GitHub Models',
            width: 1120,
            height: 760,
            center: true,
            resizable: true,
            focus: true,
          });
        }
      }
      await invoke('wait_for_integration_oauth', { state: auth.state });
      await emit('integration-connected');
      return;
    } catch (error) {
      throw new Error(parseTauriErrorMessage(error));
    }
  }

  const label = `integration-oauth-${auth.state}`;
  const existingWindow = await WebviewWindow.getByLabel(label);
  if (existingWindow) {
    await existingWindow.setFocus();
    return;
  }

  const providerLabel = getAiProviderLabel(normalizedProvider);
  new WebviewWindow(label, {
    url: auth.authorizationUrl,
    title: `Connect ${providerLabel}`,
    width: 1120,
    height: 760,
    center: true,
    resizable: true,
    focus: true,
  });
}

export async function setAnthropicApiKeyForGoalAssignee(apiKey: string): Promise<void> {
  const trimmedApiKey = apiKey.trim();
  if (!trimmedApiKey) {
    throw new Error('Please enter your Anthropic API key.');
  }

  try {
    await invoke('set_anthropic_api_key', { apiKey: trimmedApiKey });
    await emit('integration-connected');
  } catch (error) {
    throw new Error(parseTauriErrorMessage(error));
  }
}

export async function setGitHubApiKeyForGoalAssignee(apiKey: string): Promise<void> {
  const trimmedApiKey = apiKey.trim();
  if (!trimmedApiKey) {
    throw new Error('Please enter your GitHub API key.');
  }

  try {
    await invoke('set_github_api_key', { apiKey: trimmedApiKey });
    await emit('integration-connected');
  } catch (error) {
    throw new Error(parseTauriErrorMessage(error));
  }
}

export async function clearGitHubApiKeyForGoalAssignee(): Promise<void> {
  try {
    await invoke('clear_github_api_key');
    await emit('integration-connected');
  } catch (error) {
    throw new Error(parseTauriErrorMessage(error));
  }
}

export async function clearAnthropicApiKeyForGoalAssignee(): Promise<void> {
  try {
    await invoke('clear_anthropic_api_key');
    await emit('integration-connected');
  } catch (error) {
    throw new Error(parseTauriErrorMessage(error));
  }
}

export async function setOllamaApiKeyForGoalAssignee(apiKey: string): Promise<void> {
  const trimmedApiKey = apiKey.trim();
  if (!trimmedApiKey) {
    throw new Error('Please enter your Ollama API key.');
  }

  try {
    await invoke('set_ollama_api_key', { apiKey: trimmedApiKey });
    await emit('integration-connected');
  } catch (error) {
    throw new Error(parseTauriErrorMessage(error));
  }
}

export async function clearOllamaApiKeyForGoalAssignee(): Promise<void> {
  try {
    await invoke('clear_ollama_api_key');
    await emit('integration-connected');
  } catch (error) {
    throw new Error(parseTauriErrorMessage(error));
  }
}

export async function setGeminiApiKeyForGoalAssignee(apiKey: string): Promise<void> {
  const trimmedApiKey = apiKey.trim();
  if (!trimmedApiKey) {
    throw new Error('Please enter your Gemini API key.');
  }

  try {
    await invoke('set_gemini_api_key', { apiKey: trimmedApiKey });
    await emit('integration-connected');
  } catch (error) {
    throw new Error(parseTauriErrorMessage(error));
  }
}

export async function clearGeminiApiKeyForGoalAssignee(): Promise<void> {
  try {
    await invoke('clear_gemini_api_key');
    await emit('integration-connected');
  } catch (error) {
    throw new Error(parseTauriErrorMessage(error));
  }
}

export async function setMistralApiKeyForGoalAssignee(apiKey: string): Promise<void> {
  const trimmedApiKey = apiKey.trim();
  if (!trimmedApiKey) {
    throw new Error('Please enter your Mistral API key.');
  }

  try {
    await invoke('set_mistral_api_key', { apiKey: trimmedApiKey });
    await emit('integration-connected');
  } catch (error) {
    throw new Error(parseTauriErrorMessage(error));
  }
}

export async function clearMistralApiKeyForGoalAssignee(): Promise<void> {
  try {
    await invoke('clear_mistral_api_key');
    await emit('integration-connected');
  } catch (error) {
    throw new Error(parseTauriErrorMessage(error));
  }
}

export async function setPerplexityApiKeyForGoalAssignee(apiKey: string): Promise<void> {
  const trimmedApiKey = apiKey.trim();
  if (!trimmedApiKey) {
    throw new Error('Please enter your Perplexity API key.');
  }

  try {
    await invoke('set_perplexity_api_key', { apiKey: trimmedApiKey });
    await emit('integration-connected');
  } catch (error) {
    throw new Error(parseTauriErrorMessage(error));
  }
}

export async function clearPerplexityApiKeyForGoalAssignee(): Promise<void> {
  try {
    await invoke('clear_perplexity_api_key');
    await emit('integration-connected');
  } catch (error) {
    throw new Error(parseTauriErrorMessage(error));
  }
}

export async function setOpenRouterApiKeyForGoalAssignee(apiKey: string): Promise<void> {
  const trimmedApiKey = apiKey.trim();
  if (!trimmedApiKey) {
    throw new Error('Please enter your OpenRouter API key.');
  }

  try {
    await invoke('set_openrouter_api_key', { apiKey: trimmedApiKey });
    await emit('integration-connected');
  } catch (error) {
    throw new Error(parseTauriErrorMessage(error));
  }
}

export async function clearOpenRouterApiKeyForGoalAssignee(): Promise<void> {
  try {
    await invoke('clear_openrouter_api_key');
    await emit('integration-connected');
  } catch (error) {
    throw new Error(parseTauriErrorMessage(error));
  }
}

export async function setGroqApiKeyForGoalAssignee(apiKey: string): Promise<void> {
  const trimmedApiKey = apiKey.trim();
  if (!trimmedApiKey) {
    throw new Error('Please enter your Groq API key.');
  }

  try {
    await invoke('set_groq_api_key', { apiKey: trimmedApiKey });
    await emit('integration-connected');
  } catch (error) {
    throw new Error(parseTauriErrorMessage(error));
  }
}

export async function clearGroqApiKeyForGoalAssignee(): Promise<void> {
  try {
    await invoke('clear_groq_api_key');
    await emit('integration-connected');
  } catch (error) {
    throw new Error(parseTauriErrorMessage(error));
  }
}

export async function setAzureOpenAiApiKeyForGoalAssignee(apiKey: string): Promise<void> {
  const trimmedApiKey = apiKey.trim();
  if (!trimmedApiKey) {
    throw new Error('Please enter your Azure OpenAI API key.');
  }

  try {
    await invoke('set_azure_openai_api_key', { apiKey: trimmedApiKey });
    await emit('integration-connected');
  } catch (error) {
    throw new Error(parseTauriErrorMessage(error));
  }
}

export async function clearAzureOpenAiApiKeyForGoalAssignee(): Promise<void> {
  try {
    await invoke('clear_azure_openai_api_key');
    await emit('integration-connected');
  } catch (error) {
    throw new Error(parseTauriErrorMessage(error));
  }
}

export async function setTogetherApiKeyForGoalAssignee(apiKey: string): Promise<void> {
  const trimmedApiKey = apiKey.trim();
  if (!trimmedApiKey) {
    throw new Error('Please enter your Together AI API key.');
  }

  try {
    await invoke('set_together_api_key', { apiKey: trimmedApiKey });
    await emit('integration-connected');
  } catch (error) {
    throw new Error(parseTauriErrorMessage(error));
  }
}

export async function clearTogetherApiKeyForGoalAssignee(): Promise<void> {
  try {
    await invoke('clear_together_api_key');
    await emit('integration-connected');
  } catch (error) {
    throw new Error(parseTauriErrorMessage(error));
  }
}

export async function setOpenAiApiKeyForGoalAssignee(apiKey: string): Promise<void> {
  const trimmedApiKey = apiKey.trim();
  if (!trimmedApiKey) {
    throw new Error('Please enter your OpenAI API key.');
  }

  try {
    await invoke('set_openai_api_key', { apiKey: trimmedApiKey });
    await emit('integration-connected');
  } catch (error) {
    throw new Error(parseTauriErrorMessage(error));
  }
}

export async function clearOpenAiApiKeyForGoalAssignee(): Promise<void> {
  try {
    await invoke('clear_openai_api_key');
    await emit('integration-connected');
  } catch (error) {
    throw new Error(parseTauriErrorMessage(error));
  }
}

export async function listAvailableAiModelsForGoalAssignee(
  vaultId?: string
): Promise<AvailableAiModelsResult> {
  if (!navigator.onLine) {
    return {
      models: [],
      providers: getFallbackAiProviders(),
    };
  }

  try {
    const trimmedVaultId = vaultId?.trim();
    const response = await invoke<AvailableModelsResponse | null>(
      'list_available_ai_models',
      { vaultId: trimmedVaultId ?? null }
    );
    if (!response || !Array.isArray(response.models)) {
      return {
        models: [],
        providers: getFallbackAiProviders(),
      };
    }
    const models = dedupeModels(response.models);
    const providers = mergeProvidersWithFallback(normalizeProviderList(response.providers));
    return {
      models,
      providers: providers.length > 0 ? providers : getFallbackAiProviders(),
    };
  } catch (error) {
    console.warn('[AI Goal Planning] Failed to load available models:', error);
    return {
      models: [],
      providers: getFallbackAiProviders(),
    };
  }
}

function normalizeOptionalLineList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) {
    const normalized = value
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter(Boolean)
      .slice(0, 12);
    return normalized.length > 0 ? normalized : undefined;
  }

  if (typeof value === 'string') {
    const normalized = value
      .split('\n')
      .map((entry) => entry.replace(/^\s*[-*]\s*/, '').trim())
      .filter(Boolean)
      .slice(0, 12);
    return normalized.length > 0 ? normalized : undefined;
  }

  return undefined;
}

function stripOptionalCodeFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }
  const lines = trimmed.split('\n');
  if (lines.length < 3) {
    return trimmed;
  }
  const lastLine = lines[lines.length - 1]?.trim();
  if (lastLine !== '```') {
    return trimmed;
  }
  return lines.slice(1, -1).join('\n').trim();
}

function normalizeStructuredTextBlock(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  let normalized = value.trim();
  if (!normalized) {
    return undefined;
  }

  normalized = normalized
    .replace(/\r\n/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, '  ');

  normalized = stripOptionalCodeFence(normalized);
  return normalized.trim() || undefined;
}

function normalizeOptionalJourneySpecs(value: unknown): GenerateAiGoalJourneySpecResult[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .map((entry) => {
      if (typeof entry === 'string') {
        const name = entry.trim();
        return name ? { name } : null;
      }

      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const payload = entry as Record<string, unknown>;
      const nameValue = payload.name ?? payload.title ?? payload.journey;
      const actorValue = payload.actor ?? payload.user ?? payload.role;
      const triggerValue = payload.trigger ?? payload.when ?? payload.event;
      const stepsValue = payload.steps ?? payload.flow;
      const successValue = payload.successCriteria ?? payload.success_criteria ?? payload.outcomes;

      const name = typeof nameValue === 'string' ? nameValue.trim() : '';
      const actor = typeof actorValue === 'string' ? actorValue.trim() : '';
      const trigger = typeof triggerValue === 'string' ? triggerValue.trim() : '';
      const steps = normalizeOptionalLineList(stepsValue);
      const successCriteria = normalizeOptionalLineList(successValue);

      if (!name && !actor && !trigger && !steps && !successCriteria) {
        return null;
      }

      return {
        name: name || 'Journey',
        actor: actor || undefined,
        trigger: trigger || undefined,
        steps,
        successCriteria,
      } satisfies GenerateAiGoalJourneySpecResult;
    })
    .filter((entry): entry is GenerateAiGoalJourneySpecResult => entry !== null)
    .slice(0, 8);

  return normalized.length > 0 ? normalized : undefined;
}

function toYamlScalar(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return '""';
  }
  return `"${trimmed.replace(/"/g, '\\"')}"`;
}

function toMermaidLabel(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return 'Step';
  }
  return trimmed
    .replace(/[[\]{}()]/g, '')
    .replace(/"/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function buildFallbackSchema(goalTitle: string, milestones: string[]): string {
  const safeTitle = toYamlScalar(goalTitle || 'Generated Goal');
  const milestoneLines = milestones.slice(0, 8).flatMap((milestone, index) => ([
    `  - id: m${index + 1}`,
    `    title: ${toYamlScalar(milestone)}`,
    '    status: backlog',
  ]));

  return [
    'goal:',
    `  title: ${safeTitle}`,
    '  objective: string',
    '  priority: low|medium|high|critical',
    '  deadline: YYYY-MM-DD',
    'milestones:',
    ...(milestoneLines.length > 0 ? milestoneLines : ['  - id: m1', '    title: "Milestone 1"', '    status: backlog']),
    'tasks:',
    '  - id: t1',
    '    milestone_id: m1',
    '    title: "Task title"',
    '    status: backlog|in_progress|done',
    'artifacts:',
    '  goals_doc: goals/<GoalName>.md',
    '  now_docs: goals/<GoalName>/<MilestoneName>.md',
    '  task_docs: tasks/<GoalName>/<MilestoneName>/<TaskName>.md',
  ].join('\n');
}

function buildFallbackFlow(goalTitle: string, milestones: string[]): string {
  const titleLabel = toMermaidLabel(goalTitle || 'Goal');
  const nodes = milestones.slice(0, 8).map((milestone, index) => ({
    id: `M${index + 1}`,
    label: toMermaidLabel(milestone),
  }));

  const lines = [
    'flowchart TD',
    `  A["Goal: ${titleLabel}"] --> B["Generate GOALS spec"]`,
    '  B --> C["Generate NOW specs"]',
  ];

  if (nodes.length === 0) {
    lines.push('  C --> D["Create milestone tasks"]');
  } else {
    nodes.forEach((node, index) => {
      lines.push(`  C --> ${node.id}["${node.label}"]`);
      lines.push(`${index === nodes.length - 1 ? `  ${node.id}` : `  ${node.id}`} --> ${index === nodes.length - 1 ? 'D' : nodes[index + 1].id}`);
    });
    lines.push('  D["Validate + ship"]');
  }

  if (nodes.length === 0) {
    lines.push('  D --> E["Validate + ship"]');
  } else {
    lines.push('  D --> E["Done"]');
  }

  return lines.join('\n');
}

export async function generateAiGoalPlan(
  input: GenerateAiGoalPlanInput
): Promise<GenerateAiGoalPlanResult> {
  const goalBrief = input.goalBrief.trim();
  const vaultId = input.vaultId.trim();
  if (!goalBrief) {
    throw new Error('Please describe the goal for AI planning');
  }
  if (!vaultId) {
    throw new Error('Open a vault before using an AI assignee');
  }
  if (!input.modelId.trim()) {
    throw new Error('Please choose an AI model');
  }

  const response = await invoke<GenerateAiGoalPlanResult>('generate_integration_goal_plan', {
    vaultId,
    title: input.title?.trim() || null,
    goalBrief,
    deadline: input.deadline,
    priority: input.priority?.trim() || null,
    modelId: input.modelId.trim(),
  });

  const title = response.title?.trim();
  const milestones = Array.isArray(response.milestones)
    ? response.milestones
      .map((milestone) => milestone.trim())
      .filter(Boolean)
    : [];

  if (!title) {
    throw new Error('AI did not return a goal title');
  }
  if (milestones.length === 0) {
    throw new Error('AI did not return milestones');
  }

  const milestoneBriefs = Array.isArray(response.milestoneBriefs)
    ? response.milestoneBriefs
      .map((brief) => brief.trim())
      .filter(Boolean)
      .slice(0, 8)
    : undefined;
  const milestoneTasks = Array.isArray(response.milestoneTasks)
    ? response.milestoneTasks
      .slice(0, 8)
      .map((group) =>
        Array.isArray(group)
          ? group
            .map((task) => (typeof task === 'string' ? task.trim() : ''))
            .filter(Boolean)
            .slice(0, 8)
          : []
      )
    : undefined;
  const normalizedMilestoneTasks = milestoneTasks?.some((group) => group.length > 0)
    ? milestoneTasks
    : undefined;
  const taskBriefs = Array.isArray(response.taskBriefs)
    ? response.taskBriefs
      .slice(0, 8)
      .map((group) =>
        Array.isArray(group)
          ? group
            .map((brief) => (typeof brief === 'string' ? brief.trim() : ''))
            .filter(Boolean)
            .slice(0, 8)
          : []
      )
    : undefined;
  const normalizedTaskBriefs = taskBriefs?.some((group) => group.length > 0)
    ? taskBriefs
    : undefined;
  const scopeIn = normalizeOptionalLineList(response.scopeIn);
  const scopeOut = normalizeOptionalLineList(response.scopeOut);
  const userJourneySpecs = normalizeOptionalJourneySpecs(response.userJourneySpecs);
  const systemJourneySpecs = normalizeOptionalJourneySpecs(response.systemJourneySpecs);
  const acceptanceCriteria = normalizeOptionalLineList(response.acceptanceCriteria);
  const guardrails = normalizeOptionalLineList(response.guardrails);
  const workingRules = normalizeOptionalLineList(response.workingRules);
  const qualityGates = normalizeOptionalLineList(response.qualityGates);
  const definitionOfDone = normalizeOptionalLineList(response.definitionOfDone);
  const resolvedTitle = title || input.title?.trim() || 'Generated Goal';
  const schema = normalizeStructuredTextBlock(response.schema)
    || buildFallbackSchema(resolvedTitle, milestones);
  const flows = normalizeStructuredTextBlock(response.flows)
    || buildFallbackFlow(resolvedTitle, milestones);
  const goalOverview = response.goalOverview?.trim() || undefined;

  return {
    title,
    milestones,
    summary: response.summary?.trim() || undefined,
    goalOverview,
    scopeIn,
    scopeOut,
    userJourneySpecs,
    systemJourneySpecs,
    milestoneBriefs,
    milestoneTasks: normalizedMilestoneTasks,
    taskBriefs: normalizedTaskBriefs,
    acceptanceCriteria,
    guardrails,
    workingRules,
    qualityGates,
    definitionOfDone,
    schema,
    flows,
  };
}
