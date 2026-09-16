export interface VoiceSpec {
  voiceId: string;
  name: string;
  pitch?: number;
  rate?: number;
  volume?: number;
}

/**
 * Speak a piece of text using the browser's built-in SpeechSynthesis API.
 * This is the Constraint #6 fallback when a page has no ElevenLabs narration.
 */
export function speakWithBrowser(text: string, voice?: VoiceSpec, onEnd?: () => void): void {
  if (typeof window === "undefined") return;
  if (!("speechSynthesis" in window)) {
    onEnd?.();
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.rate = voice?.rate ?? 1;
  utterance.pitch = voice?.pitch ?? 1;
  utterance.volume = voice?.volume ?? 1;
  if (voice) {
    const match = window.speechSynthesis.getVoices().find((v) => v.name === voice.name || v.voiceURI === voice.voiceId);
    if (match) utterance.voice = match;
  }
  if (onEnd) {
    utterance.onend = onEnd;
    utterance.onerror = onEnd;
  }
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (typeof window === "undefined") return;
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
}
