---
name: tikz-block-diagram
description: テキストのシステム説明（制御系・データフロー・アーキテクチャ等）やスライド画像を .tikz のブロック線図に変換し，tikzc でコンパイル・PNG目視検証して仕上げる．トリガー例「〜をブロック線図にして」「〜を.tikzに描いて」「tikzで図を作って」．出力はユーザー指定がない限り 1600×900 スライド想定．
---

# tikz-block-diagram

テキストで与えられたシステム説明（制御ループ・データフロー・アーキテクチャ等）を，
tikzc でコンパイル可能な `.tikz` ブロック線図に変換し，PNG レンダリングを目視検証して仕上げる skill．

## When to use

- 「〜の情報を ○○.tikz にブロック線図として描いて」
- 「この制御系／処理フローを TikZ で図にして」
- 「スライド用にブロック線図を作って」
- 論文・スライド画像をベースにした図の作成・更新

## Output 前提

- **ユーザー指定がない限り 1600×900（16:9）のスライドに貼る想定**で設計する．
  スライド側のタイトル領域を考慮し，図全体の縦横比は概ね **1.8〜2.5 : 1** に収める．
  3:1 を超えそうなら上下2段レイアウト（主経路＋フィードバック段）や凡例による空き埋めで調整する
- 出力ファイルは既存図を上書きしない．内容が別物になる更新では，
  旧版を `<name>-backup.tikz` 等に退避するか新規ファイル名にする

## Instructions

### Step 1: 入力の構造化

説明文から以下を抽出して整理する（作図前に必ず行う）:

1. **ブロック**（処理・コンポーネント）: 名前，役割の短い補足
2. **信号**（ブロック間の矢印）: 変数名（数式）と日本語補足
3. **グループ／ゾーン**: 制御周期・サブシステム等のまとまり（例: 低速/中速/高速ループ，オフライン/オンライン）
4. **外部入力・前提条件**: ループ外で1回だけ与えられるもの（破線で表現）
5. **フィードバック経路**: センサ→推定器→制御器の戻り線

### Step 2: レイアウト設計

- **主経路は左→右の一直線**（目標生成 → 制御器列 → プラント）
- **フィードバックは下段**に配置（FK・観測器・視覚認識などは below= で下の行へ）
- **ゾーンが周期・サブシステムに対応する場合は縦バンド**（左=上流，右=下流）にし，
  下段ブロックも同じバンドの x 位置に置く
- 元となるスライド・図がある場合はその流儀に合わせる．色分けは2方式ある:
  (a) ゾーン背景で塗る（周期＝空間的にまとまる場合），
  (b) **ブロック単位で塗り分け＋凡例チップ**（周期の異なるブロックが混在する場合）．
  (b) ではセクション枠は無彩色（`draw=black!55, fill=none`）にし，
  凡例は `minimum height=0.55cm` の小ノードを図の上部に並べる
- 特定の機構を強調したいとき（例: EKFデータ同化）は，該当ブロック群を
  fit ノード（色付き太枠＋薄い fill）で囲み，タイトルを枠内上部に置く．
  枠の fill を活かすため，同じ background layer 内で枠より後に描く他の fit ノードに
  fill を付けない（後描きの fill が先描きの枠を覆う）
- スライド用途では上部の空きスペースに**変数凡例ボックス**を置いて埋める
- 配線の交差は最小化する．分岐点のみ `dot` を打つ．残る交差は**ジャンプ弧**で非接続を明示する:

```latex
\coordinate (cross) at (縦線ノード |- 横線.east);
\draw[->] (始点) -- ($(cross)+(0.16,0)$)
  arc[start angle=0, end angle=180, radius=0.16] -- (終点);
% 縦線が横線をまたぐ場合は start angle=90, end angle=-90
```

- ゾーン背景（fit ノード）は inner sep 分（10pt ≈ 0.35cm）外側に広がる．
  隣接ゾーンの最外ブロック同士は **1.3cm 以上**離す（下段ブロックの端も含めて確認する）

### Step 3: .tikz ソース生成

基本形式は bare tikzpicture（`\documentclass` は書かない．tikzc が standalone に包む）:

- `\begin{tikzpicture}` 内の記法（ノード・パス・ライブラリの使い方）で迷ったら
  **https://tikz.dev/ （PGF/TikZ 公式マニュアル）を参照する**
- ヘッダ: 日本語ラベルがあれば `#| mainfont: IPAexGothic` を1行目に置く
  （IPAフォントを使用．スライドはゴシック体の IPAexGothic，
  文書向けならIPAexMincho．`fc-list | grep -i ipa` で導入済みか確認できる）
- デフォルトで使えるライブラリ: arrows.meta, positioning, calc, shapes.geometric, backgrounds, fit
- スタイルテンプレート:

```latex
#| mainfont: IPAexGothic
\begin{tikzpicture}[
    auto, >={Latex[length=2.6mm]}, font=\small, line width=0.7pt,
    block/.style={draw=#1!55!black, fill=#1!12, rounded corners=3pt,
                  align=center, minimum height=1.1cm, inner sep=5pt},
    sum/.style={draw=#1!55!black, fill=#1!12, circle, inner sep=1.5pt},
    ext/.style={draw=gray!70, dashed, fill=gray!8, rounded corners=3pt,
                align=center, inner sep=5pt},
    zone/.style={fill=#1!6, draw=#1!40, rounded corners=8pt, inner sep=10pt},
    zlabel/.style={anchor=south, font=\bfseries, text=#1!45!black},
    sig/.style={font=\footnotesize, inner sep=2pt},
    dot/.style={circle, fill, inner sep=1.4pt},
  ]
  % block はゾーンごとに色を変える: block=blue / block=teal / block=orange
```

- 配置は `right=1.5cm of prev` / `below=1.5cm of node` / `at (a |- b)` を使う
- 信号ラベルは `node[midway, above, sig] {$v_{\mathrm{target}}$}`
- 加算点の符号は `node[pos=0.92, below, sig] {$+$}` のように矢印の端に置く
- ゾーン背景は fit + 共有座標で高さを揃える:

```latex
\coordinate (ztop) at ($(topnode.north)+(0,0.25)$);
\coordinate (zbot) at ($(bottomline)+(0,-0.3)$);
\begin{scope}[on background layer]
  \node[zone=blue, fit=(a)(b)(a |- ztop)(a |- zbot)] (zlow) {};
\end{scope}
\node[zlabel=blue] at (zlow.north) {低速：$T_c=30$--$60\,$Hz（…）};
```

### Step 4: コンパイルと目視検証（必須ループ）

```sh
npx tsx src/cli.ts <path/to/file>.tikz --format both
# または（ビルド済みなら） tikzc <file>.tikz --format both
```

生成された PNG を Read で開いて画像を確認し，問題があれば修正して再コンパイルする．
**コンパイルが通っただけで完了としない．** チェック項目:

- [ ] ブロック内テキストが枠からはみ出していない
- [ ] 矢印上のラベルが隣のブロック・他の配線と重なっていない（重なるなら gap を広げるかラベルを明示座標で置く）
- [ ] ゾーン境界・ラベルの位置が正しい
- [ ] ゾーン背景・セクション枠の矩形同士が重なっていない
- [ ] 配線の交差にジャンプ弧があり，接続と誤読されない
- [ ] +/− 符号が加算点の正しい側にある
- [ ] 図全体の縦横比が 1.8〜2.5:1 程度（1600×900 スライド想定時）

### Step 5: 完了報告

- 出力ファイルパス（.tikz / .svg / .png）を提示
- 図の構成（ゾーン・主経路・フィードバック）を2〜3文で説明

## Rules

- **CJK テキストは text width では自動改行されない**（lualatex + fontspec）．
  日本語が長い行は必ず手動で `\\` を入れる．全角12文字 ≈ 3.8cm（footnotesize）を目安に判断する
- 数式変数は `$P_{\mathrm{rel}}$` のように mathrm 添字で書く．日本語は数式モードに入れない
- 日本語の句読点は `，．` を使う（`、。` は使わない）
- 矢印間ラベル（例: `$q_{\mathrm{ref}},\dot q_{\mathrm{ref}}$`）を置く区間は
  ブロック間 gap を 1.5cm 以上取る．縦線と横線ラベルの干渉は，pos 調整より
  **明示座標の `\node[sig, anchor=west] at (x,y)`** のほうが制御しやすい
- VSCode の tikz WYSIWYG エディタが同ファイルを開いていると Edit が競合・破損することがある．
  競合を検知したら（Edit 失敗が続く／ファイル内容が意図せず変わる），部分 Edit をやめて
  Write で全文を一括書き込みし，ユーザーにエディタのリロードを促す
- 元の説明文にある情報（周波数・変数定義・特記事項「※〜」）は省略せず図中に反映する．
  入りきらない場合は凡例ボックスか脚注ノードに逃がす
- 論文・外部資料ベースの図には出典ノード（`font=\scriptsize, text=gray`）を図の最下部に置く
