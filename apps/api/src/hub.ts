/** In-memory event log per check, so a stream that connects late still sees every step. */
export type HubEvent = { event: string; data: unknown };
type Listener = (e: HubEvent) => void;

export class Hub {
  private logs = new Map<string, HubEvent[]>();
  private listeners = new Map<string, Set<Listener>>();
  private closed = new Set<string>();

  publish(id: string, e: HubEvent): void {
    const log = this.logs.get(id) ?? [];
    log.push(e);
    this.logs.set(id, log);
    for (const l of this.listeners.get(id) ?? []) l(e);
  }

  close(id: string): void {
    this.closed.add(id);
    this.publish(id, { event: "end", data: {} });
    // Keep the log for late readers for a while, then let it go.
    setTimeout(() => {
      this.logs.delete(id);
      this.listeners.delete(id);
      this.closed.delete(id);
    }, 15 * 60_000).unref?.();
  }

  isClosed(id: string): boolean {
    return this.closed.has(id);
  }

  has(id: string): boolean {
    return this.logs.has(id);
  }

  subscribe(id: string, l: Listener): { backlog: HubEvent[]; unsubscribe: () => void } {
    const set = this.listeners.get(id) ?? new Set();
    set.add(l);
    this.listeners.set(id, set);
    return { backlog: [...(this.logs.get(id) ?? [])], unsubscribe: () => set.delete(l) };
  }
}
