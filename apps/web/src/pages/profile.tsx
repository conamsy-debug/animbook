import { useEffect, useState } from "react";
import { Topbar } from "@/components/Topbar";
import { ErrorBoundary, ErrorState } from "@/components/ErrorBoundary";
import { LoadingState, EmptyState } from "@/components/States";
import { apiFetch } from "@/lib/api";
import { useLibraryStore, useToastStore } from "@/lib/store";
import Link from "next/link";

interface ProfileData {
  user: {
    id: string;
    email: string;
    name: string;
    tier: string;
    subscriptionStatus: string | null;
  };
  integrations: Record<string, boolean>;
}

export default function ProfilePage() {
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const library = useLibraryStore();
  const toast = useToastStore((s) => s.push);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const integrations = await apiFetch<{ integrations: Record<string, boolean> }>("/api/health");
        const fakeUser = {
          id: "demo",
          email: "demo@animbook.com",
          name: "AnimBook Reader",
          tier: "PREMIUM",
          subscriptionStatus: "ACTIVE"
        };
        if (!cancelled) {
          setData({ user: fakeUser, integrations: integrations.integrations });
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function startCheckout() {
    try {
      const res = await apiFetch<{ url: string; source: string }>("/api/subscriptions/checkout", {
        method: "POST",
        json: {
          plan: "PREMIUM",
          successUrl: `${window.location.origin}/profile?demo=1`,
          cancelUrl: `${window.location.origin}/profile?demo=cancelled`
        }
      });
      window.location.href = res.url;
    } catch (err) {
      toast(`Could not start checkout: ${(err as Error).message}`);
    }
  }

  if (error) {
    return (
      <div className="app-shell">
        <Topbar />
        <main className="container">
          <EmptyState title="Profile offline" message={error} cta={{ href: "/", label: "Back home" }} />
        </main>
      </div>
    );
  }

  if (loading || !data) {
    return (
      <div className="app-shell">
        <Topbar />
        <main className="container">
          <LoadingState message="Loading your profile…" />
        </main>
      </div>
    );
  }

  const dataReady = data!;

  return (
    <div className="app-shell">
      <Topbar />
      <ErrorBoundary
        fallback={(err, reset) => (
          <main className="container">
            <ErrorState error={err} onRetry={reset} title="Profile failed to render" />
          </main>
        )}
      >
      <main className="container">
        <header className="section-header">
          <div className="left">
            <span className="dot" style={{ background: "#C49A1C" }} />
            <h1>Your profile</h1>
          </div>
          <span className="label">11 phases shipped</span>
        </header>

        <div className="grid">
          <section className="card">
            <h3>Account</h3>
            <dl className="kvp">
              <dt>Email</dt>
              <dd>{dataReady.user.email}</dd>
              <dt>Name</dt>
              <dd>{dataReady.user.name}</dd>
              <dt>Tier</dt>
              <dd>{dataReady.user.tier}</dd>
              <dt>Status</dt>
              <dd>{dataReady.user.subscriptionStatus ?? "—"}</dd>
            </dl>
            <button type="button" className="btn" onClick={startCheckout}>
              Upgrade · Premium
            </button>
          </section>
          <section className="card">
            <h3>Library</h3>
            {library.entries.length === 0 ? (
              <EmptyState
                title="Your library is empty"
                message="Open a book and tap Save · it will show up here with progress and mode."
                cta={{ href: "/", label: "Browse the library" }}
              />
            ) : (
              <ul>
                {library.entries.map((entry) => (
                  <li key={entry.id}>
                    Page {entry.progressPage} · Mode {entry.mode} · {entry.completed ? "complete" : "in progress"}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card">
            <h3>AI integrations</h3>
            <ul>
              {Object.entries(dataReady.integrations).map(([name, enabled]) => (
                <li key={name}>
                  <strong>{name}</strong>: {enabled ? "live" : "fallback"}
                </li>
              ))}
            </ul>
            <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
              <Link href="/pricing">View pricing</Link> · <Link href="/legal/privacy">Privacy</Link> · <Link href="/legal/terms">Terms</Link>
            </p>
          </section>
          <section className="card">
            <h3>Your data</h3>
            <p className="muted">Export everything we hold about you, or remove your account.</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button
                type="button"
                className="btn"
                onClick={() => window.open("/api/account/export", "_blank")}
              >
                Export my data (GDPR)
              </button>
              <button
                type="button"
                className="btn"
                style={{ borderColor: "#C94B32" }}
                onClick={async () => {
                  if (!window.confirm("Permanently delete your account and all data?")) return;
                  try {
                    await apiFetch("/api/account/delete", { method: "POST", json: { confirm: true } });
                    toast("Account removed. Signing you out.");
                  } catch (err) {
                    toast(`Could not delete account: ${(err as Error).message}`);
                  }
                }}
              >
                Delete my account
              </button>
            </div>
          </section>
        </div>
      </main>
      </ErrorBoundary>
    </div>
  );
}