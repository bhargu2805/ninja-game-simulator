# Ninja Game Simulator (HTML5 Canvas)

An interactive 2D, sprite‑animated ninja game built with **HTML5 Canvas + JavaScript**.

## What this project demonstrates

### Gameplay / UI
- **Sprite-based animations** using pre-rendered frame sequences (idle, kick, punch, forward, backward, block).
- **Input handling** via keyboard + on-screen buttons.
- **Event-driven state management** using a small event bus + a finite state machine (idle loops; actions are one-shots; actions can be queued).
- **Responsive UI behavior**: the canvas scales to screen size, supports high‑DPI displays, and the layout adapts for mobile.

### Performance / Optimization
- Replaced timer-based animation loops (`setTimeout`) with a **requestAnimationFrame render loop**.
- Uses a **fixed-timestep scheduler** (60Hz updates) for smoother frame pacing and consistent animation timing.
- **Asset caching**: images are loaded once and reused (in-memory cache) to avoid repeated decoding.

## Controls

- **↑** Kick
- **↓** Punch
- **→** Forward
- **←** Backward
- **Space** Block
- **Reset** button clears the queue and recenters the character.

## Run the project (2 easy options)

### Option A — Open directly (quickest)
1. Download / unzip the project.
2. Open `index.html` in Chrome/Edge.

> Tip: If your browser blocks local file access in some cases, use Option B.

### Option B — Run with a local web server (recommended)

#### Using VS Code (Live Server)
1. Open the folder in **VS Code**.
2. Install the extension **Live Server**.
3. Right-click `index.html` → **Open with Live Server**.

#### Using Python
1. Open a terminal in the project folder.
2. Run:
   - **Windows**: `py -m http.server 8000`
   - **macOS/Linux**: `python3 -m http.server 8000`
3. Visit: `http://localhost:8000`

## Project structure

```text
game-1-main/
  index.html
  main.css
  main.js
  images/
    background.jpg
    idle/1.png ...
    kick/1.png ...
    punch/1.png ...
    forward/...
    backward/...
    block/...
```

## Notes
- This project intentionally keeps the code **framework-free** for clarity (vanilla JS).
- The animation frames are stored as individual PNG files (not a sprite sheet).
