# Bundled fonts

These unmodified fonts are embedded in the Rust binary for offline rendering.
IPAex Mincho/Gothic: IPA Font License v1.0.
New Computer Modern Math: GUST Font License.
Font Awesome: SIL Open Font License 1.1.
Latin Modern Mono: GUST Font License (under LPPL 1.3c).
See the accompanying license notices. No runtime TeX installation is used.

New Computer Modern Math is the unmodified Regular face from package 5.1,
Antonis Tsolomitis, Samos, Greece, 2019–2024. Its upstream README is included
as `NewCM-README.gz`; the GUST license's underlying LPPL 1.3c is included as
`LPPL-1.3c.txt.gz` (read with `gzip -cd`).

Noto Sans CJK Regular/Bold are not bundled. An explicitly requested Noto
`mainfont` uses the installed system font and fails if it is unavailable.
Japanese text uses IPAex Mincho/Gothic; `\texttt` and `\ttfamily` use Latin
Modern Mono with IPAexGothic for Japanese glyphs. IPAex bold is synthesized
with a stroke rather than a separate Bold face.

Font binaries are not subsetted or renamed. IPAex notices retain upstream
copyright and redistribution terms. Font Awesome is
the original Font Awesome 4 font, not an unrestricted icon-library API.

`lmmono10-regular.otf` and `lmmono10-italic.otf` are unmodified Latin Modern
2.005 fonts (2021-03-21), copyright 2003–2021 Bogusław Jackowski and
Janusz M. Nowacki on behalf of the TeX Users Groups. Maintainer: Bogusław
Jackowski. `LM-LICENSE` and the accompanying LPPL apply; no TeX runtime is
required. These two files are the manifest of the bundled LM subset.
