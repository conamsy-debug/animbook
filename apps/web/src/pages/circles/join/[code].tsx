import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import { Topbar } from "@/components/Topbar";
import { EmptyState, LoadingState } from "@/components/States";
import { joinCircle, previewInvite } from "@/lib/circles";
import { useToastStore } from "@/lib/store";

export default function JoinCirclePage() {
  const router = useRouter();
  const toast = useToastStore((s) => s.push);
  const code = typeof router.query.code === "string" ? router.query.code : null;
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof previewInvite>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!code) return;
    previewInvite(code)
      .then(setPreview)
      .catch((err) => setError((err as { details?: { error?: string } }).details?.error ?? "That invite isn't valid"));
  }, [code]);

  async function accept() {
    if (!code) return;
    setBusy(true);
    try {
      const id = await joinCircle(code);
      void router.push(`/circles/${id}`);
    } catch (err) {
      const detail = (err as { details?: { error?: string } }).details?.error;
      toast(detail ?? `Couldn't join: ${(err as Error).message}`);
      setBusy(false);
    }
  }

  return (
    <div className="app-shell">
      <Topbar />
      <main className="container">
        {error && <EmptyState title="Invite not valid" message={error} cta={{ href: "/circles", label: "Your circles" }} />}
        {!preview && !error && <LoadingState message="Checking the invite…" />}
        {preview && (
          <section className="gate-card">
            <span className="label">You&apos;ve been invited</span>
            <h1>{preview.name}</h1>
            <p className="muted">
              {preview.owner.name} invited you{preview.book ? ` to read ${preview.book.title} together` : " to a reading circle"}. There{" "}
              {preview._count.members === 1 ? "is 1 member" : `are ${preview._count.members} members`}.
            </p>
            <div className="hero-actions">
              <button type="button" className="btn primary" onClick={accept} disabled={busy}>
                {busy ? "Joining…" : preview.alreadyMember ? "Open the circle" : "Join the circle"}
              </button>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
