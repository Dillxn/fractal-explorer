/// <reference lib="webworker" />

import {
  OPS,
  colorizers,
  compileEquation,
  compileInterior,
  FEATHER_EQUATION_SOURCE,
  defaultEquationSource,
  defaultInteriorSource,
  fallbackEvaluator,
  INTERIOR_HELPERS,
  type OrbitStats,
  type ColorScheme,
  type Complex,
  type VariableKey,
} from "@/lib/fractalMath";
import type {
  FractalRenderPayload,
  FractalWorkerRequest,
  FractalWorkerResponse,
} from "@/lib/fractalWorkerTypes";

const ctx: DedicatedWorkerGlobalScope = self as DedicatedWorkerGlobalScope;

const DEFAULT_EQUATION_NORMALIZED = normalizeEquation(defaultEquationSource);
const FEATHER_EQUATION_NORMALIZED = normalizeEquation(FEATHER_EQUATION_SOURCE);
const DEFAULT_INTERIOR_NORMALIZED = normalizeInterior(defaultInteriorSource);
const MAX_SHADER_ITERATIONS = 4096;

type GLState = {
  canvas: OffscreenCanvas;
  gl: WebGLRenderingContext;
  program: WebGLProgram;
  buffer: WebGLBuffer;
  attribLocation: number;
  uniforms: {
    resolution: WebGLUniformLocation | null;
    center: WebGLUniformLocation | null;
    scale: WebGLUniformLocation | null;
    maxIterations: WebGLUniformLocation | null;
    planeVariable: WebGLUniformLocation | null;
    manualZ: WebGLUniformLocation | null;
    manualC: WebGLUniformLocation | null;
    manualExponent: WebGLUniformLocation | null;
    colorScheme: WebGLUniformLocation | null;
    rotation: WebGLUniformLocation | null;
    equationMode: WebGLUniformLocation | null;
  };
};

let activeRequestId = 0;
let glState: GLState | null = null;

ctx.onmessage = (event: MessageEvent<FractalWorkerRequest>) => {
  const { data } = event;
  if (data.type !== "render") {
    return;
  }

  activeRequestId = data.id;
  const payload = data.payload;
  const normalizedEquation = normalizeEquation(payload.equationSource);
  const normalizedInterior = normalizeInterior(payload.interiorSource);
  const equationMode = getEquationMode(normalizedEquation);

  const useWebGL =
    typeof OffscreenCanvas !== "undefined" &&
    equationMode !== null &&
    normalizedInterior === DEFAULT_INTERIOR_NORMALIZED &&
    payload.maxIterations <= MAX_SHADER_ITERATIONS;

  if (useWebGL) {
    try {
      renderWithWebGL(payload, data.id, equationMode);
      return;
    } catch (error) {
      console.error("WebGL render failed, falling back to CPU:", error);
    }
  }

  renderWithCpu(payload, data.id);
};

function renderWithWebGL(payload: FractalRenderPayload, id: number, equationMode: number) {
  const start = performance.now();
  const state = ensureGlState(payload.width, payload.height);
  const { gl, program, uniforms } = state;

  gl.viewport(0, 0, payload.width, payload.height);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, state.buffer);
  gl.vertexAttribPointer(state.attribLocation, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(state.attribLocation);

  const unit = payload.scale / payload.width;
  const planeIndex = planeVariableToIndex(payload.planeVariable);
  const colorIndex = colorSchemeToIndex(payload.colorScheme);
  const manualZ = payload.manualValues.z;
  const manualC = payload.manualValues.c;
  const manualExponent = payload.manualValues.exponent;
  const rotation = payload.rotation;

  if (uniforms.resolution) {
    gl.uniform2f(uniforms.resolution, payload.width, payload.height);
  }
  if (uniforms.center) {
    gl.uniform2f(uniforms.center, payload.center.re, payload.center.im);
  }
  if (uniforms.scale) {
    gl.uniform1f(uniforms.scale, unit);
  }
  if (uniforms.maxIterations) {
    gl.uniform1i(uniforms.maxIterations, payload.maxIterations);
  }
  if (uniforms.planeVariable) {
    gl.uniform1i(uniforms.planeVariable, planeIndex);
  }
  if (uniforms.manualZ) {
    gl.uniform2f(uniforms.manualZ, manualZ.re, manualZ.im);
  }
  if (uniforms.manualC) {
    gl.uniform2f(uniforms.manualC, manualC.re, manualC.im);
  }
  if (uniforms.manualExponent) {
    gl.uniform2f(uniforms.manualExponent, manualExponent.re, manualExponent.im);
  }
  if (uniforms.colorScheme) {
    gl.uniform1i(uniforms.colorScheme, colorIndex);
  }
  if (uniforms.rotation) {
    gl.uniform1f(uniforms.rotation, rotation);
  }
  if (uniforms.equationMode) {
    gl.uniform1i(uniforms.equationMode, equationMode);
  }

  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  const bitmap = state.canvas.transferToImageBitmap();
  if (id !== activeRequestId) {
    bitmap.close();
    return;
  }
  const elapsed = performance.now() - start;
  const response: FractalWorkerResponse = {
    id,
    type: "bitmap",
    bitmap,
    elapsed,
  };
  ctx.postMessage(response, [bitmap]);
}

function renderWithCpu(payload: FractalRenderPayload, id: number) {
  const { width, height, center, scale, maxIterations, planeVariable, manualValues, colorScheme } =
    payload;
  const { fn } = compileEquation(payload.equationSource, OPS);
  const evaluator = fn ?? fallbackEvaluator;
  const { fn: interiorFn } = compileInterior(payload.interiorSource, OPS);

  const rowsPerChunk = Math.max(2, Math.floor(height / 180));
  const escapeRadius = 16;
  const unit = scale / width;
  const manualZ = manualValues.z;
  const manualC = manualValues.c;
  const manualExponent = manualValues.exponent;
  const currentPlane = planeVariable;
  const colorizer = colorizers[colorScheme as ColorScheme] ?? colorizers.classic;
  const startTime = performance.now();
  const rotation = payload.rotation;
  const cosRotation = Math.cos(rotation);
  const sinRotation = Math.sin(rotation);

  for (let startY = 0; startY < height; startY += rowsPerChunk) {
    if (id !== activeRequestId) {
      return;
    }

    const rows = Math.min(rowsPerChunk, height - startY);
    const buffer = new Uint8ClampedArray(width * rows * 4);

    for (let y = 0; y < rows; y += 1) {
      const actualY = startY + y;
      for (let x = 0; x < width; x += 1) {
        const dx = (x - width / 2) * unit;
        const dy = (actualY - height / 2) * unit;
        const rotatedReal = dx * cosRotation - dy * sinRotation;
        const rotatedImag = dx * sinRotation + dy * cosRotation;
        const planeValue: Complex = { re: center.re + rotatedReal, im: center.im + rotatedImag };
        const cValue = currentPlane === "c" ? planeValue : manualC;
        const exponentValue = currentPlane === "exponent" ? planeValue : manualExponent;
        const startZValue = currentPlane === "z" ? planeValue : manualZ;
        let z: Complex = { re: startZValue.re, im: startZValue.im };
        let orbitLength = 0;
        let orbitMagnitudeSum = 0;
        let orbitAngleSum = 0;
        let orbitMaxMagnitude = 0;
        let iter = 0;

        for (; iter < maxIterations; iter += 1) {
          z = evaluator(z, cValue, exponentValue);
          const magnitude = Math.hypot(z.re, z.im);
          orbitMagnitudeSum += magnitude;
          orbitAngleSum += Math.atan2(z.im, z.re);
          orbitMaxMagnitude = Math.max(orbitMaxMagnitude, magnitude);
          orbitLength += 1;
          if (!Number.isFinite(z.re) || !Number.isFinite(z.im)) {
            iter = maxIterations;
            break;
          }
          if (z.re * z.re + z.im * z.im > escapeRadius) {
            break;
          }
        }

        const pixelIndex = (y * width + x) * 4;
        if (iter === maxIterations && interiorFn) {
          const orbit: OrbitStats = {
            length: orbitLength,
            magnitudeSum: orbitMagnitudeSum,
            angleSum: orbitAngleSum,
            maxMagnitude: orbitMaxMagnitude,
            last: z,
          };
          const color = interiorFn(orbit, OPS, INTERIOR_HELPERS);
          buffer[pixelIndex] = color.r;
          buffer[pixelIndex + 1] = color.g;
          buffer[pixelIndex + 2] = color.b;
          buffer[pixelIndex + 3] = 255;
        } else {
          const shade = iter / maxIterations;
          const [r, g, b] = colorizer(shade);
          buffer[pixelIndex] = r;
          buffer[pixelIndex + 1] = g;
          buffer[pixelIndex + 2] = b;
          buffer[pixelIndex + 3] = 255;
        }
      }
    }

    const response: FractalWorkerResponse = {
      id,
      type: "chunk",
      startY,
      rows,
      width,
      buffer: buffer.buffer,
    };
    ctx.postMessage(response, [buffer.buffer]);
  }

  const doneResponse: FractalWorkerResponse = {
    id,
    type: "done",
    elapsed: performance.now() - startTime,
  };
  ctx.postMessage(doneResponse);
}

function ensureGlState(width: number, height: number): GLState {
  if (glState) {
    glState.canvas.width = width;
    glState.canvas.height = height;
    return glState;
  }

  const canvas = new OffscreenCanvas(width, height);
  const gl = canvas.getContext("webgl", {
    preserveDrawingBuffer: false,
    premultipliedAlpha: false,
  });
  if (!gl) {
    throw new Error("Failed to create WebGL context");
  }
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);
  gl.clearColor(0, 0, 0, 1);

  const vertexShaderSource = `
    attribute vec2 aPosition;
    void main() {
      gl_Position = vec4(aPosition, 0.0, 1.0);
    }
  `;

  const fragmentShaderSource = `
    precision highp float;

    const float ESCAPE_RADIUS = 16.0;
    const float EPSILON = 1e-9;
    const int MAX_ITER = ${MAX_SHADER_ITERATIONS};

    uniform vec2 uResolution;
    uniform vec2 uCenter;
    uniform float uScale;
    uniform int uMaxIterations;
    uniform int uPlaneVariable;
    uniform vec2 uManualZ;
    uniform vec2 uManualC;
    uniform vec2 uManualExponent;
    uniform int uColorScheme;
    uniform float uRotation;
    uniform int uEquationMode;

    vec2 complexMul(vec2 a, vec2 b) {
      return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x);
    }

    vec2 complexAdd(vec2 a, vec2 b) {
      return vec2(a.x + b.x, a.y + b.y);
    }

    vec2 complexPow(vec2 z, vec2 exponent) {
      float r = length(z);
      if (r == 0.0) {
        return vec2(0.0);
      }
      float theta = atan(z.y, z.x);
      float logR = log(max(r, 1e-12));
      if (abs(exponent.y) < EPSILON) {
        float angle = theta * exponent.x;
        float magnitude = pow(r, exponent.x);
        return vec2(magnitude * cos(angle), magnitude * sin(angle));
      }
      float magnitude = exp(exponent.x * logR - exponent.y * theta);
      float angle = exponent.y * logR + exponent.x * theta;
      return vec2(magnitude * cos(angle), magnitude * sin(angle));
    }

    vec3 hsl2rgb(float h, float s, float l) {
      h = mod(h, 360.0);
      float c = (1.0 - abs(2.0 * l - 1.0)) * s;
      float hp = h / 60.0;
      float x = c * (1.0 - abs(mod(hp, 2.0) - 1.0));
      vec3 rgb;
      if (0.0 <= hp && hp < 1.0) {
        rgb = vec3(c, x, 0.0);
      } else if (1.0 <= hp && hp < 2.0) {
        rgb = vec3(x, c, 0.0);
      } else if (2.0 <= hp && hp < 3.0) {
        rgb = vec3(0.0, c, x);
      } else if (3.0 <= hp && hp < 4.0) {
        rgb = vec3(0.0, x, c);
      } else if (4.0 <= hp && hp < 5.0) {
        rgb = vec3(x, 0.0, c);
      } else {
        rgb = vec3(c, 0.0, x);
      }
      float m = l - c * 0.5;
      return rgb + vec3(m);
    }

    vec3 colorize(float t, int scheme) {
      if (scheme == 1) {
        return hsl2rgb(30.0 + 40.0 * t, 0.9, 0.5 + 0.2 * (1.0 - t));
      }
      if (scheme == 2) {
        return hsl2rgb(180.0 + 80.0 * t, 0.6, 0.45 + 0.15 * t);
      }
      return hsl2rgb(200.0 + 120.0 * t, 0.65, 0.5);
    }

    vec2 iterateEquation(vec2 currentZ, vec2 cValue, vec2 exponentValue, int mode) {
      if (mode == 1) {
        vec2 numerator = complexPow(currentZ, vec2(3.0, 0.0));
        float denom = max(1e-6, 1.0 + dot(currentZ, currentZ));
        return complexAdd(numerator / denom, cValue);
      }
      return complexAdd(complexPow(currentZ, exponentValue), cValue);
    }

    void main() {
      float canvasY = uResolution.y - gl_FragCoord.y;
      float dx = (gl_FragCoord.x - 0.5 * uResolution.x) * uScale;
      float dy = (canvasY - 0.5 * uResolution.y) * uScale;
      float cosR = cos(uRotation);
      float sinR = sin(uRotation);
      float real = uCenter.x + dx * cosR - dy * sinR;
      float imag = uCenter.y + dx * sinR + dy * cosR;
      vec2 planeValue = vec2(real, imag);

      vec2 cValue = uManualC;
      vec2 exponentValue = uManualExponent;
    vec2 zValue = uManualZ;

    if (uPlaneVariable == 0) {
      cValue = planeValue;
    } else if (uPlaneVariable == 1) {
      zValue = planeValue;
    } else if (uPlaneVariable == 2) {
      exponentValue = planeValue;
    }

    vec2 z = zValue;
    int iter = 0;
    float orbitCount = 0.0;
    float orbitMagSum = 0.0;
    float orbitAngleSum = 0.0;
    float orbitMaxMag = 0.0;

    for (int i = 0; i < MAX_ITER; i++) {
      if (i >= uMaxIterations) {
        break;
      }
        z = iterateEquation(z, cValue, exponentValue, uEquationMode);
      float magnitude = length(z);
      orbitMagSum += magnitude;
      orbitAngleSum += atan(z.y, z.x);
      orbitMaxMag = max(orbitMaxMag, magnitude);
      orbitCount += 1.0;
      if (dot(z, z) > ESCAPE_RADIUS * ESCAPE_RADIUS) {
        iter = i;
        break;
      }
      iter = i + 1;
    }

    if (iter >= uMaxIterations) {
      float samples = max(orbitCount, 1.0);
      float avgMag = orbitMagSum / samples;
      float meanAngle = orbitAngleSum / samples;
      float hue = 210.0 + 90.0 * sin(meanAngle);
      float saturation = 0.5 + 0.3 * min(1.0, orbitMaxMag / 4.0);
      float lightness = 0.25 + 0.5 * min(1.0, avgMag / 3.0);
      vec3 rgb = hsl2rgb(hue, saturation, lightness);
      gl_FragColor = vec4(rgb, 1.0);
    } else {
      float shade = float(iter) / float(uMaxIterations);
      vec3 rgb = colorize(shade, uColorScheme);
      gl_FragColor = vec4(rgb, 1.0);
    }
    }
  `;

  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);
  const program = createProgram(gl, vertexShader, fragmentShader);
  const buffer = gl.createBuffer();
  if (!buffer) {
    throw new Error("Failed to create buffer");
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );

  const attribLocation = gl.getAttribLocation(program, "aPosition");
  gl.enableVertexAttribArray(attribLocation);
  gl.vertexAttribPointer(attribLocation, 2, gl.FLOAT, false, 0, 0);

  glState = {
    canvas,
    gl,
    program,
    buffer,
    attribLocation,
    uniforms: {
      resolution: gl.getUniformLocation(program, "uResolution"),
      center: gl.getUniformLocation(program, "uCenter"),
      scale: gl.getUniformLocation(program, "uScale"),
      maxIterations: gl.getUniformLocation(program, "uMaxIterations"),
      planeVariable: gl.getUniformLocation(program, "uPlaneVariable"),
      manualZ: gl.getUniformLocation(program, "uManualZ"),
      manualC: gl.getUniformLocation(program, "uManualC"),
      manualExponent: gl.getUniformLocation(program, "uManualExponent"),
      colorScheme: gl.getUniformLocation(program, "uColorScheme"),
      rotation: gl.getUniformLocation(program, "uRotation"),
      equationMode: gl.getUniformLocation(program, "uEquationMode"),
    },
  };

  return glState;
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Failed to create shader");
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compilation failed: ${info ?? "unknown error"}`);
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext, vertexShader: WebGLShader, fragmentShader: WebGLShader) {
  const program = gl.createProgram();
  if (!program) {
    throw new Error("Failed to create program");
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${info ?? "unknown error"}`);
  }
  return program;
}

function normalizeEquation(source: string) {
  return source.replace(/\s+/g, " ").trim();
}

function normalizeInterior(source: string) {
  return normalizeEquation(source);
}

function getEquationMode(normalized: string): number | null {
  if (normalized === DEFAULT_EQUATION_NORMALIZED) {
    return 0;
  }
  if (normalized === FEATHER_EQUATION_NORMALIZED) {
    return 1;
  }
  return null;
}
function planeVariableToIndex(variable: VariableKey) {
  switch (variable) {
    case "c":
      return 0;
    case "z":
      return 1;
    case "exponent":
    default:
      return 2;
  }
}

function colorSchemeToIndex(colorScheme: ColorScheme) {
  switch (colorScheme) {
    case "fire":
      return 1;
    case "ice":
      return 2;
    case "classic":
    default:
      return 0;
  }
}

export {};
