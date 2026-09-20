// AnimBook DREAM ambient synth — pure Web Audio API.
//
// Five looping tracks generated entirely client-side from noise + filters:
//   ocean_waves  — pink noise + lowpass + slow LFO swell (~1/7 Hz)
//   rainforest   — pink noise + bandpass + sparse "drop" clicks
//   fireplace    — brown noise + bandpass + random "pop" crackles
//   river        — brown noise + lowpass + slow LFO + occasional "splash"
//   white_noise  — white noise + gentle bandpass (so it's not harsh)
//
// Pure data — no external audio files. Works offline. Survives the
// autoplay-policy prompt: AudioContext starts suspended, the parent
// resumes on first user gesture. The hook in useAmbient.ts handles
// the gesture wiring.
//
// Run with: `node --test apps/web/tests/dreamAmbient.test.mjs`
//
// AudioBuffer + filter parameters are pinned in tests as pure functions
// (no AudioContext required) so the recipes can be regression-tested.

/** Approximate pink-noise generation via Voss-McCartney algorithm.
 *  Returns an AudioBuffer-compatible Float32Array (length samples,
 *  values in [-1, 1]). Cheap, all in-memory. */
export function makePinkNoise(samples, rng = Math.random) {
  const out = new Float32Array(samples);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < samples; i++) {
    const white = rng() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    out[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
  return out;
}

/** Brown noise (1/f²). Used for river + fireplace (low-frequency body). */
export function makeBrownNoise(samples, rng = Math.random) {
  const out = new Float32Array(samples);
  let last = 0;
  for (let i = 0; i < samples; i++) {
    const white = rng() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    out[i] = last * 3.5;
  }
  return out;
}

/** Pure white noise (uniform [-1, 1]). */
export function makeWhiteNoise(samples, rng = Math.random) {
  const out = new Float32Array(samples);
  for (let i = 0; i < samples; i++) out[i] = rng() * 2 - 1;
  return out;
}

/** Per-track recipe. Pure data — no AudioContext. Tests can pin these. */
export const TRACK_RECIPES = {
  ocean_waves: {
    noise: "pink",
    filter: "lowpass",
    cutoffHz: 900,
    qFactor: 0.7,
    gain: 0.32,
    /** LFO frequency in Hz; one swell every 7s reads as a slow wave. */
    lfoHz: 0.14,
    /** Depth of the LFO swell (0..1 of the gain). */
    lfoDepth: 0.45
  },
  rainforest: {
    noise: "pink",
    filter: "bandpass",
    cutoffHz: 1800,
    qFactor: 0.6,
    gain: 0.18,
    /** Random "rain drop" clicks per second (sparse). */
    clickRate: 0.8,
    clickGain: 0.06
  },
  fireplace: {
    noise: "brown",
    filter: "lowpass",
    cutoffHz: 380,
    qFactor: 0.4,
    gain: 0.45,
    /** Random "pop" crackles per second (medium). */
    clickRate: 1.6,
    clickGain: 0.12
  },
  river: {
    noise: "brown",
    filter: "lowpass",
    cutoffHz: 720,
    qFactor: 0.5,
    gain: 0.36,
    lfoHz: 0.18,
    lfoDepth: 0.35,
    /** Occasional "splash" — louder click every few seconds. */
    clickRate: 0.25,
    clickGain: 0.18
  },
  white_noise: {
    noise: "white",
    filter: "bandpass",
    cutoffHz: 2400,
    qFactor: 0.35,
    gain: 0.22,
    lfoHz: 0.05,
    lfoDepth: 0.15
  }
};

/** Returns the recipe for a track (or null if unknown). */
export function recipeFor(trackName) {
  return TRACK_RECIPES[trackName] ?? null;
}

/** Seconds of pre-baked noise buffer to loop. 4s keeps the loop point
 *  inaudible (pink/brown/white noise is statistically stationary). */
export const AMBIENT_BUFFER_SECONDS = 4;

/** Sample rate we bake the noise at. The AudioContext may resample,
 *  but 22050 Hz is plenty for filtered noise. */
export const AMBIENT_BUFFER_RATE = 22050;

/**
 * Build the AudioNode graph for a track and wire looping noise +
 * optional LFO swell + optional click impulses.
 *
 * Returns an opaque handle with `stop()` and `setVolume(v)` so the
 * caller can tear it down cleanly when DREAM ends.
 *
 * @param {AudioContext} audioCtx — caller-owned context (so we can
 *   share a single context across multiple sound effects).
 * @param {"ocean_waves"|"rainforest"|"fireplace"|"river"|"white_noise"} trackName
 */
export function startAmbient(audioCtx, trackName) {
  const recipe = recipeFor(trackName);
  if (!recipe) throw new Error(`Unknown ambient track: ${trackName}`);

  const sampleCount = AMBIENT_BUFFER_SECONDS * AMBIENT_BUFFER_RATE;
  const noiseBuffer = audioCtx.createBuffer(1, sampleCount, AMBIENT_BUFFER_RATE);
  const data = noiseBuffer.getChannelData(0);
  const rng = Math.random; // ambient noise is non-deterministic by design
  if (recipe.noise === "pink") makePinkNoiseRefill(data, rng);
  else if (recipe.noise === "brown") makeBrownNoiseRefill(data, rng);
  else makeWhiteNoiseRefill(data, rng);

  const source = audioCtx.createBufferSource();
  source.buffer = noiseBuffer;
  source.loop = true;

  const filter = audioCtx.createBiquadFilter();
  filter.type = recipe.filter;
  filter.frequency.value = recipe.cutoffHz;
  filter.Q.value = recipe.qFactor;

  const gainNode = audioCtx.createGain();
  gainNode.gain.value = recipe.gain;

  source.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(audioCtx.destination);
  source.start();

  /** Optional slow LFO for swell (ocean, river, white_noise). */
  let lfoGain = null;
  if (recipe.lfoHz && recipe.lfoDepth) {
    lfoGain = audioCtx.createGain();
    lfoGain.gain.value = recipe.lfoDepth * recipe.gain;
    const osc = audioCtx.createOscillator();
    osc.frequency.value = recipe.lfoHz;
    osc.type = "sine";
    osc.connect(lfoGain);
    lfoGain.connect(gainNode.gain);
    osc.start();
    // store for cleanup
    source._dreamLfo = osc;
    source._dreamLfoGain = lfoGain;
  }

  /** Optional click impulses (rainforest, fireplace, river). */
  let clickTimer = null;
  if (recipe.clickRate && recipe.clickGain) {
    const fire = () => {
      try {
        const now = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.frequency.value = 80 + Math.random() * 1200;
        osc.type = "triangle";
        g.gain.setValueAtTime(0, now);
        g.gain.linearRampToValueAtTime(recipe.clickGain, now + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, now + 0.08);
        osc.connect(g);
        g.connect(audioCtx.destination);
        osc.start(now);
        osc.stop(now + 0.1);
      } catch {
        // AudioContext might be suspended; ignore.
      }
    };
    clickTimer = window.setInterval(() => {
      if (audioCtx.state === "running") fire();
    }, 1000 / recipe.clickRate);
  }

  let stopped = false;
  return {
    trackName,
    setVolume(v) {
      // Linear ramp for smooth changes; clamped to a sane range.
      const safe = Math.max(0, Math.min(1, v));
      gainNode.gain.linearRampToValueAtTime(recipe.gain * safe, audioCtx.currentTime + 0.4);
    },
    stop() {
      if (stopped) return;
      stopped = true;
      try {
        source.stop();
      } catch {
        // already stopped
      }
      if (source._dreamLfo) {
        try { source._dreamLfo.stop(); } catch {}
      }
      if (clickTimer !== null) window.clearInterval(clickTimer);
      try { source.disconnect(); } catch {}
      try { filter.disconnect(); } catch {}
      try { gainNode.disconnect(); } catch {}
      if (source._dreamLfoGain) {
        try { source._dreamLfoGain.disconnect(); } catch {}
      }
    }
  };
}

// Refill variants (in-place) — the named-export pure helpers above are
// kept for tests; these in-place variants avoid a temp Float32Array.
function makePinkNoiseRefill(data, rng) {
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < data.length; i++) {
    const white = rng() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.96900 * b2 + white * 0.1538520;
    b3 = 0.86650 * b3 + white * 0.3104856;
    b4 = 0.55000 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.0168980;
    data[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
    b6 = white * 0.115926;
  }
}

function makeBrownNoiseRefill(data, rng) {
  let last = 0;
  for (let i = 0; i < data.length; i++) {
    const white = rng() * 2 - 1;
    last = (last + 0.02 * white) / 1.02;
    data[i] = last * 3.5;
  }
}

function makeWhiteNoiseRefill(data, rng) {
  for (let i = 0; i < data.length; i++) data[i] = rng() * 2 - 1;
}
