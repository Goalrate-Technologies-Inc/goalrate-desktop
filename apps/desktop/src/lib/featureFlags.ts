type FeatureFlagEnv = Record<string, string | boolean | undefined>;

export type DesktopFeatureFlags = {
  focusList: {
    enabled: boolean;
  };
};

export const DEFAULT_FEATURE_FLAGS: DesktopFeatureFlags = {
  focusList: {
    enabled: false,
  },
};

const TRUE_VALUES = new Set(['1', 'true', 'yes', 'on']);
const FALSE_VALUES = new Set(['0', 'false', 'no', 'off']);

function normalizeEnvFlag(
  value: string | boolean | undefined
): string | boolean | undefined {
  if (typeof value === 'string' && value.trim() === '') {
    return undefined;
  }

  return value;
}

function parseBooleanFlag(value: string | boolean | undefined, fallback: boolean): boolean {
  if (typeof value === 'boolean') {
    return value;
  }

  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();
  if (TRUE_VALUES.has(normalized)) {
    return true;
  }
  if (FALSE_VALUES.has(normalized)) {
    return false;
  }

  return fallback;
}

export function createFeatureFlags(
  env: FeatureFlagEnv = import.meta.env as FeatureFlagEnv
): DesktopFeatureFlags {
  const focusListEnabled =
    normalizeEnvFlag(env.VITE_FEATURE_FOCUS_LIST_ENABLED) ??
    normalizeEnvFlag(env.VITE_FOCUS_LIST_ENABLED);

  const focusList = {
    ...DEFAULT_FEATURE_FLAGS.focusList,
    enabled: parseBooleanFlag(focusListEnabled, DEFAULT_FEATURE_FLAGS.focusList.enabled),
  };

  return {
    ...DEFAULT_FEATURE_FLAGS,
    focusList,
  };
}

export const featureFlags = createFeatureFlags();
