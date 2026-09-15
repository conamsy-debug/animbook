import { useEffect, useMemo, useRef, useState } from "react";
import { Topbar } from "@/components/Topbar";
import { apiFetch, type BookBrainJson, type PageRecord, type PipelineEvent, type StudioProjectSummary } from "@/lib/api";
import { useToastStore } from "@/lib/store";

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
    pages: PageRecord[];
    brain?: { rawJson: BookBrainJson; styleSelected: string | null } | null;
  };
}

const styleOptions = [
  { id: "desert-realism", label: "Desert Realism", swatch: "#C49A1C" },
  { id: "painterly-mysticism", label: "Painterly Mysticism", swatch: "#6B2D8B" },
  { id: "graphic-novel", label: "Graphic Novel", swatch: "#AA2020" },
  { id: "anime-inspired", label: "Anime-Inspired", swatch: "#D9872A" },
  { id: "watercolour", label: "Watercolour", swatch: "#1B6B8A" },
  { id: "cinematic-dark", label: "Cinematic Dark", swatch: "#0D1B2E" },
  { id: "scientific-microscopy", label: "Scientific Microscopy", swatch: "#1A6B3C" },
  { id: "sacred-realism", label: "Sacred Realism", swatch: "#7A6650" }
];

const steps: { id: Stage; label: string; description: string }[] = [
  { id: "SETUP", label: "01 · Project setup", description: "Upload a manuscript" },
  { id: "UPLOAD", label: "02 · Ingest", description: "Pages parsed & indexed" },
  { id: "BRAIN", label: "03 · Book Brain", description: "Claude analyses characters and arc" },
  { id: "STYLE", label: "04 · Style", description: "Pick a visual style" },
  { id: "REVIEW", label: "05 · Review", description: "Approve pages" }
];

export default function StudioPage() {
  const [stage, setStage] = useState<Stage>("SETUP");
  const [projectName, setProjectName] = useState("Untitled project");
  const [projectId, setProjectId] = useState<string | null>(null);
  const [vertical, setVertical] = useState("CONSUMER");
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [synopsis, setSynopsis] = useState("");
  const [manuscriptText, setManuscriptText] = useState("");
  const [pages, setPages] = useState<{ pageNum: number; chapter: string | null; text: string }[]>([]);
  const [brain, setBrain] = useState<BookBrainJson | null>(null);
  const [styleId, setStyleId] = useState<string>(styleOptions[1]!.id);
  const [events, setEvents] = useState<PipelineEvent[]>([]);
  const [project, setProject] = useState<ProjectDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [regenerateNote, setRegenerateNote] = useState<Record<string, string>>({});
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const toast = useToastStore((s) => s.push);
  const eventSourceRef = useRef<EventSource | null>(null);

  const parsed = useMemo(() => parseManuscript(manuscriptText), [manuscriptText]);

  useEffect(() => {
    if (pages.length > 0) {
      setStage("UPLOAD");
    }
  }, [pages.length]);

  useEffect(() => {
    return () => {
      eventSourceRef.current?.close();
    };
  }, []);

  async function createProject() {
    setBusy(true);
    try {
      const res = await apiFetch<{ project: StudioProjectSummary; book: { id: string; slug: string } }>("/api/studio/projects", {
        method: "POST",
        json: {
          name: projectName,
          vertical,
          title,
          author,
          synopsis,
          language: "en"
        }
      });
      setProjectId(res.project.id);
      toast("Project created");
      setStage("UPLOAD");
    } catch (err) {
      toast(`Could not create project: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function uploadManuscript() {
    if (!projectId) {
      toast("Create the project first");
      return;
    }
    if (parsed.length === 0) {
      toast("Add at least one page of text");
      return;
    }
    setBusy(true);
    try {
      await apiFetch(`/api/studio/projects/${projectId}/upload`, {
        method: "POST",
        json: {
          sourceFilename: "manuscript.txt",
          sha256: await sha256(`${title}-${author}-${parsed.length}`),
          pages: parsed
        }
      });
      await apiFetch(`/api/studio/projects/${projectId}/analyze`, { method: "POST" });
      subscribe(projectId);
      toast("Manuscript ingested, pipeline queued");
      await refreshProject(projectId);
    } catch (err) {
      toast(`Upload failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  function subscribe(id: string) {
    eventSourceRef.current?.close();
    const es = new EventSource(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/studio/projects/${id}/events`);
    es.addEventListener("pipeline", (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as PipelineEvent;
        setEvents((prev) => [data, ...prev].slice(0, 30));
        if (data.stage === "BOOK_BRAIN_ANALYSIS" && data.status === "succeeded") {
          void loadBrain(id);
          setStage("BRAIN");
        }
        if (data.stage === "VIDEO_GENERATION" && data.status === "succeeded") {
          setStage("REVIEW");
        }
      } catch {
        // ignore malformed event
      }
    });
    es.onerror = () => {
      // EventSource auto-reconnects; nothing to do here.
    };
    eventSourceRef.current = es;
  }

  async function loadBrain(id: string) {
    const detail = await apiFetch<ProjectDetail>(`/api/studio/projects/${id}`);
    setProject(detail);
    const raw = detail.book?.brain?.rawJson as BookBrainJson | undefined;
    if (raw) setBrain(raw);
  }

  async function refreshProject(id: string) {
    const detail = await apiFetch<ProjectDetail>(`/api/studio/projects/${id}`);
    setProject(detail);
    if (detail.book?.brain?.rawJson) {
      setBrain(detail.book.brain.rawJson as BookBrainJson);
    }
  }

  async function saveBrain() {
    if (!projectId || !brain) return;
    setBusy(true);
    try {
      await apiFetch(`/api/studio/projects/${projectId}/brain`, {
        method: "PUT",
        json: { brain }
      });
      toast("Book brain saved");
      setStage("STYLE");
    } catch (err) {
      toast(`Save failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function selectStyle() {
    if (!projectId) return;
    setBusy(true);
    try {
      await apiFetch(`/api/studio/projects/${projectId}/style`, {
        method: "POST",
        json: { styleId }
      });
      await apiFetch(`/api/studio/projects/${projectId}/generate`, { method: "POST" });
      toast("Style locked. Generation queued.");
      subscribe(projectId);
    } catch (err) {
      toast(`Style failed: ${(err as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function approvePage(pageId: string) {
    try {
      await apiFetch(`/api/studio/pages/${pageId}/approve`, { method: "PUT" });
      if (projectId) await refreshProject(projectId);
      toast("Page approved");
    } catch (err) {
      toast(`Approve failed: ${(err as Error).message}`);
    }
  }

  async function regenerate(pageId: string) {
    const note = regenerateNote[pageId]?.trim() ?? "";
    if (note.length === 0) {
      toast("Add a direction note first");
      return;
    }
    setRegeneratingId(pageId);
    try {
      await apiFetch(`/api/studio/pages/${pageId}/regenerate`, {
        method: "POST",
        json: { note }
      });
      if (projectId) await refreshProject(projectId);
      toast("Regeneration queued");
    } catch (err) {
      toast(`Regenerate failed: ${(err as Error).message}`);
    } finally {
      setRegeneratingId(null);
    }
  }

  const progress = useMemo(() => {
    const latest = events[0];
    return latest?.progress ?? 0;
  }, [events]);

  return (
    <div className="app-shell">
      <Topbar />
      <main className="container">
        <header className="section-header">
          <div className="left">
            <span className="dot" style={{ background: "#C49A1C" }} />
            <h1>AnimBook Studio</h1>
          </div>
          <span className="label">Phase 1 · Screens 1–4</span>
        </header>

        <div className="studio-grid">
          <aside className="studio-side">
            <div className="card">
              <h3 style={{ marginBottom: 12 }}>Pipeline</h3>
              {steps.map((s) => (
                <div key={s.id} className={`studio-step ${stage === s.id ? "active" : ""}`}>
                  <span className="num">{s.id === "SETUP" ? "1" : s.id === "UPLOAD" ? "2" : s.id === "BRAIN" ? "3" : s.id === "STYLE" ? "4" : "5"}</span>
                  <div>
                    <div>{s.label}</div>
                    <small style={{ color: "var(--text-muted)", fontFamily: "var(--mono)", letterSpacing: ".12em", textTransform: "uppercase" }}>
                      {s.description}
                    </small>
                  </div>
                </div>
              ))}
            </div>
            <div className="card">
              <h3>Live progress</h3>
              <div className="bar-meter" aria-label={`Pipeline progress ${progress}%`}>
                <div className="fill" style={{ width: `${progress}%` }} />
              </div>
              <ul className="timeline">
                {events.length === 0 && <li className="row">Pipeline idle. Start an upload to see live events.</li>}
                {events.map((event, idx) => (
                  <li key={idx} className="row">
                    <strong>{event.stage}</strong>
                    <span>{event.status} · {event.progress}% · {event.message ?? ""}</span>
                  </li>
                ))}
              </ul>
            </div>
          </aside>

          <section style={{ display: "flex", flexDirection: "column", gap: 16 }}>
            {stage === "SETUP" && (
              <article className="card">
                <h2>01 · Project setup</h2>
                <p className="muted">Create a new AnimBook project. The vertical chooses colour accents and review requirements.</p>
                <div style={{ display: "grid", gap: 12, marginTop: 12 }}>
                  <label>
                    <span className="label">Project name</span>
                    <input value={projectName} onChange={(e) => setProjectName(e.target.value)} />
                  </label>
                  <label>
                    <span className="label">Book title</span>
                    <input value={title} onChange={(e) => setTitle(e.target.value)} />
                  </label>
                  <label>
                    <span className="label">Author</span>
                    <input value={author} onChange={(e) => setAuthor(e.target.value)} />
                  </label>
                  <label>
                    <span className="label">Synopsis</span>
                    <textarea value={synopsis} onChange={(e) => setSynopsis(e.target.value)} rows={3} />
                  </label>
                  <label>
                    <span className="label">Vertical</span>
                    <select value={vertical} onChange={(e) => setVertical(e.target.value)}>
                      {["CONSUMER", "KIDS", "EDU", "FAITH", "DOCS", "VERSE", "COMICS", "BUSINESS", "WELLNESS", "LAW", "TRAVEL", "ORIGINALS"].map((v) => (
                        <option key={v} value={v}>{v}</option>
                      ))}
                    </select>
                  </label>
                  <button type="button" className="btn primary" disabled={busy || !title || !author} onClick={createProject}>
                    Create project
                  </button>
                </div>
              </article>
            )}

            {stage === "UPLOAD" && (
              <article className="card">
                <h2>02 · Manuscript upload</h2>
                <p className="muted">Paste a manuscript below. Pages are detected by blank-line breaks; chapters by lines starting with "Chapter".</p>
                <textarea
                  rows={10}
                  value={manuscriptText}
                  onChange={(e) => setManuscriptText(e.target.value)}
                  placeholder="Paste your manuscript text here…"
                />
                <p className="label">{parsed.length} pages detected</p>
                <div style={{ display: "flex", gap: 12 }}>
                  <button type="button" className="btn" onClick={() => setPages(parsed)} disabled={parsed.length === 0}>
                    Preview {parsed.length} pages
                  </button>
                  <button type="button" className="btn primary" disabled={busy || parsed.length === 0} onClick={uploadManuscript}>
                    Upload & analyse
                  </button>
                </div>
                {pages.length > 0 && (
                  <ul style={{ marginTop: 12 }}>
                    {pages.map((page) => (
                      <li key={page.pageNum}>
                        <strong>Page {page.pageNum}{page.chapter ? ` · ${page.chapter}` : ""}</strong>
                        <p className="muted">{page.text.slice(0, 110)}{page.text.length > 110 ? "…" : ""}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </article>
            )}

            {stage === "BRAIN" && (
              <article className="card">
                <h2>03 · Book Brain Review</h2>
                {!brain && <p className="muted">Waiting for Claude Book Brain analysis…</p>}
                {brain && (
                  <>
                    <dl className="kvp">
                      <dt>Title</dt>
                      <dd>{brain.title}</dd>
                      <dt>Genre</dt>
                      <dd>{brain.genre.join(", ")}</dd>
                      <dt>Cultural origin</dt>
                      <dd>{brain.cultural_origin}</dd>
                      <dt>Audience</dt>
                      <dd>{brain.target_audience}</dd>
                      <dt>Style</dt>
                      <dd>{brain.style_recommendation}</dd>
                    </dl>
                    <h3 style={{ marginTop: 16 }}>Characters</h3>
                    <ul>
                      {brain.characters.map((c) => (
                        <li key={c.name}><strong>{c.name}</strong> — {c.description}</li>
                      ))}
                    </ul>
                    <h3 style={{ marginTop: 16 }}>Manifest</h3>
                    <ul>
                      {brain.page_manifest.map((p) => (
                        <li key={p.page_num}>
                          <strong>Page {p.page_num}</strong> — {p.setting}, {p.emotion}, {p.camera_angle}
                          <p className="muted">{p.animation_prompt_draft}</p>
                        </li>
                      ))}
                    </ul>
                    <div style={{ display: "flex", gap: 12 }}>
                      <button type="button" className="btn" onClick={saveBrain} disabled={busy}>
                        Save & continue
                      </button>
                    </div>
                  </>
                )}
              </article>
            )}

            {stage === "STYLE" && (
              <article className="card">
                <h2>04 · Visual style</h2>
                <p className="muted">Pick the LoRA-trained style that defines the look of every AnimPage.</p>
                <div className="grid">
                  {styleOptions.map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      className="book-card"
                      onClick={() => setStyleId(opt.id)}
                      style={{ alignItems: "flex-start", borderColor: styleId === opt.id ? opt.swatch : undefined }}
                    >
                      <div className="swatches">
                        <div className="swatch" style={{ background: opt.swatch }} />
                      </div>
                      <span className="by">{opt.id}</span>
                      <h3 style={{ fontSize: "1.05rem" }}>{opt.label}</h3>
                    </button>
                  ))}
                </div>
                <div style={{ marginTop: 12 }}>
                  <button type="button" className="btn primary" onClick={selectStyle} disabled={busy}>
                    Lock style & start generation
                  </button>
                </div>
              </article>
            )}

            {stage === "REVIEW" && (
              <article className="card">
                <h2>05 · Review dashboard</h2>
                <p className="muted">Approve AnimPages or request a regeneration with a direction note.</p>
                <div className="grid">
                  {(project?.book?.pages ?? []).map((page) => (
                    <article key={page.id} className="page-card">
                      <div className="meta">
                        <span>Page {page.pageNum}</span>
                        <span>{page.status}</span>
                      </div>
                      {page.videoUrl && (
                        <video src={page.videoUrl} poster={page.posterUrl ?? undefined} muted loop autoPlay playsInline />
                      )}
                      <p className="excerpt">{page.textExcerpt}</p>
                      <div className="scene-meta">
                        {page.emotionalRegister && <span className="pill">{page.emotionalRegister}</span>}
                        {page.cameraAngle && <span className="pill">{page.cameraAngle}</span>}
                        <span className="pill">Q {(page.qualityScore ?? 0).toFixed(2)}</span>
                      </div>
                      <textarea
                        rows={2}
                        placeholder="Direction note for regeneration (optional)"
                        value={regenerateNote[page.id] ?? ""}
                        onChange={(e) =>
                          setRegenerateNote((prev) => ({ ...prev, [page.id]: e.target.value }))
                        }
                      />
                      <div style={{ display: "flex", gap: 8 }}>
                        <button type="button" className="btn" onClick={() => approvePage(page.id)}>
                          Approve
                        </button>
                        <button
                          type="button"
                          className="btn ghost"
                          onClick={() => regenerate(page.id)}
                          disabled={regeneratingId === page.id}
                        >
                          {regeneratingId === page.id ? "Regenerating…" : "Regenerate"}
                        </button>
                      </div>
                    </article>
                  ))}
                </div>
              </article>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}

function parseManuscript(raw: string): { pageNum: number; chapter: string | null; text: string }[] {
  if (!raw.trim()) return [];
  const paragraphs = raw.split(/\n\s*\n+/).map((p) => p.trim()).filter(Boolean);
  let buffer: string[] = [];
  let pages: { pageNum: number; chapter: string | null; text: string }[] = [];
  const targetLength = 480;
  let chapter = "Chapter 1";
  let pageNum = 1;
  for (const para of paragraphs) {
    const chapterMatch = para.match(/^chapter\s+([\w\-:.]+)/i);
    if (chapterMatch && chapterMatch[1]) {
      if (buffer.length > 0) {
        pages.push({ pageNum: pageNum++, chapter, text: buffer.join("\n\n") });
        buffer = [];
      }
      chapter = `Chapter ${chapterMatch[1]}`;
      continue;
    }
    buffer.push(para);
    if (buffer.join(" ").length >= targetLength) {
      pages.push({ pageNum: pageNum++, chapter, text: buffer.join("\n\n") });
      buffer = [];
    }
  }
  if (buffer.length > 0) pages.push({ pageNum, chapter, text: buffer.join("\n\n") });
  return pages;
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