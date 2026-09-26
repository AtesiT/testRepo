/**
 * «Змейка» — чистая игровая логика.
 *
 * Модуль не знает про DOM, canvas, таймеры и звук: он только считает состояние
 * игры. Это позволяет тестировать правила в Node без браузера (см. test/core.test.mjs),
 * а слой отрисовки и ввода подключать отдельно.
 */

export const DIRECTIONS = Object.freeze({
  up: Object.freeze({ x: 0, y: -1 }),
  down: Object.freeze({ x: 0, y: 1 }),
  left: Object.freeze({ x: -1, y: 0 }),
  right: Object.freeze({ x: 1, y: 0 }),
});

export const OPPOSITE = Object.freeze({
  up: 'down',
  down: 'up',
  left: 'right',
  right: 'left',
});

export const DIFFICULTIES = Object.freeze({
  easy: Object.freeze({ key: 'easy', label: 'Легко', baseMs: 165, floorMs: 105, accel: 2.2 }),
  normal: Object.freeze({ key: 'normal', label: 'Норма', baseMs: 125, floorMs: 72, accel: 3 }),
  hard: Object.freeze({ key: 'hard', label: 'Хард', baseMs: 92, floorMs: 50, accel: 3.6 }),
});

export const DEFAULT_DIFFICULTY = 'normal';

/** Очки за еду. */
export const POINTS = Object.freeze({ food: 10, bonus: 50 });

/** Каждое N-е яблоко открывает золотой бонус. */
export const BONUS_EVERY = 5;
/** Сколько шагов живёт бонус, прежде чем исчезнуть. */
export const BONUS_TTL_STEPS = 30;
/** Сколько сегментов даёт бонус. */
export const BONUS_GROWTH = 2;
/** Сколько сегментов даёт обычное яблоко. */
export const GROWTH_PER_FOOD = 1;
/** Длина змейки на старте. */
export const START_LENGTH = 3;

const START_DIRECTION = 'right';

/**
 * Быстрый детерминированный генератор (mulberry32).
 * Нужен для тестов и воспроизводимых партий.
 * @param {number} seed
 * @returns {() => number} функция, возвращающая числа в [0, 1)
 */
export function createSeededRandom(seed = 1) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Интервал между шагами змейки: чем больше съедено, тем быстрее игра.
 * @param {string} difficulty
 * @param {number} foodsEaten
 * @returns {number} миллисекунды
 */
export function stepIntervalMs(difficulty = DEFAULT_DIFFICULTY, foodsEaten = 0) {
  const preset = DIFFICULTIES[difficulty] ?? DIFFICULTIES[DEFAULT_DIFFICULTY];
  const eaten = Math.max(0, foodsEaten);
  return Math.max(preset.floorMs, preset.baseMs - eaten * preset.accel);
}

const clone = (cell) => ({ x: cell.x, y: cell.y });
const sameCell = (a, b) => Boolean(a && b && a.x === b.x && a.y === b.y);

/**
 * Состояние партии. Все переходы — через методы, поля публичны только для чтения.
 *
 * Статусы: `idle` (меню), `running`, `paused`, `over` (проигрыш), `won` (поле заполнено).
 */
export class SnakeGame {
  /**
   * @param {object} [options]
   * @param {number} [options.cols] ширина поля в клетках
   * @param {number} [options.rows] высота поля в клетках
   * @param {boolean} [options.wrap] сквозные стены
   * @param {string} [options.difficulty] ключ из DIFFICULTIES
   * @param {() => number} [options.rng] генератор случайных чисел
   */
  constructor({ cols = 24, rows = 24, wrap = false, difficulty = DEFAULT_DIFFICULTY, rng = Math.random } = {}) {
    if (!Number.isInteger(cols) || cols < 5) throw new RangeError('cols должен быть целым числом ≥ 5');
    if (!Number.isInteger(rows) || rows < 5) throw new RangeError('rows должен быть целым числом ≥ 5');
    if (typeof rng !== 'function') throw new TypeError('rng должен быть функцией');

    this.cols = cols;
    this.rows = rows;
    this.wrap = Boolean(wrap);
    this.difficulty = DIFFICULTIES[difficulty] ? difficulty : DEFAULT_DIFFICULTY;
    this.rng = rng;

    this.status = 'idle';
    this.#setup();
    this.status = 'idle';
  }

  /* ───────────────────────── состояние ───────────────────────── */

  get head() {
    return this.snake[0];
  }

  get length() {
    return this.snake.length;
  }

  /** Уровень растёт каждые BONUS_EVERY яблок. */
  get level() {
    return 1 + Math.floor(this.foodsEaten / BONUS_EVERY);
  }

  /** Текущая скорость (мс на шаг). */
  get intervalMs() {
    return stepIntervalMs(this.difficulty, this.foodsEaten);
  }

  get isRunning() {
    return this.status === 'running';
  }

  get isFinished() {
    return this.status === 'over' || this.status === 'won';
  }

  /* ───────────────────────── управление ───────────────────────── */

  /**
   * Меняет настройки перед новой партией.
   * @param {{difficulty?: string, wrap?: boolean}} [options]
   */
  configure({ difficulty, wrap } = {}) {
    if (typeof difficulty === 'string' && DIFFICULTIES[difficulty]) this.difficulty = difficulty;
    if (typeof wrap === 'boolean') this.wrap = wrap;
    return this;
  }

  /** Начинает новую партию на текущих настройках. */
  newGame() {
    this.#setup();
    this.status = 'running';
    return this;
  }

  /**
   * Ставит поворот в очередь (не более двух ходов вперёд).
   * Разворот на 180° и повтор направления отбрасываются.
   * @param {'up'|'down'|'left'|'right'} name
   * @returns {boolean} принят ли поворот
   */
  setDirection(name) {
    if (!DIRECTIONS[name]) return false;
    if (this.isFinished || this.status === 'idle') return false;
    if (this.queue.length >= 2) return false;

    const consider = (candidate) => {
      const current = this.queue.length ? this.queue[this.queue.length - 1] : this.direction;
      return name !== current && name !== OPPOSITE[current];
    };
    // Проверяем ход относительно последнего запланированного направления,
    // чтобы быстрые двойные нажатия не привели к развороту.
    if (!consider(name)) return false;

    this.queue.push(name);
    return true;
  }

  /** @returns {'running'|'paused'|'over'|'won'|'idle'} новый статус */
  togglePause() {
    if (this.status === 'running') this.status = 'paused';
    else if (this.status === 'paused') this.status = 'running';
    return this.status;
  }

  /**
   * Один шаг игрового времени.
   * @returns {null | {moved: boolean, died: null|'wall'|'self'|'win', ate: null|'food'|'bonus',
   *   scoreDelta: number, bonusExpired: boolean, hit: {x: number, y: number}|null}}
   */
  step() {
    if (this.status !== 'running') return null;

    const directionName = this.queue.shift() ?? this.direction;
    this.direction = directionName;
    const delta = DIRECTIONS[directionName];
    const previousSnake = this.snake.map(clone);
    const head = { x: this.head.x + delta.x, y: this.head.y + delta.y };
    const bonusBefore = this.bonus;

    let died = null;
    if (this.wrap) {
      head.x = (head.x + this.cols) % this.cols;
      head.y = (head.y + this.rows) % this.rows;
    } else if (head.x < 0 || head.y < 0 || head.x >= this.cols || head.y >= this.rows) {
      died = 'wall';
    }

    let ate = null;
    if (!died && sameCell(head, this.food)) ate = 'food';
    else if (!died && sameCell(head, this.bonus)) ate = 'bonus';

    if (!died) {
      const growing = this.growth > 0 || ate !== null;
      const tailIndex = this.snake.length - 1;
      const hitIndex = this.snake.findIndex(
        (segment, index) => sameCell(segment, head) && !(index === tailIndex && !growing),
      );
      // Собственный хвост «уезжает» на этом же шаге, поэтому в него врезаться можно.
      if (hitIndex !== -1) died = 'self';
    }

    if (died) {
      this.status = 'over';
      this.prevSnake = previousSnake;
      return { moved: false, died, ate: null, scoreDelta: 0, bonusExpired: false, hit: head };
    }

    this.prevSnake = previousSnake;
    this.steps += 1;
    this.snake.unshift(head);
    if (ate) this.growth += ate === 'food' ? GROWTH_PER_FOOD : BONUS_GROWTH;
    if (this.growth > 0) this.growth -= 1;
    else this.snake.pop();

    let scoreDelta = 0;
    if (ate === 'food') {
      scoreDelta = POINTS.food;
      this.foodsEaten += 1;
      this.food = this.#randomFreeCell();
      const bonusDue = this.foodsEaten % BONUS_EVERY === 0;
      this.bonus = bonusDue ? this.#spawnBonus() : null;
    } else if (ate === 'bonus') {
      scoreDelta = POINTS.bonus;
      this.bonus = null;
    }
    this.score += scoreDelta;

    let bonusExpired = false;
    if (bonusBefore && this.bonus === bonusBefore) {
      bonusBefore.ttl -= 1;
      if (bonusBefore.ttl <= 0) {
        this.bonus = null;
        bonusExpired = true;
      }
    }

    if (this.food === null) this.status = 'won';

    return { moved: true, died: null, ate, scoreDelta, bonusExpired, hit: head };
  }

  /* ───────────────────────── внутреннее ───────────────────────── */

  #setup() {
    const centerY = Math.floor(this.rows / 2);
    const centerX = Math.max(START_LENGTH - 1, Math.floor(this.cols / 2));
    this.snake = [];
    for (let i = 0; i < START_LENGTH; i += 1) this.snake.push({ x: centerX - i, y: centerY });
    this.prevSnake = this.snake.map(clone);
    this.direction = START_DIRECTION;
    this.queue = [];
    this.food = null;
    this.bonus = null;
    this.score = 0;
    this.foodsEaten = 0;
    this.growth = 0;
    this.steps = 0;
    this.food = this.#randomFreeCell();
  }

  #spawnBonus() {
    const cell = this.#randomFreeCell();
    return cell ? { ...cell, ttl: BONUS_TTL_STEPS } : null;
  }

  #freeCells() {
    const occupied = new Set();
    for (const segment of this.snake) occupied.add(segment.y * this.cols + segment.x);
    if (this.food) occupied.add(this.food.y * this.cols + this.food.x);
    if (this.bonus) occupied.add(this.bonus.y * this.cols + this.bonus.x);

    const cells = [];
    for (let y = 0; y < this.rows; y += 1) {
      for (let x = 0; x < this.cols; x += 1) {
        if (!occupied.has(y * this.cols + x)) cells.push({ x, y });
      }
    }
    return cells;
  }

  #randomFreeCell() {
    const cells = this.#freeCells();
    if (cells.length === 0) return null;
    const index = Math.min(cells.length - 1, Math.floor(this.rng() * cells.length));
    return cells[index];
  }
}
