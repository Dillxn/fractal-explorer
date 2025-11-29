"use client";

import type { ChangeEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  FEATHER_EQUATION_SOURCE,
  INITIAL_MANUAL_VALUES,
  OPS,
  compileEquation,
  compileInterior,
  defaultEquationSource,
  defaultInteriorSource,
  variableLabels,
  variableOrder,
} from "@/lib/fractalMath";
import type { ColorScheme, Complex, VariableKey } from "@/lib/fractalMath";
import type { FractalWorkerResponse } from "@/lib/fractalWorkerTypes";

type ComplexDraft = { re: string; im: string };

const initialCompilation = compileEquation(defaultEquationSource, OPS);
const MIN_SCALE = 1e-12;
const MAX_SCALE = 1e6;
const MIN_ITERATIONS = 1;
const MAX_ITERATIONS = 1000;
const ITERATION_HOTKEY_FACTOR = 1.1;

type FractalPreset = {
  id: string;
  label: string;
  equation: string;
  planeVariable: VariableKey;
  manualValues: Record<VariableKey, Complex>;
  center?: Complex;
  scale?: number;
  activeManualKey?: VariableKey;
};

const FRACTAL_PRESETS: FractalPreset[] = [
  {
    id: "mandelbrot",
    label: "Mandelbrot",
    equation: defaultEquationSource,
    planeVariable: "c",
    manualValues: cloneManualValues(INITIAL_MANUAL_VALUES),
    center: { re: -0.5, im: 0 },
    scale: 3,
    activeManualKey: "z",
  },
  {
    id: "feather",
    label: "Feather Fractal (z^3 / (1 + |z|^2) + c)",
    equation: FEATHER_EQUATION_SOURCE,
    planeVariable: "c",
    manualValues: cloneManualValues(INITIAL_MANUAL_VALUES),
    center: { re: 0, im: 0 },
    scale: 2.5,
    activeManualKey: "z",
  },
  {
    id: "julia",
    label: "Julia (c = -0.8 + 0.156i)",
    equation: defaultEquationSource,
    planeVariable: "z",
    manualValues: {
      z: { re: 0, im: 0 },
      c: { re: -0.8, im: 0.156 },
      exponent: { re: 2, im: 0 },
    },
    center: { re: 0, im: 0 },
    scale: 3,
    activeManualKey: "c",
  },
];

export default function Home() {
  return <FractalExplorer />;
}

function FractalExplorer() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);
  const pressedKeysRef = useRef<Set<string>>(new Set());
  const movementRafRef = useRef<number | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [center, setCenter] = useState<Complex>({ re: -0.5, im: 0 });
  const [scale, setScale] = useState(3);
  const [maxIterations, setMaxIterations] = useState(120);
  const [colorScheme, setColorScheme] = useState<ColorScheme>("classic");
  const [planeVariable, setPlaneVariable] = useState<VariableKey>("c");
  const [manualValues, setManualValues] = useState<Record<VariableKey, Complex>>(() =>
    cloneManualValues(INITIAL_MANUAL_VALUES),
  );
  const [manualDrafts, setManualDrafts] = useState<Record<VariableKey, ComplexDraft>>(() =>
    manualValuesToDrafts(cloneManualValues(INITIAL_MANUAL_VALUES)),
  );
  const manualOptions = useMemo(
    () => variableOrder.filter((key) => key !== planeVariable),
    [planeVariable],
  );
  const [activeManualKey, setActiveManualKey] = useState<VariableKey>(manualOptions[0]);
  const [sensitivity, setSensitivity] = useState(1);
  const [rotation, setRotation] = useState(0);
  const presetSelectRef = useRef<HTMLSelectElement>(null);
  const [equationInput, setEquationInput] = useState(defaultEquationSource);
  const [equationError, setEquationError] = useState<string | null>(initialCompilation.error);
  const [interiorInput, setInteriorInput] = useState(defaultInteriorSource);
  const [interiorError, setInteriorError] = useState<string | null>(null);
  const [isRendering, setIsRendering] = useState(false);
  const [renderTime, setRenderTime] = useState<number | null>(null);
  const [presetId, setPresetId] = useState<string>("mandelbrot");

  const applyPreset = useCallback(
    (nextPresetId: string) => {
      const preset = FRACTAL_PRESETS.find((item) => item.id === nextPresetId);
      if (!preset) {
        return;
      }
      setPresetId(nextPresetId);
      setEquationInput(preset.equation);
      setPlaneVariable(preset.planeVariable);
      setManualValues(cloneManualValues(preset.manualValues));
      setActiveManualKey(preset.activeManualKey ?? (preset.planeVariable === "z" ? "c" : "z"));
      setRotation(0);
      if (preset.center) {
        setCenter(preset.center);
      }
      if (preset.scale) {
        setScale(preset.scale);
      }
    },
    [],
  );

  const resetExplorer = useCallback(() => {
    applyPreset(presetId);
    setMaxIterations(120);
    setInteriorInput(defaultInteriorSource);
    setSensitivity(1);
    setRotation(0);
  }, [applyPreset, presetId]);

  useEffect(() => {
    const selectEl = presetSelectRef.current;
    if (selectEl && document.activeElement === selectEl) {
      selectEl.blur();
    }
  }, [presetId]);

  useEffect(() => {
    if (!manualOptions.includes(activeManualKey)) {
      setActiveManualKey(manualOptions[0]);
    }
  }, [manualOptions, activeManualKey]);

  useEffect(() => {
    setManualDrafts(manualValuesToDrafts(manualValues));
  }, [manualValues]);

  const scaleRef = useRef(scale);
  useEffect(() => {
    scaleRef.current = scale;
  }, [scale]);

  const activeManualKeyRef = useRef(activeManualKey);
  useEffect(() => {
    activeManualKeyRef.current = activeManualKey;
  }, [activeManualKey]);

  const sensitivityRef = useRef(sensitivity);
  useEffect(() => {
    sensitivityRef.current = sensitivity;
  }, [sensitivity]);
  const rotationRef = useRef(rotation);
  useEffect(() => {
    rotationRef.current = rotation;
  }, [rotation]);

  const secondaryManualKey = useMemo(() => {
    if (manualOptions.length < 2) {
      return manualOptions[0] ?? activeManualKey;
    }
    const candidate = manualOptions.find((key) => key !== activeManualKey);
    return candidate ?? manualOptions[0];
  }, [manualOptions, activeManualKey]);
  const secondaryManualKeyRef = useRef(secondaryManualKey);
  useEffect(() => {
    secondaryManualKeyRef.current = secondaryManualKey;
  }, [secondaryManualKey]);

  useEffect(() => {
    const worker = new Worker(new URL("../workers/fractalWorker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;
    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, []);

  const controls = useMemo(
    () => [
      "Arrow keys & A/D: pan the view",
      "W / S: zoom in and out",
      "X: cycle which variable is driven by X/Y",
      "U / O: adjust the real part of the active variable",
      "I / K: adjust the other controllable variable (imag axis)",
      "J / L: adjust the other controllable variable (real axis)",
      "Q / E: adjust its imaginary part",
      "A / D: rotate the viewport (counter / clockwise)",
      "[ / ]: adjust keyboard sensitivity",
      "R: reset explorer to defaults",
      ", / .: decrease / increase max iterations",
    ],
    [],
  );

  const planeLabel = variableLabels[planeVariable];
  const manualActiveLabel = variableLabels[activeManualKey];
  const manualActiveValue = manualValues[activeManualKey];

  useEffect(() => {
    const { fn, error } = compileEquation(equationInput, OPS);
    if (fn) {
      setEquationError(null);
    } else {
      setEquationError(error ?? "Failed to compile equation.");
    }
  }, [equationInput]);

  useEffect(() => {
    const { fn, error } = compileInterior(interiorInput, OPS);
    if (fn) {
      setInteriorError(null);
    } else {
      setInteriorError(error ?? "Failed to compile interior function.");
    }
  }, [interiorInput]);

  useEffect(() => {
    const container = canvasContainerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) {
      return;
    }

    const resize = () => {
      const rect = container.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const width = Math.max(1, Math.floor(rect.width * dpr));
      const height = Math.max(1, Math.floor(rect.height * dpr));
      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
        canvas.style.width = `${rect.width}px`;
        canvas.style.height = `${rect.height}px`;
        setCanvasSize({ width, height });
      }
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    window.addEventListener("resize", resize);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, []);

  useEffect(() => {
    const movementKeys = new Set([
      "arrowup",
      "arrowdown",
      "arrowleft",
      "arrowright",
      "w",
      "s",
      "q",
      "e",
      "u",
      "o",
      "i",
      "k",
      "j",
      "l",
      "a",
      "d",
    ]);
    const pressed = pressedKeysRef.current;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.getAttribute("role") === "textbox")
      ) {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "r") {
        event.preventDefault();
        resetExplorer();
        return;
      }
      if (key === "[") {
        event.preventDefault();
        setSensitivity((prev) => Math.max(0.25, Number((prev * 0.8).toFixed(3))));
        return;
      }
      if (key === "]") {
        event.preventDefault();
        setSensitivity((prev) => Math.min(4, Number((prev * 1.25).toFixed(3))));
        return;
      }
      if (key === ",") {
        event.preventDefault();
        setMaxIterations((prev) =>
          Math.max(MIN_ITERATIONS, Math.round(prev / ITERATION_HOTKEY_FACTOR)),
        );
        return;
      }
      if (key === ".") {
        event.preventDefault();
        setMaxIterations((prev) =>
          Math.min(MAX_ITERATIONS, Math.round(prev * ITERATION_HOTKEY_FACTOR)),
        );
        return;
      }
      if (movementKeys.has(key)) {
        event.preventDefault();
        pressed.add(key);
        return;
      }

      if (key === "x") {
        event.preventDefault();
        setPlaneVariable((prev) => {
          const currentIndex = variableOrder.indexOf(prev);
          const nextIndex = (currentIndex + 1) % variableOrder.length;
          return variableOrder[nextIndex];
        });
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();
      if (movementKeys.has(key)) {
        pressed.delete(key);
      }
    };

    const tick = () => {
      if (pressed.size > 0) {
        const sensitivity = sensitivityRef.current;
        const panStep = scaleRef.current * 0.01 * sensitivity;
        let screenDeltaX = 0;
        let screenDeltaY = 0;
        if (pressed.has("arrowup") && !pressed.has("arrowdown")) {
          screenDeltaY -= panStep;
        }
        if (pressed.has("arrowdown") && !pressed.has("arrowup")) {
          screenDeltaY += panStep;
        }
        const leftActive = pressed.has("arrowleft") || pressed.has("a");
        const rightActive = pressed.has("arrowright") || pressed.has("d");
        if (leftActive && !rightActive) {
          screenDeltaX -= panStep;
        }
        if (rightActive && !leftActive) {
          screenDeltaX += panStep;
        }
        if (screenDeltaX !== 0 || screenDeltaY !== 0) {
          const rotation = rotationRef.current;
          const cosR = Math.cos(rotation);
          const sinR = Math.sin(rotation);
          const deltaRe = screenDeltaX * cosR - screenDeltaY * sinR;
          const deltaIm = screenDeltaX * sinR + screenDeltaY * cosR;
          setCenter((prev) => ({
            re: prev.re + deltaRe,
            im: prev.im + deltaIm,
          }));
        }

        const zoomIn = pressed.has("w") && !pressed.has("s");
        const zoomOut = pressed.has("s") && !pressed.has("w");
        if (zoomIn || zoomOut) {
          setScale((prev) => {
            const zoomDelta = Math.min(0.08, 0.008 * sensitivity);
            const zoomInFactor = Math.max(0.5, 1 - zoomDelta);
            const zoomOutFactor = Math.min(1.5, 1 + zoomDelta);
            return zoomIn
              ? Math.max(MIN_SCALE, prev * zoomInFactor)
              : Math.min(MAX_SCALE, prev * zoomOutFactor);
          });
        }

        const manualStep = 0.01 * sensitivity;
        let manualDeltaRe = 0;
        if (pressed.has("u") && !pressed.has("o")) {
          manualDeltaRe -= manualStep;
        }
        if (pressed.has("o") && !pressed.has("u")) {
          manualDeltaRe += manualStep;
        }

        let manualDeltaIm = 0;
        if (pressed.has("q") && !pressed.has("e")) {
          manualDeltaIm -= manualStep;
        }
        if (pressed.has("e") && !pressed.has("q")) {
          manualDeltaIm += manualStep;
        }

        if (manualDeltaRe !== 0 || manualDeltaIm !== 0) {
          const key = activeManualKeyRef.current;
          setManualValues((prev) => ({
            ...prev,
            [key]: {
              re: prev[key].re + manualDeltaRe,
              im: prev[key].im + manualDeltaIm,
            },
          }));
        }

        const secondaryKey = secondaryManualKeyRef.current;
        if (secondaryKey && secondaryKey !== activeManualKeyRef.current) {
          let secondaryDeltaRe = 0;
          if (pressed.has("j") && !pressed.has("l")) {
            secondaryDeltaRe -= manualStep;
          }
          if (pressed.has("l") && !pressed.has("j")) {
            secondaryDeltaRe += manualStep;
          }

          let secondaryDeltaIm = 0;
          if (pressed.has("i") && !pressed.has("k")) {
            secondaryDeltaIm -= manualStep;
          }
          if (pressed.has("k") && !pressed.has("i")) {
            secondaryDeltaIm += manualStep;
          }

          if (secondaryDeltaRe !== 0 || secondaryDeltaIm !== 0) {
            setManualValues((prev) => ({
              ...prev,
              [secondaryKey]: {
                re: prev[secondaryKey].re + secondaryDeltaRe,
                im: prev[secondaryKey].im + secondaryDeltaIm,
              },
            }));
          }
        }

        const rotationStep = 0.02 * sensitivity;
        let rotationDelta = 0;
        if (pressed.has("a") && !pressed.has("d")) {
          rotationDelta -= rotationStep;
        }
        if (pressed.has("d") && !pressed.has("a")) {
          rotationDelta += rotationStep;
        }
        if (rotationDelta !== 0) {
          setRotation((prev) => prev + rotationDelta);
        }
      }
      movementRafRef.current = window.requestAnimationFrame(tick);
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    movementRafRef.current = window.requestAnimationFrame(tick);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      if (movementRafRef.current !== null) {
        window.cancelAnimationFrame(movementRafRef.current);
        movementRafRef.current = null;
      }
      pressed.clear();
    };
  }, [resetExplorer]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const worker = workerRef.current;
    if (!canvas || !canvasSize.width || !canvasSize.height || !worker) {
      return;
    }
    if (equationError) {
      setIsRendering(false);
      return;
    }
    const context = canvas.getContext("2d");
    if (!context) {
      return;
    }

    requestIdRef.current += 1;
    const requestId = requestIdRef.current;
    setIsRendering(true);
    setRenderTime(null);

    const handleMessage = (event: MessageEvent<FractalWorkerResponse>) => {
      const data = event.data;
      if (data.id !== requestId) {
        return;
      }
      if (data.type === "bitmap") {
        context.drawImage(data.bitmap, 0, 0);
        data.bitmap.close();
        setRenderTime(data.elapsed);
        setIsRendering(false);
        return;
      }
      if (data.type === "chunk") {
        const imageData = new ImageData(
          new Uint8ClampedArray(data.buffer),
          data.width,
          data.rows,
        );
        context.putImageData(imageData, 0, data.startY);
      } else if (data.type === "done") {
        setRenderTime(data.elapsed);
        setIsRendering(false);
      } else if (data.type === "error") {
        console.error("Fractal worker error:", data.message);
        setIsRendering(false);
      }
    };

    worker.addEventListener("message", handleMessage);
    worker.postMessage({
      id: requestId,
      type: "render",
      payload: {
        width: canvasSize.width,
        height: canvasSize.height,
        center,
        scale,
        maxIterations,
        planeVariable,
        manualValues,
        colorScheme,
        equationSource: equationInput,
        interiorSource: interiorInput,
        rotation,
      },
    });

    return () => {
      worker.removeEventListener("message", handleMessage);
    };
  }, [
    canvasSize,
    center,
    scale,
    maxIterations,
    colorScheme,
    planeVariable,
    manualValues,
    equationInput,
    equationError,
    interiorInput,
    interiorError,
    rotation,
  ]);

  const zoomLevel = useMemo(() => (3 / scale).toFixed(2), [scale]);
  const rotationDegrees = useMemo(
    () => ((rotation * 180) / Math.PI).toFixed(1),
    [rotation],
  );

  const handleManualDraftChange =
    (key: VariableKey, field: keyof Complex) => (event: ChangeEvent<HTMLInputElement>) => {
      const { value } = event.target;
      setManualDrafts((prev) => ({
        ...prev,
        [key]: { ...prev[key], [field]: value },
      }));
      const trimmed = value.trim();
      const isIncomplete =
        trimmed === "" ||
        trimmed === "-" ||
        trimmed === "+" ||
        trimmed === "." ||
        trimmed === "-." ||
        trimmed === "+.";
      if (isIncomplete) {
        return;
      }
      const numeric = Number(trimmed);
      if (!Number.isNaN(numeric)) {
        setManualValues((prev) => ({
          ...prev,
          [key]: { ...prev[key], [field]: numeric },
        }));
      }
    };

  return (
    <main className="relative min-h-screen overflow-hidden bg-black text-slate-100">
      <div ref={canvasContainerRef} className="absolute inset-0">
        <canvas ref={canvasRef} className="h-full w-full" />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col">
        <div className="flex justify-end p-4">
          <aside className="pointer-events-auto w-full max-w-xl rounded-2xl border border-white/10 bg-black/70 p-4 text-sm shadow-2xl backdrop-blur">
            <header className="space-y-1">
              <div className="flex items-center justify-between">
                <h1 className="text-lg font-semibold tracking-tight">Fractal Explorer</h1>
                <span className="text-xs uppercase text-slate-400">
                  {isRendering ? "Rendering…" : renderTime ? `${renderTime.toFixed(0)} ms` : "Ready"}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                X/Y currently drive <span className="font-semibold text-slate-200">{planeLabel}</span>.
              </p>
            </header>

            <section className="mt-4 space-y-2">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="preset">
                Preset
              </label>
              <select
                ref={presetSelectRef}
                id="preset"
                value={presetId}
                onChange={(event) => {
                  applyPreset(event.target.value);
                }}
                className="w-full rounded-lg border border-white/10 bg-black/60 px-2 py-2 text-sm"
              >
                {FRACTAL_PRESETS.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label}
                  </option>
                ))}
              </select>
            </section>

            <div className="mt-4 grid gap-4 lg:grid-cols-2">
              <div className="space-y-4">
                <section className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Plane mapping</p>
                  <div className="grid grid-cols-3 gap-2">
                    {variableOrder.map((key) => {
                      const isActive = planeVariable === key;
                      return (
                        <button
                          key={key}
                          type="button"
                          onClick={() => setPlaneVariable(key)}
                          className={`rounded-lg border px-3 py-2 text-xs font-semibold uppercase tracking-wide transition ${
                            isActive
                              ? "border-cyan-400 bg-cyan-400/10 text-white"
                              : "border-white/10 text-slate-300 hover:border-white/30"
                          }`}
                        >
                          X/Y → {key.toUpperCase()}
                        </button>
                      );
                    })}
                  </div>
                  <p className="text-xs text-slate-500">
                    Center sample: ({center.re.toFixed(3)}, {center.im.toFixed(3)}i)
                  </p>
                </section>

                <section className="space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    Adjustable variables (U/O + Q/E = selected · J/L + I/K = other)
                  </p>
                  {manualOptions.map((key) => {
                    const isActive = key === activeManualKey;
                    return (
                  <div
                    key={key}
                    className={`rounded-xl border border-white/10 p-3 transition ${
                      isActive ? "bg-cyan-400/5" : ""
                    }`}
                    role="button"
                    tabIndex={0}
                    onClick={() => setActiveManualKey(key)}
                    onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            setActiveManualKey(key);
                          }
                        }}
                      >
                        <div className="flex items-center justify-between text-xs uppercase text-slate-300">
                          <span>{variableLabels[key]}</span>
                          <span className="text-[10px] text-slate-500">
                            {isActive ? "U/O & Q/E" : "J/L & I/K"}
                          </span>
                        </div>
                        <div className="mt-2 grid grid-cols-2 gap-2">
                          <label className="text-xs text-slate-400">
                            <span>Real</span>
                            <input
                              inputMode="decimal"
                              value={manualDrafts[key].re}
                              onChange={handleManualDraftChange(key, "re")}
                              className="mt-1 w-full rounded border border-white/10 bg-black/60 px-2 py-1 text-sm text-white outline-none focus:border-cyan-400"
                            />
                          </label>
                          <label className="text-xs text-slate-400">
                            <span>Imag</span>
                            <input
                              inputMode="decimal"
                              value={manualDrafts[key].im}
                              onChange={handleManualDraftChange(key, "im")}
                              className="mt-1 w-full rounded border border-white/10 bg-black/60 px-2 py-1 text-sm text-white outline-none focus:border-cyan-400"
                            />
                          </label>
                        </div>
                      </div>
                    );
                  })}
                </section>
              </div>

              <div className="space-y-4">
                <section className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="equation">
                    Iteration equation
                  </label>
                  <textarea
                    id="equation"
                    spellCheck={false}
                    value={equationInput}
                    onChange={(event) => setEquationInput(event.target.value)}
                    className="h-36 w-full rounded-xl border border-white/10 bg-black/60 p-3 font-mono text-xs text-slate-100 outline-none focus:border-cyan-400"
                  />
                  {equationError && <p className="text-xs text-red-300">Equation error: {equationError}</p>}
                  <p className="text-xs text-slate-400">
                    You receive <code>z</code>, <code>c</code>, <code>exponent</code>, and <code>ops</code>. Return a
                    complex number via <code>ops.complex</code>. Helpers include <code>ops.pow</code>, <code>ops.exp</code>,
                    <code>ops.log</code>, and more.
                  </p>
                </section>

                <section className="space-y-2">
                  <label className="text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="interior">
                    Interior color mapper
                  </label>
                  <textarea
                    id="interior"
                    spellCheck={false}
                    value={interiorInput}
                    onChange={(event) => setInteriorInput(event.target.value)}
                    className="h-32 w-full rounded-xl border border-white/10 bg-black/60 p-3 font-mono text-xs text-slate-100 outline-none focus:border-cyan-400"
                  />
                  {interiorError && <p className="text-xs text-red-300">Interior error: {interiorError}</p>}
                  <p className="text-xs text-slate-400">
                    Runs when a point never escapes. You receive <code>orbit</code> stats, <code>ops</code>, and
                    <code>helpers</code>. Return <code>{"{ r, g, b }"}</code> where colors are 0-255. Helpers include
                    <code>helpers.hslToRgb</code>.
                  </p>
                </section>
              </div>
            </div>
            <section className="mt-4 grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="iterations">
                  Iterations {maxIterations}
                </label>
                <input
                  id="iterations"
                  type="range"
                  min={MIN_ITERATIONS}
                  max={MAX_ITERATIONS}
                  step={1}
                  value={maxIterations}
                  onChange={(event) =>
                    setMaxIterations(
                      Math.max(
                        MIN_ITERATIONS,
                        Math.min(MAX_ITERATIONS, Number(event.target.value)),
                      ),
                    )
                  }
                  className="mt-1 w-full accent-cyan-400"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="scheme">
                  Color scheme
                </label>
                <select
                  id="scheme"
                  value={colorScheme}
                  onChange={(event) => setColorScheme(event.target.value as ColorScheme)}
                  className="mt-1 w-full rounded-lg border border-white/10 bg-black/60 px-2 py-2 text-sm"
                >
                  <option value="classic">Classic blues</option>
                  <option value="fire">Fire</option>
                  <option value="ice">Ice</option>
                </select>
              </div>
            </section>

            <section className="mt-4 space-y-1">
              <label className="text-xs font-semibold uppercase tracking-wide text-slate-400" htmlFor="sensitivity">
                Keyboard sensitivity ×{sensitivity.toFixed(2)}
              </label>
              <input
                id="sensitivity"
                type="range"
                min={0.25}
                max={4}
                step={0.01}
                value={sensitivity}
                onChange={(event) => setSensitivity(Number(event.target.value))}
                className="w-full accent-cyan-400"
              />
              <p className="text-xs text-slate-500">Tap [ / ] for quick tweaks.</p>
            </section>

            <section className="mt-4">
              <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-400">Controls</h2>
              <ul className="mt-2 space-y-1 text-xs text-slate-400">
                {controls.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </section>
          </aside>
        </div>
      </div>

      <div className="pointer-events-none absolute left-4 bottom-4 flex flex-wrap gap-4 text-xs uppercase tracking-wide text-white/70">
        <span>Zoom {zoomLevel}×</span>
        <span>
          Center ({center.re.toFixed(3)}, {center.im.toFixed(3)}i)
        </span>
        <span>X/Y → {planeLabel}</span>
        <span>
          Keyboard → {manualActiveLabel} ({manualActiveValue.re.toFixed(3)} + {manualActiveValue.im.toFixed(3)}i)
        </span>
        <span>Sensitivity ×{sensitivity.toFixed(2)}</span>
        <span>Rotation {rotationDegrees}°</span>
      </div>
    </main>
  );
}

function cloneManualValues(values: Record<VariableKey, Complex>): Record<VariableKey, Complex> {
  return {
    z: { ...values.z },
    c: { ...values.c },
    exponent: { ...values.exponent },
  };
}

function manualValuesToDrafts(values: Record<VariableKey, Complex>): Record<VariableKey, ComplexDraft> {
  return {
    z: { re: formatManualNumber(values.z.re), im: formatManualNumber(values.z.im) },
    c: { re: formatManualNumber(values.c.re), im: formatManualNumber(values.c.im) },
    exponent: {
      re: formatManualNumber(values.exponent.re),
      im: formatManualNumber(values.exponent.im),
    },
  };
}

function formatManualNumber(value: number) {
  if (!Number.isFinite(value)) {
    return "0";
  }
  const normalized = Object.is(value, -0) ? 0 : value;
  return `${normalized}`;
}
