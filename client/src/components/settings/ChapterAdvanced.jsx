import { Card, CardHeader, Chapter } from "./_shared.jsx";

export default function ChapterAdvanced({
  chapter,
  t,
  online,
  pending,
  onRestoreClick,
  onDeleteClick,
}) {
  // ─── Ch. 4 · Avancé ────────────────────────────────────
  // Single block — the danger zone is too small to merit
  // sub-grouping, and DataSection already treats restore vs.
  // delete as two visually distinct tiles internally.
  return (
    <Chapter
      id="advanced"
      chapter={chapter}
      title={t("settings.tabAdvanced")}
      subtitle={t("settings.tabAdvancedHint")}
      t={t}
    >
      <DataSection
        online={online}
        pending={pending}
        onRestoreClick={onRestoreClick}
        onDeleteClick={onDeleteClick}
        t={t}
      />
    </Chapter>
  );
}

function DataSection({ online, pending, onRestoreClick, onDeleteClick, t }) {
  return (
    <Card danger>
      <CardHeader
        title={t("settings.dataSection")}
        body={t("settings.dataBody")}
      />

      {/* Restore — reversible, hanko-tinted but lighter than the delete row. */}
      <div className="rounded-xl border border-border bg-ink-0/40 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 flex-1">
            <p className="font-display text-sm font-semibold text-washi">
              {t("settings.restoreFromServer")}
            </p>
            <p className="mt-1 text-xs text-washi-muted">
              {t("settings.restoreDesc")}
              {pending > 0 &&
                t(
                  pending === 1
                    ? "settings.pendingDiscardOne"
                    : "settings.pendingDiscardMany",
                  { n: pending },
                )}
            </p>
          </div>
          <button
            onClick={onRestoreClick}
            disabled={!online}
            title={online ? "" : t("settings.restoreConnectionHint")}
            className="inline-flex items-center justify-center gap-2 rounded-full border border-hanko/40 bg-hanko/10 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-hanko-bright transition hover:bg-hanko/20 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
              <path d="M21 2v6h-6" />
              <path d="M3 12a9 9 0 0 1 15-6.7L21 8" />
              <path d="M3 22v-6h6" />
              <path d="M21 12a9 9 0 0 1-15 6.7L3 16" />
            </svg>
            {t("settings.restore")}
          </button>
        </div>
      </div>

      {/* Delete — irreversible. Darker frame, kanji 消, fixed
          erase-red gradient. The colour intentionally does NOT
          follow the user's accent palette: a destructive surface
          must read as red regardless of whether the rest of the
          UI is accented in gold, moegi, ai, etc. The `erase-*`
          tokens are defined once at the root level in
          styles/index.css and never re-declared inside a
          `data-accent` override, so they stay anchored to the
          default hanko cinnabar shades. */}
      <div
        className="relative mt-3 overflow-hidden rounded-xl border p-4"
        style={{
          borderColor: "color-mix(in oklab, var(--erase) 60%, transparent)",
          background:
            "linear-gradient(to bottom right, color-mix(in oklab, var(--erase) 10%, transparent), color-mix(in oklab, var(--ink-0) 60%, transparent), color-mix(in oklab, var(--ink-0) 40%, transparent))",
        }}
      >
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{
            background:
              "linear-gradient(to right, transparent, color-mix(in oklab, var(--erase) 70%, transparent), transparent)",
          }}
        />
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <span
              aria-hidden="true"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-washi"
              style={{
                transform: "rotate(-4deg)",
                background:
                  "linear-gradient(to bottom right, var(--erase-bright), var(--erase-deep))",
                boxShadow: "0 0 12px var(--erase-glow)",
              }}
            >
              <span className="font-display text-sm font-bold leading-none">消</span>
            </span>
            <div className="min-w-0">
              <p className="font-display text-sm font-semibold text-washi">
                {t("settings.deleteAccountTitle")}
              </p>
              <p className="mt-1 text-xs text-washi-muted">
                {t("settings.deleteAccountDesc")}
              </p>
            </div>
          </div>
          <button
            onClick={onDeleteClick}
            disabled={!online}
            title={online ? "" : t("settings.restoreConnectionHint")}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full border px-4 py-2 text-xs font-bold uppercase tracking-wider text-washi transition hover:brightness-110 active:scale-95 disabled:cursor-not-allowed disabled:opacity-40"
            style={{
              borderColor: "var(--erase)",
              background:
                "linear-gradient(to bottom right, var(--erase-deep), var(--erase))",
              boxShadow: "0 4px 14px var(--erase-glow)",
            }}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5">
              <path d="M3 6h18" />
              <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
              <path d="M19 6 18 20a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
            </svg>
            {t("settings.deleteAccountCta")}
          </button>
        </div>
      </div>
    </Card>
  );
}
