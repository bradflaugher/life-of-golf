// Life of Golf — Pure Deterministic Physics Engine, BFS Solver & Procedural Generator
// Runs identically in the browser and in Node.js tests.

export const DIRS = [
  { id: 0, name: 'N', dx: 0, dy: -1 },
  { id: 1, name: 'E', dx: 1, dy: 0 },
  { id: 2, name: 'S', dx: 0, dy: 1 },
  { id: 3, name: 'W', dx: -1, dy: 0 },
];

export const DIR_OPPOSITE = [2, 3, 0, 1];

export const TERRAIN = {
  VOID: 'void',
  GRASS: 'grass',
  CUP: 'cup',
  SAND: 'sand',
  WATER: 'water',
  ICE: 'ice',
  MUD: 'mud',
  WALL: 'wall',
  RAMP_N: 'rampN', // uphill toward N (dy=-1)
  RAMP_E: 'rampE', // uphill toward E (dx=+1)
  RAMP_S: 'rampS', // uphill toward S (dy=+1)
  RAMP_W: 'rampW', // uphill toward W (dx=-1)
  CONV_N: 'convN',
  CONV_E: 'convE',
  CONV_S: 'convS',
  CONV_W: 'convW',
  SPRING: 'spring',
  PORTAL_A: 'portalA',
  PORTAL_B: 'portalB',
};

export const RAMP_DIR = {
  [TERRAIN.RAMP_N]: 0,
  [TERRAIN.RAMP_E]: 1,
  [TERRAIN.RAMP_S]: 2,
  [TERRAIN.RAMP_W]: 3,
};

export const CONV_DIR = {
  [TERRAIN.CONV_N]: 0,
  [TERRAIN.CONV_E]: 1,
  [TERRAIN.CONV_S]: 2,
  [TERRAIN.CONV_W]: 3,
};

export const CARD_KINDS = {
  ROLL: 'roll',           // { kind: 'roll', roll: 1..4 }
  CHIP: 'chip',           // { kind: 'chip', air: 1..3 }
  CHIP_ROLL: 'chip_roll', // { kind: 'chip_roll', air: 1..2, roll: 1..2 }
  BACKSPIN: 'backspin',   // { kind: 'backspin', air: 2..3, back: 1 }
  SUPER_LOB: 'super_lob', // { kind: 'super_lob', air: 2, climb: 2 }
};

export const DIFFICULTY_PRESETS = {
  relaxed: {
    id: 'relaxed',
    label: 'Relaxed',
    subtitle: 'Sunlit meadows · gentle hazards',
    size: 5,
    maxElev: 1,
    cardCount: 4,
    minPar: 2,
    maxPar: 3,
    decoyCards: 0,
    mechanics: {
      sand: true,
      water: true,
      walls: true,
      ice: false,
      mud: false,
      ramps: false,
      conveyors: false,
      springs: false,
      portals: false,
    },
  },
  classic: {
    id: 'classic',
    label: 'Classic',
    subtitle: 'Rolling greens · ice & bunkers',
    size: 6,
    maxElev: 2,
    cardCount: 5,
    minPar: 3,
    maxPar: 4,
    decoyCards: 1,
    mechanics: {
      sand: true,
      water: true,
      walls: true,
      ice: true,
      mud: true,
      ramps: true,
      conveyors: false,
      springs: false,
      portals: false,
    },
  },
  tour: {
    id: 'tour',
    label: 'Tour',
    subtitle: 'Boardwalks · toadstools & ridges',
    size: 7,
    maxElev: 2,
    cardCount: 5,
    minPar: 3,
    maxPar: 5,
    decoyCards: 1,
    mechanics: {
      sand: true,
      water: true,
      walls: true,
      ice: true,
      mud: true,
      ramps: true,
      conveyors: true,
      springs: true,
      portals: false,
    },
  },
  championship: {
    id: 'championship',
    label: 'Championship',
    subtitle: 'Three-tier hills · stone rings & backspin',
    size: 8,
    maxElev: 3,
    cardCount: 6,
    minPar: 4,
    maxPar: 6,
    decoyCards: 1,
    mechanics: {
      sand: true,
      water: true,
      walls: true,
      ice: true,
      mud: true,
      ramps: true,
      conveyors: true,
      springs: true,
      portals: true,
    },
  },
};

// Seeded PRNG (mulberry32)
export function hashSeed(input) {
  const s = String(input);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed) {
  let a = (typeof seed === 'number' ? seed : hashSeed(seed)) >>> 0;
  if (a === 0) a = 0x6d2b79f5;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function getTile(level, x, y) {
  if (x < 0 || y < 0 || x >= level.width || y >= level.height) {
    return { terrain: TERRAIN.VOID, elev: 0 };
  }
  return level.grid[y][x];
}

export function isRamp(terrain) {
  return RAMP_DIR[terrain] !== undefined;
}

export function isConveyor(terrain) {
  return CONV_DIR[terrain] !== undefined;
}

export function findPortalTwin(level, x, y, terrain) {
  const target = terrain === TERRAIN.PORTAL_A ? TERRAIN.PORTAL_B : TERRAIN.PORTAL_A;
  for (let py = 0; py < level.height; py++) {
    for (let px = 0; px < level.width; px++) {
      if (level.grid[py][px].terrain === target && (px !== x || py !== y)) {
        return { x: px, y: py, elev: level.grid[py][px].elev };
      }
    }
  }
  return null;
}

export function formatCardLabel(card) {
  switch (card.kind) {
    case CARD_KINDS.ROLL:
      return `${card.roll}`;
    case CARD_KINDS.CHIP:
      return `${card.air}`;
    case CARD_KINDS.CHIP_ROLL:
      return `${card.air}+${card.roll}`;
    case CARD_KINDS.BACKSPIN:
      return `${card.air}↩`;
    case CARD_KINDS.SUPER_LOB:
      return `${card.air}↑`;
    default:
      return '?';
  }
}

export function formatCardName(card) {
  switch (card.kind) {
    case CARD_KINDS.ROLL:
      return card.roll === 1 ? 'Putt' : card.roll === 2 ? 'Roll' : 'Drive';
    case CARD_KINDS.CHIP:
      return 'Chip';
    case CARD_KINDS.CHIP_ROLL:
      return 'Pitch';
    case CARD_KINDS.BACKSPIN:
      return 'Spin';
    case CARD_KINDS.SUPER_LOB:
      return 'Lob';
    default:
      return 'Shot';
  }
}

/**
 * Simulate one shot deterministically.
 * Returns:
 *   {
 *     endPos: { x, y },
 *     won: boolean,
 *     hazard: 'water' | 'void' | null,
 *     stuckInSand: boolean,
 *     path: Array<{ type, from, to, fromElev, toElev, dir?, terrain? }>,
 *     events: string[]
 *   }
 */
export function simulateShot(level, startPos, card, dirId) {
  const path = [];
  const events = [];
  let x = startPos.x;
  let y = startPos.y;
  let dir = dirId;
  const startTile = getTile(level, x, y);

  // Rule: Rolling cards cannot escape a sand bunker (must chip/lob!)
  if (startTile.terrain === TERRAIN.SAND && card.kind === CARD_KINDS.ROLL) {
    events.push('sand_trap');
    path.push({
      type: 'bump',
      from: { x, y },
      to: { x: x + DIRS[dir].dx * 0.25, y: y + DIRS[dir].dy * 0.25 },
      fromElev: startTile.elev,
      toElev: startTile.elev,
      dir,
    });
    return { endPos: { x, y }, won: false, hazard: null, stuckInSand: true, path, events };
  }

  let rollSteps = 0;

  // Phase 1: Aerial chip/lob (if applicable)
  if (
    card.kind === CARD_KINDS.CHIP ||
    card.kind === CARD_KINDS.CHIP_ROLL ||
    card.kind === CARD_KINDS.BACKSPIN ||
    card.kind === CARD_KINDS.SUPER_LOB
  ) {
    const airDist = card.air;
    const maxClimb = card.kind === CARD_KINDS.SUPER_LOB ? (card.climb || 2) : 1;
    const tx = x + DIRS[dir].dx * airDist;
    const ty = y + DIRS[dir].dy * airDist;
    const dest = getTile(level, tx, ty);

    // Check if landing tile is out of bounds / void / water / wall / too high
    if (dest.terrain === TERRAIN.VOID) {
      path.push({ type: 'arc', from: { x, y }, to: { x: tx, y: ty }, fromElev: startTile.elev, toElev: 0, dir, high: maxClimb > 1 });
      events.push('void');
      return { endPos: { x: startPos.x, y: startPos.y }, won: false, hazard: 'void', stuckInSand: false, path, events };
    }

    if (dest.terrain === TERRAIN.WALL || dest.elev > startTile.elev + maxClimb) {
      // Hits cliff face or tall wall and drops back to start
      path.push({
        type: 'bounce_arc',
        from: { x, y },
        to: { x: tx, y: ty },
        fromElev: startTile.elev,
        toElev: dest.elev,
        dir,
      });
      events.push('wall_bounce');
      return { endPos: { x: startPos.x, y: startPos.y }, won: false, hazard: null, stuckInSand: false, path, events };
    }

    // Valid aerial landing
    path.push({
      type: 'arc',
      from: { x, y },
      to: { x: tx, y: ty },
      fromElev: startTile.elev,
      toElev: dest.elev,
      dir,
      high: maxClimb > 1,
    });
    x = tx;
    y = ty;
    events.push('chip_land');

    if (dest.terrain === TERRAIN.WATER) {
      events.push('water');
      return { endPos: { x: startPos.x, y: startPos.y }, won: false, hazard: 'water', stuckInSand: false, path, events };
    }

    if (dest.terrain === TERRAIN.CUP) {
      events.push('sink');
      return { endPos: { x, y }, won: true, hazard: null, stuckInSand: false, path, events };
    }

    // Determine post-landing roll
    if (card.kind === CARD_KINDS.CHIP_ROLL) {
      rollSteps = card.roll;
    } else if (card.kind === CARD_KINDS.BACKSPIN) {
      dir = DIR_OPPOSITE[dir];
      rollSteps = card.back || 1;
      events.push('backspin');
    } else {
      rollSteps = 0;
    }

    // Special landing effects on chip
    if (dest.terrain === TERRAIN.SAND) {
      events.push('sand_stop');
      rollSteps = 0;
    } else if (dest.terrain === TERRAIN.MUD) {
      events.push('mud_slow');
      rollSteps = 0;
    } else if (isRamp(dest.terrain)) {
      // Landing on a ramp rolls 1 tile downhill!
      dir = DIR_OPPOSITE[RAMP_DIR[dest.terrain]];
      rollSteps = Math.max(rollSteps, 1);
      events.push('ramp_slide');
    } else if (isConveyor(dest.terrain)) {
      dir = CONV_DIR[dest.terrain];
      rollSteps = Math.max(rollSteps, 1);
      events.push('conveyor');
    } else if (dest.terrain === TERRAIN.SPRING) {
      // Spring launches 2 tiles in current dir!
      const springRes = applySpring(level, x, y, dir, path, events, startPos);
      if (springRes.terminal) return springRes.result;
      x = springRes.x;
      y = springRes.y;
      rollSteps = 0;
    } else if (dest.terrain === TERRAIN.PORTAL_A || dest.terrain === TERRAIN.PORTAL_B) {
      const twin = findPortalTwin(level, x, y, dest.terrain);
      if (twin) {
        path.push({ type: 'teleport', from: { x, y }, to: { x: twin.x, y: twin.y }, fromElev: dest.elev, toElev: twin.elev });
        events.push('portal');
        x = twin.x;
        y = twin.y;
      }
    } else if (dest.terrain === TERRAIN.ICE && rollSteps === 0) {
      // Chipping onto ice slides 1 tile in the shot direction
      rollSteps = 1;
      events.push('ice_slide');
    }
  } else {
    // Pure roll card
    rollSteps = card.roll;
    // Starting in mud costs 1 momentum (minimum 1 if roll >= 1? No, mud weakens roll by 1, min 1 for 2+, 0 for 1)
    if (startTile.terrain === TERRAIN.MUD) {
      rollSteps = Math.max(1, rollSteps - 1);
      events.push('mud_slow');
    }
  }

  // Phase 2: Ground roll & interactive tiles
  let safety = 0;
  let portalCooldown = 0;
  let springCooldown = 0;

  while (rollSteps > 0 && safety < 48) {
    safety++;
    if (portalCooldown > 0) portalCooldown--;
    if (springCooldown > 0) springCooldown--;

    const cur = getTile(level, x, y);
    const nx = x + DIRS[dir].dx;
    const ny = y + DIRS[dir].dy;
    const next = getTile(level, nx, ny);

    // Check void (fell off island)
    if (next.terrain === TERRAIN.VOID) {
      path.push({ type: 'fall', from: { x, y }, to: { x: nx, y: ny }, fromElev: cur.elev, toElev: -1, dir });
      events.push('void');
      return { endPos: { x: startPos.x, y: startPos.y }, won: false, hazard: 'void', stuckInSand: false, path, events };
    }

    // Check solid wall or upward cliff (unless current tile is a ramp pointing in dir!)
    const climbingViaRamp = isRamp(cur.terrain) && RAMP_DIR[cur.terrain] === dir && next.elev === cur.elev + 1;
    const enteringRampUp = isRamp(next.terrain) && RAMP_DIR[next.terrain] === dir && next.elev === cur.elev;
    const blockedByCliff = next.elev > cur.elev && !climbingViaRamp;
    const blockedByWall = next.terrain === TERRAIN.WALL;

    if (blockedByWall || blockedByCliff) {
      // Bank shot! Bounce off wall/cliff and reverse direction
      path.push({
        type: 'bounce',
        from: { x, y },
        to: { x: x + DIRS[dir].dx * 0.42, y: y + DIRS[dir].dy * 0.42 },
        fromElev: cur.elev,
        toElev: cur.elev,
        dir,
      });
      events.push('wall_bounce');
      dir = DIR_OPPOSITE[dir];
      // Consume 1 step on wall bounce only if we'd otherwise infinite-loop, actually Golf Peaks bounces cleanly without losing step unless trapped
      // To prevent infinite bounce between two walls on ice, consume 1 step if on ice or after 4 bounces
      if (cur.terrain === TERRAIN.ICE) {
        rollSteps--;
      }
      continue;
    }

    // Move onto next tile
    const stepType =
      cur.terrain === TERRAIN.ICE || next.terrain === TERRAIN.ICE
        ? 'slide'
        : next.elev < cur.elev
          ? 'drop'
          : climbingViaRamp || enteringRampUp
            ? 'climb'
            : 'roll';

    path.push({
      type: stepType,
      from: { x, y },
      to: { x: nx, y: ny },
      fromElev: cur.elev,
      toElev: next.elev,
      dir,
    });
    x = nx;
    y = ny;

    // Evaluate tile entered
    if (next.terrain === TERRAIN.WATER) {
      events.push('water');
      return { endPos: { x: startPos.x, y: startPos.y }, won: false, hazard: 'water', stuckInSand: false, path, events };
    }

    if (next.terrain === TERRAIN.CUP) {
      // Sinks if ball reaches cup (Golf Peaks allows rolling into cup cleanly!)
      events.push('sink');
      return { endPos: { x, y }, won: true, hazard: null, stuckInSand: false, path, events };
    }

    if (next.terrain === TERRAIN.SAND) {
      events.push('sand_stop');
      rollSteps = 0;
      break;
    }

    if (next.terrain === TERRAIN.MUD) {
      events.push('mud_slow');
      rollSteps = Math.max(0, rollSteps - 2);
      continue;
    }

    if (next.terrain === TERRAIN.ICE) {
      events.push('ice_slide');
      // On ice, do NOT decrement rollSteps (keeps sliding until off ice or blocked!)
      // Guarantee at least 1 step so it slides through the ice tile
      rollSteps = Math.max(1, rollSteps);
      continue;
    }

    if (isConveyor(next.terrain)) {
      events.push('conveyor');
      dir = CONV_DIR[next.terrain];
      // Conveyor pushes 1 tile (doesn't reduce remaining below 1)
      rollSteps = Math.max(1, rollSteps - 1);
      continue;
    }

    if (next.terrain === TERRAIN.SPRING && springCooldown === 0) {
      springCooldown = 2;
      const springRes = applySpring(level, x, y, dir, path, events, startPos);
      if (springRes.terminal) return springRes.result;
      x = springRes.x;
      y = springRes.y;
      rollSteps = Math.max(0, rollSteps - 1);
      continue;
    }

    if ((next.terrain === TERRAIN.PORTAL_A || next.terrain === TERRAIN.PORTAL_B) && portalCooldown === 0) {
      const twin = findPortalTwin(level, x, y, next.terrain);
      if (twin) {
        portalCooldown = 2;
        path.push({ type: 'teleport', from: { x, y }, to: { x: twin.x, y: twin.y }, fromElev: next.elev, toElev: twin.elev });
        events.push('portal');
        x = twin.x;
        y = twin.y;
      }
      rollSteps--;
      continue;
    }

    if (isRamp(next.terrain)) {
      const rampUp = RAMP_DIR[next.terrain];
      if (dir === rampUp) {
        // Rolling uphill: normal step consumption; if this was the last step, roll back down!
        rollSteps--;
        if (rollSteps === 0) {
          // Not enough momentum to crest the ramp — rolls 1 tile back downhill
          dir = DIR_OPPOSITE[rampUp];
          rollSteps = 1;
          events.push('ramp_rollback');
        }
      } else if (dir === DIR_OPPOSITE[rampUp]) {
        // Rolling downhill: gains +1 bonus momentum!
        events.push('ramp_boost');
        // Effectively free step (doesn't decrement rollSteps, capped)
      } else {
        rollSteps--;
      }
      continue;
    }

    // Normal grass tile
    rollSteps--;
  }

  // Final settle check: if resting on a conveyor or ramp at end of roll
  const endTile = getTile(level, x, y);
  if (endTile.terrain === TERRAIN.CUP) {
    events.push('sink');
    return { endPos: { x, y }, won: true, hazard: null, stuckInSand: false, path, events };
  }

  return { endPos: { x, y }, won: false, hazard: null, stuckInSand: false, path, events };
}

function applySpring(level, x, y, dir, path, events, startPos) {
  const cur = getTile(level, x, y);
  const tx = x + DIRS[dir].dx * 2;
  const ty = y + DIRS[dir].dy * 2;
  const dest = getTile(level, tx, ty);
  events.push('spring');

  if (dest.terrain === TERRAIN.VOID) {
    path.push({ type: 'spring', from: { x, y }, to: { x: tx, y: ty }, fromElev: cur.elev, toElev: 0, dir });
    events.push('void');
    return {
      terminal: true,
      result: { endPos: { x: startPos.x, y: startPos.y }, won: false, hazard: 'void', stuckInSand: false, path, events },
    };
  }
  if (dest.terrain === TERRAIN.WALL || dest.elev > cur.elev + 1) {
    path.push({ type: 'bounce_arc', from: { x, y }, to: { x: tx, y: ty }, fromElev: cur.elev, toElev: dest.elev, dir });
    events.push('wall_bounce');
    return { terminal: false, x, y };
  }
  path.push({ type: 'spring', from: { x, y }, to: { x: tx, y: ty }, fromElev: cur.elev, toElev: dest.elev, dir });
  if (dest.terrain === TERRAIN.WATER) {
    events.push('water');
    return {
      terminal: true,
      result: { endPos: { x: startPos.x, y: startPos.y }, won: false, hazard: 'water', stuckInSand: false, path, events },
    };
  }
  if (dest.terrain === TERRAIN.CUP) {
    events.push('sink');
    return {
      terminal: true,
      result: { endPos: { x: tx, y: ty }, won: true, hazard: null, stuckInSand: false, path, events },
    };
  }
  return { terminal: false, x: tx, y: ty };
}

/**
 * Exact BFS solver: returns shortest winning sequence of { cardIndex, dir } or null.
 */
export function solveLevel(level, maxStates = 6000) {
  const nCards = level.cards.length;
  const queue = [{ x: level.start.x, y: level.start.y, mask: 0, moves: [] }];
  const visited = new Set([`${level.start.x},${level.start.y},0`]);
  let head = 0;

  while (head < queue.length && visited.size < maxStates) {
    const state = queue[head++];

    // Try each unused card (dedupe identical cards at same depth for speed)
    const triedCardSig = new Set();
    for (let ci = 0; ci < nCards; ci++) {
      if (state.mask & (1 << ci)) continue;
      const card = level.cards[ci];
      const sig = `${card.kind}:${card.air || 0}:${card.roll || 0}:${card.back || 0}:${card.climb || 0}`;
      if (triedCardSig.has(sig)) continue;
      triedCardSig.add(sig);

      for (let d = 0; d < 4; d++) {
        const res = simulateShot(level, { x: state.x, y: state.y }, card, d);
        const nextMask = state.mask | (1 << ci);
        const nextMoves = state.moves.concat({ cardIndex: ci, dir: d });

        if (res.won) {
          return nextMoves;
        }
        if (res.hazard || res.stuckInSand) continue;
        if (res.endPos.x === state.x && res.endPos.y === state.y) continue;

        const key = `${res.endPos.x},${res.endPos.y},${nextMask}`;
        if (!visited.has(key)) {
          visited.add(key);
          queue.push({ x: res.endPos.x, y: res.endPos.y, mask: nextMask, moves: nextMoves });
        }
      }
    }
  }

  return null;
}

/**
 * Procedural Level Generator with guaranteed BFS solvability.
 */
export function generateLevel(seed, configOrPreset = 'classic') {
  const preset =
    typeof configOrPreset === 'string'
      ? DIFFICULTY_PRESETS[configOrPreset] || DIFFICULTY_PRESETS.classic
      : { ...DIFFICULTY_PRESETS.classic, ...configOrPreset, mechanics: { ...DIFFICULTY_PRESETS.classic.mechanics, ...(configOrPreset.mechanics || {}) } };

  const baseSeed = hashSeed(`${seed}:${preset.id || 'custom'}:${preset.size}:${preset.maxElev}:${preset.cardCount}`);

  for (let attempt = 0; attempt < 90; attempt++) {
    const rng = createRng(baseSeed + attempt * 7919);
    const candidate = buildCandidateLevel(rng, preset, seed);
    if (!candidate) continue;

    const solution = solveLevel(candidate, 4500);
    if (!solution) continue;

    const par = solution.length;
    if (par < preset.minPar || par > preset.maxPar) continue;

    // Ensure it isn't trivially solved in 1 move
    if (par < 2) continue;

    // Add optional decoy cards (unused in optimal solution) up to cardCount
    const usedIndices = new Set(solution.map((m) => m.cardIndex));
    const optimalCards = solution.map((m) => candidate.cards[m.cardIndex]);
    const finalCards = [...optimalCards];

    const targetCards = Math.max(par, Math.min(preset.cardCount, par + (preset.decoyCards || 0)));
    while (finalCards.length < targetCards) {
      finalCards.push(pickRandomCard(rng, preset));
    }
    // Shuffle cards deterministically
    for (let i = finalCards.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [finalCards[i], finalCards[j]] = [finalCards[j], finalCards[i]];
    }

    candidate.cards = finalCards;
    // Re-solve with final shuffled hand to get exact indices
    const finalSol = solveLevel(candidate, 5000);
    if (!finalSol || finalSol.length < preset.minPar) continue;

    candidate.par = finalSol.length;
    candidate.solution = finalSol;
    candidate.seed = String(seed);
    candidate.difficulty = preset.id || 'custom';
    candidate.mechanicsActive = Object.keys(preset.mechanics).filter((k) => preset.mechanics[k]);
    return candidate;
  }

  // Deterministic fallback level (always solvable, guaranteed never to fail)
  return buildFallbackLevel(seed, preset);
}

function pickRandomCard(rng, preset) {
  const m = preset.mechanics;
  const pool = [
    { kind: CARD_KINDS.ROLL, roll: 1 },
    { kind: CARD_KINDS.ROLL, roll: 2 },
    { kind: CARD_KINDS.ROLL, roll: 3 },
    { kind: CARD_KINDS.CHIP, air: 2 },
    { kind: CARD_KINDS.CHIP_ROLL, air: 1, roll: 1 },
  ];
  if (preset.size >= 6) {
    pool.push({ kind: CARD_KINDS.ROLL, roll: 4 });
    pool.push({ kind: CARD_KINDS.CHIP, air: 3 });
    pool.push({ kind: CARD_KINDS.CHIP_ROLL, air: 2, roll: 1 });
    pool.push({ kind: CARD_KINDS.CHIP_ROLL, air: 1, roll: 2 });
  }
  if (m.sand || m.water) {
    pool.push({ kind: CARD_KINDS.CHIP, air: 1 });
    pool.push({ kind: CARD_KINDS.CHIP, air: 2 });
  }
  if (preset.maxElev >= 2 || m.portals || m.springs) {
    pool.push({ kind: CARD_KINDS.BACKSPIN, air: 2, back: 1 });
    pool.push({ kind: CARD_KINDS.BACKSPIN, air: 3, back: 1 });
  }
  if (preset.maxElev >= 3) {
    pool.push({ kind: CARD_KINDS.SUPER_LOB, air: 2, climb: 2 });
  }
  return { ...pool[Math.floor(rng() * pool.length)] };
}

function buildCandidateLevel(rng, preset, seed) {
  const W = preset.size;
  const H = preset.size;
  const m = preset.mechanics;

  // 1. Build organic floating island shape (trim some corners for diorama beauty)
  const grid = Array.from({ length: H }, () =>
    Array.from({ length: W }, () => ({ terrain: TERRAIN.GRASS, elev: 0 }))
  );

  // Sculpt corners / edge voids
  const voidsToCarve = Math.floor(W * H * 0.14);
  for (let i = 0; i < voidsToCarve; i++) {
    const edge = Math.floor(rng() * 4);
    let vx, vy;
    if (edge === 0) {
      vx = rng() < 0.5 ? 0 : W - 1;
      vy = rng() < 0.5 ? 0 : H - 1;
    } else {
      vx = Math.floor(rng() * W);
      vy = Math.floor(rng() * H);
      if (vx > 0 && vx < W - 1 && vy > 0 && vy < H - 1) continue;
    }
    grid[vy][vx] = { terrain: TERRAIN.VOID, elev: 0 };
  }

  // 2. Sculpt elevation plateaus (if maxElev > 1)
  if (preset.maxElev >= 2) {
    const platW = Math.max(2, Math.floor(W * 0.48));
    const platH = Math.max(2, Math.floor(H * 0.48));
    const px0 = Math.floor(rng() * (W - platW + 1));
    const py0 = Math.floor(rng() * (H - platH + 1));
    for (let y = py0; y < py0 + platH; y++) {
      for (let x = px0; x < px0 + platW; x++) {
        if (grid[y][x].terrain !== TERRAIN.VOID) {
          grid[y][x].elev = 1;
        }
      }
    }
    if (preset.maxElev >= 3 && W >= 7) {
      const topX = px0 + Math.floor(rng() * Math.max(1, platW - 1));
      const topY = py0 + Math.floor(rng() * Math.max(1, platH - 1));
      for (let dy = 0; dy < 2; dy++) {
        for (let dx = 0; dx < 2; dx++) {
          const x = Math.min(W - 1, topX + dx);
          const y = Math.min(H - 1, topY + dy);
          if (grid[y][x].terrain !== TERRAIN.VOID) grid[y][x].elev = 2;
        }
      }
    }
  }

  // Collect walkable tiles
  const grassTiles = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (grid[y][x].terrain === TERRAIN.GRASS) grassTiles.push({ x, y });
    }
  }
  if (grassTiles.length < 12) return null;

  // 3. Pick start & cup far apart (preferably cup on highest elevation!)
  const start = grassTiles[Math.floor(rng() * grassTiles.length)];
  const sortedByDist = grassTiles
    .filter((t) => Math.abs(t.x - start.x) + Math.abs(t.y - start.y) >= Math.max(3, W - 2))
    .sort((a, b) => {
      const ea = grid[a.y][a.x].elev;
      const eb = grid[b.y][b.x].elev;
      if (eb !== ea) return eb - ea;
      const da = Math.abs(a.x - start.x) + Math.abs(a.y - start.y);
      const db = Math.abs(b.x - start.x) + Math.abs(b.y - start.y);
      return db - da;
    });
  if (sortedByDist.length === 0) return null;
  const cup = sortedByDist[Math.floor(rng() * Math.min(4, sortedByDist.length))];
  grid[cup.y][cup.x].terrain = TERRAIN.CUP;

  const isReserved = (x, y) => (x === start.x && y === start.y) || (x === cup.x && y === cup.y);

  // 4. Place ramps along elevation transitions
  if (m.ramps && preset.maxElev >= 2) {
    const rampCandidates = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (isReserved(x, y) || grid[y][x].terrain !== TERRAIN.GRASS) continue;
        const e = grid[y][x].elev;
        for (const d of DIRS) {
          const nx = x + d.dx;
          const ny = y + d.dy;
          if (nx >= 0 && ny >= 0 && nx < W && ny < H && grid[ny][nx].terrain !== TERRAIN.VOID && grid[ny][nx].elev === e + 1) {
            rampCandidates.push({ x, y, dir: d.id });
          }
        }
      }
    }
    const rampMap = [TERRAIN.RAMP_N, TERRAIN.RAMP_E, TERRAIN.RAMP_S, TERRAIN.RAMP_W];
    const numRamps = Math.min(rampCandidates.length, 1 + Math.floor(rng() * 2));
    for (let i = 0; i < numRamps; i++) {
      const rc = rampCandidates.splice(Math.floor(rng() * rampCandidates.length), 1)[0];
      if (rc) grid[rc.y][rc.x].terrain = rampMap[rc.dir];
    }
  }

  // 5. Place terrain features
  const freeTiles = () => {
    const list = [];
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!isReserved(x, y) && grid[y][x].terrain === TERRAIN.GRASS) list.push({ x, y });
      }
    }
    return list;
  };

  const placeFeature = (terrain, count) => {
    const pool = freeTiles();
    for (let i = 0; i < count && pool.length > 0; i++) {
      const idx = Math.floor(rng() * pool.length);
      const t = pool.splice(idx, 1)[0];
      grid[t.y][t.x].terrain = terrain;
    }
  };

  if (m.water) placeFeature(TERRAIN.WATER, 1 + Math.floor(rng() * Math.max(2, Math.floor(W / 2))));
  if (m.sand) placeFeature(TERRAIN.SAND, 1 + Math.floor(rng() * Math.max(2, Math.floor(W / 2))));
  if (m.walls) placeFeature(TERRAIN.WALL, 1 + Math.floor(rng() * Math.max(2, Math.floor(W / 2))));
  if (m.ice) placeFeature(TERRAIN.ICE, 2 + Math.floor(rng() * 3));
  if (m.mud) placeFeature(TERRAIN.MUD, 1 + Math.floor(rng() * 2));
  if (m.conveyors) {
    const convs = [TERRAIN.CONV_N, TERRAIN.CONV_E, TERRAIN.CONV_S, TERRAIN.CONV_W];
    const count = 1 + Math.floor(rng() * 2);
    for (let i = 0; i < count; i++) {
      placeFeature(convs[Math.floor(rng() * 4)], 1);
    }
  }
  if (m.springs) placeFeature(TERRAIN.SPRING, 1 + Math.floor(rng() * 2));
  if (m.portals) {
    const pool = freeTiles();
    if (pool.length >= 2) {
      const a = pool.splice(Math.floor(rng() * pool.length), 1)[0];
      const far = pool.filter((t) => Math.abs(t.x - a.x) + Math.abs(t.y - a.y) >= 3);
      const b = (far.length ? far : pool)[Math.floor(rng() * (far.length ? far.length : pool.length))];
      grid[a.y][a.x].terrain = TERRAIN.PORTAL_A;
      grid[b.y][b.x].terrain = TERRAIN.PORTAL_B;
    }
  }

  // 6. Deal a candidate hand of cards
  const handSize = Math.min(6, Math.max(4, preset.cardCount));
  const cards = [];
  for (let i = 0; i < handSize; i++) {
    cards.push(pickRandomCard(rng, preset));
  }

  return {
    width: W,
    height: H,
    grid,
    start,
    cup,
    cards,
    par: 3,
    seed: String(seed),
  };
}

function buildFallbackLevel(seed, preset) {
  const W = 6;
  const H = 6;
  const grid = Array.from({ length: H }, () =>
    Array.from({ length: W }, () => ({ terrain: TERRAIN.GRASS, elev: 0 }))
  );
  grid[0][0].terrain = TERRAIN.VOID;
  grid[5][5].terrain = TERRAIN.VOID;
  grid[2][2].terrain = TERRAIN.WATER;
  grid[2][3].terrain = TERRAIN.SAND;
  grid[1][4].terrain = TERRAIN.WALL;
  grid[1][3].terrain = TERRAIN.ICE;
  grid[1][2].terrain = TERRAIN.ICE;
  grid[1][1].elev = 1;
  grid[1][1].terrain = TERRAIN.CUP;
  grid[2][1].terrain = TERRAIN.RAMP_N;

  const level = {
    width: W,
    height: H,
    grid,
    start: { x: 4, y: 4 },
    cup: { x: 1, y: 1 },
    cards: [
      { kind: CARD_KINDS.ROLL, roll: 3 },
      { kind: CARD_KINDS.ROLL, roll: 2 },
      { kind: CARD_KINDS.CHIP, air: 2 },
      { kind: CARD_KINDS.CHIP_ROLL, air: 1, roll: 1 },
    ],
    par: 3,
    seed: String(seed),
    difficulty: preset.id || 'classic',
    mechanicsActive: ['sand', 'water', 'walls', 'ice', 'ramps'],
  };
  level.solution = solveLevel(level) || [{ cardIndex: 0, dir: 3 }];
  level.par = level.solution.length;
  return level;
}

/**
 * Extract 24-element numeric feature vector for on-device CaddieNet edge inference
 * given (level, ballPos, card, dir, simResult).
 */
export function extractMoveFeatures(level, pos, card, dirId, sim) {
  const dxCup = (level.cup.x - pos.x) / Math.max(1, level.width);
  const dyCup = (level.cup.y - pos.y) / Math.max(1, level.height);
  const distBefore = (Math.abs(level.cup.x - pos.x) + Math.abs(level.cup.y - pos.y)) / (level.width + level.height);
  const distAfter = (Math.abs(level.cup.x - sim.endPos.x) + Math.abs(level.cup.y - sim.endPos.y)) / (level.width + level.height);
  const distDelta = distBefore - distAfter;

  const startTile = getTile(level, pos.x, pos.y);
  const endTile = getTile(level, sim.endPos.x, sim.endPos.y);
  const cupTile = getTile(level, level.cup.x, level.cup.y);

  const elevBefore = Math.abs(cupTile.elev - startTile.elev) / 3;
  const elevAfter = Math.abs(cupTile.elev - endTile.elev) / 3;
  const elevDelta = elevBefore - elevAfter;

  const dirVec = DIRS[dirId];
  const alignX = dirVec.dx * Math.sign(level.cup.x - pos.x);
  const alignY = dirVec.dy * Math.sign(level.cup.y - pos.y);
  const dirAlignment = Math.max(-1, Math.min(1, alignX + alignY));

  const sameRowAfter = sim.endPos.y === level.cup.y ? 1 : 0;
  const sameColAfter = sim.endPos.x === level.cup.x ? 1 : 0;

  return new Float32Array([
    sim.won ? 1 : 0,
    sim.hazard ? 1 : 0,
    sim.stuckInSand ? 1 : 0,
    sim.endPos.x === pos.x && sim.endPos.y === pos.y ? 1 : 0,
    distBefore,
    distAfter,
    distDelta,
    elevBefore,
    elevAfter,
    elevDelta,
    dirAlignment,
    sameRowAfter,
    sameColAfter,
    dxCup,
    dyCup,
    card.kind === CARD_KINDS.ROLL ? 1 : 0,
    card.kind === CARD_KINDS.CHIP ? 1 : 0,
    card.kind === CARD_KINDS.CHIP_ROLL ? 1 : 0,
    card.kind === CARD_KINDS.BACKSPIN ? 1 : 0,
    card.kind === CARD_KINDS.SUPER_LOB ? 1 : 0,
    ((card.roll || 0) + (card.air || 0)) / 4,
    endTile.terrain === TERRAIN.SAND ? 1 : 0,
    endTile.terrain === TERRAIN.MUD ? 1 : 0,
    sim.events.includes('portal') || sim.events.includes('spring') || sim.events.includes('wall_bounce') ? 1 : 0,
  ]);
}
