import { useContext } from "react";
import { useNavigate } from "react-router-dom";
import SettingsContext from "@/SettingsContext.js";
import { hasToBlurImage } from "@/utils/library.js";
import { useGapSuggestions } from "@/hooks/useGapSuggestions.js";
import { useT } from "@/i18n/index.jsx";

/** Turn [1,2,3,5,6,8] into "1-3, 5-6, 8". */
function summarizeRange(nums) {
  if (!nums.length) return "";
  const sorted = [...nums].sort((a, b) => a - b);
  const ranges = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i++) {
    const n = sorted[i];
    if (n === prev + 1) {
      prev = n;
      continue;
    }
    ranges.push(start === prev ? `${start}` : `${start}–${prev}`);
    start = n;
    prev = n;
  }
  return ranges.join(", ");
}

export default function GapSuggestions() {
  const t = useT();
  const navigate = useNavigate();
  const { adult_content_level } = useContext(SettingsContext);
  const suggestions = useGapSuggestions(4);

  if (!suggestions.length) return null;

  return (
    <section className="mb-8 animate-fade-up" style={{ animationDelay: "50ms" }}>
      <div className="mb-3 flex items-baseline gap-3">
        <span className="font-mono text-xs uppercase tracking-[0.3em] text-gold">
          {t("gap.label")}
        </span>
        <span className="h-px flex-1 bg-gradient-to-r from-gold/30 to-transparent" />
      </div>
      <p className="mb-4 text-sm text-washi-muted">{t("gap.byline")}</p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {suggestions.map(({ manga, missing, gap }) => (
          <GapCard
            key={manga.mal_id}
            manga={manga}
            missing={missing}
            gap={gap}
            t={t}
            onOpen={() =>
              navigate("/mangapage", {
                state: { manga, adult_content_level },
              })
            }
            blurred={hasToBlurImage(manga, adult_content_level)}
          />
        ))}
      </div>
    </section>
  );
}

function GapCard({ manga, missing, gap, t, onOpen, blurred }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group relative flex w-full items-center gap-3 overflow-hidden rounded-xl border border-border bg-ink-1/50 p-3 text-left backdrop-blur transition hover:border-gold/40 hover:-translate-y-0.5"
    >
      {manga.image_url_jpg ? (
        <img
          src={manga.image_url_jpg}
          alt=""
          loading="lazy"
          className={`h-20 w-14 shrink-0 rounded-md border border-border object-cover shadow-md ${
            blurred ? "blur-md" : ""
          }`}
        />
      ) : (
        <div className="grid h-20 w-14 shrink-0 place-items-center rounded-md border border-border bg-ink-2 font-display text-2xl italic text-hanko/40">
          巻
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="line-clamp-2 font-display text-sm font-semibold text-washi">
          {manga.name}
        </p>
        <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-gold">
          {gap === 1
            ? t("gap.missingOne")
            : t("gap.missingMany", { n: gap })}
        </p>
        <p className="mt-0.5 font-mono text-[10px] text-washi-dim truncate">
          {summarizeRange(missing)}
        </p>
      </div>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-4 w-4 shrink-0 text-washi-dim transition-transform group-hover:translate-x-0.5 group-hover:text-gold"
      >
        <line x1="5" y1="12" x2="19" y2="12" />
        <polyline points="12 5 19 12 12 19" />
      </svg>
    </button>
  );
}
