import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { Topbar } from "@/components/Topbar";
import { apiFetch, apiStreamUrl, type BookBrainJson, type PageRecord, type PipelineEvent, type StudioProjectSummary } from "@/lib/api";
import { useToastStore } from "@/lib/store";
import { VERTICALS, verticalById } from "@/lib/verticals";
import { ImportError, readManuscriptFile } from "@/lib/manuscriptImport";
import { detectSections, parseManuscript, type Section } from "@/lib/manuscriptSections";

type Stage = "SETUP" | "UPLOAD" | "BRAIN" | "STYLE" | "REVIEW";

interface ProjectDetail extends StudioProjectSummary {
  book?: {
    id: string;
    slug: string;
    title: string;
    author: string;
    synopsis: string;
    vertical: string;
    language: string;
    coverUrl?: string | null;
    subtitle?: string | null;
    status?: string;
    styleId?: string | null;
    requiresExpertReview?: boolean;
    expertReviewStatus?: string;
    pages: PageRecord[];
    brain?: { rawJson: BookBrainJson; styleSelected: string | null } | null;
  };
}

interface ProjectListItem {
  id: string;
  name: string;
  vertical: string;
  status: string;
  updatedAt: string;
  book: { slug: string; title: string; author: string; coverUrl: string | null; status: string; pageCount: number } | null;
}

const styleOptions = [
  { id: "painterly-mysticism", label: "Painterly Mysticism", blurb: "Soft brushwork, glowing light, dreamlike.", colors: ["#6B2D8B", "#C49A1C"] },
  { id: "watercolour", label: "Watercolour", blurb: "Loose washes on paper, light and airy.", colors: ["#1B6B8A", "#9ED3E6"] },
  { id: "desert-realism", label: "Desert Realism", blurb: "Sun-drenched realism, ochre and gold.", colors: ["#C49A1C", "#8A4B1C"] },
  { id: "graphic-novel", label: "Graphic Novel", blurb: "Bold ink lines, flat vivid colour.", colors: ["#AA2020", "#111111"] },
  { id: "anime-inspired", label: "Anime-Inspired", blurb: "Clean line art, expressive faces.", colors: ["#D9872A", "#F3C1D2"] },
  { id: "cinematic-dark", label: "Cinematic Dark", blurb: "Moody shadows, teal and amber.", colors: ["#0D1B2E", "#C47A2C"] },
  { id: "sacred-realism", label: "Sacred Realism", blurb: "Reverent classical painting.", colors: ["#7A6650", "#E8D7A8"] },
  { id: "scientific-microscopy", label: "Scientific", blurb: "Precise, luminous, on dark ground.", colors: ["#1A6B3C", "#6FE3B0"] }
];

const steps: { id: Stage; label: string; hint: string }[] = [
  { id: "SETUP", label: "Project", hint: "Title & type" },
  { id: "UPLOAD", label: "Manuscript", hint: "Add your text" },
  { id: "BRAIN", label: "Book Brain", hint: "Check the analysis" },
  { id: "STYLE", label: "Style", hint: "Choose the look" },
  { id: "REVIEW", label: "Review", hint: "Approve & publish" }
];
const ORDER: Stage[] = steps.map((s) => s.id);
const CREDITS_PER_PAGE = 30; // a page with video
const CREDITS_PER_STILL = 5; // a painted page the reader pans across
const keyPageCount = (pages: number) => Math.max(1, Math.ceil(pages / 10));
function estimateCredits(pages: number, mode: "full" | "illustrated"): number {
  if (mode === "full") return pages * CREDITS_PER_PAGE;
  const key = keyPageCount(pages);
  return (pages - key) * CREDITS_PER_STILL + key * CREDITS_PER_PAGE;
}
const styleName = (id: string | null | undefined) => styleOptions.find((o) => o.id === id)?.label ?? id ?? "";
const PAGE_STATUS: Record<string, string> = { PENDING: "To review", APPROVED: "Approved", FLAGGED: "Failed", REGENERATING: "Re-animating" };

/** Furthest step a project can show, from its server status. */
function stageFor(project: ProjectDetail | null): Stage {
  if (!project) return "SETUP";
  switch (project.status) {
    case "SETUP":
    case "ANALYZING":
      return "UPLOAD";
    case "BRAIN_REVIEW":
      return "BRAIN";
    case "STYLE_SELECTION":
    case "STYLE_TRAINING":
    case "GENERATING":
      return "STYLE";
    case "FAILED":
      return project.book?.brain ? "BRAIN" : "UPLOAD";
    default:
      return "REVIEW";
  }
}

const STATUS_TEXT: Record<string, string> = {
  SETUP: "Waiting for manuscript",
  ANALYZING: "Analysing…",
  BRAIN_REVIEW: "Analysis ready",
  STYLE_SELECTION: "Choose a style",
  GENERATING: "Animating…",
  REVIEW: "Ready to review",
  AUDIO: "Recording narration…",
  READY_TO_PUBLISH: "Ready to publish",
  PUBLISHED: "Published",
  FAILED: "Needs attention"
};

export default function StudioPage() {
  const toast = useToastStore((s) => s.push);
  const [projects, setProjects] = useState<ProjectListItem[] | null>(null);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [view, setView] = useState<Stage>("SETUP");
  const [busy, setBusy] = useState(false);
  const [events, setEvents] = useState<PipelineEvent[]>([]);

  // Setup form
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [author, setAuthor] = useState("");
  const [synopsis, setSynopsis] = useState("");
  const [vertical, setVertical] = useState("CONSUMER");

  // Manuscript
  const [manuscriptText, setManuscriptText] = useState("");
  const [pageLength, setPageLength] = useState(1200);
  const parsed = useMemo(() => parseManuscript(manuscriptText, pageLength), [manuscriptText, pageLength]);
  const sections = useMemo(() => detectSections(parsed), [parsed]);
  const [skipped, setSkipped] = useState<Record<string, boolean>>({});
  const sectionKey = (sec: Section) => `${sec.kind}:${sec.from}`;
  useEffect(() => {
    // Default: leave out contents, copyright and index.
    setSkipped(Object.fromEntries(sections.filter((sec) => sec.skipByDefault).map((sec) => [sectionKey(sec), true])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parsed.length, pageLength]);
  const skippedPages = useMemo(() => {
    const set = new Set<number>();
    for (const sec of sections) if (skipped[sectionKey(sec)]) sec.pages.forEach((n) => set.add(n));
    return set;
  }, [sections, skipped]);
  const kept = useMemo(
    () => parsed.filter((p) => !skippedPages.has(p.pageNum)).map((p, i) => ({ ...p, pageNum: i + 1 })),
    [parsed, skippedPages]
  );
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState<string | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  // Brain / style / review
  const [styleId, setStyleId] = useState<string>(styleOptions[0]!.id);
  const [mode, setMode] = useState<"full" | "illustrated">("illustrated");
  const [coverBusy, setCoverBusy] = useState(false);
  const coverInput = useRef<HTMLInputElement | null>(null);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [workingPage, setWorkingPage] = useState<string | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  const projectId = project?.id ?? null;
  const reachable = stageFor(project);
  const brain = (project?.book?.brain?.rawJson as BookBrainJson | undefined) ?? null;
  const pages = project?.book?.pages ?? [];
  const running = project?.status === "ANALYZING" || project?.status === "GENERATING" || project?.status === "AUDIO";

  const loadProjects = useCallback(async () => {
    try {
      const res = await apiFetch<{ items: ProjectListItem[] }>("/api/studio/projects");
      setProjects(res.items);
    } catch {
      setProjects([]);
    }
  }, []);

  const refresh = useCallback(async (id: string, jump = false) => {
    const detail = await apiFetch<ProjectDetail>(`/api/studio/projects/${id}`);
    setProject(detail);
    if (detail.book?.styleId) setStyleId(detail.book.styleId);
    if (jump) setView(stageFor(detail));
    return detail;
  }, []);

  useEffect(() => {
    void loadProjects();
    return () => {
      eventSourceRef.current?.close();
      eventSourceRef.current = null;
    };
  }, [loadProjects]);

  // Keep the view in step with the server while work is running.
  useEffect(() => {
    if (!projectId || !running) return;
    const t = window.setInterval(() => {
      void refresh(projectId).then((d) => {
        const next = stageFor(d);
        if (ORDER.indexOf(next) > ORDER.indexOf(view)) setView(next);
      });
    }, 6000);
    return () => window.clearInterval(t);
  }, [projectId, running, refresh, view]);

  async function subscribe(id: string) {
    eventSourceRef.current?.close();
    const es = new EventSource(await apiStreamUrl(`/api/studio/projects/${id}/events`));
    es.addEventListener("pipeline", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as PipelineEvent;
        setEvents((prev) => [data, ...prev].slice(0, 40));
        const finished =
          (data.stage === "BOOK_BRAIN_ANALYSIS" && data.status === "succeeded") ||
          data.stage === "QUALITY_TRIAGE" ||
          (data.stage === "VIDEO_GENERATION" && data.status !== "queued") ||
          data.status === "failed";
        if (finished) {
          void refresh(id).then((d) => {
            const next = stageFor(d);
            setView((v) => (ORDER.indexOf(next) > ORDER.indexOf(v) ? next : v));
          });
        }
      } catch {
        // ignore malformed event
      }
    });
    es.onerror = () => {
      if (eventSourceRef.current !== es) return;
      es.close();
      setTimeout(() => {
        if (eventSourceRef.current === es) void subscribe(id);
      }, 3000);
    };
    eventSourceRef.current = es;
  }

  async function openProject(id: string) {
    setEvents([]);
    try {
      await refresh(id, true);
      void subscribe(id);
    } catch (err) {
      toast(`Could not open project: ${(err as Error).message}`);
    }
  }

  function newProject() {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setProject(null);
    setEvents([]);
    setTitle("");
    setSubtitle("");
    setAuthor("");
    setSynopsis("");
    setManuscriptText("");
    setView("SETUP");
  }

  async function createProject() {
    setBusy(true);
    try {
      const res = await apiFetch<{ project: StudioProjectSummary }>("/api/studio/projects", {
        method: "POST",
        json: {
          name: title.trim(),
          vertical,
          title: title.trim(),
          subtitle: subtitle.trim() || undefined,
          author: author.trim(),
          synopsis: synopsis.trim() || undefined,
          language: "en"
        }
      });
      await refresh(res.project.id);
      setView("UPLOAD");
      void subscribe(res.project.id);
      void loadProjects();
      toast("Project created");
    } catch (err) {
      toast(`Could not create project: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function importFile(file: File) {
    setImportError(null);
    if (file.size > 60 * 1024 * 1024) {
      setImportError("That file is over 60 MB. Please split it or save a smaller copy.");
      return;
    }
    setImporting(`Reading ${file.name}…`);
    try {
      // Read in the browser first — no upload needed.
      const text = await readManuscriptFile(file, (msg) => setImporting(msg));
      setManuscriptText(text);
      toast(`Imported ${file.name}`);
    } catch (err) {
      if (err instanceof ImportError) {
        setImportError(err.message);
      } else if (file.size <= 25 * 1024 * 1024 && /\.(docx|pdf)$/i.test(file.name)) {
        // Unexpected browser failure: let the server try.
        await importOnServer(file);
      } else {
        setImportError(`Couldn't read ${file.name}: ${(err as Error).message}`);
      }
    } finally {
      setImporting(null);
    }
  }

  async function importOnServer(file: File) {
    setImporting(`Uploading ${file.name} to read it on the server…`);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 5 * 60 * 1000);
    try {
      const res = await apiFetch<{ text: string }>("/api/studio/extract", {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(file.name) },
        body: file,
        signal: controller.signal
      });
      setManuscriptText(res.text);
      toast(`Imported ${file.name}`);
    } catch (err) {
      const detail = (err as { details?: { error?: string } }).details?.error;
      setImportError(
        detail ?? ((err as Error).name === "AbortError" ? `Reading ${file.name} took too long. Try a smaller file or paste the text.` : `Couldn't import ${file.name}: ${(err as Error).message}`)
      );
    } finally {
      window.clearTimeout(timer);
    }
  }

  async function uploadManuscript() {
    if (!projectId || kept.length === 0) return;
    setBusy(true);
    try {
      await apiFetch(`/api/studio/projects/${projectId}/upload`, {
        method: "POST",
        json: { sourceFilename: "manuscript.txt", sha256: await sha256(manuscriptText), pages: kept }
      });
      await apiFetch(`/api/studio/projects/${projectId}/analyze`, { method: "POST" });
      void subscribe(projectId);
      await refresh(projectId);
      toast("Manuscript uploaded — analysing");
    } catch (err) {
      toast(`Upload failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function confirmBrain() {
    if (!projectId || !brain) return;
    setBusy(true);
    try {
      await apiFetch(`/api/studio/projects/${projectId}/brain`, { method: "PUT", json: { brain } });
      await refresh(projectId);
      setView("STYLE");
    } catch (err) {
      toast(`Save failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function generate() {
    if (!projectId) return;
    const estimate = estimateCredits(pages.length, mode);
    const what = mode === "full" ? "Animate" : "Illustrate";
    if (!window.confirm(`${what} ${pages.length} pages in this style? This uses about ${estimate} Runway credits (≈ $${(estimate / 100).toFixed(2)}).`)) return;
    setBusy(true);
    try {
      await apiFetch(`/api/studio/projects/${projectId}/style`, { method: "POST", json: { styleId } });
      await apiFetch(`/api/studio/projects/${projectId}/generate`, { method: "POST", json: { mode } });
      void subscribe(projectId);
      await refresh(projectId);
      toast("Generation started");
    } catch (err) {
      toast(`Could not start: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function uploadCover(file: File) {
    if (!projectId) return;
    if (!/\.(png|jpe?g|webp)$/i.test(file.name)) {
      toast("Please choose a PNG, JPG or WebP image");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      toast("That image is over 12 MB — please save a smaller copy");
      return;
    }
    setCoverBusy(true);
    try {
      await apiFetch(`/api/studio/projects/${projectId}/cover`, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream", "X-Filename": encodeURIComponent(file.name) },
        body: file
      });
      await refresh(projectId);
      void loadProjects();
      toast("Cover updated");
    } catch (err) {
      const detail = (err as { details?: { error?: string } }).details?.error;
      toast(detail ?? `Could not upload the cover: ${(err as Error).message}`);
    } finally {
      setCoverBusy(false);
    }
  }

  async function approve(pageId: string) {
    setWorkingPage(pageId);
    try {
      await apiFetch(`/api/studio/pages/${pageId}/approve`, { method: "PUT" });
      if (projectId) await refresh(projectId);
    } catch (err) {
      toast(`Approve failed: ${(err as Error).message}`);
    } finally {
      setWorkingPage(null);
    }
  }

  async function regenerate(pageId: string) {
    const note = notes[pageId]?.trim() ?? "";
    if (!note) {
      toast("Write a short direction note first");
      return;
    }
    if (!window.confirm("Re-animate this page? This uses about 30 Runway credits.")) return;
    setWorkingPage(pageId);
    try {
      await apiFetch(`/api/studio/pages/${pageId}/regenerate`, { method: "POST", json: { note } });
      if (projectId) await refresh(projectId);
      toast("Page queued");
    } catch (err) {
      toast(`Could not queue: ${(err as Error).message}`);
    } finally {
      setWorkingPage(null);
    }
  }

  async function publish() {
    if (!projectId) return;
    setBusy(true);
    try {
      const res = await apiFetch<{ slug: string }>(`/api/studio/projects/${projectId}/publish`, { method: "POST" });
      await refresh(projectId);
      void loadProjects();
      toast("Published to the library");
      void res;
    } catch (err) {
      toast(`Could not publish: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const progress = events[0]?.progress ?? (project?.status === "REVIEW" ? 100 : 0);
  const approvedCount = pages.filter((p) => p.status === "APPROVED").length;
  const published = project?.status === "PUBLISHED";

  return (
    <div className="app-shell">
      <Topbar />
      <main className="container studio">
        <header className="studio-head">
          <div>
            <span className="label">AnimBook Studio</span>
            <h1>Turn your manuscript into an AnimBook</h1>
            <p className="muted">Add your text, check how it was understood, choose a look, then review every animated page before it goes live.</p>
          </div>
          <button type="button" className="btn primary" onClick={newProject}>
            + New project
          </button>
        </header>

        <div className="studio-layout">
          <aside className="studio-projects">
            <h2>Your projects</h2>
            {projects === null && <p className="muted small">Loading…</p>}
            {projects?.length === 0 && <p className="muted small">No projects yet. Start one on the right.</p>}
            <ul>
              {projects?.map((p) => (
                <li key={p.id}>
                  <button type="button" className={`project-item${p.id === projectId ? " active" : ""}`} onClick={() => void openProject(p.id)}>
                    <span className="project-cover" style={{ backgroundImage: p.book?.coverUrl ? `url(${p.book.coverUrl})` : undefined }} />
                    <span className="project-text">
                      <strong>{p.book?.title ?? p.name}</strong>
                      <small>
                        {verticalById(p.vertical)?.label ?? p.vertical} · {p.book?.pageCount ?? 0} pages
                      </small>
                      <span className={`status-chip s-${p.status.toLowerCase()}`}>{STATUS_TEXT[p.status] ?? p.status}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </aside>

          <section className="studio-main">
            <ol className="stepper">
              {steps.map((s, i) => {
                const idx = ORDER.indexOf(s.id);
                const state = s.id === view ? "current" : idx <= ORDER.indexOf(reachable) ? "done" : "todo";
                const clickable = idx <= ORDER.indexOf(reachable) && (s.id !== "SETUP" || !project);
                return (
                  <li key={s.id} className={`step ${state}`}>
                    <button type="button" disabled={!clickable} onClick={() => setView(s.id)}>
                      <span className="step-num">{state === "done" && s.id !== view ? "✓" : i + 1}</span>
                      <span className="step-text">
                        <strong>{s.label}</strong>
                        <small>{s.hint}</small>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>

            {running && (
              <div className="studio-progress" role="status">
                <div className="bar"><div style={{ width: `${Math.max(4, progress)}%` }} /></div>
                <span>{events[0]?.message ?? STATUS_TEXT[project!.status]} · {progress}%</span>
              </div>
            )}

            {view === "SETUP" && (
              <article className="studio-panel">
                <h2>Start a new AnimBook</h2>
                <p className="muted">The type decides the look of the book page and whether an expert review is needed before publishing (Edu and Faith).</p>
                <div className="form-grid">
                  <label className="field">
                    <span>Book title *</span>
                    <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. The Night Train" />
                  </label>
                  <label className="field">
                    <span>Subtitle</span>
                    <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="Optional — e.g. A Novel of the Lagos Waterfront" maxLength={200} />
                  </label>
                  <label className="field">
                    <span>Author *</span>
                    <input value={author} onChange={(e) => setAuthor(e.target.value)} placeholder="Your name or pen name" />
                  </label>
                  <label className="field wide">
                    <span>Short description</span>
                    <textarea value={synopsis} onChange={(e) => setSynopsis(e.target.value)} rows={3} placeholder="One or two sentences readers will see in the library" />
                  </label>
                  <div className="field wide">
                    <span>Type of book</span>
                    <div className="choice-grid">
                      {VERTICALS.map((v) => (
                        <button
                          key={v.id}
                          type="button"
                          className={`choice${vertical === v.id ? " selected" : ""}`}
                          style={vertical === v.id ? { borderColor: v.accent } : undefined}
                          onClick={() => setVertical(v.id)}
                        >
                          <strong style={{ color: v.accent }}>{v.label}</strong>
                          <small>{v.promise}</small>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
                <div className="panel-actions">
                  <button type="button" className="btn primary" disabled={busy || !title.trim() || !author.trim()} onClick={createProject}>
                    {busy ? "Creating…" : "Create project"}
                  </button>
                </div>
              </article>
            )}

            {view === "UPLOAD" && project && (
              <article className="studio-panel">
                <h2>Add your manuscript</h2>
                {project.status === "ANALYZING" ? (
                  <div className="waiting">
                    <span className="spinner" aria-hidden />
                    <div>
                      <strong>Reading your manuscript…</strong>
                      <p className="muted">The Book Brain is working out characters, places and scenes. This usually takes a minute or two.</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="muted">Import a Word (.docx), PDF or text file, or paste the text. Pages split at blank lines (about {pageLength.toLocaleString()} characters each); a line starting with “Chapter” starts a new chapter.</p>
                    <textarea
                      className="manuscript"
                      rows={12}
                      value={manuscriptText}
                      onChange={(e) => setManuscriptText(e.target.value)}
                      placeholder="Paste your manuscript here…"
                    />
                    <div className="panel-row">
                      <span className="field-inline">
                        <span className="muted small">Page length</span>
                        {[
                          { v: 480, label: "Short" },
                          { v: 1200, label: "Standard" },
                          { v: 1800, label: "Long" }
                        ].map((o) => (
                          <button
                            key={o.v}
                            type="button"
                            className={`chip${pageLength === o.v ? " on" : ""}`}
                            onClick={() => setPageLength(o.v)}
                          >
                            {o.label}
                          </button>
                        ))}
                      </span>
                      <input
                        ref={fileInput}
                        type="file"
                        accept=".docx,.pdf,.txt,.md,.markdown,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
                        hidden
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) void importFile(f);
                          e.target.value = "";
                        }}
                      />
                      <button type="button" className="btn ghost" onClick={() => fileInput.current?.click()} disabled={importing !== null}>
                        {importing ? "Importing…" : "Import Word, PDF or text file"}
                      </button>
                      <span className="muted small">
                        {importing ? `${importing} · ` : ""}
                        {kept.length} {kept.length === 1 ? "page" : "pages"}
                        {skippedPages.size > 0 ? ` (${skippedPages.size} left out)` : ""} · {manuscriptText.trim().length.toLocaleString()} characters
                      </span>
                    </div>
                    {importError && <p className="notice">{importError}</p>}
                    {sections.length > 1 && (
                      <div className="sections">
                        <h3>What should be animated?</h3>
                        <p className="muted small">
                          Contents pages, copyright notices and the index are left out by default. Tick anything you want
                          to keep.
                        </p>
                        <ul>
                          {sections.map((sec) => {
                            const key = `${sec.kind}:${sec.from}`;
                            const include = !skipped[key];
                            return (
                              <li key={key} className={include ? "" : "off"}>
                                <label>
                                  <input
                                    type="checkbox"
                                    checked={include}
                                    onChange={() => setSkipped((prev) => ({ ...prev, [key]: include }))}
                                  />
                                  <span>
                                    <strong>{sec.label}</strong>
                                    <small>
                                      {sec.pages.length === 1 ? `page ${sec.from}` : `pages ${sec.from}–${sec.to}`} ·{" "}
                                      {sec.sample.replace(/\s+/g, " ").slice(0, 70)}…
                                    </small>
                                  </span>
                                </label>
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}
                    {kept.length > 0 && (
                      <div className="page-preview">
                        {kept.slice(0, 6).map((page) => (
                          <div key={page.pageNum} className="preview-card">
                            <span className="label">
                              Page {page.pageNum}
                              {page.chapter ? ` · ${page.chapter}` : ""}
                            </span>
                            <p>{page.text.slice(0, 140)}{page.text.length > 140 ? "…" : ""}</p>
                          </div>
                        ))}
                        {kept.length > 6 && <div className="preview-card more">+ {kept.length - 6} more pages</div>}
                      </div>
                    )}
                    <div className="panel-actions">
                      <button type="button" className="btn primary" disabled={busy || kept.length === 0} onClick={uploadManuscript}>
                        {busy ? "Uploading…" : `Upload & analyse ${kept.length} pages`}
                      </button>
                    </div>
                  </>
                )}
              </article>
            )}

            {project && (view === "UPLOAD" || view === "REVIEW") && (
              <article className="studio-panel cover-panel">
                <div>
                  <h2>Cover</h2>
                  <p className="muted">
                    Upload your own cover art — the image readers see in the library. PNG, JPG or WebP; portrait
                    (about 2:3) looks best.
                  </p>
                  <input
                    ref={coverInput}
                    type="file"
                    accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadCover(f);
                      e.target.value = "";
                    }}
                  />
                  <button type="button" className="btn ghost" onClick={() => coverInput.current?.click()} disabled={coverBusy}>
                    {coverBusy ? "Uploading…" : project.book?.coverUrl ? "Replace cover" : "Upload cover"}
                  </button>
                </div>
                <div className="cover-preview" style={{ backgroundImage: project.book?.coverUrl ? `url(${project.book.coverUrl})` : undefined }}>
                  {!project.book?.coverUrl && <span>No cover yet</span>}
                </div>
              </article>
            )}

            {view === "BRAIN" && (
              <article className="studio-panel">
                <h2>Check the Book Brain</h2>
                {!brain ? (
                  <p className="muted">The analysis isn&apos;t ready yet.</p>
                ) : (
                  <>
                    <p className="muted">This is how AnimBook understood your book. It shapes every animated page.</p>
                    <div className="facts">
                      <div><span className="label">Genre</span><strong>{brain.genre.join(", ") || "—"}</strong></div>
                      <div><span className="label">Setting</span><strong>{brain.cultural_origin || "—"}</strong></div>
                      <div><span className="label">Audience</span><strong>{brain.target_audience || "—"}</strong></div>
                      <div><span className="label">Suggested style</span><strong>{styleName(brain.style_recommendation) || "—"}</strong></div>
                    </div>
                    <h3>Characters</h3>
                    <div className="char-grid">
                      {brain.characters.length === 0 && <p className="muted small">No named characters.</p>}
                      {brain.characters.map((c) => (
                        <div key={c.name} className="char-card">
                          <strong>{c.name}</strong>
                          {c.role && <span className="pill">{c.role}</span>}
                          <p>{c.description}</p>
                        </div>
                      ))}
                    </div>
                    <h3>Scenes</h3>
                    <div className="scene-table">
                      {brain.page_manifest.map((m) => (
                        <div key={m.page_num} className="scene-row">
                          <span className="scene-num">{m.page_num}</span>
                          <div>
                            <div className="scene-tags">
                              {m.setting && <span className="pill">{m.setting}</span>}
                              {m.emotion && <span className="pill">{m.emotion}</span>}
                              {m.camera_angle && <span className="pill">{m.camera_angle}</span>}
                            </div>
                            <p>{m.animation_prompt_draft}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="panel-actions">
                      <button type="button" className="btn primary" onClick={confirmBrain} disabled={busy}>
                        Looks right — choose a style
                      </button>
                    </div>
                  </>
                )}
              </article>
            )}

            {view === "STYLE" && (
              <article className="studio-panel">
                <h2>Choose the look</h2>
                {project?.status === "GENERATING" ? (
                  <div className="waiting">
                    <span className="spinner" aria-hidden />
                    <div>
                      <strong>Animating your pages…</strong>
                      <p className="muted">Each page takes a minute or two. You can leave this page — progress is saved, and your project will say “Ready to review” when it&apos;s done.</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="muted">Every page is painted in this style.{brain?.style_recommendation ? ` The Book Brain suggested: ${styleName(brain.style_recommendation)}.` : ""}</p>
                    <div className="style-grid">
                      {styleOptions.map((opt) => (
                        <button key={opt.id} type="button" className={`style-card${styleId === opt.id ? " selected" : ""}`} onClick={() => setStyleId(opt.id)}>
                          <span className="style-swatch" style={{ background: `linear-gradient(135deg, ${opt.colors[0]}, ${opt.colors[1]})` }} />
                          <strong>{opt.label}</strong>
                          <small>{opt.blurb}</small>
                        </button>
                      ))}
                    </div>
                    <h3>How much motion?</h3>
                    <div className="mode-grid">
                      <button type="button" className={`mode-card${mode === "illustrated" ? " selected" : ""}`} onClick={() => setMode("illustrated")}>
                        <strong>Illustrated + key scenes</strong>
                        <small>
                          Every page painted and slowly panned; chapter openings and key moments fully animated
                          ({keyPageCount(pages.length)} of {pages.length} pages move).
                        </small>
                        <span className="mode-cost">≈ {estimateCredits(pages.length, "illustrated")} credits · ${(estimateCredits(pages.length, "illustrated") / 100).toFixed(2)}</span>
                      </button>
                      <button type="button" className={`mode-card${mode === "full" ? " selected" : ""}`} onClick={() => setMode("full")}>
                        <strong>Every page animated</strong>
                        <small>A five-second animation on every page. Best for short, visual books.</small>
                        <span className="mode-cost">≈ {estimateCredits(pages.length, "full")} credits · ${(estimateCredits(pages.length, "full") / 100).toFixed(2)}</span>
                      </button>
                    </div>
                    <div className="cost-note">
                      <strong>{pages.length} pages</strong> · about <strong>{estimateCredits(pages.length, mode)} Runway credits</strong> (≈ ${(estimateCredits(pages.length, mode) / 100).toFixed(2)}).{" "}
                      {pages.length > 60
                        ? "The opening pages are narrated now; the rest are recorded the first time a reader plays them."
                        : "Narration for every page is recorded too."}
                    </div>
                    <div className="panel-actions">
                      <button type="button" className="btn primary" onClick={generate} disabled={busy || pages.length === 0}>
                        {busy ? "Starting…" : mode === "full" ? "Animate my book" : "Illustrate my book"}
                      </button>
                    </div>
                  </>
                )}
              </article>
            )}

            {view === "REVIEW" && project && (
              <article className="studio-panel">
                <div className="review-head">
                  <div>
                    <h2>Review your pages</h2>
                    <p className="muted">
                      {approvedCount} of {pages.length} approved. Approve each page, or write a direction note and re-animate it.
                    </p>
                  </div>
                  {published ? (
                    <Link href={`/book/${project.book?.slug}`} className="btn primary">
                      View in library
                    </Link>
                  ) : (
                    <button type="button" className="btn primary" onClick={publish} disabled={busy || approvedCount < pages.length || pages.length === 0}>
                      Publish to library
                    </button>
                  )}
                </div>
                {project.book?.requiresExpertReview && project.book.expertReviewStatus !== "APPROVED" && !published && (
                  <p className="notice">This book needs an expert review before it can be published ({project.book.expertReviewStatus?.toLowerCase()}).</p>
                )}
                <div className="review-grid">
                  {pages.map((page) => {
                    const real = page.videoUrl && !/placehold\.co|\.(png|jpe?g)(\?|$)/i.test(page.videoUrl);
                    return (
                      <article key={page.id} className={`review-card st-${page.status.toLowerCase()}`}>
                        <div className="review-media">
                          {real ? (
                            <video src={page.videoUrl!} poster={page.posterUrl ?? undefined} muted loop autoPlay playsInline />
                          ) : (
                            <div className="media-empty">{page.status === "FLAGGED" ? "Couldn't animate — add a note and retry" : "Not animated yet"}</div>
                          )}
                          <span className="page-badge">Page {page.pageNum}</span>
                          <span className={`status-chip s-${page.status.toLowerCase()}`}>{PAGE_STATUS[page.status] ?? page.status}</span>
                        </div>
                        <p className="review-text">{page.textExcerpt}</p>
                        {page.audioUrl && <audio controls preload="none" src={page.audioUrl} className="review-audio" />}
                        {!published && (
                          <>
                            <textarea
                              rows={2}
                              placeholder="Direction note, e.g. “make it dusk, the boy should face the river”"
                              value={notes[page.id] ?? ""}
                              onChange={(e) => setNotes((prev) => ({ ...prev, [page.id]: e.target.value }))}
                            />
                            <div className="review-actions">
                              <button type="button" className="btn" disabled={workingPage === page.id || page.status === "APPROVED" || !real} onClick={() => approve(page.id)}>
                                {page.status === "APPROVED" ? "Approved" : "Approve"}
                              </button>
                              <button type="button" className="btn ghost" disabled={workingPage === page.id || page.status === "REGENERATING"} onClick={() => regenerate(page.id)}>
                                {page.status === "REGENERATING" ? "Re-animating…" : "Re-animate"}
                              </button>
                            </div>
                          </>
                        )}
                      </article>
                    );
                  })}
                </div>
              </article>
            )}

            {project && events.length > 0 && (
              <details className="studio-activity">
                <summary>Activity ({events.length})</summary>
                <ul>
                  {events.map((e, i) => (
                    <li key={i}>
                      <span className={`dot-status ${e.status}`} />
                      <span>{e.message ?? e.stage.replace(/_/g, " ").toLowerCase()}</span>
                      <small>{new Date(e.at).toLocaleTimeString()}</small>
                    </li>
                  ))}
                </ul>
              </details>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

async function sha256(input: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(input);
  if (typeof crypto !== "undefined" && "subtle" in crypto) {
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
  return Array.from(data).reduce((acc, byte) => acc + byte.toString(16).padStart(2, "0"), "").slice(0, 64);
}