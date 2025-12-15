type ExpiredListener = () => void;
type PreRefreshListener = () => void;
type PostRefreshListener = (success: boolean) => void;

// Tiny event bus for auth/session events so non-React code (fetcher) can signal UI.
class SessionEvents {
  private expiredListeners = new Set<ExpiredListener>();
  private preRefreshListeners = new Set<PreRefreshListener>();
  private postRefreshListeners = new Set<PostRefreshListener>();

  onExpired(listener: ExpiredListener): () => void {
    this.expiredListeners.add(listener);
    return () => this.expiredListeners.delete(listener);
  }

  emitExpired() {
    this.expiredListeners.forEach((listener) => listener());
  }

  onPreRefresh(listener: PreRefreshListener): () => void {
    this.preRefreshListeners.add(listener);
    return () => this.preRefreshListeners.delete(listener);
  }

  emitPreRefresh() {
    this.preRefreshListeners.forEach((listener) => listener());
  }

  onPostRefresh(listener: PostRefreshListener): () => void {
    this.postRefreshListeners.add(listener);
    return () => this.postRefreshListeners.delete(listener);
  }

  emitPostRefresh(success: boolean) {
    this.postRefreshListeners.forEach((listener) => listener(success));
  }
}

export const sessionEvents = new SessionEvents();
