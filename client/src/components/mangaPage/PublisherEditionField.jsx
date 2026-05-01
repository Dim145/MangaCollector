/* eslint-disable react-refresh/only-export-components --
 * Co-locating the `PUBLISHER_PRESETS` / `EDITION_PRESETS` constants
 * with the component that consumes them keeps the related concepts in
 * one file (same trade-off as `i18n/index.jsx`). The Fast-Refresh rule
 * is dev-only — at runtime these mixed exports behave identically to
 * separated ones.
 */

/**
 * 出版社 · Datalist-backed text input used by the publisher / edition
 * fields. Keeps the markup a single shared atom so the two inputs stay
 * in lockstep on padding, focus ring, and length cap. The browser's
 * native `<datalist>` handles the autocomplete dropdown — zero JS, zero
 * custom popover, fully accessible by default, free mobile suggestions.
 */
export default function PublisherEditionField({
  id,
  label,
  placeholder,
  value,
  onChange,
  listId,
  maxLength,
  options,
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-[0.22em] text-washi-dim">
        {label}
      </span>
      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        list={listId}
        maxLength={maxLength}
        autoComplete="off"
        spellCheck={false}
        className="w-full rounded-lg border border-border bg-ink-0/60 px-3 py-2 text-sm text-washi placeholder:text-washi-dim transition focus:border-hanko/50 focus:outline-none focus:ring-2 focus:ring-hanko/20"
      />
      <datalist id={listId}>
        {options.map((opt) => (
          <option key={opt} value={opt} />
        ))}
      </datalist>
    </label>
  );
}

/** Common imprints across markets — surfaced as suggestions in the
 *  publisher field. Trim to the most-collected names so the dropdown
 *  stays scannable; users can always type anything not on the list. */
export const PUBLISHER_PRESETS = [
  // FR
  "Glénat",
  "Kana",
  "Pika",
  "Ki-oon",
  "Kurokawa",
  "Akata",
  "Soleil",
  "Doki-Doki",
  "Delcourt / Tonkam",
  "Mangetsu",
  "Vega",
  "Casterman / Sakka",
  "Noeve Grafx",
  "Black Box",
  "Crunchyroll Manga",
  "Panini Manga",
  // EN
  "Viz Media",
  "Yen Press",
  "Kodansha USA",
  "Seven Seas",
  "Square Enix Manga",
  "Dark Horse",
  "Vertical",
  "Tokyopop",
  // ES
  "Norma Editorial",
  "Panini Cómics",
  "Editorial Ivréa",
  "Planeta Cómic",
  "ECC Ediciones",
];

/** Edition variants — keys; the resolved labels live in i18n so the
 *  suggestions show in the user's current language. Free-text input
 *  remains the source of truth. */
export const EDITION_PRESETS = [
  "standard",
  "kanzenban",
  "perfect",
  "deluxe",
  "ultimate",
  "original",
  "color",
  "anniversary",
  "doubleVolumes",
  "pocket",
];
