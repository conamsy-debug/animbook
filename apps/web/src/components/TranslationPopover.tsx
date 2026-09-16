import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { apiFetch } from "@/lib/api";

interface Props {
  word: string;
  sourceLang: string;
  targetLang: string;
  bookId?: string;
  onClose(): void;
}

interface Gloss {
  sourceLang: string;
  targetLang: string;
  word: string;
  translation: string;
  pronunciation: string | null;
  exampleSentence: string | null;
}


export function TranslationPopover({ word, sourceLang, targetLang, bookId, onClose }: Props) {
  const [gloss, setGloss] = useState<Gloss | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [target, setTarget] = useState(targetLang);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const json = await apiFetch<{ source: Gloss }>(`/api/translation/lookup`, {
          method: "POST",
          json: { word, sourceLang, targetLang: target, bookId }
        });
        if (!cancelled) setGloss(json.source);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, [word, sourceLang, target, bookId, targetLang]);

  return (
    <AnimatePresence>
      <motion.div
        className="modal-backdrop"
        role="dialog"
        aria-modal
        aria-label={`Translation for ${word}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      >
        <motion.div
          className="modal"
          style={{ borderColor: "#0A7B8A" }}
          onClick={(e) => e.stopPropagation()}
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
        >
          <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span className="label" style={{ color: "#0A7B8A" }}>AnimBook LIVE TRANSLATION</span>
              <h2 style={{ marginTop: 6 }}>{word}</h2>
            </div>
            <button type="button" className="btn ghost" onClick={onClose} aria-label="Close translation">×</button>
          </header>

          {error && <p className="muted">{error}</p>}
          {gloss && (
            <>
              <p style={{ fontFamily: "var(--serif)", fontSize: "1.5rem", lineHeight: 1.4 }}>
                {gloss.translation}
              </p>
              {gloss.pronunciation && <p className="muted">/{gloss.pronunciation}/</p>}
              {gloss.exampleSentence && (
                <p className="muted" style={{ marginTop: 8 }}>e.g. {gloss.exampleSentence}</p>
              )}
              <label style={{ marginTop: 12, display: "block" }}>
                <span className="label">Target language</span>
                <select value={target} onChange={(e) => setTarget(e.target.value)}>
                  <option value="en">English</option>
                  <option value="sw">Kiswahili</option>
                  <option value="fr">Français</option>
                  <option value="es">Español</option>
                  <option value="pt">Português</option>
                  <option value="ar">العربية</option>
                  <option value="zh">中文</option>
                  <option value="yo">Yorùbá</option>
                  <option value="ig">Igbo</option>
                  <option value="ha">Hausa</option>
                </select>
              </label>
              <button type="button" className="btn primary" onClick={onClose} style={{ marginTop: 12 }}>
                Replay animation
              </button>
            </>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}