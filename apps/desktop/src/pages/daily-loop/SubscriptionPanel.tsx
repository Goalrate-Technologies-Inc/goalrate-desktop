import { invoke } from "@tauri-apps/api/core";
import {
  Check,
  ExternalLink,
  Loader2,
  RefreshCw,
  Sparkles,
} from "lucide-react";
import { useSubscription } from "../../context/SubscriptionContext";

const PLUS_FEATURES = [
  "AI Agenda generation",
  "Assistant chat and reprioritization",
  "AI task breakdowns",
  "Memory-aware planning",
];

function renewalLabel(
  willRenew: boolean | null,
  expiresAt: string | null,
): string {
  if (!expiresAt) {
    return willRenew === false ? "Active until the current period ends." : "";
  }
  const date = new Date(expiresAt);
  const formatted = Number.isNaN(date.getTime())
    ? expiresAt
    : date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
  return willRenew === false
    ? `Active until ${formatted}; renewal is off.`
    : `Renews on ${formatted}.`;
}

function productPriceLine(product: {
  subscriptionPeriod?: { display: string } | null;
  displayPrice: string;
}): string {
  const duration = product.subscriptionPeriod?.display ?? "subscription";
  return `${duration} · ${product.displayPrice}`;
}

function errorText(error: string | null): React.ReactElement | null {
  if (!error) {
    return null;
  }
  return <p className="mt-2 text-xs text-red-600">{error}</p>;
}

export function PlusUpgradePanel({
  compact = false,
}: {
  compact?: boolean;
}): React.ReactElement {
  const {
    product,
    status,
    isLoading,
    isPurchasing,
    isManaging,
    error,
    startPlusCheckout,
  } = useSubscription();

  const disabled = isLoading || isPurchasing || isManaging;

  return (
    <div className={compact ? "rounded-lg border border-border bg-surface p-4" : "rounded-lg border border-border bg-surface p-5"}>
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-accent-goals" />
        <h3 className="font-serif text-lg text-text-primary">
          Upgrade to GoalRate Plus
        </h3>
      </div>
      <p className="text-sm leading-relaxed text-text-secondary">
        Plus unlocks AI planning for your local-first vault.
      </p>
      <div className="mt-3 rounded-md bg-surface-warm px-3 py-2">
        <p className="text-sm font-medium text-text-primary">
          {product.displayName}
        </p>
        <p className="text-xs text-text-secondary">
          {productPriceLine(product)}
        </p>
      </div>
      {!compact && (
        <ul className="mt-3 space-y-1.5">
          {PLUS_FEATURES.map((feature) => (
            <li key={feature} className="flex items-center gap-2 text-xs text-text-secondary">
              <Check className="h-3.5 w-3.5 text-progress-high" />
              {feature}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => {
            void startPlusCheckout();
          }}
          disabled={disabled}
          className="inline-flex items-center gap-2 rounded-md bg-text-primary px-3 py-2 text-sm font-medium text-text-inverse transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {isPurchasing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          Subscribe
        </button>
      </div>
      {status.state === "pastDue" && (
        <p className="mt-2 text-xs text-text-muted">
          Billing needs attention before AI can stay unlocked.
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-text-muted">
        <button
          type="button"
          onClick={() => {
            void invoke("open_terms_of_use");
          }}
          className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
        >
          Terms
          <ExternalLink className="h-3 w-3" />
        </button>
        <button
          type="button"
          onClick={() => {
            void invoke("open_privacy_policy");
          }}
          className="inline-flex items-center gap-1 underline-offset-2 hover:underline"
        >
          Privacy
          <ExternalLink className="h-3 w-3" />
        </button>
      </div>
      {errorText(error)}
    </div>
  );
}

export function SubscriptionSettingsSection(): React.ReactElement {
  const {
    product,
    status,
    isLoading,
    isPurchasing,
    isManaging,
    error,
    allowsAi,
    refresh,
    startPlusCheckout,
    manageBilling,
  } = useSubscription();

  const disabled = isLoading || isPurchasing || isManaging;
  const renewal = renewalLabel(status.willRenew, status.expiresAt);

  return (
    <section>
      <div className="mb-2 flex items-center gap-1.5">
        <Sparkles className="h-3.5 w-3.5 text-accent-goals" />
        <h3 className="font-mono text-xs font-medium uppercase tracking-wider text-text-muted">
          Subscription
        </h3>
      </div>

      <div className="rounded-lg border border-border bg-surface p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-text-primary">
              {allowsAi ? "GoalRate Plus" : "Free"}
            </p>
            <p className="mt-0.5 text-xs text-text-secondary">
              {allowsAi
                ? "AI is unlocked for this GoalRate subscription."
                : "Local Roadmap, Agenda, vault, markdown storage, and manual workflows are free."}
            </p>
          </div>
          <span className="shrink-0 rounded-full border border-border-light px-2 py-0.5 text-[11px] font-medium text-text-muted">
            {status.state}
          </span>
        </div>
        {renewal && <p className="mt-2 text-xs text-text-muted">{renewal}</p>}
      </div>

      <div className="mt-3 rounded-lg border border-border bg-surface p-3">
        <p className="text-sm font-medium text-text-primary">
          {product.displayName}
        </p>
        <p className="mt-1 text-xs text-text-secondary">
          {productPriceLine(product)}
        </p>
        <p className="mt-2 text-xs leading-relaxed text-text-muted">
          Plus unlocks AI Agenda generation, Assistant chat, task breakdowns,
          prioritization, and Memory-aware planning with fair-use limits.
        </p>
        <ul className="mt-2 space-y-1">
          {PLUS_FEATURES.map((feature) => (
            <li key={feature} className="flex items-center gap-2 text-xs text-text-secondary">
              <Check className="h-3.5 w-3.5 text-progress-high" />
              {feature}
            </li>
          ))}
        </ul>

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              void startPlusCheckout();
            }}
            disabled={disabled || allowsAi}
            className="inline-flex items-center justify-center gap-1.5 rounded-md bg-text-primary px-2 py-1.5 text-xs font-medium text-text-inverse transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {isPurchasing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            Subscribe
          </button>
          <button
            type="button"
            onClick={() => {
              void refresh();
            }}
            disabled={disabled}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-warm disabled:opacity-40"
          >
            {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
            Refresh
          </button>
        </div>

        <button
          type="button"
          onClick={() => {
            void manageBilling();
          }}
          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md border border-border px-2 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-warm"
        >
          Manage billing
          <ExternalLink className="h-3 w-3" />
        </button>

        <div className="mt-2 grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => {
              void invoke("open_terms_of_use");
            }}
            className="inline-flex items-center justify-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-warm"
          >
            Terms
            <ExternalLink className="h-3 w-3" />
          </button>
          <button
            type="button"
            onClick={() => {
              void invoke("open_privacy_policy");
            }}
            className="inline-flex items-center justify-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs font-medium text-text-secondary transition-colors hover:bg-surface-warm"
          >
            Privacy
            <ExternalLink className="h-3 w-3" />
          </button>
        </div>
        {errorText(error)}
      </div>
    </section>
  );
}
