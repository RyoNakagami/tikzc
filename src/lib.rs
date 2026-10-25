pub mod algo;
mod arrows;
mod curve;
mod expand;
mod expr;
pub mod options;
pub mod render;
pub mod syntax;
pub mod text;
mod transform;

pub use render::{Diagram, compile, compile_at};
pub use syntax::Diagnostic;
