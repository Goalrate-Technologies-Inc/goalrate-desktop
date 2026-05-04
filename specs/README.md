# GoalRate Desktop Specs

This directory contains living product specs and PRD-style implementation notes for the GoalRate desktop app. Specs should describe the intended product behavior clearly enough that an engineer can implement or revise the feature without re-deciding product intent.

## Spec Index

- [Desktop App Overview](desktop-app-overview.md): app shell, onboarding, vault selection, primary panels, and license posture.
- [Apple Platform Distribution](apple-platform-distribution.md): direct Mac distribution, Stripe billing, iOS/iPadOS App Store posture, and entitlement mapping.
- [Vault Markdown Storage](vault-markdown-storage.md): local vault structure, markdown compatibility, privacy model, and vault CRUD behavior.
- [Roadmap, Goals, Domains, Tasks](roadmap-goals-domains.md): roadmap data model, lifecycle states, task/subtask behavior, and entity frontmatter.
- [Agenda Daily Planning](agenda-daily-planning.md): AI-generated daily timelines with am/pm task start times, task completion, deferrals, and check-ins.
- [Assistant and Memory](assistant-memory.md): AI assistant responsibilities, persistent user memory, consent, and contextual updates.
- [Eisenhower Prioritization](eisenhower-prioritization.md): Do/Schedule/Delegate/Delete prioritization and how it drives Roadmap and Agenda behavior.
- [Subscription Tiers](subscription-tiers.md): Free and Plus launch hierarchy, with future tiers reserved until their features are implemented.
- [Monetization Strategy Research](monetization-strategy.md): pricing research, AI cost posture, launch sequence, and recommended monetization model.
- [Authentication, Billing, and Entitlements](auth-billing-entitlements.md): WorkOS AuthKit, Stripe Billing, backend-owned entitlements, desktop sign-in, and the Premium organization path.

## Conventions

- Use one spec per feature, workflow, or decision area.
- Use descriptive kebab-case filenames such as `daily-planning-flow.md`.
- Keep specs as living documents. Update the relevant spec when product behavior materially changes.
- Prefer product vocabulary in specs. In particular, use `Goal` and `Domain` even if current implementation code still contains legacy/internal names such as `Objective` or `goal_type`.
- Treat advanced web publishing as a future Pro/Premium feature unless a dedicated publishing spec is added.
- Keep markdown-readable vault data interoperable with tools such as Obsidian and Notion. App-managed indexes, caches, and secrets may use non-markdown storage when needed.

## Common Sections

Most specs should include:

- Problem
- Goals
- Non-Goals
- User Experience
- Requirements
- Public Interfaces / Data Model, when the feature stores or exchanges structured data
- Current Implementation Notes, when useful
- Open Questions

## Documentation Checklist

Before considering a spec implementation-ready:

- The desired user-visible behavior is explicit.
- Required data fields, statuses, and state transitions are named.
- Destructive behavior requires clear user intent.
- AI-generated behavior identifies the inputs it may use and where output is persisted.
- Known gaps between the target spec and current implementation are called out instead of silently papered over.
