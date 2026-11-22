// Life of Golf — Main App Controller

import {
  CARD_KINDS,
  DIFFICULTY_PRESETS,
  DIRS,
  generateLevel,
  simulateShot,
  solveLevel,
  formatCardLabel,
  formatCardName,
} from './engine.js';
import { GolfRenderer3D } from './renderer3d.js';
import { CaddieNet } from './caddie.js';
import { sound } from './audio.js';
import { icon, hydrateIcons } from './icons.js';

const $ = (id) => document.getElementById(id);

const state = {
  holeNumber: 1,
  dailyMode: false,
  difficultyId: 'classic',
  customConfig: null,
  level: null,
  ballPos: { x: 0, y: 0 },
  usedMask: 0,
  history: [], // { pos, usedMask, cardIndex, dir }
  selectedCard: null,
  animating: false,
  won: false,
  streak: 0,
  totalSolved: 0,
  theme: 'dark',
  caddieEval: null,
  hintMove: null,
};

const caddie = new CaddieNet();
let renderer = null;
let toastTimer = null;

function loadPrefs() {
  try {
    state.streak = parseInt(localStorage.getItem('life-of-golf:streak') || '0', 10) || 0;
    state.totalSolved = parseInt(localStorage.getItem('life-of-golf:solved') || '0', 10) || 0;
    state.holeNumber = parseInt(localStorage.getItem('life-of-golf:hole') || '1', 10) || 1;
    state.difficultyId = localStorage.getItem('life-of-golf:diff') || 'classic';
    const savedTheme = localStorage.getItem('life-of-golf:theme');
    // 'dark' = Midnight Links (the default), 'light' = Sunset Drive.
    if (savedTheme === 'dark' || savedTheme === 'light') {
      state.theme = savedTheme;
    }
  } catch {}
}

function savePrefs() {
  try {
    localStorage.setItem('life-of-golf:streak', String(state.streak));
    localStorage.setItem('life-of-golf:solved', String(state.totalSolved));
    localStorage.setItem('life-of-golf:hole', String(state.holeNumber));
    localStorage.setItem('life-of-golf:diff', state.difficultyId);
    localStorage.setItem('life-of-golf:theme', state.theme);
  } catch {}
}

function showToast(msg, ms = 2200, tone = '') {
  const el = $('stage-toast');
  el.textContent = msg;
  el.className = `stage-toast show${tone ? ` ${tone}` : ''}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function cardSvg(card) {
  if (card.kind === CARD_KINDS.ROLL) {
    return `<svg class="card-svg" viewBox="0 0 48 40" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <line x1="6" y1="28" x2="36" y2="28" stroke-dasharray="3 4"/>
      <polyline points="30,22 38,28 30,34"/>
      <circle cx="9" cy="28" r="3.5" fill="currentColor" stroke="none"/>
    </svg>`;
  }
  if (card.kind === CARD_KINDS.CHIP) {
    return `<svg class="card-svg" viewBox="0 0 48 40" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
      <path d="M7 30 Q24 4 40 28" stroke-dasharray="3 4"/>
      <polyline points="35,23 41,29 33,30"/>
      <circle cx="7" cy="30" r="3.5" fill="currentColor" stroke="none"/>
    </svg>`;
  }
  if (card.kind === CARD_KINDS.CHIP_ROLL) {
    return `<svg class="card-svg" viewBox="0 0 48 40" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M5 30 Q16 7 26 28" stroke-dasharray="3 3"/>
      <line x1="26" y1="28" x2="41" y2="28"/>
      <polyline points="36,23 42,28 36,33"/>
      <circle cx="5" cy="30" r="3" fill="currentColor" stroke="none"/>
    </svg>`;
  }
  if (card.kind === CARD_KINDS.BACKSPIN) {
    return `<svg class="card-svg" viewBox="0 0 48 40" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M7 30 Q24 6 38 26" stroke-dasharray="3 3"/>
      <path d="M38 26 Q32 34 24 31"/>
      <polyline points="28,27 23,31 28,35"/>
      <circle cx="7" cy="30" r="3" fill="currentColor" stroke="none"/>
    </svg>`;
  }
  // SUPER_LOB
  return `<svg class="card-svg" viewBox="0 0 48 40" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round">
    <path d="M7 34 Q22 -2 40 16" stroke-dasharray="3 3"/>
    <polyline points="34,12 41,16 37,22"/>
    <circle cx="7" cy="34" r="3.5" fill="currentColor" stroke="none"/>
  </svg>`;
}

function buzz(pattern) {
  if (sound.muted) return;
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {}
}

function cardLabelHtml(card) {
  // U+FE0E keeps the arrows as text glyphs instead of emoji on phones.
  return formatCardLabel(card).replace(/([↩↑])/, '<small>$1\uFE0E</small>');
}

function setText(id, text, bump = false) {
  const el = $(id);
  if (el.textContent === text) return;
  el.textContent = text;
  if (bump) {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function activeConfig() {
  if (state.difficultyId === 'custom' && state.customConfig) {
    return state.customConfig;
  }
  return DIFFICULTY_PRESETS[state.difficultyId] || DIFFICULTY_PRESETS.classic;
}

function startHole(seedOverride = null) {
  state.animating = false;
  state.won = false;
  state.usedMask = 0;
  state.history = [];
  state.selectedCard = null;
  state.hintMove = null;
  $('modal-win').classList.add('hidden');

  const cfg = activeConfig();
  const seed = seedOverride || (state.dailyMode ? `daily-${todayISO()}` : `hole-${state.holeNumber}-${cfg.id || 'custom'}`);
  state.level = generateLevel(seed, cfg);
  state.ballPos = { ...state.level.start };

  renderer.loadLevel(state.level, state.ballPos);
  evaluateCaddie();
  renderHUD();
  renderHand();

  // Auto-select first card for zero-friction play on mobile & desktop!
  if (state.level.cards.length > 0) {
    selectCard(0, true);
  }
}

function renderHUD() {
  const lvl = state.level;
  if (!lvl) return;
  if (state.dailyMode) {
    const seedDate = /^daily-\d{4}-(\d{2})-(\d{2})$/.exec(String(lvl.seed));
    const d = seedDate ? `${seedDate[1]}·${seedDate[2]}` : todayISO().slice(5).replace('-', '·');
    $('hud-hole-k').textContent = 'Daily';
    setText('hud-hole', d);
  } else {
    $('hud-hole-k').textContent = 'Hole';
    setText('hud-hole', String(state.holeNumber).padStart(2, '0'));
  }
  $('hud-hole').classList.toggle('date', state.dailyMode);
  setText('hud-par', String(lvl.par));
  const strokes = state.history.length;
  setText('hud-strokes', String(strokes), true);
  $('hud-strokes').classList.toggle('over', strokes > lvl.par);
  setText('hud-streak', String(state.streak), true);
  $('hud-streak').classList.toggle('zero', state.streak === 0);
  $('lbl-diff').textContent = state.difficultyId === 'custom' ? 'Custom' : (DIFFICULTY_PRESETS[state.difficultyId]?.label || 'Classic');
  $('btn-undo').disabled = state.history.length === 0 || state.animating;
}

function renderHand() {
  const container = $('card-hand');
  const lvl = state.level;
  if (!lvl) {
    container.innerHTML = '';
    return;
  }

  // Build the hand once per hole (with a deal-in), then patch classes so CSS transitions can run.
  const handKey = `${lvl.seed}|${lvl.cards.length}`;
  if (container.dataset.handKey !== handKey) {
    container.dataset.handKey = handKey;
    container.innerHTML = '';
    container.style.setProperty('--n', String(lvl.cards.length));
    lvl.cards.forEach((card, idx) => {
      const btn = document.createElement('button');
      btn.className = `golf-card kind-${card.kind} deal`;
      btn.style.setProperty('--i', String(idx));
      btn.setAttribute('role', 'option');
      btn.dataset.cardIndex = String(idx);
      btn.setAttribute('aria-label', `${formatCardName(card)} ${formatCardLabel(card)}`);
      btn.innerHTML = `
        <span class="card-kind">${formatCardName(card)}</span>
        ${cardSvg(card)}
        <span class="card-val">${cardLabelHtml(card)}</span>
      `;
      btn.addEventListener('click', () => {
        if (state.animating || state.won || (state.usedMask & (1 << idx))) return;
        selectCard(idx);
      });
      btn.addEventListener('animationend', () => btn.classList.remove('deal'), { once: true });
      container.appendChild(btn);
    });
  }

  const aiTopCard = state.caddieEval?.best?.cardIndex ?? -1;
  const caddieOpen = !$('drawer-caddie').classList.contains('hidden');

  lvl.cards.forEach((card, idx) => {
    const btn = container.children[idx];
    const used = Boolean(state.usedMask & (1 << idx));
    const selected = state.selectedCard === idx && !used;
    const isAiPick = Boolean(!used && state.hintMove && state.hintMove.cardIndex === idx);

    btn.classList.toggle('selected', selected);
    btn.classList.toggle('used', used);
    btn.classList.toggle('ai-pick', isAiPick);
    btn.disabled = used || state.animating || state.won;
    btn.setAttribute('aria-selected', String(selected));

    const badgeText = isAiPick ? state.hintMove.source : (!used && idx === aiTopCard && caddieOpen) ? 'AI' : '';
    let badge = btn.querySelector('.card-badge-ai');
    if (badgeText) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'card-badge-ai';
        btn.appendChild(badge);
      }
      badge.textContent = badgeText;
    } else if (badge) {
      badge.remove();
    }
  });

  // Show the diagonal pad when a card is selected
  $('mobile-dir-pad').classList.toggle('hidden', state.selectedCard === null || state.won);
}

function selectCard(idx, silent = false) {
  if (state.usedMask & (1 << idx)) return;
  state.selectedCard = idx;
  if (!silent) sound.cardSelect();
  const card = state.level.cards[idx];
  const recDir = state.hintMove && state.hintMove.cardIndex === idx ? state.hintMove.dir : null;
  renderer.showDirections(card, recDir);
  renderHand();
  if (!silent) {
    showToast(`${formatCardName(card)} ${formatCardLabel(card)} · swipe or tap an arrow`, 1800);
  }
}

async function playDirection(dirId) {
  if (state.animating || state.won || state.selectedCard === null) return;
  const ci = state.selectedCard;
  if (state.usedMask & (1 << ci)) return;

  const card = state.level.cards[ci];
  const sim = simulateShot(state.level, state.ballPos, card, dirId);

  // Push undo snapshot
  state.history.push({
    pos: { ...state.ballPos },
    usedMask: state.usedMask,
    cardIndex: ci,
    dir: dirId,
  });

  state.animating = true;
  state.usedMask |= 1 << ci;
  state.selectedCard = null;
  state.hintMove = null;
  renderHUD();
  renderHand();

  if (card.kind === CARD_KINDS.ROLL) sound.putt();
  else sound.chip();
  buzz(12);

  await renderer.animateShot(sim, (ev) => {
    if (ev === 'bounce' || ev === 'water' || ev === 'sink') buzz(ev === 'bounce' ? 18 : [30, 40, 60]);
    if (ev === 'bounce') sound.bounce();
    else if (ev === 'sand') sound.sand();
    else if (ev === 'water') sound.water();
    else if (ev === 'ice') sound.ice();
    else if (ev === 'spring') sound.spring();
    else if (ev === 'portal') sound.portal();
    else if (ev === 'sink') sound.sink();
  });

  state.ballPos = { ...sim.endPos };
  state.animating = false;

  if (sim.hazard === 'water') {
    showToast('Water hazard · ball returned', 2400, 'warn');
  } else if (sim.hazard === 'void') {
    showToast('Off the edge · ball returned', 2400, 'warn');
  } else if (sim.stuckInSand) {
    showToast('Bunkered · only a chip or lob gets out', 2600, 'warn');
  }

  if (sim.won) {
    handleWin();
    return;
  }

  evaluateCaddie();
  renderHUD();

  // Auto-select next available card
  const nextCard = state.level.cards.findIndex((_, i) => !(state.usedMask & (1 << i)));
  if (nextCard !== -1) {
    selectCard(nextCard, true);
  } else {
    renderHand();
    showToast('Out of cards · undo or reset to try another line', 3200, 'warn');
  }
}

function handleWin() {
  state.won = true;
  state.streak += 1;
  state.totalSolved += 1;
  savePrefs();
  renderHUD();
  renderHand();

  const strokes = state.history.length;
  const par = state.level.par;
  const diff = strokes - par;
  let title = 'Par';
  let result = 'par';
  if (strokes === 1) {
    title = 'Hole in One';
    result = 'ace';
  } else if (diff <= -2) {
    title = 'Eagle';
    result = 'eagle';
  } else if (diff === -1) {
    title = 'Birdie';
    result = 'birdie';
  } else if (diff > 0) {
    title = 'Sunk';
    result = 'over';
  }

  document.querySelector('#modal-win .modal-card').dataset.result = result;
  $('win-emoji').innerHTML = `<span>${strokes === 1 ? 'ACE' : diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `−${-diff}`}</span>`;
  $('win-title').textContent = title;
  $('win-detail').textContent = `${strokes} ${strokes === 1 ? 'stroke' : 'strokes'} · optimal par ${par}`;
  const badges = $('win-badges');
  badges.innerHTML = '';
  [
    [`Streak ${state.streak}`, 'pill pill-accent'],
    [`${state.level.width}×${state.level.height}`, 'pill'],
    [`Seed ${state.level.seed}`, 'pill'],
  ].forEach(([text, cls]) => {
    const el = document.createElement('span');
    el.className = cls;
    el.textContent = text;
    badges.appendChild(el);
  });
  // Let the ball drop and the confetti fly before the card slides in.
  setTimeout(() => {
    if (state.won) $('modal-win').classList.remove('hidden');
  }, 520);
}

function undoShot() {
  if (state.animating || state.history.length === 0) return;
  const prev = state.history.pop();
  state.won = false;
  $('modal-win').classList.add('hidden');
  state.ballPos = { ...prev.pos };
  state.usedMask = prev.usedMask;
  state.hintMove = null;
  const tile = state.level.grid[state.ballPos.y][state.ballPos.x];
  renderer.placeBallImmediate(state.ballPos.x, state.ballPos.y, tile.elev);
  sound.undo();
  evaluateCaddie();
  renderHUD();
  selectCard(prev.cardIndex, true);
}

function resetHole() {
  if (state.animating || !state.level) return;
  state.won = false;
  $('modal-win').classList.add('hidden');
  state.ballPos = { ...state.level.start };
  state.usedMask = 0;
  state.history = [];
  state.hintMove = null;
  const tile = state.level.grid[state.ballPos.y][state.ballPos.x];
  renderer.placeBallImmediate(state.ballPos.x, state.ballPos.y, tile.elev);
  sound.undo();
  evaluateCaddie();
  renderHUD();
  if (state.level.cards.length > 0) selectCard(0, true);
}

function evaluateCaddie() {
  if (!caddie.loaded || !state.level || state.won) return;
  const res = caddie.evaluateBoard(state.level, state.ballPos, state.usedMask);
  state.caddieEval = res;

  if (!res) {
    $('caddie-val').textContent = '—';
    $('caddie-ms').textContent = '—';
    $('caddie-moves').innerHTML = '<p class="ai-subtitle">No unused cards left.</p>';
    return;
  }

  // Exact BFS remaining optimal length from current state
  const subLevel = {
    ...state.level,
    start: { ...state.ballPos },
    cards: state.level.cards.filter((_, i) => !(state.usedMask & (1 << i))),
  };
  const bfsSol = solveLevel(subLevel, 2500);

  $('caddie-meta').textContent = `${caddie.meta.name} · ${caddie.meta.parameters.toLocaleString()} params · 24→64→32→2 MLP running 100% locally in your browser (zero server calls).`;
  $('caddie-val').textContent = `${res.predictedStrokesLeft.toFixed(1)}`;
  $('caddie-ms').textContent = `${res.elapsedMs.toFixed(2)} ms`;
  $('caddie-bfs').textContent = bfsSol ? `${bfsSol.length} moves` : 'Reset';

  const movesEl = $('caddie-moves');
  movesEl.innerHTML = '';
  res.ranked.slice(0, 5).forEach((m, rank) => {
    const pct = (m.prob * 100).toFixed(1);
    const row = document.createElement('div');
    row.className = 'caddie-row';
    row.innerHTML = `
      <div class="caddie-row-top">
        <span>#${rank + 1} ${m.cardLabel} → ${m.dirName}${m.won ? ' ⛳' : ''}</span>
        <span>${pct}% <small style="opacity:0.65">(z=${m.logit.toFixed(2)})</small></span>
      </div>
      <div class="caddie-bar-bg">
        <div class="caddie-bar-fill" style="width:${Math.max(4, Math.min(100, m.prob * 100))}%"></div>
      </div>
    `;
    row.addEventListener('click', () => {
      state.hintMove = { cardIndex: m.cardIndex, dir: m.dir, source: 'AI' };
      selectCard(m.cardIndex);
    });
    movesEl.appendChild(row);
  });

  // Render 32 hidden ReLU unit activations for top pick
  const actEl = $('caddie-activations');
  actEl.innerHTML = '';
  const acts = res.best.activations;
  let maxA = 0.001;
  for (let i = 0; i < acts.length; i++) if (acts[i] > maxA) maxA = acts[i];
  for (let i = 0; i < acts.length; i++) {
    const bar = document.createElement('div');
    bar.className = 'act-bar';
    bar.style.height = `${Math.max(6, Math.round((acts[i] / maxA) * 100))}%`;
    bar.title = `H2[${i}] = ${acts[i].toFixed(3)}`;
    actEl.appendChild(bar);
  }
}

function applyTheme(t) {
  state.theme = t;
  document.documentElement.setAttribute('data-theme', t);
  $('btn-theme').innerHTML = icon(t === 'dark' ? 'moon' : 'sun');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', t === 'dark' ? '#05061a' : '#1c0b3f');
  if (renderer) renderer.applyTheme(t);
  savePrefs();
}

function buildPresetGrid() {
  const grid = $('preset-grid');
  grid.innerHTML = '';
  Object.values(DIFFICULTY_PRESETS).forEach((p) => {
    const btn = document.createElement('button');
    btn.className = `preset-btn${state.difficultyId === p.id ? ' active' : ''}`;
    btn.innerHTML = `<strong>${p.label}</strong><span>${p.subtitle}</span>`;
    btn.addEventListener('click', () => {
      state.difficultyId = p.id;
      state.dailyMode = false;
      state.customConfig = null;
      syncCustomControlsFromPreset(p);
      savePrefs();
      buildPresetGrid();
      $('drawer-difficulty').classList.add('hidden');
      startHole();
      showToast(`${p.label} course`);
    });
    grid.appendChild(btn);
  });
}

function syncCustomControlsFromPreset(p) {
  $('opt-size').value = p.size;
  $('val-size').textContent = `${p.size}×${p.size}`;
  $('opt-elev').value = p.maxElev;
  $('val-elev').textContent = String(p.maxElev);
  $('opt-cards').value = p.cardCount;
  $('val-cards').textContent = String(p.cardCount);
  document.querySelectorAll('#mechanic-toggles input[data-mech]').forEach((cb) => {
    cb.checked = Boolean(p.mechanics[cb.dataset.mech]);
  });
}

function bindUI() {
  window.addEventListener('resize', updateInsets);
  window.addEventListener('orientationchange', updateInsets);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(updateInsets);
    ro.observe($('top-bar'));
    ro.observe($('bottom-dock'));
  }
  $('scrim').addEventListener('click', closeDrawers);

  $('btn-undo').addEventListener('click', undoShot);
  $('btn-reset').addEventListener('click', resetHole);
  $('btn-new-hole').addEventListener('click', () => {
    state.dailyMode = false;
    state.holeNumber += 1;
    savePrefs();
    startHole();
  });

  $('btn-daily').addEventListener('click', () => {
    state.dailyMode = true;
    state.difficultyId = 'classic';
    startHole(`daily-${todayISO()}`);
    showToast(`Daily course · ${todayISO()}`, 2200, 'gold');
  });

  $('btn-difficulty').addEventListener('click', () => {
    $('drawer-caddie').classList.add('hidden');
    $('drawer-difficulty').classList.toggle('hidden');
  });

  $('btn-caddie').addEventListener('click', () => {
    $('drawer-difficulty').classList.add('hidden');
    $('drawer-caddie').classList.toggle('hidden');
    evaluateCaddie();
    renderHand();
  });

  $('btn-rotate').addEventListener('click', () => {
    renderer.rotateCamera(1);
    sound.cardSelect();
  });

  $('btn-theme').addEventListener('click', () => {
    applyTheme(state.theme === 'dark' ? 'light' : 'dark');
    showToast(state.theme === 'dark' ? 'Midnight Links' : 'Sunset Drive', 1400);
  });

  const syncMute = () => {
    $('btn-mute').innerHTML = icon(sound.muted ? 'mute' : 'sound');
  };
  $('btn-mute').addEventListener('click', () => {
    sound.setMuted(!sound.muted);
    syncMute();
    if (!sound.muted) sound.cardSelect();
  });
  syncMute();

  document.querySelectorAll('[data-close]').forEach((btn) => {
    btn.addEventListener('click', () => $(btn.dataset.close).classList.add('hidden'));
  });

  // Custom sliders
  $('opt-size').addEventListener('input', (e) => ($('val-size').textContent = `${e.target.value}×${e.target.value}`));
  $('opt-elev').addEventListener('input', (e) => ($('val-elev').textContent = e.target.value));
  $('opt-cards').addEventListener('input', (e) => ($('val-cards').textContent = e.target.value));

  $('btn-apply-custom').addEventListener('click', () => {
    const mechanics = {};
    document.querySelectorAll('#mechanic-toggles input[data-mech]').forEach((cb) => {
      mechanics[cb.dataset.mech] = cb.checked;
    });
    const size = parseInt($('opt-size').value, 10);
    const maxElev = parseInt($('opt-elev').value, 10);
    const cardCount = parseInt($('opt-cards').value, 10);
    state.difficultyId = 'custom';
    state.dailyMode = false;
    state.customConfig = {
      id: 'custom',
      label: 'Custom',
      size,
      maxElev,
      cardCount,
      minPar: Math.min(3, Math.max(2, cardCount - 2)),
      maxPar: cardCount,
      decoyCards: 1,
      mechanics,
    };
    const customSeed = $('opt-seed').value.trim();
    savePrefs();
    buildPresetGrid();
    $('drawer-difficulty').classList.add('hidden');
    startHole(customSeed || `custom-${Date.now().toString(36)}`);
    showToast(`Custom ${size}×${size} course`);
  });

  // Caddie AI buttons
  $('btn-caddie-play').addEventListener('click', () => {
    if (!state.caddieEval?.best || state.animating || state.won) return;
    const best = state.caddieEval.best;
    state.selectedCard = best.cardIndex;
    $('drawer-caddie').classList.add('hidden');
    playDirection(best.dir);
  });

  $('btn-caddie-hint').addEventListener('click', () => {
    if (!state.level || state.animating || state.won) return;
    const remCards = [];
    const origIdx = [];
    state.level.cards.forEach((c, i) => {
      if (!(state.usedMask & (1 << i))) {
        remCards.push(c);
        origIdx.push(i);
      }
    });
    const sol = solveLevel({ ...state.level, start: { ...state.ballPos }, cards: remCards }, 3500);
    if (!sol || sol.length === 0) {
      showToast('No line from here · undo or reset', 2500, 'warn');
      return;
    }
    const move = { cardIndex: origIdx[sol[0].cardIndex], dir: sol[0].dir, source: 'BFS' };
    state.hintMove = move;
    $('drawer-caddie').classList.add('hidden');
    selectCard(move.cardIndex);
    showToast(`Optimal: ${formatCardName(state.level.cards[move.cardIndex])} ${formatCardLabel(state.level.cards[move.cardIndex])} along the amber arrow`, 2800, 'gold');
  });

  // Diagonal pad: each button's screen vector maps onto the nearest isometric axis
  document.querySelectorAll('#mobile-dir-pad .dir-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const dx = parseFloat(btn.dataset.sx);
      const dy = parseFloat(btn.dataset.sy);
      playDirection(renderer.screenVectorToDir(dx, dy));
    });
  });

  // Victory modal buttons
  $('btn-win-next').addEventListener('click', () => {
    state.dailyMode = false;
    state.holeNumber += 1;
    savePrefs();
    startHole();
  });

  $('btn-replay-hole').addEventListener('click', resetHole);

  $('btn-share').addEventListener('click', async () => {
    const strokes = state.history.length;
    const par = state.level.par;
    const url = `${location.origin}${location.pathname}?seed=${encodeURIComponent(state.level.seed)}&diff=${encodeURIComponent(state.difficultyId)}`;
    const text = `⛳ Life of Golf · ${state.dailyMode ? `Daily ${todayISO()}` : `Hole #${state.holeNumber}`}\nSunk in ${strokes} (Par ${par}) · 🔥 Streak ${state.streak}\n${url}`;
    try {
      await navigator.clipboard.writeText(text);
      showToast('Scorecard copied', 2000, 'gold');
    } catch {
      showToast(text, 3500);
    }
  });

  // Keyboard controls
  window.addEventListener('keydown', (e) => {
    if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
    if (e.key >= '1' && e.key <= '9') {
      const idx = parseInt(e.key, 10) - 1;
      if (state.level && idx < state.level.cards.length) selectCard(idx);
    } else if (e.key === 'ArrowUp' || e.key === 'w' || e.key === 'W') {
      e.preventDefault();
      playDirection(renderer.screenVectorToDir(1, -1));
    } else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') {
      e.preventDefault();
      playDirection(renderer.screenVectorToDir(1, 1));
    } else if (e.key === 'ArrowDown' || e.key === 's' || e.key === 'S') {
      e.preventDefault();
      playDirection(renderer.screenVectorToDir(-1, 1));
    } else if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') {
      e.preventDefault();
      playDirection(renderer.screenVectorToDir(-1, -1));
    } else if (e.key === 'z' || e.key === 'Z') {
      undoShot();
    } else if (e.key === 'r' || e.key === 'R') {
      resetHole();
    } else if (e.key === 'n' || e.key === 'N') {
      state.dailyMode = false;
      state.holeNumber += 1;
      savePrefs();
      startHole();
    } else if (e.key === 'q' || e.key === 'Q') {
      renderer.rotateCamera(-1);
    } else if (e.key === 'e' || e.key === 'E') {
      renderer.rotateCamera(1);
    } else if (e.key === 'h' || e.key === 'H') {
      $('btn-caddie').click();
    } else if (e.key === 'm' || e.key === 'M') {
      $('btn-mute').click();
    } else if (e.key === 'Escape') {
      closeDrawers();
    }
  });
}

function closeDrawers() {
  $('drawer-difficulty').classList.add('hidden');
  $('drawer-caddie').classList.add('hidden');
  renderHand();
}

/** Tell the renderer how much of the screen the HUD covers, so the course is framed in what is left. */
function updateInsets() {
  if (!renderer) return;
  const top = $('top-bar').getBoundingClientRect().bottom;
  const dock = $('bottom-dock').getBoundingClientRect();
  const sideRail = window.matchMedia('(orientation: landscape) and (max-height: 520px)').matches;
  renderer.setInsets(
    sideRail
      ? { top, right: window.innerWidth - dock.left }
      : { top, bottom: window.innerHeight - dock.top }
  );
}

async function init() {
  hydrateIcons();
  loadPrefs();
  applyTheme(state.theme);

  // URL params (?seed=...&diff=... or ?daily=YYYY-MM-DD)
  const params = new URLSearchParams(location.search);
  const dailyParam = params.get('daily');
  const seedParam = params.get('seed');
  const diffParam = params.get('diff');
  if (diffParam && DIFFICULTY_PRESETS[diffParam]) {
    state.difficultyId = diffParam;
  }
  if (dailyParam) {
    state.dailyMode = true;
  }

  renderer = new GolfRenderer3D($('game-canvas'), {
    theme: state.theme,
    quality: params.get('fx') || 'auto',
    onDirectionPick: (dirId) => playDirection(dirId),
    onSwipeDirection: (dirId) => playDirection(dirId),
  });

  buildPresetGrid();
  syncCustomControlsFromPreset(activeConfig());
  bindUI();

  try {
    await caddie.load('./models/caddie_net.json');
  } catch (err) {
    console.warn('CaddieNet failed to load:', err);
  }

  startHole(dailyParam ? `daily-${dailyParam}` : seedParam || null);
  updateInsets();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(updateInsets);

  // Lift the title card once the course is on screen.
  setTimeout(() => {
    $('splash').classList.add('done');
    let seen = true;
    try {
      seen = localStorage.getItem('life-of-golf:seen-intro') === '1';
      localStorage.setItem('life-of-golf:seen-intro', '1');
    } catch {}
    if (!seen) showToast('Pick a card · then swipe or tap an arrow', 4200);
  }, 650);

  // Expose debug handle for automated playtesting
  window.__GAME__ = { state, renderer, caddie, playDirection, selectCard, undoShot, resetHole, startHole };
}

init();
