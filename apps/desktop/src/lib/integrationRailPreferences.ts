export const INTEGRATION_RAIL_STORAGE_KEY = 'goalrate.desktop.integration-rail.providers';

function getStorage(storage?: Storage | null): Storage | null {
  if (storage !== undefined) {
    return storage;
  }

  if (typeof window === 'undefined') {
    return null;
  }

  return window.localStorage;
}

export function normalizeIntegrationProviderIds(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seen = new Set<string>();
  const normalized: string[] = [];
  value.forEach((entry) => {
    if (typeof entry !== 'string') {
      return;
    }
    const providerId = entry.trim().toLowerCase();
    if (!providerId || seen.has(providerId)) {
      return;
    }
    seen.add(providerId);
    normalized.push(providerId);
  });

  return normalized;
}

export function readIntegrationRailProviders(storage?: Storage | null): string[] {
  const storageTarget = getStorage(storage);
  if (!storageTarget) {
    return [];
  }

  try {
    const raw = storageTarget.getItem(INTEGRATION_RAIL_STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return normalizeIntegrationProviderIds(parsed);
  } catch (error) {
    console.warn('Failed to read selected integration providers:', error);
    return [];
  }
}

export function writeIntegrationRailProviders(
  providerIds: string[],
  storage?: Storage | null
): void {
  const storageTarget = getStorage(storage);
  if (!storageTarget) {
    return;
  }

  const normalizedProviderIds = normalizeIntegrationProviderIds(providerIds);
  storageTarget.setItem(
    INTEGRATION_RAIL_STORAGE_KEY,
    JSON.stringify(normalizedProviderIds)
  );
}
