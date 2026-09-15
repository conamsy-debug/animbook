/**
 * AnimBook mobile — deep link handler.
 *
 * Expo-router already routes `animbook://read/<slug>` to `/read/<slug>`
 * automatically. This file logs the incoming URL during development and
 * exposes a tiny `useDeepLink` hook for components that want to react
 * to a deep link arriving while the app is foregrounded.
 */
import { useEffect, useState } from "react";
import * as Linking from "expo-linking";

export type DeepLink = { url: string; path: string; params: Record<string, string> } | null;

export function parseAnimLink(url: string | null): DeepLink {
  if (!url) return null;
  try {
    const u = new URL(url);
    const params: Record<string, string> = {};
    u.searchParams.forEach((v, k) => {
      params[k] = v;
    });
    return {
      url,
      path: u.pathname || u.host || "/",
      params
    };
  } catch {
    return { url, path: url, params: {} };
  }
}

export function useDeepLink(): DeepLink {
  const [link, setLink] = useState<DeepLink>(parseAnimLink(typeof window !== "undefined" ? window.location.href : null));

  useEffect(() => {
    const sub = Linking.addEventListener("url", (event) => {
      setLink(parseAnimLink(event.url));
    });
    Linking.getInitialURL().then((url) => setLink(parseAnimLink(url))).catch(() => undefined);
    return () => sub.remove();
  }, []);

  return link;
}

export default function NativeIntent() {
  const link = useDeepLink();
  useEffect(() => {
    if (link) {
      // eslint-disable-next-line no-console
      console.log(`[animbook-mobile] deep link: ${link.url} → ${link.path}`);
    }
  }, [link]);
  return null;
}