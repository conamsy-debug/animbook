import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/router";

export default function NotFound() {
  const router = useRouter();
  useEffect(() => {
    if (typeof window === "undefined") return;
    document.title = "Page not found · AnimBook";
  }, []);
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div style={{ textAlign: "center" }}>
        <h1 style={{ fontFamily: "var(--serif)" }}>This page hasn't been animated yet.</h1>
        <p className="muted">The path {router.asPath} doesn't exist.</p>
        <Link href="/library" className="btn primary" style={{ marginTop: 16 }}>Back to the library</Link>
      </div>
    </div>
  );
}