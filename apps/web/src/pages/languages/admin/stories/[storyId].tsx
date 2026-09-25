import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useCallback, useEffect, useState } from "react";
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

  const reload = useCallback(async (id: string, signal?: AbortSignal) => {
    setLoadError(null);
    const d = await fetchAdminStory(id, signal);
    setDetail(d);
    setLocalEdits({});
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

  const handleRegenerate = async (lineId: string) => {
    setActionToast(null);
    try {
      const result = await regenerateLineAudio(lineId);
      setActionToast({
        kind: "ok",
        msg:
          result.source === "elevenlabs"
            ? `Audio regenerated (${result.characters} chars).`
            : "TTS provider not configured — audio unchanged."
      });
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
                      <div className="lang-admin-line-audio">
                        <div>
                          <strong>Audio URL:</strong>{" "}
                          <code>{audioUrl ?? "(none)"}</code>
                        </div>
                        <button
                          type="button"
                          className="btn line-action"
                          onClick={() => handleRegenerate(line.id)}
                        >
                          Regenerate audio
                        </button>
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
