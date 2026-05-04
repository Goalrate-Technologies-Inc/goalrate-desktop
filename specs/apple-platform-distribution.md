# Apple Platform Distribution

## Problem

GoalRate needs a distribution plan that matches the product strategy: the main Mac app should behave like a serious local-first desktop product, while iOS and iPadOS should use Apple's App Store reach when mobile apps are ready.

## Goals

- Distribute the main Mac desktop app directly from the GoalRate website.
- Use Stripe Checkout, Stripe Billing, and Stripe Customer Portal for direct Mac paid upgrades.
- Keep the Mac app trustworthy through Developer ID signing, hardened runtime, notarization, and clear website messaging.
- Distribute iOS and iPadOS apps through the App Store.
- Map Stripe and App Store purchases into one product-facing entitlement model.
- Keep vault access explicit and local-first across channels.

## Non-Goals

- Do not submit the main Mac desktop app to the Mac App Store for the initial launch.
- Do not implement Mac StoreKit purchase flows for the initial desktop launch.
- Do not rely on website-only paid access in iOS/iPadOS if current App Store rules require an in-app purchase path.
- Do not store Apple signing certificates, provisioning profiles, Stripe secrets, API keys, or App Store Connect credentials in the repository.
- Do not introduce channel-specific plan names.

## Distribution Decision

GoalRate should follow a Notion-like channel split:

| Platform | Distribution | Billing | Product posture |
| --- | --- | --- | --- |
| macOS desktop | Direct download from `goalrate.com` | Stripe | Primary desktop product and primary paid conversion path. |
| iOS and iPadOS | Apple App Store | StoreKit/In-App Purchase where required, plus compliant account entitlement recognition | Mobile companion or full mobile product when reviewable. |

The launch plan ladder stays the same everywhere: Free and Plus. Future plan identifiers such as Pro and Premium should stay out of product copy and purchase UX until their features are implemented.

## Mac Requirements

- Ship Developer ID-signed and notarized Mac builds.
- Enable hardened runtime and only the entitlements required by the direct-distribution build.
- Staple notarization tickets to distributed artifacts when practical.
- Publish the Mac app from a GoalRate-owned download page with privacy, terms, support, release notes, and install/update guidance.
- Use Stripe Checkout for upgrades and Stripe Customer Portal for subscription management.
- Require account sign-in only for features that need hosted services or paid entitlements; Free local vault workflows should remain usable without a backend account when practical.
- Authorize hosted AI through backend entitlement checks derived from Stripe subscription state.
- Keep paid AI hosted by GoalRate. Do not ship production BYO provider-key UX.
- Do not write user content outside the selected vault root or approved app-managed storage.
- Keep vault folder access user-selected and explicit even though the direct Mac app is not constrained by Mac App Store sandboxing.
- Use a direct update mechanism when implemented; do not describe Mac updates as App Store-delivered in production copy.

## iOS and iPadOS Requirements

- Distribute iOS and iPadOS apps through the App Store.
- Use StoreKit for App Store subscription purchase and restore flows where required.
- Show localized App Store price, subscription duration, included benefits, Terms of Use, Privacy Policy, Restore Purchases, and Manage Subscription near purchase actions.
- Normalize App Store transaction state into the same backend entitlement model used for Stripe.
- Allow existing account sign-in and entitlement recognition where App Store rules permit it.
- Confirm current storefront-specific external purchase and purchase-link rules before adding any in-app Stripe checkout link, external purchase button, or web-purchase call to action.
- Submit only implemented, reviewable mobile features. Do not advertise sync, publishing, collaboration, Pro, or Premium inside mobile builds before those features are real.
- Provide App Review notes that explain account use, paid entitlement handling, hosted AI routing, privacy labels, and any cross-platform subscription behavior.

## Entitlement Model

- Product-facing launch identifiers remain `free` and `plus`.
- Stripe subscriptions are the source of truth for direct Mac paid entitlements.
- App Store transactions are the source of truth for in-app mobile purchases.
- The backend should reconcile both purchase sources into a single account entitlement response.
- If the same account has both Stripe and App Store subscriptions, entitlement resolution should grant the highest active plan and avoid duplicate-payment pressure where the platform allows.

## Current Implementation Notes

- Mac App Store build scripts, StoreKit helpers, and sandbox entitlement artifacts are intentionally absent from the desktop launch branch.
- Reintroduce Apple purchase or sandbox build artifacts only when there is a concrete iOS, iPadOS, or Mac App Store target to support.
- The current direct/dev build behavior may retain local engineering affordances, but production paid AI should use hosted entitlement checks.

## Source Notes

- Apple Developer ID distribution: https://developer.apple.com/support/developer-id/
- Apple notarization overview: https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution
- Apple App Review Guidelines: https://developer.apple.com/app-store/review/guidelines/
- Notion desktop downloads: https://www.notion.com/desktop
- Notion App Store listing: https://apps.apple.com/us/app/notion-notes-docs-tasks/id1232780281
