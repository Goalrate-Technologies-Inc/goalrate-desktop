# GoalRate Desktop — Technical Specification

## 1. Stack

* Tauri
* React + TypeScript
* Zustand (state)
* Local filesystem (Markdown)
* AI APIs (OpenAI / Anthropic)

---

## 2. Architecture

```
UI (React)
  ↓
State Layer
  ↓
Agent Layer
  ↓
Vault (Markdown Files)
```

---

## 3. Modules

### 3.1 Vault Manager

Responsibilities:

* Read/write Markdown
* Parse YAML frontmatter
* Validate schema

APIs:

```
getGoals()
getTasks()
saveFile(file)
deleteFile(file)
```

---

### 3.2 Domain Models

```
Goal
Task
DailyAgenda
VaultFile
AgentMutationLog
```

---

### 3.3 Agent System

#### GoalAgent

* Validates goals
* Pushes back on unrealistic inputs

#### PlanningAgent

* Generates daily plan
* Reorders priorities
* Handles failure loops

#### VaultMutationAgent

* Writes changes to vault
* Logs all mutations
* Uses `assistant` as the actor for Assistant-originated writes
* Validates frontmatter before write
* Returns validation errors without snapshotting, writing, or logging invalid markdown
* Snapshots current markdown before replacing an existing file
* Writes serialized Markdown with YAML frontmatter, not derived database rows

---

### 3.4 Agenda Engine

Steps:

1. Load active goals
2. Load pending tasks
3. Score tasks:

   * urgency
   * importance
   * recency
4. Sort
5. Group by context
6. Limit to 3–7 tasks

---

### 3.5 State Shape

```ts
{
  goals: Goal[]
  tasks: Task[]
  todayPlan: Task[]
  activeContext: Goal | Task | null
}
```

---

### 3.6 File Rules

All files:

* Must include `id`
* Must include `created_at`
* Must have valid YAML

Invalid files:

* Ignored
* Logged to `/logs/errors.md`

---

### 3.7 Undo System

* In-memory stack
* Snapshot before write
* Max depth: 50

---

### 3.8 Autosave

* Trigger on edit or AI mutation
* Debounced (300ms)
* A completed save must only mark content clean if the local editor value has not changed since that save began
* If content changes while a save is in flight, the latest local value remains dirty and is saved by the next debounce cycle
* Autosave must not dismiss the current editing surface; closing an editor requires an explicit user action

---

## 4. AI Integration

### Capabilities

* Read vault
* Write vault
* Generate tasks
* Restructure goals

### Guardrails

* No deletes without confirmation
* Validate schema before write
* Log all mutations
* Attribute Assistant-originated vault writes as `assistant` in mutation logs

---

## 5. Error Handling

* File errors → fallback UI
* AI errors → retry + fallback logic
* Corrupt files → quarantine

---

## 6. Performance

* Load < 1s
* Agenda < 2s
* File ops < 100ms

---

## 7. Security

* Local-only data
* Secure API key storage via Tauri

---

## 8. Extensibility

Future:

* Cloud sync
* Social layer
* Integrations
* Plugins

---

## 9. Developer Experience

* Strict TypeScript
* ESLint + Prettier
* Modular agents

---

## 10. Testing

* Unit: vault + agenda
* Integration: agent → vault
* Manual: onboarding + daily flow
