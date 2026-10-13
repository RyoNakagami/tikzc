//! Compiler-verified source ranges and world coordinates for GUI path handles.
use super::{Engine, Point};
use crate::transform::Matrix;

impl Engine<'_> {
    pub(super) fn path_handle(&self, start: usize, end: usize, point: Point, kind: &str) -> Result<serde_json::Value, String> {
        let shift = self.state.canvas_shift;
        let mut matrix = Matrix::from_options(&self.state.options)?.0;
        matrix[4] += shift.x;
        matrix[5] += shift.y;
        Ok(serde_json::json!({
            "start": self.expanded.origin(start), "end": self.expanded.origin(end-1)+1,
            "x": point.x+shift.x, "y": point.y+shift.y,
            "kind": kind, "replacement": "coordinate",
            "matrix": matrix, "canvasShift": [shift.x,shift.y],
        }))
    }

    pub(super) fn path_local_coordinate(&self, point: Point) -> Result<String, String> {
        let [x,y] = Matrix::from_options(&self.state.options)?.inverse_point(point.x,point.y);
        Ok(format!("({x:.8}bp,{y:.8}bp)"))
    }

    pub(super) fn path_coordinate_edit(&self, start: usize, end: usize, point: Point) -> Result<serde_json::Value, String> {
        Ok(serde_json::json!({
            "start": self.expanded.origin(start), "end": self.expanded.origin(end-1)+1,
            "text": self.path_local_coordinate(point)?,
        }))
    }
}
