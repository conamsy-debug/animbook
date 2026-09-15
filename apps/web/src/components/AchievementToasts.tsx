import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";

export interface Achievement {
  code: string;
  title: string;
  description: string;
}

interface Props {
  queue: Achievement[];
  onConsumed(index: number): void;
}

export function AchievementToasts({ queue, onConsumed }: Props) {
  return (
    <div style={{ position: "fixed", bottom: 90, left: 16, right: 16, display: "flex", flexDirection: "column", gap: 8, zIndex: 30 }}>
      <AnimatePresence>
        {queue.map((achievement, idx) => (
          <AchievementToast key={`${achievement.code}-${idx}`} achievement={achievement} onDismiss={() => onConsumed(idx)} />
        ))}
      </AnimatePresence>
    </div>
  );
}

function AchievementToast({ achievement, onDismiss }: { achievement: Achievement; onDismiss(): void }) {
  useEffect(() => {
    const handle = setTimeout(onDismiss, 4500);
    return () => clearTimeout(handle);
  }, [onDismiss]);
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -16 }}
      style={{
        background: "var(--card)",
        border: "1px solid var(--gold)",
        borderRadius: 14,
        padding: "12px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 4,
        boxShadow: "0 8px 32px rgba(196, 154, 28, 0.2)"
      }}
    >
      <span className="label" style={{ color: "var(--gold)" }}>Achievement unlocked</span>
      <strong style={{ fontFamily: "var(--serif)", fontSize: "1.1rem" }}>{achievement.title}</strong>
      <span style={{ fontSize: ".9rem", color: "var(--text-muted)" }}>{achievement.description}</span>
    </motion.div>
  );
}