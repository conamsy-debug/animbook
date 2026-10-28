/**
 * Resolve the ffmpeg / ffprobe binaries the API should use.
 *
 * Why this exists: `services/trailer.ts` and `services/voiceQuality.ts`
 * spawn `ffmpeg` / `ffprobe` by bare name. The Railway API image did not
 * ship either binary, so every trailer/voice-quality call failed with
 * ENOENT. There are three places a binary can come from, and we try them
 * in order of explicitness:
 *
 *   1. FFMPEG_PATH / FFPROBE_PATH — an explicit override (used by the
 *      local one-off scripts, and the escape hatch if the image ever
 *      changes shape again).
 *   2. The `@ffmpeg-installer/ffmpeg` + `@ffprobe-installer/ffprobe`
 *      npm packages. These ship the binary INSIDE the package tarball
 *      (no postinstall download), so they survive `--ignore-scripts`
 *      builds and network-restricted builders. They are glibc builds, so
 *      they work on the Debian-based NIXPACKS image but NOT on Alpine —
 *      which is why Dockerfile.api also does `apk add --no-cache ffmpeg`.
 *   3. Whatever is on PATH (the Alpine `apk add` route, or a system ffmpeg).
 *
 * Every consumer must handle `null` gracefully: media post-processing is
 * an optimisation, never a reason to fail a pipeline job.
 */
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";

const require = createRequire(import.meta.url);

function fromEnv(name: string): string | null {
  const v = process.env[name];
  return v && existsSync(v) ? v : null;
}

function fromInstaller(pkg: string, envOverride: string): string | null {
  const direct = fromEnv(envOverride);
  if (direct) return direct;
  try {
    // The installer packages export the absolute path to the binary.
    const mod = require(pkg) as { path?: string };
    if (mod?.path && existsSync(mod.path)) return mod.path;
  } catch {
    /* package not installed — fall through to PATH */
  }
  return null;
}

let ffmpegCache: string | null | undefined;
let ffprobeCache: string | null | undefined;

/** Absolute path to ffmpeg, or null when it is not available. */
export function resolveFfmpeg(): string | null {
  if (ffmpegCache !== undefined) return ffmpegCache;
  ffmpegCache = fromEnv("FFMPEG_PATH") ?? fromInstaller("@ffmpeg-installer/ffmpeg", "FFMPEG_PATH") ?? "ffmpeg";
  // "ffmpeg" as a bare name means: hope it is on PATH. The caller checks
  // the result of the spawn to find out.
  return ffmpegCache;
}

/** Absolute path to ffprobe, or null when it is not available. */
export function resolveFfprobe(): string | null {
  if (ffprobeCache !== undefined) return ffprobeCache;
  ffprobeCache = fromEnv("FFPROBE_PATH") ?? fromInstaller("@ffprobe-installer/ffprobe", "FFPROBE_PATH") ?? "ffprobe";
  return ffprobeCache;
}

/** True when the resolved binary is a real file we can point at. */
export function hasStaticFfmpeg(): boolean {
  const p = resolveFfmpeg();
  return Boolean(p && p.includes("/") || p?.includes("\\"));
}

export const ffmpegStatus = {
  ffmpeg: resolveFfmpeg(),
  ffprobe: resolveFfprobe()
};

