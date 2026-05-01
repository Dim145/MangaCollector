import { useContext, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import Skeleton from "./ui/Skeleton.jsx";
import SettingsContext from "@/SettingsContext.js";
import { useActivity } from "@/hooks/useActivity.js";
import { useLibrary } from "@/hooks/useLibrary.js";
import { useT, useLang } from "@/i18n/index.jsx";

/** Map backend event_type → i18n text + icon SVG path. */
const EVENT_VISUAL = {
  series_added: {
    tone: "hanko",
    path: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 8v8M8 12h8" />
      </>
    ),
  },
  series_removed: {
    tone: "washi-dim",
    path: (
      <>
        <path d="M3 6h18" />
        <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
        <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      </>
    ),
  },
  series_completed: {
    tone: "gold",
    path: (
      <>
        <path d="M12 2 15 8l7 .5-5 4.5 1.5 7L12 17l-6.5 3L7 13 2 8.5 9 8z" />
      </>
    ),
  },
  volume_owned: {
    tone: "hanko",
    path: <polyline points="20 6 9 17 4 12" />,
  },
  volume_unowned: {
    tone: "washi-dim",
    path: (
      <>
        <line x1="18" y1="6" x2="6" y2="18" />
        <line x1="6" y1="6" x2="18" y2="18" />
      </>
    ),
  },
  milestone_volumes: {
    tone: "gold",
    path: (
      <>
        <circle cx="12" cy="8" r="6" />
        <path d="M8 14l-2 8 6-3 6 3-2-8" />
      </>
    ),
  },
  milestone_series: {
    tone: "gold",
    path: (
      <>
        <circle cx="12" cy="8" r="6" />
        <path d="M8 14l-2 8 6-3 6 3-2-8" />
      </>
    ),
  },
};

function formatRelative(ts, lang) {
  if (!ts) return "";
  const date = new Date(ts);
  const diffMs = Date.now() - date.getTime();
  const seconds = Math.round(diffMs / 1000);
  const minutes = Math.round(seconds / 60);
  const hours = Math.round(minutes / 60);
  const days = Math.round(hours / 24);

  const rtf = new Intl.RelativeTimeFormat(lang, { numeric: "auto" });
  if (seconds < 60) return rtf.format(-seconds, "second");
  if (minutes < 60) return rtf.format(-minutes, "minute");
  if (hours < 24) return rtf.format(-hours, "hour");
  if (days < 30) return rtf.format(-days, "day");
  return date.toLocaleDateString(lang);
}

export default function ActivityFeed({ limit = 20 }) {
  const t = useT();
  const lang = useLang();
  const navigate = useNavigate();
  const { adult_content_level } = useContext(SettingsContext);
  const { data: activity, isInitialLoad, isEmpty } = useActivity(limit);
  const { data: library } = useLibrary();

  // Fast lookup for covers by mal_id
  const coverByMal = useMemo(() => {
    const m = new Map();
    for (const l of library ?? []) m.set(l.mal_id, l);
    return m;
  }, [library]);

  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-ink-1/50 p-6 backdrop-blur">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-washi-dim">
            {t("activity.label")}
          </p>
          <h2 className="mt-1 font-display text-xl font-semibold text-washi">
            {t("activity.title")}
          </h2>
        </div>
      </div>

      {isInitialLoad ? (
        <ul className="space-y-3">
          {[...Array(5)].map((_, i) => (
            <li key={i} className="flex items-center gap-3">
              <Skeleton className="h-9 w-9 rounded-lg" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3 w-3/4" />
                <Skeleton className="h-2.5 w-16" />
              </div>
            </li>
          ))}
        </ul>
      ) : isEmpty ? (
        <div className="py-6 text-center">
          <p className="font-display italic text-washi-muted">
            {t("activity.empty")}
          </p>
          <p className="mt-1 text-xs text-washi-dim">
            {t("activity.emptyHint")}
          </p>
        </div>
      ) : (
        <ul className="space-y-2.5">
          {activity.map((entry, i) => (
            <ActivityRow
              key={entry.id}
              entry={entry}
              cover={coverByMal.get(entry.mal_id)}
              onOpen={(m) =>
                m &&
                navigate("/mangapage", {
                  state: { manga: m, adult_content_level },
                  viewTransition: true,
                })
              }
              lang={lang}
              t={t}
              index={i}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function ActivityRow({ entry, cover, onOpen, lang, t, index }) {
  const visual = EVENT_VISUAL[entry.event_type] ?? EVENT_VISUAL.series_added;
  const toneClass =
    visual.tone === "hanko"
      ? "text-hanko-bright bg-hanko/15"
      : visual.tone === "gold"
        ? "text-gold bg-gold/15"
        : "text-washi-dim bg-washi/10";

  const label = buildLabel(entry, t);
  const hasClickable = Boolean(cover);

  return (
    <li
      className="flex items-start gap-3 animate-fade-up"
      style={{ animationDelay: `${Math.min(index * 40, 400)}ms` }}
    >
      <span
        className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${toneClass}`}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          className="h-4 w-4"
        >
          {visual.path}
        </svg>
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm leading-snug text-washi">
          {hasClickable ? (
            <button
              type="button"
              onClick={() => onOpen(cover)}
              className="text-left hover:text-hanko-bright transition-colors"
            >
              {label}
            </button>
          ) : (
            label
          )}
        </p>
        <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-washi-dim">
          {formatRelative(entry.created_on, lang)}
        </p>
      </div>
      {cover?.image_url_jpg && (
        <button
          type="button"
          onClick={() => onOpen(cover)}
          aria-label={cover.name}
          className="shrink-0"
        >
          <img referrerPolicy="no-referrer"
            src={cover.image_url_jpg}
            alt=""
            className="h-10 w-7 rounded border border-border object-cover"
          />
        </button>
      )}
    </li>
  );
}

function buildLabel(entry, t) {
  const title = entry.name ?? "";
  switch (entry.event_type) {
    case "series_added":
      return t("activity.seriesAdded", { title });
    case "series_removed":
      return t("activity.seriesRemoved", { title });
    case "series_completed":
      return t("activity.seriesCompleted", {
        title,
        n: entry.count_value ?? 0,
      });
    case "volume_owned":
      return t("activity.volumeOwned", {
        title,
        n: entry.vol_num ?? "?",
      });
    case "volume_unowned":
      return t("activity.volumeUnowned", {
        title,
        n: entry.vol_num ?? "?",
      });
    case "milestone_volumes":
      return t("activity.milestoneVolumes", { n: entry.count_value ?? 0 });
    case "milestone_series":
      return t("activity.milestoneSeries", { n: entry.count_value ?? 0 });
    default:
      return entry.event_type;
  }
}
