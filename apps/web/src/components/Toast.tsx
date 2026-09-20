import { useToastStore } from "@/lib/store";

/**
 * Global toast renderer. Reads from `useToastStore` (a tiny zustand
 * store) and surfaces the latest message in the bottom-left corner
 * for ~2.4s. Mounted once at the app shell so any component can
 * call `toast("...")` and have it actually appear.
 *
 * Until this component existed, every `toast()` call across the app
 * (Reader, Network, Companion, Live, EDU, etc.) was silently
 * invisible — the message landed in the store but nothing read it.
 */
export function Toast() {
  const message = useToastStore((s) => s.message);
  const dismiss = useToastStore((s) => s.dismiss);
  if (!message) return null;
  return (
    <div className="toast-shell" role="status" aria-live="polite" onClick={dismiss}>
      <span className="toast-message">{message}</span>
    </div>
  );
}
