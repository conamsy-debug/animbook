import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Topbar } from "@/components/Topbar";

/**
 * Public landing page for an AR-marker scan. When someone points their
 * phone at an AnimBook cover and the marker resolves, the camera app
 * opens this URL. We then redirect them straight into the Reader at
 * the anchor page the author pinned for this Companion link.
 *
 * The page is server-friendly: it renders an SSR-friendly "Opening
 * AnimBook [Title]…" shell, then the client-side effect looks up the
 * marker and either:
 *   - shows the book cover + an "Open AnimBook →" CTA
 *   - auto-redirects after a short delay
 *   - shows a graceful error if the marker isn't recognised
 *
 * We never silently fail — there's always a button to fall back on.
 */

interface ScanResponse {
  book: {
    id: string;
    slug: string;
    title: string;
    coverUrl: string | null;
    vertical: string;
  } | null;
  link: {
    id: string;
    anchorPage: number;
    experienceMode: string;
  };
}

export default function ScanMarkerPage() {
  const router = useRouter();
  const marker = typeof router.query.marker === "string" ? router.query.marker : null;
  const [data, setData] = useState<ScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!marker) return;
    let cancelled = false;
    fetch(`https://api.animbook.com/api/studio-pro/scan/marker/${encodeURIComponent(marker)}`)
      .then(async (r) => {
        if (cancelled) return;
        if (!r.ok) {
          setError("This AnimBook marker isn't in our system yet.");
          return;
        }
        const json = (await r.json()) as ScanResponse;
        setData(json);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Couldn't reach AnimBook");
      });
    return () => {
      cancelled = true;
    };
  }, [marker]);

  // Auto-redirect once we know the book, with a short delay so the
  // reader sees the cover for half a beat.
  useEffect(() => {
    if (!data?.book?.slug || !data.link) return;
    const handle = window.setTimeout(() => {
      const page = Math.max(1, data.link.anchorPage);
      router.push(`/read/${data.book!.slug}?from=companion&page=${page}&linkId=${data.link.id}`);
    }, 1100);
    return () => window.clearTimeout(handle);
  }, [data, router]);

  return (
    <div className="app-shell">
      <Topbar />
      <main className="container">
        <div className="scan-landing">
          {error ? (
            <>
              <p className="label">AnimBook Companion</p>
              <h1>Hmm.</h1>
              <p className="scan-error">{error}</p>
              <p className="scan-meta">Marker: <code>{marker}</code></p>
              <Link href="/library" className="scan-cta" style={{ marginTop: 24 }}>
                Browse the library →
              </Link>
            </>
          ) : !data ? (
            <>
              <p className="label">AnimBook Companion</p>
              <h1>Looking up your marker…</h1>
              <p className="scan-meta"><code>{marker}</code></p>
            </>
          ) : data.book ? (
            <>
              <p className="label">AnimBook Companion</p>
              {data.book.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={data.book.coverUrl}
                  alt={data.book.title}
                  className="scan-cover"
                />
              ) : null}
              <h1>{data.book.title}</h1>
              <p className="scan-meta">
                Anchor page {data.link.anchorPage} · {data.link.experienceMode.replace("_", " ").toLowerCase()}
              </p>
              <Link
                href={`/read/${data.book.slug}?from=companion&page=${data.link.anchorPage}&linkId=${data.link.id}`}
                className="scan-cta"
              >
                Open AnimBook →
              </Link>
              <p className="scan-meta" style={{ marginTop: 14 }}>
                Auto-opening in a moment…
              </p>
            </>
          ) : (
            <>
              <p className="label">AnimBook Companion</p>
              <h1>Marker found, but the book isn't published.</h1>
              <Link href="/library" className="scan-cta">Browse the library →</Link>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
