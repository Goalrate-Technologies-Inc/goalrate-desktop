# Monetization Strategy Research

Research date: 2026-04-27

## Problem

GoalRate needs a monetization model that preserves the local-first promise while funding AI, sync, publishing, collaboration, billing, support, and ongoing desktop maintenance.

The current subscription hierarchy is clear: Free, Plus, Pro, Premium. What is missing is the pricing, the AI usage posture, and the launch sequencing that makes the hierarchy sustainable.

## Recommendation

Use a freemium local-core strategy, but do not make hosted AI unlimited.

Recommended launch positioning:

- Free: permanent local-first desktop core plus basic publishing.
- Plus: everything in Free, plus hosted AI planning, Assistant, task breakdown, Memory-aware coaching, and structured writes.
- Pro: everything in Plus, plus sync, advanced publishing, richer public pages, analytics, custom themes, and verified user badges.
- Premium: everything in Pro, plus collaboration, shared spaces, roles, permissions, and activity.

Recommended public pricing:

| Tier | Monthly | Annual | Pricing logic |
| --- | ---: | ---: | --- |
| Free | $0 | $0 | Trust, distribution, local-first credibility. |
| Plus | $15/mo | $144/yr | AI planning should sit above Todoist Pro but below premium daily planners. |
| Pro | $25/mo | $240/yr | Plus plus sync and serious publishing, priced for high-agency individual users. |
| Premium | $35/seat/mo | $336/seat/yr | Collaboration and admin value, minimum 2 seats once collaboration is ready. |

This is intentionally simple. It uses whole-dollar pricing, a consistent 20% annual discount, and a clear cumulative upgrade ladder by job-to-be-done: AI, sync, publish, collaborate.

## Stripe Price IDs

Stripe price IDs are not secrets, but they are environment-specific billing configuration. The backend should use these IDs when creating Checkout sessions for the corresponding plan and billing cycle.

| Plan | Billing cycle | Public price | Stripe price ID |
| --- | --- | ---: | --- |
| Plus | Monthly | $15/mo | `price_1SwxgpHDHulOaqtOLdXquCQh` |
| Plus | Yearly | $144/yr | `price_1SwxhLHDHulOaqtONExSUqt2` |
| Pro | Monthly | $25/mo | `price_1SwxeVHDHulOaqtOn2GwhoaT` |
| Pro | Yearly | $240/yr | `price_1SwxgPHDHulOaqtOkxlLaIEv` |
| Premium | Monthly | $35/seat/mo | `price_1TR1NGHDHulOaqtODBondBWS` |
| Premium | Yearly | $336/seat/yr | `price_1TR1PRHDHulOaqtOvQXUg2q4` |

## Resolved Strategy Decisions

- AI is only available on paid tiers: Plus, Pro, and Premium.
- GoalRate will not offer BYO API keys. Users pay for GoalRate-hosted AI through paid plans.
- Do not offer a free hosted AI trial in the initial paid launch. Users should subscribe to Plus or higher to use AI.
- Annual plans should receive a consistent 20% discount from monthly pricing.
- Basic publishing is available on Free and higher so the website can become a growth and retention surface.
- Tiers are cumulative: Free includes basic publishing; Plus adds AI; Pro adds sync and advanced publishing; Premium adds collaboration.
- Remove the Team tier. Premium is the collaboration tier.
- Sync is available in Pro and Premium only.
- AI context caching should be privacy-preserving: cache stable non-sensitive prompt scaffolding and provider-supported reusable context where it does not weaken consent, but do not persist raw Memory or full vault payloads as a hidden cache.
- The main Mac app should be distributed directly from the GoalRate website, signed with Developer ID, notarized, and billed through Stripe.
- iOS and iPadOS apps should be distributed through the App Store and must use StoreKit/In-App Purchase or an Apple-approved external purchase flow where current storefront rules require it.

## Current Product Context

The existing product direction supports a freemium local core:

- `README.md` describes GoalRate as an offline-first desktop app with a local markdown vault and an AI-driven daily loop.
- `GOALRATE_DESKTOP_PRD.md` positions paid upgrades around AI, sync, publishing, and collaboration.
- [subscription-tiers.md](subscription-tiers.md) already defines the tier order and feature steps.
- [desktop-app-overview.md](desktop-app-overview.md) keeps the desktop app local-first and markdown-first.
- [apple-platform-distribution.md](apple-platform-distribution.md) sets the channel split: direct Mac distribution through the website and Stripe, with iOS/iPadOS distributed through the App Store.
- [assistant-memory.md](assistant-memory.md) makes remote AI context consent-aware and privacy-sensitive.

The current implementation also creates an important monetization choice:

- The desktop app currently contains OpenAI and Anthropic keychain integrations, but the target monetization strategy should remove BYO API key UX before paid AI launch.
- `apps/desktop/src/lib/dailyLoopIpc.ts` currently defaults AI calls to an Anthropic Sonnet model.
- `crates/daily-loop/src/context.rs` allows up to 15,000 estimated context tokens for Agenda generation.

That means a hosted Plus plan needs routing, limits, or credits before launch. If GoalRate simply absorbs all Sonnet usage inside a flat subscription, heavy users can become margin-negative.

## Market Reference Points

### Adjacent Pricing

| Product | Current pricing signal | Takeaway for GoalRate |
| --- | --- | --- |
| [Todoist](https://www.todoist.com/help/articles/todoist-pricing-and-plans-update-2025-everything-you-need-to-know-Tn6Pg1JKI) | Free core, Pro moving to $7/mo or $60/yr, Business to $10/user/mo or $96/user/yr. | Commodity task management anchors low. GoalRate should not compete here on price alone. |
| [Obsidian](https://obsidian.md/pricing) | Free local app, Sync $5/mo or $4/mo annually, Publish $10/mo or $8/mo annually. | Best local-first analogue. Paid cloud services can fund a free markdown-first core. |
| [Sunsama](https://www.sunsama.com/pricing) | $25/mo monthly or $20/mo billed yearly, 14-day trial, no free forever plan. | Premium daily planning can command $20-25/mo when the workflow feels essential. |
| [Akiflow](https://akiflow.com/pricing) | $34/mo monthly or $19/mo billed yearly, AI assistant included. | High-agency professionals accept premium pricing when the product claims time savings. |
| [Motion](https://www.usemotion.com/pricing) | Pro AI $19/seat/mo annually, Business AI $29/seat/mo annually, explicit AI credit allowances. | AI-heavy planning products are moving toward visible usage allowances. |
| [Reclaim](https://reclaim.ai/pricing) | Free tier, yearly Starter $10/seat/mo, Business $15/seat/mo, Enterprise $22/seat/mo; monthly Starter and Business are higher. | Calendar automation supports a freemium plus seat-based team ladder. |
| [Notion](https://www.notion.com/pricing) | Free and Plus have trial AI, Business is $20/member/mo with core AI included, Custom Agents use additional credits. | Broad productivity suites are bundling core AI into higher tiers and metering agentic work separately. |

### Subscription Benchmarks

RevenueCat's [State of Subscription Apps 2026](https://www.revenuecat.com/state-of-subscription-apps-2026-productivity/) reports that AI apps monetize better early but retain worse: AI apps show higher revenue per payer, but materially weaker 12-month retention and higher refund rates than non-AI apps.

Implication: GoalRate should sell the durable daily planning habit, not just "AI." AI may convert users, but retention has to come from a daily workflow that repeatedly answers: what should I do today?

### Platform And Billing Costs

Useful cost references:

- [OpenAI API pricing](https://openai.com/api/pricing/) lists GPT-5.4 mini at $0.75 per 1M input tokens and $4.50 per 1M output tokens, with higher frontier models costing much more.
- [Anthropic API pricing](https://platform.claude.com/docs/en/about-claude/pricing) lists Claude Sonnet 4.5 and 4.6 at $3 per 1M input tokens and $15 per 1M output tokens.
- [Stripe pricing](https://stripe.com/pricing) lists standard US card processing at 2.9% plus $0.30 per successful domestic card transaction. Stripe Billing adds 0.7% of billing volume on pay-as-you-go.
- [Apple App Store Small Business Program](https://developer.apple.com/app-store/small-business-program/) offers a 15% commission for qualifying developers up to $1M in prior-year proceeds.

Implication: Direct web checkout should be the primary billing path for the Mac app. App Store economics and subscription policy constraints still matter for iOS/iPadOS, and for any future Mac App Store decision, but they should not drive the first Mac launch.

## AI Unit Economics

Assumptions for hosted AI cost estimates:

- Light user: 3 AI calls/day, 6k input tokens and 800 output tokens per call.
- Normal user: 8 AI calls/day, 8k input tokens and 1.2k output tokens per call.
- Heavy user: 20 AI calls/day, 12k input tokens and 1.8k output tokens per call.
- 30 active days per month.

Estimated model costs:

| Scenario | Claude Sonnet 4.5 | Claude Haiku 4.5 | GPT-5.4 mini |
| --- | ---: | ---: | ---: |
| Light | $2.70/mo | $0.90/mo | $0.73/mo |
| Normal | $10.08/mo | $3.36/mo | $2.74/mo |
| Heavy | $37.80/mo | $12.60/mo | $10.26/mo |

At $15/mo Plus:

- Direct Stripe monthly net is roughly $14.09 before AI COGS using 2.9% + $0.30 + 0.7% Billing.
- App Store small-business net is roughly $12.75 before AI COGS for mobile App Store purchases or any future App Store channel.
- A normal user on GPT-5.4 mini leaves healthy margin.
- A normal user on Claude Sonnet leaves weak margin.
- A heavy user on any hosted model needs limits, routing, or overage handling.

Recommended AI posture:

- Use a cheaper default model for routine planning and chat.
- Reserve Sonnet or frontier models for explicit "higher quality" operations.
- Cache stable non-sensitive schema, prompt, and consent-compatible context where provider APIs support it.
- Do not persist raw Memory, raw vault content, or complete remote AI payloads as a hidden cache.
- Do not expose BYO API key setup in Free or paid tiers.
- Show user-facing allowances in product language, not raw tokens.

Suggested Plus allowance copy:

> Includes daily AI planning, Assistant chat, task breakdowns, and Memory-aware coaching with fair-use limits. Heavy users can add AI credits when they need more capacity.

Avoid "unlimited AI" unless GoalRate has hard internal model routing and abuse controls.

## Packaging Details

### Free

Free should be genuinely useful:

- Local markdown vault.
- Roadmap.
- Manual goals and tasks.
- Manual Agenda workflow.
- Basic publishing to a GoalRate-branded public page.
- Public profile/username for discovery and sharing.
- Local deterministic suggestions where possible.
- Vault recovery and readable markdown storage.
- Export, since the vault is already local markdown.

Free should not include GoalRate-hosted AI, BYO API key AI, or a hosted AI trial. The default free promise is local core plus basic public presence, not a free AI product.

### Plus

Plus is the first monetization engine:

- Everything in Free.
- Hosted AI Agenda generation.
- Assistant chat that can update today's Agenda.
- AI task breakdown.
- AI prioritization.
- Memory-aware planning, with remote Memory context still consent-gated.
- End-of-day summary and recurring pattern detection.

Recommended price: $15/mo or $144/yr.

Why this price:

- It is above Todoist Pro, because GoalRate is not just a task list.
- It is below Sunsama, Akiflow, and Motion premium pricing, which lowers switching friction.
- It has enough margin for normal GPT-5.4 mini usage.

### Pro

Pro is the serious individual workflow tier:

- Everything in Plus.
- Mobile sync.
- Desktop to mobile sync.
- Version history for synced state.
- Advanced publishing features.
- Richer public pages.
- Publishing analytics.
- Custom themes.
- Verified user badges.
- Larger AI allowance than Plus.

Recommended price: $25/mo or $240/yr.

Launch condition: do not sell Pro until sync is real, reliable, and supportable. Sync creates trust debt quickly if it corrupts or duplicates local-first data. Basic publishing can launch earlier in Free; advanced publishing should wait until it clearly adds value beyond the free website growth loop.

### Premium

Premium is the collaboration tier:

- Everything in Pro.
- Shared spaces.
- Collaborators.
- Roles and permissions.
- Activity.
- Shared vault or encrypted collaboration storage.
- Central billing.
- Admin controls.

Recommended price: $35/seat/mo or $336/seat/yr, with a 2-seat minimum once collaboration is ready.

Launch condition: wait until collaboration is safe and the support surface is understood. The BUSL license already distinguishes one-person local production use from multi-user organizational production use, so Premium should also function as the clean commercial-license path for organizations.

## Credits And Fair Use

Use credits only where they improve trust:

- Good: visible monthly "AI operations" allowance, reset monthly, with optional add-on credits.
- Good: "Higher-quality model requests" consume more allowance.
- Bad: opaque token credits that users cannot map to value.
- Bad: surprise overage bills for individual productivity users.

Recommended internal meter:

| Operation | Suggested included usage |
| --- | --- |
| Daily Agenda generation | 1-3/day on Plus, higher on Pro and above. |
| Assistant chat | Soft cap by rolling message count and monthly model cost. |
| Task breakdown | Generous, because outputs are short and highly valuable. |
| Full vault re-analysis | Limited, because input context can be large. |
| Higher-quality model retry | Limited or credit-consuming. |

Expose this as "fair-use AI included" rather than as raw token math. Show warnings only when someone is clearly approaching limits.

## Distribution Strategy

Use a Notion-like channel split:

- Main Mac desktop app: direct download from the GoalRate website, signed with Developer ID, notarized, and billed through Stripe.
- iOS and iPadOS apps: distributed through the App Store, with StoreKit/In-App Purchase or Apple-approved external purchase flows where required by current storefront rules.

Direct Mac distribution should be the primary monetization route because it:

- Allows Stripe Checkout, Stripe Billing, and Stripe Customer Portal as the default paid upgrade path.
- Supports faster pricing experiments.
- Makes it easier to offer annual plans, coupons, collaboration invoices, and founder offers.
- Reduces commission exposure on the main desktop product.
- Keeps the Mac app outside Mac App Store sandbox and subscription constraints while still allowing a safe, signed, notarized installer.

The direct Mac app must still earn user trust:

- Ship Developer ID-signed and notarized builds.
- Provide clear download, privacy, terms, support, and update messaging on the website.
- Keep vault access explicit and local-first even though the app is not forced into the Mac App Store sandbox.

Do not offer materially different feature names or confusing plan identities by channel. Stripe and App Store transactions should map to the same product-facing plan identifiers: `free`, `plus`, `pro`, and `premium`.

## Mobile App Store Monetization Slice

iOS and iPadOS apps should use the App Store for distribution. For those apps:

- Product-facing plan names remain Free, Plus, Pro, and Premium.
- Mobile purchase, restore, cancellation, disclosure, and entitlement UX must be compliant with current App Store rules for each storefront.
- StoreKit subscriptions should map into the same backend entitlement model as Stripe subscriptions.
- Stripe web subscriptions may grant account entitlements across devices where App Store rules allow existing account access, but the mobile app must not rely on a website-only paid flow if that creates App Review risk.
- The first mobile submission should expose only implemented, reviewable features. Do not create inert upgrade buttons for Pro, Premium, sync, publishing, or collaboration before those features are real.
- BYO provider-key UI is not part of production paid AI on any channel.
- Hosted AI must be live for App Review if paid AI is visible in the mobile app. The app should not rely on placeholder providers, local mock mode, or user-provided keys.

An App Store subscription screen must show product name, auto-renewal duration, localized App Store price, included benefits, Restore Purchases, Manage Subscription, Terms of Use, and Privacy Policy before or near purchase actions.

## Launch Sequence

### Phase 0.5: Direct Mac Free + Plus AI

Goal: launch the main Mac app from the GoalRate website with Stripe billing before higher tiers.

- Launch Free and Plus only.
- Keep local-first Roadmap, Agenda, vault, markdown storage, and manual workflows free.
- Require Plus for hosted AI.
- Route paid upgrades through Stripe Checkout.
- Use Stripe subscription state and backend entitlements to authorize hosted AI.
- Sign and notarize the Mac build with Developer ID.
- Hide provider-key UI, sync, collaboration, Pro, and Premium.

### Phase 1: Free Publishing + Paid AI, Direct Billing

Goal: validate the website growth loop and willingness to pay for the core AI daily loop.

- Launch Free and Plus only.
- Include basic publishing in Free and Plus.
- Require Plus subscription for hosted AI.
- Route AI through cost-controlled hosted models.
- Remove BYO API key setup from the paid AI strategy.
- Measure activation and AI COGS before launching higher tiers.

### Phase 1.5: iOS/iPadOS App Store Companion

Goal: add mobile reach without compromising App Review compliance or local-first trust.

- Distribute iOS and iPadOS apps through the App Store.
- Support account sign-in and entitlement recognition across Stripe and App Store purchases where permitted.
- Use StoreKit for mobile subscription purchase and restore flows where required.
- Keep the mobile feature set reviewable and honest; do not advertise sync, Pro, Premium, publishing, or collaboration until those surfaces are implemented.
- Confirm current storefront-specific purchase-link rules before adding any in-app Stripe checkout link or external purchase call to action.

### Phase 2: Sync + Advanced Publishing

Goal: sell continuity and a more serious public presence without breaking local-first trust.

- Launch Pro only after desktop and mobile sync are dependable.
- Add advanced publishing, richer public pages, analytics, custom themes, and verified user badges.
- Include version history and conflict recovery.
- Treat sync as a trust feature, not just convenience.

### Phase 3: Collaboration

Goal: move from personal productivity to organizational execution.

- Launch Premium after collaboration primitives are stable.
- Price Premium per seat when collaboration is enabled.
- Include central billing and permissions from day one.
- Offer annual invoices for Premium collaboration customers.

## Metrics To Track

Track these before changing prices:

- Free activation: vault created, first goal added, first Agenda completed.
- Plus activation: first AI Agenda generated, first Assistant update persisted, first AI task breakdown accepted.
- Day 7 retention by plan.
- Day 30 retention by plan.
- Free-to-Plus conversion.
- Website download-to-activation conversion for the Mac app.
- Stripe checkout start-to-paid conversion.
- Mobile App Store install-to-account conversion once iOS/iPadOS launches.
- AI COGS per active paid user.
- AI COGS as a percentage of net revenue.
- Refund rate and cancellation reasons.
- Number of days per week users open the app.
- Percentage of days with at least one completed task.
- Sync support incidents per Pro user when Pro launches.
- Basic publishing activation: public page created, page shared, and returning visitors generated.
- Pro publishing activation: advanced page configured, verified badge enabled, or analytics viewed.

Guardrail targets:

- AI COGS should stay below 20-25% of net subscription revenue for Plus.
- Refund rate should stay below the broader AI-app risk band.
- If normal active users exceed 30% AI COGS, route more work to cheaper models before raising price.

## Positioning

Recommended positioning:

> GoalRate is a local-first daily execution system for people whose goals are too important to leave in a generic task list.

Avoid positioning as:

- A cheaper Todoist.
- A general chatbot.
- A generic productivity suite.
- A public social-goals network.

Launch upgrade copy:

- Plus: "Upgrade to Plus for AI planning that turns your goals into today's work."

Future Pro and Premium copy should not ship until those features are implemented and supportable.

## Risks

- AI novelty churn: AI can sell the upgrade but fail to retain unless the daily workflow creates repeat value.
- Margin risk: Sonnet or frontier-model defaults can erase Plus margin for normal or heavy users.
- Trust risk: local-first users will punish vague privacy or remote AI behavior.
- Sync risk: Pro can damage brand trust if sync corrupts markdown or surprises users.
- Publishing quality risk: Free basic publishing needs enough polish to drive sharing without giving away every Pro publishing reason to upgrade.
- Mobile billing compliance risk: iOS/iPadOS purchase and external-link rules can change by storefront, so mobile purchase UX needs explicit review before each submission.
- Tier sprawl: four tiers are enough; Free plus Plus is enough for the first paid launch.

## Closed Questions

- BYO API keys will not be available. AI is only available through GoalRate paid tiers.
- The initial paid launch should not include a free hosted AI trial.
- Annual plans use a consistent 20% discount.
- Basic publishing is available in Free and higher.
- Sync is available in Pro and Premium.
- Advanced publishing and verified user badges are available in Pro and Premium.
- Premium is the collaboration tier.
- Team is removed as a product-facing tier.
- AI context caching should favor provider-supported prompt/context reuse and local non-sensitive prompt scaffolding. Do not persist raw Memory or full vault payloads as hidden cached AI context.
- The main Mac app launches through direct website download and Stripe billing, not the Mac App Store.
- iOS and iPadOS are the App Store channels and must map StoreKit/App Store entitlements into the same plan model as Stripe.

## Source Notes

- Todoist pricing update: https://www.todoist.com/help/articles/todoist-pricing-and-plans-update-2025-everything-you-need-to-know-Tn6Pg1JKI
- Obsidian pricing: https://obsidian.md/pricing
- Sunsama pricing: https://www.sunsama.com/pricing
- Akiflow pricing: https://akiflow.com/pricing
- Motion pricing: https://www.usemotion.com/pricing
- Reclaim pricing: https://reclaim.ai/pricing
- Notion pricing: https://www.notion.com/pricing
- Notion desktop downloads: https://www.notion.com/desktop
- Notion App Store listing: https://apps.apple.com/us/app/notion-notes-docs-tasks/id1232780281
- RevenueCat State of Subscription Apps 2026: https://www.revenuecat.com/state-of-subscription-apps-2026-productivity/
- OpenAI API pricing: https://openai.com/api/pricing/
- Anthropic API pricing: https://platform.claude.com/docs/en/about-claude/pricing
- Stripe pricing: https://stripe.com/pricing
- Stripe Billing pricing: https://stripe.com/billing/pricing
- Apple App Store Small Business Program: https://developer.apple.com/app-store/small-business-program/
- Apple Developer ID distribution: https://developer.apple.com/support/developer-id/
- Apple App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
