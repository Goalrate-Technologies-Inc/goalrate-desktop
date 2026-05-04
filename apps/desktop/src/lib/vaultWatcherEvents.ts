export interface VaultLibraryUpdatedPayload {
  vaultId?: string;
  paths?: unknown;
}

export function vaultUpdatePaths(
  payload: VaultLibraryUpdatedPayload | null | undefined,
): string[] | null {
  if (!Array.isArray(payload?.paths)) {
    return null;
  }

  return payload.paths.filter((path): path is string => typeof path === "string");
}

function refreshCategoryForPath(path: string): string {
  if (
    path.startsWith("goals/") ||
    path.startsWith("tasks/") ||
    path.startsWith("domains/") ||
    path === "eisenhower-matrix.md"
  ) {
    return "goals";
  }
  if (path.startsWith("agenda/")) {
    return "agenda";
  }
  if (path === "memory.md") {
    return "memory";
  }
  if (path.startsWith("logs/")) {
    return "issues";
  }
  if (path === "system/mutations.md" || path.startsWith("system/snapshots/")) {
    return "recovery";
  }
  return "vault";
}

export function vaultRefreshStatusLabel(paths: string[] | null): string {
  if (paths === null || paths.length === 0) {
    return "Vault refreshed";
  }

  const categories = new Set(paths.map(refreshCategoryForPath));
  if (categories.size !== 1) {
    return "Vault refreshed";
  }

  const [category] = Array.from(categories);
  switch (category) {
    case "goals":
      return "Goals refreshed";
    case "agenda":
      return "Agenda refreshed";
    case "memory":
      return "Memory refreshed";
    case "issues":
      return "Issues refreshed";
    case "recovery":
      return "Recovery refreshed";
    default:
      return "Vault refreshed";
  }
}

export function pathsAffectAgenda(
  paths: string[] | null,
  date: string,
): boolean {
  if (paths === null || paths.length === 0) {
    return true;
  }

  const agendaPath = `agenda/${date}.md`;
  return paths.some(
    (path) =>
      path === ".vault.json" ||
      path === "memory.md" ||
      path === "eisenhower-matrix.md" ||
      path === agendaPath ||
      path.startsWith("goals/") ||
      path.startsWith("tasks/"),
  );
}

export function pathsAffectRoadmap(paths: string[] | null): boolean {
  if (paths === null || paths.length === 0) {
    return true;
  }

  return paths.some(
    (path) =>
      path === ".vault.json" ||
      path === "eisenhower-matrix.md" ||
      path.startsWith("goals/") ||
      path.startsWith("tasks/") ||
      path.startsWith("domains/"),
  );
}

export function pathsAffectRecoveryIssues(paths: string[] | null): boolean {
  if (paths === null || paths.length === 0) {
    return true;
  }

  return paths.some(
    (path) =>
      path === ".vault.json" ||
      path === "logs/errors.md" ||
      path.startsWith("logs/"),
  );
}

export function pathsAffectRecoverySnapshots(paths: string[] | null): boolean {
  if (paths === null || paths.length === 0) {
    return true;
  }

  return paths.some(
    (path) =>
      path === ".vault.json" ||
      path === "system/mutations.md" ||
      path.startsWith("system/snapshots/"),
  );
}
