---
name: tikz-drawing
description: テキストのシステム説明（制御系・データフロー・アーキテクチャ等）やスライド画像を .tikz のブロック線図に，アルゴリズムを擬似コード（algorithm 環境）に変換し，tikzc（Rust ネイティブエンジン）でコンパイル・PNG目視検証して仕上げる．トリガー例「〜をブロック線図にして」「〜を.tikzに描いて」「tikzで図を作って」「アルゴリズムを擬似コードにして」「擬似コードと図を対応させて」．出力はユーザー指定がない限り 1600×900 スライド想定．
---

# tikz-drawing

テキストで与えられたシステム説明（制御ループ・データフロー・アーキテクチャ等）やアルゴリズムを，
tikzc でコンパイル可能な `.tikz` のブロック線図・擬似コードに変換し，PNG レンダリングを目視検証して仕上げる skill．

**tikzc は TeX を呼ばない Rust ネイティブエンジンで，TikZ の実用サブセットだけを解釈する．**
TeX で通る記法でも対応外なら診断エラーで止まり，通っても見た目が TeX と違う箇所がある．
下の「Rust エンジンで書ける範囲」に載っている書き方だけで組み立てること．

## When to use

- 「〜の情報を ○○.tikz にブロック線図として描いて」
- 「この制御系／処理フローを TikZ で図にして」
- 「スライド用にブロック線図を作って」
- 論文・スライド画像をベースにした図の作成・更新
- 「このアルゴリズムを擬似コードにして」「擬似コードの各行と図の該当箇所を対応させて」
  （→ Step 3 の「擬似コード（algorithm 環境）」）

## Output 前提

- **ユーザー指定がない限り 1600×900（16:9）のスライドに貼る想定**で設計する．
  スライド側のタイトル領域を考慮し，図全体の縦横比は概ね **1.8〜2.5 : 1** に収める．
  3:1 を超えそうなら上下2段レイアウト（主経路＋フィードバック段）や凡例による空き埋めで調整する
- **例外：横一列のプロセス図や，1枚のスライドに図を2つ以上縦に並べる場合**は
  5〜6 : 1 の横長でよい．この場合は縦横比ではなく，
  スライドに埋め込んだ状態で全体が本文領域（約 650px）に収まるかで判断する
- 出力ファイルは既存図を上書きしない．内容が別物になる更新では，
  旧版を `<name>-backup.tikz` 等に退避するか新規ファイル名にする

## Palette（使ってよい色）

ユーザー・リポジトリから別の配色指定がない限り，**次の10色だけ**を使う．
`\begin{tikzpicture}` / `\begin{algorithm}` より前で `\definecolor` し，色名で参照する:

```latex
\definecolor{navy}{HTML}{0E3666}        % indigodye：枠線・矢印・見出し
\definecolor{aliceblue}{HTML}{E8F1FE}   % ブロックの塗り（既定）
\definecolor{azureblue}{HTML}{428CE6}   % アクセント文字（Step ラベル・擬似コードとの対応付け）
\definecolor{paleskyblue}{HTML}{B4D7FF} % 強調ブロックの塗り・ゾーン枠・擬似コードの強調行
\definecolor{fontblack}{HTML}{1A1A1A}   % 本文テキスト
\definecolor{darkgray}{HTML}{575757}    % 補足テキスト・信号ラベル・外部入力の破線
\definecolor{lightgray}{HTML}{DEDEDE}   % 区切り線・非アクティブ要素
\definecolor{crimsonred}{HTML}{D31804}  % NG・警告の枠と文字（それ以外では使わない）
\definecolor{mistyrose}{HTML}{FBE7E6}   % NG・警告ブロックの塗り
% white は xcolor 既定のまま使う
```

| 役割 | 色 |
|---|---|
| ブロック枠・矢印・ゾーンラベル | `navy` |
| ブロックの塗り | `aliceblue`（既定），強調は `paleskyblue`，カード型は `white` |
| 本文 | `fontblack` |
| 補足・信号ラベル・外部入力 | `darkgray` |
| アクセント（Step 番号・擬似コード行との対応付けの文字） | `azureblue` |
| 区切り線 | `lightgray` |
| NG・警告・アンチパターン | `crimsonred`（枠・文字）＋ `mistyrose`（塗り） |
| 擬似コードの強調行 | `algo-focus color=paleskyblue`（既定の `orange!20` は使わない） |

- `blue!12` や `navy!55!black` のような**混色は使わない**（パレット外の色になる）．
  tikzc は混色を描けてしまうので，エラーにならない分だけ注意する
- `\colorlet` は tikzc ではエラーになる．別名が欲しいときも `\definecolor` で書く
- 色は**スタイル側に固定**し，`block=blue` のように `#1` で色を渡す書き方はしない
- 擬似コード本体の文字色は tikzc が決める（黒 `#000000`）．図側で変えようとしない
- 完成後に SVG を grep して，パレット外の色が混ざっていないことを確認する（Step 4）

## 図の密度（busy にしない）

情報を足すより，削って読みやすくすることを優先する:

- **同時に使う色は主要3色＋アクセント1〜2色まで**．役割が同じ要素は同じ色にする
- **意味の差がないブロックは全部同じ見た目**にする．ゾーン・行ごとに色相を変えない．
  区別はゾーン枠とラベルで付ける
- **補足は枠で囲まない**．ブロックの下に `darkgray` の文字で置くだけにする．
  破線の補足ボックス＋接続線の組み合わせは使わない
- 1ブロック（1カード）あたりの箇条書きは **2〜3行**まで．入りきらない内容はスライド本文に回す
- バッジ・タグは塗りつぶさず**色付き文字**（`azureblue`）で示す
- 影・グラデーション（`\shade`）・`thick` を超える線は使わない

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
- 色分けは2方式ある:
  (a) ゾーンで囲む（周期・サブシステムが空間的にまとまる場合．枠は `paleskyblue`，塗りなし），
  (b) **ブロック単位で塗り分け＋凡例チップ**（周期の異なるブロックが混在する場合）．
  塗り分けはパレット内の `aliceblue` / `paleskyblue` / `white` の3段階まで．
  (b) ではセクション枠は `draw=darkgray, fill=none` にし，
  凡例は `minimum height=0.55cm` の小ノードを図の上部に並べる
- 特定の機構を強調したいとき（例: EKFデータ同化）は，該当ブロック群を fit ノード
  （`draw=azureblue, line width=1.2pt` の枠＋`fill=aliceblue`）で囲み，タイトルを枠内上部に置く．
  枠の fill を活かすため，同じ background layer 内で枠より後に描く他の fit ノードに
  fill を付けない（後描きの fill が先描きの枠を覆う）
- スライド用途では上部の空きスペースに**変数凡例ボックス**を置いて埋める
- 配線の交差は最小化する．分岐点のみ `dot` を打つ．残る交差は**ジャンプ弧**で非接続を明示する:

```latex
% 横線が縦線をまたぐ（弧は上に膨らむ）
\coordinate (cross) at (縦線ノード |- 横線.east);
\draw[->] (始点) -- ($(cross)+(0.16,0)$)
  arc[start angle=0, end angle=180, radius=0.16] -- (終点);
% 縦線が横線をまたぐ（上から下へ，弧は右に膨らむ）
\coordinate (cross) at (縦線ノード |- 横線.east);
\draw[->] (始点) -- ($(cross)+(0,0.16)$)
  arc[start angle=90, end angle=-90, radius=0.16] -- (終点);
```

- ゾーン背景（fit ノード）は inner sep 分（10pt ≈ 0.35cm）外側に広がる．
  隣接ゾーンの最外ブロック同士は **1.3cm 以上**離す（下段ブロックの端も含めて確認する）
- ゾーンラベル（`zlabel`）は枠の上辺の外側に乗る．ゾーンの真上に置く外部入力ノードは
  ラベルの高さ分（約 0.6cm）余分に離すか，ラベルと x 位置をずらす

### Step 3: .tikz ソース生成

基本形式は bare tikzpicture．ファイルに書いてよいのは次の3種類だけ:

1. 先頭の `#|` ヘッダ行
2. `\begin{tikzpicture}` より前の `\tikzset{...}` / `\definecolor` / `\newcommand` / `\def`
3. `\begin{tikzpicture}[...] ... \end{tikzpicture}`
4. 擬似コードを描くときの `\begin{algorithm} ... \end{algorithm}`（下の「擬似コード」参照）

`\documentclass` / `\usepackage` / `\usetikzlibrary` / `\begin{document}` は**書くとエラー**になる
（ライブラリの読み込みは不要で，対応機能は最初から使える）．

- ヘッダ: 日本語ラベルがあれば1行目に `#| mainfont: Noto Sans CJK JP` を置く．
  同梱フォントは3つで，システムへの導入確認は不要:

  | mainfont | 書体 | `\bfseries` / `\textbf` |
  |---|---|---|
  | `Noto Sans CJK JP` | ゴシック（スライド向け，既定で使う） | **効く** |
  | `IPAexGothic` | ゴシック（既存図と揃えるとき） | 効かない（無視される） |
  | `IPAexMincho` | 明朝（文書向け．ヘッダ省略時もこれ） | 効かない（無視される） |

  同梱以外のフォント名は，そのマシンに導入されていなければエラーになる．
  図のヘッダのキーは `mainfont` / `scale` / `filename` / `width` / `height` /
  `libraries` / `packages`．ほかに擬似コード用のキー（`layout` `canvas` `line-number` など，
  下の「擬似コード」参照）がある．それ以外（`preamble` など）は `Unsupported header` エラー
- スタイルテンプレート:

```latex
#| mainfont: Noto Sans CJK JP
% ↓ Palette 節の \definecolor 一式をここに貼る
\begin{tikzpicture}[
    auto, >={Latex[length=2.6mm]}, font=\small, line width=0.7pt,
    every node/.style={text=fontblack},
    block/.style={draw=navy, fill=aliceblue, rounded corners=3pt,
                  align=center, minimum height=1.1cm, inner sep=5pt},
    accent/.style={block, fill=paleskyblue},            % 強調ブロック
    ng/.style={block, draw=crimsonred, fill=mistyrose}, % NG・警告
    sum/.style={draw=navy, fill=white, circle, inner sep=1.5pt},
    ext/.style={draw=darkgray, dashed, fill=white, rounded corners=3pt,
                align=center, inner sep=5pt},
    zone/.style={draw=paleskyblue, fill=none, rounded corners=8pt, inner sep=10pt},
    zlabel/.style={anchor=south, font=\bfseries, text=navy},
    sig/.style={font=\footnotesize, text=darkgray, inner sep=2pt},
    dot/.style={circle, fill=navy, inner sep=1.4pt},
    wire/.style={->, draw=navy},
  ]
  % ブロックの見た目は block / accent / ng の3種類だけ．ゾーンごとに色を変えない
  % 擬似コード埋め込み: \node[algo=…, algo-focus={…}, algo-focus color=paleskyblue, …]
```

- **横一列のプロセス図**は，Step ラベル（`azureblue` 文字）／ブロック／補足文字（`darkgray`）を
  縦に重ねた列を作り，`right=… of` で横に並べる．ブロック幅は `minimum width` で揃える:

```latex
  step/.style={font=\footnotesize\bfseries, text=azureblue},
  note/.style={font=\footnotesize, text=darkgray, align=center},
  % ↑ tikzpicture のオプションに追加
  \node[block, minimum width=3.0cm] (b1) {データ準備};
  \node[block, minimum width=3.0cm, right=1.2cm of b1] (b2) {学習};
  \foreach \n/\s/\t in {b1/Step 1/日次→週次に集計, b2/Step 2/NUTS 500 draws} {
    \node[step, above=2mm of \n] {\s};
    \node[note, below=2mm of \n] {\t};
  }
  \draw[wire] (b1) -- (b2);
```

- 配置は `right=1.5cm of prev` / `below=1.5cm of node` / `at (a |- b)` を使う
- 信号ラベルは `node[midway, above, sig] {$v_{\mathrm{target}}$}`
- 加算点の符号は `node[pos=0.92, below, sig] {$+$}` のように矢印の端に置く
- ゾーン背景は fit + 共有座標で高さを揃える:

```latex
\coordinate (ztop) at ($(topnode.north)+(0,0.25)$);
\coordinate (zbot) at ($(bottomline)+(0,-0.3)$);
\begin{scope}[on background layer]
  \node[zone, fit=(a)(b)(a |- ztop)(a |- zbot)] (zlow) {};
\end{scope}
\node[zlabel] at (zlow.north) {低速：$T_c=30$--$60\,$Hz（…）};
```

#### Rust エンジンで書ける範囲

ここに無い機能は使わない．https://tikz.dev/ （PGF/TikZ 公式マニュアル）は記法の確認用で，
**載っていても tikzc が対応しているとは限らない**．正式な対応範囲は [RUST_ENGINE.md](https://github.com/RyoNakagami/tikzc/blob/main/docs/RUST_ENGINE.md)．

| 用途 | 使える書き方 | 使えない書き方（エラー）→ 代替 |
|---|---|---|
| ノード形状 | `rectangle` `circle` `ellipse` `diamond` `cylinder, shape border rotate=90` | `trapezium` `rounded rectangle` `regular polygon` `isosceles triangle` `cloud` `signal` `rectangle split` 横向き `cylinder` → 矩形＋`rounded corners` で代用 |
| 相対配置 | `right=1.5cm of a` `below right=5mm and 1cm of a` `node distance=…` `on grid`（中心間距離） `xshift`/`yshift` `anchor=…` | `right of=a`（旧記法） → `right=… of`／`on grid` 下で `fit` と `of` 配置の併用 |
| 座標 | `\coordinate (c) at (…);` `(a \|- b)` `(a -\| b)` `($(a)+(1,0)$)` `($(a)!0.5!(b)$)` `($(a)!1cm!(b)$)` `([yshift=4mm]a.north)` `(a.30)` `+(…)` `++(…)` `x=0.5cm` `y=2cm` `z=…`（単位ベクトル） `(x,y,z)` | `\coordinate[right=1cm of a] (c);` → `\node[coordinate, right=1cm of a] (c) {};`／`let \p1=…`・射影 `!(c)!`・`$(a)+0.5*(1,1)$` → 明示座標で書く |
| パス | `--` `-\|` `\|-` `to[bend left=30]` `to[out=90,in=180]` `.. controls .. and ..` `arc[start angle=,end angle=,radius=]` `rectangle` `circle` `cycle` `rounded corners=4pt` `grid[step=1]` パス内 `foreach \x in {…} { -- (\x,0) }` | `edge` `to[loop above]` `arc[delta angle=]` → `\draw … to …` で書く |
| パス上の名前 | `-- (b) coordinate[pos=0.3] (m)` `node[coordinate, midway] (m) {}` | `-- coordinate (m) (b)`（終点より前の coordinate） |
| ラベル位置 | `midway` `pos=0.92` `near start` `near end` `at start` `at end` `above=2pt` `sloped` `swap` `auto` | `very near start` `very near end` → `pos=0.1` / `pos=0.9` |
| 矢印 | `->` `<-` `<->` `\|<->\|` `>=Latex` `>=Stealth` `>=latex` `>=stealth` `-Latex` `-Stealth` `-latex` `Stealth-Stealth` `Latex-{Stealth[open]}` `-{Latex[length=3mm,width=2mm]}` `-{Triangle[open]}` `shorten >=2pt` | `->>` `-{Circle}` `-o` `-{Latex[round]}` → `->` と `>=…`，または `-{Latex}` |
| 線種 | `thin`〜`ultra thick` `dashed` `dotted` `densely dashed` `loosely dashed` `dash dot` `dash dot dot`（`densely`/`loosely` 付き，`dashdotted` `dashdotdotted` も可） `dash pattern=on 2pt off 1pt` `double` `double distance=`（パス・`draw` 付きノードの二重枠） `line width=` | `dash phase` → `dash pattern=` |
| 色 | `\definecolor{c}{HTML}{1F77B4}`（`rgb` `RGB` `gray` も可）．xcolor 基本色・`red!30` などの混色も描けるが，**Palette 節の10色以外は使わない** | `\colorlet` dvips 色名（`ForestGreen` 等） → `\definecolor` |
| 塗り・透過 | `fill=` `opacity=` `fill opacity=` `draw opacity=` `pattern=north east lines` `blue!\p!white`（計算値での混色，0〜100） `\shade` / `\shadedraw` と `left color`/`right color` `top color`/`bottom color`（`middle color` 可） `inner color`/`outer color` | `shading=ball` `ball color` `shading angle` `drop shadow` `semitransparent` → `opacity=0.5`／混色の割合が 0〜100 の外（`blue!150!white`） |
| スタイル | `/.style` `/.append style` `/.default` `#1`（引数1つ） `every node/.style` `\tikzset` | `/.style 2 args` `\tikzstyle` → 引数1つのスタイルを分ける |
| レイヤ・枠 | `\begin{scope}[on background layer]` `fit=(a)(b)` `inner xsep`/`inner ysep` `label=above:…` `label=north east:…`（アンカー名） `label={[xshift=2mm]above:…}` | `show background rectangle` `pin=` `overlay` `baseline` |
| テキスト整形 | `text width=3cm` `align=center/left/right` `\\` `\\[2pt]` `minimum width/height/size` `inner sep` | `text centered` `align=flush left` `text height`/`text depth` `\centering` `\par` `\newline` `\parbox` `minipage` `itemize` → `align=` と `\\` |
| 文字装飾 | `\textbf` `\bfseries`（Noto のみ有効） `\texttt`（中の `--` はハイフンのまま） `\verb\|…\|` `\textsf` `\underline` `\textcolor{c}{…}` `{\color{c} …}` サイズ（`\tiny`〜`\Huge`） `\hspace` `\phantom` `\quad` `\,` `~` | `\textsuperscript` `\textsubscript` `\fbox` `\colorbox` `\rule` `\hfill` → 上付き・下付きは数式 `$^2$` で |
| 記号 | Unicode 直書き（`→ ⇒ ① ※ ℃ ± × μ Ω ✓`）．`\%` `\&` `\#` `\_` `\dots` `--` `---` | `\textrightarrow` `\textbullet` `\textdegree` `\textmu` `\checkmark` `\copyright` `\LaTeX` アクセント（`\'e`） → Unicode 文字を直接書く |
| 繰り返し・マクロ | `\foreach \i in {1,...,3}` `\foreach \i/\t in {1/a,2/b}` `[count=\j from 1]` `[evaluate=\v as \w using \v*2]` `[remember=\v as \p (initially 0)]` `\foreach \n in \list`（マクロに入れたリスト） `\def` `\newcommand`（必須引数のみ） `\pgfmathsetmacro` `\pgfmathtruncatemacro` `\ifnum` `\ifodd` `\ifdim` と `\else` `\fi`（入れ子・マクロ内・ループ内可．比較対象は数字か値マクロ1つ） `\pgfmathsetmacro{\c}{\v>50 ? "red" : "blue"}`（色・スタイル名の選択） | `\ifx` `\ifthenelse` 省略可能引数 `[parse=…]` `[var=…]` → `\ifnum` か pgfmath の `ifthenelse(c,a,b)` / `c ? a : b` |
| 計算・数値 | 四則・`^`，`sqrt` `exp` `ln` `log10` `abs` `min` `max` `mod` `floor` `ceil` `round` `sin`/`cos`（度） `tanh` `atan2` `pi` `e`，ラジアン接尾辞 `cos(\t r)`，比較 `< > <= >= == !=` と `&& \|\| !`，`rnd` `rand` `random(a,b)` と `\pgfmathsetseed{n}`（シード固定で決定的．TeX と同じ乱数列ではない），`\pgfmathprintnumber[fixed,precision=2,zerofill]{…}` | `\pgfmathprintnumber[sci]` `[std]` `[int detect]` |
| その他 | `\matrix[matrix of nodes]` 直線の `decoration={brace}` `tabular`（`l/c/r` と `\|`，`\hline`） `plot coordinates` 関数 plot `plot (\x,{f(\x)})`（`domain=` `samples=`2〜10000 `variable=` `smooth`） plot マーカー `mark=*`/`o`/`x`/`+` `only marks` `mark size=` `name path=A` と `name intersections={of=A and B, by={p}, total=\t}` 途中矢印 `postaction={decorate}, decoration={markings, mark=at position 0.5 with {\arrow{Stealth}}}`（中身は `\arrow{…}` `\node…;` `\fill`/`\draw` のみ） | `\pic` `snake`/`zigzag` 装飾 `mark=between positions` `plot file`（図から他ファイルは読まない） `plot function`（gnuplot） `pgfplots` の `axis` 交点の `sort by` `help lines` `samples=1` |

**数式**（`$…$` のみ．`\(…\)` `\[…\]` はエラー）は LaTeX 数式の一部だけが通る:

- 使える: 添字・上付き，ギリシャ文字，`\frac` `\displaystyle`，`\hat` `\dot` `\ddot` `\tilde` `\bar` `\vec`
  `\widehat` `\overline`，`\mathrm` `\mathit` `\mathsf` `\mathtt` `\mathcal` `\mathbb` `\text`，
  太字は `\mathbf` / `\bm` / `\boldsymbol`，`\sum` `\int` `\prod` `\lim` `\arg\min` `\sin` 等，
  `\operatorname{sat}` `\operatorname*{arg\,max}`，`\sqrt{x}` `\sqrt[3]{x}`，`\partial`，
  `\left( \right)` `\|x\|` `\lfloor \rfloor` `\langle \rangle`，関係・演算子（`\leq` `\approx` `\times` `\cdot` `\pm` `\to` `\in` `\top`
  `\odot` `\oplus` `\otimes` `\ominus` `\cap` `\cup` …），`\underset` `\overset` `\underbrace` `\overbrace`，
  `cases`，`smallmatrix` `pmatrix` `bmatrix`
- **使えない（エラー）**: `\dfrac` `\tfrac` → `\frac`／`matrix` `array` → `pmatrix` か `smallmatrix`／
  `\hbar` `\stackrel` → `\overset`／`\xrightarrow`／数式内の `\textbf` `\textrm`
- `\perp\!\!\!\perp`（独立記号）は通るが，連続した `\!` は1つ分しか効かず TeX より幅が広い

#### TeX 版 TikZ と見た目が変わる点

エラーにはならないが TeX と結果が違う．書く時点で織り込む:

- **太字・斜体**: `\bfseries` / `\textbf` は `Noto Sans CJK JP` のときだけ太くなる．
  `\itshape` / `\textit` / `\emph` はどのフォントでも無視される．強調は色・サイズ・太字で行う
- **CJK の折り返し**: `text width` を超えた日本語は**文字単位で自動折り返し**される
  （TeX 版は折り返さず，空白でのみ改行していた）．「相対把持位／置」のように語の途中で切れるので，
  2行以上になる日本語ラベルは必ず `\\` で改行位置を指定する
- **和欧文間の空き**: 「EE位置」「5指」「1回」のように半角英数字と日本語が隣り合うと
  間に四分アキ程度の空白が自動で入り，その分だけ行が長くなる
- **数式の添字**: `$x_{\mathrm{ref}}$` の添字は数式用セリフ体になる（本文フォントにはならない）．
  添字に `\text{…}` を使うと小さく下がりすぎるので `\mathrm{…}` を使う．
  条件付き添字は `$\hat{x}_{k\mid k-1}$` と書く（`k|k-1` だと `|` の前後が広く空く）
- **引用符**: ` ``…'' ` はそのままバッククォートとして出る．`“…”` か `「…」` を直書きする
- **PNG 解像度**: 既定 150 dpi（旧 TeX 版は 300 dpi 相当）．同じ図でもピクセル数は約半分になる．
  スライドに貼って粗ければ `--dpi 300` を付ける
- **`\pgfmathsetmacro` の値**: `2*3` は `6` になる（TeX は `6.0`）．ラベルに数値を出すときは
  `\pgfmathprintnumber` か `\pgfmathtruncatemacro` を使う
- フォントメトリクス・ベースライン・曲線上ラベル位置・矢じりの形・図形のパディングは
  TeX とピクセル一致しない．数 pt の差で枠内に収まるかが変わるので，余白はぎりぎりに詰めない

#### 1.1.0 で挙動が変わった点（TeX に合わせた修正）

1.0.0 で描いた図を更新するとき，および古い `tikzc` と結果が食い違うときに確認する:

- **対角配置の距離**: `above right=1cm of a` のように斜め方向で距離を1つだけ書くと，
  各軸の移動量は 1cm ではなく **1/√2 cm（約 0.71cm）** になる（距離を対角線に沿って測る）．
  `node distance` を省略値として使う `above right=of a` も同じ．
  縦横の量を直接決めたいときは `below right=5mm and 1cm of a`（縦 and 横）と2つ書く
- **操作から始まるパス**: `\draw circle (1);` `\fill rectangle (1,1);` のように座標なしで始まるパスの始点は，
  キャンバス原点ではなく**現在の座標系の原点**になる．`shift` / `rotate` / `scale` 付きの
  scope やパスの中でだけ結果が変わる．意図を明確にするため，始点は `(0,0)` と明示して書く

#### 擬似コード（algorithm 環境）

1.3.0 から pseudocode.js 構文の `algorithm` 環境を擬似コードとして描ける．
詳細（対応コマンド・全ヘッダ・lint 一覧）は [PSEUDOCODE.md](https://github.com/RyoNakagami/tikzc/blob/main/docs/PSEUDOCODE.md)，実例は [tests/fixtures](https://github.com/RyoNakagami/tikzc/tree/main/tests/fixtures) の `algo-*.tikz`．

- **描き方は3通り**（サブコマンドは無く，ファイルの中身で決まる）:
  1. `algorithm` 環境だけのファイル → 擬似コード単体
  2. 図の中に `\node[algo=<名前またはファイル>, anchor=north west] (A) at (x,y) {};` → 図に埋め込み
     （`algo=ista.tikz` で別ファイルの最初の algorithm を参照．パスは .tikz からの相対）
  3. `algo=` ノード無しで図と algorithm を同じファイルに書く → `#| layout: algo-left`
     （`algo-right` / `algo-top` / `algo-bottom`）で図の横に配置
- **対応構文**: `\PROCEDURE`/`\FUNCTION`，`\IF`/`\ELSIF`/`\ELSE`，`\FOR`/`\FORALL`，`\WHILE`，
  `\REPEAT`/`\UNTIL`，`\LOOP`，`\STATE` `\RETURN` `\REQUIRE` `\ENSURE` `\INPUT` `\OUTPUT` `\COMMENT`，
  文中の `\CALL{Name}{args}` `\TRUE` `\AND` `\TO` 等．文中にはノードラベルと同じ数式・日本語が書ける．
  未知のコマンドは `[algo-unknown-cmd]`，開始と終了の対応ずれは `[algo-unbalanced]` で止まる

```latex
#| line-number: true
\definecolor{navy}{HTML}{0E3666}
\definecolor{azureblue}{HTML}{428CE6}
\definecolor{paleskyblue}{HTML}{B4D7FF}
\begin{algorithm}[name=ista]
\caption{ISTA for Lasso}
\begin{algorithmic}
\PROCEDURE{ISTA}{$X, y, \lambda$}
  \STATE $\beta \gets 0$
  \REPEAT
    \STATE $\beta \gets S_{\lambda}(\beta + X^{\top} r / n)$
    % @ref sparse-corner
    % @explain ソフト閾値で係数を0へ縮小
  \UNTIL{$\|\Delta\beta\| < \mathrm{tol}$}
  \RETURN $\beta$
\ENDPROCEDURE
\end{algorithmic}
\end{algorithm}

\begin{tikzpicture}
  \fill[navy] (1.5,0) coordinate (corner) circle (2pt);
  \node[algo=ista, algo-focus={sparse-corner}, algo-focus color=paleskyblue,
        font=\small, anchor=north west] (A) at (4.5,2.5) {};
  \draw[->, azureblue, rounded corners] (A-sparse-corner.west) -| (corner);
\end{tikzpicture}
```

- **行と図をつなぐ**: 名前付き `algo=` ノード `(A)` の各行は `(A-<行番号>)` と `(A-<@ref ID>)` という
  ノードになり，`west` / `east` 等のアンカーと `-|` `to[bend left]` などの通常のパスで矢印を引ける．
  `algo-focus={5,<id>}` で行を強調（`algo-focus color=` で色．既定は `orange!20` なので必ず `algo-focus color=paleskyblue` を付ける）
- **注記コメント**: `% @src paper=eq3.4 impl=est.py:131`（出典），`% @ref <id>`（図の `\node[ref=<id>]` に
  行番号を表示），`% @explain …`（擬似コード下に行番号付きで列挙）．行末に書けばその行，
  単独行なら直前の文に付く．`@ref` があると行番号は自動で付く．
  `impl` ヘッダは `owner/repo@rev` とリビジョン必須（無いと `[impl-no-rev]`）
- **スライド用**: `#| canvas: 1600x900` で図・擬似コード・矢印全体をキャンバスに収めて中央に置く．
  `algo=` ノードがあると `canvas` 以外の配置ヘッダは無視される（`layout-conflict` 警告）
- **書体と大きさ**: 擬似コードは Computer Modern（日本語は IPAex 明朝）で組まれ，`mainfont` に従わない．
  Noto ゴシックの図と並べると書体が揃わないことを織り込む．大きさは `algo=` ノードの `font=`
  （既定 10pt）で決まるので，周囲のラベルに合わせて `font=\small` 等を付ける
- 日本語の句読点 `，．` ・数式の書き方の規則は擬似コード内でも同じ

### Step 4: コンパイルと目視検証（必須ループ）

```sh
tikzc --version                            # 擬似コードを使うなら 1.3.0 以上
# 構文チェックのみ（出力なし，数十 ms）
tikzc check <path/to/file>.tikz
# SVG と PNG を .tikz と同じディレクトリに出力
tikzc <path/to/file>.tikz --format both
# スライド用に高解像度 PNG が要るとき
tikzc <path/to/file>.tikz --format both --dpi 300
```

`tikzc` が無いときは `cargo install --git https://github.com/RyoNakagami/tikzc tikzc --locked` で入れる
（Rust 1.92 以上が必要．入れる前にユーザーに確認する）．古くて挙動が食い違うときも同じコマンドで更新する．
tikzc のソースリポジトリ内で作業しているときは `tikzc` を `cargo run --release --locked -q --` に置き換える．

未対応の構文は `file:line:column: Unsupported option 'xxx'` 形式の診断で失敗する（終了コード 3）．
診断は**最初の1件だけ**で，位置は原因のオプションやパス操作（`plot` `grid` 座標など）を指す．
特定できないときは該当する文（`\node` / `\draw`）の先頭を指す．
メッセージ中の名前を上の表で引いて代替の書き方に直し，通るまで `check` を繰り返す．
`unknown variable: mitex…` / `unknown symbol modifier` は数式内の未対応コマンドを意味する．
擬似コードを含むファイルでは `check` が lint も出力し（修正案付き），error があれば終了コード 3 になる．
`ref-dangling`（`@ref` に対応する `ref=` ノードが無い）・`algo-out-of-canvas` は error，
`algo-overlap`（擬似コードと図が重なる）・`ref-unused`・`algo-unplaced` は warning．warning も残さず直す．
表に無い機能がどうしても必要なら，回避せずユーザーに伝える（エンジン側の対応手順は [FEATURE_WORKFLOW.md](https://github.com/RyoNakagami/tikzc/blob/main/docs/FEATURE_WORKFLOW.md)）．

生成された PNG を Read で開いて画像を確認し，問題があれば修正して再コンパイルする．
**コンパイルが通っただけで完了としない．** チェック項目:

- [ ] ブロック内テキストが枠からはみ出していない
- [ ] 日本語が語の途中で自動折り返しされていない（されていたら `\\` を入れる）
- [ ] 矢印上のラベルが隣のブロック・他の配線と重なっていない（重なるなら gap を広げるかラベルを明示座標で置く）
- [ ] ゾーン境界・ラベルの位置が正しい（ラベルが上のノードや配線に重なっていない）
- [ ] ゾーン背景・セクション枠の矩形同士が重なっていない
- [ ] 配線の交差にジャンプ弧があり，接続と誤読されない
- [ ] +/− 符号が加算点の正しい側にある
- [ ] 太字にしたつもりの見出しが実際に太い（太くなければ mainfont を確認）
- [ ] 使っている色が Palette 節の10色だけ（下の grep で確認）
- [ ] busy になっていない：色数・枠の数・箇条書きの行数が「図の密度」節の範囲内
- [ ] 図全体の縦横比が 1.8〜2.5:1 程度（1600×900 スライド想定時．横一列プロセス図・縦に複数並べる図は
  5〜6:1 でよく，本文領域（約 650px）に収まるかで判断する）
- [ ] （擬似コード）擬似コードが図と重なっていない．行から引いた矢印が正しい行・図の要素を指している
- [ ] （擬似コード）擬似コードの文字の大きさが周囲のラベルと釣り合っている

縦横比は SVG の先頭にある `width="…pt" height="…pt"` で数値確認できる:

```sh
head -c 300 <file>.svg | grep -o 'width="[^"]*pt" height="[^"]*pt"'
```

使っている色は次で一覧できる．Palette 節にない値が出たら直す:

```sh
grep -ohi '#[0-9a-f]\{6\}' <file>.svg | tr A-F a-f | sort -u
# 許容: #0e3666 #e8f1fe #428ce6 #b4d7ff #1a1a1a #575757 #dedede #d31804 #fbe7e6 #ffffff
# 例外: #000000 は擬似コード本体の文字・罫線（tikzc 側で固定）なので許容する．
#       擬似コードの無い図で #000000 が出たら text=/draw= の指定漏れ
```

### Step 5: 完了報告

- 出力ファイルパス（.tikz / .svg / .png）を提示
- 図の構成（ゾーン・主経路・フィードバック）を2〜3文で説明

## Rules

- **日本語の改行は自分で決める**．`text width` 付きノードは文字単位で自動折り返しされ，
  `text width` なしのノードは折り返されずに横へ伸びる．どちらも意味の切れ目に `\\` を入れる．
  全角1文字の幅は `\small` で約 0.32cm，`\footnotesize` で約 0.28cm，`\scriptsize` で約 0.25cm
  （全角12文字 ≈ 3.8cm / 3.4cm / 3.0cm）．`text width` はこの幅＋和欧文間の空きを見込んで決める
- 数式変数は `$P_{\mathrm{rel}}$` のように mathrm 添字で書く．日本語は数式モードに入れない
- 日本語の句読点は `，．` を使う（`、。` は使わない）
- 矢印間ラベル（例: `$q_{\mathrm{ref}},\dot q_{\mathrm{ref}}$`）を置く区間は
  ブロック間 gap を 1.5cm 以上取る．縦線と横線ラベルの干渉は，pos 調整より
  **明示座標の `\node[sig, anchor=west] at (x,y)`** のほうが制御しやすい
- 元の説明文にある情報（周波数・変数定義・特記事項「※〜」）は省略せず図中に反映する．
  入りきらない場合は凡例ボックスか脚注ノードに逃がす
- 論文・外部資料ベースの図には出典ノード（`font=\scriptsize, text=darkgray`）を図の最下部に置く
