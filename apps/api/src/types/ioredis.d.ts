/**
 * Local ambient declaration for ioredis v5.x.
 *
 * `@types/ioredis@5.0.0` is a stub pointing at types that ioredis@5 doesn't
 * actually ship (the v5 d.ts was still pending at the time of writing).
 * This file provides a tight declaration covering the surface we use:
 *   - client.get / set / del
 *   - scanStream for cache invalidation
 *   - lazyConnect + status enum
 *   - error / ready / connect event handlers
 *   - quit / disconnect / connect lifecycle
 */

declare module "ioredis" {
  type RedisValue = string | number | boolean | null;

  type RedisStatus = "wait" | "connecting" | "connect" | "ready" | "close" | "end";

  interface RedisOptions {
    host?: string;
    port?: number;
    password?: string;
    db?: number;
    url?: string;
    lazyConnect?: boolean;
    enableReadyCheck?: boolean;
    maxRetriesPerRequest?: number | null;
  }

  interface ScanStream {
    on(event: "data", cb: (keys: string[]) => void): unknown;
    on(event: "end" | "error", cb: () => void): unknown;
  }

  class Redis {
    constructor(options?: string | RedisOptions, extra?: Partial<RedisOptions>);
    status: RedisStatus;
    connect(): Promise<void>;
    get(key: string): Promise<string | null>;
    set(key: string, value: RedisValue, ...args: unknown[]): Promise<unknown>;
    del(...keys: string[]): Promise<number>;
    scanStream(opts: { match?: string; count?: number }): ScanStream;
    publish(channel: string, message: string): Promise<number>;
    subscribe(channel: string): Promise<unknown>;
    quit(): Promise<"OK">;
    disconnect(): void;
    on(event: "connect" | "ready" | "error" | "close" | "reconnecting", listener: (...args: unknown[]) => void): this;
    off(event: string, listener: (...args: unknown[]) => void): this;
  }

  export default Redis;
}

declare module "bullmq" {
  import type { RedisOptions } from "ioredis";

  export interface JobsOptions {
    removeOnComplete?: number | boolean;
    removeOnFail?: number | boolean;
    attempts?: number;
  }

  export interface Job<T = unknown> {
    id?: string;
    data: T;
  }

  export class Queue<T = unknown> {
    constructor(name: string, opts?: { connection: RedisOptions });
    add(name: string, data: T, opts?: JobsOptions): Promise<Job<T>>;
    close(): Promise<void>;
  }

  export class Worker<T = unknown> {
    constructor(name: string, processor: (job: Job<T>) => Promise<unknown>, opts?: { connection: RedisOptions });
    on(event: "failed", listener: (job: Job<T> | undefined, err: Error) => void): this;
    close(): Promise<void>;
  }

  export class QueueEvents {
    constructor(name: string, opts: { connection: RedisOptions });
    on(event: "completed" | "failed", listener: (args: { jobId: string }) => void): this;
    close(): Promise<void>;
  }
}
