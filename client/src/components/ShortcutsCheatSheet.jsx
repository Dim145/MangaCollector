import Modal from "./ui/Modal.jsx";
import { useT } from "@/i18n/index.jsx";

/*
 * 鍵 · Keyboard shortcut cheat sheet.
 *
 * Triggered globally by `?`. The lists below mirror the canonical
 * bindings — keep this file in sync with `hooks/useGlobalShortcuts.js`
 * and `components/CommandPalette.jsx` (the only two places that
 * actually own keyboard surfaces today).
 *
 * Layout: a kanji-stamped modal grouped into three families
 * (navigation, search, modal control) so the user can scan rather
 * than hunt. Each row pairs a `<kbd>` with its action label —
 * deliberately no descriptions; the action label is short enough.
 */
export default function ShortcutsCheatSheet({ open, onClose }) {
  const t = useT();

  const groups = [
    {
      kanji: "移",
      title: t("shortcuts.navTitle"),
      items: [
        { keys: ["g", "d"], label: t("shortcuts.gotoDashboard"), separator: " " },
        { keys: ["g", "c"], label: t("shortcuts.gotoCalendar"), separator: " " },
        { keys: ["g", "p"], label: t("shortcuts.gotoProfile"), separator: " " },
        { keys: ["g", "s"], label: t("shortcuts.gotoSettings"), separator: " " },
        { keys: ["g", "a"], label: t("shortcuts.gotoAdd"), separator: " " },
      ],
    },
    {
      kanji: "探",
      title: t("shortcuts.searchTitle"),
      items: [
        { keys: ["⌘", "K"], label: t("shortcuts.openPalette"), separator: " + " },
        { keys: ["Ctrl", "K"], label: t("shortcuts.openPaletteAlt"), separator: " + " },
      ],
    },
    {
      kanji: "状",
      title: t("shortcuts.modalTitle"),
      items: [
        { keys: ["Esc"], label: t("shortcuts.closeModal") },
        { keys: ["Tab"], label: t("shortcuts.tabForward") },
        { keys: ["Shift", "Tab"], label: t("shortcuts.tabBack"), separator: " + " },
      ],
    },
    {
      kanji: "助",
      title: t("shortcuts.helpTitle"),
      items: [
        { keys: ["?"], label: t("shortcuts.openCheatSheet") },
      ],
    },
  ];

  return (
    <Modal popupOpen={open} handleClose={onClose} additionalClasses="w-full max-w-xl">
      <div className="relative overflow-hidden rounded-2xl border border-washi/15 bg-ink-1/98 shadow-2xl">
        {/* 鍵 watermark — vertical script, faint cream, anchors the
            modal in the same kanji-poster voice as the other
            settings-adjacent dialogs. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -bottom-12 -right-12 select-none font-jp text-[20rem] font-bold leading-none text-washi/[0.06]"
          style={{ writingMode: "vertical-rl" }}
        >
          鍵
        </span>

        <header className="relative border-b border-border/60 px-6 pt-6 pb-5">
          <div className="flex items-baseline gap-3">
            <span className="font-mono text-[10px] uppercase tracking-[0.3em] text-washi-dim">
              {t("shortcuts.eyebrow")}
            </span>
            <span className="h-px flex-1 bg-gradient-to-r from-border to-transparent" />
          </div>
          <h2 className="mt-2 font-display text-2xl font-light italic leading-none tracking-tight text-washi md:text-3xl">
            {t("shortcuts.title")}
          </h2>
          <p className="mt-2 max-w-md text-sm text-washi-muted">
            {t("shortcuts.byline")}
          </p>
        </header>

        <div className="relative space-y-6 px-6 py-5">
          {groups.map((group) => (
            <section key={group.title}>
              <div className="mb-3 flex items-baseline gap-2">
                <span
                  aria-hidden="true"
                  className="font-jp text-base font-bold leading-none text-hanko-bright"
                >
                  {group.kanji}
                </span>
                <h3 className="font-mono text-[10px] uppercase tracking-[0.25em] text-washi-dim">
                  {group.title}
                </h3>
                <span className="h-px flex-1 bg-border/40" />
              </div>
              <ul className="space-y-1.5">
                {group.items.map((item, idx) => (
                  <li
                    key={idx}
                    className="flex items-center justify-between gap-3 rounded-md px-2 py-1.5 transition hover:bg-ink-0/40"
                  >
                    <span className="text-sm text-washi">{item.label}</span>
                    <span className="flex items-center gap-1">
                      {item.keys.map((k, ki) => (
                        <span key={ki} className="flex items-center gap-1">
                          {ki > 0 && (
                            <span
                              aria-hidden="true"
                              className="font-mono text-[10px] text-washi-dim"
                            >
                              {item.separator ?? " "}
                            </span>
                          )}
                          <kbd className="inline-flex min-w-[1.5rem] items-center justify-center rounded border border-border bg-ink-0/60 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-washi shadow-[inset_0_-1px_0_rgba(0,0,0,0.4)]">
                            {k}
                          </kbd>
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <footer className="relative border-t border-border/60 px-6 py-3 text-[11px] text-washi-dim">
          {t("shortcuts.footer")}
        </footer>
      </div>
    </Modal>
  );
}
