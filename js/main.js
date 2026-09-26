/**
 * Точка входа: связывает игровую логику, отрисовку, звук и интерфейс.
 */

import { DEFAULT_DIFFICULTY, DIFFICULTIES, SnakeGame } from './core.js';
import { Renderer } from './render.js';
import { Sfx } from './audio.js';

const GRID = { cols: 24, rows: 24 };
const COUNTDOWN_MS = 700;
const SWIPE_THRESHOLD = 22;

const STORE_SETTINGS = 'snake.settings.v1';
const STORE_BEST = 'snake.best.v1';

const DIRECTION_KEYS = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  KeyW: 'up',
  KeyS: 'down',
  KeyA: 'left',
  KeyD: 'right',
};

const $ = (id) => document.getElementById(id);

const els = {
  stage: $('stage'),
  board: $('board'),
  canvas: $('game'),
  overlay: $('overlay'),
  countdown: $('countdown'),
  countdownValue: $('countdownValue'),
  screens: {
    menu: $('screen-menu'),
    pause: $('screen-pause'),
    over: $('screen-over'),
  },
  score: $('scoreValue'),
  best: $('bestValue'),
  length: $('lengthValue'),
  level: $('levelValue'),
  modeBadge: $('modeBadge'),
  difficultyButtons: Array.from(document.querySelectorAll('[data-difficulty]')),
  wrapToggle: $('wrapToggle'),
  soundToggle: $('soundToggle'),
  startButton: $('startButton'),
  againButton: $('againButton'),
  menuButton: $('menuButton'),
  resumeButton: $('resumeButton'),
  pauseRestartButton: $('pauseRestartButton'),
  pauseMenuButton: $('pauseMenuButton'),
  pauseScore: $('pauseScore'),
  pauseLength: $('pauseLength'),
  pauseButton: $('pauseButton'),
  restartButton: $('restartButton'),
  soundButton: $('soundButton'),
  overTitle: $('overTitle'),
  overReason: $('overReason'),
  overScore: $('overScore'),
  overBest: $('overBest'),
  overLength: $('overLength'),
  recordBadge: $('recordBadge'),
  dpadButtons: Array.from(document.querySelectorAll('[data-dir]')),
};

/* ───────────────────────── сохранение настроек ───────────────────────── */

function readJson(key, fallback) {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : { ...fallback };
  } catch {
    return { ...fallback };
  }
}

function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* приватный режим — просто не сохраняем */
  }
}

const settings = readJson(STORE_SETTINGS, { difficulty: DEFAULT_DIFFICULTY, wrap: false, sound: true });
if (!DIFFICULTIES[settings.difficulty]) settings.difficulty = DEFAULT_DIFFICULTY;
const bests = readJson(STORE_BEST, { easy: 0, normal: 0, hard: 0 });

/* ───────────────────────── состояние ───────────────────────── */

const game = new SnakeGame({ ...GRID, difficulty: settings.difficulty, wrap: settings.wrap });
const renderer = new Renderer(els.canvas);
const sfx = new Sfx({ enabled: settings.sound });

/** @type {'menu'|'countdown'|'playing'|'paused'|'over'} */
let phase = 'menu';
let accumulator = 0;
let countdownLeft = 0;
let countdownNumber = 0;
let lastFrame = performance.now();

/* ───────────────────────── интерфейс ───────────────────────── */

function showScreen(name) {
  for (const [key, element] of Object.entries(els.screens)) element.hidden = key !== name;
  els.overlay.hidden = !name;
  if (name) els.overlay.scrollTop = 0;
}

function restartAnimation(element) {
  element.style.animation = 'none';
  void element.offsetWidth; // принудительный reflow, чтобы анимация проигралась заново
  element.style.animation = '';
}

function bestForCurrentDifficulty() {
  return Math.max(0, bests[settings.difficulty] ?? 0);
}

function updateHud() {
  els.score.textContent = String(game.score);
  els.best.textContent = String(Math.max(bestForCurrentDifficulty(), game.score));
  els.length.textContent = String(game.length);
  els.level.textContent = String(game.level);
}

function syncSettingsUi() {
  for (const button of els.difficultyButtons) {
    const active = button.dataset.difficulty === settings.difficulty;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-checked', String(active));
  }
  els.wrapToggle.checked = settings.wrap;
  els.soundToggle.checked = settings.sound;
  els.soundButton.textContent = settings.sound ? 'Звук: вкл' : 'Звук: выкл';
  els.soundButton.setAttribute('aria-pressed', String(settings.sound));
  els.modeBadge.textContent = settings.wrap ? 'Сквозные стены' : 'Стены';
}

function saveSettings() {
  writeJson(STORE_SETTINGS, settings);
}

/* ───────────────────────── фазы игры ───────────────────────── */

function startGame() {
  game.configure({ difficulty: settings.difficulty, wrap: settings.wrap });
  game.newGame();
  accumulator = 0;
  countdownLeft = COUNTDOWN_MS * 3;
  countdownNumber = 3;
  els.countdownValue.textContent = '3';
  els.countdown.hidden = false;
  restartAnimation(els.countdownValue);
  showScreen(null);
  phase = 'countdown';
  sfx.unlock();
  updateHud();
}

function beginPlay() {
  phase = 'playing';
  accumulator = 0;
  els.countdown.hidden = true;
  sfx.start();
}

function endGame({ died }) {
  phase = 'over';
  const won = died === 'win';
  const isRecord = game.score > bestForCurrentDifficulty();

  if (isRecord) {
    bests[settings.difficulty] = game.score;
    writeJson(STORE_BEST, bests);
  }

  if (won) {
    sfx.bonus();
  } else {
    sfx.die();
    const head = game.head;
    renderer.burst(head.x, head.y, '#ff5f6d', 40, 2.2);
    renderer.shake(16);
  }

  els.overTitle.textContent = won ? 'Победа!' : 'Игра окончена';
  els.overReason.textContent = won
    ? 'Всё поле заполнено — такое почти невозможно.'
    : died === 'wall'
      ? 'Змейка врезалась в стену.'
      : 'Змейка врезалась в себя.';
  els.overScore.textContent = String(game.score);
  els.overBest.textContent = String(bestForCurrentDifficulty());
  els.overLength.textContent = String(game.length);
  els.recordBadge.hidden = !isRecord;

  updateHud();
  showScreen('over');
}

function toMenu() {
  phase = 'menu';
  game.configure({ difficulty: settings.difficulty, wrap: settings.wrap });
  game.newGame();
  game.status = 'idle';
  accumulator = 0;
  els.countdown.hidden = true;
  updateHud();
  showScreen('menu');
}

function togglePause() {
  if (phase === 'playing') {
    phase = 'paused';
    game.togglePause();
    sfx.pause();
    els.pauseScore.textContent = String(game.score);
    els.pauseLength.textContent = String(game.length);
    showScreen('pause');
  } else if (phase === 'paused') {
    game.togglePause();
    phase = 'playing';
    accumulator = 0;
    showScreen(null);
  }
}

function stepGame() {
  const events = game.step();
  if (!events) return;

  if (events.hit) {
    if (events.ate === 'food') {
      sfx.eat();
      renderer.burst(events.hit.x, events.hit.y, '#ff6b81', 14, 1);
      renderer.shake(3.5);
    } else if (events.ate === 'bonus') {
      sfx.bonus();
      renderer.burst(events.hit.x, events.hit.y, '#ffd166', 22, 1.4);
      renderer.shake(5);
    }
  }

  updateHud();

  if (events.died) {
    endGame({ died: events.died });
    return;
  }
  if (game.status === 'won') endGame({ died: 'win' });
}

/* ───────────────────────── игровой цикл ───────────────────────── */

function frame(now) {
  const delta = Math.min(now - lastFrame, 120);
  lastFrame = now;
  renderer.update(delta);

  if (phase === 'countdown') {
    countdownLeft -= delta;
    if (countdownLeft <= 0) {
      beginPlay();
    } else {
      const nextNumber = Math.max(1, Math.ceil(countdownLeft / COUNTDOWN_MS));
      if (nextNumber !== countdownNumber) {
        countdownNumber = nextNumber;
        els.countdownValue.textContent = String(nextNumber);
        restartAnimation(els.countdownValue);
      }
    }
  } else if (phase === 'playing') {
    const interval = game.intervalMs;
    accumulator += delta;
    let guard = 0;
    while (phase === 'playing' && accumulator >= interval && guard < 8) {
      accumulator -= interval;
      guard += 1;
      stepGame();
    }
    if (accumulator > interval) accumulator = 0;
  }

  const alpha = phase === 'playing' ? Math.min(accumulator / game.intervalMs, 1) : 1;
  renderer.render(game, alpha, now);
  window.requestAnimationFrame(frame);
}

/* ───────────────────────── размер поля ───────────────────────── */

function fitBoard() {
  const rect = els.stage.getBoundingClientRect();
  const size = Math.max(200, Math.floor(Math.min(rect.width, rect.height)));
  els.board.style.width = `${size}px`;
  els.board.style.height = `${size}px`;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  renderer.resize(size, size, dpr);
}

/* ───────────────────────── ввод ───────────────────────── */

function isInteractiveTarget(target) {
  return target instanceof Element && Boolean(target.closest('button, input, select, textarea, a'));
}

function steering() {
  return phase === 'playing' || phase === 'countdown';
}

function pushDirection(name) {
  if (steering()) game.setDirection(name);
}

window.addEventListener('keydown', (event) => {
  const direction = DIRECTION_KEYS[event.code];
  if (direction) {
    event.preventDefault();
    sfx.unlock();
    pushDirection(direction);
    return;
  }

  if (isInteractiveTarget(event.target)) return;

  if (event.code === 'Space' || event.code === 'Escape' || event.code === 'KeyP') {
    event.preventDefault();
    if (phase === 'menu' || phase === 'over') startGame();
    else if (phase === 'paused' || phase === 'playing') togglePause();
    return;
  }

  if (event.code === 'Enter' || event.code === 'NumpadEnter' || event.code === 'KeyR') {
    event.preventDefault();
    startGame();
  }
});

let pointerStart = null;

els.board.addEventListener('pointerdown', (event) => {
  sfx.unlock();
  pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
});

els.board.addEventListener('pointermove', (event) => {
  if (!pointerStart || event.pointerId !== pointerStart.id) return;
  const dx = event.clientX - pointerStart.x;
  const dy = event.clientY - pointerStart.y;
  if (Math.hypot(dx, dy) < SWIPE_THRESHOLD) return;
  pushDirection(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : dy > 0 ? 'down' : 'up');
  pointerStart = { x: event.clientX, y: event.clientY, id: event.pointerId };
});

const clearPointer = () => {
  pointerStart = null;
};
els.board.addEventListener('pointerup', clearPointer);
els.board.addEventListener('pointercancel', clearPointer);
els.board.addEventListener('contextmenu', (event) => event.preventDefault());

for (const button of els.dpadButtons) {
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    sfx.unlock();
    pushDirection(button.dataset.dir);
  });
  button.addEventListener('contextmenu', (event) => event.preventDefault());
}

els.startButton.addEventListener('click', startGame);
els.againButton.addEventListener('click', startGame);
els.menuButton.addEventListener('click', toMenu);
els.resumeButton.addEventListener('click', togglePause);
els.pauseMenuButton.addEventListener('click', toMenu);
els.pauseButton.addEventListener('click', togglePause);
els.restartButton.addEventListener('click', startGame);
els.pauseRestartButton.addEventListener('click', startGame);

for (const button of els.difficultyButtons) {
  button.addEventListener('click', () => {
    settings.difficulty = DIFFICULTIES[button.dataset.difficulty] ? button.dataset.difficulty : DEFAULT_DIFFICULTY;
    saveSettings();
    syncSettingsUi();
    updateHud();
  });
}

els.wrapToggle.addEventListener('change', () => {
  settings.wrap = els.wrapToggle.checked;
  saveSettings();
  syncSettingsUi();
});

function setSound(value) {
  settings.sound = value;
  sfx.setEnabled(value);
  saveSettings();
  syncSettingsUi();
}

els.soundToggle.addEventListener('change', () => setSound(els.soundToggle.checked));
els.soundButton.addEventListener('click', () => setSound(!settings.sound));

document.addEventListener('visibilitychange', () => {
  if (document.hidden && phase === 'playing') togglePause();
});

/* ───────────────────────── старт ───────────────────────── */

syncSettingsUi();
updateHud();
showScreen('menu');
fitBoard();

new ResizeObserver(fitBoard).observe(els.stage);
window.addEventListener('orientationchange', () => window.setTimeout(fitBoard, 200));
window.addEventListener('resize', fitBoard);

window.requestAnimationFrame((now) => {
  lastFrame = now;
  window.requestAnimationFrame(frame);
});

// Отладочная ручка: состояние партии доступно из консоли браузера и смоук-тестов.
window.snake = {
  game,
  renderer,
  sfx,
  settings,
  startGame,
  togglePause,
  toMenu,
  get phase() {
    return phase;
  },
};
