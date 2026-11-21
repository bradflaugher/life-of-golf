#!/usr/bin/env node
// Trains CaddieNet: a compact 24->64->32->2 on-device Policy+Value MLP
// on BFS-solved procedural Life of Golf holes and exports models/caddie_net.json.

import { writeFileSync, mkdirSync } from 'node:fs';
import {
  generateLevel,
  simulateShot,
  extractMoveFeatures,
  DIFFICULTY_PRESETS,
  createRng,
} from '../src/engine.js';

const PRESETS = Object.keys(DIFFICULTY_PRESETS);
const rng = createRng('caddie-net-v1-train');

console.log('Generating BFS-solved training dataset...');
const samples = []; // { x: Float32Array(24), yPolicy: 0|1, yValue: number }

const HOLES_PER_PRESET = 140;
let totalHoles = 0;

for (const presetId of PRESETS) {
  for (let h = 0; h < HOLES_PER_PRESET; h++) {
    const level = generateLevel(`train-${presetId}-${h}`, presetId);
    if (!level.solution || level.solution.length < 2) continue;
    totalHoles++;

    let pos = { ...level.start };
    const used = new Set();

    for (let step = 0; step < level.solution.length; step++) {
      const opt = level.solution[step];
      const remStrokes = level.solution.length - step;

      // Positive sample (optimal move)
      const optCard = level.cards[opt.cardIndex];
      const optSim = simulateShot(level, pos, optCard, opt.dir);
      samples.push({
        x: extractMoveFeatures(level, pos, optCard, opt.dir, optSim),
        yPolicy: 1,
        yValue: Math.max(0, remStrokes - 1) / 6,
      });

      // Sample negative moves from same state
      for (let ci = 0; ci < level.cards.length; ci++) {
        if (used.has(ci)) continue;
        for (let d = 0; d < 4; d++) {
          if (ci === opt.cardIndex && d === opt.dir) continue;
          if (rng() > 0.35) continue;
          const sim = simulateShot(level, pos, level.cards[ci], d);
          samples.push({
            x: extractMoveFeatures(level, pos, level.cards[ci], d, sim),
            yPolicy: sim.won ? 1 : 0,
            yValue: sim.won ? 0 : Math.min(1, (remStrokes + (sim.hazard ? 1.5 : 0.5)) / 6),
          });
        }
      }

      used.add(opt.cardIndex);
      pos = { ...optSim.endPos };
    }
  }
}

// Shuffle deterministically
for (let i = samples.length - 1; i > 0; i--) {
  const j = Math.floor(rng() * (i + 1));
  [samples[i], samples[j]] = [samples[j], samples[i]];
}

const split = Math.floor(samples.length * 0.85);
const trainSet = samples.slice(0, split);
const valSet = samples.slice(split);
console.log(`Collected ${samples.length} samples from ${totalHoles} BFS-solved holes (train=${trainSet.length}, val=${valSet.length})`);

// MLP: 24 -> 64 (ReLU) -> 32 (ReLU) -> 2 (policyLogit, valuePred)
const IN = 24, H1 = 64, H2 = 32, OUT = 2;

function initMat(rows, cols, scale) {
  const arr = new Float32Array(rows * cols);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = (rng() * 2 - 1) * scale;
  }
  return arr;
}

const W1 = initMat(H1, IN, Math.sqrt(2 / IN));
const b1 = new Float32Array(H1);
const W2 = initMat(H2, H1, Math.sqrt(2 / H1));
const b2 = new Float32Array(H2);
const W3 = initMat(OUT, H2, Math.sqrt(1 / H2));
const b3 = new Float32Array(OUT);

// Adam state
const params = [W1, b1, W2, b2, W3, b3];
const m = params.map((p) => new Float32Array(p.length));
const v = params.map((p) => new Float32Array(p.length));
const grads = params.map((p) => new Float32Array(p.length));

function sigmoid(z) {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

const h1 = new Float32Array(H1);
const h2 = new Float32Array(H2);
const dh1 = new Float32Array(H1);
const dh2 = new Float32Array(H2);

function forward(x) {
  for (let i = 0; i < H1; i++) {
    let s = b1[i];
    const off = i * IN;
    for (let j = 0; j < IN; j++) s += W1[off + j] * x[j];
    h1[i] = s > 0 ? s : 0;
  }
  for (let i = 0; i < H2; i++) {
    let s = b2[i];
    const off = i * H1;
    for (let j = 0; j < H1; j++) s += W2[off + j] * h1[j];
    h2[i] = s > 0 ? s : 0;
  }
  let logit = b3[0];
  let val = b3[1];
  for (let j = 0; j < H2; j++) {
    logit += W3[j] * h2[j];
    val += W3[H2 + j] * h2[j];
  }
  return { logit, val };
}

const EPOCHS = 28;
const BATCH = 64;
const LR = 0.004;
let stepT = 0;

for (let epoch = 0; epoch < EPOCHS; epoch++) {
  let lossSum = 0;
  for (let start = 0; start < trainSet.length; start += BATCH) {
    for (const g of grads) g.fill(0);
    const end = Math.min(trainSet.length, start + BATCH);
    const bs = end - start;

    for (let idx = start; idx < end; idx++) {
      const s = trainSet[idx];
      const { logit, val } = forward(s.x);
      const p = sigmoid(logit);
      const wPos = s.yPolicy === 1 ? 2.8 : 1.0; // balance positive/negative classes
      const dLogit = wPos * (p - s.yPolicy) / bs;
      const dVal = 2.0 * (val - s.yValue) / bs;

      lossSum += -wPos * (s.yPolicy * Math.log(Math.max(1e-7, p)) + (1 - s.yPolicy) * Math.log(Math.max(1e-7, 1 - p)));

      grads[5][0] += dLogit;
      grads[5][1] += dVal;
      for (let j = 0; j < H2; j++) {
        grads[4][j] += dLogit * h2[j];
        grads[4][H2 + j] += dVal * h2[j];
        dh2[j] = h2[j] > 0 ? dLogit * W3[j] + dVal * W3[H2 + j] : 0;
      }

      dh1.fill(0);
      for (let i = 0; i < H2; i++) {
        const g2 = dh2[i];
        if (g2 === 0) continue;
        grads[3][i] += g2;
        const off = i * H1;
        for (let j = 0; j < H1; j++) {
          grads[2][off + j] += g2 * h1[j];
          dh1[j] += g2 * W2[off + j];
        }
      }

      for (let i = 0; i < H1; i++) {
        const g1 = h1[i] > 0 ? dh1[i] : 0;
        if (g1 === 0) continue;
        grads[1][i] += g1;
        const off = i * IN;
        for (let j = 0; j < IN; j++) {
          grads[0][off + j] += g1 * s.x[j];
        }
      }
    }

    // Adam update
    stepT++;
    const b1Pow = 1 - Math.pow(0.9, stepT);
    const b2Pow = 1 - Math.pow(0.999, stepT);
    for (let pi = 0; pi < params.length; pi++) {
      const p = params[pi];
      const g = grads[pi];
      const mp = m[pi];
      const vp = v[pi];
      for (let i = 0; i < p.length; i++) {
        const gi = g[i] + 1e-4 * p[i];
        mp[i] = 0.9 * mp[i] + 0.1 * gi;
        vp[i] = 0.999 * vp[i] + 0.001 * gi * gi;
        const mHat = mp[i] / b1Pow;
        const vHat = vp[i] / b2Pow;
        p[i] -= (LR * mHat) / (Math.sqrt(vHat) + 1e-8);
      }
    }
  }

  if ((epoch + 1) % 7 === 0 || epoch === EPOCHS - 1) {
    let correct = 0;
    for (const s of valSet) {
      const { logit } = forward(s.x);
      const pred = logit >= 0 ? 1 : 0;
      if (pred === s.yPolicy) correct++;
    }
    console.log(`Epoch ${epoch + 1}/${EPOCHS} · trainLoss=${(lossSum / trainSet.length).toFixed(4)} · valAcc=${((correct / valSet.length) * 100).toFixed(1)}%`);
  }
}

// Round weights to 4 decimal places for compact on-device bundle
const roundArr = (a) => Array.from(a, (v) => Math.round(v * 10000) / 10000);
const paramCount = params.reduce((acc, p) => acc + p.length, 0);

const modelJson = {
  name: 'CaddieNet-v1',
  architecture: [IN, H1, H2, OUT],
  parameters: paramCount,
  trainedOnHoles: totalHoles,
  trainedOnSamples: samples.length,
  weights: {
    W1: roundArr(W1),
    b1: roundArr(b1),
    W2: roundArr(W2),
    b2: roundArr(b2),
    W3: roundArr(W3),
    b3: roundArr(b3),
  },
};

mkdirSync(new URL('../models', import.meta.url), { recursive: true });
const outPath = new URL('../models/caddie_net.json', import.meta.url);
writeFileSync(outPath, JSON.stringify(modelJson));
console.log(`Exported ${modelJson.name} (${paramCount} params) to ${outPath.pathname}`);
