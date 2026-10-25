//! Placement of a pseudocode block next to a figure (`#| layout:` & co.).
//!
//! All values are output points (1px = 0.75pt) with y pointing down; the
//! figure keeps its own coordinates and is only scaled to fit a canvas.
use super::{Align, Settings, Side};

pub const PX: f64 = 0.75;

/// Where the pseudocode and the figure go on the canvas.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Placement {
    pub canvas: (f64, f64),
    /// Figure scale and top-left corner.
    pub figure_scale: f64,
    pub figure: (f64, f64),
    pub figure_size: (f64, f64),
    /// Pseudocode scale and top-left corner.
    pub algo_scale: f64,
    pub algo: (f64, f64),
    pub algo_size: (f64, f64),
}

/// Offset of `anchor` from the top-left corner of a `w`x`h` box.
pub fn anchor_offset(anchor: &str, w: f64, h: f64) -> Result<(f64, f64), String> {
    let (x, y) = match anchor {
        "north west" => (0., 0.),
        "north" => (0.5, 0.),
        "north east" => (1., 0.),
        "west" => (0., 0.5),
        "center" => (0.5, 0.5),
        "east" => (1., 0.5),
        "south west" => (0., 1.),
        "south" => (0.5, 1.),
        "south east" => (1., 1.),
        _ => {
            return Err(format!(
                "unknown algo-anchor '{anchor}'; use north west, north, center, south east, ..."
            ));
        }
    };
    Ok((x * w, y * h))
}

fn aligned(align: Align, room: f64, size: f64) -> f64 {
    match align {
        Align::Start => 0.,
        Align::Center => (room - size) / 2.,
        Align::End => room - size,
    }
}

/// Lay out `algo` (unscaled pseudocode size) and `figure` (figure size).
pub fn place(
    settings: &Settings,
    algo: (f64, f64),
    figure: (f64, f64),
) -> Result<Placement, String> {
    let k = settings.scale;
    let (aw, ah) = (algo.0 * k, algo.1 * k);
    let (fw, fh) = (figure.0.max(1e-6), figure.1.max(1e-6));
    let gap = settings.gap * PX;
    let horizontal = matches!(settings.layout, Side::Left | Side::Right);
    // Main axis: pseudocode, gap, figure. Cross axis: `align`.
    let (main_a, cross_a, main_f, cross_f) = if horizontal {
        (aw, ah, fw, fh)
    } else {
        (ah, aw, fh, fw)
    };
    // Natural layout (as without `canvas`); a canvas then zooms it as a
    // whole, so the pseudocode and the figure keep their relative sizes.
    let natural = (main_a + gap + main_f, cross_a.max(cross_f));
    let (canvas, s, offset) = match settings.canvas {
        Some((w, h)) => {
            let (main, cross) = if horizontal {
                (w * PX, h * PX)
            } else {
                (h * PX, w * PX)
            };
            let s = (main / natural.0).min(cross / natural.1);
            (
                (main, cross),
                s,
                ((main - natural.0 * s) / 2., (cross - natural.1 * s) / 2.),
            )
        }
        None => (natural, 1., (0., 0.)),
    };
    let first_algo = matches!(settings.layout, Side::Left | Side::Top);
    let (f_main, a_main) = if first_algo {
        (main_a + gap, 0.)
    } else {
        (0., main_f + gap)
    };
    let f_main_pos = offset.0 + f_main * s;
    let a_main_pos = offset.0 + a_main * s;
    let f_cross_pos = offset.1 + aligned(settings.align, natural.1, cross_f) * s;
    let a_cross_pos = offset.1 + aligned(settings.align, natural.1, cross_a) * s;
    let (main, cross) = canvas;
    let swap = |m: f64, c: f64| if horizontal { (m, c) } else { (c, m) };
    let mut algo_pos = swap(a_main_pos, a_cross_pos);
    if let Some((x, y)) = settings.at {
        let (dx, dy) = anchor_offset(&settings.anchor, aw * s, ah * s)?;
        algo_pos = (x * PX - dx, y * PX - dy);
    }
    algo_pos.0 += settings.shift.0 * PX;
    algo_pos.1 += settings.shift.1 * PX;
    Ok(Placement {
        canvas: swap(main, cross),
        figure_scale: s,
        figure: swap(f_main_pos, f_cross_pos),
        figure_size: (fw * s, fh * s),
        algo_scale: k * s,
        algo: algo_pos,
        algo_size: (aw * s, ah * s),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn natural_canvas_is_the_sum() {
        let p = place(&Settings::default(), (100., 60.), (200., 80.)).unwrap();
        assert_eq!(p.canvas, (100. + 36. + 200., 80.));
        assert_eq!(p.figure_scale, 1.);
        assert_eq!(p.algo, (0., 10.));
        assert_eq!(p.figure, (136., 0.));
    }
    #[test]
    fn canvas_zooms_the_natural_layout() {
        let settings = Settings {
            canvas: Some((1600., 900.)),
            layout: Side::Top,
            align: Align::Start,
            ..Default::default()
        };
        let p = place(&settings, (300., 150.), (100., 100.)).unwrap();
        assert_eq!(p.canvas, (1200., 675.));
        // Natural: 300 wide, 150 + 36 + 100 tall; the height limits the zoom.
        let s = 675. / 286.;
        assert_eq!(p.figure_scale, s);
        assert_eq!(p.algo_scale, s);
        let left = (1200. - 300. * s) / 2.;
        assert_eq!(p.algo, (left, 0.));
        assert_eq!(p.figure, (left, 186. * s));
        // A tight canvas only shrinks everything.
        let tight = Settings {
            canvas: Some((100., 100.)),
            ..Default::default()
        };
        let p = place(&tight, (300., 10.), (1., 1.)).unwrap();
        assert!(p.algo_size.0 <= 75. && p.figure_scale < 1.);
    }
    #[test]
    fn manual_position_and_shift() {
        let settings = Settings {
            at: Some((40., 40.)),
            anchor: "center".into(),
            shift: (4., -4.),
            scale: 2.,
            ..Default::default()
        };
        let p = place(&settings, (10., 10.), (50., 50.)).unwrap();
        assert_eq!(p.algo, (30. - 10. + 3., 30. - 10. - 3.));
        assert_eq!(p.algo_size, (20., 20.));
    }
}
