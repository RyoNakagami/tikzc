//! Share self-contained Typst outline symbols; keep other label IDs local.
use resvg::usvg::roxmltree::{Document, Node};
use std::collections::BTreeMap;
use std::ops::Range;

#[derive(Default)]
pub(super) struct GlyphDefinitions {
    entries: Vec<(String, String)>,
    indices: BTreeMap<String, usize>,
}

impl GlyphDefinitions {
    pub(super) fn checkpoint(&self) -> usize {
        self.entries.len()
    }

    pub(super) fn rollback(&mut self, checkpoint: usize) {
        for (id, _) in self.entries.drain(checkpoint..) {
            self.indices.remove(&id);
        }
    }

    pub(super) fn svg(self) -> Result<String, String> {
        let mut output = String::new();
        for (_, svg) in self.entries {
            let doc = Document::parse(&svg).map_err(|e| e.to_string())?;
            let mut edits = Vec::new();
            for path in doc.descendants().filter(|n| n.has_tag_name("path")) {
                if let Some(d) = path.attribute_node("d") {
                    edits.push((
                        d.range_value(),
                        super::glyph_path::round_path(d.value(), 4)?,
                    ));
                }
            }
            output.push_str(&apply_edits(&svg, edits));
        }
        Ok(output)
    }

    pub(super) fn embed(&mut self, svg: &str, label: usize) -> Result<String, String> {
        let doc = Document::parse(svg).map_err(|e| format!("invalid label SVG: {e}"))?;
        let root = doc.root_element();
        let mut ids = BTreeMap::new();
        let mut candidates = Vec::new();
        for node in root.descendants().filter(Node::is_element) {
            // Typst's label SVG uses attribute references, not CSS selectors.
            // Fail explicitly rather than rewriting an unknown stylesheet.
            if node.has_tag_name("style") {
                return Err("unsupported stylesheet in label SVG".into());
            }
            if let Some(id) = node.attribute("id") {
                if ids.contains_key(id) {
                    return Err(format!("duplicate label SVG id '{id}'"));
                }
                if shareable(node, root, id) {
                    let definition = &svg[node.range()];
                    if let Some(&index) = self.indices.get(id)
                        && self.entries[index].1 != definition
                    {
                        return Err(format!("conflicting glyph definition '{id}'"));
                    }
                    candidates.push((id, definition, node.range()));
                    ids.insert(id, id.to_owned());
                } else {
                    ids.insert(id, format!("label{label}-{id}"));
                }
            }
        }
        let mut edits = Vec::new();
        for node in root.descendants().filter(Node::is_element) {
            if candidates.iter().any(|(_, _, range)| {
                range.start <= node.range().start && node.range().end <= range.end
            }) {
                continue;
            }
            for attr in node.attributes() {
                let value = if attr.name() == "id" {
                    ids.get(attr.value()).cloned().unwrap()
                } else if attr.name() == "href" {
                    if let Some(id) = attr.value().strip_prefix('#') {
                        format!(
                            "#{}",
                            ids.get(id)
                                .ok_or_else(|| format!("missing label SVG id '{id}'"))?
                        )
                    } else {
                        attr.value().into()
                    }
                } else {
                    rewrite_urls(attr.value(), &ids)?
                };
                if value != attr.value() {
                    edits.push((attr.range_value(), escape_attribute(&value)));
                }
            }
        }
        // Commit only after all IDs/references have been validated.
        for (id, definition, range) in candidates {
            if !self.indices.contains_key(id) {
                self.indices.insert(id.into(), self.entries.len());
                self.entries.push((id.into(), definition.into()));
            }
            edits.push((range, String::new()));
        }
        Ok(apply_edits(svg, edits))
    }
}

fn shareable(node: Node<'_, '_>, root: Node<'_, '_>, id: &str) -> bool {
    let id_bytes = id.as_bytes();
    if id_bytes.len() != 33
        || id_bytes[0] != b'g'
        || !id_bytes[1..].iter().all(u8::is_ascii_hexdigit)
        || !node.has_tag_name("symbol")
        || node
            .attributes()
            .any(|a| !matches!(a.name(), "id" | "overflow"))
        || node.attribute("overflow") != Some("visible")
    {
        return false;
    }
    let Some(parent) = node.parent() else {
        return false;
    };
    // Moving a definition must not lose inherited paint or transforms.
    if !parent.has_tag_name("defs")
        || parent.attributes().len() != 0
        || parent.parent() != Some(root)
        || root
            .attributes()
            .any(|a| !matches!(a.name(), "viewBox" | "width" | "height"))
    {
        return false;
    }
    node.children().all(|n| {
        (n.is_text() && n.text().unwrap_or("").trim().is_empty())
            || (n.has_tag_name("path")
                && n.children().next().is_none()
                && n.attribute("d").is_some()
                && n.attributes()
                    .all(|a| a.name() == "d" && a.namespace().is_none()))
    })
}

fn rewrite_urls(value: &str, ids: &BTreeMap<&str, String>) -> Result<String, String> {
    let mut out = String::new();
    let mut rest = value;
    while let Some(start) = rest.find("url(") {
        out.push_str(&rest[..start + 4]);
        rest = &rest[start + 4..];
        let end = rest.find(')').ok_or("invalid SVG url reference")?;
        let target = rest[..end].trim().trim_matches(['\'', '"']);
        if let Some(id) = target.strip_prefix('#') {
            out.push('#');
            out.push_str(
                ids.get(id)
                    .ok_or_else(|| format!("missing label SVG id '{id}'"))?,
            );
        } else {
            out.push_str(&rest[..end]);
        }
        out.push(')');
        rest = &rest[end + 1..];
    }
    out.push_str(rest);
    Ok(out)
}

fn escape_attribute(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('\'', "&apos;")
        .replace('<', "&lt;")
}

pub(super) fn apply_edits(source: &str, mut edits: Vec<(Range<usize>, String)>) -> String {
    edits.sort_by_key(|(range, _)| range.start);
    let mut out = String::with_capacity(source.len());
    let mut offset = 0;
    for (range, value) in edits {
        out.push_str(&source[offset..range.start]);
        out.push_str(&value);
        offset = range.end;
    }
    out.push_str(&source[offset..]);
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    const ID: &str = "g0123456789abcdef0123456789ABCDEF";
    fn label(path: &str) -> String {
        format!(
            r##"<svg xmlns="http://www.w3.org/2000/svg"><defs><symbol id="{ID}" overflow="visible"><path d="{path}"/></symbol><clipPath id="clip"><path d="M0 0L1 1"/></clipPath><linearGradient id="gradient"/><mask id="mask"><use href="#clip"/></mask></defs><g clip-path="url(#clip)" style="fill:url('#gradient')" mask="url(#mask)"><use href="#{ID}"/></g></svg>"##
        )
    }
    #[test]
    fn sharing_namespaces_collisions_and_rollback() {
        let mut defs = GlyphDefinitions::default();
        let svg = label("M0 0L1 1");
        let a = defs.embed(&svg, 0).unwrap();
        let checkpoint = defs.checkpoint();
        let b = defs.embed(&svg, 1).unwrap();
        assert_eq!(defs.checkpoint(), 1);
        assert!(!a.contains("<symbol"));
        assert!(a.contains(&format!("href=\"#{ID}\"")));
        assert!(a.contains("url(#label0-clip)"));
        assert!(b.contains("url(#label1-gradient)"));
        assert!(b.contains("href=\"#label1-clip\""));
        assert!(
            defs.embed(&label("M0 0L2 2"), 2)
                .unwrap_err()
                .contains("conflicting")
        );
        assert_eq!(defs.checkpoint(), checkpoint);
        let other = svg.replace(ID, "g1123456789abcdef0123456789ABCDEF");
        defs.embed(&other, 2).unwrap();
        defs.rollback(checkpoint);
        assert_eq!(defs.checkpoint(), 1);
        defs.embed(&other, 3).unwrap();
        assert_eq!(defs.checkpoint(), 2);
        defs.rollback(0);
        assert!(defs.indices.is_empty());
        defs.embed(&svg, 4).unwrap();
        assert_eq!(defs.svg().unwrap().matches("<symbol").count(), 1);
    }
    #[test]
    fn unknown_symbols_stay_local_and_invalid_references_fail() {
        for svg in [
            label("M0 0").replace(ID, "g123"),
            label("M0 0").replace("<defs>", "<defs fill=\"red\">"),
            label("M0 0").replace("<path d=", "<path fill=\"red\" d="),
        ] {
            let mut defs = GlyphDefinitions::default();
            let out = defs.embed(&svg, 7).unwrap();
            assert_eq!(defs.checkpoint(), 0);
            assert!(out.contains("id=\"label7-g"));
            assert!(out.contains("href=\"#label7-g"));
        }
        let mut defs = GlyphDefinitions::default();
        assert!(
            defs.embed(&label("M0 0").replace("url(#clip)", "url(#absent)"), 0)
                .is_err()
        );
        assert_eq!(defs.checkpoint(), 0);
    }
}
