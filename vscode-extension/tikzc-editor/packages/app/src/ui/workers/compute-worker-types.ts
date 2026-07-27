import type { ComputeRequest, ComputeResponse } from "../../compute";
import type { MathJaxFont } from "tikz-editor/text/mathjax-engine";
import type {
  TikzEditorProfilingComputeTiming,
  TikzEditorProfilingCounter
} from "tikz-editor/profiling";

/** page → worker */
export type ComputeWorkerRequestMessage =
  | { type: "compute"; request: ComputeRequest }
  | { type: "set-mathjax-font"; font: MathJaxFont }
  | {
      type: "native-snippet-response";
      requestId: string;
      results?: unknown[];
      error?: string;
    };

/** worker → page */
export type ComputeWorkerResponseMessage =
  | { type: "compute-result"; id: string; ok: true; response: ComputeResponse }
  | { type: "compute-result"; id: string; ok: false; error: string }
  | { type: "native-snippet-request"; requestId: string; requests: unknown[] }
  | { type: "profiling-counter"; counter: TikzEditorProfilingCounter; amount: number }
  | { type: "profiling-compute-timing"; timing: TikzEditorProfilingComputeTiming };
