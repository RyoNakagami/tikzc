import type { CoordinateForm } from "../../ast/types.js";

export type ParsedCoordinate = {
  x: string;
  y: string;
  z?: string;
  form: CoordinateForm;
  isWellFormed: boolean;
};
