import { useCallback, useEffect, useRef, useState } from "react";
import type { PageRecord } from "@/lib/api";
import { speakWithBrowser, stopSpeaking } from "@/lib/speech";

const VOLUME_KEY = "animbook:volume";

function hasRecordedNarration(page: PageRecord | null): page is PageRecord & { audioUrl: string } {
  return Boolean(page?.audioUrl && /^https?:\/\//.test(page.audioUrl));
}

function readStoredVolume(): { volume: number; muted: boolean } {
  try {
    const raw = window.localStorage.getItem(VOLUME_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { volume?: number; muted?: boolean };
      return {
        volume: typeof parsed.volume === "number" ? Math.min(1, Math.max(0, parsed.volume)) : 1,
        muted: Boolean(parsed.muted)
      };
    }
  } catch {
    // storage unavailable — use defaults
  }
  return { volume: 1, muted: false };
}

/**
 * Page narration for the Reader.
 *
 * - "listening" is the reader's choice: once they press Play, every page they
 *   flip to is narrated until they press Pause.
 * - "speaking" is whether narration for the current page is sounding now.
 * - Pages with a recorded ElevenLabs MP3 play that; others use the browser voice.
 */
export function useNarration(page: PageRecord | null, rate: number, options: { onFinished?: () => void } = {}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  // Every start/stop bumps the token, so "ended" events from narration we
  // cancelled ourselves (page flips, pause) are ignored.
  const tokenRef = useRef(0);
  const audioTokenRef = useRef(-1);
  const listeningRef = useRef(false);
  const onFinishedRef = useRef(options.onFinished);
  onFinishedRef.current = options.onFinished;
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [volume, setVolumeState] = useState(1);
  const [muted, setMutedState] = useState(false);
  const pageIdRef = useRef<string | null>(null);

  useEffect(() => {
    const stored = readStoredVolume();
    setVolumeState(stored.volume);
    setMutedState(stored.muted);
    const audio = new Audio();
    audio.preload = "auto";
    audio.addEventListener("ended", () => {
      setSpeaking(false);
      if (audioTokenRef.current === tokenRef.current && listeningRef.current) onFinishedRef.current?.();
    });
    audio.addEventListener("pause", () => setSpeaking(false));
    audio.addEventListener("play", () => setSpeaking(true));
    audioRef.current = audio;
    return () => {
      audio.pause();
      audio.src = "";
      stopSpeaking();
    };
  }, []);

  const persist = (v: number, m: boolean) => {
    try {
      window.localStorage.setItem(VOLUME_KEY, JSON.stringify({ volume: v, muted: m }));
    } catch {
      // ignore
    }
  };

  const effectiveVolume = muted ? 0 : volume;

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = effectiveVolume;
  }, [effectiveVolume]);

  const stopAll = useCallback(() => {
    tokenRef.current += 1;
    audioRef.current?.pause();
    stopSpeaking();
    setSpeaking(false);
  }, []);

  const start = useCallback(
    (fromBeginning: boolean) => {
      if (!page) return;
      const audio = audioRef.current;
      const token = ++tokenRef.current;
      if (hasRecordedNarration(page) && audio) {
        stopSpeaking();
        if (audio.src !== page.audioUrl) {
          audio.src = page.audioUrl;
        } else if (fromBeginning || audio.ended) {
          audio.currentTime = 0;
        }
        audioTokenRef.current = token;
        audio.playbackRate = rate;
        audio.volume = effectiveVolume;
        void audio.play().catch(() => setSpeaking(false));
      } else {
        audio?.pause();
        setSpeaking(true);
        speakWithBrowser(
          page.textExcerpt,
          { voiceId: page.speakerName ?? "narrator", name: page.speakerName ?? "default", rate, volume: effectiveVolume },
          () => {
            if (token !== tokenRef.current) return;
            setSpeaking(false);
            if (listeningRef.current) onFinishedRef.current?.();
          }
        );
      }
    },
    [page, rate, effectiveVolume]
  );

  // Flipping to a new page: stop the old narration; keep going if listening.
  useEffect(() => {
    if (!page) return;
    if (pageIdRef.current === page.id) return;
    pageIdRef.current = page.id;
    stopAll();
    if (listening) start(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page?.id]);

  const play = useCallback(() => {
    listeningRef.current = true;
    setListening(true);
    start(false);
  }, [start]);

  const pause = useCallback(() => {
    listeningRef.current = false;
    setListening(false);
    stopAll();
  }, [stopAll]);

  const toggle = useCallback(() => {
    if (speaking) pause();
    else play();
  }, [speaking, pause, play]);

  const setVolume = useCallback(
    (v: number) => {
      const clamped = Math.min(1, Math.max(0, v));
      setVolumeState(clamped);
      const nextMuted = clamped === 0 ? true : false;
      setMutedState(nextMuted);
      persist(clamped, nextMuted);
    },
    []
  );

  const toggleMute = useCallback(() => {
    setMutedState((m) => {
      const next = !m;
      persist(volume, next);
      if (!next && volume === 0) {
        setVolumeState(0.8);
        persist(0.8, false);
      }
      return next;
    });
  }, [volume]);

  return {
    listening,
    speaking,
    volume,
    muted,
    recorded: hasRecordedNarration(page),
    play,
    pause,
    toggle,
    setVolume,
    toggleMute
  };
}

export type Narration = ReturnType<typeof useNarration>;
