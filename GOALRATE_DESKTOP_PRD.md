# GoalRate Desktop — Product Requirements Document (Living)

## 1. Overview

GoalRate Desktop is a **local-first productivity system with paid upgrades for AI, sync, publishing, and collaboration** that:

* Converts goals into actionable daily plans
* Adapts dynamically based on user behavior
* Provides AI coaching, accountability, and restructuring on Plus and above
* Stores all data as local Markdown files

Primary audience:

* Solo founders
* Builders
* High-agency individuals

Core philosophy:

* Local-first
* AI-assisted on paid tiers
* Execution-first
* Reality-aware (pushes back on unrealistic goals)
* Low friction

### Distribution Strategy

GoalRate should use a Notion-like channel split:

| Platform | Primary distribution | Billing path | Notes |
| ---- | -------------------- | ------------ | ----- |
| macOS desktop | Direct download from the GoalRate website | Stripe Checkout and Stripe Billing | Main Mac app is signed with Developer ID, notarized, and distributed outside the Mac App Store. |
| iOS and iPadOS | Apple App Store | StoreKit/In-App Purchase where required by App Store rules, with Stripe web billing still available for direct web customers where compliant | Mobile apps use the same plan names and entitlement model, but App Store purchase UX must stay review-safe by storefront. |

The initial Mac launch should not submit the main desktop app to the Mac App Store. The desktop product UI can route paid upgrades to GoalRate-owned web checkout, while the iOS/iPadOS apps must follow current App Store purchase, restore, disclosure, and external-link rules.

---

## 2. Core Product Principles

1. **Local-first**

   * All data stored in Markdown files
   * No backend required for desktop

2. **AI as executor on Plus and above**

   * Reads, writes, restructures data
   * Makes decisions, not just suggestions

3. **Daily clarity**

   * Always answer: “What should I do today?”

4. **Failure handling**

   * Reschedule
   * Break down
   * Coach
   * Archive

5. **Private-first**

   * Publishing is opt-in
   * Basic publishing is available on Free and higher to support public web growth
   * Advanced publishing is available on Pro and Premium

---

## 3. Core Features

### 3.1 Vault System

```
/vault/
  goals/
  tasks/
  logs/
  system/
```

* Markdown files with YAML frontmatter
* Source of truth for all data

---

### 3.2 Goal System

Each goal:

* One objective
* Multiple key results

Example:

```md
---
id: goal_123
title: Launch MVP
status: active
created_at: 2026-04-26
---

## Objective
Launch GoalRate MVP

## Key Results
- Ship desktop app
- Acquire 10 users
```

---

### 3.3 Task System

Atomic units of work.

```md
---
id: task_456
goal_id: goal_123
title: Implement onboarding
status: pending
priority: high
scheduled_for: 2026-04-27
---

## Notes
...
```

---

### 3.4 Daily Agenda (Free Core, AI on Plus and Higher)

On app open:

```
TODAY PLAN:
- Task A
- Task B
- Task C
```

Built from:

* Goals
* Tasks
* History
* Deadlines
* Behavior

Free supports the local Agenda workflow. Plus and higher add AI generation, prioritization, and rescheduling.

---

### 3.5 AI Coaching Loop (Plus and Higher)

On repeated failure:

1. Reschedule
2. Break down
3. Ask clarification
4. Suggest alternative
5. Archive

---

### 3.6 Editing System

User:

* Create/edit goals
* Create/edit tasks

AI on Plus and above:

* Modify Markdown safely
* Maintain structure

---

### 3.7 Undo + Autosave

* Autosave on change
* Undo stack in memory
* Optional snapshot logs

---

## 4. User Flows

### First Launch

* Create vault
* Initialize structure
* Create sample goal

### Daily Use

1. Open app
2. Review or generate agenda
3. Execute tasks
4. Mark complete
5. Update system

### Failure Flow

* Plus and higher can use AI coaching after repeated misses

---

## 5. Subscription Tiers

Plan order: Free, Plus, Pro, Premium.

The table below is the long-term product ladder. It should stay consistent across Stripe billing, desktop entitlement state, mobile App Store entitlement mapping, onboarding, upgrade prompts, and plan comparisons.

| Tier    | Meaning                    | Feature step                                                               | Upgrade copy                          |
| ------- | -------------------------- | -------------------------------------------------------------------------- | ------------------------------------- |
| Free    | Local core + basic publishing | Local vault, Roadmap, manual goals/tasks, local markdown storage, Agenda, basic public profile/page, GoalRate-branded basic publishing | Start free with the local core and a public GoalRate page. |
| Plus    | AI features                | Free features, plus Assistant, AI planning, task breakdown, prioritization, and Memory use | Upgrade to Plus for AI planning.      |
| Pro     | Sync + advanced publishing | Plus features, plus sync across the user's mobile and desktop devices, advanced publishing features, richer pages, analytics, custom themes, and verified user badges | Upgrade to Pro for sync and advanced publishing. |
| Premium | Collaboration / multi-user | Pro features, plus shared spaces, collaborators, roles, permissions, and activity | Upgrade to Premium for collaboration. |

Feature availability:

| Feature                         | Free | Plus | Pro | Premium |
| ------------------------------- | ---- | ---- | --- | ------- |
| Local-first core app            | Yes  | Yes  | Yes | Yes     |
| Manual goals, tasks, and Agenda | Yes  | Yes  | Yes | Yes     |
| Basic publishing                | Yes  | Yes  | Yes | Yes     |
| AI planning and Assistant       | -    | Yes  | Yes | Yes     |
| Mobile sync                     | -    | -    | Yes | Yes     |
| Advanced publishing             | -    | -    | Yes | Yes     |
| Verified user badges            | -    | -    | Yes | Yes     |
| Collaboration and multi-user    | -    | -    | -   | Yes     |

Tier rules:

* Free is the local-first core app, not a trial.
* Plus is the first paid upgrade and the AI tier.
* Pro is the sync and advanced publishing tier.
* Premium is the collaboration and multi-user tier.
* Product-facing plan identifiers are `free`, `plus`, `pro`, and `premium`.
* Upgrade prompts should use: `Advanced publishing requires Pro or Premium.`, `Sync requires Pro or Premium.`, and `Collaboration requires Premium.`

Users get the local-first core app and basic publishing for free, then upgrade by need: AI, sync and advanced publishing, and collaboration.

---

## 6. Non-Goals (v1)

* No social features
* No mobile app behavior in the Free local-first desktop core
* No collaboration outside the Premium tier
* No Mac App Store submission for the main desktop app in the initial launch
* No iOS/iPadOS external Stripe checkout flow unless the current App Store rules and required entitlements allow it for the target storefront
* No BYO API key UI in production paid channels; paid AI must use GoalRate-hosted routing

---

## 7. Success Metrics

* Daily usage
* Task completion rate
* Goal completion rate
* Retention (7/30 day)

---

## 8. Constraints

* Must work offline
* Must not corrupt files
* Must be deterministic where needed
