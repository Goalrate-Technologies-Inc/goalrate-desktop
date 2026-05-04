# Agenda Daily Planning

## Problem

Users need a practical Agenda that translates long-term goals into work they can actually complete today. The Agenda must account for priority, urgency, personal constraints, available time, energy, recurring tasks, deferrals, and recent completion patterns.

## Goals

- Generate a daily Agenda from Roadmap goals, tasks, subtasks, Memory, and Eisenhower priority.
- Show tasks as an exact chronological schedule with am/pm start times and estimated durations.
- Let users check off, defer, edit, and discuss tasks.
- Keep daily planning useful even when AI is unavailable.
- Persist enough plan state to survive app restarts and support later reflection.

## Non-Goals

- Do not require calendar sync for v1.
- Do not claim duration estimates are guaranteed minute-perfect. The Agenda must still provide concrete scheduled start times.
- Do not automatically schedule work during sleep, meal, self-care, social, or downtime windows captured in Memory.
- Do not publish daily agendas to the Web app.
- Do not expose private Memory or raw task lists in future public Goal Snapshots.
- Do not show priority dots in Agenda task rows; Roadmap owns visual priority indicators.

## User Experience

The Agenda shows today's work. It should be immediately actionable:

- Top outcomes for the day.
- A chronological task timeline starting from the Agenda generation time or the next available user time.
- Tasks and subtasks ordered by importance and urgency.
- Checkboxes or completion controls.
- Deferral controls.
- Clickable task and subtask names that open the parent Goal notes when the Agenda row references Roadmap work.
- Optional end-of-day check-in.
- No color-coded priority dots in task rows.

The user can ask the Assistant to reprioritize, reschedule, explain why a task is included, break down work, or adjust the day after new information appears.

## Requirements

### Plan Inputs

The Agenda generator may use:

- Active Goals and Tasks from the Roadmap.
- Active Subtasks generated from previously missed Tasks.
- Eisenhower quadrant for each Goal/Task/Subtask.
- Deadlines and due dates.
- Recurrence rules.
- Task effort estimates.
- Energy levels and blockers.
- Completion and deferral history.
- Specific scheduled dates for Tasks/Subtasks when the user or Assistant marks work as belonging to one exact local day.
- Memory fields for work capacity, sleep, meals, exercise, social time, self-care, downtime, preferences, limitations, and important days.
- Local Memory planning should always use `memory.md` when it exists. It is not a user-facing opt-out; remote AI Memory context remains separately opt-in.
- Recent check-ins and completion patterns.

### Plan Generation

- The app should generate one primary Agenda per local day per vault.
- The Agenda must record the local `generated_at` time used to build the schedule.
- If no plan exists for today, the app should offer to generate one.
- If AI is unavailable, the app should create a manual/heuristic plan from existing Tasks ordered by Eisenhower priority, due date, and estimated effort.
- When an `agenda/<yyyy-mm-dd>.md` file exists, loading the Agenda should treat that markdown as authoritative and refresh any internal index/cache from it before later edits or Assistant updates use cached state.
- The generated plan should include 1-3 top outcomes when enough information exists.
- The plan should include tasks and subtasks that fit within the user's available task capacity.
- When Memory specifies a preferred Agenda task count or task-hour capacity for the day, generation should fill the Agenda to that count or hour target when enough useful Roadmap or goal-derived work exists.
- AI-generated or Assistant-generated work rows must never exceed the task-hour capacity specified by `memory.md`; the backend must enforce this even if the model returns too many hours. Fixed Memory rows such as meals can still appear because they represent blocked personal time rather than work capacity.
- Pending work loading should flatten embedded Subtasks from Goal frontmatter. When a parent Task has active Subtasks, Agenda generation should schedule the active Subtasks instead of also scheduling the parent Task, so the daily plan stays focused on the next concrete action.
- Agenda generation and Agenda prioritization helpers must use the same typed embedded Task/Subtask loader as Roadmap task loading. Malformed Goal task rows must be logged to `logs/errors.md` with row-level field paths and excluded from Agenda candidates instead of being silently skipped or partially parsed by ad hoc YAML reads.
- The plan should avoid scheduling work during blocked Memory windows.
- The first scheduled task should start at the Agenda generation time unless Memory says that time is unavailable.
- If the generation time is unavailable, the first task should start at the next available time after the current Memory block.
- Completed non-recurring tasks should not be included.
- Completed recurring tasks may appear again according to recurrence.
- Tasks with a specific scheduled date should appear only on that exact Agenda date, not before or after it.
- Tasks specifically scheduled for the Agenda date are required Agenda rows for that day, even when lower-priority flexible work must be dropped to make room.
- Existing task IDs must be preserved when tasks are reused.
- New AI-generated task IDs should be stable, sanitized, and linked to a parent Goal.

### Chronological Task Scheduling

- Agenda tasks must be listed as a sequential schedule with actual start times.
- Each scheduled task must have an am/pm start time and estimated duration.
- The next task starts when the previous task is expected to finish, unless a Memory constraint creates a gap.
- Start times should use the user's local date and time and default to 12-hour am/pm display.
- The planner should estimate likely duration from task title, task type, Memory, prior completion history, and explicit effort estimates.
- If a task has no effort estimate, the planner should assign a realistic inferred duration and mark the estimate as AI-generated or inferred.
- The schedule should be concrete enough to support routines such as `9:00 AM Shower`, `9:15 AM Get dressed`, `9:25 AM Breakfast`.
- The planner should include personal tasks such as showering, meals, dressing, exercise, and transitions when they are relevant to the day's plan or Memory.
- When `memory.md` contains exact time windows for recurring personal needs such as meals or snacks, generated and regenerated Agendas must include those items as fixed visible rows in the specified time slots.
- Fixed Memory rows should block work from overlapping those windows, but their duration should not count against task-hour capacity intended for work.
- The planner may insert unscheduled gaps only when Memory requires them, when the user has unavailable time, or when a task needs a buffer.
- Generated schedules should avoid broad categories such as Deep work, Admin/light work, Personal/health, or Buffer as primary Agenda rows.

Example:

```text
Generated at: 9:00 AM

9:00 AM Shower (15 min)
9:15 AM Get dressed (10 min)
9:25 AM Eat breakfast (20 min)
9:45 AM Draft onboarding spec updates (60 min)
10:45 AM Send delegation request for billing setup (10 min)
```

### Prioritization

Ordering must follow [Eisenhower Prioritization](eisenhower-prioritization.md):

1. Do.
2. Schedule.
3. Delegate.
4. Delete.

Within a quadrant, order by:

1. Deadline/due date urgency.
2. Task unblock value.
3. User energy and available time fit.
4. Deferral history.
5. Goal importance.

`Delegate` tasks should be presented as delegation actions when possible, not silently treated as normal work. Agenda classification should infer delegation from clear wording such as repair/service/vendor tasks where another person or company should do the work. `Delete` tasks should be suggested for deletion/archive, not auto-deleted.

Agenda rows should not show compact priority dots or color-coded quadrant indicators. Users can inspect visual priority indicators in Roadmap, while Agenda uses prioritization for ordering and Assistant explanations.

### Completion

- The user can check off tasks and subtasks.
- Completion should update the Agenda state.
- Completion should update the underlying task/subtask markdown when possible.
- Completed items should retain completion date/time.
- Unchecking a completed item should remove or clear completion metadata.
- When an Agenda row references an embedded Goal Task/Subtask, checking it complete should update that embedded row recursively with `status: completed` and `completed_at`; unchecking it should set the embedded row back to `status: todo` and remove completion metadata.
- Agenda completion writes that target embedded Goal Task/Subtask rows must preflight the Goal frontmatter update before mutating derived Agenda cache state. If Goal validation fails, the Agenda toggle should abort without changing the derived DB, Agenda markdown, snapshots, or mutation log.
- After preflight succeeds for an embedded Goal Task/Subtask, Agenda completion should write the Goal markdown mutation, then the Agenda markdown mutation, before updating derived Agenda cache state. Goal and Agenda markdown are durable source-of-truth files; the Agenda DB is recoverable cache state.
- A completed Agenda row must remain complete after the next Agenda refresh even if the derived Agenda cache was stale, because refresh must reread `agenda/<yyyy-mm-dd>.md` as the source of truth.
- If derived Agenda cache synchronization fails after durable markdown writes succeed, the user should see an error, but the next Agenda load must be able to rebuild the cache from `agenda/<yyyy-mm-dd>.md`.
- If Agenda markdown and Goal markdown disagree after a partial completion write, Agenda loading should reconcile visible embedded Goal Task/Subtask rows whose Goal frontmatter has `status: completed` by marking those rows complete in `agenda/<yyyy-mm-dd>.md` and then refreshing the derived Agenda cache from that repaired markdown.
- If a visible Agenda row is checked complete in `agenda/<yyyy-mm-dd>.md` but the referenced embedded Goal Task/Subtask is still active, Agenda loading should preflight and write the Goal frontmatter status update to `completed` with `completed_at`, then refresh the derived Agenda cache. If Goal validation fails, GoalRate must log the validation error and leave the Goal file unchanged.
- Agenda-to-Goal completion reconciliation must not partially repair malformed Goal frontmatter. If the referenced Goal Task/Subtask row is invalid or if another row in the same Goal fails final validation, GoalRate should log the row-level validation issue, leave the raw Goal markdown unchanged, and still load the Agenda from valid Agenda markdown.
- When Agenda-to-Goal reconciliation is skipped because Goal frontmatter is invalid, the Agenda UI should show a compact non-blocking warning with an action to open `logs/errors.md` while leaving the valid Agenda schedule usable.

### Deferral and Missed Work

- The user can defer a task with an optional reason.
- Deferrals should be counted per Task or Subtask.
- A Task not completed within 2 days of appearing on the Agenda should be broken into Subtasks unless it already has Subtasks.
- A Subtask not completed within 2 days of appearing on the Agenda should trigger the continuation decision flow in [Roadmap, Goals, Domains, Tasks](roadmap-goals-domains.md).
- Repeated deferrals should be surfaced directly and kindly by the Assistant.
- When missed work needs action, the Assistant panel should surface a compact, kind prompt titled as an attention item, not a separate `Context` panel.
- For missed Tasks, the Assistant prompt should offer to ask the Assistant to break the work into smaller Subtasks.
- For missed Subtasks, the Assistant prompt should offer choices that begin the continuation decision flow: continue the Subtask, try a different Subtask, or reconsider the parent Task.
- Choosing to continue a missed Subtask should persist the Subtask into `agenda/<tomorrow>.md`, refresh the derived Agenda index/cache, and update the Subtask's `last_seen_on_agenda` field in goal frontmatter.
- Choosing to try a different Subtask should create a new active Subtask under the same parent Task in goal frontmatter, leave the missed Subtask intact, log the Assistant mutation, schedule the new Subtask into `agenda/<tomorrow>.md`, refresh the derived Agenda index/cache, set the new Subtask's `generated_from_task_id` to the parent Task id, and set the new Subtask's `first_seen_on_agenda` and `last_seen_on_agenda` fields to tomorrow's date.
- Choosing to continue with the parent Task should persist the parent Task into `agenda/<tomorrow>.md`, refresh the derived Agenda index/cache, update the parent Task's `last_seen_on_agenda` field, and record `last_missed_decision_on` on the missed Subtask so the same decision does not immediately loop.
- Choosing to try a different Task should create a new active Task under the same Goal, leave the missed Subtask and parent Task intact, log the Assistant mutation, schedule the new Task into `agenda/<tomorrow>.md`, refresh the derived Agenda index/cache, and record `last_missed_decision_on` on the missed Subtask.
- Choosing to continue with the Goal should require explicit confirmation, then archive the missed Subtask's parent Task branch in goal frontmatter, leave the Goal active, log the Assistant mutation, and record `last_missed_decision_on` on the missed Subtask. It must not delete the Goal, Task, Subtask, or any vault file.
- Choosing not to continue with the Goal should require explicit confirmation, then archive the Goal in goal frontmatter, log the Assistant mutation, and record `last_missed_decision_on` on the missed Subtask when the Subtask remains in frontmatter. It must not delete the Goal, Task, Subtask, or any vault file.
- After any missed-work choice is persisted, the Assistant panel should refresh the workspace data so Agenda, Roadmap, and the attention prompt reflect the vault-backed change without requiring an app restart.
- Missed-work mutations that write Goal frontmatter must validate the target Goal's embedded Task/Subtask rows before writing. If validation fails, GoalRate must append row-level errors to `logs/errors.md` and abort before creating a snapshot, writing the Goal file, or appending a mutation log entry.
- Missed-work write validation must locate the target Goal by Task/Subtask id before relying on title or other optional row data, so a malformed target row is reported as a schema error instead of being treated as missing.
- Missed-work target resolution must use typed Task/Subtask metadata, including `parent_id`, `parentTaskId`, and `generated_from_task_id`, so a Subtask's parent can be found consistently whether the Subtask is nested under the parent Task or represented as a sibling embedded row.
- After a continuation choice is persisted, the same Subtask should not be re-prompted immediately only because its original `first_seen_on_agenda` is older than 2 days.

### Check-In

- The user should be able to complete an optional end-of-day check-in.
- The app may prompt for a check-in at the end of the day, but the user must be able to skip or dismiss it.
- Skipping a check-in must not block tomorrow's Agenda generation or any other core workflow.
- Check-ins should record completed tasks, deferred tasks, notes, and an optional AI summary.
- Check-ins should feed future planning.
- After enough check-ins exist, the planner may reference historical patterns.

### Manual Editing

- The user can manually reorder, add, remove, or edit Agenda items.
- Manual edits must persist concrete `scheduled_tasks` in `agenda/<yyyy-mm-dd>.md`, including row title, am/pm start time, and duration.
- Manual start-time entry should use a constrained native time control, while saved Agenda rows should continue to use local am/pm labels.
- Removing an Agenda item must only remove that row from the day's `scheduled_tasks`. If the row references a Goal Task or Subtask, the underlying Roadmap task must remain in Goal markdown; destructive task deletion belongs in the Roadmap task UI.
- Manual reorder should use drag and drop, not up/down arrow controls.
- Drag-and-drop reorder should keep the Agenda chronological by assigning the existing visible time slots to the reordered rows, then saving that concrete schedule.
- Focused drag handles should also support keyboard reorder with ArrowUp/ArrowDown while preserving the same visible time-slot rule.
- Manual Agenda edits should push the previous visible schedule onto an in-memory undo stack before writing, with a maximum depth of 50.
- Undoing the latest manual Agenda edit should persist the previous concrete `scheduled_tasks` back through the same vault-backed write path.
- Manual time edits may change the chronological position of a row after save because Agenda display order follows start time.
- When a manual edit changes a row's start time or duration, rows below that row should have their start times recalculated sequentially from the edited row while preserving rows above it.
- Manual changes should be preserved unless the user regenerates or explicitly accepts an Assistant change.
- Explicit manual `scheduled_tasks` should not be automatically reflowed by Memory constraints during the write; Memory constraints inform generation and Assistant planning, while direct user edits are authoritative.
- Regeneration should make clear whether it replaces the current plan or updates it.

### Assistant Updates

- Assistant chat updates must apply to the same visible Agenda rows the user sees.
- Assistant updates may add, remove, reorder, reschedule, or change the duration/title of Agenda rows.
- Requests to regenerate, refresh, redo, rebuild, or make a new Agenda/tasks should replace the visible Agenda with a freshly selected scheduled task set.
- Assistant-triggered regeneration should use the same generation prompt, Roadmap context, Memory context, capacity handling, and scheduling behavior as first-time Agenda generation for that day.
- Natural-language planning constraints such as day start time, no scheduled tasks before a time, day end time, required free time, mandatory exercise, preparation time before an event, or skipping a domain for the day should trigger a visible Agenda update.
- Natural-language multi-step routines or chores with relative timing should trigger concrete scheduled Agenda rows for each step.
- Natural-language dependency corrections or prerequisite constraints should trigger a visible Agenda update that reorders the steps or adds the missing prerequisite row when the current context makes the needed change clear.
- Questions that point out an impossible dependency, such as asking why the Agenda starts with a dependent task before its prerequisite, are actionable dependency corrections rather than explanation-only prompts.
- Direct follow-ups such as "reorder it", "do it", or "do it now" should be treated as actionable when recent chat context identifies the pending Agenda correction.
- Explicit position instructions such as "the first task at 9am should be..." must move the matching existing Agenda row into that visible time slot and persist the result.
- When the user states an ordered routine such as first/second/third steps, deterministic repairs must preserve that stated order. The backend must not infer a later step, such as folding, as the prerequisite for an earlier step, such as moving something to a dryer.
- If the requested prerequisite step is missing from the visible Agenda but the user gives enough text to name it, the backend should create that concrete Agenda row in the requested slot instead of moving an unrelated later step.
- The Assistant should default to making the requested Agenda change. It should push back only when the requested work cannot fit inside the user's time constraints, the day would need to start earlier, or required tasks are mutually impossible; in those cases, it should explain the constraint and offer the closest executable schedule.
- If the Assistant returns explicit `scheduled_tasks`, the saved Agenda work rows must still stay within task-hour capacity from `memory.md`; extra AI-suggested work beyond that capacity should be left off or presented as a capacity tradeoff, not persisted into today's Agenda.
- When Assistant updates change the visible scheduled task set, the top outcomes must be reconciled to the updated Agenda. Outcomes should link only to tasks still visible in today's Agenda, stale outcomes should be removed, and missing outcome slots should be filled from the updated scheduled tasks when enough information exists.
- If the Assistant claims an Agenda change, the backend must persist a concrete plan update to `agenda/<yyyy-mm-dd>.md` before reporting success.
- When the Assistant supplies full `scheduled_tasks` for a reorder, replace, or regenerate action, that schedule is the concrete Agenda update and must be used as the visible row order even if a separate task list is stale or disagrees.
- If the Assistant returns a task reorder without explicit scheduled rows, or with only partial scheduled rows, the backend must still reorder the visible Agenda rows that already exist instead of only changing hidden task order metadata. Existing start-time slots should be assigned to the reordered tasks so the schedule visibly changes.
- If a reorder update includes only the moved tasks, the backend should merge that ordered subset into the existing Agenda and preserve unrelated rows rather than dropping them or leaving the schedule unchanged.
- A reorder action is successful only when the visible Agenda order changes. Title, outcome, duration, or time edits alone must not satisfy a reorder request or allow the Assistant to say it reordered the Agenda.
- For structured Agenda actions, the user-facing confirmation should be generated from the persisted effect, not copied blindly from the model. If the app says it reordered the Agenda, the persisted Agenda order must have changed first.
- If a structured reorder update would leave the visible order unchanged, the backend should treat it as ineffective and attempt a structured repair pass before responding.
- Outcome updates alone must not count as a successful add, remove, reorder, reschedule, replace, regenerate, or schedule update. Those actions must change the visible Agenda rows, titles, or schedule before the Assistant reports that they were applied.
- If an Assistant response omits a structured update for a clearly actionable Agenda request, the backend should attempt a structured repair pass that requires a concrete plan update.
- Actionable Agenda requests should not end in a generic unchanged dead-end. The Assistant should either save the closest executable update or explain a real schedule-capacity conflict.

### Assistant Pushback

The Assistant's default behavior is to help the user get to an executable Agenda. When the user gives new information, corrects an assumption, asks for a task breakdown, changes a constraint, or points out that the current order does not work, the Assistant should update the Agenda using the best reasonable interpretation of the request.

The Assistant should not push back because it failed to translate the request into an internal update shape. It should not tell the user that it could not make a concrete Agenda change when the user gave actionable planning information. If the current context is enough to make a reasonable update, it should make the update and briefly state the assumption it used.

Valid pushback is limited to schedule reality:

- The requested work cannot fit before the user's stated end time.
- The requested work cannot fit without starting the day earlier than the user's stated start time.
- The requested change would remove required free time, sleep, commute, preparation, care, or other hard constraints stored in Memory.
- The requested tasks are mutually impossible as stated.

When pushback is needed, the Assistant should still be useful. It should show the closest executable Agenda change, name exactly what does not fit, and offer a concrete tradeoff such as moving a task, shortening a task, dropping a lower-priority item, or starting earlier. Pushback copy should be specific to the schedule conflict, not a generic failure message.

## Public Interfaces / Data Model

### Agenda Markdown

Suggested file: `agenda/<yyyy-mm-dd>.md`

Agenda markdown files are the source of truth for daily plan state. Internal databases may index, cache, or denormalize this data for performance, but they must rebuild from markdown when the two disagree.

```yaml
---
id: agenda_2026_04_25
type: agenda
date: "2026-04-25"
vault_id: vault_123
status: active
generated_by: ai
model_id: anthropic::claude-sonnet
generated_at: "2026-04-25T09:00:00-07:00"
top_outcome_ids:
  - outcome_ship_onboarding
completed_task_ids: []
created: "2026-04-25T09:00:00-07:00"
updated: "2026-04-25T09:00:00-07:00"
locked_at: null
scheduled_tasks:
  - id: scheduled_shower
    task_id: task_shower
    title: Shower
    start_time: "9:00 AM"
    duration_minutes: 15
    estimate_source: ai
  - id: scheduled_get_dressed
    task_id: task_get_dressed
    title: Get dressed
    start_time: "9:15 AM"
    duration_minutes: 10
    estimate_source: ai
---
```

Recommended body structure:

```markdown
## Top Outcomes

- Ship onboarding flow to staging

## Schedule

- [ ] 9:00 AM Shower (15 min) <!-- task_id: task_shower -->
- [ ] 9:15 AM Get dressed (10 min) <!-- task_id: task_get_dressed -->
- [ ] 9:25 AM Eat breakfast (20 min) <!-- task_id: task_breakfast -->
- [ ] 9:45 AM Finish onboarding flow (60 min) <!-- task_id: task_finish_onboarding -->
```

### Agenda Fields

Required fields:

- `id`
- `type: agenda`
- `date`
- `status`
- `generated_at`
- `scheduled_tasks`

Recommended fields:

- `vault_id`
- `generated_by`
- `model_id`
- `top_outcome_ids`
- `completed_task_ids`
- `created`
- `updated`
- `locked_at`

### Scheduled Task Fields

Required fields:

- `id`
- `task_id`
- `title`
- `start_time`
- `duration_minutes`

Each scheduled task row must be validated before GoalRate reads or writes Agenda markdown. `id`, `task_id`, `title`, and `start_time` must be non-empty strings, `start_time` must be a valid local am/pm time label, and `duration_minutes` must be an integer from 1 through 1440. Invalid rows should make the Agenda file invalid for typed loading or writing rather than being silently skipped or defaulted.

When an existing `agenda/<yyyy-mm-dd>.md` file fails scheduled task validation during read, GoalRate must append the affected vault-relative path and validation message to `logs/errors.md` before surfacing the error. Read-time validation failures must not snapshot, rewrite, or delete the invalid Agenda file.

Recommended fields:

- `date`
- `estimate_source`
- `estimate_confidence`
- `time_zone`
- `notes`

## Current Implementation Notes

- Current Agenda state is stored in `.goalrate/agenda.db` with outcomes, completed task IDs, deferrals, check-ins, chat messages, stats, and revisions.
- Current UI already supports Agenda items, outcomes, checkable tasks, deferrals, and check-ins.
- Target product behavior moves Agenda authority to `agenda/<yyyy-mm-dd>.md`; SQLite may remain as a fast derived index/cache.
- Current Agenda loading reads both frontmatter and the recommended markdown schedule body so checkbox edits in `agenda/<yyyy-mm-dd>.md` can flow back into the app.
- When current Agenda loading reads `agenda/<yyyy-mm-dd>.md`, it should also synchronize the derived `.goalrate/agenda.db` plan row so subsequent completions, deferrals, and Assistant updates start from the markdown state.
- Current prompts already include deferral confrontation and subtask breakdown concepts. This spec formalizes the 2-day task and subtask flows.
- Current UI may need to move from ordered task lists toward exact chronological scheduled task rows.
- Current app includes in-app manual Agenda add, edit, remove, undo, and drag-and-drop reorder controls.
- Current domain logic can classify 2-day missed parent Tasks for subtask breakdown and 2-day missed Subtasks for continuation decisions.
- Current Assistant panel surfaces missed-work attention items and can persist continuation choices through vault-backed commands, then refreshes workspace data after the mutation.

## Acceptance Criteria

- A user can generate today's Agenda from an open vault.
- The generated or edited `agenda/<yyyy-mm-dd>.md` file is the source of truth for that day's plan.
- The generated Agenda records `generated_at` and schedules the first task at that time or the next available Memory-compatible time.
- Agenda tasks are ordered by Eisenhower priority, deadline, fit, and history.
- Tasks marked for one specific day are included on that day's Agenda and excluded from every other day's Agenda.
- Each scheduled task has a concrete am/pm start time and inferred or explicit duration.
- The next task starts when the previous task is expected to finish, unless Memory constraints create a gap.
- Assistant chat changes to Agenda order, start times, durations, or row titles are reflected in the visible Agenda after the response.
- Assistant chat changes that alter the scheduled task set also update the visible Top Outcomes and their linked task IDs.
- Agenda uses Memory constraints to avoid impossible schedules.
- Tasks can be checked off and persisted.
- Deferring a task records a deferral and removes or reschedules it according to user intent.
- A task missed for 2 days triggers subtask breakdown.
- A subtask missed for 2 days triggers the continuation decision flow.
