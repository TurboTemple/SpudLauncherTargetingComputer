/**
 * Aiming tones so the barrel can be aimed without looking at the screen.
 * Pitch tracks elevation error (higher = raise), stereo pan tracks left/right, and the beep
 * rate speeds up as you close in. A steady tone means on target.
 * iOS only allows audio after a user gesture, so unlock() runs from the first tap.
 */

export class AimingTone {
  private ctx: AudioContext | null = null;
  private osc: OscillatorNode | null = null;
  private gain: GainNode | null = null;
  private pan: StereoPannerNode | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private state = { elevErr: 0, azErr: 0, onTarget: false };
  private nextBeep = 0;

  unlock(): void {
    if (this.ctx) {
      void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.gain = this.ctx.createGain();
    this.gain.gain.value = 0;
    this.pan = this.ctx.createStereoPanner();
    this.osc = this.ctx.createOscillator();
    this.osc.type = 'sine';
    this.osc.connect(this.gain).connect(this.pan).connect(this.ctx.destination);
    this.osc.start();
  }

  /** Errors in degrees: required − current (positive elevation = raise, positive azimuth = turn right). */
  update(elevErr: number, azErr: number, onTarget: boolean): void {
    this.state = { elevErr, azErr, onTarget };
    if (!this.timer && this.ctx) this.timer = setInterval(() => this.tick(), 25);
  }

  /** A short beep (countdowns). */
  beep(freq = 880, seconds = 0.12): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.setTargetAtTime(0, ctx.currentTime + seconds, 0.02);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + seconds + 0.2);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.ctx && this.gain) this.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.02);
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || !this.osc || !this.gain || !this.pan) return;
    const { elevErr, azErr, onTarget } = this.state;
    const now = ctx.currentTime;
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    this.osc.frequency.setTargetAtTime(660 * 2 ** clamp(elevErr / 5), now, 0.03);
    this.pan.pan.setTargetAtTime(clamp(azErr / 10), now, 0.03);
    if (onTarget) {
      this.gain.gain.setTargetAtTime(0.25, now, 0.02);
      return;
    }
    if (now >= this.nextBeep) {
      // Beep interval from 0.6 s (far) to 0.08 s (close).
      const err = Math.hypot(elevErr, azErr / 3);
      const interval = 0.08 + 0.52 * Math.min(1, err / 10);
      this.gain.gain.cancelScheduledValues(now);
      this.gain.gain.setValueAtTime(0.25, now);
      this.gain.gain.setValueAtTime(0, now + Math.min(0.06, interval / 2));
      this.nextBeep = now + interval;
    }
  }
}

export const aimingTone = new AimingTone();
