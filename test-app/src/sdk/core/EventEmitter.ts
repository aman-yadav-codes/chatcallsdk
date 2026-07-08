type Handler<T> = (data: T) => void;

/**
 * Lightweight typed event emitter.
 * Used internally by SDK modules to expose event subscriptions to consumers
 * without leaking socket.io internals.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class TypedEventEmitter<Events extends Record<string, any>> {
  private listeners = new Map<keyof Events, Set<Handler<unknown>>>();

  on<K extends keyof Events>(event: K, handler: Handler<Events[K]>): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler as Handler<unknown>);

    // Return unsubscribe function
    return () => this.off(event, handler);
  }

  off<K extends keyof Events>(event: K, handler: Handler<Events[K]>): void {
    this.listeners.get(event)?.delete(handler as Handler<unknown>);
  }

  emit<K extends keyof Events>(event: K, data: Events[K]): void {
    const handlers = this.listeners.get(event);
    if (!handlers) return;
    for (const handler of handlers) {
      try {
        handler(data);
      } catch {
        // Swallow handler errors — one bad consumer shouldn't crash others
      }
    }
  }

  /** Remove all listeners for all events */
  removeAllListeners(): void {
    this.listeners.clear();
  }

  /** Remove all listeners for a specific event */
  removeListeners<K extends keyof Events>(event: K): void {
    this.listeners.delete(event);
  }
}
