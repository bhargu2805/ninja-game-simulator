/*
  Ninja Game Simulator
  - Sprite-based animations (frame sequences)
  - Input handling (keyboard + UI buttons)
  - Event-driven state management (small event bus + finite state machine)
  - Performance: requestAnimationFrame + fixed-timestep scheduler
  - Performance: image caching + minimal canvas clears + DPR-aware resizing
*/

// -----------------------------
// Tiny event bus (decouples input/UI from the game state)
// -----------------------------
class EventBus {
  constructor() {
    /** @type {Map<string, Set<Function>>} */
    this.listeners = new Map();
  }

  on(eventName, handler) {
    if (!this.listeners.has(eventName)) this.listeners.set(eventName, new Set());
    this.listeners.get(eventName).add(handler);
    return () => this.off(eventName, handler);
  }

  off(eventName, handler) {
    const set = this.listeners.get(eventName);
    if (!set) return;
    set.delete(handler);
  }

  emit(eventName, payload) {
    const set = this.listeners.get(eventName);
    if (!set) return;
    for (const handler of set) handler(payload);
  }
}

// -----------------------------
// Asset loader with caching + progress reporting
// -----------------------------
class AssetLoader {
  constructor({ basePath = "images" } = {}) {
    this.basePath = basePath;
    /** @type {Map<string, HTMLImageElement>} */
    this.cache = new Map();
  }

  /**
   * @param {string} url
   * @returns {Promise<HTMLImageElement>}
   */
  loadImage(url) {
    if (this.cache.has(url)) return Promise.resolve(this.cache.get(url));

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = "async";
      img.loading = "eager";
      img.onload = () => {
        this.cache.set(url, img);
        resolve(img);
      };
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      img.src = url;
    });
  }

  /**
   * Loads a set of animations with frame sequences.
   * @param {Record<string, number[]>} framesByAnimation
   * @param {(done: number, total: number) => void} onProgress
   * @returns {Promise<Record<string, HTMLImageElement[]>>}
   */
  async loadAnimations(framesByAnimation, onProgress) {
    const animations = Object.keys(framesByAnimation);
    const total = animations.reduce((sum, a) => sum + framesByAnimation[a].length, 0);
    let done = 0;

    /** @type {Record<string, HTMLImageElement[]>} */
    const result = {};

    for (const animation of animations) {
      const frames = framesByAnimation[animation];
      const images = new Array(frames.length);

      // Load sequentially to keep progress predictable and reduce bandwidth spikes.
      // (You can switch to Promise.all for max throughput if you want.)
      for (let i = 0; i < frames.length; i++) {
        const frameNumber = frames[i];
        const url = `${this.basePath}/${animation}/${frameNumber}.png`;
        images[i] = await this.loadImage(url);
        done += 1;
        onProgress?.(done, total);
      }

      result[animation] = images;
    }

    return result;
  }
}

// -----------------------------
// Animation controller (supports looping & one-shots)
// -----------------------------
class AnimationPlayer {
  /**
   * @param {Record<string, HTMLImageElement[]>} animations
   * @param {Record<string, number>} frameDurationMsByAnim
   */
  constructor(animations, frameDurationMsByAnim) {
    this.animations = animations;
    this.frameDurations = frameDurationMsByAnim;

    this.current = "idle";
    this.loop = true;
    this.frameIndex = 0;
    this.accumulator = 0;
    this.finished = false;
  }

  /**
   * @param {string} animation
   * @param {{ loop?: boolean }}
   */
  play(animation, { loop = false } = {}) {
    if (!this.animations[animation]) return;
    if (this.current === animation && this.loop === loop && !this.finished) return;

    this.current = animation;
    this.loop = loop;
    this.frameIndex = 0;
    this.accumulator = 0;
    this.finished = false;
  }

  /**
   * @param {number} dtMs
   */
  update(dtMs) {
    const frames = this.animations[this.current];
    if (!frames || frames.length === 0) return;

    const frameDuration = this.frameDurations[this.current] ?? 100;
    this.accumulator += dtMs;

    while (this.accumulator >= frameDuration) {
      this.accumulator -= frameDuration;
      this.frameIndex += 1;

      if (this.frameIndex >= frames.length) {
        if (this.loop) {
          this.frameIndex = 0;
        } else {
          this.frameIndex = frames.length - 1;
          this.finished = true;
          break;
        }
      }
    }
  }

  getFrame() {
    const frames = this.animations[this.current];
    if (!frames || frames.length === 0) return null;
    return frames[this.frameIndex];
  }
}

// -----------------------------
// Simple action state machine
// - idle loops
// - other actions are one-shots
// - movement adjusts x position while animating
// -----------------------------
class PlayerController {
  constructor({ bus, animationPlayer }) {
    this.bus = bus;
    this.anim = animationPlayer;

    this.state = "idle";
    this.queue = [];

    this.x = 0;
    this.y = 0;
    this.speed = 140; // px/sec

    this._setupBusHandlers();
  }

  _setupBusHandlers() {
    this.bus.on("action", (action) => {
      if (!action) return;

      // Cap queue to avoid unbounded growth.
      if (this.queue.length > 12) this.queue.shift();
      this.queue.push(action);
      this.bus.emit("queueChanged", this.queue.slice());
    });

    this.bus.on("reset", () => {
      this.queue.length = 0;
      this.x = 0;
      this.y = 0;
      this._enterState("idle");
      this.bus.emit("queueChanged", this.queue.slice());
    });
  }

  _enterState(state) {
    this.state = state;
    this.bus.emit("stateChanged", this.state);

    if (state === "idle") {
      this.anim.play("idle", { loop: true });
      return;
    }

    // one-shot actions
    this.anim.play(state, { loop: false });
  }

  _consumeNextAction() {
    const next = this.queue.shift();
    this.bus.emit("queueChanged", this.queue.slice());
    return next;
  }

  /**
   * @param {number} dtMs
   * @param {{ worldWidth: number, worldHeight: number }} world
   */
  update(dtMs, world) {
    // If a one-shot animation finished, return to idle (or next queued action)
    if (this.state !== "idle" && this.anim.finished) {
      const next = this._consumeNextAction();
      this._enterState(next ?? "idle");
    }

    // If idle and something is queued, start it.
    if (this.state === "idle" && this.queue.length > 0) {
      const next = this._consumeNextAction();
      this._enterState(next);
    }

    // Movement while in forward/backward state.
    const dtSec = dtMs / 1000;
    if (this.state === "forward") this.x += this.speed * dtSec;
    if (this.state === "backward") this.x -= this.speed * dtSec;

    // Clamp to world bounds.
    const pad = 40; // keep sprite away from edges
    this.x = Math.max(-world.worldWidth / 2 + pad, Math.min(world.worldWidth / 2 - pad, this.x));
    this.y = Math.max(-world.worldHeight / 2 + pad, Math.min(world.worldHeight / 2 - pad, this.y));

    this.anim.update(dtMs);
  }
}

// -----------------------------
// Input manager (keyboard + button clicks)
// -----------------------------
class InputManager {
  constructor({ bus }) {
    this.bus = bus;
    this._setupKeyboard();
    this._setupButtons();
  }

  _setupButtons() {
    const map = {
      kick: "kick",
      punch: "punch",
      forward: "forward",
      backward: "backward",
      block: "block",
    };

    Object.keys(map).forEach((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      el.addEventListener("click", () => this.bus.emit("action", map[id]));
    });

    const reset = document.getElementById("reset");
    reset?.addEventListener("click", () => this.bus.emit("reset"));
  }

  _setupKeyboard() {
    // Use keydown for responsiveness (keyup can feel laggy for combos).
    document.addEventListener("keydown", (event) => {
      // Avoid browser scrolling with arrow keys/space.
      if (["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", " "].includes(event.key)) {
        event.preventDefault();
      }

      switch (event.key) {
        case "ArrowUp":
          this.bus.emit("action", "kick");
          break;
        case "ArrowDown":
          this.bus.emit("action", "punch");
          break;
        case "ArrowRight":
          this.bus.emit("action", "forward");
          break;
        case "ArrowLeft":
          this.bus.emit("action", "backward");
          break;
        case " ":
          this.bus.emit("action", "block");
          break;
        default:
          break;
      }
    });
  }
}

// -----------------------------
// Renderer (DPR-aware, responsive)
// -----------------------------
class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: true, desynchronized: true });

    this.logicalSize = 500; // logical world size (square)

    // For minimal garbage in render loop.
    this._lastW = 0;
    this._lastH = 0;

    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize() {
    // canvas CSS size is controlled by CSS; here we match its actual rendered size
    const rect = this.canvas.getBoundingClientRect();
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

    const width = Math.max(1, Math.round(rect.width * dpr));
    const height = Math.max(1, Math.round(rect.height * dpr));

    if (width === this._lastW && height === this._lastH) return;
    this._lastW = width;
    this._lastH = height;

    this.canvas.width = width;
    this.canvas.height = height;

    // Reset transform then scale to map logical coords -> pixels.
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    const scale = Math.min(width, height) / this.logicalSize;
    this.ctx.scale(scale, scale);
  }

  /**
   * @param {{ frame: HTMLImageElement | null, x: number, y: number }} sprite
   */
  draw(sprite) {
    const ctx = this.ctx;
    const size = this.logicalSize;

    // Clear logical canvas.
    ctx.clearRect(0, 0, size, size);

    if (!sprite.frame) return;

    // Draw sprite centered with slight offset.
    const w = size;
    const h = size;
    const centerX = size / 2 + sprite.x;
    const centerY = size / 2 + sprite.y;

    ctx.drawImage(sprite.frame, centerX - w / 2, centerY - h / 2, w, h);
  }
}

// -----------------------------
// Main game loop (requestAnimationFrame + fixed timestep)
// -----------------------------
class Game {
  constructor({ canvas, animations }) {
    this.bus = new EventBus();
    this.input = new InputManager({ bus: this.bus });
    this.renderer = new Renderer(canvas);

    // Frame pacing: fixed update (60Hz) + rAF rendering.
    this.fixedDt = 1000 / 60;
    this.accumulator = 0;
    this.lastTs = performance.now();

    this.fps = 0;
    this._fpsFrames = 0;
    this._fpsTime = 0;

    const frameDurations = {
      idle: 120,
      kick: 90,
      punch: 90,
      forward: 80,
      backward: 80,
      block: 100,
    };

    this.anim = new AnimationPlayer(animations, frameDurations);
    this.player = new PlayerController({ bus: this.bus, animationPlayer: this.anim });
    this.player._enterState("idle");

    this._setupHud();
  }

  _setupHud() {
    const hudState = document.getElementById("hudState");
    const hudQueue = document.getElementById("hudQueue");
    const hudFps = document.getElementById("hudFps");

    const renderQueue = (q) => {
      if (!hudQueue) return;
      hudQueue.textContent = q.length ? q.join(" → ") : "(empty)";
    };

    this.bus.on("stateChanged", (s) => {
      if (hudState) hudState.textContent = s;
    });

    this.bus.on("queueChanged", (q) => renderQueue(q));

    // Initial values.
    if (hudState) hudState.textContent = this.player.state;
    renderQueue(this.player.queue);

    // Update FPS display from the loop.
    this._setFps = (fps) => {
      if (hudFps) hudFps.textContent = `${fps.toFixed(0)}`;
    };
  }

  start() {
    requestAnimationFrame((ts) => this._tick(ts));
  }

  _tick(ts) {
    const dt = ts - this.lastTs;
    this.lastTs = ts;

    // Prevent spiral of death when tab was inactive.
    const clampedDt = Math.min(100, Math.max(0, dt));
    this.accumulator += clampedDt;

    // Fixed updates.
    while (this.accumulator >= this.fixedDt) {
      this.player.update(this.fixedDt, { worldWidth: this.renderer.logicalSize, worldHeight: this.renderer.logicalSize });
      this.accumulator -= this.fixedDt;
    }

    // Render.
    this.renderer.resize();
    this.renderer.draw({
      frame: this.anim.getFrame(),
      x: this.player.x,
      y: this.player.y,
    });

    // FPS (simple moving 1s window)
    this._fpsFrames += 1;
    this._fpsTime += clampedDt;
    if (this._fpsTime >= 1000) {
      this.fps = (this._fpsFrames * 1000) / this._fpsTime;
      this._fpsFrames = 0;
      this._fpsTime = 0;
      this._setFps?.(this.fps);
    }

    requestAnimationFrame((t) => this._tick(t));
  }
}

// -----------------------------
// Boot
// -----------------------------
(async function boot() {
  const canvas = document.getElementById("canvas");
  const loading = document.getElementById("loading");
  const loadingProgress = document.getElementById("loadingProgress");

  /** @type {Record<string, number[]>} */
  const frames = {
    idle: [1, 2, 3, 4, 5, 6, 7, 8],
    kick: [1, 2, 3, 4, 5, 6, 7],
    punch: [1, 2, 3, 4, 5, 6, 7],
    backward: [1, 2, 3, 4, 5, 6],
    forward: [1, 2, 3, 4, 5, 6],
    block: [1, 2, 3, 4, 5, 6],
  };

  try {
    const loader = new AssetLoader({ basePath: "images" });
    const animations = await loader.loadAnimations(frames, (done, total) => {
      const pct = Math.round((done / total) * 100);
      if (loadingProgress) loadingProgress.textContent = `${pct}%`;
    });

    if (loading) loading.style.display = "none";

    const game = new Game({ canvas, animations });
    game.start();
  } catch (e) {
    console.error(e);
    if (loadingProgress) loadingProgress.textContent = "Failed to load assets. Check console.";
  }
})();
