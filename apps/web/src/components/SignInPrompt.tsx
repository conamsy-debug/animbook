import Link from "next/link";

/** Shown wherever an API call needs a signed-in reader. Uses the /sign-in and /sign-up pages. */
export function SignInPrompt({ message }: { message?: string }) {
  const redirect = typeof window !== "undefined" ? encodeURIComponent(window.location.pathname + window.location.search) : "";
  const q = redirect ? `?redirect_url=${redirect}` : "";
  return (
    <div className="signin-prompt">
      <p>{message ?? "Sign in to see this. Your library, studio projects and reading progress live in your account."}</p>
      <div className="signin-prompt-actions">
        <Link href={`/sign-in${q}`} className="btn ghost">Sign In</Link>
        <Link href={`/sign-up${q}`} className="btn primary">Create free account</Link>
      </div>
    </div>
  );
}
