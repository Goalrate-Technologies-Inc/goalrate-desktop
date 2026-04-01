import { describe, expect, it } from 'vitest';
import {
  calculateNextCapacitySP,
  calculateNextCapacitySPWithDebug,
  clampCapacity,
  normalizeCapacityEngineConfig,
  resetCapacityToBaseline,
  roundToIncrement,
} from '../../src/focus/capacityEngine';

describe('roundToIncrement', () => {
  it('rounds to the nearest 0.5 by default behavior', () => {
    expect(roundToIncrement(14.3, 0.5)).toBe(14.5);
    expect(roundToIncrement(11.7, 0.5)).toBe(11.5);
  });

  it('falls back to increment 1 when increment is invalid', () => {
    expect(roundToIncrement(14.3, Number.NaN)).toBe(14);
    expect(roundToIncrement(14.8, 0)).toBe(15);
  });
});

describe('clampCapacity', () => {
  it('clamps values to the provided range', () => {
    expect(clampCapacity(2, 3, 40)).toBe(3);
    expect(clampCapacity(41, 3, 40)).toBe(40);
    expect(clampCapacity(12, 3, 40)).toBe(12);
  });
});

describe('normalizeCapacityEngineConfig', () => {
  it('applies defaults for missing or invalid values', () => {
    const config = normalizeCapacityEngineConfig({
      baselineSP: Number.NaN,
      minSP: -1,
      maxSP: 0,
      stepUpPct: -0.2,
      stepDownPct: Number.NaN,
      rounding: 0,
    });

    expect(config).toEqual({
      baselineSP: 13,
      minSP: 3,
      maxSP: 40,
      stepUpPct: 0.1,
      stepDownPct: 0.1,
      rounding: 0.5,
    });
  });

  it('enforces maxSP >= minSP and clamps baseline into range', () => {
    const config = normalizeCapacityEngineConfig({
      baselineSP: 100,
      minSP: 5,
      maxSP: 4,
    });

    expect(config.minSP).toBe(5);
    expect(config.maxSP).toBe(5);
    expect(config.baselineSP).toBe(5);
  });
});

describe('calculateNextCapacitySP', () => {
  it('increases capacity by 10% when all planned work is done', () => {
    const nextCapacitySP = calculateNextCapacitySP({
      currentCapacitySP: 13,
      stats: { allDone: true },
    });

    expect(nextCapacitySP).toBe(14.5);
  });

  it('decreases capacity by 10% when planned work is not all done', () => {
    const nextCapacitySP = calculateNextCapacitySP({
      currentCapacitySP: 13,
      stats: { allDone: false },
    });

    expect(nextCapacitySP).toBe(11.5);
  });

  it('clamps to max and min bounds after adjustment', () => {
    const increasedAtMax = calculateNextCapacitySP({
      currentCapacitySP: 40,
      stats: { allDone: true },
    });
    const decreasedAtMin = calculateNextCapacitySP({
      currentCapacitySP: 3,
      stats: { allDone: false },
    });

    expect(increasedAtMax).toBe(40);
    expect(decreasedAtMin).toBe(3);
  });

  it('uses baseline when current capacity is invalid', () => {
    const nextCapacitySP = calculateNextCapacitySP({
      currentCapacitySP: Number.NaN,
      stats: { allDone: true },
    });

    expect(nextCapacitySP).toBe(14.5);
  });

  it('respects custom profile settings', () => {
    const nextCapacitySP = calculateNextCapacitySP({
      currentCapacitySP: 10,
      stats: { allDone: true },
      profile: {
        minSP: 2,
        maxSP: 12,
        stepUpPct: 0.2,
        stepDownPct: 0.2,
        rounding: 1,
      },
    });

    expect(nextCapacitySP).toBe(12);
  });
});

describe('resetCapacityToBaseline', () => {
  it('returns the default baseline when no overrides are provided', () => {
    expect(resetCapacityToBaseline()).toBe(13);
  });

  it('returns baseline clamped within profile min/max', () => {
    expect(
      resetCapacityToBaseline({
        baselineSP: 50,
        minSP: 3,
        maxSP: 20,
      })
    ).toBe(20);
  });
});

describe('calculateNextCapacitySPWithDebug', () => {
  it('returns baseline when resetToBaseline is enabled', () => {
    const nextCapacitySP = calculateNextCapacitySPWithDebug({
      currentCapacitySP: 29,
      stats: { allDone: false },
      profile: {
        baselineSP: 11,
        minSP: 3,
        maxSP: 40,
      },
      debug: {
        resetToBaseline: true,
      },
    });

    expect(nextCapacitySP).toBe(11);
  });

  it('keeps capacity unchanged when freezeCapacity is enabled', () => {
    const nextCapacitySP = calculateNextCapacitySPWithDebug({
      currentCapacitySP: 17,
      stats: { allDone: true },
      debug: {
        freezeCapacity: true,
      },
    });

    expect(nextCapacitySP).toBe(17);
  });

  it('uses explicit frozen capacity when provided', () => {
    const nextCapacitySP = calculateNextCapacitySPWithDebug({
      currentCapacitySP: 17,
      stats: { allDone: true },
      profile: {
        minSP: 3,
        maxSP: 40,
      },
      debug: {
        freezeCapacity: true,
        frozenCapacitySP: 39.5,
      },
    });

    expect(nextCapacitySP).toBe(39.5);
  });

  it('falls back to standard calculation when no debug flags are enabled', () => {
    const nextCapacitySP = calculateNextCapacitySPWithDebug({
      currentCapacitySP: 13,
      stats: { allDone: true },
    });

    expect(nextCapacitySP).toBe(14.5);
  });
});
