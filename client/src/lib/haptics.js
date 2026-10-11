/*
 * 振 · Haptic feedback for key actions.
 *
 * Wraps `navigator.vibrate(pattern)` so call sites stay one-liners
 * (`haptics.tap()`) and the runtime guard (no API / user-disabled /
 * SSR) lives in one place.
 *
 * Storage: localStorage, not the user's settings row.
 *   - Vibration is a device capability, not a portable preference —
 *     a user toggling it on their phone shouldn't suddenly mute it
 *     on a tablet they hand to their kid.
 *   - Avoids a server migration for what's effectively a boolean
 *     UI affordance.
 *
 * Defaults to ON. The Vibration API is a no-op on hardware that
 * lacks a motor (every desktop, most laptops), so leaving it ON
 * for everyone is safe — only devices that actually buzz will buzz.
 *
 * Patterns are kept SHORT (≤ 25 ms single pulses, ≤ 60 ms total for
 * compound). Long buzzes feel like errors / phone calls; short taps
 * feel like a click landing. Numbers picked from Material's haptic
 * guidelines and field-tuned on a Pixel 8 + iPhone 13.
 */

const STORAGE_KEY = "mc:haptics:enabled";

function isAvailable() {
  return typeof navigator !== "undefined" && typeof navigator.vibrate === "function";
}

export function getHapticsEnabled() {
  if (typeof localStorage === "undefined") return true;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw === null ? true : raw === "1";
  } catch {
    return true;
  }
}

export function setHapticsEnabled(enabled) {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, enabled ? "1" : "0");
  } catch {
    /* private mode / quota — non-fatal */
  }
}

function fire(pattern) {
  if (!isAvailable()) return;
  if (!getHapticsEnabled()) return;
  try {
    navigator.vibrate(pattern);
  } catch {
    /* some browsers throw on disabled-by-user-agent */
  }
}

/**
 * 触 · Safari has no Vibration API, and one haptic a page can cause: the
 * tick of a native switch (`<input type="checkbox" switch>`, Safari
 * 17.4+) toggled through its label inside a user gesture. Only used for
 * the one moment that earns it — a volume going onto the shelf — and
 * only where `vibrate` is missing; iOS 26.5 narrowed when it fires, and
 * where it does not this is a silent no-op.
 */
function iosSwitchTick() {
  if (typeof document === "undefined" || !getHapticsEnabled()) return;
  try {
    const label = document.createElement("label");
    label.setAttribute("aria-hidden", "true");
    label.style.display = "none";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.setAttribute("switch", "");
    label.appendChild(input);
    document.body.appendChild(label);
    label.click();
    label.remove();
  } catch {
    /* no switch control, or no body yet */
  }
}

export const haptics = {
  /** 印 · A volume checked onto the shelf: a short pulse, or the switch tick on iOS. */
  check: () => (isAvailable() ? fire(18) : iosSwitchTick()),
  /** 軽 · Light single tap — toggles, taps, list-item picks. */
  tap: () => fire(10),
  /** 中 · Medium pulse — non-trivial state flips (collector, important toggles). */
  bump: () => fire(18),
  /** 成 · Success two-pulse — confirmed write / completed action. */
  success: () => fire([12, 40, 20]),
  /** 注 · Warning — destructive confirms. */
  warning: () => fire([20, 60, 20]),
  /** 失 · Error — rejected input, validation failure. */
  error: () => fire([30, 50, 30, 50, 30]),
};

export default haptics;
