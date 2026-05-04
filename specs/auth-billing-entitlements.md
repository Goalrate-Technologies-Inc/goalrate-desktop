# Authentication, Billing, and Entitlements

Decision date: 2026-05-02

## Problem

GoalRate needs users to sign in, subscribe to paid tiers, and have the desktop app reliably know which features the user can access.

The first paid users are individuals buying Free, Plus, and later Pro. The later Premium tier must support teams, organizations, seats, SSO, schools, clubs, and leagues without replacing the identity model.

The system also spans two codebases:

- `goalrate-desktop`: the Tauri desktop app and local-first product experience.
- `goalrate-app`: the website, hosted account surfaces, hosted API, and billing callbacks.

## Decision

Use WorkOS AuthKit as the authentication and organization platform, Stripe Billing as the subscription system, and a GoalRate backend entitlement layer as the app-facing source of truth.

The desktop app must not decide plan access from Stripe redirects, local state, or a vendor-specific frontend SDK. It should authenticate with the GoalRate backend, then call an entitlement endpoint to learn the active workspace, plan, and feature grants.

```text
WorkOS AuthKit = sign-in, identity, organizations, SSO, MFA, future directory sync
Stripe Billing = subscription products, invoices, checkout, customer portal
GoalRate backend = user/workspace mapping, sessions, entitlement resolution
goalrate-desktop = local app that consumes backend-issued session and entitlements
goalrate-app = website, account management, checkout, hosted API, webhooks
```

## Resolved Product Decisions

- Free local desktop usage should not require sign-in. Users can create and use a local vault anonymously until they need hosted AI, publishing, sync, billing, or collaboration.
- Every signed-in user should get a GoalRate personal workspace and a matching WorkOS Organization at first sign-in. This keeps personal billing and later team billing on one organization-shaped model.
- Launch sign-in methods should include email/password, magic link, Google, Apple, and Microsoft.
- Apple login is part of the initial auth launch scope, not a later mobile-only follow-up.
- The first paid launch should expose Free and Plus only. Pro and Premium may exist as reserved enum values and disabled backend configuration, but they must not be production purchase options until their features are implemented.
- Plus should require payment immediately. Do not offer a free hosted AI trial in the first paid launch.
- Checkout, billing management, and account-security mutations should be browser/web-owned through `goalrate-app`. `goalrate-desktop` can show plan state and account entry points, then open the right website route.
- The public hosted app and account domain should be `app.goalrate.com`. Marketing pages may live on `goalrate.com`; API routes may remain under the hosted app or move to `api.goalrate.com` if deployment boundaries need it.
- The preferred desktop auth deep link is `goalrate://auth/callback`. Use query parameters for exchange data, for example `goalrate://auth/callback?code=...&state=...`.
- The same GoalRate account should work across desktop, website, and mobile. Each app may have its own secure session, but users should not need separate accounts or separate subscriptions.
- Entitlement display should show the highest plan available anywhere in the account, but feature enforcement should be based on the active workspace plus the user's membership and role.
- If a user's highest plan comes from a team workspace, product copy should name the source, for example `Premium via Acme FC`.
- No existing users need migration. WorkOS-backed auth can start clean.
- Premium team subscriptions cover members while they work inside that team workspace. Members do not need separate individual paid plans for team-covered Premium features.
- AI usage limits should reset by subscription billing period with no rollover. This aligns AI cost with collected revenue and avoids calendar-month double dipping.
- Hosted AI should be blocked immediately when the paid subscription is not active and paid. Local Free features remain available.
- Every account should retain a personal workspace while the account exists. Users may cancel the personal subscription, rename the workspace, or delete the account, but should not delete their only personal workspace independently.
- Premium team workspaces should be created through a Premium purchase, admin, or sales-assisted flow. Do not let users create unpaid multi-user team workspaces in the first Premium version.
- Premium teams should support invited seat members only. Do not support guests or external collaborators in the first Premium version.
- Premium admins should be able to require SSO for members of a verified-domain workspace, with a limited owner break-glass path for IdP outages or SSO misconfiguration.

## Goals

- Support individual Free, Plus, and Pro subscriptions before Premium exists.
- Model individuals and teams through one workspace/organization entitlement model.
- Keep Free local-first desktop workflows usable without a required account where practical.
- Require sign-in for hosted services, paid AI, sync, publishing, and account billing.
- Let Premium later add seats, SSO, organization admin, schools, clubs, and leagues without a migration from user-owned subscriptions to org-owned subscriptions.
- Keep WorkOS and Stripe secrets out of the desktop app.
- Keep the desktop app's entitlement logic backend-driven and testable.
- Make the website the canonical place for login callback handling, checkout, billing management, and account settings.

## Non-Goals

- Do not roll a custom password authentication system.
- Do not use Clerk for the planned implementation.
- Do not implement Pro, Premium, SSO, SCIM, StoreKit, or mobile purchase flows in the first Free/Plus desktop launch.
- Do not expose Stripe secrets, WorkOS API keys, customer portal secrets, webhook secrets, or signing keys in `goalrate-desktop`.
- Do not make the local markdown vault depend on remote authentication.
- Do not use product-facing words like `organization` for individual users unless they are managing a real team. Internally this may still be an organization/workspace.

## Product Model

Every signed-in user belongs to at least one GoalRate workspace. A personal user gets a personal workspace automatically on first sign-in. That personal workspace is one workspace membership, not the user's permanent company identity.

```text
User
  has many memberships

Workspace
  has many members
  has one active billing owner/source
  has one resolved plan
  has many entitlements
```

Product-facing workspace types:

| Type | User-facing meaning | Internal billing shape |
| --- | --- | --- |
| Personal workspace | One individual's GoalRate account | One-member workspace with Free, Plus, or Pro plan |
| Team workspace | Club, school, team, league, or company | Multi-member workspace with Premium plan and seats |

Subscriptions attach to workspaces, not directly to users. This keeps individual subscriptions and Premium team subscriptions on the same path.

Example:

```text
Sam signs up alone:
  WorkOS User: sam@example.com
  WorkOS Org / GoalRate Workspace: Sam's Workspace
  Subscription: Plus

Sam later joins Acme FC:
  Same WorkOS User: sam@example.com
  Additional WorkOS Org / GoalRate Workspace: Acme FC
  Acme FC Subscription: Premium, seat-based
```

Sam now has one user identity and two workspaces. Premium collaboration features apply while Sam is working inside Acme FC. Sam's personal workspace remains Plus unless Sam changes that subscription. Acme FC should not pay for Sam's personal workspace, and Sam's personal Plus subscription should not grant access to Acme FC data.

## Plans and Feature Grants

The product-facing plan identifiers remain:

- `free`
- `plus`
- `pro`
- `premium`

Plan ownership:

| Plan | Launch status | Billing owner | Primary grants |
| --- | --- | --- | --- |
| Free | Launch | No paid subscription | Local-first desktop core and basic publishing when implemented |
| Plus | Launch paid tier | Personal workspace | Hosted AI planning, Assistant, task breakdown, prioritization, Memory-aware AI |
| Pro | Future | Personal workspace | Plus, sync, advanced publishing, analytics, custom themes, verified badges |
| Premium | Future | Team workspace | Pro, collaboration, shared spaces, roles, permissions, seats, SSO/admin features |

Entitlements should be feature-based, not only plan-name-based. Example feature keys:

```text
ai.agenda.generate
ai.assistant.chat
ai.task.breakdown
ai.memory.context
sync.devices
publishing.basic
publishing.advanced
publishing.analytics
collaboration.workspaces
collaboration.roles
billing.seat_management
auth.sso
```

The UI may show plan names, but authorization should check feature keys.

Launch code may define `pro` and `premium` as reserved plan identifiers so database schemas, shared types, and entitlement resolution do not need a disruptive rename later. Production pricing pages, checkout endpoints, desktop upgrade prompts, and account settings should expose only Free and Plus until Pro and Premium features are real.

## Auth Provider Requirements

WorkOS AuthKit is the selected auth provider because it supports both early individual auth and later B2B auth:

- Email and password.
- Magic Auth.
- Social login.
- Google, Apple, and Microsoft as explicit launch social providers.
- MFA.
- Organization memberships.
- Enterprise SSO.
- Admin Portal and future directory lifecycle support.
- Stripe entitlement and seat-sync add-ons where useful.

The first launch should use WorkOS Hosted UI unless a later design spec requires custom auth UI. Hosted UI keeps the security surface smaller and lets GoalRate ship faster.

## Desktop Auth Flow

The desktop app should use the system browser, not an embedded webview, for auth.

Recommended flow:

```text
1. goalrate-desktop asks the backend to start desktop login.
2. goalrate-app API creates a login intent with state, nonce, and device metadata.
3. The desktop app opens the WorkOS AuthKit URL in the system browser.
4. WorkOS redirects back to a goalrate-app callback URL.
5. goalrate-app exchanges the WorkOS code server-side.
6. goalrate-app creates or updates the GoalRate user, personal workspace, memberships, and session.
7. goalrate-app issues a short-lived, single-use desktop exchange code.
8. The browser redirects to a GoalRate desktop deep link with the exchange code.
9. goalrate-desktop receives the deep link through Tauri and exchanges the code for a GoalRate session.
10. goalrate-desktop stores the refresh token in the OS keychain and keeps access tokens short-lived.
11. goalrate-desktop calls `/me` or `/entitlements` to load the active workspace and feature grants.
```

The preferred desktop callback is:

```text
goalrate://auth/callback?code=<desktop_exchange_code>&state=<state>
```

Use `goalrate://auth/callback` instead of `goalrate://auth?callback` so auth callback handling is route-like and query parameters remain available for `code`, `state`, and error fields.

The desktop deep link should carry only a short-lived exchange code, never a Stripe session ID as proof of payment and never a long-lived access or refresh token.

The website should use HTTPS callback URLs, such as `https://app.goalrate.com/auth/workos/callback`. Future mobile apps may use the same account system with platform-appropriate callbacks, preferably universal links where App Store platform behavior makes that safer than custom schemes.

## Website Auth Flow

The website lives in `goalrate-app` and should own:

- Public pricing pages.
- Sign-in and sign-up entry points.
- WorkOS AuthKit callback routes.
- Account settings.
- Plan comparison.
- Stripe Checkout redirects.
- Stripe Customer Portal redirects.
- Help, terms, privacy, and support pages related to accounts and billing.

The website can use HTTP-only cookies for browser sessions. The desktop app should use backend-issued desktop sessions stored through Tauri/OS secure storage, not website cookies.

## Billing Flow

Stripe is the billing source of truth for direct Mac and website purchases.

Upgrade flow:

```text
1. User clicks Upgrade in goalrate-desktop or goalrate-app.
2. If not signed in, user signs in through WorkOS.
3. GoalRate backend creates or loads the active workspace.
4. GoalRate backend creates a Stripe Customer for that workspace if needed.
5. GoalRate backend starts Stripe Checkout for the selected plan and billing cycle.
6. Stripe redirects back to goalrate-app after checkout.
7. Stripe webhook updates backend subscription state.
8. Backend resolves workspace entitlements.
9. Desktop app refreshes `/entitlements` and unlocks paid features.
```

Stripe Customer IDs should be attached to the workspace. If WorkOS Stripe entitlements are enabled, the Stripe Customer ID should also be set on the corresponding WorkOS Organization.

Stripe metadata should include stable GoalRate and WorkOS identifiers:

```text
goalrate_workspace_id
goalrate_user_id_started_by
workos_org_id
plan
billing_cycle
```

Stripe webhooks should remain authoritative for subscription lifecycle events. WorkOS Stripe entitlements may enrich access tokens, but the GoalRate backend should still store or derive a canonical entitlement response for app clients.

## Entitlement Resolution

The backend should expose one app-facing entitlement response.

Suggested response:

```json
{
  "user": {
    "id": "usr_123",
    "email": "sam@example.com",
    "name": "Sam Rivera"
  },
  "activeWorkspace": {
    "id": "wsp_123",
    "name": "Sam's Workspace",
    "type": "personal",
    "role": "owner"
  },
  "accountEffectivePlan": {
    "id": "premium",
    "sourceWorkspaceId": "wsp_acme"
  },
  "activeWorkspacePlan": {
    "id": "plus",
    "status": "active",
    "source": "stripe",
    "currentPeriodEndsAt": "2026-06-01T00:00:00Z"
  },
  "activeWorkspaceFeatures": {
    "ai.agenda.generate": true,
    "ai.assistant.chat": true,
    "ai.task.breakdown": true,
    "sync.devices": false,
    "collaboration.workspaces": false
  },
  "workspaceMemberships": [
    {
      "id": "wsp_123",
      "name": "Sam's Workspace",
      "type": "personal",
      "role": "owner",
      "plan": "plus"
    },
    {
      "id": "wsp_acme",
      "name": "Acme FC",
      "type": "team",
      "role": "member",
      "plan": "premium"
    }
  ],
  "limits": {
    "period": "subscription_billing_period",
    "periodStartsAt": "2026-05-01T00:00:00Z",
    "periodEndsAt": "2026-06-01T00:00:00Z",
    "aiOperationsIncluded": 300,
    "aiOperationsUsed": 42
  },
  "refreshedAt": "2026-05-01T12:00:00Z"
}
```

Resolution rules:

- Grant Free when no paid subscription exists.
- Grant paid features only for subscriptions that are active and paid. Since the first paid launch has no trial, `trialing` should not unlock Plus AI unless a later spec introduces trials.
- Block hosted AI when Stripe reports `past_due`, `unpaid`, `incomplete`, `canceled`, or any other non-active/non-paid state. Do not provide AI grace usage during payment retries.
- Prefer the highest active plan across the account for user-facing entitlement display when multiple sources exist later, such as personal Stripe, team Stripe, and App Store. This should be exposed as `accountEffectivePlan`.
- Resolve enforceable entitlements by active workspace, not merely by current user. This should be exposed as `activeWorkspacePlan` and `activeWorkspaceFeatures`.
- Enforce workspace membership and permissions separately from plan level. A personal Pro subscription should not grant access to a Premium team's private data, and a Premium team subscription should cover team features only for members while they work inside that team workspace.
- Reset AI usage limits by subscription billing period, not by calendar month or rolling 30-day window.
- Do not let client-provided plan names unlock backend features.
- Hosted AI routes must check backend entitlements before every paid AI operation.

## Backend Data Model

The backend in `goalrate-app` should own the account and entitlement tables.

Suggested entities:

```text
users
  id
  workos_user_id
  email
  name
  avatar_url
  created_at
  updated_at

workspaces
  id
  workos_org_id
  stripe_customer_id
  type                personal | team
  name
  created_by_user_id
  created_at
  updated_at

workspace_memberships
  id
  workspace_id
  user_id
  role                owner | admin | member
  status              active | pending | inactive
  workos_membership_id
  created_at
  updated_at

subscriptions
  id
  workspace_id
  provider            stripe | app_store
  provider_customer_id
  provider_subscription_id
  plan                free | plus | pro | premium
  billing_cycle       monthly | yearly | seat_metered
  status              active | trialing | past_due | canceled | unpaid | incomplete
  quantity
  current_period_end
  cancel_at_period_end
  created_at
  updated_at

entitlement_snapshots
  id
  workspace_id
  plan
  features_json
  limits_json
  source
  resolved_at
  expires_at

sessions
  id
  user_id
  workspace_id
  device_id
  device_name
  refresh_token_hash
  created_at
  last_used_at
  expires_at
  revoked_at
```

The exact schema can adapt to the existing backend, but these concepts should remain explicit.

For the initial clean launch, no legacy user migration is required. New WorkOS users should be mapped into new GoalRate users and personal workspaces idempotently.

## API Surface

Initial endpoints:

| Endpoint | Owner | Purpose |
| --- | --- | --- |
| `POST /auth/desktop/start` | `goalrate-app` API | Create a desktop auth intent and return the WorkOS Hosted UI URL |
| `GET /auth/workos/callback` | `goalrate-app` website/API | Handle WorkOS redirect and create GoalRate session state |
| `POST /auth/desktop/exchange` | `goalrate-app` API | Exchange one-time desktop code for a GoalRate desktop session |
| `POST /auth/refresh` | `goalrate-app` API | Rotate desktop access/refresh tokens |
| `POST /auth/logout` | `goalrate-app` API | Revoke the current session |
| `GET /me` | `goalrate-app` API | Return user, active workspace, plan, and entitlements |
| `GET /entitlements` | `goalrate-app` API | Refresh and return entitlement state |
| `POST /billing/checkout` | `goalrate-app` API | Create a Stripe Checkout Session for the active workspace |
| `POST /billing/portal` | `goalrate-app` API | Create a Stripe Customer Portal session |
| `POST /webhooks/stripe` | `goalrate-app` API | Ingest Stripe subscription lifecycle events |
| `POST /webhooks/workos` | `goalrate-app` API | Ingest WorkOS user/org/membership events when enabled |

The desktop app should wrap these endpoints in `goalrate-desktop` shared API-client code rather than scattering fetch calls through UI components.

## Desktop Responsibilities

`goalrate-desktop` owns:

- Starting sign-in from desktop UI.
- Opening the system browser to the backend-provided auth URL.
- Receiving deep links through Tauri.
- Exchanging one-time auth codes with the backend.
- Storing refresh tokens in OS secure storage through Tauri.
- Keeping access tokens short-lived and in memory when practical.
- Calling `/me` or `/entitlements` at app start, after checkout, after refresh, and after workspace switch.
- Gating UI affordances from entitlement state.
- Calling hosted AI only through backend-authorized routes.
- Letting signed-in users switch active workspaces when they belong to more than one workspace.
- Hiding the workspace switcher while the user belongs to only one workspace.
- Preserving offline Free local workflows when signed out or offline.

The desktop app must not:

- Store WorkOS client secrets, Stripe secrets, webhook secrets, or raw payment state.
- Treat a local cache as proof of paid access for hosted features.
- Write auth state inside the user's markdown vault.
- Require sign-in before the user can create or use a local Free vault, unless a specific hosted feature requires it.

## Website and API Responsibilities

`goalrate-app` owns:

- WorkOS project configuration, callback routes, and hosted auth integration.
- User, workspace, membership, subscription, session, and entitlement persistence.
- Stripe product and price mapping.
- Checkout Session creation.
- Customer Portal Session creation.
- Stripe webhook verification.
- WorkOS webhook verification where used.
- Entitlement resolution.
- Hosted account settings.
- Pricing and checkout UX.
- Any hosted AI proxy that requires paid entitlement checks.

The website should be the canonical account surface. Desktop account buttons can open the relevant website route when the action is more safely handled in a browser.

## Current Implementation Notes

`goalrate-app/docs/architecture/HYBRID_AUTH.md` describes an existing custom JWT, cookie, and refresh-token auth system. This spec changes the target identity provider direction: WorkOS should own user authentication and identity proofing, while GoalRate may still own app sessions, refresh-token rotation, device sessions, and entitlement-bearing API responses.

In other words, the reusable part of the existing auth posture is the backend session machinery. The part to avoid expanding is custom password and identity-provider logic.

## Premium Path

Premium should reuse the same model rather than introduce a second auth system.

Premium additions:

- Team workspace creation through Premium purchase, admin, or sales-assisted flow.
- Seat quantity or usage-based seat billing.
- Owner/admin/member roles.
- Organization invitation flow for billable seat members.
- WorkOS SSO setup for the workspace.
- Optional WorkOS Admin Portal for IT/admin setup.
- Future directory sync or SCIM lifecycle handling.
- Workspace switcher in the desktop app when a user belongs to multiple workspaces.
- No guest or external-collaborator access in the first Premium version.

Premium sign-in may look different because an organization can require SSO, but it should still end with the same GoalRate session and entitlement response.

```text
Individual user:
WorkOS AuthKit -> GoalRate session -> personal workspace entitlements

Premium org user:
WorkOS AuthKit / SSO -> GoalRate session -> team workspace entitlements
```

Notion-like reference behavior: workspace owners or admins invite members by email or invite link, paid workspaces are billed per member, and allowed-domain joining can make new users members automatically. GoalRate should borrow the seat-based member model, but defer invite links and allowed-domain auto-join until billing controls and admin settings are mature enough to prevent surprise seat creation.

For SSO-enforced Premium workspaces, members should be required to authenticate through the configured IdP before accessing that workspace. This enforcement should be scoped to the team workspace. The user's personal workspace can still use normal GoalRate login methods. Org owners should have a limited break-glass fallback so an IdP outage or bad SSO configuration does not permanently lock out the customer.

## Local-First and Offline Behavior

Free local workflows remain local-first:

- Creating and editing a local vault should not require sign-in where practical.
- Local markdown content remains in the vault and should not be uploaded merely because a user signs in.
- Hosted AI, sync, publishing, and collaboration require online authentication and entitlement checks.

Desktop may cache the last entitlement response for display and optimistic UI, but paid hosted operations must be revalidated by the backend. If the app is offline, it should show local Free workflows and explain that hosted paid features need a connection.

## Security Requirements

- Use a system-browser authorization-code flow for desktop auth. If the desktop app ever receives a provider authorization code directly, use PKCE. In the preferred backend-callback handoff, use signed state, nonce, and one-time desktop exchange codes.
- Use state and nonce for all auth intents.
- Use one-time desktop exchange codes with short expiry.
- Store desktop refresh tokens in OS keychain or equivalent secure storage.
- Hash refresh tokens server-side.
- Rotate refresh tokens.
- Revoke sessions on logout, password/security events, membership deactivation, and admin revocation.
- Verify Stripe and WorkOS webhook signatures.
- Keep WorkOS and Stripe secrets in backend-managed environment variables only.
- Do not log tokens, authorization codes, webhook secrets, Stripe payment method details, or raw AI vault payloads.
- Hosted AI routes must check entitlement server-side on every request.
- Premium workspace deactivation or membership removal must revoke the member's access to that workspace.

## UX Requirements

Desktop:

- Show Free local value before forcing account creation.
- Use a clear "Sign in" action when the user wants hosted features.
- Use "Upgrade to Plus for AI planning" for the initial paid launch.
- Show precise plan badges when the effective plan comes from a team workspace, such as `Premium via Acme FC`.
- Show the workspace switcher only after the user has access to more than one workspace.
- After checkout, provide a refresh state that makes the desktop app re-check entitlements.
- If entitlement refresh lags webhook processing, show a short pending state and retry.
- Show the active workspace name only when it helps, especially after Premium workspaces exist.

Website:

- Keep pricing copy aligned with `subscription-tiers.md`.
- Launch with Free and Plus only until Pro/Premium features are implemented.
- Provide account, billing, invoices, and cancellation management through Stripe Customer Portal.
- Do not show SSO or seat management purchase paths before Premium is real.

Pattern reference: Notion exposes a desktop app, supports multiple login methods, and manages billing per workspace from account/workspace settings. GoalRate should borrow the broad pattern, not the exact implementation: a focused desktop app can show plan state, while account, checkout, invoices, cancellation, and security-sensitive changes stay in the web-owned account surface.

## Implementation Phases

### Phase 1: WorkOS AuthKit for Individual Accounts

- Configure WorkOS AuthKit for GoalRate.
- Add backend WorkOS callback handling in `goalrate-app`.
- Create or map users on first sign-in.
- Enable email/password, magic link, Google, Apple, and Microsoft login before launch.
- Create a GoalRate personal workspace and matching WorkOS Organization for each new signed-in user.
- Add desktop auth intent, deep link, and exchange flow.
- Add `/me` with Free entitlement response.

### Phase 2: Stripe Billing and Plus Entitlements

- Configure Stripe products and prices for Plus.
- Create Stripe Customers per workspace.
- Add Checkout and Customer Portal endpoints.
- Add Stripe webhooks for subscription create/update/delete.
- Resolve Plus entitlements from Stripe subscription state.
- Gate hosted AI routes by `ai.*` entitlements.
- Reset AI usage by subscription billing period and block hosted AI for non-active/non-paid subscriptions.
- Add desktop entitlement refresh after checkout.

### Phase 3: Pro Individual Entitlements

- Add Pro products and price mapping only when sync and advanced publishing are implemented.
- Add Pro features to entitlement resolution.
- Add plan comparison and upgrade copy once features are real.
- Map mobile App Store purchases into the same entitlement model when mobile launches.

### Phase 4: Premium Organizations

- Add team workspace creation and invitations.
- Add Premium seat billing.
- Enable WorkOS SSO setup for Premium workspaces.
- Add roles and permissions.
- Add workspace switching in desktop.
- Keep guests and external collaborators out of the first Premium release.
- Allow org admins to enforce SSO for verified-domain workspace members with owner break-glass fallback.
- Add admin and member lifecycle handling.

## Acceptance Criteria

- A new user can use Free local desktop workflows without signing in when no hosted feature is needed.
- A user can sign in from `goalrate-desktop` through the system browser and return to the app.
- A signed-in user receives a personal workspace and Free entitlement response.
- A signed-in user can start Plus checkout from desktop or website.
- A completed Stripe Plus subscription updates backend entitlement state through webhook processing.
- The desktop app refreshes entitlements and unlocks Plus AI only after the backend reports Plus features.
- Hosted AI calls fail server-side when the entitlement is missing, expired, or revoked.
- Hosted AI calls fail server-side immediately when a paid subscription is `past_due`, `unpaid`, `incomplete`, `canceled`, or otherwise not active and paid.
- Logout clears local desktop session state and revokes the backend session.
- Stripe and WorkOS secrets are absent from `goalrate-desktop`.
- Premium can later attach seats and SSO to team workspaces without replacing individual account identities.

## Testing and Quality

Backend tests:

- WorkOS callback creates users and personal workspaces idempotently.
- Desktop exchange codes are single-use and expire.
- Refresh token rotation works and revoked sessions cannot refresh.
- Stripe webhook events update subscription and entitlement state idempotently.
- Entitlement resolution grants the expected features for Free and Plus.
- Entitlement resolution resets AI limits by subscription billing period.
- Hosted AI rejects missing or insufficient entitlements.

Desktop tests:

- Auth state machine covers signed out, auth pending, signed in, refresh failed, and signed out after logout.
- Deep link parsing rejects missing state or malformed exchange codes.
- Entitlement refresh updates feature gates.
- Local Free vault workflows remain available when signed out.
- Paid AI UI shows the correct upgrade or offline state when entitlement is absent.

Manual checks:

- Sign in from the desktop app.
- Complete a test-mode Stripe Checkout for Plus.
- Confirm the website shows the account and billing state.
- Confirm the desktop app unlocks Plus after entitlement refresh.
- Cancel the subscription and confirm paid AI is blocked after the entitlement state changes.

## Open Questions

- How long should a recently paid but webhook-pending checkout show a retry state before asking the user to contact support?
- What are the final AI fair-use limits for Plus, Pro, and Premium?
- When mobile launches, should App Store entitlement reconciliation live in the same subscription table or in a provider-specific transaction table feeding entitlement snapshots?

## Related Specs

- [Subscription Tiers](subscription-tiers.md)
- [Monetization Strategy Research](monetization-strategy.md)
- [Apple Platform Distribution](apple-platform-distribution.md)
- [Assistant and Memory](assistant-memory.md)

## Source Notes

- WorkOS AuthKit: https://workos.com/docs/user-management/overview
- WorkOS users and organizations: https://workos.com/docs/authkit/users-organizations
- WorkOS Stripe add-on: https://workos.com/docs/authkit/add-ons/stripe
- Stripe Billing: https://docs.stripe.com/billing
- OAuth 2.0 for Native Apps: https://www.rfc-editor.org/rfc/rfc8252
- Notion login methods: https://www.notion.com/help/log-in-and-out
- Notion billing model: https://www.notion.com/help/billing
- Notion SAML SSO: https://www.notion.com/help/saml-sso-configuration
- Notion members and guests: https://www.notion.com/help/add-members-admins-guests-and-groups
- Notion member billing: https://www.notion.com/en-gb/help/members-and-billing
