/**
 * Звуковые эффекты на Web Audio API — без внешних файлов и зависимостей.
 * Контекст создаётся лениво, при первом действии пользователя.
 */

export class Sfx {
  constructor({ enabled = true } = {}) {
    this.enabled = Boolean(enabled);
    this.ctx = null;
    this.output = null;
  }

  setEnabled(value) {
    this.enabled = Boolean(value);
    if (this.enabled) this.unlock();
  }

  /** Создаёт/возобновляет AudioContext. Вызывать по жесту пользователя. */
  unlock() {
    if (!this.enabled) return null;
    try {
      if (!this.ctx) {
        const Ctor = globalThis.AudioContext ?? globalThis.webkitAudioContext;
        if (!Ctor) return null;
        this.ctx = new Ctor();
        this.output = this.ctx.createGain();
        this.output.gain.value = 0.22;
        this.output.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return this.ctx;
    } catch {
      return null;
    }
  }

  eat() {
    this.#tone(660, 0.09, { type: 'square', gain: 0.32 });
    this.#tone(1010, 0.1, { type: 'square', gain: 0.2, delay: 0.05 });
  }

  bonus() {
    [660, 880, 1320].forEach((frequency, index) => {
      this.#tone(frequency, 0.16, { type: 'triangle', gain: 0.26, delay: index * 0.07 });
    });
  }

  die() {
    this.#tone(420, 0.5, { type: 'sawtooth', gain: 0.26, to: 60 });
    this.#noise(0.35);
  }

  start() {
    this.#tone(520, 0.12, { gain: 0.26 });
    this.#tone(780, 0.18, { gain: 0.24, delay: 0.1 });
  }

  pause() {
    this.#tone(380, 0.12, { type: 'sine', gain: 0.2 });
  }

  #tone(frequency, duration, { type = 'triangle', gain = 0.25, to = null, delay = 0 } = {}) {
    if (!this.enabled) return;
    const ctx = this.unlock();
    if (!ctx) return;
    const startAt = ctx.currentTime + delay;
    const oscillator = ctx.createOscillator();
    const envelope = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, startAt);
    if (to) oscillator.frequency.exponentialRampToValueAtTime(Math.max(30, to), startAt + duration);
    envelope.gain.setValueAtTime(0.0001, startAt);
    envelope.gain.exponentialRampToValueAtTime(gain, startAt + 0.012);
    envelope.gain.exponentialRampToValueAtTime(0.0001, startAt + duration);
    oscillator.connect(envelope);
    envelope.connect(this.output);
    oscillator.start(startAt);
    oscillator.stop(startAt + duration + 0.03);
  }

  #noise(duration = 0.3) {
    if (!this.enabled) return;
    const ctx = this.unlock();
    if (!ctx) return;
    const frames = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, frames, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < frames; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    const envelope = ctx.createGain();
    envelope.gain.value = 0.45;
    source.connect(filter);
    filter.connect(envelope);
    envelope.connect(this.output);
    source.start();
  }
}
