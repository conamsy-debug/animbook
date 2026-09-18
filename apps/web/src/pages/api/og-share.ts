// Server-side data fetcher for /share/[token].tsx OG tags.
// Reuses the API surface from the API service rather than opening another
// connection to the DB — simpler routing, same auth model.
import type { GetServerSideProps } from "next";

export type ShareLandingData = {
  token: string;
  status: string;
  hook: string;
  trailerUrl: string | null;
  thumbnailUrl: string | null;
  failureReason: string | null;
  book: {
    id: string;
    slug: string;
    title: string;
    subtitle: string | null;
    author: string;
    coverUrl: string | null;
    synopsis: string;
    vertical: string;
  };
  bookUrl: string;
};

async function fetchShare(token: string, host: string, protocol: string): Promise<ShareLandingData | null> {
  // Prefer an internal API base if set (Railway → Railway), otherwise
  // fall back to a same-origin lookup using the request host.
  const apiBase = process.env.INTERNAL_API_URL
    ?? `${protocol}://${host}`;
  try {
    const r = await fetch(`${apiBase}/api/share/${encodeURIComponent(token)}`, {
      headers: { accept: "application/json" },
      // Always probe fresh — we WANT the click recorded server-side.
      cache: "no-store"
    });
    if (!r.ok) return null;
    return (await r.json()) as ShareLandingData;
  } catch {
    return null;
  }
}

export const getShareServerSideProps: GetServerSideProps<{ share: ShareLandingData | null; token: string }> = async (ctx) => {
  const tokenParam = ctx.params?.["token"];
  const token = typeof tokenParam === "string" ? tokenParam : "";
  const proto = (ctx.req.headers["x-forwarded-proto"] as string | undefined) ?? "https";
  const host = ctx.req.headers.host ?? "animbook.com";
  const share = await fetchShare(token, host, proto);
  // Setting notFound makes Next render a 404 — clean for bot scrapers too.
  if (!share) return { notFound: true };
  return { props: { share, token } };
};
