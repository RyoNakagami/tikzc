/** UI language shared by the extension host and the webview. English text is the key. */
export type Language = "en" | "ja";

const ja: Record<string, string> = {
  // Toolbar
  "View": "表示",
  "Tool": "ツール",
  "Language": "言語",
  "Select / move": "選択・移動",
  "Add text": "文字を追加",
  "Rectangle": "四角形",
  "Ellipse": "楕円",
  "Circle": "円",
  "Line": "線",
  "Arrow": "矢印",
  "Edit text": "文字を編集",
  "Object": "オブジェクト",
  "Select object": "オブジェクトを選択",
  "Choose…": "選択してください",
  "Send to back": "最背面へ",
  "To back": "最背面",
  "Send backward": "1つ背面へ",
  "Backward": "背面へ",
  "Bring forward": "1つ前面へ",
  "Forward": "前面へ",
  "Bring to front": "最前面へ",
  "To front": "最前面",
  "Delete": "削除",
  "Delete selected object (Delete)": "選択オブジェクトを削除（Delete）",
  "Click a label to select": "ラベルをクリックして選択",
  "Bold": "太字",
  "Italic": "斜体",
  "Underline": "下線",
  "Decrease font size": "文字を縮小",
  "Increase font size": "文字を拡大",
  "Font size": "文字サイズ",
  "Apply position": "座標を適用",
  "Arrow edit points": "矢印の編集点",
  "Point": "編集点",
  "Point X coordinate": "編集点のX座標",
  "Point Y coordinate": "編集点のY座標",
  "Connect to": "接続先",
  "Point connection target": "編集点の接続先",
  "Free coordinate": "自由座標",
  "Apply point": "編集点を適用",
  "Waiting to compile…": "コンパイル待ち…",
  "TikZ canvas. Tab to select, Alt-click to cycle overlapping objects": "TikZキャンバス。Tabで選択、Altクリックで重なりを切り替え",
  "Edit label": "ラベルを編集",
  "Text (TeX allowed)": "文字内容（TeX入力可）",
  "Apply": "適用",
  "Cancel": "キャンセル",
  "Ctrl / Cmd + Enter to apply, Esc to close": "Ctrl / Cmd + Enter で適用、Esc で閉じる",
  // Webview status
  "Edit arrows with the round start/end handles, square bend handles, and diamond curve-control handles. You can also enter coordinates under “Arrow edit points” above. Endpoints snap to node centers, edges, and corners (hold Alt to disable). Double-click to edit text. Tab to select. Changes can be undone in the source.":
    "矢印の始点・終点は丸、屈折点は四角、曲線の制御点は菱形で編集できます。上の「編集点」から座標指定もできます。ノードの中心・辺・角に近づけると接続します（Altで解除）。ダブルクリックで文字編集。Tabで選択。変更はソースのUndoで戻せます。",
  "Click the canvas to add text, then double-click to edit it.": "キャンバスをクリックして文字を追加し、ダブルクリックして編集してください。",
  "Drag on the canvas to add. Press Esc to cancel.": "キャンバスをドラッグして追加します。Esc でキャンセルできます。",
  "Empty node": "空のノード",
  "Line / path": "線・パス",
  "Matrix": "行列",
  "Start": "Start（始点）",
  "End": "End（終点）",
  "Bend {0}": "屈折点 {0}",
  "Control {0}": "制御点 {0}",
  "Drag or enter coordinates to change": "ドラッグまたは座標入力で変更",
  "Edit points are unavailable. Update the Rust executable.": "編集点を取得できません。Rust実行ファイルを更新してください。",
  "Edit this path's points in the source.": "このパスの編集点はソースで変更してください。",
  "Drag {0}": "{0}をドラッグ",
  "Select: {0}": "選択: {0}",
  "Could not display the image: {0}": "画像を表示できませんでした: {0}",
  "Compiling…": "コンパイル中…",
  // Source edits
  "Check for duplicate GUI layer definitions.": "重複したGUIレイヤー定義を確認してください。",
  "This object cannot be edited individually from the source.": "このオブジェクトはソースから個別に編集できません。",
  "This edit point is unavailable. Select the arrow again.": "この編集点は利用できません。矢印を選択し直してください。",
  "Select the whole matrix in the object list to delete it.": "行列はオブジェクト一覧から全体を選択して削除してください。",
  "This label cannot be deleted individually.": "このラベルは個別に削除できません。",
  "Reorder figures with macro expansion, multiple pictures, or mixed layers in the source.": "マクロ展開・複数の図・混在レイヤーを含む図の前後移動はソースで編集してください。",
  "Check the GUI layer definitions and their order.": "GUIレイヤー定義と順序を確認してください。",
  "The label is too long or invalid.": "ラベルが長すぎるか、不正な入力です。",
  "Check the trailing backslash.": "末尾のバックスラッシュを確認してください。",
  "The label has unbalanced braces.": "ラベルの波括弧が対応していません。",
  "Check the label's braces and comments.": "ラベルの波括弧・コメントを確認してください。",
  "Nothing can be added to this figure.": "この図には追加できません。",
  "Move the line's start and end apart.": "線の始点と終点を離してください。",
  "Give the shape a width and a height.": "図形の幅と高さを指定してください。",
  "Could not apply the change to the source.": "ソースへの変更を適用できませんでした。",
  "Cannot delete: other objects refer to it. Delete the lines and nodes that refer to it first.": "他のオブジェクトが参照しているため削除できません。参照する線・ノードを先に削除してください。",
};

let language: Language = "en";

export function setLanguage(value: unknown): void { language = value === "ja" ? "ja" : "en"; }
export function getLanguage(): Language { return language; }

/** Translate English `text`; `{0}`, `{1}`… are replaced by `args`. */
export function t(text: string, ...args: unknown[]): string {
  const template = language === "ja" ? ja[text] ?? text : text;
  return template.replace(/\{(\d+)\}/g, (_, index: string) => String(args[Number(index)]));
}
