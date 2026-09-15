import { useEffect, useState } from "react";
import { motion } from "framer-motion";

interface Props {
  enabled: boolean;
  onToggle(value: boolean): void;
}

export function BedtimeToggle({ enabled, onToggle }: Props) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      onClick={() => onToggle(!enabled)}
      className="bedtime"
      style={{
        background: enabled ? "rgba(154, 110, 188, 0.3)" : "var(--surface)",
        border: `1px solid ${enabled ? "#9A6EBC" : "var(--border)"}`,
        color: enabled ? "#E0CDF1" : "var(--text-muted)",
        borderRadius: 999,
        padding: "6px 12px",
        fontFamily: "var(--mono)",
        fontSize: ".7rem",
        letterSpacing: ".16em",
        textTransform: "uppercase",
        display: "inline-flex",
        gap: 8,
        alignItems: "center"
      }}
      title="Bedtime mode dims the palette and slows the narration"
    >
      <span aria-hidden style={{ fontSize: ".9rem" }}>{enabled ? "☾" : "☀"}</span>
      Bedtime
    </button>
  );
}

export function BedtimeStylesheet({ enabled }: { enabled: boolean }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;
  return (
    <motion.div
      aria-hidden
      initial={false}
      animate={{ opacity: enabled ? 1 : 0 }}
      transition={{ duration: 0.6 }}
      style={{
        position: "fixed",
        inset: 0,
        pointerEvents: "none",
        zIndex: 4,
        background: "radial-gradient(ellipse at center, rgba(40, 12, 60, 0.0) 40%, rgba(40, 12, 60, 0.55) 100%)",
        mixBlendMode: "multiply"
      }}
    />
  );
}