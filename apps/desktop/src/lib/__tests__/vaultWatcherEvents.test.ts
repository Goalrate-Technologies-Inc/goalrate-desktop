import { describe, expect, it } from "vitest";
import {
  pathsAffectDailyLoop,
  pathsAffectRecoveryIssues,
  pathsAffectRecoverySnapshots,
  pathsAffectRoadmap,
  vaultRefreshStatusLabel,
  vaultUpdatePaths,
} from "../vaultWatcherEvents";

describe("vaultWatcherEvents", () => {
  it("normalizes watcher path payloads", () => {
    expect(
      vaultUpdatePaths({
        vaultId: "vault_test",
        paths: ["goals/launch.md", 42, "logs/errors.md", null],
      }),
    ).toEqual(["goals/launch.md", "logs/errors.md"]);
    expect(vaultUpdatePaths({ vaultId: "vault_test" })).toBeNull();
    expect(vaultUpdatePaths({ vaultId: "vault_test", paths: null })).toBeNull();
    expect(vaultUpdatePaths(null)).toBeNull();
  });

  it("keeps missing or empty paths as broad refreshes", () => {
    expect(pathsAffectDailyLoop(null, "2026-04-26")).toBe(true);
    expect(pathsAffectRoadmap([])).toBe(true);
    expect(pathsAffectRecoveryIssues(null)).toBe(true);
    expect(pathsAffectRecoverySnapshots([])).toBe(true);
  });

  it("filters Agenda refresh paths", () => {
    expect(pathsAffectDailyLoop(["agenda/2026-04-26.md"], "2026-04-26")).toBe(
      true,
    );
    expect(pathsAffectDailyLoop(["agenda/2026-04-25.md"], "2026-04-26")).toBe(
      false,
    );
    expect(pathsAffectDailyLoop(["goals/launch.md"], "2026-04-26")).toBe(true);
    expect(pathsAffectDailyLoop([".goalrate/daily-loop.db"], "2026-04-26")).toBe(
      false,
    );
    expect(pathsAffectDailyLoop(["logs/errors.md"], "2026-04-26")).toBe(false);
  });

  it("filters Roadmap refresh paths", () => {
    expect(pathsAffectRoadmap(["goals/launch.md"])).toBe(true);
    expect(pathsAffectRoadmap(["tasks/task.md"])).toBe(true);
    expect(pathsAffectRoadmap(["domains/work.md"])).toBe(true);
    expect(pathsAffectRoadmap(["logs/errors.md"])).toBe(false);
    expect(pathsAffectRoadmap(["agenda/2026-04-26.md"])).toBe(false);
  });

  it("filters Settings recovery refresh paths", () => {
    expect(pathsAffectRecoveryIssues(["logs/errors.md"])).toBe(true);
    expect(pathsAffectRecoveryIssues(["goals/launch.md"])).toBe(false);
    expect(pathsAffectRecoverySnapshots(["system/mutations.md"])).toBe(true);
    expect(pathsAffectRecoverySnapshots(["system/snapshots/launch.md"])).toBe(
      true,
    );
    expect(pathsAffectRecoverySnapshots(["logs/errors.md"])).toBe(false);
  });

  it("builds compact local refresh status labels", () => {
    expect(vaultRefreshStatusLabel(null)).toBe("Vault refreshed");
    expect(vaultRefreshStatusLabel([])).toBe("Vault refreshed");
    expect(vaultRefreshStatusLabel(["goals/launch.md"])).toBe(
      "Goals refreshed",
    );
    expect(vaultRefreshStatusLabel(["tasks/task.md"])).toBe(
      "Goals refreshed",
    );
    expect(vaultRefreshStatusLabel(["agenda/2026-04-26.md"])).toBe(
      "Agenda refreshed",
    );
    expect(vaultRefreshStatusLabel(["logs/errors.md"])).toBe(
      "Issues refreshed",
    );
    expect(vaultRefreshStatusLabel(["system/mutations.md"])).toBe(
      "Recovery refreshed",
    );
    expect(
      vaultRefreshStatusLabel(["goals/launch.md", "agenda/2026-04-26.md"]),
    ).toBe("Vault refreshed");
  });
});
