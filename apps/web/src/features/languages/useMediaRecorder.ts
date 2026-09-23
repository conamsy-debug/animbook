/**
 * useMediaRecorder — Patch 08.
 *
 * Tiny React hook around the MediaRecorder API for the speak_line
 * exercise. The browser records audio, we expose:
 *   - start() / stop() / reset()
 *   - state: "idle" | "recording" | "stopped" | "error"
 *   - audioBlob: Blob | null  — the recorded clip
 *   - errorMessage: string | null
 *   - elapsedMs: number       — wall-clock since start() (capped at 10s)
 *
 * Codec selection: we walk the recorded MIME types from best to
 * worst (audio/webm;codecs=opus is what Chrome / Edge / Firefox ship
 * with; Safari prefers mp4). The hook picks the first one the
 * browser claims to support.
 *
 * Max length: 10 seconds per spec § 9. The hook auto-stops at the
 * cap so the upload payload stays under 5 MB (the route's limit).
 *
 * Why this lives in a hook and not inline in SpeakLineView: the
 * recorder has 5+ pieces of state that need to outlive renders
 * (recorder instance, timer interval, start timestamp). Keeping
 * them in a hook lets the view stay declarative.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

export type RecorderState = "idle" | "recording" | "stopped" | "error";

export interface UseMediaRecorderResult {
  state: RecorderState;
  audioBlob: Blob | null;
  mimeType: string | null;
  errorMessage: string | null;
  /** Milliseconds since the most recent `start()` call. Capped at 10s. */
  elapsedMs: number;
  /** True when the browser exposes any usable audio MIME. */
  isSupported: boolean;
  /** True when the browser is currently capturing audio. */
  isRecording: boolean;
  start: () => void;
  stop: () => void;
  reset: () => void;
}

const MAX_DURATION_MS = 10_000;

/** Walk codec preferences in order; return the first one the
 *  browser's MediaRecorder claims to support. Returns null when
 *  the browser exposes no audio recorder at all. */
function pickSupportedMime(): string | null {
  if (typeof window === "undefined") return null;
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/ogg;codecs=opus",
    "audio/mp4"
  ];
  for (const m of candidates) {
    if (typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(m)) {
      return m;
    }
  }
  return null;
}

export function useMediaRecorder(): UseMediaRecorderResult {
  const mimeType = useMemo(() => pickSupportedMime(), []);
  const isSupported = useMemo(
    () => typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && mimeType !== null,
    [mimeType]
  );

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef<number>(0);
  const stopTimerRef = useRef<number | null>(null);

  const [state, setState] = useState<RecorderState>("idle");
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);

  // Tick the elapsed-time counter while recording.
  useEffect(() => {
    if (state !== "recording") return;
    const id = window.setInterval(() => {
      const ms = Math.min(MAX_DURATION_MS, Date.now() - startedAtRef.current);
      setElapsedMs(ms);
      if (ms >= MAX_DURATION_MS && recorderRef.current?.state === "recording") {
        // Auto-stop at the cap.
        try {
          recorderRef.current.stop();
        } catch {
          /* MediaRecorder.stop() throws if not in recording — ignore. */
        }
      }
    }, 100);
    return () => window.clearInterval(id);
  }, [state]);

  // Tear down on unmount so a stuck recorder doesn't keep the mic
  // light on after the page navigates.
  useEffect(() => {
    return () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        try {
          recorderRef.current.stop();
        } catch {
          /* ignore */
        }
      }
      if (stopTimerRef.current !== null) {
        window.clearTimeout(stopTimerRef.current);
      }
    };
  }, []);

  const start = useCallback(async () => {
    if (!isSupported || mimeType === null) {
      setErrorMessage("Your browser doesn't support audio recording.");
      setState("error");
      return;
    }
    setErrorMessage(null);
    setAudioBlob(null);
    chunksRef.current = [];

    let stream: MediaStream;
    try {
      // The TS DOM lib that ships with our config doesn't include the
      // MediaStream/MediaRecorder types from `@types/dom-mediacapture-
      // record`. Cast the result so we don't have to pull that dep
      // just for this hook — the runtime contract is the same.
      stream = (await navigator.mediaDevices.getUserMedia({ audio: true })) as unknown as MediaStream;
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? `Microphone access denied: ${err.message}` : "Microphone access denied."
      );
      setState("error");
      return;
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorder(stream, { mimeType });
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? `Could not start recorder: ${err.message}` : "Could not start recorder."
      );
      setState("error");
      stream.getTracks().forEach((t) => t.stop());
      return;
    }
    recorderRef.current = recorder;
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };
    recorder.onstop = () => {
      // Combine the chunks into a single Blob. Browsers vary on
      // whether they hand us a single chunk or many; we cover both.
      const blob = new Blob(chunksRef.current, { type: mimeType });
      setAudioBlob(blob);
      setState("stopped");
      setElapsedMs(Math.min(MAX_DURATION_MS, Date.now() - startedAtRef.current));
      // Always release the mic so the indicator turns off.
      stream.getTracks().forEach((t) => t.stop());
    };
    recorder.onerror = (event) => {
      // MediaRecorderErrorEvent surfaces the underlying DOMException
      // in `error`. We surface a friendly message + flip to error.
      const err = (event as unknown as { error?: Error }).error;
      setErrorMessage(err?.message ?? "Recorder error.");
      setState("error");
      stream.getTracks().forEach((t) => t.stop());
    };

    startedAtRef.current = Date.now();
    setElapsedMs(0);
    recorder.start();
    setState("recording");

    // Belt-and-braces auto-stop in case the interval didn't fire.
    if (stopTimerRef.current !== null) window.clearTimeout(stopTimerRef.current);
    stopTimerRef.current = window.setTimeout(() => {
      if (recorder.state === "recording") recorder.stop();
    }, MAX_DURATION_MS + 250);
  }, [isSupported, mimeType]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state === "recording") {
      recorder.stop();
    }
  }, []);

  const reset = useCallback(() => {
    setAudioBlob(null);
    setErrorMessage(null);
    setElapsedMs(0);
    setState("idle");
    chunksRef.current = [];
  }, []);

  return {
    state,
    audioBlob,
    mimeType,
    errorMessage,
    elapsedMs,
    isSupported,
    isRecording: state === "recording",
    start,
    stop,
    reset
  };
}