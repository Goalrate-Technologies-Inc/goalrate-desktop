import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import {
  listAvailableAiModelsForGoalAssignee,
  type AiModelOption,
  type AiProviderOption,
} from '../lib/aiGoalPlanning';

export function useAvailableAiModels(enabled: boolean, vaultId?: string): {
  models: AiModelOption[];
  providers: AiProviderOption[];
  loading: boolean;
  refresh: () => void;
} {
  const [models, setModels] = useState<AiModelOption[]>([]);
  const [providers, setProviders] = useState<AiProviderOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const refresh = (): void => {
    setRefreshCounter((count) => count + 1);
  };

  useEffect(() => {
    if (!enabled) {
      return;
    }

    let disposed = false;
    let unlisten: (() => void) | undefined;

    const registerListener = async (): Promise<void> => {
      unlisten = await listen('integration-connected', () => {
        if (!disposed) {
          setRefreshCounter((count) => count + 1);
        }
      });
    };

    void registerListener();

    return () => {
      disposed = true;
      if (unlisten) {
        unlisten();
      }
    };
  }, [enabled]);

  useEffect(() => {
    let cancelled = false;

    const loadModels = async (): Promise<void> => {
      if (!enabled) {
        setModels([]);
        setProviders([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      try {
        const available = await listAvailableAiModelsForGoalAssignee(vaultId);
        if (!cancelled) {
          setModels(available.models);
          setProviders(available.providers);
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    loadModels();

    return () => {
      cancelled = true;
    };
  }, [enabled, vaultId, refreshCounter]);

  return { models, providers, loading, refresh };
}
