import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { I18nProvider, loadLanguage, loadNamespaces, useT } from "@/i18n/index.jsx";
import { PAGE_NAMESPACES } from "@/i18n/split.js";
import CurrencySwitchModal from "./CurrencySwitchModal.jsx";

const USD = { code: "USD", symbol: "$", separator: ",", decimal: ".", precision: 2, format: "!#", negativePattern: "-!#" };
const JPY = { code: "JPY", symbol: "¥", separator: ",", decimal: ".", precision: 0, format: "!#", negativePattern: "-!#" };

beforeAll(async () => {
  await loadLanguage("en");
  await loadNamespaces(PAGE_NAMESPACES.SettingsPage);
});

function Harness(props) {
  const t = useT();
  return <CurrencySwitchModal t={t} {...props} />;
}

function open(props) {
  const onCancel = vi.fn();
  const onConfirm = vi.fn();
  render(
    <I18nProvider lang="en">
      <Harness from={USD} to={JPY} count={3} example={12.5} onCancel={onCancel} onConfirm={onConfirm} {...props} />
    </I18nProvider>,
  );
  return { onCancel, onConfirm };
}

describe("CurrencySwitchModal", () => {
  it("says the amounts are not converted and how many prices are saved", () => {
    open({});
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    expect(screen.getByText("Switch to JPY?")).toBeTruthy();
    expect(screen.getByText(/3 saved prices will keep exactly the same numbers/)).toBeTruthy();
    expect(screen.getByText(/not converted/)).toBeTruthy();
  });

  it("shows a real before and after for the first price", () => {
    open({});
    expect(screen.getByText("A price shown as $12.50 will read ¥13.")).toBeTruthy();
  });

  it("uses the singular for one price", () => {
    open({ count: 1, example: 1200 });
    expect(screen.getByText(/^1 saved price will keep exactly the same number/)).toBeTruthy();
  });

  it("leaves the example out when there is none", () => {
    open({ example: null });
    expect(screen.queryByText(/A price shown as/)).toBeNull();
  });

  it("cancel does not confirm, confirm does not cancel", () => {
    const { onCancel, onConfirm } = open({});
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Switch to JPY" }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });
});
