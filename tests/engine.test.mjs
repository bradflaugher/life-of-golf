import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TERRAIN,
  CARD_KINDS,
  DIFFICULTY_PRESETS,
  simulateShot,
  solveLevel,
  generateLevel,
} from '../src/engine.js';
import { CaddieNet } from '../src/caddie.js';

function makeFlatLevel(w, h, overrides = {}) {
  const grid = Array.from({ length: h }, () =>
    Array.from({ length: w }, () => ({ terrain: TERRAIN.GRASS, elev: 0 }))
  );
  return {
    width: w,
    height: h,
    grid,
    start: { x: 0, y: 2 },
    cup: { x: w - 1, y: 2 },
    cards: [],
    ...overrides,
  };
}

test('roll card moves ball and sinks into cup', () => {
  const lvl = makeFlatLevel(5, 5);
  lvl.grid[2][3].terrain = TERRAIN.CUP;
  const res = simulateShot(lvl, { x: 0, y: 2 }, { kind: CARD_KINDS.ROLL, roll: 3 }, 1);
  assert.equal(res.won, true);
  assert.deepEqual(res.endPos, { x: 3, y: 2 });
});

test('sand bunker stops roll and blocks rolling out, but chip escapes', () => {
  const lvl = makeFlatLevel(5, 5);
  lvl.grid[2][1].terrain = TERRAIN.SAND;
  const res1 = simulateShot(lvl, { x: 0, y: 2 }, { kind: CARD_KINDS.ROLL, roll: 4 }, 1);
  assert.deepEqual(res1.endPos, { x: 1, y: 2 });

  const stuck = simulateShot(lvl, { x: 1, y: 2 }, { kind: CARD_KINDS.ROLL, roll: 2 }, 1);
  assert.equal(stuck.stuckInSand, true);
  assert.deepEqual(stuck.endPos, { x: 1, y: 2 });

  const escape = simulateShot(lvl, { x: 1, y: 2 }, { kind: CARD_KINDS.CHIP, air: 2 }, 1);
  assert.equal(escape.stuckInSand, false);
  assert.deepEqual(escape.endPos, { x: 3, y: 2 });
});

test('ice slides continuously until off ice', () => {
  const lvl = makeFlatLevel(6, 5);
  lvl.grid[2][1].terrain = TERRAIN.ICE;
  lvl.grid[2][2].terrain = TERRAIN.ICE;
  lvl.grid[2][3].terrain = TERRAIN.ICE;
  const res = simulateShot(lvl, { x: 0, y: 2 }, { kind: CARD_KINDS.ROLL, roll: 1 }, 1);
  assert.deepEqual(res.endPos, { x: 4, y: 2 });
});

test('wall bounces rolling ball backward (bank shot)', () => {
  const lvl = makeFlatLevel(5, 5);
  lvl.grid[2][2].terrain = TERRAIN.WALL;
  const res = simulateShot(lvl, { x: 0, y: 2 }, { kind: CARD_KINDS.ROLL, roll: 2 }, 1);
  assert.deepEqual(res.endPos, { x: 0, y: 2 });
  assert.ok(res.events.includes('wall_bounce'));
});

test('water hazard resets ball to pre-shot position', () => {
  const lvl = makeFlatLevel(5, 5);
  lvl.grid[2][2].terrain = TERRAIN.WATER;
  const res = simulateShot(lvl, { x: 0, y: 2 }, { kind: CARD_KINDS.ROLL, roll: 3 }, 1);
  assert.equal(res.hazard, 'water');
  assert.deepEqual(res.endPos, { x: 0, y: 2 });
});

test('portal teleports ball to linked twin and preserves roll momentum', () => {
  const lvl = makeFlatLevel(6, 5);
  lvl.grid[2][1].terrain = TERRAIN.PORTAL_A;
  lvl.grid[4][3].terrain = TERRAIN.PORTAL_B;
  const res = simulateShot(lvl, { x: 0, y: 2 }, { kind: CARD_KINDS.ROLL, roll: 2 }, 1);
  assert.ok(res.events.includes('portal'));
  assert.deepEqual(res.endPos, { x: 4, y: 4 });
});

test('backspin card chips forward then rolls 1 tile back', () => {
  const lvl = makeFlatLevel(6, 5);
  const res = simulateShot(lvl, { x: 0, y: 2 }, { kind: CARD_KINDS.BACKSPIN, air: 3, back: 1 }, 1);
  assert.deepEqual(res.endPos, { x: 2, y: 2 });
});

test('spring pad launches ball 2 tiles forward over water', () => {
  const lvl = makeFlatLevel(6, 5);
  lvl.grid[2][1].terrain = TERRAIN.SPRING;
  lvl.grid[2][2].terrain = TERRAIN.WATER;
  const res = simulateShot(lvl, { x: 0, y: 2 }, { kind: CARD_KINDS.ROLL, roll: 1 }, 1);
  assert.ok(res.events.includes('spring'));
  assert.deepEqual(res.endPos, { x: 3, y: 2 });
});

test('procedural generator produces BFS-solvable holes for all 4 presets', () => {
  for (const presetId of Object.keys(DIFFICULTY_PRESETS)) {
    for (let i = 1; i <= 5; i++) {
      const level = generateLevel(`test-${presetId}-${i}`, presetId);
      const sol = solveLevel(level);
      assert.ok(sol && sol.length >= 1, `Expected solvable ${presetId} hole #${i}`);
      // Verify executing BFS solution actually wins!
      let pos = { ...level.start };
      let won = false;
      for (const m of sol) {
        const res = simulateShot(level, pos, level.cards[m.cardIndex], m.dir);
        pos = res.endPos;
        if (res.won) won = true;
      }
      assert.equal(won, true, `BFS solution must sink the ball on ${presetId} #${i}`);
    }
  }
});

test('CaddieNet-v1 loads weights and produces valid softmax distribution', () => {
  const data = JSON.parse(readFileSync(new URL('../models/caddie_net.json', import.meta.url), 'utf8'));
  const net = new CaddieNet();
  net.loadFromJSON(data);
  const level = generateLevel('caddie-test-1', 'classic');
  const ev = net.evaluateBoard(level, level.start, 0);
  assert.ok(ev && ev.ranked.length > 0);
  const sumProb = ev.ranked.reduce((a, b) => a + b.prob, 0);
  assert.ok(Math.abs(sumProb - 1.0) < 1e-4, `Softmax probs must sum to 1, got ${sumProb}`);
  assert.equal(ev.best.activations.length, 32);
});
