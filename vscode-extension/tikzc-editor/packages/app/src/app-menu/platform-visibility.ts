import type { AppMenuDefinition, AppMenuItem, AppMenuPlatformTarget, AppMenuSection } from "./types.js";

type PlatformScoped = {
  platforms?: readonly AppMenuPlatformTarget[];
};

function isVisibleOnTarget(target: AppMenuPlatformTarget, scoped: PlatformScoped): boolean {
  if (!scoped.platforms || scoped.platforms.length === 0) {
    return true;
  }
  return scoped.platforms.some((candidate) => platformTargetsMatch(target, candidate));
}

function platformTargetsMatch(target: AppMenuPlatformTarget, candidate: AppMenuPlatformTarget): boolean {
  if (target === candidate) {
    return true;
  }
  if (target === "desktop-windows") {
    return candidate === "desktop";
  }
  if (target === "desktop-macos") {
    return candidate === "desktop";
  }
  if (target === "desktop-linux") {
    return candidate === "desktop";
  }
  if (target === "desktop") {
    return candidate === "desktop-windows" || candidate === "desktop-macos" || candidate === "desktop-linux";
  }
  return false;
}

function trimSeparators(items: readonly AppMenuItem[]): AppMenuItem[] {
  const out: AppMenuItem[] = [];
  for (const item of items) {
    if (item.kind === "separator") {
      if (out.length === 0 || out[out.length - 1]?.kind === "separator") {
        continue;
      }
      out.push(item);
      continue;
    }
    out.push(item);
  }
  while (out[out.length - 1]?.kind === "separator") {
    out.pop();
  }
  return out;
}

function filterItems(target: AppMenuPlatformTarget, items: readonly AppMenuItem[]): AppMenuItem[] {
  const visible: AppMenuItem[] = [];

  for (const item of items) {
    if (!isVisibleOnTarget(target, item)) {
      continue;
    }
    if (item.kind !== "submenu") {
      visible.push(item);
      continue;
    }

    const nested = trimSeparators(filterItems(target, item.items));
    if (nested.length === 0) {
      continue;
    }
    visible.push({
      ...item,
      items: nested
    });
  }

  return trimSeparators(visible);
}

export function filterAppMenuDefinitionForTarget(
  definition: AppMenuDefinition,
  target: AppMenuPlatformTarget
): AppMenuDefinition {
  const sections: AppMenuSection[] = [];

  for (const section of definition) {
    if (!isVisibleOnTarget(target, section)) {
      continue;
    }
    const filteredItems = filterItems(target, section.items);
    if (filteredItems.length === 0) {
      continue;
    }
    sections.push({
      ...section,
      items: filteredItems
    });
  }

  return sections;
}
