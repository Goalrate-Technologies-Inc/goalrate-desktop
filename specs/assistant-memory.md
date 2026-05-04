# Assistant and Memory

## Problem

The Assistant needs enough context to help the user plan realistically, but that context can be sensitive. GoalRate must define what the Assistant can remember, how memory is edited, what consent is required, and how chat updates affect Domains, Goals, Tasks, and Subtasks.

## Goals

- Define the Assistant's role in the desktop app.
- Define persistent Memory fields used for planning.
- Keep Memory user-editable and consent-aware.
- Start collecting detailed Memory data during first-run onboarding.
- Allow contextual updates to Domains, Goals, Tasks, and Subtasks.
- Avoid storing secrets or sensitive AI provider credentials in markdown Memory.

## Non-Goals

- Do not define a general-purpose chatbot outside the GoalRate planning context.
- Do not allow the Assistant to delete goals or memory without explicit user confirmation.
- Do not include Premium web publishing behavior.
- Do not force the user to fill every sensitive Memory field before using the app; skipped fields must remain unknown and editable later.

## User Experience

The Assistant appears as a chat panel in the desktop workspace. The panel should be titled `Assistant`, and that title should match the `Roadmap` section-title typography. The app may use the current vault and today's Agenda as Assistant context, but the default panel should not expose that as a separate user-facing `Context` section. It can answer questions about the current plan, explain prioritization, revise today's Agenda, generate tasks or subtasks, and update the Roadmap when the user asks. While an Assistant request is in progress, the chat panel should show a visible working state, such as thinking, rescheduling, breaking down tasks, regenerating the Agenda, or adding tasks.

The Assistant can also maintain a Memory file with details that make planning more realistic. The user can inspect and edit Memory directly as markdown. When the Assistant wants to add or change sensitive Memory details, it should ask for confirmation unless the user has enabled automatic memory updates.

## Requirements

### Assistant Scope

The Assistant can:

- Explain today's Agenda and why tasks were selected.
- Reprioritize, add, remove, or reschedule today's tasks.
- Create or update Domains, Goals, Tasks, and Subtasks.
- Generate subtasks when a task is too large or repeatedly missed.
- Ask reflective questions when work is repeatedly deferred.
- Update Memory when the user provides stable planning-relevant information.
- Summarize end-of-day check-ins.

When assembling vault context for Assistant reads, GoalRate must use the same typed embedded Task/Subtask loader used by Roadmap and Agenda. Invalid Goal task rows should be logged to `logs/errors.md` with row-level field paths and omitted from Assistant planning context; the Assistant should never receive malformed rows through a separate partial parser.

The Assistant must not:

- Delete or archive a Goal, Task, Subtask, or Memory section without explicit confirmation.
- Claim to update the plan without persisting or presenting the exact update.
- Use private Memory in future public publishing surfaces.
- Store API keys, OAuth tokens, or provider secrets in markdown Memory.

### Memory Use

Memory should help answer scheduling questions such as:

- How many hours can the user work on tasks today?
- How many Agenda tasks does the user prefer when they plan by count instead of hours?
- When does the user need sleep, meals, exercise, social time, self-care, or downtime?
- Which tasks are poor fits for the user's limitations or preferences?
- Are there important days that should affect planning?

Memory should be treated as context for planning, not as a hidden identity profile.

### Consent

Memory must include consent flags that control:

- Whether the Assistant may update Memory from chat.
- Whether Memory may be sent to a remote AI provider.
- Whether sensitive fields require per-change confirmation.

Local Agenda planning always uses `memory.md` when it exists. The legacy
`use_for_planning` field may remain in frontmatter for compatibility, but it is
not a user-facing opt-out.

If consent is missing, default to conservative behavior:

- Use existing local Memory for local display and planning only if it is already present.
- Ask before sending Memory to a remote AI provider.
- Ask before adding new sensitive Memory.
- Avoid sending raw `memory.md` to a remote AI provider; prefer a minimized planning summary when remote Memory context is enabled.

### Remote AI Memory Context

GoalRate v1 does not require a separate redaction subsystem before launch. Remote Memory context is allowed only after consent and should be purpose-built for the current operation, using a minimized planning summary where practical instead of the raw `memory.md` frontmatter or body.

V1 guidance:

- Check consent before request assembly.
- Include only fields needed for the current operation, such as Agenda generation, duration estimation, task prioritization, or Assistant response.
- Omit direct identifiers unless explicitly needed. Prefer descriptions such as "user prefers morning workouts" over raw profile details.
- Omit or generalize sensitive important days when the exact date is not needed.
- Omit fields the user skipped, marked private, or did not consent to share remotely.
- Preserve scheduling utility where possible, such as sending "lunch usually blocks 12:00 PM-1:00 PM" instead of unrelated personal notes.
- Log or display enough metadata for transparency, such as which Memory categories were included, without logging the full sensitive payload.
- A dedicated redaction layer is deferred hardening, not a v1 acceptance blocker.

Suggested minimized payload shape:

```json
{
  "purpose": "agenda_generation",
  "includedCategories": ["capacity", "schedule", "preferences", "limitations"],
  "capacity": {
    "taskCountPerDay": 8,
    "taskHoursPerDay": 5,
    "sleepHoursNeeded": 8,
    "downtimeHoursNeeded": 2
  },
  "scheduleConstraints": [
    { "label": "Lunch", "startTime": "12:00 PM", "endTime": "1:00 PM" }
  ],
  "preferencesSummary": ["Prefers focused work before noon"],
  "limitationsSummary": ["Avoid scheduling high-energy tasks late at night"]
}
```

The minimized payload is transient request context. It should not replace `memory.md` and should not be persisted unless the user explicitly asks for an audit/export feature.

### Onboarding Memory Collection

First-run onboarding should collect detailed Memory data immediately so the first Agenda can be realistic. The user should be able to skip individual fields, but the onboarding flow should ask for each major planning category instead of waiting for the Assistant to discover it later.

Required onboarding Memory categories:

- User identity basics: name and optional age.
- Important days: birthdays, holidays, and personal dates that should affect planning.
- Preferences: what the user likes and does not like to do.
- Limitations: physical, cognitive, scheduling, accessibility, or other constraints the user wants GoalRate to respect.
- Food schedule: meals and snacks.
- Recovery needs: sleep, free time, downtime, and self-care.
- Health/social needs: exercise and socialization time.
- Work capacity: how many hours the user can spend on Tasks in a normal day.
- AI consent: whether Memory can be used for planning, updated by the Assistant, and sent to remote AI providers.

Onboarding should persist collected Memory to `memory.md` before the first AI-generated Agenda. If the user skips a field, the corresponding frontmatter value should stay `null` or an empty list rather than using a guessed default.

### User Editable Sections

Memory should be readable and editable in markdown. User-editable sections should be clearly separated from app-generated summaries.

If `memory.md` exists but its YAML frontmatter cannot be parsed, GoalRate must append the parse error to `logs/errors.md`, return a visible validation error, and leave the existing file unchanged. A Memory save must not overwrite malformed user-edited markdown as a recovery shortcut.

Recommended body sections:

```markdown
## About Me

## Schedule and Capacity

## Preferences

## Limitations

## Important Days

## AI Notes
```

### Memory Changelog

Memory changes may keep a visible changelog, but a dedicated changelog file is deferred beyond v1. The v1 requirement is that `memory.md` remains readable, editable, and consent-aware.

Recommended file: `memory-changelog.md`

Deferred changelog behavior:

- The changelog is append-only by default.
- Every Memory change should record timestamp, actor, changed field or section, old/new summary, reason/source, and approval status.
- `actor` should be one of `user`, `assistant`, or `system`.
- AI-made changes should be logged when this deferred changelog exists, even when the user has enabled automatic Memory updates.
- Sensitive values should be summarized or redacted in changelog entries rather than exposed raw.
- User-rejected proposed Memory changes may be logged as rejected proposals when useful for transparency.
- The current Memory state remains in `memory.md`; the changelog records history and accountability.

Example:

```markdown
## 2026-04-25T09:30:00-07:00

- Actor: assistant
- Field: task_capacity_hours_per_day
- Change: unknown -> 5 hours
- Source: onboarding answer
- Approval: approved by user
```

### Assistant Updates

When the user asks the Assistant to update a Domain, Goal, Task, or Subtask:

- The Assistant should identify the target entity from current context.
- If multiple entities match, it should ask a concise clarification.
- Non-destructive changes can be applied directly when intent is clear.
- Destructive changes require confirmation.
- The app should record enough context to explain what changed.

When the Assistant updates today's Agenda:

- It must return a concrete plan update, not just a conversational claim.
- It must treat "regenerate", "refresh", "redo", "rebuild", or "make a new Agenda/tasks" as a request to replace the visible Agenda with a freshly selected scheduled task set.
- Regeneration should use the same Roadmap, Memory, prioritization, and scheduling inputs as first-time Agenda generation for that day.
- For today's Agenda, regeneration must schedule the first visible task after the current clock time instead of preserving earlier time slots.
- It must include scheduled rows when changing Agenda start times, durations, or visible row titles.
- It must treat planning constraints such as day start time, no scheduled tasks before a time, day end time, required free time, mandatory exercise, preparation before an event, or temporary domain exclusions as actionable Agenda updates.
- It must treat explicit multi-step routines or chores with relative timing as actionable Agenda updates.
- It must treat dependency corrections or prerequisite constraints as actionable Agenda updates that repair impossible task order or add the missing prerequisite row when the current context makes the needed change clear.
- It must treat questions that point out an impossible dependency as actionable corrections, not explanation-only prompts.
- It must treat direct follow-ups such as "reorder it", "do it", or "do it now" as actionable when recent chat context identifies the pending Agenda correction.
- It must apply explicit position instructions such as "the first task at 9am should be..." by moving the matching existing Agenda row into that visible time slot and persisting the result.
- It must preserve user-stated ordered routines such as first/second/third steps. Deterministic repairs must not move a later step, such as folding, before an earlier step, such as moving or washing.
- If a requested prerequisite step is missing from the visible Agenda and the user gives enough text to name it, the backend should create that concrete Agenda row in the requested slot instead of moving an unrelated later step.
- It should default to making the requested Agenda change and push back only when the requested work cannot fit inside the user's time constraints, the day would need to start earlier, or required tasks are mutually impossible.
- When an Agenda update changes the visible scheduled task set, it must also update Top Outcomes so they only reference tasks still on today's Agenda.
- It must persist the update before saying the Agenda was changed.
- When the Assistant supplies full `scheduled_tasks` for a reorder, replace, or regenerate action, that schedule is the authoritative visible Agenda update even if a separate task list is stale or disagrees.
- If a structured update reorders tasks but omits scheduled rows or provides only partial scheduled rows, the backend must still reorder the existing visible Agenda rows and assign existing start-time slots to the reordered tasks so the user sees the schedule change that was promised.
- If a reorder update includes only the moved tasks, the backend should merge that ordered subset into the existing Agenda and preserve unrelated rows.
- A reorder action must change the visible Agenda order. Title, outcome, duration, or time edits alone must not satisfy a reorder request.
- Structured Agenda success copy should be based on the effect that was actually persisted. The Assistant must not say it reordered the Agenda unless the persisted Agenda order changed first.
- If a structured reorder update would leave the visible order unchanged, the backend should treat it as ineffective and attempt a structured repair pass before responding.
- Outcome-only changes must not satisfy an add, remove, reorder, reschedule, replace, regenerate, or schedule-update request. Those actions must visibly change Agenda rows, row titles, or times before the Assistant reports success.
- If the model response omits a structured update for a clearly actionable Agenda request, the backend should attempt a structured repair pass that requires a concrete plan update.
- User-facing copy for actionable Agenda requests should not use a generic unchanged dead-end. The Assistant should either save the closest executable update or explain a real schedule-capacity conflict.
- While the Assistant is applying or preparing an update, the UI should show a visible status that reflects the likely operation instead of appearing idle.
- It should preserve unrelated tasks unless the user explicitly asks to replace the plan.
- New tasks must link to a Goal where possible.

When the Assistant updates Memory from chat:

- It should return a structured `memory_update` for stable planning-relevant information or explicit remember/save requests.
- If the model omits `memory_update` for a clear remember/save request, the backend should derive a conservative Memory update from the latest user message before applying consent checks.
- Generic remembered details that do not fit typed frontmatter fields may be appended under `## AI Notes` after explicit remember/save intent or relaxed sensitive-confirmation settings; this should not become a chat transcript.

Assistant pushback rules:

- The Assistant should do what the user needs when the request is actionable and the current context supports a reasonable update.
- If the user corrects the schedule, adds a prerequisite, points out an impossible order, gives a new time boundary, asks for a breakdown, or asks to regenerate, the Assistant should treat that as planning information and update the Agenda.
- The Assistant should not expose internal translation failure as user-facing pushback. Generic responses that say the Agenda is unchanged because no concrete update could be found are not acceptable for actionable requests.
- The Assistant should push back only for real planning constraints: not enough available time, needing the day to start earlier, violating a hard Memory constraint, or mutually impossible task requirements.
- When pushing back, the Assistant should still guide the user by saving the closest executable update when possible, naming the exact constraint, and offering a specific tradeoff.

## Public Interfaces / Data Model

### Memory Markdown

Suggested file: `memory.md`

```yaml
---
id: memory_local_user
type: memory
user_name: ""
age: null
important_days: []
likes: []
dislikes: []
limitations: []
meal_windows: []
snack_windows: []
exercise_minutes_needed: null
socialization_minutes_needed: null
self_care_minutes_needed: null
task_capacity_hours_per_day: null
task_capacity_tasks_per_day: null
sleep_hours_needed: null
downtime_hours_needed: null
consent:
  use_for_planning: true
  allow_ai_updates_from_chat: false
  allow_remote_ai_context: false
  require_confirmation_for_sensitive_updates: true
last_updated: null
---
```

Required fields:

- `id`
- `type: memory`
- `consent`
- `last_updated`

Recommended fields:

- `user_name`
- `age`
- `important_days`
- `likes`
- `dislikes`
- `limitations`
- `meal_windows`
- `snack_windows`
- `exercise_minutes_needed`
- `socialization_minutes_needed`
- `self_care_minutes_needed`
- `task_capacity_hours_per_day`
- `task_capacity_tasks_per_day`
- `sleep_hours_needed`
- `downtime_hours_needed`

### Important Day Shape

```yaml
important_days:
  - label: Birthday
    date: "1990-05-10"
    recurrence: yearly
    notes: ""
```

### Time Window Shape

```yaml
meal_windows:
  - label: Lunch
    start_time: "12:00 PM"
    end_time: "1:00 PM"
    days: [monday, tuesday, wednesday, thursday, friday]
```

### Consent Shape

```yaml
consent:
  use_for_planning: true
  allow_ai_updates_from_chat: false
  allow_remote_ai_context: false
  require_confirmation_for_sensitive_updates: true
```

### Minimized Remote Memory Payload

Future redaction hardening may produce a transient payload matching this shape:

```yaml
purpose: agenda_generation
included_categories:
  - capacity
  - schedule
  - preferences
  - limitations
capacity:
  task_count_per_day: 8
  task_hours_per_day: 5
  sleep_hours_needed: 8
  downtime_hours_needed: 2
schedule_constraints:
  - label: Lunch
    start_time: "12:00 PM"
    end_time: "1:00 PM"
preferences_summary:
  - Prefers focused work before noon
limitations_summary:
  - Avoid scheduling high-energy tasks late at night
```

### Memory Changelog Entry

Deferred suggested file: `memory-changelog.md`

```yaml
---
type: memory_changelog
memory_id: memory_local_user
---
```

Recommended entry fields:

- `timestamp`
- `actor`
- `field`
- `old_summary`
- `new_summary`
- `source`
- `approval_status`
- `redacted`

## Current Implementation Notes

- Current code has Assistant chat for today's Agenda and can persist chat messages.
- Current Agenda context includes goals, tasks, check-ins, stats, snapshots, and consented minimized Memory context for Assistant calls.
- Current onboarding collects Memory planning constraints plus remote/update consent choices, then writes them to `memory.md` through the vault-backed `save_memory` command before entering the main workspace.
- Current Memory save failures caused by invalid `memory.md` frontmatter are logged to `logs/errors.md` and surface through Settings Recent Issues after the active vault log changes.
- Current Agenda scheduling honors local Memory task capacity, meal/snack windows, and capacity reserves for sleep, downtime, exercise, socialization, and self-care when those fields exist. Exact windows are still required before those reserves become visible fixed Agenda rows.
- Current app uses provider keys from keychain/environment integrations. That matches this spec's rule that secrets do not belong in markdown Memory.
- Current AI context assembly should check consent before using Memory in remote calls and should prefer minimized planning context when Memory is included.
- Current Assistant chat can persist consented, structured Memory updates from chat to `memory.md` with assistant mutation attribution. It also has a backend fallback for explicit remember/save messages when the model omits a Memory update. Sensitive Memory updates are blocked when confirmation is required unless the user explicitly confirmed that exact update.
- Current implementation does not need a dedicated Memory changelog for v1; `memory-changelog.md` remains a deferred transparency feature.
- Current Assistant chat can update the Agenda, generated goal tasks, Roadmap Goals, embedded Roadmap Tasks/Subtasks, and core Memory fields when the user intent is clear.
- Deferred beyond v1: arbitrary Assistant mutation of Domain metadata and destructive Roadmap cleanup. These remain explicit-confirmation or future workflow work rather than free-form chat mutations.

## Acceptance Criteria

- `memory.md` can represent user profile, capacity, schedule constraints, consent, and last updated time.
- First-run onboarding asks for detailed Memory categories and persists the result before the first Agenda generation.
- The Agenda generator can subtract sleep, downtime, meals, exercise, socialization, and self-care from available task capacity when those fields exist.
- The Assistant can update Roadmap and Agenda entities when user intent is clear.
- Sensitive Memory updates require confirmation by default.
- Remote AI providers receive Memory context only after consent checks, and the context is minimized where practical.
- Memory links conceptually to Eisenhower prioritization for task planning.
