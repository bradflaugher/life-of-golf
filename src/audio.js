// Synthesized Web Audio Soundscape for Life of Golf — zero external audio files.

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try {
      this.muted = localStorage.getItem('life-of-golf:muted') === '1';
    } catch {}
  }

  ensure() {
    if (this.muted) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  setMuted(m) {
    this.muted = !!m;
    try {
      localStorage.setItem('life-of-golf:muted', this.muted ? '1' : '0');
    } catch {}
  }

  tone(freq, dur, type = 'sine', vol = 0.14, slideTo = null, delay = 0) {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), now + dur);
    }
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.linearRampToValueAtTime(vol, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + dur + 0.02);
  }

  noise(dur, vol = 0.12, filterFreq = 900, delay = 0) {
    const ctx = this.ensure();
    if (!ctx) return;
    const now = ctx.currentTime + delay;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);

    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(filterFreq, now);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    src.start(now);
  }

  cardSelect() {
    this.tone(520, 0.06, 'triangle', 0.08, 660);
  }

  putt() {
    this.tone(240, 0.07, 'triangle', 0.16, 120);
    this.noise(0.045, 0.08, 1600);
  }

  chip() {
    this.tone(320, 0.11, 'sine', 0.14, 580);
    this.noise(0.09, 0.1, 2200);
  }

  bounce() {
    this.tone(390, 0.08, 'square', 0.07, 190);
  }

  sand() {
    this.noise(0.18, 0.16, 650);
    this.tone(110, 0.1, 'sine', 0.09, 75);
  }

  water() {
    this.noise(0.24, 0.14, 1200);
    this.tone(420, 0.18, 'sine', 0.12, 160, 0.03);
    this.tone(260, 0.16, 'sine', 0.08, 520, 0.08);
  }

  ice() {
    this.tone(980, 0.16, 'sine', 0.06, 1320);
  }

  spring() {
    this.tone(220, 0.22, 'sine', 0.15, 760);
  }

  portal() {
    this.tone(440, 0.22, 'triangle', 0.11, 880);
    this.tone(660, 0.22, 'sine', 0.09, 1180, 0.06);
  }

  sink() {
    // Cup rattle + warm major 7th acoustic chime
    this.tone(180, 0.06, 'triangle', 0.14, 140, 0);
    this.tone(220, 0.05, 'triangle', 0.1, 160, 0.06);
    const notes = [523.25, 659.25, 783.99, 987.77, 1046.5];
    notes.forEach((n, i) => {
      this.tone(n, 0.42, 'triangle', 0.11, null, 0.11 + i * 0.065);
    });
  }

  undo() {
    this.tone(420, 0.08, 'triangle', 0.08, 300);
  }
}

export const sound = new SoundEngine();
