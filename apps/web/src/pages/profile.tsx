import { useEffect, useState } from "react";
import { Topbar } from "@/components/Topbar";
import { CommunityProfile } from "@/components/CommunityProfile";
import AuthorVoice from "@/components/AuthorVoice";
import { ErrorBoundary, ErrorState } from "@/components/ErrorBoundary";
import { LoadingState, EmptyState } from "@/components/States";
import { apiFetch, type LibraryEntry } from "@/lib/api";
import { useLibraryStore, useToastStore } from "@/lib/store";
import Link from "next/link";
import { SignInPrompt } from "@/components/SignInPrompt";

interface ProfileData {
  user: {
    id: string;
    email: string;
    name: string;
    tier: string;
    subscriptionStatus: string | null;
  };
  paymentsLive: boolean;
}

interface UsageSummary {
  windowStart: string;
  totalUsd: number;
  totalEvents: number;
  byKind: Array<{ kind: string; totalUsd: number; events: number }>;
  byProvider: Array<{ provider: string; totalUsd: number; events: number }>;
  byBook: Array<{ bookId: string; title: string; totalUsd: number; events: number }>;
  byDay: Array<{ date: string; totalUsd: number; events: number }>;
}

const KIND_LABEL: Record<string, string> = {
  ANIMATE_KICK: "Animate",
  STILL_KICK: "Stills",
  NARRATION_KICK: "Narration",
  AUDIO_REGEN: "Audio (per-page)",
  TRAILER: "Trailer"
};
const PROVIDER_LABEL: Record<string, string> = {
  RUNWAY: "Runway",
  ELEVENLABS: "ElevenLabs"
};

export default function ProfilePage() {
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [needsSignIn, setNeedsSignIn] = useState(false);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const library = useLibraryStore();
  const toast = useToastStore((s) => s.push);
  // window.Clerk is set by <ClerkProvider>; reading it (rather than useClerk)
  // keeps this page working in local builds that run without a Clerk key.
  const clerk = typeof window !== "undefined"
    ? ((window as unknown as { Clerk?: { signOut(o?: { redirectUrl?: string }): Promise<void>; openUserProfile(): void } }).Clerk)
    : undefined;
  const [busy, setBusy] = useState<"export" | "delete" | null>(null);

  async function exportData() {
    setBusy("export");
    try {
      const payload = await apiFetch<unknown>("/api/account/export");
      const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = `animbook-data-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      toast(`Could not export your data: ${(err as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function deleteAccount() {
    if (!window.confirm("Permanently delete your AnimBook account and all your data? This cannot be undone.")) return;
    setBusy("delete");
    try {
      await apiFetch("/api/account/delete", { method: "POST", json: { confirm: true } });
      toast("Your account has been deleted.");
      if (clerk) await clerk.signOut({ redirectUrl: "/" });
      else window.location.href = "/";
    } catch (err) {
      toast(`Could not delete account: ${(err as Error).message}`);
      setBusy(null);
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [me, lib, pricing, usageRes] = await Promise.all([
          apiFetch<{ user: ProfileData["user"] }>("/api/account/me"),
          apiFetch<{ items: LibraryEntry[] }>("/api/library").catch(() => ({ items: [] as LibraryEntry[] })),
          apiFetch<{ live: boolean }>("/api/legal/pricing").catch(() => ({ live: false })),
          // Cost summary: 30-day window. Failures here shouldn't break
          // the profile page (it's a leaf feature), so swallow.
          apiFetch<UsageSummary>("/api/usage/summary").catch(() => null)
        ]);
        if (!cancelled) {
          library.hydrate(lib.items);
          setData({ user: me.user, paymentsLive: pricing.live });
          setUsage(usageRes);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setNeedsSignIn((err as { status?: number }).status === 401);
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

  if (needsSignIn) {
    return (
      <div className="app-shell">
        <Topbar />
        <main className="container">
          <SignInPrompt message="Sign in to see your profile." />
        </main>
      </div>
    );
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
        </header>

        <div className="grid">
          <CommunityProfile />
          <AuthorVoice />
          <section className="card">
            <h3>Account</h3>
            <dl className="kvp">
              <dt>Name</dt>
              <dd>{dataReady.user.name}</dd>
              <dt>Email</dt>
              <dd>{dataReady.user.email}</dd>
              <dt>Plan</dt>
              <dd>{dataReady.user.tier === "BASIC" ? "Free" : dataReady.user.tier.charAt(0) + dataReady.user.tier.slice(1).toLowerCase()}</dd>
            </dl>
            <div style={{ flex: 1 }} />
            {dataReady.paymentsLive ? (
              <button type="button" className="btn primary" onClick={startCheckout}>
                Upgrade to Premium
              </button>
            ) : (
              <p className="muted" style={{ fontSize: 14 }}>
                Premium plans are coming soon. During early access every reader gets the full library.{" "}
                <Link href="/pricing">See plans</Link>
              </p>
            )}
            {process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ? (
              <button type="button" className="btn ghost" onClick={() => clerk?.openUserProfile()}>
                Manage sign-in &amp; security
              </button>
            ) : null}
          </section>
          <section className="card">
            <h3>Library</h3>
            {library.entries.length === 0 ? (
              <EmptyState
                title="Your library is empty"
                message="Open a book and tap Save · it will show up here with progress and mode."
                cta={{ href: "/library", label: "Browse the library" }}
              />
            ) : (
              <ul>
                {library.entries.map((entry) => (
                  <li key={entry.id}>
                    <Link href={`/read/${entry.book?.slug ?? entry.bookId}`}>{entry.book?.title ?? "Untitled"}</Link>
                    {" · "}
                    {entry.completed ? "Finished" : `Page ${entry.progressPage} of ${entry.book?.totalPages ?? "?"}`}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="card">
            <h3>Your data</h3>
            <p className="muted">Export everything we hold about you, or remove your account.</p>
            <div style={{ flex: 1 }} />
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" className="btn" disabled={busy !== null} onClick={exportData}>
                {busy === "export" ? "Preparing…" : "Download my data"}
              </button>
              <button
                type="button"
                className="btn"
                style={{ borderColor: "#C94B32" }}
                disabled={busy !== null}
                onClick={deleteAccount}
              >
                {busy === "delete" ? "Deleting…" : "Delete my account"}
              </button>
            </div>
            <p className="muted" style={{ marginTop: 12, fontSize: 13 }}>
              <Link href="/legal/privacy">Privacy</Link> · <Link href="/legal/terms">Terms</Link>
            </p>
          </section>
          <section className="card">
            <h3>Spending</h3>
            {!usage ? (
              <p className="muted">Cost tracking is loading or unavailable.</p>
            ) : usage.totalEvents === 0 ? (
              <p className="muted">No tracked spend in the last 30 days.</p>
            ) : (
              <>
                <p className="kvp-line">
                  <strong>Last 30 days</strong>
                  <span style={{ fontSize: 22, fontFamily: "DM Mono, monospace" }}>${usage.totalUsd.toFixed(2)}</span>
                </p>
                {usage.byKind.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <p className="muted" style={{ marginBottom: 4, fontSize: 13 }}>By category</p>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {usage.byKind.map((k) => (
                        <li key={k.kind} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                          <span>{KIND_LABEL[k.kind] ?? k.kind} · {k.events}</span>
                          <span style={{ fontFamily: "DM Mono, monospace" }}>${k.totalUsd.toFixed(2)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {usage.byProvider.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <p className="muted" style={{ marginBottom: 4, fontSize: 13 }}>By provider</p>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {usage.byProvider.map((p) => (
                        <li key={p.provider} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                          <span>{PROVIDER_LABEL[p.provider] ?? p.provider} · {p.events}</span>
                          <span style={{ fontFamily: "DM Mono, monospace" }}>${p.totalUsd.toFixed(2)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {usage.byBook.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <p className="muted" style={{ marginBottom: 4, fontSize: 13 }}>By book</p>
                    <ul style={{ margin: 0, paddingLeft: 16 }}>
                      {usage.byBook.slice(0, 5).map((b) => (
                        <li key={b.bookId} style={{ display: "flex", justifyContent: "space-between", padding: "2px 0" }}>
                          <span>{b.title} · {b.events}</span>
                          <span style={{ fontFamily: "DM Mono, monospace" }}>${b.totalUsd.toFixed(2)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      </main>
      </ErrorBoundary>
    </div>
  );
}