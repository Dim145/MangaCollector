/*
 * 殻 · Whether `index.html`'s boot shell — the header's brand, painted
 * by the stylesheet before any script ran — was on screen when the app
 * mounted.
 *
 * React replaces the shell with the real header. Its seal plays a
 * stamp on arrival; after the shell that would be a second arrival of a
 * mark the reader has been looking at, cut wherever the first one had
 * got to. So the header asks, once, and keeps its seal still.
 */
let shown = false;

/** Called by `main.jsx` before the first render. */
export function noteBootShell(root) {
  shown = Boolean(root?.querySelector?.("[data-boot-shell]"));
}

export function bootShellShown() {
  return shown;
}
