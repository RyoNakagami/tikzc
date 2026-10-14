//! Audit of the math notation used in data-science diagrams (F6). Math goes
//! through mitex and Typst and is a restricted subset of LaTeX: each formula
//! that renders is pinned on its own, and commands that do not are pinned as
//! diagnostics until they are supported.
mod common;
use common::*;
use tikzc::compile;

/// The node has an extent and its label is outlined glyphs.
fn renders(formula: &str) -> f64 {
    let d =
        compile(&format!("\\node (n) {{{formula}}};")).unwrap_or_else(|e| panic!("{formula}: {e}"));
    let node = &d.nodes["n"];
    assert!(node.width > 0. && node.height > 0., "{formula}");
    assert!(
        d.svg.contains("<use ") || d.svg.matches("<path").count() > 0,
        "{formula}"
    );
    assert!(!d.svg.contains("<text"), "{formula}");
    assert!(d.png(72.).unwrap().len() > 100);
    node.width
}

macro_rules! formula_tests {
    ($($name:ident: $formula:expr,)*) => {
        $(#[test]
        fn $name() {
            renders($formula);
        })*
    };
}

// One test per formula of tests/fixtures/ds-math.tikz.
formula_tests! {
    least_squares_estimator: r"$\hat{\beta} = (X^\top X)^{-1} X^\top y$",
    conditional_expectation: r"$\mathbb{E}[Y \mid X]$",
    normal_noise: r"$\varepsilon \sim \mathcal{N}(0, \sigma^2)$",
    bold_parameters: r"$\boldsymbol{\theta}, \mathbf{W}^{(l)}$",
    negative_log_likelihood: r"$\mathcal{L}(\theta) = -\sum_{i=1}^{n} \log p(y_i \mid x_i)$",
    operator_name: r"$\operatorname{softmax}(z)_k$",
    accents: r"$\bar{y}, \tilde{x}, \hat{p}$",
    do_operator: r"$\mathrm{do}(X = x)$",
    independence: r"$Y \perp\!\!\!\perp X \mid Z$",
    arg_max: r"$\arg\max_{\theta}$",
    squared_norm: r"$\|w\|_2^2$",
    partial_derivative: r"$\frac{\partial \mathcal{L}}{\partial w}$",
}

// Further notation found while auditing; fixed together with the fixture.
formula_tests! {
    roots: r"$\sqrt{x} + \sqrt[3]{y}$",
    limits_operator: r"$\operatorname*{arg\,max}_\theta f(\theta)$",
    stacked_symbols: r"$\underset{x}{\min} \overset{d}{=}$",
    elementwise_products: r"$\mathbf{W} \odot \mathbf{M}, a \otimes b, a \oplus b$",
    sets: r"$A \cap B \cup C, \bigcap_i A_i$",
    brackets: r"$\langle x, y \rangle, \lVert x \rVert$",
    matrices: r"$\begin{pmatrix}a&b\\c&d\end{pmatrix}\begin{bmatrix}1&0\end{bmatrix}$",
    braces: r"$\underbrace{x+y}_{n} + \overbrace{z}^{m}$",
    softmax_definition: r"$\text{softmax}(z)_k = \frac{e^{z_k}}{\sum_j e^{z_j}}$",
    dataset: r"$\mathcal{D} = \{(x_i, y_i)\}_{i=1}^{n}$",
    gradient: r"$\nabla_\theta \mathcal{L}, \int_0^1 f(x)\,dx, \prod_i p_i$",
}

#[test]
fn the_fixture_renders_every_formula() {
    let d = compile_fixture("ds-math.tikz");
    assert_eq!(d.labels.len(), 12);
    assert_eq!(d.svg, compile_fixture("ds-math.tikz").svg);
}

#[test]
fn negative_thin_space_narrows_the_independence_sign() {
    let wide = renders(r"$\perp\perp$");
    let narrow = renders(r"$\perp\!\!\!\perp$");
    assert!(narrow < wide, "{narrow} >= {wide}");
    // Known residual: Typst merges the three adjacent negative thin spaces
    // into one (1/6 em at 10pt), so the sign is wider than in TeX, where
    // all three apply.
    near(wide - narrow, 10. / 6. * 72. / 72.27, 0.05);
}

#[test]
fn operator_names_are_upright() {
    // An upright operator name is set like \mathrm, not as italic variables.
    near(
        renders(r"$\operatorname{softmax}$"),
        renders(r"$\mathrm{softmax}$"),
        0.05,
    );
    assert!(renders(r"$softmax$") > renders(r"$\mathrm{softmax}$"));
}

#[test]
fn japanese_text_and_math_share_a_baseline() {
    let d = compile(
        r"\node[anchor=base] (mixed) {確率 $p$ の分布};
          \node[anchor=base] (text) at (4,0) {確率の分布};
          \node[anchor=base] (math) at (8,0) {$p$};
          \coordinate (a) at (mixed.base); \coordinate (b) at (text.base); \coordinate (c) at (math.base);",
    )
    .unwrap();
    for name in ["a", "b", "c"] {
        near(d.nodes[name].center.y, 0., 1e-4);
    }
    assert!(d.nodes["mixed"].width > d.nodes["text"].width);
    assert!(d.nodes["mixed"].width > d.nodes["math"].width);
    // The descender of p reaches below the baseline of the Japanese text.
    assert!(d.nodes["mixed"].height > d.nodes["text"].height - 1e-6);
}

#[test]
fn unsupported_math_is_a_located_diagnostic() {
    // Not defined by mitex or the bundled helpers.
    for command in [r"\independent", r"\hbar"] {
        let source = format!("\\node {{ok}};\n\\node {{${command}{{x}}$}};");
        let error = compile(&source)
            .err()
            .unwrap_or_else(|| panic!("{command}"));
        assert_eq!((error.line, error.column), (2, 1), "{error}");
    }
}
