// On-Device Edge Neural Network Runtime (CaddieNet-v1)
// Runs real Float32Array MLP forward passes 100% locally in the browser (<0.5 ms).

import {
  DIRS,
  simulateShot,
  extractMoveFeatures,
  formatCardLabel,
  formatCardName,
} from './engine.js';

export class CaddieNet {
  constructor() {
    this.loaded = false;
    this.meta = null;
    this.W1 = null;
    this.b1 = null;
    this.W2 = null;
    this.b2 = null;
    this.W3 = null;
    this.b3 = null;
    this.dims = [24, 64, 32, 2];
  }

  async load(url = './models/caddie_net.json') {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Failed to load CaddieNet weights: ${resp.status}`);
    const data = await resp.json();
    this.loadFromJSON(data);
    return this;
  }

  loadFromJSON(data) {
    this.dims = data.architecture;
    this.meta = {
      name: data.name,
      parameters: data.parameters,
      trainedOnHoles: data.trainedOnHoles,
      trainedOnSamples: data.trainedOnSamples,
    };
    this.W1 = new Float32Array(data.weights.W1);
    this.b1 = new Float32Array(data.weights.b1);
    this.W2 = new Float32Array(data.weights.W2);
    this.b2 = new Float32Array(data.weights.b2);
    this.W3 = new Float32Array(data.weights.W3);
    this.b3 = new Float32Array(data.weights.b3);
    this.loaded = true;
  }

  forward(x) {
    const [IN, H1, H2] = this.dims;
    const h1 = new Float32Array(H1);
    const h2 = new Float32Array(H2);

    for (let i = 0; i < H1; i++) {
      let s = this.b1[i];
      const off = i * IN;
      for (let j = 0; j < IN; j++) s += this.W1[off + j] * x[j];
      h1[i] = s > 0 ? s : 0;
    }

    for (let i = 0; i < H2; i++) {
      let s = this.b2[i];
      const off = i * H1;
      for (let j = 0; j < H1; j++) s += this.W2[off + j] * h1[j];
      h2[i] = s > 0 ? s : 0;
    }

    let logit = this.b3[0];
    let val = this.b3[1];
    for (let j = 0; j < H2; j++) {
      logit += this.W3[j] * h2[j];
      val += this.W3[H2 + j] * h2[j];
    }

    return {
      logit,
      expectedStrokes: Math.max(0, val * 6),
      activations: h2,
    };
  }

  /**
   * Score every legal (cardIndex, dir) move from the current board state.
   */
  evaluateBoard(level, ballPos, usedMask) {
    if (!this.loaded) return null;
    const t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const candidates = [];

    for (let ci = 0; ci < level.cards.length; ci++) {
      if (usedMask & (1 << ci)) continue;
      const card = level.cards[ci];
      for (let d = 0; d < 4; d++) {
        const sim = simulateShot(level, ballPos, card, d);
        const feat = extractMoveFeatures(level, ballPos, card, d, sim);
        const out = this.forward(feat);
        candidates.push({
          cardIndex: ci,
          card,
          cardLabel: `${formatCardName(card)} ${formatCardLabel(card)}`,
          dir: d,
          dirName: DIRS[d].name,
          logit: out.logit,
          expectedStrokes: out.expectedStrokes,
          activations: out.activations,
          won: sim.won,
          hazard: sim.hazard,
          stuckInSand: sim.stuckInSand,
        });
      }
    }

    if (candidates.length === 0) return null;

    // Softmax over policy logits
    let maxLogit = -Infinity;
    for (const c of candidates) if (c.logit > maxLogit) maxLogit = c.logit;
    let sumExp = 0;
    for (const c of candidates) {
      c._e = Math.exp(c.logit - maxLogit);
      sumExp += c._e;
    }
    for (const c of candidates) {
      c.prob = c._e / sumExp;
      delete c._e;
    }

    candidates.sort((a, b) => b.logit - a.logit);
    const elapsedMs = (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;

    return {
      ranked: candidates,
      best: candidates[0],
      elapsedMs,
      passes: candidates.length,
      predictedStrokesLeft: Math.max(1, Math.round((candidates[0].expectedStrokes + 1) * 10) / 10),
    };
  }
}
