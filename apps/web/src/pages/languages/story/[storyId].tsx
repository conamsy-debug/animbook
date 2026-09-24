import Head from "next/head";
import { useRouter } from "next/router";
import { useEffect, useRef, useState } from "react";
import { Topbar } from "@/components/Topbar";
import { ErrorBoundary, ErrorState } from "@/components/ErrorBoundary";
import { StoryPlayer } from "@/features/languages/StoryPlayer";
import { LANGUAGES_ENABLED } from "@/features/languages/config";
import { saveStoryProgress, storyIdFromParts } from "@/features/languages/api";
import type { BaseLang } from "@/features/languages/types";

/**
 * /languages/story/[storyId] — the story player route (Patch 04 +
 * Patch 05 progress save).
 *
 * URL shape: `/languages/story/<masterSlug>/<targetLang>?base=fr`.
 * The page builds the synthetic storyId the API expects
 * (`story:<masterSlug>:<targetLang>`) and renders the StoryPlayer.
 *
 * Patch 05 adds progress save — the StoryPlayer fires `onSceneChange`
 * once per scene (and again with `completed: true` at the end). The
 * page forwards each event to `POST /api/lang/stories/:storyId/progress`
 * via `saveStoryProgress()`. The last call wins (idempotent upsert),
 * so re-entering a story picks up where the learner left off.
 *
 * `base` query param defaults to "en"; Patch 05 reads it from the
 * URL only — the enrollment row also carries the base, so a future
 * patch can pull it from the LearnerStats row instead.
 *
 * LANGUAGES_ENABLED off → render a friendly fallback (the flag
 * already hides the Topbar link, but the URL is still reachable).
 */
export default function LanguagesStoryPage() {
  const router = useRouter();
  const { storyId: rawStoryId, targetLang } = router.query;
  const baseRaw = router.query["base"];
  const base = (Array.isArray(baseRaw) ? baseRaw[0] : baseRaw) as BaseLang | undefined;

  // Track the last-saved scene so a re-render that doesn't change
  // scene doesn't re-POST. The StoryPlayer also dedupes via a ref,
  // but this keeps the network call off the happy path entirely.
  const lastSavedSceneRef = useRef<number>(-1);
  const [saveToast, setSaveToast] = useState<"idle" | "saved" | "error">("idle");

  useEffect(() => {
    if (!router.isReady) return;
    // Reset the saved scene when the URL storyId changes — a fresh
    // story gets a fresh "scene 0 viewed" save on mount.
    lastSavedSceneRef.current = -1;
    setSaveToast("idle");
  }, [router.isReady, router.asPath]);

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

  const onSceneChange = ({ sceneIndex, completed }: { sceneIndex: number; completed: boolean }) => {
    if (sceneIndex === lastSavedSceneRef.current && !completed) return;
    lastSavedSceneRef.current = sceneIndex;
    setSaveToast("idle");
    saveStoryProgress({
      storyId,
      lastSceneOrder: sceneIndex + 1,
      completed
    })
      .then(() => setSaveToast("saved"))
      .catch(() => setSaveToast("error"));
  };

  return (
    <div className="app-shell lib-page lang-page">
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
          <StoryPlayer
            storyId={storyId}
            base={normalisedBase}
            onSceneChange={onSceneChange}
          />
          <p
            className={
              "lang-story-save-toast lang-story-save-toast--" + saveToast
            }
            aria-live="polite"
          >
            {saveToast === "saved"
              ? "Saved"
              : saveToast === "error"
              ? "Save failed"
              : ""}
          </p>
        </main>
      </ErrorBoundary>
    </div>
  );
}

function NotAvailable() {
  return (
    <div className="app-shell lib-page lang-page">
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
    <div className="app-shell lib-page lang-page">
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