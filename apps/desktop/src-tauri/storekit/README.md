# GoalRate StoreKit Testing

GoalRate's initial Mac launch uses direct website distribution and Stripe billing. This StoreKit area is dormant for the Mac production path and remains useful only for future Mac App Store experiments or as reference for Apple-platform subscription handling.

## Legacy Mac App Store Product

- Subscription group: `GoalRate Plus`
- Product reference name: `GoalRate Plus Monthly`
- Product ID: `com.goalrate.desktop.plus.monthly`
- Type: Auto-renewable subscription
- Duration: 1 month
- Display name: `GoalRate Plus`

If the Mac App Store path is revived, the app loads the localized name, duration, and price from StoreKit. Keep the product ID in App Store Connect exactly aligned with `PLUS_PRODUCT_ID` in the Rust and TypeScript subscription helpers.

## Local State Testing

Regular `tauri:dev` does not call StoreKit. It uses the fallback GoalRate Plus product metadata and a Free subscription state so the desktop app can start without App Store sandbox configuration.

For focused desktop development, debug builds can override the local entitlement state:

```sh
GOALRATE_STOREKIT_TEST_STATUS=active pnpm --filter @goalrate-app/desktop run tauri:dev
```

Supported values: `active`, `active_canceled`, `grace`, `billing_retry`, `expired`, `revoked`, `pending`, and `unavailable`.

Only `active`, `active_canceled`, and `grace` unlock Plus. The current Stripe-backed subscription UI reads this Tauri debug status in development before checking account billing, so the same command can be used to unlock Plus-only UI locally. This override is compiled out of release builds.

To exercise real StoreKit from a development build, opt in explicitly:

```sh
GOALRATE_ENABLE_STOREKIT_DEV=1 pnpm --filter @goalrate-app/desktop run tauri:dev
```

## StoreKit Sandbox Testing

Before any future App Store submission, test against real StoreKit data:

1. Create the Plus subscription product in App Store Connect.
2. Use an App Store sandbox tester account.
3. Build the App Store variant with `GOALRATE_APP_STORE_BUILD=true`.
4. Verify product loading, purchase, restore purchases, active entitlement, active-canceled entitlement, billing retry, expiration, and revoked states.

Xcode StoreKit configuration files can also be used for local StoreKit scenarios. Create or sync a `.storekit` file in Xcode with the same product ID, then run the macOS app with that StoreKit configuration active.
