export type Complex = { re: number; im: number };
export type RGB = { r: number; g: number; b: number };

export type VariableKey = "z" | "c" | "exponent";

export const variableOrder: VariableKey[] = ["c", "z", "exponent"];

export const variableLabels: Record<VariableKey, string> = {
  c: "Parameter c",
  z: "Initial z",
  exponent: "Exponent",
};

export const INITIAL_MANUAL_VALUES: Record<VariableKey, Complex> = {
  z: { re: 0, im: 0 },
  c: { re: -0.5, im: 0 },
  exponent: { re: 2, im: 0 },
};

export const defaultEquationSource = `return ops.add(ops.pow(z, exponent), c);`;
export const FEATHER_EQUATION_SOURCE = `
const numerator = ops.pow(z, 3);
const denom = 1 + Math.pow(ops.magnitude(z), 2);
return ops.add(ops.div(numerator, ops.complex(denom, 0)), c);
`.trim();

export type ComplexOps = {
  complex: (re: number, im: number) => Complex;
  add: (a: Complex, b: Complex) => Complex;
  sub: (a: Complex, b: Complex) => Complex;
  mul: (a: Complex, b: Complex) => Complex;
  div: (a: Complex, b: Complex) => Complex;
  scale: (z: Complex, factor: number) => Complex;
  pow: (z: Complex, exponent: Complex | number) => Complex;
  magnitude: (z: Complex) => number;
  sin: (z: Complex) => Complex;
  cos: (z: Complex) => Complex;
  exp: (z: Complex) => Complex;
  log: (z: Complex) => Complex;
};

export type EquationEvaluator = (z: Complex, c: Complex, exponent: Complex) => Complex;

export const createOps = (): ComplexOps => {
  const complex = (re: number, im: number) => ({ re, im });
  const add = (a: Complex, b: Complex) => complex(a.re + b.re, a.im + b.im);
  const sub = (a: Complex, b: Complex) => complex(a.re - b.re, a.im - b.im);
  const mul = (a: Complex, b: Complex) =>
    complex(a.re * b.re - a.im * b.im, a.re * b.im + a.im * b.re);
  const div = (a: Complex, b: Complex) => {
    const denom = b.re * b.re + b.im * b.im || 1e-12;
    return complex(
      (a.re * b.re + a.im * b.im) / denom,
      (a.im * b.re - a.re * b.im) / denom,
    );
  };
  const scale = (z: Complex, factor: number) => complex(z.re * factor, z.im * factor);
  const powInt = (base: Complex, exponent: number): Complex => {
    if (exponent === 0) {
      return complex(1, 0);
    }
    if (exponent < 0) {
      const positive = powInt(base, -exponent);
      return div(complex(1, 0), positive);
    }
    let result = complex(1, 0);
    let current = complex(base.re, base.im);
    let expValue = exponent;
    while (expValue > 0) {
      if (expValue % 2 === 1) {
        result = mul(result, current);
      }
      current = mul(current, current);
      expValue = Math.floor(expValue / 2);
    }
    return result;
  };
  const pow = (z: Complex, exponent: Complex | number) => {
    const expComplex =
      typeof exponent === "number" ? complex(exponent, 0) : complex(exponent.re, exponent.im);
    const r = Math.hypot(z.re, z.im);
    if (r === 0) {
      return complex(0, 0);
    }
    const imagIsZero = Math.abs(expComplex.im) < 1e-9;
    if (imagIsZero) {
      const realExp = expComplex.re;
      if (Number.isInteger(realExp) && Math.abs(realExp) <= 32) {
        return powInt(z, realExp);
      }
      const theta = Math.atan2(z.im, z.re);
      const rPow = Math.pow(r, realExp);
      const angle = theta * realExp;
      return complex(rPow * Math.cos(angle), rPow * Math.sin(angle));
    }
    const theta = Math.atan2(z.im, z.re);
    const logR = Math.log(Math.max(r, 1e-12));
    const magnitude = Math.exp(expComplex.re * logR - expComplex.im * theta);
    const angle = expComplex.im * logR + expComplex.re * theta;
    return complex(magnitude * Math.cos(angle), magnitude * Math.sin(angle));
  };
  const magnitude = (z: Complex) => Math.hypot(z.re, z.im);
  const sin = (z: Complex) => {
    const real = Math.sin(z.re) * Math.cosh(z.im);
    const imag = Math.cos(z.re) * Math.sinh(z.im);
    return complex(real, imag);
  };
  const cos = (z: Complex) => {
    const real = Math.cos(z.re) * Math.cosh(z.im);
    const imag = -Math.sin(z.re) * Math.sinh(z.im);
    return complex(real, imag);
  };
  const exp = (z: Complex) => {
    const mag = Math.exp(z.re);
    return complex(mag * Math.cos(z.im), mag * Math.sin(z.im));
  };
  const log = (z: Complex) => {
    const r = Math.hypot(z.re, z.im) || 1e-12;
    const theta = Math.atan2(z.im, z.re);
    return complex(Math.log(r), theta);
  };
  return { complex, add, sub, mul, div, scale, pow, magnitude, sin, cos, exp, log };
};

export const OPS = createOps();

export const fallbackEvaluator: EquationEvaluator = (z, c, exponent) =>
  OPS.add(OPS.pow(z, exponent), c);

export const compileEquation = (source: string, ops: ComplexOps) => {
  try {
    const fn = new Function("z", "c", "exponent", "ops", `"use strict"; ${source}`) as (
      z: Complex,
      c: Complex,
      exponent: Complex,
      ops: ComplexOps,
    ) => Complex;
    const test = fn({ re: 0, im: 0 }, { re: 0, im: 0 }, { re: 2, im: 0 }, ops);
    if (!isComplexLike(test)) {
      throw new Error("The equation must return ops.complex(...) or { re, im }.");
    }
    const evaluator: EquationEvaluator = (z, c, exponent) => sanitizeComplex(fn(z, c, exponent, ops));
    return { fn: evaluator, error: null as string | null };
  } catch (error) {
    return { fn: null, error: (error as Error).message };
  }
};

export const compileInterior = (source: string, ops: ComplexOps) => {
  try {
    const fn = new Function("orbit", "ops", "helpers", `"use strict"; ${source}`) as (
      orbit: OrbitStats,
      ops: ComplexOps,
      helpers: InteriorHelpers,
    ) => RGB;
    const testOrbit: OrbitStats = {
      length: 1,
      magnitudeSum: 1,
      angleSum: 0,
      maxMagnitude: 1,
      last: { re: 0, im: 0 },
    };
    const test = fn(testOrbit, ops, INTERIOR_HELPERS);
    if (!isRgbLike(test)) {
      throw new Error("Interior function must return { r, g, b }.");
    }
    const evaluator: InteriorEvaluator = (orbit, opsArg, helpersArg) =>
      sanitizeRgb(fn(orbit, opsArg, helpersArg));
    return { fn: evaluator, error: null as string | null };
  } catch (error) {
    return { fn: null, error: (error as Error).message };
  }
};

export const colorizers = {
  classic: (t: number): [number, number, number] => hslToRgb(200 + 120 * t, 0.65, 0.5),
  fire: (t: number): [number, number, number] => hslToRgb(30 + 40 * t, 0.9, 0.5 + 0.2 * (1 - t)),
  ice: (t: number): [number, number, number] => hslToRgb(180 + 80 * t, 0.6, 0.45 + 0.15 * t),
};

export type ColorScheme = keyof typeof colorizers;

export type OrbitStats = {
  length: number;
  magnitudeSum: number;
  angleSum: number;
  maxMagnitude: number;
  last: Complex;
};

export type InteriorHelpers = {
  hslToRgb: typeof hslToRgb;
};

export const INTERIOR_HELPERS: InteriorHelpers = {
  hslToRgb,
};

export type InteriorEvaluator = (
  orbit: OrbitStats,
  ops: ComplexOps,
  helpers: InteriorHelpers,
) => RGB;

export const defaultInteriorSource = `
const length = Math.max(orbit.length, 1);
const avgMagnitude = orbit.magnitudeSum / length;
const meanAngle = orbit.angleSum / length;
const hue = 210 + 90 * Math.sin(meanAngle);
const saturation = 0.5 + 0.3 * Math.min(1, orbit.maxMagnitude / 4);
const lightness = 0.25 + 0.5 * Math.min(1, avgMagnitude / 3);
const [r, g, b] = helpers.hslToRgb(hue, saturation, lightness);
return { r, g, b };
`.trim();

export function isComplexLike(value: unknown): value is Complex {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Complex).re === "number" &&
    typeof (value as Complex).im === "number"
  );
}

export function sanitizeComplex(value: unknown): Complex {
  if (!isComplexLike(value)) {
    return { re: 0, im: 0 };
  }
  if (!Number.isFinite(value.re) || !Number.isFinite(value.im)) {
    return { re: 0, im: 0 };
  }
  return value;
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let [r1, g1, b1]: [number, number, number] = [0, 0, 0];

  if (hp >= 0 && hp < 1) {
    [r1, g1, b1] = [c, x, 0];
  } else if (hp >= 1 && hp < 2) {
    [r1, g1, b1] = [x, c, 0];
  } else if (hp >= 2 && hp < 3) {
    [r1, g1, b1] = [0, c, x];
  } else if (hp >= 3 && hp < 4) {
    [r1, g1, b1] = [0, x, c];
  } else if (hp >= 4 && hp < 5) {
    [r1, g1, b1] = [x, 0, c];
  } else if (hp >= 5 && hp < 6) {
    [r1, g1, b1] = [c, 0, x];
  }

  const m = l - c / 2;
  return [
    Math.round((r1 + m) * 255),
    Math.round((g1 + m) * 255),
    Math.round((b1 + m) * 255),
  ];
}

function isRgbLike(value: unknown): value is RGB {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as RGB).r === "number" &&
    typeof (value as RGB).g === "number" &&
    typeof (value as RGB).b === "number"
  );
}

function sanitizeRgb(value: RGB): RGB {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return {
    r: clamp(value.r),
    g: clamp(value.g),
    b: clamp(value.b),
  };
}
