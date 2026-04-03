import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  INTEGRATION_RAIL_STORAGE_KEY,
  normalizeIntegrationProviderIds,
  readIntegrationRailProviders,
  writeIntegrationRailProviders,
} from '../integrationRailPreferences';

describe('integrationRailPreferences', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('normalizes provider IDs and removes duplicates', () => {
    expect(
      normalizeIntegrationProviderIds([' OpenAI ', 'anthropic', 'openai', '', 42, null])
    ).toEqual(['openai', 'anthropic']);
  });

  it('reads normalized provider IDs from storage', () => {
    window.localStorage.setItem(
      INTEGRATION_RAIL_STORAGE_KEY,
      JSON.stringify(['OpenAI', 'openai', ' anthropic '])
    );

    expect(readIntegrationRailProviders()).toEqual(['openai', 'anthropic']);
  });

  it('returns an empty list when stored JSON is invalid', () => {
    window.localStorage.setItem(INTEGRATION_RAIL_STORAGE_KEY, 'not-json');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(readIntegrationRailProviders()).toEqual([]);
    warnSpy.mockRestore();
  });

  it('writes normalized provider IDs to storage', () => {
    writeIntegrationRailProviders([' openai', 'openai', 'Anthropic']);

    expect(
      JSON.parse(window.localStorage.getItem(INTEGRATION_RAIL_STORAGE_KEY) ?? '[]')
    ).toEqual(['openai', 'anthropic']);
  });
});
