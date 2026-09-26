/**
 * Тесты чистой игровой логики. Запуск: npm test
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BONUS_TTL_STEPS,
  DIFFICULTIES,
  POINTS,
  SnakeGame,
  createSeededRandom,
  stepIntervalMs,
} from '../js/core.js';

/** Игра на маленьком поле, где еда убрана в дальний угол и не мешает. */
function makeGame(options = {}) {
  const game = new SnakeGame({
    cols: 10,
    rows: 10,
    rng: createSeededRandom(42),
    ...options,
  });
  game.newGame();
  game.food = { x: 0, y: 0 };
  return game;
}

/** Ставит змейку в заданную позу: голова первая, направление движения. */
function pose(game, snake, direction) {
  game.snake = snake.map((cell) => ({ ...cell }));
  game.prevSnake = game.snake.map((cell) => ({ ...cell }));
  game.direction = direction;
  game.queue = [];
  game.growth = 0;
  game.food = { x: 0, y: 0 };
  game.bonus = null;
  game.status = 'running';
  return game;
}

const cellsEqual = (a, b) => a.x === b.x && a.y === b.y;

test('конструктор проверяет размеры поля', () => {
  assert.throws(() => new SnakeGame({ cols: 2, rows: 10 }), RangeError);
  assert.throws(() => new SnakeGame({ cols: 10, rows: 4 }), RangeError);
  assert.throws(() => new SnakeGame({ cols: 10, rows: 10, rng: 5 }), TypeError);
});

test('новая игра: стартовое состояние корректно', () => {
  const game = new SnakeGame({ cols: 12, rows: 12, rng: createSeededRandom(7) });
  assert.equal(game.status, 'idle', 'до старта партия ждёт в меню');
  assert.equal(game.snake.length, 3, 'змейка уже стоит на поле для отрисовки меню');

  game.newGame();
  assert.equal(game.status, 'running');
  assert.equal(game.snake.length, 3);
  assert.deepEqual(game.head, { x: 6, y: 6 });
  assert.equal(game.direction, 'right');
  assert.equal(game.score, 0);
  assert.equal(game.level, 1);
  assert.ok(game.food, 'еда появилась');
  assert.ok(!game.snake.some((segment) => cellsEqual(segment, game.food)), 'еда не внутри змейки');
});

test('еда никогда не появляется на змейке', () => {
  const game = new SnakeGame({ cols: 6, rows: 6, rng: createSeededRandom(3) });
  for (let i = 0; i < 300; i += 1) {
    game.newGame();
    const occupied = game.snake.some((segment) => cellsEqual(segment, game.food));
    assert.equal(occupied, false, `попытка ${i}: еда на змейке`);
    assert.ok(game.food.x >= 0 && game.food.x < 6 && game.food.y >= 0 && game.food.y < 6);
  }
});

test('поворот: разворот на 180° и повтор направления отклоняются', () => {
  const game = makeGame();
  assert.equal(game.setDirection('right'), false, 'то же направление');
  assert.equal(game.setDirection('left'), false, 'разворот');
  assert.equal(game.setDirection('up'), true);
  assert.equal(game.setDirection('down'), false, 'разворот относительно поставленного в очередь');
  assert.equal(game.setDirection('left'), true, 'перпендикулярен поставленному в очередь');
  assert.equal(game.setDirection('right'), false, 'очередь заполнена (максимум два хода)');
  assert.deepEqual(game.queue, ['up', 'left']);
});

test('повороты не принимаются до старта и после конца партии', () => {
  const idle = new SnakeGame({ cols: 10, rows: 10, rng: createSeededRandom(1) });
  assert.equal(idle.setDirection('up'), false, 'в меню');

  const game = pose(makeGame(), [{ x: 0, y: 5 }, { x: 1, y: 5 }], 'left');
  game.step();
  assert.equal(game.status, 'over');
  assert.equal(game.setDirection('up'), false, 'после проигрыша');
  assert.equal(game.step(), null, 'шаги после конца партии игнорируются');
});

test('шаг двигает змейку, сохраняя длину без еды', () => {
  const game = pose(makeGame(), [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], 'right');
  const events = game.step();
  assert.deepEqual(events, {
    moved: true,
    died: null,
    ate: null,
    scoreDelta: 0,
    bonusExpired: false,
    hit: { x: 6, y: 5 },
  });
  assert.deepEqual(game.snake, [{ x: 6, y: 5 }, { x: 5, y: 5 }, { x: 4, y: 5 }]);
  assert.equal(game.status, 'running');
});

test('еда: +10 очков, змейка растёт, длина считается', () => {
  const game = pose(makeGame(), [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], 'right');
  game.food = { x: 6, y: 5 };
  const events = game.step();
  assert.equal(events.ate, 'food');
  assert.equal(events.scoreDelta, POINTS.food);
  assert.equal(game.score, POINTS.food);
  assert.equal(game.snake.length, 4);
  assert.equal(game.foodsEaten, 1);
  assert.ok(!game.snake.some((segment) => cellsEqual(segment, game.food)), 'новая еда не на змейке');
});

test('отложенный рост не теряется и хвост не укорачивается', () => {
  const game = pose(makeGame(), [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], 'right');
  game.growth = 2; // два сегмента «в очереди»
  game.food = { x: 0, y: 9 };

  game.step();
  assert.equal(game.snake.length, 4, 'первый сегмент из очереди добавлен');
  assert.equal(game.growth, 1);

  game.step();
  assert.equal(game.snake.length, 5, 'второй сегмент из очереди добавлен');
  assert.equal(game.growth, 0);

  game.step();
  assert.equal(game.snake.length, 5, 'очередь пуста — длина держится');
  assert.deepEqual(game.snake.map((cell) => cell.x), [8, 7, 6, 5, 4]);
});

test('стена: вне поля, если сквозные стены выключены', () => {
  const game = pose(makeGame({ wrap: false }), [{ x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 }], 'left');
  const before = game.snake.map((cell) => ({ ...cell }));
  const events = game.step();
  assert.equal(events.died, 'wall');
  assert.equal(events.moved, false);
  assert.equal(game.status, 'over');
  assert.deepEqual(game.snake, before, 'позиция зафиксирована для отрисовки');
});

test('сквозные стены переносят змейку на другую сторону', () => {
  const game = pose(makeGame({ wrap: true }), [{ x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 }], 'left');
  const events = game.step();
  assert.equal(events.died, null);
  assert.deepEqual(game.head, { x: 9, y: 3 });
  assert.equal(game.status, 'running');
});

test('столкновение с собой заканчивает партию', () => {
  const game = pose(
    makeGame(),
    [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 4, y: 6 }, { x: 5, y: 6 }, { x: 6, y: 6 }],
    'down',
  );
  const events = game.step();
  assert.equal(events.died, 'self');
  assert.equal(game.status, 'over');
  assert.ok(game.isFinished);
});

test('в уезжающий хвост врезаться нельзя', () => {
  const game = pose(makeGame(), [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 4, y: 6 }, { x: 5, y: 6 }], 'down');
  const events = game.step();
  assert.equal(events.died, null);
  assert.deepEqual(game.head, { x: 5, y: 6 });
  assert.equal(game.snake.length, 4);
});

test('пауза переключается и останавливает шаги', () => {
  const game = makeGame();
  assert.equal(game.togglePause(), 'paused');
  assert.equal(game.step(), null);
  assert.equal(game.togglePause(), 'running');
  const events = game.step();
  assert.equal(events.moved, true);
});

test('бонус появляется каждое пятое яблоко и даёт +50', () => {
  const game = pose(makeGame(), [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], 'right');
  game.foodsEaten = 4;
  game.food = { x: 6, y: 5 };
  game.step();
  assert.equal(game.foodsEaten, 5);
  assert.equal(game.score, POINTS.food);
  assert.ok(game.bonus, 'бонус появился');
  assert.equal(game.bonus.ttl, BONUS_TTL_STEPS);
  assert.equal(game.level, 2);

  game.food = { x: 0, y: 9 };
  game.bonus = { x: 7, y: 5, ttl: 4 };
  const events = game.step();
  assert.equal(events.ate, 'bonus');
  assert.equal(events.scoreDelta, POINTS.bonus);
  assert.equal(game.score, POINTS.food + POINTS.bonus);
  assert.equal(game.bonus, null);
  assert.equal(game.snake.length, 5);

  // Бонус даёт +2 сегмента, поэтому следующий шаг тоже удлиняет змейку.
  game.step();
  assert.equal(game.snake.length, 6, 'второй сегмент за бонус добавлен на следующем шаге');
});

test('бонус исчезает, когда истекает его таймер', () => {
  const game = pose(makeGame(), [{ x: 5, y: 5 }, { x: 4, y: 5 }, { x: 3, y: 5 }], 'right');
  game.bonus = { x: 1, y: 1, ttl: 1 };
  const events = game.step();
  assert.equal(events.bonusExpired, true);
  assert.equal(game.bonus, null);
  assert.equal(game.score, 0);
});

test('заполненное поле даёт статус won', () => {
  const game = makeGame({ cols: 5, rows: 5 });
  const path = [];
  for (let y = 0; y < 5; y += 1) {
    const row = [0, 1, 2, 3, 4];
    if (y % 2 === 1) row.reverse();
    for (const x of row) path.push({ x, y });
  }
  pose(game, path.slice(0, 24).reverse(), 'right');
  game.food = path[24];
  const events = game.step();
  assert.equal(events.died, null);
  assert.equal(game.status, 'won');
  assert.equal(game.snake.length, 25);
  assert.equal(game.food, null);
});

test('скорость растёт с каждым яблоком и упирается в предел', () => {
  assert.ok(stepIntervalMs('normal', 1) < stepIntervalMs('normal', 0));
  assert.equal(stepIntervalMs('normal', 0), DIFFICULTIES.normal.baseMs);
  assert.equal(stepIntervalMs('normal', 500), DIFFICULTIES.normal.floorMs);
  assert.ok(stepIntervalMs('hard', 0) < stepIntervalMs('easy', 0));
  assert.equal(stepIntervalMs('неизвестный', 0), DIFFICULTIES.normal.baseMs);

  const game = makeGame();
  game.foodsEaten = 3;
  assert.equal(game.intervalMs, stepIntervalMs('normal', 3));
});

test('configure меняет сложность и стены, отбрасывая мусор', () => {
  const game = makeGame();
  game.configure({ difficulty: 'hard', wrap: true });
  assert.equal(game.difficulty, 'hard');
  assert.equal(game.wrap, true);
  game.configure({ difficulty: 'читерская', wrap: 'да' });
  assert.equal(game.difficulty, 'hard');
  assert.equal(game.wrap, true);
});

test('генератор случайных чисел воспроизводим', () => {
  const a = createSeededRandom(2024);
  const b = createSeededRandom(2024);
  const first = [a(), a(), a()];
  const second = [b(), b(), b()];
  assert.deepEqual(first, second);
  assert.ok(first.every((value) => value >= 0 && value < 1));
});
