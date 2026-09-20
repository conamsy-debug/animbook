type Subscriber = (event: { type: string; payload: Record<string, unknown> }) => void;

class LiveEventBus {
  private readonly subscribers = new Map<string, Set<Subscriber>>();

  publish(sessionId: string, event: { type: string; payload: Record<string, unknown> }): void {
    const bucket = this.subscribers.get(sessionId);
    if (!bucket) return;
    for (const fn of bucket) {
      try {
        fn(event);
      } catch {
        // ignore subscriber failures
      }
    }
  }

  subscribe(sessionId: string, fn: Subscriber): () => void {
    let bucket = this.subscribers.get(sessionId);
    if (!bucket) {
      bucket = new Set();
      this.subscribers.set(sessionId, bucket);
    }
    bucket.add(fn);
    return () => {
      bucket?.delete(fn);
      if (bucket && bucket.size === 0) this.subscribers.delete(sessionId);
    };
  }

  /**
   * Number of currently-connected subscribers for a session. Used by
   * the active-sessions list so hosts can see how many people are
   * watching. Returns 0 if no one's connected — that's a valid state
   * (e.g. session was just created, no one has subscribed yet).
   */
  subscriberCount(sessionId: string): number {
    return this.subscribers.get(sessionId)?.size ?? 0;
  }
}

export const liveEventBus = new LiveEventBus();