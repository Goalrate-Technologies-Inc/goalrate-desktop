# Desktop App Overview

## Problem

GoalRate Desktop should help the user understand what to do today to make progress on their goals. The app needs a clear first-run path, a durable local vault, and a focused daily workspace that combines long-term goals, today's agenda, and an AI assistant.

## Goals

- Guide new users into a usable local vault without requiring prior setup knowledge.
- Reopen or switch between existing vaults when the user has already created one.
- Present three primary product surfaces once a vault is open:
  - Roadmap: goals grouped by domain.
  - Agenda: today's AI-generated, prioritized plan.
  - Assistant: chat-based help that can update domains, goals, tasks, and subtasks.
- Keep the desktop app local-first and markdown-first.
- Make the app license posture explicit as BUSL 1.1.

## Non-Goals

- Do not specify the Web app, Premium subscription, or public goal publishing in this spec. Goal publishing is future/deferred behavior and should receive its own spec.
- Do not require full-vault encryption for v1. The chosen product posture is markdown interoperability first.
- Do not specify mobile behavior.
- Do not make the desktop shell a marketing landing page. The main app experience is the product.
- Do not support multiple vaults open side by side. GoalRate Desktop is intentionally focused on one active vault at a time.

## User Experience

### First Run

When no vault is available, the user sees an onboarding flow that explains why a vault is needed and asks them to create one. The flow should collect enough goal and Memory detail to create a useful first plan immediately:

- Vault name.
- Initial domains, such as Work, Health, Family, Startup, or Personal.
- Initial goals under those domains.
- Initial tasks or desired outcomes for those goals.
- Detailed Memory data that affects scheduling and planning, such as work capacity, sleep, meals, snacks, exercise, social time, self-care, downtime, preferences, limitations, important days, and consent settings.

After onboarding completes, the app opens the new vault and displays the main workspace.

### Returning User

When one or more vaults are known, the user can select which vault to open. The selected vault determines all Roadmap, Agenda, Memory, and Assistant context.

If the previously selected vault is unavailable, the app should explain the issue and offer to locate a vault or create a new one.

### Main Workspace

With an open vault, the default desktop workspace shows:

- Roadmap panel: domains and goals, grouped and ordered for scanning.
- Agenda panel: today's tasks in a chronological schedule with am/pm start times, estimated durations, and completion controls.
- Assistant panel: chat with context from the current vault and today's Agenda.

The Assistant panel should be titled `Assistant`, not `Context`. Vault and Agenda context may inform Assistant behavior, but it should not be surfaced as a separate labeled context section in the default panel. The `Assistant` title should use the same section-title typography as the `Roadmap` title so the left and right workspace panels feel balanced.

The user should be able to:

- Switch vaults.
- Create or open a vault.
- Close the current vault.
- Edit goals and tasks.
- Generate or refresh today's Agenda.
- Chat with the Assistant to clarify or adjust the plan.
- Open settings for AI provider setup, app preferences, and vault information.

## Requirements

### App Shell

- The desktop app must maintain a single active vault at a time.
- The active vault name must be visible in the app shell.
- Vault switching must refresh Roadmap, Agenda, Assistant, and Memory context.
- Active-vault markdown changes detected by the desktop file watcher must refresh Roadmap, Agenda, Assistant context, and Settings recovery data without requiring a full app restart.
- File watcher refresh events should include changed vault-relative paths when available, and UI surfaces should use those paths to avoid refreshing unrelated panels.
- File watcher debounce should accumulate changed paths across rapid filesystem events before emitting a refresh event.
- Frontend watcher payload parsing and path filtering should be shared across workspace surfaces so Roadmap, Agenda, Assistant context, and Settings recovery interpret watcher events consistently.
- A single active-vault watcher event may be consumed independently by the app shell and workspace surfaces; one surface filtering out a path must not prevent another relevant surface from refreshing.
- The app shell should show a subtle transient local refresh status when active-vault file watcher events are handled. When watcher paths identify a single affected area, use compact local labels such as `Goals refreshed` or `Agenda refreshed`; otherwise fall back to `Vault refreshed`. The status should expose the local refresh time in a tooltip/title without adding persistent visual clutter. This status must not imply cloud sync.
- Switching vaults must replace the active workspace rather than opening a second side-by-side vault workspace.
- Closing a vault must clear active product context and return the app to the vault creation/opening state.
- Native desktop menu actions for new, open, or close vault must route through the same close-vault behavior so product context is cleared before another vault flow begins.
- The app should keep common controls reachable without hiding the primary daily workspace.
- Native IPC integration tests must make their IPC prerequisite explicit: when the test process is not running in a Tauri IPC-capable environment, `test:integration` should skip those suites with a clear setup message rather than claiming to exercise native commands.

### Onboarding

- If no vault is active, onboarding must guide the user to create or open a vault.
- If a vault exists but has no goals, onboarding must collect enough information to create at least one domain and one goal.
- Onboarding must start collecting detailed Memory data immediately after vault creation/opening and before generating the first useful Agenda.
- Memory collection must include consent choices for Assistant updates and remote AI context. Local Memory planning is always enabled when `memory.md` exists.
- The user should be able to skip individual Memory fields, but skipped fields should be represented clearly as unknown rather than silently guessed.
- Onboarding should not require the user to configure AI before creating a vault.
- If AI is unavailable during onboarding, the app should still create the vault and let the user add goals/tasks manually.
- Onboarding output must be persisted into markdown-compatible vault files where practical, including `memory.md` for Memory data.

### Main Panels

- Roadmap must group goals by domain and show color-coded priority indicators derived from Eisenhower prioritization.
- Agenda must show today's work as a chronological schedule with checkable tasks, am/pm start times, and estimated durations, without priority dots in task rows.
- Assistant must be able to propose or perform contextual updates to domains, goals, tasks, subtasks, and memory according to [Assistant and Memory](assistant-memory.md).
- Assistant must show a visible in-progress state while it is thinking, rescheduling, breaking down tasks, regenerating the Agenda, or otherwise applying an update.

### License

- The repository and app are licensed under BUSL 1.1 unless a later legal decision changes this.
- Product specs should not introduce behavior that implies a different license, open-source grant, or distribution model.

### Error States

- Vault read/write errors must be visible to the user.
- AI provider errors must not block manual use of the app.
- If vault markdown is edited externally and contains invalid structured fields, the app should preserve the raw file where possible and report which fields could not be parsed.

## Current Implementation Notes

- The current desktop app already has an Agenda layout with a vault selector, intake flow, roadmap-like Roadmap sidebar, Agenda panel, and Assistant panel.
- The current intake flow collects initial Domains, Goals, Tasks, Memory planning constraints, and remote/update consent choices, then persists them through vault markdown commands during onboarding.
- Removing the active vault reference closes the active workspace and returns the user to the intake flow without deleting local vault files.
- Native desktop menu actions for new, open, and close vault already share the close-vault path. The initial production Mac channel is direct website distribution, so update UX should be handled by the direct Mac update path when implemented rather than by the Mac App Store.
- The current code may use `Objective` and `goal_type` internally. Product-facing specs use `Goal` and `Domain`.
- Some Agenda state is currently stored in app-managed SQLite under `.goalrate`. Target product behavior should keep user-facing entities markdown-readable and may continue to use indexes/caches internally.

## Acceptance Criteria

- A new user can create a vault, add initial domains/goals/tasks, and land in the main workspace.
- First-run onboarding collects detailed Memory data and writes it to `memory.md` before the first Agenda generation.
- A returning user can open a known vault and see Roadmap, Agenda, and Assistant context from that vault.
- The app clearly distinguishes local markdown vault data from internal app-managed data.
- The app supports switching between known vaults but never shows multiple active vault workspaces at once.
- Manual goal/task management remains usable when AI is unavailable.
