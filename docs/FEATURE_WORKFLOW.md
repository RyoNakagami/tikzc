# TikZ 機能追加の進め方

対象は Rust 版 `target/release/tikzc` の機能追加・互換性改善を行う開発者と依頼者．
実図を起点に対応範囲を決め，最小再現例，数値テスト，画像比較を揃えてから対応済みとする．
製品の契約は **Fast, Rust-native renderer for a practical subset of TikZ** であり，
任意の TeX 実行や TikZ 全機能の互換性ではない．

## 現在の未対応機能と用途

以下は 2026-10-07 時点のローカル比較の記録であり，実装の進行に合わせて再計測する．
この比較では，126固有入力中120件が SVG と PNG を生成した．未対応エラー6件はすべて `tests/fixtures/` の機能確認用入力で，
外部実図48件はすべて生成できた．これは48件の視覚的一致を意味しない．
文字の折り返し・数式・矢印等の残差は「構文未対応」と別に管理する．

残る6機能は，現在の PGF/TikZ マニュアルに記載された通常の機能であり，
特殊な独自構文ではない．ただし，正式機能であることと利用頻度が高いことは別である．
以下の用途・優先度は対象とするブロック図や DAG に照らした判断で，利用率の統計ではない．

| 未対応機能 | 使う場面と今回の fixture | このプロジェクトでの判断 |
|---|---|---|
| `intersections` | 名前付きパスの交点を計算．今回の fixture はライブラリ指定と `name path` だけで止まり，交点計算そのものは試していない | 幾何図・交点基準の配置を使う実図があれば優先．既存の `a -\| b` / `a \|- b` による直交座標合成とは別機能．[仕様](https://tikz.dev/tikz-coordinates) |
| `pic` | 複数ノードやパスを再利用可能な部品にする．fixture は小さい円の部品定義・呼び出し | 同じ部品を繰り返す図には有用．対応済み描画命令だけを許す限定版から検討．[仕様](https://tikz.dev/tikz-pics) |
| `graphs` | `\graph { a -> b -> c };` のような接続関係の宣言 | DAG・ネットワーク図と相性がよい．通常の node/draw による DAG は既に描けるため，短縮構文と自動配置を分けて要望を確認．[仕様](https://tikz.dev/tikz-graphs) |
| `decorations.pathmorphing` の `snake` | 波線の装飾．fixture は1本の直線を波線にする | 波線が図の意味を担う実例で優先．decorations 全体ではなく直線上の snake 等に範囲を絞る．[仕様](https://tikz.dev/library-decorations) |
| `shading` / `\shade` | 色のグラデーション．fixture は矩形の赤→青 | 図の意味より外観の改善が中心となる場合は後順位．単純な線形 gradient と汎用 shading を分ける．[仕様](https://tikz.dev/tikz-actions) |
| `star` shape | 星形ノード．fixture は星形の中に文字を置く | 注目点・特殊な記号で必要になった時に追加．描画だけでなく文字の内包，アンカー，接続境界まで対象にする．[仕様](https://tikz.dev/library-shapes) |

2026-10-14 追記: 上表のうち `intersections`（`name path` と `name intersections` による
直線・折れ線・plot・曲線の交点）と `shading`（線形・放射 gradient）は限定対応済み．
`shading=ball` や交点の `sort by` などは引き続き診断になる．範囲は
[対応範囲](RUST_ENGINE.md#native-compatibility-contract)を参照．

`graphs` と `graphdrawing` は別である．前者の構文を読むだけでは，後者の
layered/force/tree 等の自動配置を実装したことにならない．Rust-only の契約では
必要な配置処理を Rust 内に実装・導入する設計判断が必要になる．[Graph drawing の仕様](https://tikz.dev/gd-usage-tikz)

以前エラーだった `clip`，`matrix of nodes`，基本 `patterns` は現在は限定対応済み．
`unsupported-*.tikz` という履歴上のファイル名だけで未対応とは判断しない．
現在の[対応範囲](RUST_ENGINE.md#native-compatibility-contract)と[テスト](../tests/native.rs)を確認する．

## 要望時に渡す情報

機能名だけでなく，その機能が必要な最小の `.tikz` と期待する画像が最も役立つ．
機能名が分からない場合は実図と「どこがどう違うか」だけでも受け付ける．
私的な実図はローカルで保持し，公開用には機密の文言・構成を除いた再現例を別に作る．

```text
要望: TikZ の xxxx に対応してほしい
用途: 制御ブロック図 / DAG / 構成図 / その他
対象: Rust CLI / VSCode export / VSCode preview
入力: .tikz 原本の場所，公開可能な最小再現例
期待: 参考画像と，必ず一致させたい接続・形状・配置・文字
現在: 使用バイナリのパスと --version，実行コマンド，エラー全文または画像差
環境: OS，フォント，libraries/packages，TeX エンジン，PNG DPI
必要な範囲: 使用するオプション，変換やマクロとの組合せ
許容範囲: 近似可否，入力変更可否，速度・寸法条件
優先度: この図を塞いでいる / 複数図で必要 / 将来の候補
```

未回答の項目は推測と事実を分けて記録する．入力を書き換えれば描ける場合も，
「原本の無修正対応」と「代替表現への移植」を区別し，勝手に元ファイルを変更しない．

## 受付から実装まで

### 1 使用経路と失敗の種類を確定する

PATH 上の `tikzc` は，作業ツリーとは別の版（インストール済みの版や，0.x の npm 版）を
指す場合がある．検証対象は絶対パスまたは `target/release/tikzc` を明示し，実際の版・
バイナリ hash・入力 hash を記録する．VSCode の preview と export は `tikzc.nativePath`
または PATH 上の実行ファイルを使うため，CLI で検証した版と同じとは限らない．

分類は次のいずれかにする．後続のエラーが隠れている場合は順に解消・再確認する．

- 構文未対応: command / option / library の診断．
- 対応済み機能の不具合: panic，誤った座標，欠落，スコープ漏れ等．
- 視覚差: 生成は成功したが文字・形・位置・色が期待と違う．
- 環境・参照系の問題: フォント欠落，参照画像の作成失敗，古いバイナリ，権限，DPI 不一致等．
- 制限超過: 展開回数，深さ，入力サイズ，画像サイズ等の上限．

参照側（TeX 等）が失敗した入力を正しい比較基準としない．機能名が header で拒否されただけなら，
その機能の計算や描画まで検証したとは報告しない．

### 2 最小再現例と対応契約を作る

元図を保存したまま，問題を起こす最小例と，実際の組合せを残した統合例を作る．
PGF/TikZ マニュアル，必要なら PGF の該当実装で意味・既定値・単位・スコープを確認する．
既存のテスト名や描画が成功した1例だけから，ライブラリ全体の意味を推定しない．

実装前に以下を明文化する．

- 今回受け付ける構文・オプション・既定値と，診断する対象外の指定．
- ノード名，アンカー，変換，背景，clip，opacity，foreach/macro との組合せ．
- 数値精度・視覚上の許容差，決定性，処理量・入力サイズの上限．
- 必須の元図とテスト，許容する近似，必要なフォントとライセンス．
- Rust CLI だけか，VSCode の操作・出力経路も変更するか．

実図を塞ぐ問題を先に扱う．大きい機能は必要な意味の単位で分割する．例えば
`intersections` は「直線同士」と「曲線・接線・重なり」を，`pic` は限定描画部品と
任意 TeX コード実行を分ける．新しい runtime 依存や一般的な TeX 解釈が必要なら，
先に設計・仕様変更として相談する．

### 3 失敗するテストを先に追加する

| テスト層 | 固定するもの | 現在の主な置き場 |
|---|---|---|
| 構文と診断 | 対応入力，未対応オプション，壊れた括弧，元ソースの行・列 | `tests/native.rs`，`expansion.rs` |
| 意味と幾何 | 座標，アンカー，長さ，スコープ，変換順序，数値上限 | `precision.rs`，`desktop.rs`，`path_positions.rs`，各 module の unit test |
| 文字組版 | 字形，太字，改行後の空白，baseline | `text_weight.rs`，`text_whitespace.rs`，`precision.rs` |
| 統合描画 | 元図または匿名化した再現例の SVG と PNG，決定性，空 PATH | `tests/fixtures/`，`notebook/`，`native.rs`，`svg_optimization.rs` |
| キャンバス編集 | 編集用メタデータ，挿入境界，レイヤー順序，パス編集点 | `interactive.rs`，`vscode-extension/tests/native-editing.test.ts` |
| 視覚回帰 | 目視確認した native 画像からの退行 | `tests/visual-native/`，`tests/visual.rs` |

正常系だけでなく，境界・退化・組合せ・非対応系を揃える．
例: intersections なら交差なし，端点交差，平行，共線，多重交点と命名順序．
star なら point 数や比率，テキスト内包，回転後のアンカー，境界へ接続する線．
無視すると図の意味が変わる指定を，警告なしに読み飛ばして成功扱いにしない．

### 4 責務に沿って実装する

- `syntax.rs` / `expand.rs` / `expr.rs`: 構文，元入力位置，限定展開，式と上限．
- `options.rs`: スタイル・キー・値の検証．
- `render.rs`: scene 全体の組立て．実処理は `render/` 配下に分かれる．
  `coordinates.rs`（座標），`geometry.rs`（形状と境界），`nodes.rs`（ノード），
  `paths.rs`（パス），`paint.rs`（色・線・塗り），`diagram.rs`（SVG と PNG の出力），
  `label_svg.rs` / `glyph_path.rs`（ラベル SVG と字形の共有），
  `path_editing.rs`（拡張のキャンバス編集用メタデータ）．
- `transform.rs` / `curve.rs` / `arrows.rs`: 幾何と変換の一貫性．
- `text.rs`: 字形・baseline・フォントと組版．
- `main.rs`: CLI の受け付け，診断，出力ファイルの扱い，拡張向けの `--preview-server`．

新機能が大きければ独立 module を追加し，機能のためだけに全面改修しない．
header の library allowlist や option 名だけを追加して対応済みにしない．
TeX/Poppler/Node の subprocess，自動 TeX fallback，任意のファイル読み込みは導入しない．
原本と既存の無関係な作業差分を保持し，失敗時に完成品として出力しない契約も守る．

## 比較と完了判定

### 5 実装前後と参照画像を比較する

以下はリポジトリ直下での例．`/path/to/diagrams` を置き換え，
`request-xxxx-before` / `request-xxxx-after` には要望ごとに新しい保存先を使う．
参照側（`--reference`）と検証側（`--native`）が別のバイナリであることを版と hash で確認する．

```sh
# 実装前のビルドを参照用に退避
cargo build --release --locked
cp target/release/tikzc target/tikzc-request-xxxx-before

# 実装後に再ビルドして比較
cargo build --release --locked
node devtools/compare-desktop.mjs --root /path/to/diagrams \
  --reference target/tikzc-request-xxxx-before \
  --native target/release/tikzc \
  --out target/desktop-comparison/request-xxxx-after
```

このハーネスは対象を再走査し，原本 hash 不変を確認して `target/` にだけ結果を保存する．
比較には Node と rg が必要だが，native runtime の依存ではない．
JSON と gallery には私的なパス等が入るので commit しない．
探索対象では `.git`，`node_modules`，`target` が除外されるため，`--root` をこれらに置かない．

参照側の結果は `--reuse-reference <results.json>` で再利用できる．キャッシュのキーは
入力 hash であり，参照バイナリやフォント環境の変更は自動検知しない．
参照を変更した場合は `--reuse-reference` を外して再生成する．
図が増減した場合は，同一 hash の共通集合と追加図を分けて集計する．

TikZ 本来の描画と比べる場合は，手元の TeX 環境で作った画像を期待画像として別途用意する．
このリポジトリは TeX を実行する手段を持たない．

画像は同じ DPI・縮尺で確認する．gallery の各画像の独立縮小表示や全体 canvas の一致だけでは，
文字欠落や接続位置の違いを見落とす．必要に応じて同じ座標系の重ね合わせ・差分画像を用い，
期待画像，生成前後の画像，問題箇所の説明を残す．

### 6 自動テストと画像基準を確定する

```sh
cargo fmt --all --check
cargo clippy --locked --all-targets -- -D warnings
cargo test --locked
cargo build --release --locked
cargo run --locked --release --example benchmark -- target/release/tikzc
```

既存 benchmark は8つの固定 fixture が対象で，新機能の性能を自動では測らない．
重い機能には代表入力・上限付近の入力も用意し，同じ release 条件で繰り返し測る．
比較ハーネスの並行単発時間と，キャッシュされた参照側の時間だけで高速化を断定しない．
50ms は目標であり，一律の達成済み保証や開発中止条件ではない．

新しい視覚 fixture は `visual.rs` の明示リストにも登録する．元画像を退避・差分確認した後，
意図した画像変更だけを基準として採用する．次のコマンドはリスト内すべての基準 PNG を更新する．

```sh
UPDATE_NATIVE_GOLDENS=1 cargo test --locked --test visual
# 更新された全 PNG を目視確認し，意図しない変更がないことを確認
cargo test --locked --test visual
```

最後の通常テストで更新フラグを残さない．現在の画像回帰は canvas 寸法一致と，
各 channel 差8超の画素が0.1%以下という条件である．これは native の退行検出であり，
TeX 互換率ではない．機能を実装したら古い「未対応」の assertion を正常系へ移し，
対象外の別 variant に対する診断テストを残す．テストを削除するだけで対応済みにしない．

### 7 対応範囲と残差を記録する

- [対応範囲](RUST_ENGINE.md): 対応構文，既定値，今回完了した範囲と既知の制限．
- [TESTING](TESTING.md): 追加テストと再現コマンド．
- [README](../README.md): 導入手順や必要な依存が変わる場合のみ．
- `target/desktop-comparison/`: 比較条件，入力・バイナリ識別，成否，視覚差，性能と既知の近似．
- [CHANGELOG](../CHANGELOG.md): ユーザーから見える追加・修正．フォント追加時はライセンスも更新．

完了には以下をすべて満たす．

- [ ] 合意した対象入力が，原本を変更せず native で生成できる．
- [ ] 必要な数値・意味がテストで確認され，既存テストが退行していない．
- [ ] 期待画像と比較し，欠落・接続・整列を確認した．残差を隠さず記録した．
- [ ] 対象外の指定・危険な入力・上限超過が，位置付き診断となる．
- [ ] runtime 依存・決定性・性能への影響を確認した．
- [ ] ドキュメントと視覚基準を更新し，更新フラグなしのテストが通る．

報告は「対象範囲」「生成成功数」「数値テスト」「目視確認した図」「残差」「性能」を分ける．
`check` 成功や PNG 作成だけを「完全再現」と呼ばない．代替表現への変換で済ませた場合は
その旨を明記し，元構文を実装したという扱いにはしない．

## 次回の依頼例

```text
docs/FEATURE_WORKFLOW.md に従って，Rust 版に
intersections の直線同士の交点と by による命名を追加してください．
添付 .tikz を無修正で描き，交点の座標と接続先をテストしてください．
曲線・重なりの扱いは実装前に範囲を提案し，対象外なら診断を残してください．
TeX runtime は追加せず，数値回帰・画像比較・対応範囲の文書更新まで行ってください．
```
