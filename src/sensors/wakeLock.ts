/** Keep the screen on while aiming; the lock is released when the page hides, so re-acquire it. */

export class WakeLockManager {
  private sentinel: WakeLockSentinel | null = null;
  private wanted = false;
  private readonly onVisibility = () => {
    if (this.wanted && document.visibilityState === 'visible') void this.acquire();
  };

  get supported(): boolean {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  }

  get active(): boolean {
    return this.sentinel !== null && !this.sentinel.released;
  }

  async enable(): Promise<boolean> {
    this.wanted = true;
    document.addEventListener('visibilitychange', this.onVisibility);
    return this.acquire();
  }

  async disable(): Promise<void> {
    this.wanted = false;
    document.removeEventListener('visibilitychange', this.onVisibility);
    await this.sentinel?.release().catch(() => {});
    this.sentinel = null;
  }

  private async acquire(): Promise<boolean> {
    if (!this.supported || this.active) return this.active;
    try {
      this.sentinel = await navigator.wakeLock.request('screen');
      return true;
    } catch {
      return false;
    }
  }
}
