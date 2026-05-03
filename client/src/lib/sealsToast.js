import { notifySyncInfo } from "@/lib/sync.js";
import { SEAL_BY_CODE } from "@/lib/sealsCatalog.js";

/**
 * 印 · Fire a "seal pressed" toast for each newly-granted code.
 *
 * Why this is shared between `useSeals.queryFn` and
 * `SealsUnlockToaster.fetchAndToast`:
 *
 * `evaluate_and_grant` server-side is the inserter AND the
 * reporter — only the FIRST GET that observes a qualifying state
 * gets the codes back in `newly_granted`. Subsequent GETs see the
 * row already in the DB and report an empty `newly_granted`.
 *
 * Two consumers race for that signal:
 *   • `useSeals` (mounts when /seals page is opened) — fires its
 *     queryFn immediately on mount with no debounce.
 *   • `SealsUnlockToaster` (mounted at App level) — fires
 *     ~600 ms after a realtime push arrives.
 *
 * If the user marks the qualifying volume on a non-seals page and
 * IMMEDIATELY navigates to /seals (faster than 600 ms), useSeals
 * wins the race and SealsUnlockToaster's later fetch returns
 * empty. Without this shared helper, the toast would only fire
 * when SealsUnlockToaster wins, which leaves the fast-nav case
 * silent — exactly the bug the user reported.
 *
 * Calling this helper from BOTH paths is safe: the race winner
 * gets the codes and fires toasts; the loser gets an empty array
 * and no-ops. Server-side atomicity prevents double-fire.
 */
export function notifySealsUnlocked(codes, t) {
  if (!Array.isArray(codes) || codes.length === 0) return;
  for (const code of codes) {
    const meta = SEAL_BY_CODE.get(code);
    notifySyncInfo({
      op: "seal-unlock",
      tone: "success",
      icon: meta?.kanji ?? "印",
      title: t("seals.unlocked.title"),
      body: t(`seals.codes.${code}.label`),
      // Click → /seals, where the user can read the ceremonial
      // description and see the new stamp in context.
      href: "/seals",
    });
  }
}
