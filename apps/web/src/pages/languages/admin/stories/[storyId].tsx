import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Topbar } from "@/components/Topbar";
import { ErrorBoundary, ErrorState } from "@/components/ErrorBoundary";
import { LANGUAGES_ENABLED } from "@/features/languages/config";
import {
  approveStory,
  fetchAdminStory,
  regenerateLineAudio,
  rejectStory,
  saveAdminStoryEdits,
  type ReviewStoryDetail
} from "@/features/languages/api";

/**
 * /languages/admin/stories/[storyId] — Patch 12 story review detail.
 *
 * One round-trip fetches the full tree (scenes → lines → exercises).
 * The reviewer can:
 *
 *   1. Edit a line's `text` / `textReading` / `translations` / `audioUrl`
 *      inline and save all edits in one PUT.
 *   2. Hit "Regenerate audio" on a single line — calls
 *      /admin/lines/:id/regenerate-audio and patches the row in place.
 *   3. Approve the story (publishes) or reject with notes.
 *
 * Edits are buffered locally (`localEdits` keyed by lineId) so the
 * reviewer can tweak 10 lines and save them all in one PUT. Saving
 * replaces the displayed detail with the server's response.
 */
export default function LanguagesAdminStoryDetailPage() {
  const router = useRouter();
  const rawId = router.query["storyId"];
  const storyId = Array.isArray(rawId) ? rawId[0] : rawId;

  const [detail, setDetail] = useState<ReviewStoryDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionToast, setActionToast] = useState<{
    kind: "ok" | "err";
    msg: string;
  } | null>(null);
  // lineId → partial override applied on top of `detail`
  const [localEdits, setLocalEdits] = useState<
    Record<string, { text?: string; textReading?: string | null; audioUrl?: string | null }>
  >({});

  // Audio playback — one shared <audio> element so only one line
  // ever plays. `playingLineId` tracks which line is currently
  // emitting sound; `currentLineIdRef` carries the latest chosen
  // lineId from the click handler so onPlay / onPause / onEnded can
  // resolve it without depending on DOM dataset attributes.
  // `audioVersions` is a per-line cache-bust counter that gets bumped
  // every time the row's audio is regenerated so the browser
  // refetches even when the URL path is the same.
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const currentLineIdRef = useRef<string | null>(null);
  const [playingLineId, setPlayingLineId] = useState<string | null>(null);
  const [audioVersions, setAudioVersions] = useState<Record<string, number>>({});

  const reload = useCallback(async (id: string, signal?: AbortSignal) => {
    setLoadError(null);
    const d = await fetchAdminStory(id, signal);
    setDetail(d);
    setLocalEdits({});
    setAudioVersions({});
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.src = "";
    }
    setPlayingLineId(null);
    currentLineIdRef.current = null;
  }, []);

  useEffect(() => {
    if (!LANGUAGES_ENABLED || !storyId) return;
    const controller = new AbortController();
    reload(storyId, controller.signal).catch((err) => {
      if (err instanceof Error && err.name !== "AbortError") {
        setLoadError(err.message);
      }
    });
    return () => controller.abort();
  }, [reload, storyId]);

  /**
   * Play (or pause) the audio for one line. Single shared element so
   * starting a different line always stops the previous one. The
   * `?v=` query string is the cache-bust counter — bumped after each
   * successful regenerate so the browser doesn't reuse the cached
   * mp3 from before the swap.
   *
   * State is updated imperatively here instead of via audio DOM
   * events, because a src swap mid-play causes the browser to fire
   * a brief `pause` event that would race the icon flip.
   */
  const handlePlayLine = useCallback(
    (lineId: string, audioUrl: string) => {
      const audio = audioRef.current;
      if (!audio) return;
      const version = audioVersions[lineId] ?? 0;
      const src = `${audioUrl}${audioUrl.includes("?") ? "&" : "?"}v=${version}`;
      // Same line clicked while playing → toggle pause.
      if (currentLineIdRef.current === lineId && !audio.paused) {
        audio.pause();
        setPlayingLineId(null);
        return;
      }
      // Different line (or the same one paused) — switch.
      currentLineIdRef.current = lineId;
      setPlayingLineId(lineId);
      audio.src = src;
      audio.currentTime = 0;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {
          // Autoplay rejected or network error — drop the playing
          // marker so the icon flips back.
          setPlayingLineId(null);
          currentLineIdRef.current = null;
        });
      }
    },
    [audioVersions]
  );

  const handleRegenerate = async (lineId: string) => {
    setActionToast(null);
    try {
      const result = await regenerateLineAudio(lineId);
      if (result.source === "elevenlabs") {
        setActionToast({
          kind: "ok",
          msg: `Audio regenerated (${result.characters} chars).`
        });
        // Bump the cache-bust version for this line so the next play
        // refetches the new file even when the URL path is identical.
        setAudioVersions((prev) => ({ ...prev, [lineId]: Date.now() }));
      } else {
        // Stub source — surface the real reason ElevenLabs / R2 returned
        // so the admin can fix it (refill quota, add the env var, etc.).
        // Only fall back to the generic "not configured" string when the
        // server genuinely didn't include one (older deploy).
        const reason = result.error?.trim() ||
          "TTS provider not configured — audio unchanged.";
        setActionToast({ kind: "err", msg: reason });
      }
      if (storyId) await reload(storyId);
    } catch (err) {
      setActionToast({
        kind: "err",
        msg: err instanceof Error ? err.message : "Audio regen failed."
      });
    }
  };

  const handleSaveEdits = async () => {
    if (!detail || !storyId) return;
    const linePatches = Object.entries(localEdits)
      .map(([id, patch]) => ({ id, ...patch }))
      .filter((p) => Object.keys(p).length > 1);
    if (linePatches.length === 0) {
      setActionToast({ kind: "ok", msg: "Nothing to save." });
      return;
    }
    setActionToast(null);
    try {
      const updated = await saveAdminStoryEdits(storyId, { lines: linePatches });
      setDetail(updated);
      setLocalEdits({});
      setActionToast({ kind: "ok", msg: `Saved ${linePatches.length} line edits.` });
    } catch (err) {
      setActionToast({
        kind: "err",
        msg: err instanceof Error ? err.message : "Save failed."
      });
    }
  };

  const handleApprove = async () => {
    if (!storyId) return;
    setActionToast(null);
    try {
      await approveStory(storyId);
      setActionToast({ kind: "ok", msg: "Story approved and published." });
      await reload(storyId);
    } catch (err) {
      setActionToast({
        kind: "err",
        msg: err instanceof Error ? err.message : "Approve failed."
      });
    }
  };

  const handleReject = async () => {
    if (!storyId) return;
    const notes = window.prompt(
      "Why are you rejecting this story? (Required, ≤4 KB)"
    );
    if (!notes) return;
    setActionToast(null);
    try {
      await rejectStory(storyId, notes);
      setActionToast({ kind: "ok", msg: "Story rejected with notes." });
      await reload(storyId);
    } catch (err) {
      setActionToast({
        kind: "err",
        msg: err instanceof Error ? err.message : "Reject failed."
      });
    }
  };

  // Reading aid is only meaningful for languages with a non-Latin script
  // (pinyin for zh-Hans, niqqud for he). Hide it everywhere else so the
  // form doesn't carry a confusing empty box for, say, French or German.
  const showReadingAid = useMemo(() => {
    if (!detail) return false;
    return detail.targetLang === "zh-Hans" || detail.targetLang === "he";
  }, [detail]);

  if (!LANGUAGES_ENABLED) return <NotAvailable />;
  if (!storyId) return <LoadingShell />;

  if (loadError) {
    return (
      <div className="app-shell lib-page lang-page">
        <Head>
          <title>Admin · Story · AnimBook Languages</title>
        </Head>
        <Topbar variant="cinematic" />
        <main className="container lang-page lang-admin">
          <ErrorState
            title="Couldn't load story"
            error={new Error(loadError)}
            onRetry={() => reload(storyId)}
          />
        </main>
      </div>
    );
  }

  if (!detail) return <LoadingShell />;

  return (
    <div className="app-shell lib-page lang-page">
      <Head>
        <title>
          Review · {detail.title || detail.masterStoryTitle} · AnimBook
        </title>
      </Head>
      <Topbar variant="cinematic" />
      <main className="container lang-page lang-admin">
        {/* Single shared audio element — keeps "only one line plays at a
            time" honest regardless of how many rows the story has.
            playingLineId is driven imperatively from the click handler
            (see handlePlayLine) so DOM pause/emptied events during a
            src swap don't race the icon. onEnded is the only event we
            listen to — it clears state when the audio finishes on its
            own. */}
        <audio
          ref={audioRef}
          preload="none"
          onEnded={() => {
            setPlayingLineId(null);
            currentLineIdRef.current = null;
          }}
        />
        <ErrorBoundary
          fallback={(err, reset) => (
            <ErrorState
              title="Couldn't load story"
              error={err}
              onRetry={reset}
            />
          )}
        >
          <header className="lang-admin-detail-header">
            <p>
              <Link href="/languages/admin/stories">← Back to review queue</Link>
            </p>
            <h1>{detail.title || detail.masterStoryTitle}</h1>
            <p className="lang-admin-detail-meta">
              <span>Target: {detail.targetLang}</span>
              <span> · CEFR: {detail.cefrLevel}</span>
              <span> · Status: {detail.reviewStatus}</span>
              {detail.isPublished ? <span> · Published</span> : null}
            </p>
            {detail.reviewerNotes ? (
              <p className="lang-admin-notes">
                <strong>Reviewer notes:</strong> {detail.reviewerNotes}
              </p>
            ) : null}
            <div className="lang-admin-actions">
              {/* Save edits = secondary (ghost chrome). Approve = primary
                  gold. Reject = danger red. The flex container handles
                  spacing; the per-button padding sits inside .btn. */}
              <button type="button" className="btn ghost" onClick={handleSaveEdits}>
                Save edits
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={handleApprove}
                disabled={
                  detail.reviewStatus === "approved" && detail.isPublished
                }
              >
                Approve + publish
              </button>
              <button type="button" className="btn danger" onClick={handleReject}>
                Reject…
              </button>
            </div>
            {actionToast ? (
              <p
                className={`lang-admin-toast${actionToast.kind === "err" ? " is-error" : ""}`}
              >
                {actionToast.msg}
              </p>
            ) : null}
          </header>

          {detail.scenes.map((scene) => (
            <section key={scene.id} className="lang-admin-scene">
              <h2>Scene {scene.order}</h2>
              <ul className="lang-admin-lines">
                {scene.lines.map((line) => {
                  const overrides = localEdits[line.id] ?? {};
                  const text = overrides.text ?? line.text;
                  const textReading =
                    "textReading" in overrides ? overrides.textReading : line.textReading;
                  const audioUrl =
                    "audioUrl" in overrides ? overrides.audioUrl : line.audioUrl;
                  const dirty =
                    overrides.text !== undefined ||
                    overrides.textReading !== undefined ||
                    overrides.audioUrl !== undefined;
                  const isPlaying = playingLineId === line.id;
                  return (
                    <li key={line.id} className="lang-admin-line">
                      <header className="lang-admin-line-header">
                        <strong>{line.speaker}</strong>
                        <span>· line {line.order}</span>
                        {dirty ? (
                          <span className="lang-admin-dirty">unsaved</span>
                        ) : null}
                      </header>
                      <label className="lang-admin-label">
                        <span>Text</span>
                        <textarea
                          value={text ?? ""}
                          rows={2}
                          onChange={(e) =>
                            setLocalEdits((prev) => ({
                              ...prev,
                              [line.id]: { ...prev[line.id], text: e.target.value }
                            }))
                          }
                        />
                      </label>
                      {showReadingAid ? (
                        <label className="lang-admin-label">
                          <span>Reading aid (pinyin / niqqud)</span>
                          <input
                            type="text"
                            value={textReading ?? ""}
                            onChange={(e) =>
                              setLocalEdits((prev) => ({
                                ...prev,
                                [line.id]: {
                                  ...prev[line.id],
                                  textReading:
                                    e.target.value === "" ? null : e.target.value
                                }
                              }))
                            }
                          />
                        </label>
                      ) : null}
                      <div className="lang-admin-line-audio">
                        <div className="lang-admin-line-audio-meta">
                          <strong>Audio URL:</strong>{" "}
                          <code>{audioUrl ?? "(none)"}</code>
                        </div>
                        <div className="lang-admin-line-audio-actions">
                          {audioUrl ? (
                            <button
                              type="button"
                              className="btn line-action lang-admin-play"
                              data-line-id={line.id}
                              onClick={() => handlePlayLine(line.id, audioUrl)}
                              aria-label={isPlaying ? `Pause line ${line.order}` : `Play line ${line.order}`}
                              aria-pressed={isPlaying}
                              title={isPlaying ? "Pause" : "Play"}
                            >
                              {isPlaying ? "❚❚" : "▶"}
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="btn line-action"
                            onClick={() => handleRegenerate(line.id)}
                          >
                            Regenerate audio
                          </button>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </ErrorBoundary>
      </main>
    </div>
  );
}

function LoadingShell() {
  return (
    <div className="app-shell lib-page lang-page">
      <Head>
        <title>Admin · Story · AnimBook Languages</title>
      </Head>
      <Topbar variant="cinematic" />
      <main className="container lang-page lang-admin">
        <p className="lang-admin-loading">Loading…</p>
      </main>
    </div>
  );
}

function NotAvailable() {
  return (
    <div className="app-shell lib-page lang-page">
      <Topbar variant="cinematic" />
      <main className="container lang-page lang-admin">
        <p className="lang-not-available">
          AnimBook Languages is not enabled in this build.
        </p>
      </main>
    </div>
  );
}