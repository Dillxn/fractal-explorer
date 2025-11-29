import type { ColorScheme, Complex, VariableKey } from "./fractalMath";

export type ManualValues = Record<VariableKey, Complex>;

export type FractalRenderPayload = {
  width: number;
  height: number;
  center: Complex;
  scale: number;
  maxIterations: number;
  planeVariable: VariableKey;
  manualValues: ManualValues;
  colorScheme: ColorScheme;
  equationSource: string;
  interiorSource: string;
  rotation: number;
};

export type FractalWorkerRequest = {
  id: number;
  type: "render";
  payload: FractalRenderPayload;
};

export type FractalWorkerResponse =
  | {
      id: number;
      type: "chunk";
      startY: number;
      rows: number;
      width: number;
      buffer: ArrayBuffer;
    }
  | {
      id: number;
      type: "bitmap";
      bitmap: ImageBitmap;
      elapsed: number;
    }
  | {
      id: number;
      type: "done";
      elapsed: number;
    }
  | {
      id: number;
      type: "error";
      message: string;
    };
