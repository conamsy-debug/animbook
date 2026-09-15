import type { AppProps } from "next/app";
import Head from "next/head";
import { useEffect } from "react";
import { ErrorBoundary, ErrorState } from "@/components/ErrorBoundary";
import "@/styles/globals.css";

export default function App({ Component, pageProps }: AppProps) {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker
        .register("/sw.js")
        .catch(() => {
          // Offline SW is a progressive enhancement; ignore failures.
        });
    }
  }, []);
  return (
    <>
      <Head>
        <title>AnimBook — a book that moves</title>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#080C14" />
        <meta
          name="description"
          content="AnimBook transforms text manuscripts into animated books. Every page becomes a living, narrated scene."
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600;700&family=DM+Mono:wght@400;500&family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </Head>
      <ErrorBoundary
        fallback={(err, reset) => (
          <ErrorState error={err} onRetry={reset} title="AnimBook ran into a snag" />
        )}
      >
        <Component {...pageProps} />
      </ErrorBoundary>
    </>
  );
}
