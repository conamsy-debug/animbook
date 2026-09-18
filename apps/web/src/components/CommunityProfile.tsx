import { useEffect, useState } from "react";
import Link from "next/link";
import { getFollowing, getMyProfile, saveMyProfile, type MyProfile } from "@/lib/community";
import { useToastStore } from "@/lib/store";

/** Public profile settings and the authors you follow. */
export function CommunityProfile() {
  const toast = useToastStore((s) => s.push);
  const [me, setMe] = useState<MyProfile | null>(null);
  const [handle, setHandle] = useState("");
  const [bio, setBio] = useState("");
  const [messagesOpen, setMessagesOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [following, setFollowing] = useState<{ id: string; name: string; handle: string }[]>([]);

  useEffect(() => {
    getMyProfile()
      .then((profile) => {
        if (!profile) return;
        setMe(profile);
        setHandle(profile.handle ?? "");
        setBio(profile.bio ?? "");
        setMessagesOpen(profile.messagesOpen);
      })
      .catch(() => undefined);
    getFollowing()
      .then((items) => setFollowing(items.map((i) => i.author)))
      .catch(() => undefined);
  }, []);

  async function save() {
    setBusy(true);
    try {
      const saved = await saveMyProfile({
        handle: handle.trim().toLowerCase() || undefined,
        bio: bio.trim(),
        messagesOpen
      });
      setMe((prev) => (prev ? { ...prev, ...saved } : prev));
      toast("Profile saved");
    } catch (err) {
      const detail = (err as { details?: { error?: string } }).details?.error;
      toast(detail ?? `Couldn't save: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (me?.communityDisabled) {
    return (
      <section className="card">
        <h3>Community</h3>
        <p className="muted">Community features are switched off for this account.</p>
      </section>
    );
  }

  return (
    <section className="card community-card">
      <h3>Your public page</h3>
      <p className="muted small">
        Readers see this when they open your author page. Your email is never shown.
      </p>
      <label className="field">
        <span>Handle</span>
        <span className="handle-input">
          <span>@</span>
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value.replace(/[^A-Za-z0-9_-]/g, "").toLowerCase())}
            placeholder="yourname"
            maxLength={24}
          />
        </span>
      </label>
      <label className="field">
        <span>Short bio</span>
        <textarea value={bio} onChange={(e) => setBio(e.target.value)} rows={3} maxLength={400} placeholder="A line or two about you and what you write." />
      </label>
      <label className="switch-row">
        <input type="checkbox" checked={messagesOpen} onChange={(e) => setMessagesOpen(e.target.checked)} />
        <span>Let readers message me about my books</span>
      </label>
      <div className="panel-actions">
        {me?.handle && (
          <Link className="btn ghost" href={`/author/${me.handle}`}>
            View my page
          </Link>
        )}
        <button type="button" className="btn primary" onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
      </div>

      <h3 style={{ marginTop: 28 }}>Following</h3>
      {following.length === 0 ? (
        <p className="muted small">You aren&apos;t following anyone yet. Open a book and follow its author.</p>
      ) : (
        <ul className="following-list">
          {following.map((author) => (
            <li key={author.id}>
              <Link href={`/author/${author.handle}`}>
                <strong>{author.name}</strong>
                <small>@{author.handle}</small>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
