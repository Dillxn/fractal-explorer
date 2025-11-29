# Fractal Explorer 🌌

A Next.js + WebGL playground for exploring 2D complex fractals. It ships with a couple of built-in formulas (the classic Mandelbrot, a feather-like rational map, and a Julia set), but the real fun is in editing the iteration equation and interior color function directly from the UI.

## Highlights

- 🎨 Live-editable iteration & interior color functions with syntax hints.
- 🌀 GPU-accelerated rendering (with CPU fallback) that supports rotation, panning, deep zooming, and custom sensitivity.
- 🎯 Dual-variable controls: tweak both `z` and `c` in real time using intuitive keyboard shortcuts.
- 🧭 Preset dropdown to jump between Mandelbrot, Feather, and Julia starting points.

## Keyboard Cheatsheet

```
Arrows / A-D  Pan the viewport
W / S         Zoom in / out
J / L         Adjust active variable (real)
Q / E         Adjust active variable (imag)
U / O         Adjust secondary variable (real)
I / K         Adjust secondary variable (imag)
, / .         Decrease / increase iterations
[ / ]         Decrease / increase sensitivity
R             Reset current preset to its defaults
```

## Getting Started

```bash
npm install
npm run dev
```

Open http://localhost:3000 and start exploring. Happy zooming!
