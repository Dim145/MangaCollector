import Modal from "@/components/ui/Modal.jsx";
import { formatCurrency } from "@/utils/price.js";

/*
 * Shown before the display currency changes while saved prices exist.
 * The example is the first real price, written the way it reads now and
 * the way it will read after: the same number, a different symbol.
 */
export default function CurrencySwitchModal({
  from,
  to,
  count,
  example,
  onCancel,
  onConfirm,
  t,
}) {
  return (
    <Modal popupOpen={true} handleClose={onCancel}>
      <div
        role="alertdialog"
        aria-labelledby="currency-switch-title"
        aria-describedby="currency-switch-body"
        className="w-full max-w-md rounded-2xl border border-hanko/40 bg-ink-1 p-6 shadow-2xl"
      >
        <div className="hanko-seal mx-auto mb-4 grid h-12 w-12 place-items-center rounded-md font-display text-sm">
          銭
        </div>
        <h3
          id="currency-switch-title"
          className="text-center font-display text-xl font-semibold text-washi"
        >
          {t("settings.currencyConfirmTitle", { code: to?.code })}
        </h3>
        <p
          id="currency-switch-body"
          className="mt-3 text-center text-sm text-washi-muted"
        >
          {count === 1
            ? t("settings.currencyConfirmBodyOne")
            : t("settings.currencyConfirmBody", { count })}
        </p>
        {example !== null && (
          <p className="mt-3 rounded-lg border border-border bg-ink-0 px-3 py-2 text-center font-mono text-xs text-washi">
            {t("settings.currencyConfirmExample", {
              before: formatCurrency(example, from),
              after: formatCurrency(example, to),
            })}
          </p>
        )}
        <div className="mt-5 flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-semibold text-washi-muted transition hover:text-washi"
          >
            {t("common.cancel")}
          </button>
          <button
            onClick={onConfirm}
            className="flex-1 rounded-lg bg-hanko px-4 py-2 text-sm font-semibold text-on-hanko transition hover:bg-hanko-deep"
          >
            {t("settings.currencyConfirmAction", { code: to?.code })}
          </button>
        </div>
      </div>
    </Modal>
  );
}
