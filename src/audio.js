// Synthesized Web Audio soundscape for Life of Golf: soft club sounds and distant birdsong, no audio files.

class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this._suspended = false;
    this._birdTimer = null;
    try {
      this.muted = localStorage.getItem('life-of-golf:muted') === '1';
    } catch {}
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) this.suspend();
        else this.resume();
      });
    }
    if (typeof window !== 'undefined') {
      window.addEventListener('pagehide', () => this.suspend());
      window.addEventListener('pageshow', () => {
        if (typeof document === 'undefined' || !document.hidden) this.resume();
      });
    }
  }

  _isHidden() {
    return typeof document !== 'undefined' && Boolean(document.hidden);
  }

  ensure() {
    if (this.muted || this._suspended || this._isHidden()) return null;
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.buildBus(this.ctx);
      this.scheduleBirdsong();
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  suspend() {
    this._suspended = true;
    if (this._birdTimer) {
      clearTimeout(this._birdTimer);
      this._birdTimer = null;
    }
    if (!this.ctx) return;
    if (this.master) {
      this.master.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.015);
    }
    if (this.ctx.state === 'running') {
      this.ctx.suspend().catch(() => {});
    }
  }

  resume() {
    this._suspended = false;
    if (this.muted || this._isHidden() || !this.ctx) return;
    if (this.master) {
      this.master.gain.setTargetAtTime(0.9, this.ctx.currentTime, 0.04);
    }
    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    if (!this._birdTimer) this.scheduleBirdsong();
  }

  // Master bus: a soft limiter plus a short feedback echo, so every blip gets a little arcade air.
  buildBus(ctx) {
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -14;
    limiter.ratio.value = 6;
    const delay = ctx.createDelay(0.5);
    delay.delayTime.value = 0.17;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.26;
    const wet = ctx.createGain();
    wet.gain.value = 0.1;
    this.master.connect(limiter);
    this.master.connect(delay);
    delay.connect(feedback);
    feedback.connect(delay);
    delay.connect(wet);
    wet.connect(limiter);
    limiter.connect(ctx.destination);
  }

  // A songbird somewhere off in the trees: a few quick sine sweeps, every so often.
  scheduleBirdsong() {
    if (this._birdTimer) clearTimeout(this._birdTimer);
    const wait = 5000 + Math.random() * 9000;
    this._birdTimer = setTimeout(() => {
      this._birdTimer = null;
      if (!this.muted && !this._suspended && this.ctx && this.ctx.state === 'running' && !this._isHidden()) {
        const base = 2300 + Math.random() * 1500;
        const notes = 2 + Math.floor(Math.random() * 4);
        for (let i = 0; i < notes; i++) {
          const f = base * (0.9 + Math.random() * 0.3);
          const up = Math.random() < 0.6;
          this.tone(f, 0.07 + Math.random() * 0.05, 'sine', 0.018 + Math.random() * 0.012, up ? f * 1.25 : f * 0.8, i * 0.11);
        }
      }
      if (!this._suspended) this.scheduleBirdsong();
    }, wait);
  }

  setMuted(m) {
    this.muted = !!m;
    try {
      localStorage.setItem('life-of-golf:muted', this.muted ? '1' : '0');
    } catch {}
    if (this.muted) {
      if (this.master && this.ctx) {
        this.master.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.02);
      }
      if (this.ctx && this.ctx.state === 'running') {
        this.ctx.suspend().catch(() => {});
      }
    } else if (!this._suspended && !this._isHidden() && this.ctx) {
      if (this.master) this.master.gain.setTargetAtTime(0.9, this.ctx.currentTime, 0.04);
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    }
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
    gain.connect(this.master);
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
    gain.connect(this.master);
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
    this.tone(390, 0.08, 'triangle', 0.1, 190);
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
