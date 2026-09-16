import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { apiFetch } from "@/lib/api";

interface Choice {
  nodeId: string;
  label: string;
  prompt: string;
}

interface Continuation {
  choiceLabel: string;
  generatedText: string;
  animationPrompt: string;
  speakerName: string;
  emotion: string;
}

interface Props {
  bookId: string;
  rootPage: number;
  onClose(): void;
  onApply(continuation: Continuation): void;
}


export function OracleChoices({ bookId, rootPage, onClose, onApply }: Props) {
  const [choices, setChoices] = useState<Choice[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [continuation, setContinuation] = useState<Continuation | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const json = await apiFetch<{ choices: Choice[] }>(`/api/oracle/${bookId}/decision/${rootPage}`);
        if (!cancelled) {
          setChoices(json.choices);
          setLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          setError((err as Error).message);
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [bookId, rootPage]);

  async function choose(choice: Choice) {
    setSelected(choice.nodeId);
    setLoading(true);
    try {
      const json = await apiFetch<{ continuation: Continuation }>(`/api/oracle/${bookId}/choose`, {
        method: "POST",
        json: { parentNodeId: choice.nodeId, pageNum: rootPage + 1 }
      });
      setContinuation(json.continuation);
      setLoading(false);
    } catch (err) {
      setError(`Could not generate continuation: ${(err as Error).message}`);
      setLoading(false);
    }
  }

  return (
    <motion.div className="modal-backdrop" role="dialog" aria-modal aria-label="Oracle decision">
      <motion.div className="modal" style={{ borderColor: "#9D4C73" }} initial={{ rotateY: 8, opacity: 0 }} animate={{ rotateY: 0, opacity: 1 }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <span className="label" style={{ color: "#9D4C73" }}>AnimBook ORACLE</span>
            <h2 style={{ marginTop: 6 }}>What happens next?</h2>
          </div>
          <button type="button" className="btn ghost" onClick={onClose} aria-label="Close oracle">×</button>
        </header>

        {loading && <p className="muted">Reading the next page into existence…</p>}
        {error && <p className="muted">{error}</p>}
        {!loading && !continuation && (
          <ul style={{ display: "flex", flexDirection: "column", gap: 8, listStyle: "none", padding: 0, margin: 0 }}>
            {choices.map((choice) => (
              <li key={choice.nodeId}>
                <button
                  type="button"
                  className="btn"
                  style={{ width: "100%", justifyContent: "flex-start", borderColor: selected === choice.nodeId ? "#9D4C73" : "var(--border)" }}
                  onClick={() => choose(choice)}
                >
                  <strong style={{ marginRight: 8 }}>{choice.label}</strong>
                  <span className="muted">{choice.prompt}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {continuation && (
          <>
            <p style={{ marginTop: 8 }}>{continuation.generatedText}</p>
            <p className="muted">As {continuation.speakerName} · {continuation.emotion}</p>
            <button type="button" className="btn primary" onClick={() => onApply(continuation)}>
              Continue
            </button>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}