/**
 * Смоук-тест приложения целиком: реальный `js/main.js` исполняется в jsdom,
 * а canvas-контекст подменяется заглушкой. Проверяются связки DOM ↔ логика:
 * старт партии, ввод, еда, пауза, проигрыш, рекорды, настройки и возврат в меню.
 *
 * Нужен jsdom: `npm install`, затем `npm run test:dom`.
 * Без установленного jsdom тест помечается пропущенным, поэтому `npm test`
 * работает и в репозитории без зависимостей.
 */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const APP_DIR = fileURLToPath(new URL('..', import.meta.url));
const INDEX_HTML = `${APP_DIR}index.html`;
const MAIN_JS = `${APP_DIR}js/main.js`;

const VECTORS = { right: [1, 0], left: [-1, 0], up: [0, -1], down: [0, 1] };

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Заглушка CanvasRenderingContext2D: любые методы — no-op, градиенты — объекты. */
function fakeContext() {
  const gradient = { addColorStop() {} };
  const base = {
    createLinearGradient: () => gradient,
    createRadialGradient: () => gradient,
    measureText: () => ({ width: 10 }),
  };
  return new Proxy(base, {
    get: (target, prop) => {
      if (prop in target) return target[prop];
      if (typeof prop === 'symbol') return undefined;
      return () => {};
    },
    set: (target, prop, value) => {
      target[prop] = value;
      return true;
    },
  });
}

/** Заглушка AudioContext: проверяем, что звук не роняет приложение. */
function fakeAudioContext() {
  const param = () => ({ value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} });
  return class {
    constructor() {
      this.state = 'running';
      this.currentTime = 0;
      this.sampleRate = 48000;
      this.destination = {};
    }
    createGain() {
      return { gain: param(), connect() {} };
    }
    createOscillator() {
      return { type: 'sine', frequency: param(), connect() {}, start() {}, stop() {} };
    }
    createBuffer(channels, frames) {
      return { getChannelData: () => new Float32Array(frames) };
    }
    createBufferSource() {
      return { buffer: null, connect() {}, start() {} };
    }
    createBiquadFilter() {
      return { type: 'lowpass', frequency: { value: 0 }, connect() {} };
    }
    resume() {
      return Promise.resolve();
    }
  };
}

async function loadJsdom(t) {
  try {
    return await import('jsdom');
  } catch {
    t.skip('jsdom не установлен: npm install && npm run test:dom');
    return null;
  }
}

test('приложение целиком работает в браузерном окружении', async (t) => {
  const jsdomModule = await loadJsdom(t);
  if (!jsdomModule) return;

  const { JSDOM } = jsdomModule;
  const html = await readFile(INDEX_HTML, 'utf8');
  const dom = new JSDOM(html, { url: 'https://preview.example/', pretendToBeVisual: true });
  const { window } = dom;
  const { document } = window;
  const $ = (id) => document.getElementById(id);

  const errors = [];
  window.addEventListener('error', (event) => errors.push(`error: ${event.message}`));
  window.addEventListener('unhandledrejection', (event) => errors.push(`rejection: ${event.reason}`));

  window.HTMLCanvasElement.prototype.getContext = () => fakeContext();
  window.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
  window.AudioContext = fakeAudioContext();
  window.matchMedia =
    window.matchMedia ?? (() => ({ matches: false, addEventListener() {}, removeEventListener() {} }));

  // jsdom-версии performance/navigator рекурсивно вызывают сами себя — их не подменяем.
  for (const key of [
    'window',
    'document',
    'HTMLElement',
    'HTMLCanvasElement',
    'Element',
    'Node',
    'Event',
    'KeyboardEvent',
    'MouseEvent',
    'getComputedStyle',
    'requestAnimationFrame',
    'cancelAnimationFrame',
    'ResizeObserver',
    'AudioContext',
    'localStorage',
  ]) {
    Object.defineProperty(globalThis, key, {
      value: window[key] ?? globalThis[key],
      configurable: true,
      writable: true,
    });
  }

  await import(MAIN_JS);
  t.after(() => window.close());

  const app = window.snake;
  assert.ok(app, 'js/main.js должен открыть отладочную ручку window.snake');

  /** Ждёт выполнения условия, чтобы не зависеть от скорости таймеров. */
  async function until(predicate, timeout = 20000) {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (predicate()) return true;
      await wait(50);
    }
    return false;
  }

  const press = (code) => document.dispatchEvent(new window.KeyboardEvent('keydown', { code, bubbles: true }));

  await t.test('меню отрисовано до старта', () => {
    assert.equal(app.phase, 'menu');
    assert.equal($('screen-menu').hidden, false);
    assert.equal($('overlay').hidden, false);
    assert.equal($('bestValue').textContent, '0');
  });

  await t.test('кнопка «Начать игру» запускает партию через отсчёт', async () => {
    $('startButton').click();
    assert.equal(app.phase, 'countdown');
    assert.equal($('overlay').hidden, true);
    assert.equal($('countdown').hidden, false);
    assert.ok(await until(() => app.phase === 'playing', 8000), 'отсчёт должен закончиться');
    assert.ok(await until(() => app.game.steps > 2, 5000), 'змейка должна двигаться');
    assert.equal(app.game.status, 'running');
    assert.ok(app.renderer.width > 100 && app.renderer.cell > 0, 'canvas должен получить размер');
  });

  await t.test('клавиатура меняет направление', async () => {
    const before = app.game.direction;
    press('ArrowDown');
    assert.ok(await until(() => app.game.direction !== before, 3000));
  });

  await t.test('яблоко по курсу съедается: очки, длина, HUD', async () => {
    assert.equal(app.game.queue.length, 0, 'на этом шаге очередь поворотов пуста');
    const vector = VECTORS[app.game.direction];
    const target = { x: app.game.head.x + vector[0], y: app.game.head.y + vector[1] };
    assert.equal(
      app.game.snake.some((segment) => segment.x === target.x && segment.y === target.y),
      false,
      'клетка по курсу свободна',
    );
    const scoreBefore = app.game.score;
    const lengthBefore = app.game.length;
    app.game.food = target;

    assert.ok(await until(() => app.game.score > scoreBefore, 5000), 'яблоко должно быть съедено');
    assert.equal(app.game.length, lengthBefore + 1);
    assert.equal($('scoreValue').textContent, String(app.game.score));
    assert.equal($('lengthValue').textContent, String(app.game.length));
  });

  await t.test('пауза останавливает игру и показывает экран', async () => {
    press('Space');
    await wait(120);
    assert.equal(app.phase, 'paused');
    assert.equal($('screen-pause').hidden, false);
    const steps = app.game.steps;
    await wait(600);
    assert.equal(app.game.steps, steps, 'на паузе змейка не двигается');
    $('resumeButton').click();
    assert.equal(app.phase, 'playing');
    assert.equal(app.game.status, 'running');
  });

  await t.test('стена заканчивает партию, рекорд сохраняется', async () => {
    app.game.queue = [];
    app.game.direction = 'left';
    app.game.snake = [
      { x: 1, y: 5 },
      { x: 2, y: 5 },
      { x: 3, y: 5 },
    ];
    app.game.prevSnake = app.game.snake.map((cell) => ({ ...cell }));
    const score = app.game.score;

    assert.ok(await until(() => app.phase === 'over', 5000), 'партия должна закончиться');
    assert.equal($('screen-over').hidden, false);
    assert.match($('overReason').textContent, /стену/);
    assert.equal($('overScore').textContent, String(score));
    assert.equal($('bestValue').textContent, String(score));
    assert.equal($('recordBadge').hidden, false, 'первый результат — уже рекорд');
    assert.equal(JSON.parse(window.localStorage.getItem('snake.best.v1')).normal, score);
  });

  await t.test('рестарт начинает новую партию', async () => {
    $('againButton').click();
    assert.ok(await until(() => app.phase === 'playing' && app.game.score === 0, 8000));
    assert.equal(app.game.steps, 0);
  });

  await t.test('настройки звука, сложности и стен сохраняются', async () => {
    $('soundButton').click();
    assert.equal(JSON.parse(window.localStorage.getItem('snake.settings.v1')).sound, false);
    assert.match($('soundButton').textContent, /выкл/);

    const hard = document.querySelector('[data-difficulty="hard"]');
    hard.click();
    assert.equal(app.settings.difficulty, 'hard');
    assert.equal(hard.classList.contains('is-active'), true);

    const wrap = $('wrapToggle');
    wrap.checked = true;
    wrap.dispatchEvent(new window.Event('change', { bubbles: true }));
    assert.equal(app.settings.wrap, true);
    assert.match($('modeBadge').textContent, /Сквозные/);

    // Настройки применяются к следующей партии.
    assert.equal(app.game.wrap, false);
    $('restartButton').click();
    assert.ok(await until(() => app.phase === 'playing', 8000));
    assert.equal(app.game.difficulty, 'hard');
    assert.equal(app.game.wrap, true);
  });

  await t.test('свайп и D-pad задают направление', async () => {
    app.game.queue = [];
    app.game.direction = 'up';
    const board = $('board');
    const pointer = (type, x, y) => {
      const event = new window.Event(type, { bubbles: true });
      Object.assign(event, { clientX: x, clientY: y, pointerId: 1 });
      board.dispatchEvent(event);
    };
    pointer('pointerdown', 100, 100);
    pointer('pointermove', 200, 100);
    assert.ok(await until(() => app.game.queue.includes('right') || app.game.direction === 'right', 2000));

    app.game.queue = [];
    app.game.direction = 'up';
    const left = document.querySelector('[data-dir="left"]');
    left.dispatchEvent(new window.Event('pointerdown', { bubbles: true }));
    assert.ok(await until(() => app.game.queue.includes('left') || app.game.direction === 'left', 2000));
  });

  await t.test('Escape и «В меню» возвращают в меню', async () => {
    press('Escape');
    await wait(150);
    assert.equal(app.phase, 'paused');
    $('pauseMenuButton').click();
    assert.equal(app.phase, 'menu');
    assert.equal($('screen-menu').hidden, false);
    assert.equal($('scoreValue').textContent, '0');
  });

  await t.test('по ходу всего сценария не было необработанных ошибок', () => {
    assert.deepEqual(errors, []);
  });
});
