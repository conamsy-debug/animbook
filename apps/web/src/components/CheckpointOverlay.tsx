import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { EduCheckpoint, DifficultyScore } from "../domain/index.js";

interface Props {
  pageId: string;
  pageNum: number;
  vertical: string;
  onClose: () => void;
  onResponded?: (isCorrect: boolean) => void;
}

interface CheckpointBundle {
  checkpoint: EduCheckpoint;
  difficulty: DifficultyScore;
  misconceptions: { concept: string; description: string; remediation: string }[];
}

const EDU_VERTICALS = new Set(["EDU"]);

export function CheckpointOverlay({ pageId, pageNum, vertical, onClose, onResponded }: Props) {
  const [bundle, setBundle] = useState<CheckpointBundle | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [responseText, setResponseText] = useState("");
  const [startedAt, setStartedAt] = useState<number>(Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ isCorrect: boolean; explanation: string } | null>(null);

  useEffect(() => {
    if (!EDU_VERTICALS.has(vertical)) return;
    let cancelled = false;
    setStartedAt(Date.now());
    setSelected(null);
    setResponseText("");
    setResult(null);
    async function load() {
      try {
        const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/edu/checkpoints/${pageId}`);
        if (!res.ok) {
          setError("No checkpoint for this page yet.");
          return;
        }
        const json = (await res.json()) as CheckpointBundle;
        if (!cancelled) setBundle(json);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [pageId, vertical]);

  if (!EDU_VERTICALS.has(vertical)) return null;

  async function submit() {
    if (!bundle) return;
    setSubmitting(true);
    const elapsed = Math.max(1, Math.round((Date.now() - startedAt) / 1000));
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000"}/api/edu/checkpoints/${bundle.checkpoint.id}/respond`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectedIndex: selected,
          responseText: responseText.trim() || null,
          timeTakenSeconds: elapsed
        })
      });
      if (!res.ok) {
        setError("Could not submit response");
        return;
      }
      const json = (await res.json()) as { isCorrect: boolean; explanation: string };
      setResult(json);
      onResponded?.(json.isCorrect);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <motion.div
      className="modal-backdrop"
      role="dialog"
      aria-modal
      aria-label={`Checkpoint for page ${pageNum}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
    >
      <motion.div
        className="modal"
        style={{ borderColor: "#1A6B3C" }}
        initial={{ rotateY: 8, opacity: 0 }}
        animate={{ rotateY: 0, opacity: 1 }}
        transition={{ duration: 0.4, ease: [0.34, 1.56, 0.64, 1] }}
      >
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span className="label" style={{ color: "#1A6B3C" }}>Checkpoint · page {pageNum}</span>
            <h2 style={{ marginTop: 6 }}>
              {bundle ? bundle.checkpoint.questionType.replace("_", " ") : "Preparing checkpoint…"}
            </h2>
          </div>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close checkpoint">
            ×
          </button>
        </header>

        {error && <p className="muted">{error}</p>}
        {!bundle && !error && <p className="muted">Animating comprehension check…</p>}
        {bundle && !result && (
          <>
            <p style={{ marginTop: 8 }}>{bundle.checkpoint.question}</p>
            <DifficultyBar difficulty={bundle.difficulty} />
            {bundle.checkpoint.options.length > 0 ? (
              <ul style={{ display: "flex", flexDirection: "column", gap: 8, margin: 0, padding: 0, listStyle: "none" }}>
                {bundle.checkpoint.options.map((opt, idx) => (
                  <li key={idx}>
                    <button
                      type="button"
                      className="btn"
                      style={{
                        width: "100%",
                        justifyContent: "flex-start",
                        borderColor: selected === idx ? "#1A6B3C" : "var(--border)",
                        background: selected === idx ? "rgba(26, 107, 60, 0.18)" : undefined
                      }}
                      onClick={() => setSelected(idx)}
                    >
                      {String.fromCharCode(65 + idx)}. {opt}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <textarea
                rows={4}
                placeholder="Type your answer…"
                value={responseText}
                onChange={(e) => setResponseText(e.target.value)}
              />
            )}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
              <span className="muted">Framework: {bundle.checkpoint.curriculumTags[0] ?? "KENYA_CBC"}</span>
              <button
                type="button"
                className="btn primary"
                onClick={submit}
                disabled={submitting || (bundle.checkpoint.options.length > 0 ? selected === null : responseText.trim().length === 0)}
              >
                {submitting ? "Submitting…" : "Submit"}
              </button>
            </div>
          </>
        )}
        {result && (
          <>
            <p style={{ color: result.isCorrect ? "#1A8A4A" : "#D46A0A", fontFamily: "var(--mono)", letterSpacing: ".16em", textTransform: "uppercase" }}>
              {result.isCorrect ? "Correct" : "Not quite"}
            </p>
            <p>{result.explanation}</p>
            {bundle && bundle.misconceptions.length > 0 && !result.isCorrect && (
              <details>
                <summary className="label">Common misconceptions & remediation</summary>
                <ul>
                  {bundle.misconceptions.map((m, idx) => (
                    <li key={idx}>
                      <strong>{m.concept}</strong>: {m.description} — <em>{m.remediation}</em>
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <button type="button" className="btn primary" onClick={onClose}>
              Continue reading
            </button>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

function DifficultyBar({ difficulty }: { difficulty: DifficultyScore }) {
  const composite = Math.round((difficulty.reading_level + difficulty.conceptual_density + difficulty.prior_knowledge + difficulty.visual_complexity) * 50);
  const label = composite < 35 ? "Scaffolded" : composite < 65 ? "Grade-level" : "Stretch";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
      <div className="bar-meter" style={{ flex: 1 }}>
        <div className="fill" style={{ width: `${composite}%` }} />
      </div>
      <span className="label">{label}</span>
    </div>
  );
}