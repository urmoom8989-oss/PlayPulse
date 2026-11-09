// "/" jumps to the search box on any page (the more_shortcuts flag).
// No imports, so Node can load this file directly.

/** Is this key press "go to the search box" ("/"), outside a text field? */
export function isSearchKey(e: { key: string; ctrlKey?: boolean; metaKey?: boolean; altKey?: boolean }, typing: boolean): boolean {
  return e.key === "/" && !e.ctrlKey && !e.metaKey && !e.altKey && !typing;
}
