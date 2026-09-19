/**
 * Split-pipeline REVIEW UI — STILL_PAGE → (approve) → ANIMATE_PAGE.
 *
 * Renders only when `project.book.splitPipeline === true`. For non-split
 * books, the existing single-stage review still lives in studio.tsx.
 *
 * Mobile-first (375px). Each tile shows the still (posterUrl) + the
 * clip (videoUrl) when both exist, with a status chip per track and
 * per-tile Approve / Regenerate / Edit-prompt-and-regenerate / Re-animate
 * buttons. The bulk "Re-animate N failed" button reuses the existing
 * /reanimate-failed endpoint, which now routes through ANIMATE_PAGE for
 * split books.
 */
import { useCallback, useMemo, useState } from "react";
import { apiFetch, type PageRecord } from "@/lib/api";
import { useToastStore } from "@/lib/store";

/* --------------------------------------------------------------------- *
 * Status maps (per-track, in addition to the legacy PAGE_STATUS).
 * --------------------------------------------------------------------- */

const STILL_STATUS: Record<string, string> = {
  NONE: "No still yet",
  GENERATING: "Painting still…",
  READY: "Ready to review",
  APPROVED: "Approved",
  FAILED: "Failed"
};

const CLIP_STATUS: Record<string, string> = {
  NONE: "Not animated",
  QUEUED: "Queued",
  GENERATING: "Animating…",
  READY: "Ready to review",
  APPROVED: "Approved",
  FLAGGED: "Flagged",
  FAILED: "Failed",
  STALE: "Stale (still changed)"
};

const AUDIO_STATUS: Record<string, string> = {
  NONE: "No audio",
  GENERATING: "Recording…",
  READY: "Recorded",
  FAILED: "Failed"
};

const fmt = (n: number) => (n === 0 ? "0" : n < 1 ? n.toFixed(2) : n.toFixed(1));

function isRealClip(url: string | null | undefined): boolean {
  return Boolean(url) && !/placehold\.co|\.(png|jpe?g)(\?|$)/i.test(String(url));
}

interface SplitReviewProps {
  projectId: string;
  pages: PageRecord[];
  published: boolean;
  /** Called when the user confirms publish; the existing publish handler in
   *  studio.tsx owns expert-review + release-schedule gating. */
  onPublish: () => Promise<void> | void;
  onRefresh: () => Promise<void> | void;
}

interface AnimateEstimate {
  pages: number;
  seconds: number;
  usd: number;
  byTier: { HERO: number; STANDARD: number };
}

export default function SplitReview({ projectId, pages, published, onPublish, onRefresh }: SplitReviewProps) {
  const toast = useToastStore((s) => s.push);

  const [workingPage, setWorkingPage] = useState<string | null>(null);
  const [workingBulk, setWorkingBulk] = useState<string | null>(null);
  const [stillPromptOverrides, setStillPromptOverrides] = useState<Record<string, string>>({});
  const [estimate, setEstimate] = useState<AnimateEstimate | null>(null);
  const [confirmingAnimate, setConfirmingAnimate] = useState(false);

  /* ------------------------------------------------------------------- *
   * Derived counts.
   * ------------------------------------------------------------------- */
  const stillsTodo = useMemo(() => pages.filter((p) => p.stillStatus === "NONE" || p.stillStatus === "FAILED"), [pages]);
  const stillsReady = useMemo(() => pages.filter((p) => p.stillStatus === "READY"), [pages]);
  const stillsApproved = useMemo(() => pages.filter((p) => p.stillStatus === "APPROVED"), [pages]);
  const clipsTodo = useMemo(
    () => pages.filter((p) => p.stillStatus === "APPROVED" && (p.clipStatus === "NONE" || p.clipStatus === "FAILED" || p.clipStatus === "STALE")),
    [pages]
  );
  const clipsReady = useMemo(() => pages.filter((p) => p.clipStatus === "READY"), [pages]);
  const clipsFailed = useMemo(() => pages.filter((p) => p.clipStatus === "FAILED"), [pages]);
  const audioInFlight = useMemo(
    () => pages.filter((p) => p.audioStatus === "GENERATING" || p.audioStatus === "FAILED" || p.audioStatus === "NONE"),
    [pages]
  );
  const audioReady = useMemo(() => pages.filter((p) => p.audioStatus === "READY"), [pages]);

  const publishBlockers = useMemo(
    () =>
      pages.filter(
        (p) =>
          (p.stillStatus ?? "NONE") !== "APPROVED" ||
          (p.clipStatus ?? "NONE") !== "APPROVED" ||
          (p.audioStatus ?? "NONE") !== "READY"
      ),
    [pages]
  );
  const canPublish = publishBlockers.length === 0 && !published && pages.length > 0;

  /* ------------------------------------------------------------------- *
   * Actions.
   * ------------------------------------------------------------------- */

  async function generateStills() {
    setWorkingBulk("stills");
    try {
      const res = await apiFetch<{ queued: number; pages: number[] }>(`/api/studio/projects/${projectId}/stills`, { method: "POST" });
      if (res.queued === 0) toast("Nothing to generate — all stills are already running or done");
      else toast(`Queued ${res.queued} still${res.queued === 1 ? "" : "s"}`);
      await onRefresh();
    } catch (err) {
      toast((err as Error).message || "Failed to queue stills");
    } finally {
      setWorkingBulk(null);
    }
  }

  async function approveAllReadyStills() {
    setWorkingBulk("stills-approve-all");
    try {
      const res = await apiFetch<{ approved: number }>(`/api/studio/projects/${projectId}/stills/approve-all`, { method: "POST" });
      toast(`Approved ${res.approved} still${res.approved === 1 ? "" : "s"}`);
      await onRefresh();
    } catch (err) {
      toast((err as Error).message || "Failed to approve");
    } finally {
      setWorkingBulk(null);
    }
  }

  async function approveStill(pageId: string) {
    setWorkingPage(pageId);
    try {
      await apiFetch(`/api/pages/${pageId}/still/approve`, { method: "POST" });
      await onRefresh();
    } catch (err) {
      toast((err as Error).message || "Couldn't approve still");
    } finally {
      setWorkingPage(null);
    }
  }

  async function regenerateStill(pageId: string) {
    const override = (stillPromptOverrides[pageId] ?? "").trim();
    const note = (stillPromptOverrides[`${pageId}__note`] ?? "").trim();
    setWorkingPage(pageId);
    try {
      await apiFetch(`/api/pages/${pageId}/still/regenerate`, {
        method: "POST",
        body: JSON.stringify({
          promptOverride: override || undefined,
          note: note || undefined
        })
      });
      toast("Still queued for regeneration");
      setStillPromptOverrides((prev) => {
        const next = { ...prev };
        delete next[pageId];
        delete next[`${pageId}__note`];
        return next;
      });
      await onRefresh();
    } catch (err) {
      toast((err as Error).message || "Couldn't regenerate still");
    } finally {
      setWorkingPage(null);
    }
  }

  async function setMotionTier(pageId: string, tier: "HERO" | "STANDARD") {
    setWorkingPage(pageId);
    try {
      await apiFetch(`/api/pages/${pageId}/motion-tier`, {
        method: "PUT",
        body: JSON.stringify({ motionTier: tier })
      });
      await onRefresh();
    } catch (err) {
      toast((err as Error).message || "Couldn't change clip length");
    } finally {
      setWorkingPage(null);
    }
  }

  async function reanimateClip(pageId: string) {
    setWorkingPage(pageId);
    try {
      await apiFetch(`/api/pages/${pageId}/regenerate`, { method: "POST", body: JSON.stringify({ note: "" }) });
      toast("Clip queued for re-animation");
      await onRefresh();
    } catch (err) {
      toast((err as Error).message || "Couldn't re-animate");
    } finally {
      setWorkingPage(null);
    }
  }

  async function renarratePage(pageId: string) {
    // Single-page audio re-narration: useful when the project-level kick
    // silently skipped a page (OCR garbage, content-classifier reject).
    // Synchronous endpoint — takes 1-3s for ElevenLabs TTS + R2 upload.
    setWorkingPage(pageId);
    try {
      const res = await apiFetch<{ audioUrl: string; characters: number }>(
        `/api/pages/${pageId}/audio-regenerate`,
        { method: "POST" }
      );
      toast(`Audio ready · ${res.characters} chars`);
      await onRefresh();
    } catch (err) {
      toast((err as Error).message || "Couldn't re-narrate");
    } finally {
      setWorkingPage(null);
    }
  }

  async function approveAllClips() {
    setWorkingBulk("clips-approve-all");
    try {
      const res = await apiFetch<{ approved: number }>(`/api/studio/projects/${projectId}/clips/approve-all`, { method: "POST" });
      toast(`Approved ${res.approved} clip${res.approved === 1 ? "" : "s"}`);
      await onRefresh();
    } catch (err) {
      toast((err as Error).message || "Failed to approve");
    } finally {
      setWorkingBulk(null);
    }
  }

  async function reanimateAllFailedClips() {
    if (!window.confirm(`Re-animate ${clipsFailed.length} failed clip${clipsFailed.length === 1 ? "" : "s"}? About ${clipsFailed.length * 50} Runway credits.`)) return;
    setWorkingBulk("all-failed-clips");
    try {
      const res = await apiFetch<{ queued: number; pages: number[] }>(`/api/studio/projects/${projectId}/reanimate-failed`, { method: "POST" });
      toast(`Queued ${res.queued} clip${res.queued === 1 ? "" : "s"}`);
      await onRefresh();
    } catch (err) {
      toast((err as Error).message || "Failed to re-animate");
    } finally {
      setWorkingBulk(null);
    }
  }

  const fetchEstimate = useCallback(async () => {
    try {
      const res = await apiFetch<AnimateEstimate>(`/api/studio/projects/${projectId}/animate/estimate`);
      setEstimate(res);
      setConfirmingAnimate(true);
    } catch (err) {
      toast((err as Error).message || "Failed to estimate");
    }
  }, [projectId, toast]);

  async function confirmAnimate() {
    setWorkingBulk("animate");
    try {
      const res = await apiFetch<{ queued: number; pages: number[]; estimatedUsd: number }>(`/api/studio/projects/${projectId}/animate`, {
        method: "POST",
        body: JSON.stringify({})
      });
      toast(`Queued ${res.queued} clip${res.queued === 1 ? "" : "s"} (about $${fmt(res.estimatedUsd)})`);
      setConfirmingAnimate(false);
      setEstimate(null);
      await onRefresh();
    } catch (err) {
      toast((err as Error).message || "Failed to start animation");
    } finally {
      setWorkingBulk(null);
    }
  }

  return (
    <div className="split-review">
      {/* ----------------------------------------------------------- */}
      {/* Stills                                                      */}
      {/* ----------------------------------------------------------- */}
      <section className="split-section">
        <header className="split-head">
          <div>
            <h2>Stills</h2>
            <p className="muted">
              Paint every page as a poster first. Cheaper, faster, and the
              author gets to approve before we spend clip credits.
            </p>
          </div>
          <div className="split-actions">
            {stillsTodo.length > 0 && !published && (
              <button
                type="button"
                className="btn primary"
                onClick={() => void generateStills()}
                disabled={workingBulk === "stills"}
                title="Run Runway gen4_image on every page whose still is NONE or FAILED"
              >
                {workingBulk === "stills" ? "Queuing…" : `Generate ${stillsTodo.length} still${stillsTodo.length === 1 ? "" : "s"}`}
              </button>
            )}
            {stillsReady.length > 0 && !published && (
              <button
                type="button"
                className="btn"
                onClick={() => void approveAllReadyStills()}
                disabled={workingBulk === "stills-approve-all"}
                title="Mark every READY still as APPROVED in one click"
              >
                {workingBulk === "stills-approve-all" ? "Approving…" : `Approve ${stillsReady.length} ready`}
              </button>
            )}
          </div>
        </header>
        <div className="split-grid">
          {pages.map((page) => {
            const realStill = page.posterUrl;
            const status = page.stillStatus ?? "NONE";
            const label = STILL_STATUS[status] ?? status;
            const override = stillPromptOverrides[page.id] ?? "";
            const editing = override.length > 0;
            const canApprove = status === "READY" || status === "APPROVED";
            const canRegenerate = !["GENERATING", "QUEUED"].includes(status) && !["QUEUED", "GENERATING"].includes(page.clipStatus ?? "NONE");
            return (
              <article key={`still-${page.id}`} className={`split-card st-still s-still-${status.toLowerCase()}`}>
                <div className="split-media">
                  {realStill ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={realStill} alt={`Still for page ${page.pageNum}`} />
                  ) : (
                    <div className="media-empty">{status === "GENERATING" ? "Painting still…" : "No still yet"}</div>
                  )}
                  <span className="page-badge">Page {page.pageNum}</span>
                  <span className={`status-chip s-still-${status.toLowerCase()}`}>{label}</span>
                </div>
                <p className="split-text">{page.textExcerpt}</p>
                {!published && (
                  <>
                    <textarea
                      rows={2}
                      placeholder="(optional) edit the prompt and regenerate, or leave blank to reuse the brain's prompt"
                      value={override}
                      onChange={(e) => setStillPromptOverrides((prev) => ({ ...prev, [page.id]: e.target.value }))}
                    />
                    <input
                      type="text"
                      placeholder="Direction note (e.g. dusk, the boy facing the river)"
                      value={stillPromptOverrides[`${page.id}__note`] ?? ""}
                      onChange={(e) => setStillPromptOverrides((prev) => ({ ...prev, [`${page.id}__note`]: e.target.value }))}
                      className="split-note"
                    />
                    <div className="split-card-actions">
                      <button
                        type="button"
                        className="btn"
                        disabled={workingPage === page.id || !canApprove}
                        onClick={() => void approveStill(page.id)}
                      >
                        {status === "APPROVED" ? "Approved" : "Approve"}
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        disabled={workingPage === page.id || !canRegenerate}
                        onClick={() => void regenerateStill(page.id)}
                        title={editing ? "Regenerate with the edited prompt" : "Regenerate with the brain's prompt"}
                      >
                        {workingPage === page.id ? "Regenerating…" : editing ? "Edit + regenerate" : "Regenerate"}
                      </button>
                    </div>
                    <div className="motion-toggle" title="HERO = 10s clip, STANDARD = 5s">
                      <span className="motion-label">Clip length</span>
                      <div className="motion-pills" role="radiogroup" aria-label="Clip length">
                        {(["STANDARD", "HERO"] as const).map((tier) => (
                          <button
                            key={tier}
                            type="button"
                            role="radio"
                            aria-checked={page.motionTier === tier}
                            className={`motion-pill ${page.motionTier === tier ? "selected" : ""}`}
                            disabled={workingPage === page.id || published}
                            onClick={() => void setMotionTier(page.id, tier)}
                          >
                            {tier === "HERO" ? "10s HERO" : "5s"}
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </article>
            );
          })}
        </div>
      </section>

      {/* ----------------------------------------------------------- */}
      {/* Animation                                                  */}
      {/* ----------------------------------------------------------- */}
      <section className="split-section">
        <header className="split-head">
          <div>
            <h2>Clips</h2>
            <p className="muted">
              Animate only the stills you approved. Failed and stale clips
              (where the still changed under them) are listed below.
            </p>
          </div>
          <div className="split-actions">
            {clipsTodo.length > 0 && !published && (
              <button
                type="button"
                className="btn primary"
                onClick={() => void fetchEstimate()}
                disabled={workingBulk === "animate"}
                title="Run Runway gen4_turbo on every page whose still is approved and clip needs regenerating"
              >
                {workingBulk === "animate" ? "Animating…" : `Animate ${clipsTodo.length} approved`}
              </button>
            )}
            {clipsReady.length > 0 && !published && (
              <button
                type="button"
                className="btn"
                onClick={() => void approveAllClips()}
                disabled={workingBulk === "clips-approve-all"}
                title="Mark every READY clip as APPROVED in one click"
              >
                {workingBulk === "clips-approve-all" ? "Approving…" : `Approve ${clipsReady.length} ready clip${clipsReady.length === 1 ? "" : "s"}`}
              </button>
            )}
            {clipsFailed.length > 0 && !published && (
              <button
                type="button"
                className="btn"
                disabled={workingBulk === "all-failed-clips"}
                onClick={() => void reanimateAllFailedClips()}
                title="Re-queue every FAILED clip with the current schema"
              >
                {workingBulk === "all-failed-clips" ? "Re-animating…" : `Re-animate ${clipsFailed.length} failed clip${clipsFailed.length === 1 ? "" : "s"}`}
              </button>
            )}
          </div>
        </header>
        <div className="split-grid">
          {pages.map((page) => {
            const realClip = isRealClip(page.videoUrl);
            const cStatus = page.clipStatus ?? "NONE";
            const cLabel = CLIP_STATUS[cStatus] ?? cStatus;
            const aStatus = page.audioStatus ?? "NONE";
            const aLabel = AUDIO_STATUS[aStatus] ?? aStatus;
            const staleBecauseStillChanged = cStatus === "STALE";
            const canReanimate = cStatus === "FAILED" || cStatus === "STALE" || cStatus === "FLAGGED";
            return (
              <article key={`clip-${page.id}`} className={`split-card st-clip s-clip-${cStatus.toLowerCase()}`}>
                <div className="split-media">
                  {realClip ? (
                    <video src={page.videoUrl ?? undefined} poster={page.posterUrl ?? undefined} muted loop autoPlay playsInline />
                  ) : page.posterUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={page.posterUrl} alt={`Still for page ${page.pageNum}`} />
                  ) : (
                    <div className="media-empty">{cStatus === "GENERATING" ? "Animating…" : cStatus === "QUEUED" ? "Queued" : "Not animated yet"}</div>
                  )}
                  <span className="page-badge">Page {page.pageNum}</span>
                  <span className={`status-chip s-clip-${cStatus.toLowerCase()}`}>{cLabel}</span>
                  <span className={`status-chip s-audio-${aStatus.toLowerCase()}`}>{aLabel}</span>
                  {staleBecauseStillChanged && (
                    <div className="stale-note" role="status">
                      Still was regenerated — old clip is stale; re-animate to get the new motion.
                    </div>
                  )}
                </div>
                <p className="split-text">{page.textExcerpt}</p>
                {!published && (
                  <div className="split-card-actions">
                    {canReanimate && (
                      <button
                        type="button"
                        className="btn ghost"
                        disabled={workingPage === page.id}
                        onClick={() => void reanimateClip(page.id)}
                      >
                        {workingPage === page.id ? "Re-animating…" : "Re-animate"}
                      </button>
                    )}
                    {(aStatus === "NONE" || aStatus === "FAILED") && (
                      <button
                        type="button"
                        className="btn ghost"
                        disabled={workingPage === page.id}
                        onClick={() => void renarratePage(page.id)}
                        title="Generate audio for this page (uses the same voice as the project)"
                      >
                        {workingPage === page.id ? "Recording…" : "Re-narrate"}
                      </button>
                    )}
                    {page.audioUrl && <audio controls preload="none" src={page.audioUrl} className="split-audio" />}
                  </div>
                )}
                {published && page.audioUrl && <audio controls preload="none" src={page.audioUrl} className="split-audio" />}
              </article>
            );
          })}
        </div>
      </section>

      {/* ----------------------------------------------------------- */}
      {/* Publish                                                    */}
      {/* ----------------------------------------------------------- */}
      {!published && (
        <section className="split-section">
          <header className="split-head">
            <div>
              <h2>Publish</h2>
              <p className="muted">
                {publishBlockers.length === 0
                  ? "Every page is approved and narrated. Ready to publish."
                  : `${publishBlockers.length} page${publishBlockers.length === 1 ? "" : "s"} blocking publish.`}
              </p>
            </div>
            <div className="split-actions">
              <button
                type="button"
                className="btn primary"
                disabled={!canPublish}
                onClick={() => void onPublish()}
                title={canPublish ? "Publish the book" : "Every page needs an approved still, an approved clip, and ready audio."}
              >
                Publish to library
              </button>
            </div>
          </header>
          {publishBlockers.length > 0 && (
            <ul className="publish-blockers">
              {publishBlockers.slice(0, 8).map((p) => (
                <li key={p.id}>
                  Page {p.pageNum}: still {STILL_STATUS[p.stillStatus ?? "NONE"] ?? p.stillStatus}, clip {CLIP_STATUS[p.clipStatus ?? "NONE"] ?? p.clipStatus}, audio {AUDIO_STATUS[p.audioStatus ?? "NONE"] ?? p.audioStatus}
                </li>
              ))}
              {publishBlockers.length > 8 && <li>…and {publishBlockers.length - 8} more</li>}
            </ul>
          )}
          {audioInFlight.length > 0 && (
            <p className="muted">
              Audio in progress — <strong>{audioReady.length} of {pages.length}</strong> narrated
              ({Math.round((audioReady.length / Math.max(1, pages.length)) * 100)}%).
              Pages with audioStatus not yet READY will fill in over the next few minutes.
            </p>
          )}
          {audioInFlight.length === 0 && pages.length > 0 && (
            <p className="muted">All {pages.length} pages narrated.</p>
          )}
        </section>
      )}

      {/* ----------------------------------------------------------- */}
      {/* Confirm-animate modal                                       */}
      {/* ----------------------------------------------------------- */}
      {confirmingAnimate && estimate && (
        <div className="confirm-modal" role="dialog" aria-modal="true">
          <div className="confirm-card">
            <h3>Animate approved pages?</h3>
            <p>
              <strong>{estimate.pages}</strong> page{estimate.pages === 1 ? "" : "s"},
              about <strong>{estimate.seconds}</strong> seconds of Runway video,
              about <strong>${fmt(estimate.usd)}</strong>. This spends credits the
              moment you confirm — you can re-animate failed clips for free later.
            </p>
            {estimate.byTier.HERO > 0 && (
              <p className="muted">
                {estimate.byTier.HERO} HERO (10s) + {estimate.byTier.STANDARD} STANDARD
                (10s in Part A; Part B will halve STANDARD).
              </p>
            )}
            <div className="confirm-actions">
              <button type="button" className="btn" onClick={() => { setConfirmingAnimate(false); setEstimate(null); }}>
                Cancel
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={() => void confirmAnimate()}
                disabled={workingBulk === "animate"}
              >
                {workingBulk === "animate" ? "Starting…" : "Yes, animate"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}