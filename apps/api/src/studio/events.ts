/**
 * Server-Sent Events broadcast for Studio pipeline progress.
 *
 * The Studio pipeline runs as background jobs. Rather than have clients poll,
 * we keep an in-memory pub/sub per project. Clients subscribe via
 * `GET /api/studio/projects/:id/events` (text/event-stream).
 */
import type { Response } from "express";

export interface PipelineEvent {
  stage: string;
  status: "queued" | "running" | "succeeded" | "failed" | "retrying";
  progress: number;
  message?: string;
  jobId?: string;
  payload?: Record<string, unknown>;
  at: string;
}

type Subscriber = (event: PipelineEvent) => void;

const subscribers = new Map<string, Set<Subscriber>>();

export function subscribeProject(projectId: string, fn: Subscriber): () => void {
  let bucket = subscribers.get(projectId);
  if (!bucket) {
    bucket = new Set();
    subscribers.set(projectId, bucket);
  }
  bucket.add(fn);
  return () => {
    bucket?.delete(fn);
    if (bucket && bucket.size === 0) subscribers.delete(projectId);
  };
}

export function emitPipelineEvent(projectId: string, event: PipelineEvent): void {
  const bucket = subscribers.get(projectId);
  if (!bucket) return;
  for (const fn of bucket) {
    try {
      fn(event);
    } catch {
      // Subscribers that throw should not poison the channel.
    }
  }
}

export function writeSseHeaders(res: Response): void {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache, no-transform");
  res.setHeader("Connection", "keep-alive");
  res.setHeader("X-Accel-Buffering", "no");
  res.flushHeaders?.();
}

export function writeSseEvent(res: Response, event: PipelineEvent): void {
  res.write(`event: pipeline\n`);
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}