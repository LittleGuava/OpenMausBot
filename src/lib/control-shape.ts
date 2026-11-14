export const CONTROL_SHAPES = ["round", "squared"] as const;
export type ControlShape = (typeof CONTROL_SHAPES)[number];

export const DEFAULT_CONTROL_SHAPE: ControlShape = "round";

const CONTROL_SHAPE_KEY = "omb-controls";

function isControlShape(value: unknown): value is ControlShape {
  return CONTROL_SHAPES.includes(value as ControlShape);
}

function getStore(): Storage | undefined {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

export function readControlShape(): ControlShape {
  try {
    const stored = getStore()?.getItem(CONTROL_SHAPE_KEY);
    return isControlShape(stored) ? stored : DEFAULT_CONTROL_SHAPE;
  } catch {
    return DEFAULT_CONTROL_SHAPE;
  }
}

export function applyControlShape(shape: ControlShape): void {
  if (shape === DEFAULT_CONTROL_SHAPE) delete document.documentElement.dataset.controls;
  else document.documentElement.dataset.controls = shape;
  try {
    getStore()?.setItem(CONTROL_SHAPE_KEY, shape);
  } catch {
  }
}
