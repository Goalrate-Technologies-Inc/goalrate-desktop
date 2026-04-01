import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import type { Goal } from '@goalrate-app/shared';
import { generateAiGoalPlan } from './aiGoalPlanning';
import { HUMAN_GOAL_ASSIGNEE, isAiGoalAssignee, type GoalAssignee } from './goalAssignee';
import { normalizeGoalDocSegment } from './goalDocNaming';

export interface CreateGoalWithAssigneeInput {
  assignee: GoalAssignee;
  reviewer?: GoalAssignee;
  title: string;
  description: string;
  deadline: string;
  priority: string;
  milestones?: string[];
  scopeIn?: string;
  scopeOut?: string;
  userJourneys?: string;
  systemJourneys?: string;
  userJourneySpecs?: GoalJourneySpecInput[];
  systemJourneySpecs?: GoalJourneySpecInput[];
  acceptanceCriteria?: string;
  guardrails?: string;
  publishMilestonesOnComplete?: boolean;
  measurable?: {
    unit: string;
    target?: number;
    current?: number;
  };
  confidence?: number;
  why?: string[];
  tags?: string[];
  notes?: string;
  schema?: string;
  flows?: string;
}

export interface GoalJourneySpecInput {
  name?: string;
  actor?: string;
  trigger?: string;
  steps?: string;
  successCriteria?: string;
}

interface StructuredGoalJourneySpec {
  name: string;
  actor: string;
  trigger: string;
  steps: string[];
  successCriteria: string[];
}

interface GoalSpecSections {
  scopeIn: string[];
  scopeOut: string[];
  userJourneySpecs: StructuredGoalJourneySpec[];
  systemJourneySpecs: StructuredGoalJourneySpec[];
  acceptanceCriteria: string[];
  guardrails: string[];
  workingRules: string[];
  qualityGates: string[];
  definitionOfDone: string[];
}

interface VaultTaskEntry {
  path: string;
  kind: 'folder' | 'file';
  extension?: string;
  children?: VaultTaskEntry[];
}

interface PlannedMarkdownDocument {
  path: string;
  parentPath: string;
  fileName: string;
  content: string;
}

interface ParsedMarkdownLink {
  href: string;
  line: number;
}

const SPEC_KIT_PROFILE = 'github/spec-kit';

function sanitizeMilestones(milestones?: string[]): string[] {
  if (!Array.isArray(milestones)) {
    return [];
  }

  return milestones
    .map((milestone) => milestone.trim())
    .filter(Boolean);
}

function normalizeMultilineEntries(value?: string): string[] {
  if (!value) {
    return [];
  }

  return value
    .split('\n')
    .map((entry) => entry.replace(/^\s*[-*]\s*/, '').trim())
    .filter(Boolean);
}

function normalizeChecklistEntries(value?: string): string[] {
  if (!value) {
    return [];
  }

  return value
    .split('\n')
    .map((entry) => entry.replace(/^\s*[-*]\s*/, '').replace(/^\[[ xX]\]\s*/, '').trim())
    .filter(Boolean);
}

function normalizeStructuredSpecBlock(value?: string): string {
  if (!value) {
    return '';
  }
  return value
    .trim()
    .replace(/\r\n/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, '  ');
}

function buildGoalSpecSections(input: {
  scopeIn?: string;
  scopeOut?: string;
  userJourneys?: string;
  systemJourneys?: string;
  userJourneySpecs?: GoalJourneySpecInput[];
  systemJourneySpecs?: GoalJourneySpecInput[];
  acceptanceCriteria?: string;
  guardrails?: string;
  workingRules?: string;
  qualityGates?: string;
  definitionOfDone?: string;
}): GoalSpecSections {
  const userJourneyLines = normalizeMultilineEntries(input.userJourneys);
  const systemJourneyLines = normalizeMultilineEntries(input.systemJourneys);
  return {
    scopeIn: normalizeMultilineEntries(input.scopeIn),
    scopeOut: normalizeMultilineEntries(input.scopeOut),
    userJourneySpecs: normalizeJourneySpecs(
      input.userJourneySpecs,
      userJourneyLines,
      'User Journey'
    ),
    systemJourneySpecs: normalizeJourneySpecs(
      input.systemJourneySpecs,
      systemJourneyLines,
      'System Journey'
    ),
    acceptanceCriteria: normalizeMultilineEntries(input.acceptanceCriteria),
    guardrails: normalizeMultilineEntries(input.guardrails),
    workingRules: normalizeMultilineEntries(input.workingRules),
    qualityGates: normalizeChecklistEntries(input.qualityGates),
    definitionOfDone: normalizeChecklistEntries(input.definitionOfDone),
  };
}

function mergeGoalSpecSections(base: GoalSpecSections, override: GoalSpecSections): GoalSpecSections {
  return {
    scopeIn: override.scopeIn.length > 0 ? override.scopeIn : base.scopeIn,
    scopeOut: override.scopeOut.length > 0 ? override.scopeOut : base.scopeOut,
    userJourneySpecs:
      override.userJourneySpecs.length > 0 ? override.userJourneySpecs : base.userJourneySpecs,
    systemJourneySpecs:
      override.systemJourneySpecs.length > 0 ? override.systemJourneySpecs : base.systemJourneySpecs,
    acceptanceCriteria:
      override.acceptanceCriteria.length > 0
        ? override.acceptanceCriteria
        : base.acceptanceCriteria,
    guardrails: override.guardrails.length > 0 ? override.guardrails : base.guardrails,
    workingRules: override.workingRules.length > 0 ? override.workingRules : base.workingRules,
    qualityGates: override.qualityGates.length > 0 ? override.qualityGates : base.qualityGates,
    definitionOfDone:
      override.definitionOfDone.length > 0 ? override.definitionOfDone : base.definitionOfDone,
  };
}

function normalizeJourneySpecs(
  specs: GoalJourneySpecInput[] | undefined,
  fallback: string[],
  defaultPrefix: string
): StructuredGoalJourneySpec[] {
  const normalized = Array.isArray(specs)
    ? specs
      .map((spec, index) => {
        const name = spec.name?.trim() ?? '';
        const actor = spec.actor?.trim() ?? '';
        const trigger = spec.trigger?.trim() ?? '';
        const steps = normalizeMultilineEntries(spec.steps);
        const successCriteria = normalizeMultilineEntries(spec.successCriteria);
        if (!name && !actor && !trigger && steps.length === 0 && successCriteria.length === 0) {
          return null;
        }
        return {
          name: name || `${defaultPrefix} ${index + 1}`,
          actor,
          trigger,
          steps,
          successCriteria,
        } satisfies StructuredGoalJourneySpec;
      })
      .filter((spec): spec is StructuredGoalJourneySpec => spec !== null)
    : [];

  if (normalized.length > 0) {
    return normalized;
  }

  return fallback.map((entry) => ({
    name: entry,
    actor: '',
    trigger: '',
    steps: [],
    successCriteria: [],
  }));
}

function renderJourneySpecs(
  specs: StructuredGoalJourneySpec[],
  emptyMessage: string
): string[] {
  if (specs.length === 0) {
    return [emptyMessage];
  }

  const lines: string[] = [];
  specs.forEach((journey, index) => {
    if (index > 0) {
      lines.push('');
    }
    lines.push(`### Journey ${index + 1}: ${journey.name}`);
    lines.push(`- Actor: ${journey.actor || 'TBD'}`);
    lines.push(`- Trigger: ${journey.trigger || 'TBD'}`);
    lines.push('Steps:');
    if (journey.steps.length > 0) {
      journey.steps.forEach((step, stepIndex) => lines.push(`${stepIndex + 1}. ${step}`));
    } else {
      lines.push('1. Define implementation steps.');
    }
    lines.push('Success Criteria:');
    if (journey.successCriteria.length > 0) {
      journey.successCriteria.forEach((criterion) => lines.push(`- ${criterion}`));
    } else {
      lines.push('- Define measurable success criteria.');
    }
  });
  return lines;
}

function describeAssignee(assignee: GoalAssignee): string {
  if (!isAiGoalAssignee(assignee)) {
    return 'You';
  }
  return assignee.modelId.trim() || 'AI model';
}

function buildAiPlanningBrief(description: string, sections: GoalSpecSections): string {
  const lines: string[] = [description.trim()];

  if (sections.scopeIn.length > 0) {
    lines.push('', 'In scope:', ...sections.scopeIn.map((entry) => `- ${entry}`));
  }
  if (sections.scopeOut.length > 0) {
    lines.push('', 'Out of scope:', ...sections.scopeOut.map((entry) => `- ${entry}`));
  }
  if (sections.userJourneySpecs.length > 0) {
    lines.push('', 'User journeys:');
    sections.userJourneySpecs.forEach((journey, index) => {
      lines.push(`- Journey ${index + 1}: ${journey.name}`);
      if (journey.actor) {
        lines.push(`  - Actor: ${journey.actor}`);
      }
      if (journey.trigger) {
        lines.push(`  - Trigger: ${journey.trigger}`);
      }
      if (journey.steps.length > 0) {
        lines.push('  - Steps:');
        journey.steps.forEach((step) => lines.push(`    - ${step}`));
      }
      if (journey.successCriteria.length > 0) {
        lines.push('  - Success criteria:');
        journey.successCriteria.forEach((criterion) => lines.push(`    - ${criterion}`));
      }
    });
  }
  if (sections.systemJourneySpecs.length > 0) {
    lines.push('', 'System journeys:');
    sections.systemJourneySpecs.forEach((journey, index) => {
      lines.push(`- Flow ${index + 1}: ${journey.name}`);
      if (journey.actor) {
        lines.push(`  - Actor: ${journey.actor}`);
      }
      if (journey.trigger) {
        lines.push(`  - Trigger: ${journey.trigger}`);
      }
      if (journey.steps.length > 0) {
        lines.push('  - Steps:');
        journey.steps.forEach((step) => lines.push(`    - ${step}`));
      }
      if (journey.successCriteria.length > 0) {
        lines.push('  - Success criteria:');
        journey.successCriteria.forEach((criterion) => lines.push(`    - ${criterion}`));
      }
    });
  }
  if (sections.acceptanceCriteria.length > 0) {
    lines.push('', 'Acceptance criteria:', ...sections.acceptanceCriteria.map((entry) => `- ${entry}`));
  }
  if (sections.guardrails.length > 0) {
    lines.push('', 'Guardrails:', ...sections.guardrails.map((entry) => `- ${entry}`));
  }
  if (sections.workingRules.length > 0) {
    lines.push('', 'Working rules:', ...sections.workingRules.map((entry) => `- ${entry}`));
  }
  if (sections.qualityGates.length > 0) {
    lines.push('', 'Quality gates:', ...sections.qualityGates.map((entry) => `- ${entry}`));
  }
  if (sections.definitionOfDone.length > 0) {
    lines.push('', 'Definition of done:', ...sections.definitionOfDone.map((entry) => `- ${entry}`));
  }

  return lines.join('\n').trim();
}

function buildTemporaryGoalTitle(description: string): string {
  const trimmed = description.trim();
  if (!trimmed) {
    return 'AI generated goal';
  }

  const words = trimmed.split(/\s+/).slice(0, 6);
  const summary = words.join(' ').trim();
  if (!summary) {
    return 'AI generated goal';
  }

  return `${summary}${trimmed.split(/\s+/).length > 6 ? '...' : ''}`;
}

function serializeFrontmatterString(value: string): string {
  return JSON.stringify(value);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String((error as { message?: unknown }).message ?? '');
  }
  return '';
}

async function ensureFolder(vaultId: string, name: string, parentPath?: string): Promise<void> {
  try {
    await invoke('create_vault_task_folder', {
      vaultId,
      parentPath,
      name,
    });
  } catch (error) {
    const message = toErrorMessage(error).toLowerCase();
    if (!message.includes('exist')) {
      throw error;
    }
  }
}

async function upsertMarkdownFile(
  vaultId: string,
  path: string,
  parentPath: string,
  fileName: string,
  content: string
): Promise<void> {
  try {
    await invoke('update_vault_task_file', {
      vaultId,
      path,
      content,
    });
    return;
  } catch (error) {
    const message = toErrorMessage(error).toLowerCase();
    const missingPath =
      message.includes('not found')
      || message.includes('item not found')
      || message.includes('no such file');

    if (!missingPath) {
      throw error;
    }
  }

  await invoke('create_vault_task_file', {
    vaultId,
    parentPath,
    name: fileName,
    content,
  });
}

function getDirectoryPath(path: string): string {
  const index = path.lastIndexOf('/');
  if (index <= 0) {
    return '';
  }
  return path.slice(0, index);
}

function normalizeVaultRelativePath(path: string): string | null {
  const segments = path.split('/');
  const normalized: string[] = [];

  for (const segment of segments) {
    if (!segment || segment === '.') {
      continue;
    }
    if (segment === '..') {
      if (normalized.length === 0) {
        return null;
      }
      normalized.pop();
      continue;
    }
    normalized.push(segment);
  }

  return normalized.join('/');
}

function isExternalLink(href: string): boolean {
  if (href.startsWith('//')) {
    return true;
  }
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href);
}

function extractMarkdownLinks(content: string): ParsedMarkdownLink[] {
  const links: ParsedMarkdownLink[] = [];
  const lines = content.split('\n');
  const linkPattern = /\[[^\]]+\]\(([^)]+)\)/g;
  let insideCodeFence = false;

  lines.forEach((line, index) => {
    if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) {
      insideCodeFence = !insideCodeFence;
      return;
    }

    if (insideCodeFence) {
      return;
    }

    let match = linkPattern.exec(line);
    while (match) {
      const openingBracketIndex = match.index;
      const isImageLink = openingBracketIndex > 0 && line[openingBracketIndex - 1] === '!';
      if (!isImageLink) {
        const rawHref = match[1].trim();
        const strippedHref = rawHref.startsWith('<') && rawHref.endsWith('>')
          ? rawHref.slice(1, -1)
          : rawHref;
        const href = strippedHref.split(/\s+/, 1)[0]?.trim() ?? '';
        if (href) {
          links.push({
            href,
            line: index + 1,
          });
        }
      }
      match = linkPattern.exec(line);
    }
    linkPattern.lastIndex = 0;
  });

  return links;
}

function slugifyHeadingAnchor(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[`~!@#$%^&*()+={}[\]|\\:;"'<>,.?/]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function normalizeAnchor(anchor: string): string {
  try {
    return slugifyHeadingAnchor(decodeURIComponent(anchor));
  } catch {
    return slugifyHeadingAnchor(anchor);
  }
}

function collectMarkdownAnchors(content: string): Set<string> {
  const anchors = new Set<string>();
  const seen = new Map<string, number>();
  const lines = content.split('\n');
  let insideCodeFence = false;

  for (const line of lines) {
    if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) {
      insideCodeFence = !insideCodeFence;
      continue;
    }
    if (insideCodeFence) {
      continue;
    }

    const headingMatch = line.match(/^\s{0,3}#{1,6}\s+(.+?)\s*$/);
    if (!headingMatch) {
      continue;
    }

    const rawHeading = headingMatch[1].replace(/\s+#+\s*$/, '').trim();
    if (!rawHeading) {
      continue;
    }

    const baseAnchor = slugifyHeadingAnchor(rawHeading);
    if (!baseAnchor) {
      continue;
    }

    const seenCount = seen.get(baseAnchor) ?? 0;
    const resolvedAnchor = seenCount === 0 ? baseAnchor : `${baseAnchor}-${seenCount}`;
    seen.set(baseAnchor, seenCount + 1);
    anchors.add(resolvedAnchor);
  }

  return anchors;
}

function collectMarkdownPaths(entries: VaultTaskEntry[]): Set<string> {
  const paths = new Set<string>();

  const visit = (entry: VaultTaskEntry): void => {
    if (entry.kind === 'file') {
      const extension = entry.extension?.toLowerCase();
      const isMarkdownExtension = extension === 'md' || extension === 'markdown' || extension === 'mdx';
      const isMarkdownPath = entry.path.toLowerCase().endsWith('.md')
        || entry.path.toLowerCase().endsWith('.markdown')
        || entry.path.toLowerCase().endsWith('.mdx');
      if (isMarkdownExtension || isMarkdownPath) {
        paths.add(entry.path);
      }
      return;
    }

    if (Array.isArray(entry.children)) {
      entry.children.forEach(visit);
    }
  };

  entries.forEach(visit);
  return paths;
}

function resolveMarkdownLinkPath(
  sourcePath: string,
  href: string
): { targetPath: string; anchor?: string } {
  const [hrefBeforeAnchor, rawAnchor] = href.split('#', 2);
  const [hrefPath] = hrefBeforeAnchor.split('?', 1);
  const baseDirectory = getDirectoryPath(sourcePath);
  const normalizedTargetPath = (() => {
    if (!hrefPath) {
      return sourcePath;
    }
    if (hrefPath.startsWith('/')) {
      return normalizeVaultRelativePath(hrefPath.slice(1));
    }
    const combined = baseDirectory ? `${baseDirectory}/${hrefPath}` : hrefPath;
    return normalizeVaultRelativePath(combined);
  })();

  if (!normalizedTargetPath) {
    throw new Error(`Link "${href}" in "${sourcePath}" resolves outside the vault root`);
  }

  const normalizedAnchor = rawAnchor ? normalizeAnchor(rawAnchor) : undefined;

  return {
    targetPath: normalizedTargetPath,
    ...(normalizedAnchor ? { anchor: normalizedAnchor } : {}),
  };
}

async function validateGeneratedMarkdownLinks(
  vaultId: string,
  documents: PlannedMarkdownDocument[]
): Promise<void> {
  const rawExistingEntries = await invoke<unknown>('list_vault_tasks', { vaultId });
  const existingEntries = Array.isArray(rawExistingEntries)
    ? (rawExistingEntries as VaultTaskEntry[])
    : [];

  const existingMarkdownPaths = collectMarkdownPaths(existingEntries);
  const anchorsByPath = new Map<string, Set<string>>();

  documents.forEach((document) => {
    existingMarkdownPaths.add(document.path);
    anchorsByPath.set(document.path, collectMarkdownAnchors(document.content));
  });

  const existingAnchorCache = new Map<string, Set<string>>();

  const getAnchorsForPath = async (path: string): Promise<Set<string>> => {
    const generated = anchorsByPath.get(path);
    if (generated) {
      return generated;
    }

    const cached = existingAnchorCache.get(path);
    if (cached) {
      return cached;
    }

    const content = await invoke<string>('read_vault_task_file', {
      vaultId,
      path,
    });
    const anchors = collectMarkdownAnchors(content);
    existingAnchorCache.set(path, anchors);
    return anchors;
  };

  for (const document of documents) {
    const links = extractMarkdownLinks(document.content);
    for (const link of links) {
      if (isExternalLink(link.href)) {
        continue;
      }

      const { targetPath, anchor } = resolveMarkdownLinkPath(document.path, link.href);
      if (!existingMarkdownPaths.has(targetPath)) {
        throw new Error(
          `Broken markdown link in "${document.path}:${link.line}": "${link.href}" references missing file "${targetPath}".`
        );
      }

      if (!anchor) {
        continue;
      }

      const anchors = await getAnchorsForPath(targetPath);
      if (!anchors.has(anchor)) {
        throw new Error(
          `Broken markdown anchor in "${document.path}:${link.line}": "${link.href}" references missing anchor "#${anchor}" in "${targetPath}".`
        );
      }
    }
  }
}

function buildGoalDocContent({
  goal,
  assigneeLabel,
  reviewerLabel,
  description,
  goalOverview,
  deadline,
  priority,
  schema,
  flows,
  sections,
  goalDocPath,
  milestoneLinks,
}: {
  goal: Goal;
  assigneeLabel: string;
  reviewerLabel: string;
  description: string;
  goalOverview?: string;
  deadline: string;
  priority: string;
  schema: string;
  flows: string;
  sections: GoalSpecSections;
  goalDocPath: string;
  milestoneLinks: Array<{ title: string; relativePath: string }>;
}): string {
  const normalizedGoalOverview = goalOverview?.trim();
  const inScopeLines = sections.scopeIn.length > 0
    ? sections.scopeIn.map((entry) => `- ${entry}`)
    : ['- Define concrete in-scope deliverables for this goal.'];
  const outOfScopeLines = sections.scopeOut.length > 0
    ? sections.scopeOut.map((entry) => `- ${entry}`)
    : ['- Avoid unrelated refactors or architecture changes.'];
  const userJourneyLines = renderJourneySpecs(
    sections.userJourneySpecs,
    '- Add at least one structured user journey if this goal affects end users.'
  );
  const systemJourneyLines = renderJourneySpecs(
    sections.systemJourneySpecs,
    '- Add structured system journeys for agent-to-agent workflows and automations.'
  );
  const milestoneLines = milestoneLinks.length > 0
    ? milestoneLinks.map((link) => `- [ ] [${link.title}](${link.relativePath})`)
    : ['- [ ] Add milestones to break down this goal into shippable outcomes.'];
  const acceptanceLines = sections.acceptanceCriteria.length > 0
    ? sections.acceptanceCriteria.map((entry) => `- [ ] ${entry}`)
    : ['- [ ] Goal outcomes are represented by milestone specs.'];
  const guardrailLines = sections.guardrails.length > 0
    ? sections.guardrails.map((entry) => `- ${entry}`)
    : ['- Keep changes scoped to this goal and linked milestone files.'];
  const workingRuleLines = sections.workingRules.length > 0
    ? sections.workingRules.map((entry) => `- ${entry}`)
    : [
      '- Keep changes explicit, testable, and scoped to this goal.',
      '- If scope changes, update this spec before implementation.',
    ];
  const qualityGateLines = sections.qualityGates.length > 0
    ? sections.qualityGates.map((entry) => `- [ ] ${entry}`)
    : ['- [ ] pnpm lint', '- [ ] pnpm typecheck', '- [ ] pnpm test', '- [ ] cargo check'];
  const definitionOfDoneLines = sections.definitionOfDone.length > 0
    ? sections.definitionOfDone.map((entry) => `- [ ] ${entry}`)
    : [
      '- [ ] All milestones complete.',
      '- [ ] Acceptance criteria satisfied.',
      '- [ ] Validation commands pass.',
    ];
  const schemaLines = schema
    ? ['```yaml', ...schema.split('\n'), '```']
    : ['No schema provided yet.'];
  const flowLines = flows
    ? ['```mermaid', ...flows.split('\n'), '```']
    : ['No flow provided yet.'];

  return [
    '---',
    `id: ${serializeFrontmatterString(goal.id)}`,
    `title: ${serializeFrontmatterString(goal.title)}`,
    `assignee: ${serializeFrontmatterString(assigneeLabel)}`,
    `reviewer: ${serializeFrontmatterString(reviewerLabel)}`,
    `objective: ${serializeFrontmatterString(description || '')}`,
    'document_type: "agent_goal_spec"',
    `spec_kit_profile: ${serializeFrontmatterString(SPEC_KIT_PROFILE)}`,
    'spec_kit_artifact: "goal"',
    `deadline: ${serializeFrontmatterString(deadline || '')}`,
    `priority: ${serializeFrontmatterString(priority || 'medium')}`,
    'status: "active"',
    'template_version: "1.0.0"',
    `created_at: ${serializeFrontmatterString(new Date().toISOString())}`,
    '---',
    '',
    `# ${(goal.title || 'Goal').trim() || 'Goal'} Specification`,
    '',
    '## Outcome',
    '',
    '### Business Outcome',
    normalizedGoalOverview || description || 'No business outcome provided.',
    '',
    '## Objective',
    description || 'No objective provided.',
    '',
    '## Scope',
    '',
    '### In Scope',
    ...inScopeLines,
    '',
    '### Out of Scope',
    ...outOfScopeLines,
    '',
    '## User Journeys',
    ...userJourneyLines,
    '',
    '## System Journeys',
    ...systemJourneyLines,
    '',
    '## Milestones',
    ...milestoneLines,
    '',
    '## Acceptance Criteria',
    ...acceptanceLines,
    '',
    '## Guardrails',
    ...guardrailLines,
    '',
    '## Data Contracts',
    '',
    '### Schema',
    ...schemaLines,
    '',
    '## Flows',
    ...flowLines,
    '',
    '## Agent Execution Plan',
    '',
    '### Required Artifacts',
    `- [ ] Goal spec: [${goal.title}](${goalDocPath})`,
    '- [ ] Milestone specs under the goal folder',
    '- [ ] Optional task specs linked from each milestone spec',
    '',
    '### Working Rules',
    ...workingRuleLines,
    '',
    '## Quality Gates',
    ...qualityGateLines,
    '',
    '## Definition of Done',
    ...definitionOfDoneLines,
    '',
  ].join('\n');
}

function buildMilestoneDocContent({
  goal,
  goalDocPath,
  milestoneTitle,
  description,
  milestoneBrief,
  taskLinks,
  deadline,
  priority,
  schema,
  flows,
  sections,
}: {
  goal: Goal;
  goalDocPath: string;
  milestoneTitle: string;
  description: string;
  milestoneBrief?: string;
  taskLinks: Array<{ title: string; relativePath: string }>;
  deadline: string;
  priority: string;
  schema: string;
  flows: string;
  sections: GoalSpecSections;
}): string {
  const schemaLines = schema
    ? ['```yaml', ...schema.split('\n'), '```']
    : ['No schema provided yet.'];
  const flowLines = flows
    ? ['```mermaid', ...flows.split('\n'), '```']
    : ['No flow provided yet.'];
  const normalizedMilestoneBrief = milestoneBrief?.trim();
  const taskLines = taskLinks.length > 0
    ? taskLinks.map((link) => `- [ ] [${link.title}](${link.relativePath})`)
    : ['- [ ] Add task documents for milestone execution steps.'];
  const acceptanceLines = sections.acceptanceCriteria.length > 0
    ? sections.acceptanceCriteria.map((entry) => `- [ ] ${entry}`)
    : ['- [ ] Milestone behavior is implemented and verifiable.'];
  const guardrailLines = sections.guardrails.length > 0
    ? sections.guardrails.map((entry) => `- ${entry}`)
    : ['- Keep the implementation small and explicit.'];

  return [
    '---',
    `goal_id: ${serializeFrontmatterString(goal.id)}`,
    `goal_title: ${serializeFrontmatterString(goal.title)}`,
    `milestone_title: ${serializeFrontmatterString(milestoneTitle)}`,
    'document_type: "agent_now_spec"',
    `spec_kit_profile: ${serializeFrontmatterString(SPEC_KIT_PROFILE)}`,
    'spec_kit_artifact: "milestone"',
    `deadline: ${serializeFrontmatterString(deadline || '')}`,
    `priority: ${serializeFrontmatterString(priority || 'medium')}`,
    `created_at: ${serializeFrontmatterString(new Date().toISOString())}`,
    'status: "backlog"',
    'template_version: "1.0.0"',
    '---',
    '',
    `# ${(milestoneTitle || 'Milestone').trim() || 'Milestone'} Specification`,
    '',
    '## Objective',
    `Deliver "${milestoneTitle}" end-to-end for goal "${goal.title}".`,
    '',
    '## Inputs',
    `- Parent goal spec: [${goal.title}](../${goalDocPath})`,
    `- Goal objective: ${description || 'No objective provided.'}`,
    normalizedMilestoneBrief
      ? `- AI milestone notes: ${normalizedMilestoneBrief}`
      : '- AI milestone notes: none',
    '',
    '## Step-by-Step Plan',
    ...taskLines,
    '',
    '## Files To Change',
    '- Add or update only files required by this milestone.',
    '- Link any new task docs from the plan above.',
    '',
    '## Risks / Blockers',
    '- Identify dependencies and blockers before implementation.',
    '- Escalate scope changes by updating the GOALS spec first.',
    '',
    '## Acceptance Criteria',
    ...acceptanceLines,
    '',
    '## Guardrails',
    ...guardrailLines,
    '',
    '## Validation Commands',
    '- [ ] pnpm lint',
    '- [ ] pnpm typecheck',
    '- [ ] pnpm test',
    '- [ ] cargo check',
    '',
    '## Data Contracts',
    '',
    '### Schema',
    ...schemaLines,
    '',
    '## Flows',
    ...flowLines,
    '',
    '## Done Checklist',
    '- [ ] Plan executed.',
    '- [ ] Acceptance criteria satisfied.',
    '- [ ] Validation commands pass.',
    '',
  ].join('\n');
}

function buildTaskDocContent({
  goal,
  goalDocPath,
  milestoneDocPath,
  milestoneTitle,
  milestoneBrief,
  taskTitle,
  taskBrief,
  description,
  deadline,
  priority,
  sections,
}: {
  goal: Goal;
  goalDocPath: string;
  milestoneDocPath: string;
  milestoneTitle: string;
  milestoneBrief?: string;
  taskTitle: string;
  taskBrief?: string;
  description: string;
  deadline: string;
  priority: string;
  sections: GoalSpecSections;
}): string {
  const normalizedTaskBrief = taskBrief?.trim();
  const normalizedMilestoneBrief = milestoneBrief?.trim();
  const acceptanceLines = [
    `- [ ] "${taskTitle}" is implemented exactly as scoped in this task spec.`,
    '- [ ] Automated validation proves the task behavior works as expected.',
    ...(sections.acceptanceCriteria.length > 0
      ? sections.acceptanceCriteria.map((entry) => `- [ ] Goal alignment: ${entry}`)
      : []),
  ];
  const guardrailLines = sections.guardrails.length > 0
    ? [
      ...sections.guardrails.map((entry) => `- ${entry}`),
      '- Do not mark this task done without evidence in the verification section.',
    ]
    : [
      '- Follow repository conventions and architecture boundaries.',
      '- Do not mark this task done without evidence in the verification section.',
    ];
  const executionChecklistLines = normalizedTaskBrief
    ? [
      `- [ ] Implement: ${normalizedTaskBrief}`,
      `- [ ] Keep implementation scoped to "${taskTitle}" within milestone "${milestoneTitle}".`,
      '- [ ] Add/update automated checks that fail before and pass after the change.',
      '- [ ] Record changed files and rationale in milestone notes before closing the task.',
    ]
    : [
      `- [ ] Identify exact files/modules required for "${taskTitle}".`,
      `- [ ] Implement "${taskTitle}" end-to-end for milestone "${milestoneTitle}".`,
      '- [ ] Add/update automated checks that fail before and pass after the change.',
      '- [ ] Record changed files and rationale in milestone notes before closing the task.',
    ];
  const deliverableLines = normalizedTaskBrief
    ? [
      `- Task implementation output matching: ${normalizedTaskBrief}`,
      `- Updated verification assets (tests/checks) proving "${taskTitle}".`,
      '- Updated milestone notes with evidence and linked artifacts.',
    ]
    : [
      `- Implemented output for "${taskTitle}" within the milestone scope.`,
      `- Verification artifacts proving "${taskTitle}" behavior.`,
      '- Updated milestone notes with evidence and linked artifacts.',
    ];
  const exampleLines = normalizedTaskBrief
    ? [
      `- Specific: "${normalizedTaskBrief}"`,
      '- Specific: references exact behavior, files/modules, and verification evidence.',
    ]
    : [
      `- Specific: "Implement ${taskTitle} in <module/file>, add focused tests, and capture validation output."`,
    ];
  const counterExampleLines = [
    '- Vague: "Implement this task" with no concrete behavior or verification plan.',
    '- Vague: generic status updates with no referenced files/tests/evidence.',
    '- Changes include unrelated refactors outside this task scope.',
  ];
  const verificationLines = [
    '- [ ] Validation command output is captured for this task.',
    '- [ ] Added/updated tests map directly to task behavior.',
    '- [ ] Evidence links or notes are recorded in the milestone spec.',
  ];
  const alignmentLines = [
    `- Parent goal spec: [${goal.title}](../../../goals/${goalDocPath})`,
    `- Parent milestone spec: [${milestoneTitle}](../../../${milestoneDocPath})`,
    normalizedMilestoneBrief
      ? `- Milestone focus: ${normalizedMilestoneBrief}`
      : '- Milestone focus: Define focused milestone outcomes before implementation.',
  ];
  const scopeInLines = [
    normalizedTaskBrief
      ? `- ${normalizedTaskBrief}`
      : `- Complete "${taskTitle}" for milestone "${milestoneTitle}".`,
    '- Keep changes focused, explicit, and testable.',
  ];
  const scopeOutLines = [
    '- Do not refactor unrelated files.',
    '- Do not expand beyond this task without updating the milestone brief.',
    '- Do not close the task on implementation alone without verification evidence.',
  ];

  return [
    '---',
    `goal_id: ${serializeFrontmatterString(goal.id)}`,
    `goal_title: ${serializeFrontmatterString(goal.title)}`,
    `milestone_title: ${serializeFrontmatterString(milestoneTitle)}`,
    `task_title: ${serializeFrontmatterString(taskTitle)}`,
    'document_type: "agent_task_spec"',
    `spec_kit_profile: ${serializeFrontmatterString(SPEC_KIT_PROFILE)}`,
    'spec_kit_artifact: "task"',
    `deadline: ${serializeFrontmatterString(deadline || '')}`,
    `priority: ${serializeFrontmatterString(priority || 'medium')}`,
    `created_at: ${serializeFrontmatterString(new Date().toISOString())}`,
    'status: "backlog"',
    'template_version: "1.0.0"',
    '---',
    '',
    `# ${(taskTitle || 'Task').trim() || 'Task'} Specification`,
    '',
    '## Task',
    taskTitle,
    '',
    '## Objective',
    normalizedTaskBrief || `Complete "${taskTitle}" for milestone "${milestoneTitle}".`,
    '',
    '## Context',
    `- Goal objective: ${description || 'No objective provided.'}`,
    ...alignmentLines,
    '',
    '## Scope In',
    ...scopeInLines,
    '',
    '## Scope Out',
    ...scopeOutLines,
    '',
    '## Specific Execution Checklist',
    ...executionChecklistLines,
    '',
    '## Deliverables',
    ...deliverableLines,
    '',
    '## Acceptance Criteria',
    ...acceptanceLines,
    '',
    '## Guardrails',
    ...guardrailLines,
    '',
    '## Relevant Examples',
    ...exampleLines,
    '',
    '## Counter Examples',
    ...counterExampleLines,
    '',
    '## Validation Commands',
    '- [ ] pnpm lint',
    '- [ ] pnpm typecheck',
    '- [ ] pnpm test',
    '- [ ] cargo check',
    '',
    '## Verification Evidence',
    ...verificationLines,
    '',
    '## Data Contracts',
    `- Canonical schema: [${goal.title}](../../../goals/${goalDocPath}#data-contracts)`,
    `- Canonical flows: [${goal.title}](../../../goals/${goalDocPath}#flows)`,
    '- Add task-specific contract or flow deltas only when required.',
    '',
  ].join('\n');
}

async function syncGoalAgentDocuments(
  vaultId: string,
  goal: Goal,
  input: {
    assigneeLabel: string;
    reviewerLabel: string;
    description: string;
    goalOverview?: string;
    milestoneBriefs?: string[];
    milestoneTasks?: string[][];
    taskBriefs?: string[][];
    deadline: string;
    priority: string;
    schema?: string;
    flows?: string;
    sections: GoalSpecSections;
    milestones: string[];
  }
): Promise<void> {
  const goalDocName = normalizeGoalDocSegment(goal.title, 'Goal') || 'Goal';
  const goalFileName = `${goalDocName}.md`;
  const goalFilePath = `goals/${goalFileName}`;
  const milestoneDocsFolder = `goals/${goalDocName}`;
  const goalTasksFolder = `tasks/${goalDocName}`;
  const schema = normalizeStructuredSpecBlock(input.schema);
  const flows = normalizeStructuredSpecBlock(input.flows);
  const sections = input.sections;

  await ensureFolder(vaultId, 'goals');
  await ensureFolder(vaultId, goalDocName, 'goals');
  await ensureFolder(vaultId, 'tasks');
  await ensureFolder(vaultId, goalDocName, 'tasks');

  const usedMilestoneNames = new Set<string>();
  const milestoneEntries = input.milestones.map((milestoneTitle) => {
    const base = normalizeGoalDocSegment(milestoneTitle, 'Milestone') || 'Milestone';
    let candidate = base;
    let suffix = 2;
    while (usedMilestoneNames.has(candidate)) {
      candidate = `${base}${suffix}`;
      suffix += 1;
    }
    usedMilestoneNames.add(candidate);
    return {
      title: milestoneTitle,
      fileName: `${candidate}.md`,
      folderName: candidate,
      folderPath: `${goalTasksFolder}/${candidate}`,
      relativePath: `./${goalDocName}/${candidate}.md`,
      path: `${milestoneDocsFolder}/${candidate}.md`,
    };
  });

  const goalDocContent = buildGoalDocContent({
    goal,
    assigneeLabel: input.assigneeLabel,
    reviewerLabel: input.reviewerLabel,
    description: input.description.trim(),
    goalOverview: input.goalOverview,
    deadline: input.deadline,
    priority: input.priority,
    schema,
    flows,
    sections,
    goalDocPath: goalFileName,
    milestoneLinks: milestoneEntries.map((entry) => ({
      title: entry.title,
      relativePath: entry.relativePath,
    })),
  });
  const goalDocument: PlannedMarkdownDocument = {
    path: goalFilePath,
    parentPath: 'goals',
    fileName: goalFileName,
    content: goalDocContent,
  };

  const milestonePlans = milestoneEntries.map((entry, index) => {
    const taskTitles = sanitizeMilestones(input.milestoneTasks?.[index]);
    const taskBriefsForMilestone = input.taskBriefs?.[index] ?? [];
    const usedTaskNames = new Set<string>();
    const taskEntries = taskTitles.map((taskTitle, taskIndex) => {
      const base = normalizeGoalDocSegment(taskTitle, 'Task') || 'Task';
      let candidate = base;
      let suffix = 2;
      while (usedTaskNames.has(candidate)) {
        candidate = `${base}${suffix}`;
        suffix += 1;
      }
      usedTaskNames.add(candidate);
      return {
        title: taskTitle,
        brief: taskBriefsForMilestone[taskIndex],
        fileName: `${candidate}.md`,
        relativePath: `../../tasks/${goalDocName}/${entry.folderName}/${candidate}.md`,
        path: `${entry.folderPath}/${candidate}.md`,
      };
    });

    const milestoneContent = buildMilestoneDocContent({
      goal,
      goalDocPath: goalFileName,
      milestoneTitle: entry.title,
      description: input.description.trim(),
      milestoneBrief: input.milestoneBriefs?.[index],
      taskLinks: taskEntries.map((taskEntry) => ({
        title: taskEntry.title,
        relativePath: taskEntry.relativePath,
      })),
      deadline: input.deadline,
      priority: input.priority,
      schema,
      flows,
      sections,
    });
    const milestoneDocument: PlannedMarkdownDocument = {
      path: entry.path,
      parentPath: milestoneDocsFolder,
      fileName: entry.fileName,
      content: milestoneContent,
    };

    const taskDocuments: PlannedMarkdownDocument[] = taskEntries.map((taskEntry) => ({
      path: taskEntry.path,
      parentPath: entry.folderPath,
      fileName: taskEntry.fileName,
      content: buildTaskDocContent({
        goal,
        goalDocPath: goalFileName,
        milestoneDocPath: `goals/${goalDocName}/${entry.fileName}`,
        milestoneTitle: entry.title,
        milestoneBrief: input.milestoneBriefs?.[index],
        taskTitle: taskEntry.title,
        taskBrief: taskEntry.brief,
        description: input.description.trim(),
        deadline: input.deadline,
        priority: input.priority,
        sections,
      }),
    }));

    return {
      entry,
      milestoneDocument,
      taskDocuments,
    };
  });

  const generatedDocuments: PlannedMarkdownDocument[] = [
    goalDocument,
    ...milestonePlans.flatMap((plan) => [plan.milestoneDocument, ...plan.taskDocuments]),
  ];

  await validateGeneratedMarkdownLinks(vaultId, generatedDocuments);

  await upsertMarkdownFile(
    vaultId,
    goalDocument.path,
    goalDocument.parentPath,
    goalDocument.fileName,
    goalDocument.content
  );

  await Promise.all(
    milestonePlans.map(async (plan) => {
      const { entry, milestoneDocument, taskDocuments } = plan;
      await upsertMarkdownFile(
        vaultId,
        milestoneDocument.path,
        milestoneDocument.parentPath,
        milestoneDocument.fileName,
        milestoneDocument.content
      );

      if (taskDocuments.length === 0) {
        return;
      }

      await ensureFolder(vaultId, entry.folderName, goalTasksFolder);

      await Promise.all(
        taskDocuments.map((taskDocument) =>
          upsertMarkdownFile(
            vaultId,
            taskDocument.path,
            taskDocument.parentPath,
            taskDocument.fileName,
            taskDocument.content
          )
        )
      );
    })
  );
}

async function createGoalMilestones(
  vaultId: string,
  goalId: string,
  milestones: string[]
): Promise<string[]> {
  if (milestones.length === 0) {
    return [];
  }

  await Promise.all(
    milestones.map((milestone) =>
      invoke('create_goal_task', {
        vaultId,
        goalId,
        data: {
          title: milestone,
        },
      })
    )
  );

  return milestones;
}

async function emitLibraryUpdated(vaultId: string): Promise<void> {
  try {
    await emit('vault-library-updated', { vaultId });
  } catch (error) {
    console.error('Failed to emit library refresh event after goal file generation:', error);
  }
}

export async function createGoalWithAssignee(
  vaultId: string,
  input: CreateGoalWithAssigneeInput
): Promise<Goal> {
  const requestedTitle = input.title.trim();
  const description = input.description.trim();
  let sections = buildGoalSpecSections({
    scopeIn: input.scopeIn,
    scopeOut: input.scopeOut,
    userJourneys: input.userJourneys,
    systemJourneys: input.systemJourneys,
    userJourneySpecs: input.userJourneySpecs,
    systemJourneySpecs: input.systemJourneySpecs,
    acceptanceCriteria: input.acceptanceCriteria,
    guardrails: input.guardrails,
  });
  const assigneeLabel = describeAssignee(input.assignee);
  const reviewerLabel = describeAssignee(input.reviewer ?? input.assignee ?? HUMAN_GOAL_ASSIGNEE);
  const deadline = input.deadline;
  const priority = input.priority;

  const baseCreateData = {
    description,
    deadline,
    priority,
    ...(input.measurable ? { measurable: input.measurable } : {}),
    ...(typeof input.confidence === 'number' ? { achievable: input.confidence } : {}),
    ...(input.why !== undefined ? { relevant: input.why } : {}),
    ...(input.tags !== undefined ? { tags: input.tags } : {}),
    ...(input.notes !== undefined ? { notes: input.notes } : {}),
    ...(typeof input.publishMilestonesOnComplete === 'boolean'
      ? { publishMilestonesOnComplete: input.publishMilestonesOnComplete }
      : {}),
  };

  if (!isAiGoalAssignee(input.assignee)) {
    const created = await invoke<Goal>('create_goal', {
      vaultId,
      data: {
        ...baseCreateData,
        title: input.title.trim(),
      },
    });

    let milestoneTitles: string[] = [];
    if (created?.id) {
      const milestones = sanitizeMilestones(input.milestones);
      milestoneTitles = await createGoalMilestones(vaultId, created.id, milestones);
      try {
        await syncGoalAgentDocuments(vaultId, created, {
          assigneeLabel,
          reviewerLabel,
          description,
          deadline,
          priority,
          schema: input.schema,
          flows: input.flows,
          sections,
          milestones: milestoneTitles,
        });
      } catch (error) {
        console.error('Failed to create agent goal markdown files:', error);
      }
    }

    await emitLibraryUpdated(vaultId);

    return created;
  }

  const temporaryTitle = requestedTitle || buildTemporaryGoalTitle(description);
  const created = await invoke<Goal>('create_goal', {
    vaultId,
    data: {
      ...baseCreateData,
      title: temporaryTitle,
    },
  });

  if (!created?.id) {
    throw new Error('Failed to create temporary AI goal');
  }

  let finalGoal: Goal = created;
  let milestoneTitles: string[] = [];
  let aiSchema: string | undefined;
  let aiFlows: string | undefined;
  let aiGoalOverview: string | undefined;
  let aiMilestoneBriefs: string[] | undefined;
  let aiMilestoneTasks: string[][] | undefined;
  let aiTaskBriefs: string[][] | undefined;

  try {
    const plan = await generateAiGoalPlan({
      vaultId,
      title: requestedTitle,
      goalBrief: buildAiPlanningBrief(description, sections),
      deadline,
      priority,
      modelId: input.assignee.modelId,
    });
    const resolvedTitle = requestedTitle || plan.title;

    await invoke('update_goal', {
      vaultId,
      goalId: created.id,
      data: {
        title: resolvedTitle,
        description,
        deadline,
        priority,
      },
    });

    milestoneTitles = await createGoalMilestones(
      vaultId,
      created.id,
      sanitizeMilestones(plan.milestones)
    );
    sections = mergeGoalSpecSections(
      sections,
      buildGoalSpecSections({
        scopeIn: plan.scopeIn?.join('\n'),
        scopeOut: plan.scopeOut?.join('\n'),
        userJourneySpecs: plan.userJourneySpecs?.map((journey) => ({
          name: journey.name,
          actor: journey.actor ?? '',
          trigger: journey.trigger ?? '',
          steps: journey.steps?.join('\n') ?? '',
          successCriteria: journey.successCriteria?.join('\n') ?? '',
        })),
        systemJourneySpecs: plan.systemJourneySpecs?.map((journey) => ({
          name: journey.name,
          actor: journey.actor ?? '',
          trigger: journey.trigger ?? '',
          steps: journey.steps?.join('\n') ?? '',
          successCriteria: journey.successCriteria?.join('\n') ?? '',
        })),
        acceptanceCriteria: plan.acceptanceCriteria?.join('\n'),
        guardrails: plan.guardrails?.join('\n'),
        workingRules: plan.workingRules?.join('\n'),
        qualityGates: plan.qualityGates?.join('\n'),
        definitionOfDone: plan.definitionOfDone?.join('\n'),
      })
    );
    aiSchema = plan.schema;
    aiFlows = plan.flows;
    aiGoalOverview = plan.goalOverview || plan.summary;
    aiMilestoneBriefs = plan.milestoneBriefs;
    aiMilestoneTasks = plan.milestoneTasks;
    aiTaskBriefs = plan.taskBriefs;

    finalGoal = {
      ...created,
      title: resolvedTitle,
      description,
    };
  } catch (error) {
    try {
      await invoke('delete_goal', { vaultId, goalId: created.id });
    } catch (deleteError) {
      console.error('Failed to roll back AI goal creation:', deleteError);
    }
    throw error;
  }

  try {
    await syncGoalAgentDocuments(vaultId, finalGoal, {
      assigneeLabel,
      reviewerLabel,
      description,
      goalOverview: aiGoalOverview,
      milestoneBriefs: aiMilestoneBriefs,
      milestoneTasks: aiMilestoneTasks,
      taskBriefs: aiTaskBriefs,
      deadline,
      priority,
      schema: aiSchema || input.schema,
      flows: aiFlows || input.flows,
      sections,
      milestones: milestoneTitles,
    });
  } catch (error) {
    console.error('Failed to create agent goal markdown files:', error);
  }

  await emitLibraryUpdated(vaultId);

  return finalGoal;
}
