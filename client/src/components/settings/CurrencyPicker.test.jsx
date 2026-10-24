import { fireEvent, render, screen } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { I18nProvider, loadLanguage, loadNamespaces, useT } from "@/i18n/index.jsx";
import { PAGE_NAMESPACES } from "@/i18n/split.js";
import ChapterContent from "./ChapterContent.jsx";

/*
 * The currency picker lives inside the "content" chapter of the
 * settings page. What matters to a reader: every currency the server
 * knows has a button, the preview is written the way that currency is
 * written (¥165 — no decimals — not ¥165.18), choosing one hands its
 * code to the page, and the screen says nothing is converted.
 */

const USD = { code: "USD", symbol: "$", separator: ",", decimal: ".", precision: 2, format: "!#", negativePattern: "-!#" };
const JPY = { code: "JPY", symbol: "¥", separator: ",", decimal: ".", precision: 0, format: "!#", negativePattern: "-!#" };

beforeAll(async () => {
  await loadLanguage("en");
  await loadNamespaces(PAGE_NAMESPACES.SettingsPage);
});

function Chapter({ currencyObject, onCurrencyChange }) {
  const t = useT();
  return (
    <ChapterContent
      chapter={{ id: "content", kanji: "文", kanjiNum: "二", labelKey: "settings.tabContent", hintKey: "settings.tabContentHint" }}
      subBlocks={{
        language: { kanji: "言", labelKey: "settings.subLanguage" },
        display: { kanji: "表", labelKey: "settings.subDisplay" },
      }}
      t={t}
      language="en"
      onLanguageChange={() => {}}
      titleOptions={[]}
      titleType="Default"
      onTitleChange={() => {}}
      currencyObject={currencyObject}
      onCurrencyChange={onCurrencyChange}
      adultOptions={[]}
      showAdultContent={0}
      onAdultChange={() => {}}
    />
  );
}

function renderChapter(currencyObject) {
  const onCurrencyChange = vi.fn();
  render(
    <I18nProvider lang="en">
      <Chapter currencyObject={currencyObject} onCurrencyChange={onCurrencyChange} />
    </I18nProvider>,
  );
  return onCurrencyChange;
}

describe("currency picker", () => {
  it("offers USD, EUR and JPY, each with its name", () => {
    renderChapter(USD);
    for (const [code, name] of [["USD", /US Dollar/], ["EUR", /Euro/], ["JPY", /Japanese Yen/]]) {
      expect(screen.getByRole("button", { name: new RegExp(`${code}.*${name.source}`, "s") })).toBeTruthy();
    }
  });

  it("hands the JPY code to the page when the yen is chosen", () => {
    const onChange = renderChapter(USD);
    fireEvent.click(screen.getByRole("button", { name: /JPY/ }));
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("JPY");
  });

  it("previews the yen without decimals and the dollar with them", () => {
    const { unmount } = render(
      <I18nProvider lang="en">
        <Chapter currencyObject={JPY} onCurrencyChange={() => {}} />
      </I18nProvider>,
    );
    expect(screen.getByText("¥165")).toBeTruthy();
    expect(screen.queryByText(/¥165\./)).toBeNull();
    unmount();
    renderChapter(USD);
    expect(screen.getByText("$165.18")).toBeTruthy();
  });

  it("says that changing the currency converts nothing", () => {
    renderChapter(JPY);
    expect(screen.getByText(/never converted/i)).toBeTruthy();
  });
});
