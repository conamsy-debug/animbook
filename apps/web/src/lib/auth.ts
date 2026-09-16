/**
 * Bridge between Clerk (a React context) and plain modules like apiFetch.
 *
 * <AuthBridge /> registers Clerk's `getToken` here once Clerk has loaded;
 * apiFetch awaits it so calls fired on first render still carry a token.
 */
export const authEnabled = Boolean(process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY);

export const AUTH_REQUIRED_EVENT = "animbook:auth-required";

type TokenGetter = () => Promise<string | null>;

let getter: TokenGetter | null = null;
let markReady: () => void = () => {};
const ready = new Promise<void>((resolve) => {
  markReady = resolve;
});

export function registerTokenGetter(fn: TokenGetter): void {
  getter = fn;
  markReady();
}

export async function getAuthToken(): Promise<string | null> {
  if (!authEnabled || typeof window === "undefined") return null;
  // Don't hang forever if Clerk fails to load (ad-blockers, offline).
  await Promise.race([ready, new Promise((r) => setTimeout(r, 5000))]);
  if (!getter) return null;
  try {
    return await getter();
  } catch {
    return null;
  }
}

export function announceAuthRequired(): void {
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(AUTH_REQUIRED_EVENT));
  }
}
