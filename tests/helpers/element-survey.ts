import React from "react";

/**
 * Every href in the tree, every rendered string, and every element.
 *
 * The walk follows `children` and every other prop that carries elements,
 * because a pane can be passed as a prop (`tabs={[{ label, content }]}`) rather
 * than nested — a children-only walk would miss the request detail page's own
 * panes, and an href collector that only looked at children once made a
 * "withheld" assertion pass vacuously.
 *
 * Used by the render-site role pins (tests/role-affordance-wiring.test.tsx,
 * tests/export-affordance-parity.test.tsx, tests/nav-role-parity.test.tsx),
 * which call a real page/component with a real signed session and inspect the
 * element tree it returns — no renderer, so there is no app-router context to
 * fake and the assertion is about the component's own decision.
 */
export function survey(tree: unknown) {
  const hrefs: string[] = [];
  const texts: string[] = [];
  const elements: React.ReactElement[] = [];

  const visit = (node: unknown, isRenderedText: boolean) => {
    if (Array.isArray(node)) {
      node.forEach((child) => visit(child, isRenderedText));
      return;
    }
    if (typeof node === "string" || typeof node === "number") {
      if (isRenderedText) texts.push(String(node));
      return;
    }
    if (React.isValidElement(node)) {
      elements.push(node);
      const props = (node.props ?? {}) as Record<string, unknown>;
      if (typeof props.href === "string") hrefs.push(props.href);
      for (const [key, value] of Object.entries(props)) visit(value, key === "children");
      return;
    }
    if (node && typeof node === "object") {
      Object.values(node as Record<string, unknown>).forEach((value) => visit(value, false));
    }
  };
  visit(tree, true);

  return {
    hrefs,
    text: texts.join(" "),
    find: (type: unknown) => elements.filter((element) => element.type === type)
  };
}

/** True when the tree offers a link to this endpoint (the href carries filters). */
export function offers(hrefs: string[], path: string) {
  return hrefs.some((href) => href.startsWith(path));
}
