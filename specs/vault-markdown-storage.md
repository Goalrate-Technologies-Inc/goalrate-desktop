# Vault Markdown Storage

## Problem

GoalRate needs durable local storage that the desktop app can trust while still allowing the user to inspect and edit their data outside GoalRate. The product notes originally described an encrypted folder, but the selected v1 posture prioritizes markdown interoperability over full-vault encryption.

## Goals

- Store user-authored product data as readable markdown files.
- Support editing by GoalRate, Obsidian, Notion, or another markdown-based tool.
- Keep internal indexes, caches, secrets, and provider credentials out of portable markdown files.
- Make vault creation, opening, updating, and deletion behavior predictable.
- Preserve user data when the app encounters unknown frontmatter fields or externally edited markdown.

## Non-Goals

- Do not encrypt the full vault in v1.
- Do not store API keys, OAuth tokens, or other secrets in markdown files.
- Do not require Obsidian- or Notion-specific metadata.
- Do not implement cloud sync or team permissions in this spec.
- Do not delete vault files from disk unless the user explicitly chooses a destructive file deletion action.

## User Experience

The user thinks of a vault as a local folder containing their goals, memory, and planning data. They can open that folder in GoalRate or inspect the markdown with another editor.

When the user creates a vault, GoalRate creates a predictable folder structure. When the user opens an existing vault, GoalRate validates the minimal config and then reads markdown files into Roadmap, Agenda, Assistant, and Memory surfaces.

If another app edits the markdown, GoalRate should pick up the changes after refresh or file-watch events. If a file cannot be parsed, GoalRate should explain which file is affected and avoid overwriting unknown content.

Vault recovery belongs in Settings. The user should be able to review recent parse or validation issues from `logs/errors.md`, review restorable markdown snapshots for the current vault, restore a selected snapshot, see a clear success/no-op/error result, and have the workspace refresh after a successful restore.

## Requirements

### Vault Structure

Target v1 vault structure:

```text
<vault>/
  .vault.json
  memory.md
  eisenhower-matrix.md
  domains/
    <domain-slug>.md (optional/reserved)
  goals/
    <goal-slug-or-id>.md
  tasks/
    (reserved compatibility folder; v1 Tasks remain embedded in Goal markdown)
  agenda/
    <yyyy-mm-dd>.md
  logs/
    errors.md
  system/
    mutations.md
    snapshots/
  .goalrate/
    .gitignore
    index.db
    daily-loop.db
    cache/
```

Required files and folders:

- `.vault.json`: vault identity and app-level configuration.
- `goals/`: goal markdown files.
- `tasks/`: reserved compatibility folder for the desktop MVP vault shape. Tasks remain embedded in Goal markdown in v1.
- `domains/`: reserved folder for optional/future Domain metadata files.
- `agenda/`: source-of-truth daily Agenda markdown files.
- `logs/errors.md`: user-readable append-only parse/validation/write error log.
- `system/mutations.md`: user-readable append-only mutation log for app and Assistant writes.
- `system/snapshots/`: pre-write markdown snapshots used for recovery and undo support.
- `memory.md`: persistent user memory for AI planning.
- `eisenhower-matrix.md`: prioritization definitions and any user-specific prioritization notes.
- `.goalrate/`: app-managed indexes, caches, and non-portable state.

GoalRate must create all required markdown files/folders eagerly when creating a vault. Some of them may start as empty/default templates, but they should exist immediately so the vault is understandable outside GoalRate.

Optional files and folders:

- Additional app-specific markdown files created by future features.

Desktop MVP vault-core must not create, read, write, delete, watch, or type-classify a standalone `projects/` directory. Existing user-created `projects/` folders should be left untouched and treated as unknown markdown content unless a future spec reintroduces project management.

### Markdown-First Privacy Model

- User-authored product data should remain readable markdown.
- Full-vault encryption is not promised in v1 because it conflicts with direct markdown interoperability.
- Secrets must be stored in OS-provided secure storage, environment variables, or app-managed secure stores, not in vault markdown.
- `.goalrate/` data may be SQLite, JSON, or another app-managed format because it is an implementation detail.
- The app should warn users that readable markdown files can be accessed by any local process with file permissions.

### Create

- Creating a vault must create the root directory if needed.
- Creating a vault must write `.vault.json`.
- Creating a vault must create `.goalrate/` and a `.goalrate/.gitignore` that excludes local indexes and caches.
- Creating a vault must eagerly create `goals/`, `domains/`, and `agenda/`.
- Creating a vault must eagerly create `tasks/`, `logs/`, and `system/` for the desktop MVP compatibility shape and audit trail.
- Creating a vault must eagerly create template/default `memory.md` and `eisenhower-matrix.md`.
- Creating a vault through onboarding should update the eager templates with initial domains, goals, tasks, and memory details collected from the user.
- Domain grouping in v1 is inferred from Goal frontmatter (`domain`, current internal `type`/`goal_type`, or tags). GoalRate does not need to create Domain metadata files in `domains/` for each Domain yet.

### Read

- Opening a vault requires a readable `.vault.json`.
- GoalRate should read markdown frontmatter for structured fields and body content for user notes.
- Unknown frontmatter fields must be preserved when GoalRate rewrites a file.
- Files with invalid frontmatter should not be silently overwritten.
- Files with invalid frontmatter should be ignored for typed loading and recorded in `logs/errors.md` with the affected path.
- Kind-specific required frontmatter must be validated before writes. For example, Goal files require Goal fields and Agenda files require Agenda fields such as `date`, `status`, `generated_at`, and `scheduled_tasks`. Agenda validation must also validate each `scheduled_tasks` row before read/write, instead of silently skipping malformed rows or filling required fields with defaults.
- Goal typed loading must validate required Goal fields and embedded `tasks`/`subtasks` rows. Invalid Goal task rows must be recorded with row-level field paths such as `tasks[0].title` or `tasks[0].subtasks[0].id`; GoalRate must not silently drop malformed rows from typed task loading.
- When GoalRate reads an invalid `agenda/<yyyy-mm-dd>.md` file, it must append the parse or validation error to `logs/errors.md` before returning the error, and it must not snapshot, rewrite, or quarantine the invalid Agenda file as part of that read.
- When GoalRate reads an invalid `goals/<goal>.md` file for typed Goal or embedded Task loading, it must append the validation error to `logs/errors.md` before omitting the invalid typed entity, and it must not snapshot, rewrite, or delete the invalid Goal file as part of that read.
- When GoalRate attempts to save Memory and existing `memory.md` has invalid frontmatter, it must append the parse error to `logs/errors.md`, return the error, and leave `memory.md` unchanged.
- The app may build or refresh `.goalrate/index.db` for fast search and UI loading.

### Update

- GoalRate may update markdown files directly when the user edits data in the app or approves Assistant changes.
- External edits should be treated as user edits.
- If an internal index disagrees with markdown, markdown is the source of truth for user-authored entities and daily Agenda files.
- `.goalrate/` databases must be treated as derived indexes/caches for Agenda state, not authoritative daily plan storage.
- When the desktop vault watcher reports a change in the active vault, Roadmap, Agenda, Assistant context, and Settings recovery data should refresh through existing typed read paths.
- Vault watcher refresh events should include changed vault-relative paths when available, so UI surfaces can avoid reloading unrelated markdown.
- Vault watcher debounce should accumulate changed paths across rapid filesystem events before emitting, so one fast save sequence cannot hide a relevant changed file behind an earlier unrelated event.
- Writes should be as narrow as practical so unrelated body content and unknown metadata survive.
- Writes should snapshot the previous file content under `system/snapshots/` and append a human-readable entry to `system/mutations.md`.
- Goal notes autosave is a user-initiated vault mutation and must write through the same markdown, snapshot, and mutation-log path as explicit saves.
- Manual embedded Goal Task/Subtask edits, including add, update, archive, or delete actions, are user-initiated vault mutations and must use explicit `user` attribution with action-specific mutation log entries.
- Expected manual embedded Task/Subtask mutation action names include `add_goal_frontmatter_task`, `update_goal_frontmatter_task`, `update_goal_frontmatter_task_status`, `update_goal_frontmatter_task_scheduled_date`, and `delete_goal_frontmatter_task`.
- Manual embedded Task/Subtask status changes, including complete, defer, block, and archive actions, must use the same snapshot, mutation-log, and final-validation path as other manual embedded writes.
- Manual embedded Task/Subtask status changes to `completed` must set `completed_at` when it is missing. Status changes away from `completed` must remove `completed_at`.
- Manual embedded Task/Subtask writes must validate the final Goal frontmatter before snapshotting or writing. Invalid rows should be recorded in `logs/errors.md`, and the failed write must not create a snapshot or mutation log entry.
- When a manual embedded Task/Subtask add includes a parent Task id, that parent must already exist in the same Goal frontmatter.
- A manual embedded Task/Subtask update must be able to target a row whether it is stored as a top-level `tasks` entry or as a nested `subtasks` entry.
- A manual embedded Task/Subtask delete may remove matching rows from the parent Goal markdown, but it must not delete any vault file from disk.
- A manual embedded Task/Subtask delete must require explicit user confirmation before removing rows from Goal markdown.
- A manual embedded Task/Subtask delete must also remove descendant rows from the same Goal frontmatter, including nested `subtasks` entries and flat child rows linked by `parent_id`, `parentTaskId`, `generated_from_task_id`, or `generatedFromTaskId`.
- Assistant-originated vault writes must use `Actor: assistant` and a specific action name in `system/mutations.md`; they must not fall back to generic system attribution.
- Assistant-originated missed-work writes to Goal markdown must validate existing embedded Task/Subtask rows before writing. Invalid rows should be recorded in `logs/errors.md`; the failed write must not create a snapshot or mutation log entry because no vault content changed.

### Undo and Recovery

- Settings should show a bounded, newest-first list of recent vault issues parsed from `logs/errors.md`, including the affected vault-relative file path, timestamp, and error summary.
- Settings Recent Issues should surface Memory parse errors logged for `memory.md` after the active vault's `logs/errors.md` changes.
- Settings should provide an action to open `logs/errors.md` from the Recent Issues area.
- Settings should provide a manual refresh action for Recent Issues that rereads `logs/errors.md` without mutating it.
- Each Recent Issues entry should provide an action to open the affected local markdown file when the logged path is a valid vault-relative markdown path.
- Reading recent vault issues must not rewrite, snapshot, truncate, or otherwise mutate `logs/errors.md`.
- GoalRate should support restoring the latest logged snapshot for a vault markdown file.
- GoalRate should list available restorable snapshots with the target file path, snapshot path, actor, action, and timestamp from `system/mutations.md`.
- Snapshot lists should include only snapshots that still exist under `system/snapshots/`.
- Before restoring a snapshot, GoalRate should show a read-only preview of what will change.
- Snapshot previews should include the target path, snapshot path, whether the current target file exists, line additions/deletions/unchanged counts, and bounded current/restored markdown excerpts.
- If the target file no longer exists, the preview should clearly state that restore will recreate it from the snapshot.
- Snapshot preview must not write mutation logs, create snapshots, or modify vault files.
- Restoring a snapshot must only read snapshot paths and target file paths inside the vault root.
- Restoring a snapshot must write the prior current file content to `system/snapshots/` before replacing it when the target file still exists.
- Restoring a snapshot must append a new human-readable entry to `system/mutations.md`.
- Snapshot restore must not delete files. If the target file no longer exists, restore should recreate that file from the snapshot content.
- If no restorable snapshot exists, GoalRate should return a clear no-op result instead of failing silently.

### Delete

- Removing a vault from GoalRate removes the app's reference to that vault.
- Deleting vault files from disk is a separate destructive action and must require explicit user confirmation.
- Vault library entry deletion must reject empty paths, must stay within the vault root, and must require an explicit confirmation argument before deleting a file or folder from disk.
- Any IPC command that can delete a Goal markdown file from disk must require an explicit confirmation argument, not merely rely on the command name. Non-destructive fallback cleanup should archive partial Goal markdown instead of deleting it.
- Legacy Goal milestone deletion IPC commands must require an explicit confirmation argument before removing markdown content.
- Desktop MVP must not register legacy Project or Project Task Tauri IPC commands that read or mutate standalone `projects/` markdown. If legacy modules remain in the codebase for compatibility or future migration, they must stay unreachable from the desktop invoke handler until a dedicated Project spec exists.
- Deleting a goal, task, or subtask from within GoalRate should either remove it from markdown or mark it archived according to the relevant entity lifecycle.
- Assistant-initiated destructive changes must be confirmed by the user.

## Public Interfaces / Data Model

### `.vault.json`

Expected shape:

```json
{
  "id": "vault_<uuid>",
  "name": "My Vault",
  "path": "/absolute/path/to/vault",
  "type": "private",
  "created": "2026-04-25T12:00:00Z",
  "last_opened": "2026-04-25T12:30:00Z",
  "schema_version": 1,
  "sync_enabled": false
}
```

Required fields:

- `id`
- `name`
- `path`
- `type`
- `created`
- `schema_version`

### Domain Markdown

Domain markdown files are optional/reserved in v1. See [Roadmap, Goals, Domains, Tasks](roadmap-goals-domains.md) for the deferred Domain metadata shape.

### Goal Markdown

See [Roadmap, Goals, Domains, Tasks](roadmap-goals-domains.md) for exact fields.

### Memory Markdown

See [Assistant and Memory](assistant-memory.md) for exact fields.

### Agenda Markdown

See [Agenda Daily Planning](agenda-daily-planning.md) for exact behavior.

## Current Implementation Notes

- Current vault code already uses `.vault.json`, `.goalrate/`, and `goals/`.
- Current implementation supports flat goal markdown files and some legacy directory-style goal files.
- Current daily planning state is stored in `.goalrate/daily-loop.db`; target behavior moves daily Agenda source-of-truth state to `agenda/<yyyy-mm-dd>.md` while any internal DB remains a derived index/cache.
- Current implementation may refer to vault type values such as private, public, and team. This spec only requires local private vault behavior.

## Acceptance Criteria

- A user can inspect goals and memory as markdown outside GoalRate.
- A user can inspect and edit daily Agenda files as markdown outside GoalRate, and those files are authoritative for daily plan state.
- A newly created vault immediately contains `goals/`, `tasks/`, `domains/`, `agenda/`, `logs/`, `system/`, `memory.md`, and `eisenhower-matrix.md`; `domains/` and `tasks/` may be empty.
- GoalRate can reopen a vault after app restart using `.vault.json`.
- Removing a vault from the app does not delete user files.
- API keys and provider tokens are not written to markdown.
- Unknown frontmatter survives a read/update/write cycle.
- Parse errors and app/Assistant mutations are visible in markdown logs.
- A user can preview and restore the latest logged markdown snapshot or choose a specific listed snapshot, and that restore is itself logged and recoverable.
