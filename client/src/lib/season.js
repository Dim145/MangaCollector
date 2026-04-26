/**
 * 季節 · Astronomical season helpers.
 *
 * The HTML bootstrap (index.html) tints the page from the user's
 * `mc:season` preference for first paint. THIS module answers a
 * different question: which real-world season are we in *right now*?
 * That answer drives the seasonal greeting banner that surfaces once
 * per quarter on the dashboard.
 *
 * "Right now" is computed from the actual equinox / solstice times,
 * not a coarse month bucket. The vernal equinox is the day a user
 * in France or Japan calls "the start of spring" (~21 March most
 * years, sometimes 20 March), and the user wanted the banner to
 * fire on that exact day. We use Jean Meeus' Astronomical Algorithms
 * (Chapter 27) — purely deterministic local computation, no third-
 * party API, no privacy footprint.
 *
 * Hemisphere is detected from the user's IANA timezone. Southern-
 * hemisphere zones invert the four windows so the March equinox
 * starts autumn (instead of spring) for them — a Buenos Aires user
 * gets `aki / 立秋` on 21 March, exactly as their calendar reads.
 *
 * We deliberately ignore the user's `mc:season` override here: the
 * greeting celebrates the calendar turning, not the user's chosen
 * tint. Someone who pinned summer year-round still gets to mark
 * 立秋 when autumn rolls around in the real world.
 */

const GREETED_KEY = "mc:season-greeted";

// ─── Meeus mean equinox / solstice coefficients ──────────────────
// Each tuple gives the Julian Ephemeris Day (JDE) of the *mean*
// event for a given year via the polynomial:
//   JDE0(Y) = c0 + c1·Y + c2·Y² + c3·Y³ + c4·Y⁴   where Y = (year-2000)/1000
// Without the periodic-term correction we're accurate to ~±20 min
// for years 1000-3000 — far below the day resolution we actually
// need to drive a once-per-season banner. (Source: Jean Meeus,
// "Astronomical Algorithms", 2nd ed., Table 27.A.)
const SEASON_COEFS = {
  march: [2451623.80984, 365242.37404, 0.05169, -0.00411, -0.00057],
  june: [2451716.56767, 365241.62603, 0.00325, 0.00888, -0.00030],
  september: [2451810.21715, 365242.01767, -0.11575, 0.00337, 0.00078],
  december: [2451900.05952, 365242.74049, -0.06223, -0.00823, 0.00032],
};

/** Polynomial evaluation of Meeus' JDE0 for one of the four events. */
function meeusJDE(event, year) {
  const c = SEASON_COEFS[event];
  const Y = (year - 2000) / 1000;
  return (
    c[0] + c[1] * Y + c[2] * Y * Y + c[3] * Y * Y * Y + c[4] * Y * Y * Y * Y
  );
}

/** Convert a Julian Date to a JS `Date` (UTC). 2440587.5 is the
 *  Julian Date of the Unix epoch. We're treating JDE as JD here:
 *  the ~70 s ΔT (TT-UT1) is invisible at day resolution. */
function jdeToDate(jde) {
  return new Date((jde - 2440587.5) * 86_400_000);
}

/** Cache one year's worth of dates so multiple banner reads in the
 *  same session don't repeat the polynomial for nothing. */
const dateCache = new Map();
function seasonalDates(year) {
  let d = dateCache.get(year);
  if (d) return d;
  d = {
    march: jdeToDate(meeusJDE("march", year)),
    june: jdeToDate(meeusJDE("june", year)),
    september: jdeToDate(meeusJDE("september", year)),
    december: jdeToDate(meeusJDE("december", year)),
  };
  dateCache.set(year, d);
  return d;
}

// ─── Hemisphere detection ────────────────────────────────────────
// IANA timezones whose city is in the southern hemisphere. The list
// covers the populated zones — Antarctica is included for symmetry
// but realistically there are no PWA users on McMurdo. A miss
// (unrecognised southern zone) defaults to northern, which means
// the banner just lights up "the wrong way" — a small cosmetic bug
// rather than a crash.
const SOUTHERN_TZ_PATTERNS = [
  /^Antarctica\//,
  /^Australia\//,
  /^Pacific\/(Auckland|Chatham|Easter|Galapagos|Fiji|Tahiti|Tongatapu|Norfolk|Apia|Pago_Pago)$/,
  /^America\/(Argentina\/|Asuncion|La_Paz|Lima|Manaus|Montevideo|Punta_Arenas|Santiago|Sao_Paulo|Bahia|Recife|Maceio|Fortaleza|Belem|Cuiaba|Campo_Grande|Boa_Vista|Rio_Branco)/,
  /^Africa\/(Antananarivo|Blantyre|Bujumbura|Gaborone|Harare|Johannesburg|Kigali|Lubumbashi|Lusaka|Maputo|Maseru|Mbabane|Windhoek)$/,
  /^Atlantic\/(Stanley|St_Helena)$/,
  /^Indian\/(Antananarivo|Mauritius|Mahe|Reunion)$/,
];

/** Best-guess hemisphere via the runtime timezone. Falls back to
 *  northern when the timezone API is unavailable (very old browsers
 *  or sandboxes), which mirrors the current default behaviour. */
export function isSouthernHemisphere() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return false;
    return SOUTHERN_TZ_PATTERNS.some((re) => re.test(tz));
  } catch {
    return false;
  }
}

/** Inversion table — southern hemisphere flips the season name. */
const HEMISPHERE_FLIP = {
  spring: "autumn",
  summer: "winter",
  autumn: "spring",
  winter: "summer",
};

/**
 * Returns the calendar dates of the four seasonal events that bracket
 * `now` (the most recent past one and the next upcoming one). Used by
 * `isInSeasonTransition` below to decide whether we're inside the
 * "the season is changing" window that justifies running the ambient
 * atmosphere layer.
 */
function nearestSeasonalEvents(now = new Date()) {
  const year = now.getUTCFullYear();
  const events = [
    ...Object.values(seasonalDates(year - 1)),
    ...Object.values(seasonalDates(year)),
    ...Object.values(seasonalDates(year + 1)),
  ].sort((a, b) => a - b);
  const t = now.getTime();
  // Closest past event.
  let past = null;
  let future = null;
  for (const ev of events) {
    if (ev.getTime() <= t) past = ev;
    else if (!future) future = ev;
  }
  return { past, future };
}

/**
 * Is `now` within `windowDays` (default 3) of an equinox or solstice?
 *
 * The seasonal atmosphere layer only fires inside this window — the
 * idea being that the visual "the season is turning" cue is strongest
 * when the season is *actually* turning, not as a constant year-round
 * background hum. Outside the window the page reverts to its normal
 * non-animated atmosphere.
 *
 * Returns `true` for the 7-day band centred on each event (J-3 → J+3
 * inclusive). With four events per year, that's 28 days × Math.max(GPU)
 * vs 365 — a ~92% reduction in compositor pressure for the typical
 * user, while keeping the magic intact during the moments when the
 * page should feel alive.
 */
export function isInSeasonTransition(now = new Date(), windowDays = 3) {
  const { past, future } = nearestSeasonalEvents(now);
  const dayMs = 86_400_000;
  const t = now.getTime();
  const inPast = past && t - past.getTime() <= windowDays * dayMs;
  const inFuture = future && future.getTime() - t <= windowDays * dayMs;
  return Boolean(inPast || inFuture);
}

/**
 * Returns the current astronomical season as one of the four ids.
 * The result already accounts for the user's hemisphere — a March
 * equinox is `spring` in Paris and `autumn` in Buenos Aires.
 */
export function getCurrentSeason(now = new Date()) {
  // The events that bracket the current season can come from the
  // same year, the previous year (we're in early Jan/Feb between
  // Dec solstice and March equinox), or the current year still
  // running into the next December solstice.
  const t = now.getTime();
  const year = now.getUTCFullYear();
  const this_ = seasonalDates(year);

  // Which window (using NH labels) does `now` fall into?
  let nh;
  if (t < this_.march.getTime()) {
    nh = "winter"; // we're past last december solstice
  } else if (t < this_.june.getTime()) {
    nh = "spring";
  } else if (t < this_.september.getTime()) {
    nh = "summer";
  } else if (t < this_.december.getTime()) {
    nh = "autumn";
  } else {
    nh = "winter";
  }

  return isSouthernHemisphere() ? HEMISPHERE_FLIP[nh] : nh;
}

/**
 * Has the banner already been shown for this exact season + year?
 * We key on `season-YYYY` so a user who skipped autumn 2025 still
 * gets autumn 2026's banner — the celebration is annual, not
 * one-shot-forever.
 */
export function hasGreetedSeason(season, now = new Date()) {
  try {
    const last = localStorage.getItem(GREETED_KEY);
    return last === seasonStamp(season, now);
  } catch {
    // Quota / private mode — pretend we already greeted so we don't
    // hammer a stuck user with the banner every navigation.
    return true;
  }
}

/** Persist that the user has acknowledged the current season+year. */
export function markSeasonGreeted(season, now = new Date()) {
  try {
    localStorage.setItem(GREETED_KEY, seasonStamp(season, now));
  } catch {
    /* ignore */
  }
}

/**
 * Combine season id + the year the season *ends* in. Winter spans
 * Dec → Mar so we anchor December's stamp on year+1; without that,
 * a user greeted in late December would re-see the banner the very
 * next morning when the year flipped.
 */
function seasonStamp(season, now) {
  const m = now.getMonth() + 1;
  const year =
    season === "winter" && m === 12 ? now.getFullYear() + 1 : now.getFullYear();
  return `${season}-${year}`;
}
