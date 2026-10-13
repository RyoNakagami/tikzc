import * as vscode from "vscode";
import { activateNativePreview } from "./preview/preview";

export function activate(context: vscode.ExtensionContext): void {
  activateNativePreview(context);
}

export function deactivate(): void {}
