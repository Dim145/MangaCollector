/*
 * 字 · iOS Dynamic Type, for a web page.
 *
 * Safari exposes the reader's system text size through one font
 * keyword, `-apple-system-body`: 17 px at the default setting, up to
 * 23 px with "Larger Text", far beyond with the accessibility sizes.
 * Nothing else on the web follows that setting — a reader who needs
 * large text in every app got this one at 16 px.
 *
 * The root's size is scaled by that ratio, so everything set in `rem`
 * (body text, controls, spacing) grows with it, and the page reflows
 * as it does at 200 % zoom (checked down to 320 px). Labels set in
 * pixels stay put.
 *
 * Bounded both ways: a setting smaller than the default leaves the
 * design as it is (this is about reading, not density), and the scale
 * stops at 2×. Only where the pointer is a finger: macOS answers a fixed
 * 13 px for the same keyword, which is a size, not a preference.
 */
const DEFAULT_BODY_PX = 17;
const ROOT_PX = 16;
const MAX_SCALE = 2;

/** The reader's system text size as a ratio of the default, in [1, 2]. */
export function systemTextScale() {
  if (typeof document === "undefined" || typeof window === "undefined") return 1;
  if (typeof CSS === "undefined" || typeof CSS.supports !== "function") return 1;
  if (!CSS.supports("font", "-apple-system-body")) return 1;
  if (typeof window.matchMedia !== "function" || !window.matchMedia("(pointer: coarse)").matches) {
    return 1;
  }
  const probe = document.createElement("span");
  probe.style.font = "-apple-system-body";
  probe.style.position = "absolute";
  probe.style.visibility = "hidden";
  probe.textContent = "字";
  document.body.appendChild(probe);
  const px = parseFloat(window.getComputedStyle(probe).fontSize);
  probe.remove();
  if (!Number.isFinite(px) || px <= 0) return 1;
  return Math.min(MAX_SCALE, Math.max(1, px / DEFAULT_BODY_PX));
}

/** Size the root from the system setting; returns the scale applied. */
export function applyDynamicType() {
  if (typeof document === "undefined") return 1;
  const scale = systemTextScale();
  const root = document.documentElement;
  if (scale === 1) root.style.removeProperty("font-size");
  else root.style.fontSize = `${Math.round(ROOT_PX * scale * 100) / 100}px`;
  return scale;
}

/**
 * Apply now and again whenever the page comes back into view — the
 * setting is changed in another app, the Settings one.
 */
export function watchDynamicType() {
  if (typeof document === "undefined") return () => {};
  applyDynamicType();
  const onVisible = () => {
    if (document.visibilityState === "visible") applyDynamicType();
  };
  document.addEventListener("visibilitychange", onVisible);
  return () => document.removeEventListener("visibilitychange", onVisible);
}
