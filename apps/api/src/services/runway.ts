/**
 * Runway Gen-3 Alpha client.
 *
 * The Studio Pipeline calls this with each AnimPage's prompt. When the key is
 * missing or the request fails we return a graceful "stub" payload so the
 * downstream Cloudflare upload step still has something to publish.
 */
import { appEnv, isFeatureEnabled } from "../config/env.js";

export interface RunwayJobInput {
  projectId: string;
  pageNum: number;
  prompt: string;
  negativePrompt?: string;
  styleId?: string;
  durationSeconds?: number;
}

export interface RunwayJobResult {
  videoUrl: string;
  posterUrl: string;
  durationSeconds: number;
  source: "runway" | "stub";
}

const STUB_BASE = "https://placehold.co/640x360/080C14/C49A1C/png?text=AnimBook";

export async function generateClip(input: RunwayJobInput): Promise<RunwayJobResult> {
  if (!isFeatureEnabled("RUNWAY")) {
    return stubResult(input, "RUNWAY_API_KEY not configured");
  }
  try {
    const response = await fetch("https://api.dev.runwayml.com/v1/tasks", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${appEnv.RUNWAY_API_KEY}`,
        "Content-Type": "application/json",
        "X-Runway-Version": "2024-11-06"
      },
      body: JSON.stringify({
        model: "gen3a_turbo",
        promptText: input.prompt,
        negativePrompt: input.negativePrompt,
        duration: input.durationSeconds ?? 10,
        ratio: "1280:720"
      })
    });
    if (!response.ok) {
      throw new Error(`Runway returned ${response.status}`);
    }
    const json = (await response.json()) as { id: string };
    const polled = await pollRunway(json.id);
    return {
      videoUrl: polled.output?.[0] ?? STUB_BASE,
      posterUrl: STUB_BASE,
      durationSeconds: input.durationSeconds ?? 10,
      source: "runway"
    };
  } catch (err) {
    console.warn(`[runway] ${(err as Error).message}, returning stub`);
    return stubResult(input, (err as Error).message);
  }
}

async function pollRunway(taskId: string): Promise<{ output?: string[] }> {
  const deadline = Date.now() + 1000 * 60 * 5; // 5 minutes max
  while (Date.now() < deadline) {
    const response = await fetch(`https://api.dev.runwayml.com/v1/tasks/${taskId}`, {
      headers: {
        Authorization: `Bearer ${appEnv.RUNWAY_API_KEY}`,
        "X-Runway-Version": "2024-11-06"
      }
    });
    if (response.ok) {
      const json = (await response.json()) as { status: string; output?: string[] };
      if (json.status === "SUCCEEDED") return json;
      if (json.status === "FAILED") throw new Error("Runway task FAILED");
    }
    await new Promise((resolve) => setTimeout(resolve, 4000));
  }
  throw new Error("Runway task timed out");
}

function stubResult(input: RunwayJobInput, reason: string): RunwayJobResult {
  return {
    videoUrl: STUB_BASE,
    posterUrl: STUB_BASE,
    durationSeconds: input.durationSeconds ?? 10,
    source: "stub"
  };
}

export const runwayStatus = { live: isFeatureEnabled("RUNWAY") };