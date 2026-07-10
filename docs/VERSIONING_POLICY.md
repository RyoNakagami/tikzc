---
date-modified: "2026-07-10"
project: tikzc
---

# Versioning Policy

- Versioning of `tikzc` follows [Semantic Versioning](https://semver.org/)
- Release numbers are managed in the `MAJOR.MINOR.PATCH` format

## MAJOR.MINOR.PATCH

| Release Type | Main Contents | Backward Compatibility | Typical Example |
| :-------------- | :---------- | :------------ | :------------ |
| **Major Release** | - Backward-incompatible changes (breaking changes)<br>- Removal of deprecated features<br>- API updates involving specification changes<br>- Changes included in a major release are recorded in the **Release Note** | ❌ No | `v1.0.0 → v2.0.0` |
| **Minor Release** | - Addition of new features<br>- Large-scale bug fixes<br>- Deprecation announcements | ✅ Yes | `v1.1.0 → v1.2.0` |
| **Patch Release** | - Bug fixes<br>- Stability and performance improvements (non-breaking)<br>- Guarantees that existing code continues to work without issues | ✅ Yes | `v1.2.1 → v1.2.2` |

---

### Deprecation Policy

`tikzc` handles deprecation according to the following policy.

1. Deprecations are announced in a **Minor Release**.
2. Warning messages explicitly state the following two points:
   - The replacement (replacement method / attribute)
   - The version in which removal will be enforced (e.g., `will be removed in 2.0.0`)
3. After the announcement, the deprecated feature continues to work within the same major version (`1.x`).
4. Removal takes place in the next **Major Release** (`2.0.0`).

---

### Example: Deprecation Flow

| Version | Status | Description |
| :----------- | :------ | :------ |
| `1.2.0` | 🔔 Announcement | Deprecate the function `old_method()`. Point users to `new_method()` as the replacement. |
| `1.3.0` | ⚠ Continued warning | Still works, with a warning. Migration recommended. |
| `2.0.0` | ⛔ Removal | Remove `old_method()` completely. |

---

## References

- [Semantic Versioning](https://semver.org/)
- [Python Package Building Techniques for Regmonkeys > Versioning Policy](https://ryonakagami.github.io/python-statisticalpackage-techniques/posts/python-packaging-guide/versioning.html)
