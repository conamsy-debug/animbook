import { useEffect, useRef, useState } from "react";
import { startAmbient, recipeFor, AMBIENT_BUFFER_RATE, AMBIENT_BUFFER_SECONDS } from "./dreamAmbient.mjs";

export type AmbientTrackName = "ocean_waves" | "rainforest" | "fireplace" | "river" | "white_noise";

interface AmbientHandle {
  stop(): void;
  setVolume(v: number): void;
  trackName: AmbientTrackName;
}

/**
 * React hook around the Web Audio API ambient synth. Lazily creates a
 * single AudioContext on first user gesture (modern browsers require
 * a gesture before AudioContext can play). Subsequent mounts reuse it.
 *
 * - `trackName` — which DREAM track to play. `null` / unknown → no-op.
 * - `volume` — 0..1 scalar (default 1).
 * - `enabled` — gate the synth off entirely (e.g. modal open).
 *
 * Returns `{ playing, start, stop, error }`. `start()` must be called
 * from a user-gesture handler (button click) on the first invocation;
 * after that it can be called programmatically.
 */
export function useAmbient(trackName: AmbientTrackName | null | undefined, opts?: {
  volume?: number;
  enabled?: boolean;
}) {
  const volume = opts?.volume ?? 1;
  const enabled = opts?.enabled ?? true;
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const handleRef = useRef<AmbientHandle | null>(null);

  async function start() {
    if (!enabled) return;
    if (!trackName || !recipeFor(trackName)) return;
    try {
      if (!ctxRef.current) {
        const Ctor = (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext);
        ctxRef.current = new Ctor();
      }
      const ctx = ctxRef.current;
      if (ctx.state === "suspended") await ctx.resume();
      // Stop any prior track before starting the new one.
      if (handleRef.current) handleRef.current.stop();
      handleRef.current = startAmbient(ctx, trackName);
      handleRef.current.setVolume(volume);
      setPlaying(true);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  function stop() {
    handleRef.current?.stop();
    handleRef.current = null;
    setPlaying(false);
  }

  // React to track changes: stop the old, the next `start()` will play the new.
  useEffect(() => {
    if (handleRef.current && handleRef.current.trackName !== trackName) {
      handleRef.current.stop();
      handleRef.current = null;
      setPlaying(false);
    }
  }, [trackName]);

  // Volume ramp on change
  useEffect(() => {
    handleRef.current?.setVolume(volume);
  }, [volume]);

  // Tear down on unmount
  useEffect(() => {
    return () => {
      handleRef.current?.stop();
      handleRef.current = null;
    };
  }, []);

  return { playing, start, stop, error };
}

export const _internal = { AMBIENT_BUFFER_RATE, AMBIENT_BUFFER_SECONDS };
