import type { AppProps } from "next/app";
import Head from "next/head";
import { useEffect } from "react";
import { ClerkProvider } from "@clerk/nextjs";
import { ErrorBoundary, ErrorState } from "@/components/ErrorBoundary";
import { AuthBridge } from "@/components/AuthBridge";
import "@/styles/globals.css";

const PUBLISHABLE_KEY = process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY;

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
  // Clerk requires a publishable key. When it's missing (e.g. local smoke
  // builds without Clerk wired up), fall back to rendering without the
  // provider so the rest of the app still boots.
  if (!PUBLISHABLE_KEY) {
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
  return (
    <ClerkProvider
      publishableKey={PUBLISHABLE_KEY}
      signInUrl="/sign-in"
      signUpUrl="/sign-up"
      afterSignInUrl="/"
      afterSignUpUrl="/"
      appearance={{
        variables: {
          colorPrimary: "#C49A1C",
          colorText: "#F4E9D8",
          colorBackground: "#080C14",
          colorInputBackground: "#101521",
          colorInputText: "#F4E9D8"
        },
        elements: {
          card: { background: "#0F1422", border: "1px solid rgba(196, 154, 28, 0.3)" }
        }
      }}
    >
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
      <AuthBridge />
      <ErrorBoundary
        fallback={(err, reset) => (
          <ErrorState error={err} onRetry={reset} title="AnimBook ran into a snag" />
        )}
      >
        <Component {...pageProps} />
      </ErrorBoundary>
    </ClerkProvider>
  );
}
