import type { Cm, Pt } from "./scalars.js";
import { cm, pt, scalarValue } from "./scalars.js";

export const PT_PER_CM = pt(28.4527559055);
export const CM_PER_PT = cm(1 / scalarValue(PT_PER_CM));

export function cmToPt(value: Cm): Pt {
  return pt(scalarValue(value) * scalarValue(PT_PER_CM));
}

export function ptToCm(value: Pt): Cm {
  return cm(scalarValue(value) * scalarValue(CM_PER_PT));
}
