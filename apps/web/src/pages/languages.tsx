import Head from "next/head";
import { Topbar } from "@/components/Topbar";
import { ErrorBoundary, ErrorState } from "@/components/ErrorBoundary";
import { Landing, NotAvailable } from "@/features/languages/Landing";
import { LANGUAGES_ENABLED } from "@/features/languages/config";

/**
 * /languages — AnimBook Languages landing (Section 7.1).
 *
 * Patch 01 ships the route + scaffold. The page:
 *   - renders nothing (NotAvailable) when the feature flag is off
 *   - otherwise renders <Landing />
 *
 * The wrapper carries both `lib-page` (so the cinematic topbar styles
 * and the rest of the site design tokens apply) and `lang-page` (so
 * the lang-* language-card grid styles apply). The shared shell +
 * design tokens come from `apps/web/src/styles/globals.css`.
 *
 * Next.js Pages Router can't drop a route conditionally at build time,
 * so the flag check lives in the component body. Production builds
 * with the flag off still emit /languages.html but it shows the
 * friendly NotAvailable screen.
 *
 * The base/instruction language for the UI defaults to English in
 * Patch 01. Patch 05 wires this to the user's onboarding choice and
 * the settings page.
 */
export default function LanguagesPage() {
  return (
    <div className="app-shell lib-page lang-page">
      <Head>
        <title>AnimBook Languages — learn through stories</title>
        <meta name="description" content="Learn a new language through animated stories you can watch, tap, and replay." />
      </Head>

      <Topbar variant="cinematic" />

      <main className="container lang-page-main">
        <ErrorBoundary
          fallback={(err, reset) => (
            <ErrorState error={err} onRetry={reset} title="Languages failed to load" />
          )}
        >
          {LANGUAGES_ENABLED ? <Landing locale="en" /> : <NotAvailable locale="en" />}
        </ErrorBoundary>
      </main>
    </div>
  );
}
