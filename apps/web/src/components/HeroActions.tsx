import { useAuth } from "@clerk/nextjs";
import Link from "next/link";

const HAS_CLERK = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

function SignedOutActions() {
  return (
    <>
      <Link className="btn primary" href="/sign-up?redirect_url=%2Flibrary">
        Get started free
      </Link>
      <Link className="btn ghost" href="/sign-in?redirect_url=%2Flibrary">
        Sign in
      </Link>
    </>
  );
}

function AuthAwareActions() {
  const { isSignedIn } = useAuth();
  // Shown while sign-in is still loading too, so the buttons never disappear.
  if (!isSignedIn) return <SignedOutActions />;
  return (
    <Link className="btn primary" href="/library">
      Open the library
    </Link>
  );
}

export function HeroActions() {
  return (
    <div className="hero-actions">
      {HAS_CLERK ? <AuthAwareActions /> : <SignedOutActions />}
      <Link className="btn" href="/studio">
        Create in Studio
      </Link>
    </div>
  );
}
