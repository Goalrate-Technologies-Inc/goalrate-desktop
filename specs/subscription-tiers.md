# Subscription Tiers

## Problem

GoalRate needs a simple subscription hierarchy that explains what users get at each step without blurring local-first use, basic publishing, AI, sync, advanced publishing, and collaboration.

## Goals

- Keep the local-first core app free.
- Include basic publishing in Free so the website can grow through public user pages.
- Present AI as the first paid upgrade.
- Keep sync, advanced publishing, and collaboration out of launch purchase surfaces until they are implemented.
- Use the same tier names and feature assignments in pricing, onboarding, upgrade prompts, and plan comparisons.

## Non-Goals

- Do not define exact prices in this spec.
- Do not add Enterprise, Business, Team, or custom tiers.
- Do not gate all publishing behind a paid tier.
- Do not imply post-launch publishing, sync, collaboration, Pro, or Premium features are available in any launch channel before they are implemented.

## Tier Progression

At launch, users move from Free to Plus when they want hosted AI. Sync, advanced publishing, and collaboration remain future product strategy rather than purchasable tiers.

## Channel Availability

The main Mac desktop app launches through direct website download and Stripe billing. iOS and iPadOS apps launch through the App Store when their mobile scope is ready.

In the initial direct Mac channel, only implemented features should be product-facing:

| Feature | Free | Plus |
| --- | --- | --- |
| Local Roadmap | Yes | Yes |
| Local Agenda and manual planning | Yes | Yes |
| Vault creation, recovery, and markdown storage | Yes | Yes |
| Manual goals and tasks | Yes | Yes |
| AI Agenda generation and Assistant | - | Yes |
| AI task breakdown and prioritization | - | Yes |
| Publishing | Post-launch | Post-launch |
| Sync | Post-launch | Post-launch |
| Collaboration | Post-launch | Post-launch |

Initial upgrade copy should say `Upgrade to GoalRate Plus for AI planning.` It should not advertise Pro, Premium, publishing, sync, or collaboration as available purchase options until those surfaces are implemented.

iOS and iPadOS should use the same plan names and feature assignments, but purchase and restore UX must follow current App Store rules. Mobile App Store transactions and Stripe subscriptions should map to the same product-facing plan identifiers.

The long-term tier progression below is reserved for product direction once those surfaces are implemented. It must not appear as launch pricing, onboarding, upgrade prompts, purchase actions, or plan comparisons.

| Tier    | Meaning                    | Included feature step                                                                 | Launch copy posture                   |
| ------- | -------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------- |
| Free    | Local core + basic publishing | Local vault, Roadmap, manual goals/tasks, local markdown storage, core Agenda workflow, basic public profile/page, GoalRate-branded basic publishing | Start free with the local core and a public GoalRate page. |
| Plus    | AI features                | Free features, plus Assistant, AI planning, AI task breakdown, prioritization, and Memory use | Upgrade to Plus for AI planning.      |
| Pro     | Sync + advanced publishing | Plus features, plus sync across the user's devices, advanced publishing features, richer pages, analytics, custom themes, and verified user badges | Reserved for future work; do not show at launch. |
| Premium | Collaboration / multi-user | Pro features, plus shared spaces, collaborators, roles, permissions, and activity | Reserved for future work; do not show at launch. |

## Feature Matrix

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

## Copy Guidelines

- Launch plan comparisons should list only Free and Plus.
- Describe Free as the local-first core app, not a trial.
- Describe Plus as the first paid upgrade and the AI tier.
- Do not show Pro, Premium, Team, sync, publishing, or collaboration purchase prompts in production launch copy.
- If a future feature placeholder is unavoidable, describe it as not available in this release and provide no purchase action.

## Rationale

Users get the local-first core app for free, then upgrade to Plus when they need hosted AI. Future phases can extend the ladder once their product surfaces are real.

## Current Implementation Notes

- Product-facing launch identifiers should be `free` and `plus`; `pro` and `premium` remain reserved future identifiers.
- The initial direct Mac entitlement matrix is limited to `free` and `plus`; Plus unlocks AI and does not unlock publishing, sync, or collaboration.
- Stripe subscription state should be the source for direct Mac paid entitlements.
- Production desktop AI must route through GoalRate hosted AI, and the Tauri backend must verify an active Stripe-backed Plus entitlement before making a hosted AI request.
- Hosted AI uses GoalRate-owned model route IDs so the service can apply model routing and fair-use limits. If the primary hosted model route is unavailable, the desktop backend should retry once with the hosted backfill route, but it must not retry around entitlement or fair-use-limit failures.
- Mobile App Store transactions should be mapped into the same entitlement model when iOS/iPadOS apps launch.
- `enterprise` should not appear in product-facing pricing, onboarding, upgrade prompts, or plan comparisons unless a future spec adds it.
- Existing references to Team should be removed from production copy.
- Existing references to Premium-only publishing should split into Free basic publishing and Pro/Premium advanced publishing.
