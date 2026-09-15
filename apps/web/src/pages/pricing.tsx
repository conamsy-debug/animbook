import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Head from "next/head";
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { LoadingState, EmptyState } from "@/components/States";
import { ErrorBoundary, ErrorState } from "@/components/ErrorBoundary";
import { apiFetch } from "@/lib/api";
import { useToastStore } from "@/lib/store";

interface Tier {
  id: string;
  name: string;
  blurb: string;
  monthlyUsd: number;
  yearlyUsd: number;
  stripeMonthlyPriceId: string;
  stripeYearlyPriceId: string;
  features: string[];
  cta: string;
  highlight?: boolean;
}

interface PricingResponse {
  currency: string;
  live: boolean;
  billingPortalAvailable: boolean;
  tiers: Tier[];
  lastUpdated: string;
}

export default function PricingPage() {
  const router = useRouter();
  const toast = useToastStore((s) => s.push);
  const [data, setData] = useState<PricingResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [billing, setBilling] = useState<"monthly" | "yearly">("yearly");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const json = await apiFetch<PricingResponse>("/api/legal/pricing");
        if (!cancelled) {
          setData(json);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  async function startCheckout(tier: Tier) {
    if (tier.id === "READER") {
      await router.push("/");
      return;
    }
    setBusy(tier.id);
    try {
      const res = await apiFetch<{ url: string }>("/api/subscriptions/checkout", {
        method: "POST",
        json: {
          plan: tier.id,
          billing,
          successUrl: `${window.location.origin}/profile?checkout=success`,
          cancelUrl: `${window.location.origin}/pricing?checkout=cancelled`
        }
      });
      window.location.href = res.url;
    } catch (err) {
      toast(`Could not start checkout: ${(err as Error).message}`);
      setBusy(null);
    }
  }

  if (loading) {
    return (
      <div className="app-shell">
        <Topbar />
        <main className="container"><LoadingState message="Loading pricing…" /></main>
      </div>
    );
  }
  if (error || !data) {
    return (
      <div className="app-shell">
        <Topbar />
        <main className="container">
          <EmptyState
            title="Pricing is offline"
            message={error ?? "Couldn't reach the AnimBook API."}
            cta={{ href: "/", label: "Back home" }}
          />
        </main>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Pricing · AnimBook</title>
        <meta name="description" content="AnimBook pricing — Reader, Premium, and Studio tiers." />
      </Head>
      <div className="app-shell">
        <Topbar />
        <ErrorBoundary
          fallback={(err, reset) => (
            <main className="container">
              <ErrorState error={err} onRetry={reset} title="Pricing failed to render" />
            </main>
          )}
        >
        <main className="container pricing-page">
          <header className="legal-header">
            <h1>Choose your AnimBook tier</h1>
            <p className="muted" style={{ maxWidth: 720 }}>
              Three tiers. Same Reader. Different reach. Switch any time from your{" "}
              <Link href="/profile">profile</Link>.
            </p>
            <div className="billing-toggle" role="tablist" aria-label="Billing period">
              <button
                role="tab"
                aria-selected={billing === "monthly"}
                onClick={() => setBilling("monthly")}
                className={billing === "monthly" ? "on" : ""}
                type="button"
              >
                Monthly
              </button>
              <button
                role="tab"
                aria-selected={billing === "yearly"}
                onClick={() => setBilling("yearly")}
                className={billing === "yearly" ? "on" : ""}
                type="button"
              >
                Yearly <span className="badge">save ~17%</span>
              </button>
            </div>
          </header>
          <div className="grid pricing-grid">
            {data.tiers.map((tier) => {
              const price = billing === "monthly" ? tier.monthlyUsd : tier.yearlyUsd;
              const billed = billing === "monthly" ? "month" : "year";
              return (
                <article
                  key={tier.id}
                  className="card pricing-card"
                  style={{
                    borderColor: tier.highlight ? "#C49A1C" : "rgba(196,154,28,0.2)",
                    boxShadow: tier.highlight ? "0 0 0 1px rgba(196,154,28,0.4)" : "none"
                  }}
                >
                  {tier.highlight ? <span className="world-pill" style={{ color: "#C49A1C" }}>Most chosen</span> : null}
                  <h2 style={{ marginTop: 12 }}>{tier.name}</h2>
                  <p className="muted">{tier.blurb}</p>
                  <p className="pricing-price">
                    {price === 0 ? (
                      <strong>Free</strong>
                    ) : (
                      <>
                        <strong style={{ fontSize: "2.5rem" }}>${price}</strong>{" "}
                        <span className="muted">/ {billed}</span>
                      </>
                    )}
                  </p>
                  <ul className="pricing-features">
                    {tier.features.map((f) => (
                      <li key={f}>{f}</li>
                    ))}
                  </ul>
                  <button
                    type="button"
                    className={`btn ${tier.highlight ? "primary" : ""}`}
                    onClick={() => startCheckout(tier)}
                    disabled={busy === tier.id}
                  >
                    {busy === tier.id ? "Opening checkout…" : tier.cta}
                  </button>
                  {tier.id === "READER" ? (
                    <p className="muted" style={{ fontSize: 12, marginTop: 8 }}>
                      Already a Reader. Refresh to keep your spot.
                    </p>
                  ) : null}
                </article>
              );
            })}
          </div>
          <p className="muted" style={{ marginTop: 24 }}>
            Prices in {data.currency}.{" "}
            <Link href="/legal/terms">Terms</Link> ·{" "}
            <Link href="/legal/privacy">Privacy</Link> ·{" "}
            <Link href="/legal/refund">Refunds</Link>
            {data.live ? null : (
              <span style={{ display: "block", marginTop: 8, opacity: 0.7 }}>
                Stripe is in demo mode. <code>STRIPE_SECRET_KEY</code> not set — checkout
                URLs will use a stub.
              </span>
            )}
          </p>
        </main>
        </ErrorBoundary>
      </div>
    </>
  );
}
