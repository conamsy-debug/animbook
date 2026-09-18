import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/router";
import { useState } from "react";
import { toggleFollow } from "@/lib/community";
import { useToastStore } from "@/lib/store";

const HAS_CLERK = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export function FollowButton({ authorId, authorName }: { authorId: string; authorName: string }) {
  // Hooks from Clerk only work inside its provider, which a keyless build lacks.
  if (!HAS_CLERK) return null;
  return <FollowButtonInner authorId={authorId} authorName={authorName} />;
}

function FollowButtonInner({ authorId, authorName }: { authorId: string; authorName: string }) {
  const router = useRouter();
  const toast = useToastStore((s) => s.push);
  const { isSignedIn } = useAuth();
  const [following, setFollowing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onClick() {
    if (!isSignedIn) {
      void router.push(`/sign-up?redirect_url=${encodeURIComponent(router.asPath)}`);
      return;
    }
    setBusy(true);
    try {
      const now = await toggleFollow(authorId);
      setFollowing(now);
      toast(now ? `Following ${authorName}` : `Unfollowed ${authorName}`);
    } catch (err) {
      toast(`Couldn't update: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button type="button" className={`btn ${following ? "" : "primary"}`} onClick={onClick} disabled={busy}>
      {busy ? "…" : following ? "Following" : "Follow"}
    </button>
  );
}
