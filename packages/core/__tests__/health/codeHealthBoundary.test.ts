import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const THIS_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(THIS_DIR, '../../../..');
const FILTER_MODULES = [
  resolve(REPO_ROOT, 'packages/ui-native/src/goals/goal-filters.tsx'),
  resolve(REPO_ROOT, 'packages/ui-native/src/projects/project-filters.tsx'),
];

describe('code health dependency boundary checks', () => {
  it('uses shared priority utilities instead of local duplicated maps', () => {
    for (const modulePath of FILTER_MODULES) {
      const source = readFileSync(modulePath, 'utf8');
      expect(source).toContain("import { comparePriority } from '@goalrate-app/shared';");
      expect(source).not.toContain('const priorityOrder');
    }
  });
});
