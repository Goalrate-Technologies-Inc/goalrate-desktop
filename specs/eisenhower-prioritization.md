# Eisenhower Prioritization

## Problem

GoalRate needs a consistent prioritization model so task-level Roadmap and Agenda work can explain why certain work is urgent, scheduled later, delegated, or removed. The Eisenhower Matrix provides the product vocabulary for Task and Subtask classification, while Goals use the simpler Low, Medium, High, and Critical priority scale.

## Goals

- Define Do, Schedule, Delegate, and Delete quadrants.
- Use the same quadrant terminology across Roadmap, Agenda, Assistant, and Memory-aware planning.
- Use consistent color-coded indicators for task-level quadrants in Roadmap.
- Allow each Domain to define urgency and importance thresholds that suit its goals.
- Persist prioritization in markdown frontmatter.
- Make AI prioritization explainable and user-correctable.
- Prevent destructive behavior from happening automatically.

## Non-Goals

- Do not replace all nuanced scoring with only four buckets.
- Do not automatically delete Tasks in the Delete quadrant or Goals that contain Delete-quadrant work.
- Do not require every user to manually classify every task before the app is useful.
- Do not allow users to rename the four quadrant labels. Do, Schedule, Delegate, and Delete are fixed product vocabulary.
- Do not define a public rating/ranking system for Web publishing.

## User Experience

Users see color-coded Goal priority indicators in Roadmap using Low, Medium, High, and Critical. Tasks and Subtasks may use the Eisenhower labels. Agenda may use the task classification for ordering and explanation, but should not show priority dots in task rows. The task labels should be simple:

- Do: urgent and important.
- Schedule: important, not urgent.
- Delegate: urgent, not important for the user to personally do.
- Delete: neither urgent nor important.

The Assistant can explain, "This is in Do because it is urgent and important." Users can override the classification. The Agenda uses the classification to decide what should be done today, scheduled later, delegated, or suggested for removal/archive. In the default automatic classification, urgency comes from the Task/Subtask's own `due_date` or `scheduled_date`, while importance comes from the parent Goal's `priority`. Clear delegation wording can override that default when a Task is really an action for another person, company, app, or service to handle.

## Requirements

### Quadrants

The four quadrant labels are fixed:

- Do.
- Schedule.
- Delegate.
- Delete.

Users may adjust classification, reasons, and supporting notes, but they may not rename the quadrant labels.

The labels and colors are global. The thresholds used to decide whether work is urgent or important may vary by Domain.

`do`

- Meaning: urgent and important.
- Product label: Do.
- Indicator color: red.
- Behavior: include first in today's Agenda when capacity allows.
- Example: a task due today that directly advances an active high-value goal.

`schedule`

- Meaning: important but not urgent.
- Product label: Schedule.
- Indicator color: blue.
- Behavior: plan after Do work, usually at later or lower-pressure scheduled times.
- Example: steady progress toward a meaningful long-term goal.

`delegate`

- Meaning: urgent but not important for the user to personally do.
- Product label: Delegate.
- Indicator color: amber.
- Behavior: show as a delegation action or follow-up, not normal deep work.
- Example: ask another person, app, company, or service to handle it.
- Inference examples: "Get kitchen sink fixed", "Get downstairs toilet repaired", "Call plumber", "Ask vendor for updated quote".

`delete`

- Meaning: neither urgent nor important.
- Product label: Delete.
- Indicator color: gray.
- Behavior: recommend deletion, archive, or deprioritization, but do not auto-delete.
- Example: stale work that no longer supports an active goal.

### Indicator Colors

Priority indicators must use consistent colors across Roadmap and any compact Roadmap task list.

| Quadrant   | Label    | UI color token    |
| ---------- | -------- | ----------------- |
| `do`       | Do       | `semantic-error`  |
| `schedule` | Schedule | `accent-projects` |
| `delegate` | Delegate | `progress-mid`    |
| `delete`   | Delete   | `text-muted`      |

Color must be paired with a `title` attribute and accessible name. Compact Roadmap UI should show the color indicator while exposing the quadrant label through the title/accessible text.

### Classification Inputs

The app or Assistant may use:

- Domain-specific urgency and importance thresholds.
- Task due date.
- Task scheduled date.
- Parent Goal priority.
- Goal lifecycle and status.
- Success metric value.
- Blocker/unblock value.
- Deferral count.
- Recurrence.
- User capacity and limitations from Memory.
- Manual user overrides.

### Domain Thresholds

Each Domain may define thresholds for urgency and importance that fit the goals in that Domain. For example, a Health task due within 1 day may be urgent, while a Startup task due within 7 days may already be urgent because it blocks a launch.

Threshold behavior:

- Domain thresholds should be used when classifying Goals, Tasks, and Subtasks in that Domain.
- If a Domain has no thresholds, GoalRate should use conservative global defaults.
- Manual user overrides beat Domain thresholds.
- Domain thresholds affect classification only; they do not rename quadrants or change quadrant colors.
- The Assistant may propose threshold changes after observing repeated user corrections, but user approval is required before saving them.
- The default global urgency threshold treats a Task/Subtask as urgent when its `due_date` or effective `scheduled_date` is on or within 7 days of the Agenda date.
- The default global importance threshold treats Goals with `critical`, `high`, or `medium` priority as important, and Goals with `low` priority as not important.

Suggested Domain threshold fields:

```yaml
urgency_threshold:
  due_within_days: 7
  overdue_is_urgent: true
  blocker_is_urgent: true
importance_threshold:
  min_goal_priority: high
  requires_success_metric: false
  goal_lifecycle_states:
    - active
```

### Roadmap Behavior

- Each Goal should show a Goal priority indicator using Low, Medium, High, or Critical.
- Roadmap task indicators should use the quadrant label and color.
- Goal priority should be derived from the Goal's `priority` field or explicit user override.
- Domains may summarize how many Goals exist at each Goal priority.
- Delete-quadrant Tasks should be visually de-emphasized and offered for archive/delete review.

### Agenda Behavior

- Do tasks are candidates for today's earliest/highest-energy scheduled times.
- Schedule tasks are candidates after Do tasks or for future dates.
- Delegate tasks should become actions such as "Ask X to..." or "Send request to...", and Agenda rows should visibly flag them as Delegate work.
- Delete tasks should be excluded from normal work blocks unless the user is doing cleanup.
- If capacity is limited, Do tasks win over Schedule tasks.
- If a Delete task keeps recurring or being deferred, the Assistant should ask whether to archive it.
- Agenda task rows should not show compact priority dots; Roadmap is the visual home for priority indicators.

### Assistant Behavior

- The Assistant can classify or reclassify Tasks and Subtasks.
- The Assistant should provide a short reason when assigning or changing a quadrant.
- The Assistant should respect manual user overrides unless asked to reassess.
- The Assistant must ask before archiving or deleting Delete-quadrant work.

### Memory Relationship

Memory affects prioritization by changing feasibility and fit:

- A task requiring high energy should not be placed in a low-energy window when avoidable.
- A task that conflicts with sleep, meals, self-care, or limitations should be rescheduled or broken down.
- User dislikes or limitations may lower fit, but should not automatically make work Delete.

## Public Interfaces / Data Model

### Frontmatter Fields

Tasks and Subtasks may include:

```yaml
eisenhower_quadrant: do
priority: high
priority_color: semantic-error
priority_reason: "Due today and required for MVP launch."
priority_source: ai
priority_updated: "2026-04-25T12:00:00Z"
```

Required target field:

- `eisenhower_quadrant`: one of `do`, `schedule`, `delegate`, `delete`.

Recommended compatibility fields for task-level classification:

- `priority`: one of `critical`, `high`, `medium`, `low`, or current legacy values.
- `priority_color`: optional display token derived from `eisenhower_quadrant`; should use existing UI palette tokens and should not override the canonical quadrant mapping unless the design system intentionally changes tokens.
- `priority_reason`
- `priority_source`: `user`, `ai`, `import`, or `default`.
- `priority_updated`

### Legacy Priority Mapping

When a Task or Subtask only has legacy priority:

| Legacy value | Default quadrant |
| ------------ | ---------------- |
| Goal priority | Urgent Task default | Not-urgent Task default |
| ------------- | ------------------- | ----------------------- |
| `critical`    | `do`                | `schedule`              |
| `high`        | `do`                | `schedule`              |
| `medium`      | `do`                | `schedule`              |
| `low`         | `delegate`          | `delete`                |

Urgency is determined from the Task/Subtask's own deadline or scheduled date, not the Goal deadline. Importance is determined from the parent Goal's priority, not from a task-level priority field.

### Domain Threshold Frontmatter

Domain files may include:

```yaml
urgency_threshold:
  due_within_days: 7
  overdue_is_urgent: true
  blocker_is_urgent: true
importance_threshold:
  min_goal_priority: high
  requires_success_metric: false
  goal_lifecycle_states:
    - active
```

### Matrix Markdown

Suggested file: `eisenhower-matrix.md`

```yaml
---
id: eisenhower_matrix
type: eisenhower_matrix
version: 1
last_updated: "2026-04-25T12:00:00Z"
---
```

Recommended body:

```markdown
## Do

Urgent and important work to complete immediately.

## Schedule

Important but not urgent work to plan after Do tasks.

## Delegate

Urgent but not important work the user should delegate.

## Delete

Neither urgent nor important work to delete, archive, or stop planning.
```

## Current Implementation Notes

- Current implementation has Goal `priority` fields with values such as critical, high, medium, and low.
- Current roadmap sidebar can show priority indicators.
- Current Agenda Assistant prompt orders by priority and deadline and is being migrated toward storing the four-quadrant model in metadata.
- This spec keeps `eisenhower_quadrant` as the target structured field for Tasks and Subtasks while preserving compatibility with existing Goal `priority`.
- This spec also standardizes quadrant colors against the existing app UI palette; existing priority UI should migrate to the shared color mapping.
- Current heuristic Agenda ordering derives each task quadrant from task date urgency and parent Goal priority, then orders by quadrant.
- Current implementation reads optional Domain metadata for `urgency_threshold.due_within_days` and `importance_threshold.min_goal_priority` when deriving Task/Subtask quadrants, with conservative global defaults when no Domain metadata exists.

## Acceptance Criteria

- Task and Subtask markdown can store an Eisenhower quadrant.
- Roadmap displays Goal priority using Low, Medium, High, and Critical labels, and task-level priority using the quadrant label and color when available.
- Domain-specific thresholds influence urgency and importance classification.
- Agenda ordering uses Do, Schedule, Delegate, Delete in that order.
- Delegate and Delete behavior is distinct from normal task completion.
- The Assistant can explain and revise prioritization.
- Roadmap priority indicators remain understandable without relying on color alone.
- Delete-quadrant work is never destructively removed without user confirmation.
