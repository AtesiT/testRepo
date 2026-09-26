/**
 * Слой отрисовки: canvas 2D, интерполяция движения между шагами,
 * частицы и «тряска» экрана. Про правила игры модуль ничего не решает.
 */

import { BONUS_TTL_STEPS, DIRECTIONS } from './core.js';

const COLORS = {
  boardTop: '#101c31',
  boardBottom: '#080e1c',
  grid: 'rgba(148, 187, 255, 0.055)',
  checker: 'rgba(255, 255, 255, 0.014)',
  border: 'rgba(120, 200, 255, 0.16)',
  head: '#c9ffdd',
  body: '#3ddc84',
  tail: '#12866a',
  glow: 'rgba(61, 220, 132, 0.5)',
  food: '#ff8ba0',
  foodDeep: '#e11d48',
  leaf: '#4ade80',
  bonus: '#ffe9a3',
  bonusDeep: '#f59e0b',
};

const lerp = (a, b, t) => a + (b - a) * t;

function hexToRgb(hex) {
  const value = hex.replace('#', '');
  const full = value.length === 3 ? value.split('').map((c) => c + c).join('') : value;
  const num = Number.parseInt(full, 16);
  return { r: (num >> 16) & 255, g: (num >> 8) & 255, b: num & 255 };
}

function mixColor(from, to, t) {
  const a = hexToRgb(from);
  const b = hexToRgb(to);
  return `rgb(${Math.round(lerp(a.r, b.r, t))}, ${Math.round(lerp(a.g, b.g, t))}, ${Math.round(lerp(a.b, b.b, t))})`;
}

function roundRectPath(ctx, x, y, width, height, radius) {
  const r = Math.max(0, Math.min(radius, width / 2, height / 2));
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.arcTo(x + width, y, x + width, y + r, r);
  ctx.lineTo(x + width, y + height - r);
  ctx.arcTo(x + width, y + height, x + width - r, y + height, r);
  ctx.lineTo(x + r, y + height);
  ctx.arcTo(x, y + height, x, y + height - r, r);
  ctx.lineTo(x, y + r);
  ctx.arcTo(x, y, x + r, y, r);
  ctx.closePath();
}

export class Renderer {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.width = 0;
    this.height = 0;
    this.cell = 0;
    this.originX = 0;
    this.originY = 0;
    this.cols = 1;
    this.rows = 1;
    this.particles = [];
    this.shakeAmount = 0;
    this.reducedMotion = false;
    if (typeof window !== 'undefined' && window.matchMedia) {
      this.reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    }
  }

  /** Подгоняет буфер canvas под CSS-размер с учётом плотности пикселей. */
  resize(cssWidth, cssHeight, dpr = 1) {
    const width = Math.max(1, Math.round(cssWidth));
    const height = Math.max(1, Math.round(cssHeight));
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = width;
    this.height = height;
  }

  /** Запускает вспышку частиц в клетке поля. */
  burst(gridX, gridY, color, count = 14, power = 1) {
    if (this.reducedMotion || !this.cell) return;
    const x = this.#centerX(Math.min(Math.max(gridX, 0), this.cols - 1));
    const y = this.#centerY(Math.min(Math.max(gridY, 0), this.rows - 1));
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = (0.4 + Math.random()) * this.cell * 4.5 * power;
      this.particles.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0,
        ttl: 380 + Math.random() * 420,
        radius: this.cell * (0.075 + Math.random() * 0.095),
        color,
      });
    }
    if (this.particles.length > 420) this.particles.splice(0, this.particles.length - 420);
  }

  /** Тряска экрана: значения складываются по максимуму и затухают. */
  shake(amount) {
    if (this.reducedMotion) return;
    this.shakeAmount = Math.min(18, Math.max(this.shakeAmount, amount));
  }

  /** @param {number} deltaMs время с прошлого кадра */
  update(deltaMs) {
    const seconds = Math.min(deltaMs, 50) / 1000;
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const particle = this.particles[i];
      particle.life += deltaMs;
      particle.x += particle.vx * seconds;
      particle.y += particle.vy * seconds;
      particle.vx *= 0.93;
      particle.vy = particle.vy * 0.93 + this.cell * 2.2 * seconds;
      if (particle.life >= particle.ttl) this.particles.splice(i, 1);
    }
    if (this.shakeAmount > 0) {
      this.shakeAmount *= Math.exp(-7 * seconds);
      if (this.shakeAmount < 0.12) this.shakeAmount = 0;
    }
  }

  /**
   * @param {import('./core.js').SnakeGame} game
   * @param {number} alpha прогресс между шагами [0..1] для плавного движения
   * @param {number} timeMs время для анимаций (пульсация, вращение)
   */
  render(game, alpha = 1, timeMs = 0) {
    const ctx = this.ctx;
    if (!this.width || !this.height) return;

    ctx.clearRect(0, 0, this.width, this.height);

    const cols = (this.cols = game.cols);
    const rows = (this.rows = game.rows);
    const cell = (this.cell = Math.min(this.width / cols, this.height / rows));
    const originX = (this.originX = (this.width - cell * cols) / 2);
    const originY = (this.originY = (this.height - cell * rows) / 2);
    const boardWidth = cell * cols;
    const boardHeight = cell * rows;
    const radius = Math.min(cell * 1.4, 26);

    ctx.save();
    if (this.shakeAmount > 0.12) {
      ctx.translate((Math.random() * 2 - 1) * this.shakeAmount, (Math.random() * 2 - 1) * this.shakeAmount);
    }

    const background = ctx.createLinearGradient(originX, originY, originX, originY + boardHeight);
    background.addColorStop(0, COLORS.boardTop);
    background.addColorStop(1, COLORS.boardBottom);
    roundRectPath(ctx, originX, originY, boardWidth, boardHeight, radius);
    ctx.fillStyle = background;
    ctx.fill();

    ctx.save();
    roundRectPath(ctx, originX, originY, boardWidth, boardHeight, radius);
    ctx.clip();

    ctx.fillStyle = COLORS.checker;
    for (let y = 0; y < rows; y += 1) {
      for (let x = y % 2; x < cols; x += 2) {
        ctx.fillRect(originX + x * cell, originY + y * cell, cell, cell);
      }
    }

    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < cols; x += 1) {
      const px = Math.round(originX + x * cell) + 0.5;
      ctx.moveTo(px, originY);
      ctx.lineTo(px, originY + boardHeight);
    }
    for (let y = 1; y < rows; y += 1) {
      const py = Math.round(originY + y * cell) + 0.5;
      ctx.moveTo(originX, py);
      ctx.lineTo(originX + boardWidth, py);
    }
    ctx.stroke();

    this.#drawBonus(game, timeMs);
    this.#drawFood(game, timeMs);
    this.#drawSnake(game, alpha);
    ctx.restore();

    roundRectPath(ctx, originX + 0.75, originY + 0.75, boardWidth - 1.5, boardHeight - 1.5, radius);
    ctx.strokeStyle = game.status === 'paused' ? 'rgba(255, 255, 255, 0.2)' : COLORS.border;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    this.#drawParticles();
    if (game.isFinished) this.#drawResultTint(originX, originY, boardWidth, boardHeight, radius, game.status === 'won');

    ctx.restore();
  }

  /* ───────────────────────── примитивы ───────────────────────── */

  #centerX(gridX) {
    return this.originX + (gridX + 0.5) * this.cell;
  }

  #centerY(gridY) {
    return this.originY + (gridY + 0.5) * this.cell;
  }

  #drawFood(game, timeMs) {
    const food = game.food;
    if (!food) return;
    const ctx = this.ctx;
    const x = this.#centerX(food.x);
    const y = this.#centerY(food.y);
    const pulse = this.reducedMotion ? 1 : 1 + 0.05 * Math.sin(timeMs / 230);
    const r = this.cell * 0.34 * pulse;

    ctx.save();
    if (!this.reducedMotion) {
      ctx.shadowColor = 'rgba(255, 45, 85, 0.75)';
      ctx.shadowBlur = this.cell * 0.8;
    }
    const gradient = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.15, x, y, r);
    gradient.addColorStop(0, '#ffe0e6');
    gradient.addColorStop(0.45, COLORS.food);
    gradient.addColorStop(1, COLORS.foodDeep);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(x, y);
    ctx.strokeStyle = 'rgba(140, 96, 60, 0.95)';
    ctx.lineWidth = Math.max(1, this.cell * 0.055);
    ctx.beginPath();
    ctx.moveTo(0, -r * 0.55);
    ctx.lineTo(r * 0.14, -r * 1.1);
    ctx.stroke();
    ctx.fillStyle = COLORS.leaf;
    ctx.beginPath();
    ctx.ellipse(r * 0.42, -r * 0.92, r * 0.42, r * 0.2, -0.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
    ctx.beginPath();
    ctx.arc(-r * 0.32, -r * 0.36, r * 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  #drawBonus(game, timeMs) {
    const bonus = game.bonus;
    if (!bonus) return;
    const ctx = this.ctx;
    const x = this.#centerX(bonus.x);
    const y = this.#centerY(bonus.y);
    const ttlRatio = Math.max(0, Math.min(1, bonus.ttl / BONUS_TTL_STEPS));
    const blinking = bonus.ttl <= 6 && !this.reducedMotion;
    const alpha = blinking ? 0.4 + 0.6 * Math.abs(Math.sin(timeMs / 90)) : 1;
    const r = this.cell * 0.36;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.translate(x, y);
    ctx.rotate(this.reducedMotion ? 0 : (timeMs / 900) % (Math.PI * 2));
    if (!this.reducedMotion) {
      ctx.shadowColor = 'rgba(255, 209, 102, 0.8)';
      ctx.shadowBlur = this.cell * 0.7;
    }
    const gradient = ctx.createLinearGradient(-r, -r, r, r);
    gradient.addColorStop(0, COLORS.bonus);
    gradient.addColorStop(1, COLORS.bonusDeep);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    for (let i = 0; i < 8; i += 1) {
      const angle = (Math.PI / 4) * i - Math.PI / 2;
      const radius = i % 2 === 0 ? r : r * 0.44;
      const px = Math.cos(angle) * radius;
      const py = Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.save();
    ctx.translate(x, y);
    ctx.globalAlpha = alpha * (ttlRatio < 0.5 ? 0.9 : 0.4);
    ctx.strokeStyle = ttlRatio < 0.5 ? COLORS.bonusDeep : COLORS.bonus;
    ctx.lineWidth = Math.max(1.2, this.cell * 0.055);
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(0, 0, this.cell * 0.45, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * ttlRatio);
    ctx.stroke();
    ctx.restore();
  }

  /** Позиции сегментов в пикселях с интерполяцией между шагами. */
  #snakePoints(game, alpha) {
    const points = [];
    for (let i = 0; i < game.snake.length; i += 1) {
      const current = game.snake[i];
      const previous = game.prevSnake[i] ?? game.prevSnake[game.prevSnake.length - 1] ?? current;
      const dx = current.x - previous.x;
      const dy = current.y - previous.y;
      // При проходе сквозь край поля интерполяция дала бы «полосу» через всю доску.
      const smooth = Math.abs(dx) <= 1 && Math.abs(dy) <= 1;
      const gx = smooth ? lerp(previous.x, current.x, alpha) : current.x;
      const gy = smooth ? lerp(previous.y, current.y, alpha) : current.y;
      points.push({ x: this.#centerX(gx), y: this.#centerY(gy) });
    }
    return points;
  }

  #drawSnake(game, alpha) {
    const ctx = this.ctx;
    const cell = this.cell;
    const points = this.#snakePoints(game, alpha);
    const count = points.length;
    if (count === 0) return;
    const thickness = cell * 0.74;

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    if (!this.reducedMotion) {
      ctx.shadowColor = COLORS.glow;
      ctx.shadowBlur = cell * 0.9;
      ctx.strokeStyle = COLORS.body;
      ctx.lineWidth = thickness;
      ctx.beginPath();
      ctx.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < count; i += 1) ctx.lineTo(points[i].x, points[i].y);
      ctx.stroke();
      ctx.shadowBlur = 0;
    }

    for (let i = count - 1; i >= 1; i -= 1) {
      const t = count > 2 ? i / (count - 1) : 0;
      ctx.strokeStyle = mixColor(COLORS.body, COLORS.tail, t);
      ctx.lineWidth = thickness * lerp(1, 0.66, t * t);
      ctx.beginPath();
      ctx.moveTo(points[i].x, points[i].y);
      ctx.lineTo(points[i - 1].x, points[i - 1].y);
      ctx.stroke();
    }

    // Голова
    const head = points[0];
    const direction = DIRECTIONS[game.direction] ?? DIRECTIONS.right;
    const headRadius = cell * 0.44;
    ctx.save();
    if (!this.reducedMotion) {
      ctx.shadowColor = COLORS.glow;
      ctx.shadowBlur = cell * 1.1;
    }
    ctx.fillStyle = COLORS.head;
    ctx.beginPath();
    ctx.arc(head.x, head.y, headRadius, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    const side = { x: -direction.y, y: direction.x };
    for (const sign of [1, -1]) {
      const eyeX = head.x + direction.x * headRadius * 0.26 + side.x * headRadius * 0.48 * sign;
      const eyeY = head.y + direction.y * headRadius * 0.26 + side.y * headRadius * 0.48 * sign;
      ctx.fillStyle = '#0a1424';
      ctx.beginPath();
      ctx.arc(eyeX, eyeY, headRadius * 0.25, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.beginPath();
      ctx.arc(eyeX - direction.x * headRadius * 0.08, eyeY - direction.y * headRadius * 0.08, headRadius * 0.09, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  #drawParticles() {
    if (this.particles.length === 0) return;
    const ctx = this.ctx;
    ctx.save();
    for (const particle of this.particles) {
      const progress = particle.life / particle.ttl;
      ctx.globalAlpha = Math.max(0, 1 - progress * progress);
      ctx.fillStyle = particle.color;
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.radius * (1 - progress * 0.6), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  #drawResultTint(x, y, width, height, radius, won) {
    const ctx = this.ctx;
    ctx.save();
    roundRectPath(ctx, x, y, width, height, radius);
    ctx.clip();
    const gradient = ctx.createRadialGradient(
      x + width / 2,
      y + height / 2,
      Math.min(width, height) * 0.25,
      x + width / 2,
      y + height / 2,
      Math.max(width, height) * 0.75,
    );
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(1, won ? 'rgba(255, 209, 102, 0.3)' : 'rgba(220, 38, 38, 0.38)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, width, height);
    ctx.restore();
  }
}
