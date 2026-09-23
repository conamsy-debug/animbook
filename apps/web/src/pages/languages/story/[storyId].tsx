import Head from "next/head";
import { useRouter } from "next/router";
import { Topbar } from "@/components/Topbar";
import { ErrorBoundary, ErrorState } from "@/components/ErrorBoundary";
import { StoryPlayer } from "@/features/languages/StoryPlayer";
import { LANGUAGES_ENABLED } from "@/features/languages/config";
import { storyIdFromParts } from "@/features/languages/api";
import type { BaseLang } from "@/features/languages/types";

/**
 * /languages/story/[storyId] — the story player route (Patch 04).
 *
 * URL shape: `/languages/story/<masterSlug>/<targetLang>?base=fr`.
 * The page builds the synthetic storyId the API expects
 * (`story:<masterSlug>:<targetLang>`) and renders the StoryPlayer.
 *
 * The `base` query param selects the translation language and
 * defaults to "en". Patch 05 will read it from the learner's
 * enrollment row instead.
 *
 * LANGUAGES_ENABLED off → render a friendly fallback (the flag
 * already hides the Topbar link, but the URL is still reachable).
 */
export default function LanguagesStoryPage() {
  const router = useRouter();
  const { storyId: rawStoryId, targetLang } = router.query;
  const baseRaw = router.query["base"];
  const base = (Array.isArray(baseRaw) ? baseRaw[0] : baseRaw) as BaseLang | undefined;

  if (!LANGUAGES_ENABLED) {
    return <NotAvailable />;
  }

  // Build storyId from the URL pieces. We accept either the
  // composite `story:<slug>:<lang>` shape OR a pair of path
  // segments (`<slug>/<targetLang>`). The StoryPlayer passes
  // through to the server which validates the format.
  const storyId = Array.isArray(rawStoryId)
    ? rawStoryId.join("/")
    : typeof rawStoryId === "string"
    ? rawStoryId
    : typeof rawStoryId === "string" && targetLang
    ? storyIdFromParts(rawStoryId, Array.isArray(targetLang) ? targetLang[0]! : targetLang)
    : "";

  if (!storyId) {
    return <BadUrlFallback />;
  }

  const normalisedBase: BaseLang = base === "fr" ? "fr" : "en";

  return (
    <div className="app-shell">
      <Head>
        <title>AnimBook Languages — story player</title>
      </Head>

      <Topbar variant="cinematic" />

      <ErrorBoundary
        fallback={(err, reset) => (
          <main className="container">
            <ErrorState error={err} onRetry={reset} title="Story player failed to load" />
          </main>
        )}
      >
        <main className="container lang-story-page">
          <StoryPlayer storyId={storyId} base={normalisedBase} />
        </main>
      </ErrorBoundary>
    </div>
  );
}

function NotAvailable() {
  return (
    <div className="app-shell">
      <Head>
        <title>AnimBook Languages — coming soon</title>
      </Head>
      <Topbar variant="cinematic" />
      <main className="container lang-story-page">
        <div className="lang-player lang-player--error">
          <p>AnimBook Languages isn't available yet.</p>
        </div>
      </main>
    </div>
  );
}

function BadUrlFallback() {
  return (
    <div className="app-shell">
      <Head>
        <title>AnimBook Languages — story not found</title>
      </Head>
      <Topbar variant="cinematic" />
      <main className="container lang-story-page">
        <div className="lang-player lang-player--error" role="alert">
          <p>This story URL doesn't look right. Open a story from the course home.</p>
        </div>
      </main>
    </div>
  );
}
