import { parseTikz } from "../parser/index.js";
import type { ParseTikzResult } from "../parser/index.js";
import { evaluateTikzFigure } from "../semantic/evaluate.js";
import type { EvaluateTikzResult } from "../semantic/evaluate.js";
import { emitSvg } from "../svg/emit.js";
import type { EmitSvgResult } from "../svg/types.js";
import type { EditHandle, SceneFigure } from "../semantic/types.js";
import type { EditIntent, EditIntentResult } from "./types.js";
import { applyEditIntent } from "./apply.js";

let nextEditorSessionId = 1;

export class EditorSession {
  private _source: string;
  private _revision = 0;
  private readonly _sessionId = nextEditorSessionId++;
  private _parseResult: ParseTikzResult | null = null;
  private _semanticResult: EvaluateTikzResult | null = null;
  private _svgResult: EmitSvgResult | null = null;

  constructor(initialSource: string) {
    this._source = initialSource;
    this.refresh();
  }

  get source(): string {
    return this._source;
  }

  get revision(): number {
    return this._revision;
  }

  get editHandles(): EditHandle[] {
    return this._semanticResult?.editHandles ?? [];
  }

  get scene(): SceneFigure | null {
    return this._semanticResult?.scene ?? null;
  }

  get svg(): EmitSvgResult | null {
    return this._svgResult;
  }

  get parseResult(): ParseTikzResult | null {
    return this._parseResult;
  }

  get semanticResult(): EvaluateTikzResult | null {
    return this._semanticResult;
  }

  setSource(source: string): void {
    if (source === this._source) {
      return;
    }
    this._source = source;
    this._revision += 1;
    this.refresh();
  }

  applyIntent(intent: EditIntent): EditIntentResult {
    const result = applyEditIntent(this._source, this.editHandles, intent, {
      sourceFingerprint: this.sourceFingerprint()
    });
    if (result.kind === "success") {
      this._source = result.newSource;
      this._revision += 1;
      this.refresh();
    }
    return result;
  }

  private refresh(): void {
    this._parseResult = parseTikz(this._source);
    this._semanticResult = evaluateTikzFigure(
      this._parseResult.figure,
      this._source,
      { sourceFingerprint: this.sourceFingerprint() }
    );
    this._svgResult = emitSvg(this._semanticResult.scene);
  }

  private sourceFingerprint(): string {
    return `editor-session:${this._sessionId}:${this._revision}:${this._source.length}`;
  }
}
