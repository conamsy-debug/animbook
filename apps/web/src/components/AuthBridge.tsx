import { useAuth } from "@clerk/nextjs";
import { useEffect, useRef, useState } from "react";
import { AUTH_REQUIRED_EVENT, registerTokenGetter } from "@/lib/auth";
import { SignInPrompt } from "@/components/SignInPrompt";

/**
 * Mounted once in _app inside <ClerkProvider>.
 *  - hands Clerk's getToken to apiFetch so every API call carries the session
 *  - reloads when the reader signs in or out, so data that 401'd refetches
 *  - shows a sign-in banner when an API call returns 401 while signed out
 */
export function AuthBridge() {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [needsAuth, setNeedsAuth] = useState(false);
  const previous = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    if (!isLoaded) return;
    registerTokenGetter(() => getToken());
  }, [isLoaded, getToken]);

  useEffect(() => {
    if (!isLoaded) return;
    if (previous.current !== undefined && previous.current !== isSignedIn) {
      window.location.reload();
    }
    previous.current = isSignedIn;
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    const onAuthRequired = () => setNeedsAuth(true);
    window.addEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
    return () => window.removeEventListener(AUTH_REQUIRED_EVENT, onAuthRequired);
  }, []);

  if (!isLoaded || isSignedIn || !needsAuth) return null;
  return (
    <div className="auth-banner" role="region" aria-label="Sign in required">
      <SignInPrompt />
      <button type="button" className="auth-banner-close" aria-label="Dismiss" onClick={() => setNeedsAuth(false)}>
        ×
      </button>
    </div>
  );
}
