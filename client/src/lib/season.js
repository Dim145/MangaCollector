/**
 * Astronomical season helpers — drives the once-per-quarter dashboard banner
 * based on the actual equinox / solstice instants (deterministic local
 * computation, no API), and inverts hemispheres from the user's IANA timezone.
 */

const GREETED_KEY = "mc:season-greeted";

// Meeus mean equinox/solstice polynomial JDE0(Y) = Σ cᵢ·Yⁱ, Y = (year-2000)/1000.
// Accurate to ~±20 min for years 1000-3000 — well below day resolution.
// Source: Jean Meeus, "Astronomical Algorithms", 2nd ed., Table 27.A.
const SEASON_COEFS = {
  march: [2451623.80984, 365242.37404, 0.05169, -0.00411, -0.00057],
  june: [2451716.56767, 365241.62603, 0.00325, 0.00888, -0.00030],
  september: [2451810.21715, 365242.01767, -0.11575, 0.00337, 0.00078],
  december: [2451900.05952, 365242.74049, -0.06223, -0.00823, 0.00032],
};

function meeusJDE(event, year) {
  const c = SEASON_COEFS[event];
  const Y = (year - 2000) / 1000;
  return (
    c[0] + c[1] * Y + c[2] * Y * Y + c[3] * Y * Y * Y + c[4] * Y * Y * Y * Y
  );
}

// 2440587.5 = Julian Date of the Unix epoch. Treating JDE as JD: the ~70 s ΔT
// (TT-UT1) is invisible at day resolution.
function jdeToDate(jde) {
  return new Date((jde - 2440587.5) * 86_400_000);
}

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

// Populated southern-hemisphere IANA zones. A miss defaults to northern —
// the banner just lights up the wrong way, no crash.
const SOUTHERN_TZ_PATTERNS = [
  /^Antarctica\//,
  /^Australia\//,
  /^Pacific\/(Auckland|Chatham|Easter|Galapagos|Fiji|Tahiti|Tongatapu|Norfolk|Apia|Pago_Pago)$/,
  /^America\/(Argentina\/|Asuncion|La_Paz|Lima|Manaus|Montevideo|Punta_Arenas|Santiago|Sao_Paulo|Bahia|Recife|Maceio|Fortaleza|Belem|Cuiaba|Campo_Grande|Boa_Vista|Rio_Branco)/,
  /^Africa\/(Antananarivo|Blantyre|Bujumbura|Gaborone|Harare|Johannesburg|Kigali|Lubumbashi|Lusaka|Maputo|Maseru|Mbabane|Windhoek)$/,
  /^Atlantic\/(Stanley|St_Helena)$/,
  /^Indian\/(Antananarivo|Mauritius|Mahe|Reunion)$/,
];

export function isSouthernHemisphere() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return false;
    return SOUTHERN_TZ_PATTERNS.some((re) => re.test(tz));
  } catch {
    return false;
  }
}

const HEMISPHERE_FLIP = {
  spring: "autumn",
  summer: "winter",
  autumn: "spring",
  winter: "summer",
};

// Returns the most recent past + next upcoming seasonal events around `now`.
function nearestSeasonalEvents(now = new Date()) {
  const year = now.getUTCFullYear();
  const events = [
    ...Object.values(seasonalDates(year - 1)),
    ...Object.values(seasonalDates(year)),
    ...Object.values(seasonalDates(year + 1)),
  ].sort((a, b) => a - b);
  const t = now.getTime();
  let past = null;
  let future = null;
  for (const ev of events) {
    if (ev.getTime() <= t) past = ev;
    else if (!future) future = ev;
  }
  return { past, future };
}

// `windowDays` defaults to 3 → 7-day band per event, 28 active days/yr.
// Atmosphere layer only animates inside this window to keep compositor calm.
export function isInSeasonTransition(now = new Date(), windowDays = 3) {
  const { past, future } = nearestSeasonalEvents(now);
  const dayMs = 86_400_000;
  const t = now.getTime();
  const inPast = past && t - past.getTime() <= windowDays * dayMs;
  const inFuture = future && future.getTime() - t <= windowDays * dayMs;
  return Boolean(inPast || inFuture);
}

// Hemisphere-aware current season (March equinox = spring NH / autumn SH).
export function getCurrentSeason(now = new Date()) {
  const t = now.getTime();
  const year = now.getUTCFullYear();
  const this_ = seasonalDates(year);

  let nh;
  if (t < this_.march.getTime()) {
    nh = "winter";
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

// Keyed `season-YYYY` so it's annual (skipping autumn 2025 still surfaces 2026).
export function hasGreetedSeason(season, now = new Date()) {
  try {
    const last = localStorage.getItem(GREETED_KEY);
    return last === seasonStamp(season, now);
  } catch {
    // Quota / private mode — return true so we don't hammer the user.
    return true;
  }
}

export function markSeasonGreeted(season, now = new Date()) {
  try {
    localStorage.setItem(GREETED_KEY, seasonStamp(season, now));
  } catch {
    /* ignore */
  }
}

// Winter spans Dec→Mar — anchor December's stamp on year+1 so the year-flip
// at midnight doesn't re-show the banner the next morning.
function seasonStamp(season, now) {
  const m = now.getMonth() + 1;
  const year =
    season === "winter" && m === 12 ? now.getFullYear() + 1 : now.getFullYear();
  return `${season}-${year}`;
}
