export interface VoiceSpec {
  voiceId: string;
  name: string;
  pitch?: number;
  rate?: number;
}

/**
 * Speak a piece of text using the browser's built-in SpeechSynthesis API.
 * This is the Constraint #6 fallback when ElevenLabs is unavailable.
 */
export function speakWithBrowser(text: string, voice?: VoiceSpec): void {
  if (typeof window === "undefined") return;
  if (!("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  if (voice) {
    utterance.rate = voice.rate ?? 1;
    utterance.pitch = voice.pitch ?? 1;
    const match = window.speechSynthesis.getVoices().find((v) => v.name === voice.name || v.voiceURI === voice.voiceId);
    if (match) utterance.voice = match;
  }
  utterance.rate = utterance.rate ?? 1;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking(): void {
  if (typeof window === "undefined") return;
  if (!("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
}