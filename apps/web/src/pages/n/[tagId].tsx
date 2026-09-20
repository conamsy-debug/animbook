import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { Topbar } from "@/components/Topbar";

/**
 * Public landing page for an NFC tag tap. Same shape as /s/[marker]
 * but reads the NFC resolver. The Reader knows how to deep-link from
 * NFC triggers (chrome on Android surfaces the URL after the tap).
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

export default function ScanNfcPage() {
  const router = useRouter();
  const tagId = typeof router.query.tagId === "string" ? router.query.tagId : null;
  const [data, setData] = useState<ScanResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!tagId) return;
    let cancelled = false;
    fetch(`https://api.animbook.com/api/studio-pro/scan/nfc/${encodeURIComponent(tagId)}`)
      .then(async (r) => {
        if (cancelled) return;
        if (!r.ok) {
          setError("This AnimBook NFC tag isn't in our system yet.");
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
  }, [tagId]);

  useEffect(() => {
    if (!data?.book?.slug || !data.link) return;
    const handle = window.setTimeout(() => {
      router.push(`/read/${data.book!.slug}?from=nfc&page=${data.link.anchorPage}&linkId=${data.link.id}`);
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
              <p className="label">AnimBook Companion · NFC</p>
              <h1>Hmm.</h1>
              <p className="scan-error">{error}</p>
              <p className="scan-meta">Tag: <code>{tagId}</code></p>
              <Link href="/library" className="scan-cta" style={{ marginTop: 24 }}>
                Browse the library →
              </Link>
            </>
          ) : !data ? (
            <>
              <p className="label">AnimBook Companion · NFC</p>
              <h1>Reading your NFC tag…</h1>
              <p className="scan-meta"><code>{tagId}</code></p>
            </>
          ) : data.book ? (
            <>
              <p className="label">AnimBook Companion · NFC</p>
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
                href={`/read/${data.book.slug}?from=nfc&page=${data.link.anchorPage}&linkId=${data.link.id}`}
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
              <p className="label">AnimBook Companion · NFC</p>
              <h1>Tag found, but the book isn't published.</h1>
              <Link href="/library" className="scan-cta">Browse the library →</Link>
            </>
          )}
        </div>
      </main>
    </div>
  );
}
