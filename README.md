# Fractal Explorer 🌌

A Next.js + WebGL playground for exploring 2D complex fractals. It ships with a couple of built-in formulas (the classic Mandelbrot, a feather-like rational map, and a Julia set), but the real fun is in editing the iteration equation and interior color function directly from the UI.

## Highlights

- 🎨 Live-editable iteration & interior color functions with syntax hints.
- 🌀 GPU-accelerated rendering (with CPU fallback) that supports rotation, panning, deep zooming, and custom sensitivity.
- 🌊 Soft escape rendering mode that keeps every orbit running the full iteration budget while blending escape/interior colors with a sigmoid survival weight for differentiable visuals, now GPU-accelerated when using the built-in shader path.
- ✨ Independent spin-color toggles for interior/exterior blends plus an editable exterior color mapper for custom escape palettes.
- 🎯 Dual-variable controls: tweak both `z` and `c` in real time using intuitive keyboard shortcuts.
- 🧭 Preset dropdown to jump between Mandelbrot, Feather, and Julia starting points.

## Keyboard Cheatsheet

```
Arrow ↑/↓     Pan vertically
A / D         Pan horizontally
Arrow ←/→     Rotate counter/clockwise
W / S         Zoom in / out
J / L         Adjust secondary variable (real)
Q / E         Adjust active variable (imag)
U / O         Adjust active variable (real)
I / K         Adjust secondary variable (imag)
, / .         Decrease / increase iterations
[ / ]         Decrease / increase sensitivity
- / =         Increase / decrease low-pass filter
R             Reset current preset to its defaults
```

## Getting Started

```bash
npm install
npm run dev
```

Open http://localhost:3000 and start exploring. Happy zooming!

## Soft Escape Mode

Toggle “Soft escape” in the Render Mode controls to switch from classic escape-time rendering to a differentiable field:

- Every pixel completes the configured number of iterations, so there is no hard bailout step.
- A smooth survival weight (based on a sigmoid of the radius overflow) fades points that drift outside the escape radius instead of switching to 0/1 masks.
- Orbit statistics (length, magnitude sums, etc.) are accumulated with that survival weight, and the final color is a blend of the interior mapper and escape palette using `1 - survival`.
- Tweak the survival sharpness slider (0.05–0.6) to control how quickly the escape palette takes over—lower values yield broader glows, higher ones snap toward classic escape-time looks.

This produces soft gradients that work well for differentiable art workflows or neural texture experiments while keeping the classic mode a click away.
