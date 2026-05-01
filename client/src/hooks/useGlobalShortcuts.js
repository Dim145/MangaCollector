import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

/*
 * 鍵 · Global keyboard shortcuts.
 *
 * Mounted once in App.jsx. Two families:
 *
 *   - Single-key triggers — `?` opens the cheat sheet.
 *   - "Go to" chord — press `g` then a destination letter within
 *     CHORD_TIMEOUT_MS to navigate (Linear / Superhuman / Twitter
 *     pattern). The chord is reset on any other key, on the timeout,
 *     or on focus moving into an editable field.
 *
 * Anti-conflict guards:
 *   - Skipped while the user is typing in an `<input>`, `<textarea>`,
 *     `[contenteditable]`, or any element with `data-shortcut-block`.
 *   - Modifier keys (Ctrl/Cmd/Alt/Meta) skip the handler — those
 *     belong to the OS / browser / Cmd+K (CommandPalette).
 *
 * Card-level shortcuts (j/k navigation, o for open) are deliberately
 * NOT in v1: they need cross-component focus coordination that can
 * conflict with screen-reader navigation. Cmd+K already covers
 * "jump to a series" via the palette.
 */

const CHORD_TIMEOUT_MS = 1200;

const GO_DESTINATIONS = {
  d: "/dashboard",
  l: "/dashboard", // 'library' alias — same surface
  // 暦 · The route is registered as `/calendrier` in App.jsx (the
  // project speaks French at the URL layer). Pointing at `/calendar`
  // here would hit React Router's "No routes matched" warning.
  c: "/calendrier",
  p: "/profile",
  s: "/settings",
  a: "/addmanga",
};

function isEditableTarget(el) {
  if (!el) return false;
  const tag = el.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  if (el.closest && el.closest("[data-shortcut-block]")) return true;
  return false;
}

export function useGlobalShortcuts({ onOpenCheatSheet }) {
  const navigate = useNavigate();

  useEffect(() => {
    let chordTimer = null;
    let chordPrimed = false;

    const resetChord = () => {
      chordPrimed = false;
      if (chordTimer != null) {
        clearTimeout(chordTimer);
        chordTimer = null;
      }
    };

    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return resetChord();
      if (isEditableTarget(e.target)) return resetChord();

      // 鏡 · Cheat sheet — `?` (Shift+/ on most layouts; we just check
      // the resolved key to stay layout-independent).
      if (!chordPrimed && e.key === "?") {
        e.preventDefault();
        onOpenCheatSheet?.();
        return;
      }

      // First-key of the chord.
      if (!chordPrimed && e.key.toLowerCase() === "g") {
        chordPrimed = true;
        chordTimer = setTimeout(resetChord, CHORD_TIMEOUT_MS);
        return;
      }

      // Second-key of the chord — only fires within the timeout.
      if (chordPrimed) {
        const key = e.key.toLowerCase();
        const dest = GO_DESTINATIONS[key];
        resetChord();
        if (dest) {
          e.preventDefault();
          navigate(dest);
        }
      }
    };

    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      if (chordTimer != null) clearTimeout(chordTimer);
    };
  }, [navigate, onOpenCheatSheet]);
}

// Exported so the cheat sheet renders the same canonical list of
// destinations without copy-pasting.
export const SHORTCUT_DESTINATIONS = GO_DESTINATIONS;
