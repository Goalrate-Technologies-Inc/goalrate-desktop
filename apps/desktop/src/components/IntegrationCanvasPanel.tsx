import { useMemo } from 'react';
import { Button } from '@goalrate-app/ui/primitives';
import { Check, Loader2, Sparkles } from 'lucide-react';
import { useVault } from '../context/VaultContext';
import { useAvailableAiModels } from '../hooks/useAvailableAiModels';
import {
  AI_PROVIDER_ORDER,
  getFallbackAiProviders,
  type AiProviderOption,
} from '../lib/aiGoalPlanning';
import {
  AzureOpenAiIcon,
  BedrockIcon,
  AnthropicIcon,
  GeminiIcon,
  GitHubIcon,
  GroqIcon,
  MistralIcon,
  OllamaIcon,
  OpenRouterIcon,
  OpenAIIcon,
  PerplexityIcon,
  TogetherAiIcon,
  VertexAiIcon,
} from './IntegrationIcons';

const PROVIDER_ICON_MAP: Record<string, typeof GitHubIcon> = {
  github: GitHubIcon,
  local: OllamaIcon,
  openai: OpenAIIcon,
  'azure-openai': AzureOpenAiIcon,
  openrouter: OpenRouterIcon,
  anthropic: AnthropicIcon,
  gemini: GeminiIcon,
  'vertex-ai': VertexAiIcon,
  mistral: MistralIcon,
  groq: GroqIcon,
  bedrock: BedrockIcon,
  perplexity: PerplexityIcon,
  together: TogetherAiIcon,
};

function orderProviders(providers: AiProviderOption[]): AiProviderOption[] {
  const byId = new Map(providers.map((provider) => [provider.id, provider]));
  const ordered = AI_PROVIDER_ORDER
    .map((providerId) => byId.get(providerId))
    .filter((provider): provider is AiProviderOption => Boolean(provider));

  providers.forEach((provider) => {
    if (!ordered.some((entry) => entry.id === provider.id)) {
      ordered.push(provider);
    }
  });

  return ordered;
}

function getProviderAccessMethods(provider: AiProviderOption): string[] {
  const normalizedConnectionType = provider.connectionType.trim().toLowerCase();

  if (provider.id === 'local' || normalizedConnectionType === 'local') {
    return ['SDK'];
  }

  if (normalizedConnectionType.includes('sdk') && normalizedConnectionType.includes('api_key')) {
    return ['SDK', 'API key'];
  }

  if (normalizedConnectionType.includes('sdk')) {
    return ['SDK'];
  }

  if (normalizedConnectionType.includes('oauth') && normalizedConnectionType.includes('api_key')) {
    return ['OAuth', 'API key'];
  }

  if (normalizedConnectionType.includes('oauth')) {
    return ['OAuth'];
  }

  if (normalizedConnectionType.includes('api_key')) {
    return ['API key'];
  }

  return ['API key'];
}

export function IntegrationCanvasPanel({
  selectedProviderIds,
  onAddIntegrationToRail,
  onRemoveIntegrationFromRail,
  onClose,
}: {
  selectedProviderIds: string[];
  onAddIntegrationToRail: (providerId: string) => void;
  onRemoveIntegrationFromRail: (providerId: string) => void;
  onClose: () => void;
}): React.ReactElement {
  const { currentVault } = useVault();
  const currentVaultId = currentVault?.id;
  const {
    providers: availableProviders,
    loading,
  } = useAvailableAiModels(true, currentVaultId ?? undefined);

  const providers = useMemo(
    () => orderProviders(availableProviders.length > 0 ? availableProviders : getFallbackAiProviders()),
    [availableProviders]
  );
  const selectedProviderIdSet = useMemo(
    () =>
      new Set(
        selectedProviderIds
          .map((providerId) => providerId.trim().toLowerCase())
          .filter((providerId) => providerId.length > 0)
      ),
    [selectedProviderIds]
  );

  return (
    <div className="h-full overflow-auto bg-background px-6 py-6">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-[0.2em] text-muted-foreground">
              AI Agents
            </h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Connect with OAuth, API key, or SDK and add agents to the integrations rail.
            </p>
          </div>
          <Button type="button" size="sm" variant="outline" onClick={onClose}>
            Done
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading AI agents...
          </div>
        ) : providers.length === 0 ? (
          <div className="rounded-md border border-dashed border-divider px-4 py-3 text-sm text-muted-foreground">
            No AI agents are available right now.
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {providers.map((provider) => {
              const ProviderIcon = PROVIDER_ICON_MAP[provider.id] ?? Sparkles;
              const methods = getProviderAccessMethods(provider);
              const isAdded = selectedProviderIdSet.has(provider.id);

              return (
                <div
                  key={provider.id}
                  className="rounded-lg border border-divider bg-card px-4 py-4"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                      <ProviderIcon className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate text-sm font-medium text-foreground">
                          {provider.label}
                        </p>
                        {provider.connected ? (
                          <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-primary">
                            Connected
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-1">
                        {methods.map((method) => (
                          <span
                            key={`${provider.id}-${method}`}
                            className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                          >
                            {method}
                          </span>
                        ))}
                      </div>
                      <p className="mt-2 text-xs text-muted-foreground">
                        {provider.message ?? `Set up ${provider.label} and add it to the integrations rail.`}
                      </p>
                    </div>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <Button
                      type="button"
                      size="sm"
                      variant={isAdded ? 'ghost' : 'outline'}
                      onClick={() => {
                        if (isAdded) {
                          onRemoveIntegrationFromRail(provider.id);
                          return;
                        }
                        onAddIntegrationToRail(provider.id);
                      }}
                    >
                      {isAdded ? (
                        <>
                          <Check className="h-4 w-4" />
                          Remove from rail
                        </>
                      ) : (
                        'Add to rail'
                      )}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
