/**
 * 日替り · Daily-rotating prose for /profile + /stats.
 *
 * Three surfaces share the same machinery:
 *
 *   1. `byline`   — the small subtitle under the user's name on
 *                   /profile. 20 variations describing the page
 *                   as an identity / personal-archive surface.
 *
 *   2. `insight`  — the ceremonial one-liner banner on /profile,
 *                   bracketed by completion ratio. Each bracket
 *                   carries 3-4 variations so the user sees a
 *                   fresh phrasing daily WITHOUT losing the
 *                   bracket-specific framing (an empty archive
 *                   shouldn't be told "the work is done").
 *
 *   3. `statsSubtitle` — the italic prose under the StatsPage
 *                   hero title. 20 variations on the
 *                   "ledger of an archivist" theme.
 *
 * Rotation policy: deterministic by UTC day. The same user sees
 * the same text all day, then a different one tomorrow. A small
 * per-surface salt keeps the three rotations out of lockstep —
 * if they all advanced on the exact same midnight tick, the page
 * would feel like a slot machine refresh; the salt offsets each
 * surface's index so they drift independently.
 */

import { useLang } from "@/i18n/index.jsx";
import { useMemo } from "react";

// ─────────────────────────────────────────────────────────────
// Banks
// ─────────────────────────────────────────────────────────────

const BYLINE_BANK = {
  fr: [
    "Votre archive en un coup d'œil — curée avec soin, tome après tome.",
    "Une bibliothèque privée, tenue à la main, page après page.",
    "Le sceau personnel d'un archiviste — votre étagère, votre histoire.",
    "Un cahier vivant — qui grandit chaque fois qu'un tome rejoint l'étagère.",
    "L'inventaire d'une mémoire qui vous ressemble.",
    "Votre carnet de chevet — chaque entrée pesée, chaque tome aimé.",
    "Le résumé d'une vie de lecture — plié dans une seule page.",
    "Votre identité d'archiviste — ce que vous gardez, et pourquoi.",
    "L'étagère intérieure — soigneusement tenue, jamais finie.",
    "Une archive personnelle — sceaux et tomes, alignés.",
    "Le miroir de votre collection — fidèle au volume près.",
    "Votre fonds d'archive — discret, dense, soigné.",
    "Un journal d'étagère — où chaque tome a un visage.",
    "L'archive qui vous appartient — patiemment construite.",
    "Le récit d'une étagère — préservé sous votre sceau.",
    "Un cahier ouvert sur votre collection — le profil d'un lecteur.",
    "Votre carte d'archiviste — sceau, palette, et tomes possédés.",
    "Une étagère habitée — visible un instant, durable au-delà.",
    "Le visage public de votre archive — soigneusement composé.",
    "Une collection en cours — enrichie au rythme de vos lectures.",
  ],
  en: [
    "Your archive at a glance — curated with care, volume by volume.",
    "A private library, kept by hand, page after page.",
    "The personal seal of an archivist — your shelf, your story.",
    "A living notebook — growing each time a tome joins the shelf.",
    "The inventory of a memory that looks like you.",
    "Your bedside ledger — every entry weighed, every volume loved.",
    "The précis of a reading life — folded into a single page.",
    "Your archivist identity — what you keep, and why.",
    "The inner shelf — carefully tended, never quite finished.",
    "A personal archive — seals and tomes, lined up.",
    "The mirror of your collection — faithful down to the volume.",
    "Your archive holdings — discreet, dense, kept just so.",
    "A shelf journal — where every tome has a face.",
    "The archive that belongs to you — patiently built.",
    "The story of a shelf — preserved under your seal.",
    "A notebook open on your collection — a reader's profile.",
    "Your archivist's card — seal, palette, and volumes owned.",
    "An inhabited shelf — visible for a moment, lasting beyond.",
    "The public face of your archive — carefully composed.",
    "A collection in progress — growing at the pace of your reading.",
  ],
  es: [
    "Tu archivo de un vistazo — curado con cariño, tomo a tomo.",
    "Una biblioteca privada, llevada a mano, página a página.",
    "El sello personal de un archivista — tu estantería, tu historia.",
    "Un cuaderno vivo — que crece cada vez que un tomo se suma al estante.",
    "El inventario de una memoria que se te parece.",
    "Tu cuaderno de cabecera — cada entrada pesada, cada tomo querido.",
    "El resumen de una vida de lectura — plegado en una sola página.",
    "Tu identidad de archivista — lo que guardas, y por qué.",
    "El estante interior — cuidadosamente atendido, nunca acabado.",
    "Un archivo personal — sellos y tomos, alineados.",
    "El espejo de tu colección — fiel hasta el volumen.",
    "Tu fondo de archivo — discreto, denso, esmerado.",
    "Un diario de estante — donde cada tomo tiene un rostro.",
    "El archivo que te pertenece — pacientemente construido.",
    "El relato de un estante — preservado bajo tu sello.",
    "Un cuaderno abierto sobre tu colección — el perfil de un lector.",
    "Tu carta de archivista — sello, paleta y tomos en posesión.",
    "Un estante habitado — visible un instante, duradero más allá.",
    "La cara pública de tu archivo — cuidadosamente compuesta.",
    "Una colección en curso — enriquecida al ritmo de tus lecturas.",
  ],
};

// Insight banner — bracketed by completion ratio. The eye of an
// empty archive shouldn't see "the work is done" prose; the eye
// of a 100%-complete one shouldn't see "the journey begins".
// Keys must match `pickBracket` below.
const INSIGHT_BANK = {
  fr: {
    empty: [
      "Toute collection commence par un seul tome. Vous construisez quelque chose de précieux.",
      "L'archive vous attend. Le premier sceau est le plus important — celui que vous choisirez.",
      "Page blanche, encre fraîche. Quel sera le premier tome inscrit dans votre cahier ?",
      "L'archiviste qui ne possède pas encore est celui qui choisit le mieux. Prenez le temps.",
    ],
    beginning: [
      "Les premières heures de l'archive — vous écrivez son caractère, tome après tome.",
      "Chaque ajout est une décision. Votre étagère grandit avec vos goûts, pas malgré eux.",
      "L'inventaire prend forme. Ce que vous gardez aujourd'hui dira qui vous étiez.",
      "Une collection se sculpte dans le temps. Vous êtes au bon endroit.",
      "L'archive démarre — c'est l'instant le plus beau, où tout reste à choisir.",
    ],
    halfway: [
      "À mi-chemin — la collection a maintenant son épine dorsale. Le reste se précisera.",
      "L'inventaire s'étoffe. Vous reconnaissez vos lacunes ; c'est le signe d'un archiviste mûr.",
      "Le squelette est posé. Reste à habiller les rayons des tomes manquants.",
      "Vous tenez désormais la moitié de votre archive entre les mains. Belle masse.",
    ],
    almost: [
      "Plus que quelques tomes pour clôre les séries — la patience se trouve récompensée.",
      "L'archive s'achève. La fin est en vue, et c'est elle qui rend tout ce qui précède plus beau.",
      "Quelques rayons encore vides — chacun deviendra un événement quand il se remplira.",
      "Vous voyez le bout du couloir. Dernier souffle avant la complétude.",
    ],
    complete: [
      "Toutes les séries scellées. Votre cahier respire au plein — l'archive est complète.",
      "La pile parfaite. Chaque tome possédé, chaque rayon plein. Un archiviste accompli.",
      "Œuvre achevée. Le dernier tome a trouvé sa place — l'archive est à vous tout entière.",
    ],
  },
  en: {
    empty: [
      "Every collection begins with a single tome. You are building something precious.",
      "The archive awaits. The first seal is the most important — the one you choose.",
      "Blank page, fresh ink. What will be the first tome you inscribe?",
      "The archivist who owns nothing yet is the one who chooses best. Take your time.",
    ],
    beginning: [
      "The early hours of the archive — you are writing its character, tome by tome.",
      "Every addition is a decision. Your shelf grows with your tastes, not against them.",
      "The inventory is taking shape. What you keep today will tell who you were.",
      "A collection is sculpted in time. You are in the right place.",
      "The archive is starting — the most beautiful moment, when everything is still to choose.",
    ],
    halfway: [
      "Halfway there — the collection has its backbone now. The rest will sharpen.",
      "The inventory fills out. You recognise your gaps; the mark of a mature archivist.",
      "The skeleton is laid. Now to dress the shelves with the missing tomes.",
      "You hold half your archive in your hands. A handsome mass.",
    ],
    almost: [
      "A few volumes left to close the series — patience finds its reward.",
      "The archive draws to its end. The finish is in sight, and it makes all that came before more beautiful.",
      "A handful of shelves still empty — each will become an event when it fills.",
      "You see the end of the hall. One last breath before completion.",
    ],
    complete: [
      "Every series sealed. Your notebook breathes full — the archive is complete.",
      "The perfect pile. Every tome owned, every shelf full. An accomplished archivist.",
      "Work achieved. The last tome has found its place — the archive is yours entire.",
    ],
  },
  es: {
    empty: [
      "Toda colección empieza por un solo tomo. Construyes algo precioso.",
      "El archivo te espera. El primer sello es el más importante — el que tú elijas.",
      "Página en blanco, tinta fresca. ¿Cuál será el primer tomo que inscribas?",
      "El archivista que aún no posee es el que mejor elige. Tómate tu tiempo.",
    ],
    beginning: [
      "Las primeras horas del archivo — escribes su carácter, tomo a tomo.",
      "Cada adición es una decisión. Tu estante crece con tus gustos, no a pesar de ellos.",
      "El inventario toma forma. Lo que guardes hoy dirá quién fuiste.",
      "Una colección se esculpe con el tiempo. Estás en el lugar adecuado.",
      "El archivo arranca — es el instante más hermoso, cuando todo está por elegir.",
    ],
    halfway: [
      "A medio camino — la colección ya tiene su columna vertebral. El resto se precisará.",
      "El inventario se enriquece. Reconoces tus huecos; es la señal de un archivista maduro.",
      "El esqueleto está puesto. Queda vestir las baldas con los tomos que faltan.",
      "Ahora tienes la mitad de tu archivo entre las manos. Hermoso peso.",
    ],
    almost: [
      "Solo unos pocos tomos para cerrar las series — la paciencia se recompensa.",
      "El archivo se acaba. El final se ve, y es lo que hace más hermoso todo lo anterior.",
      "Unas pocas baldas aún vacías — cada una será un evento cuando se llene.",
      "Ves el final del pasillo. Último aliento antes de la completitud.",
    ],
    complete: [
      "Todas las series selladas. Tu cuaderno respira lleno — el archivo está completo.",
      "La pila perfecta. Cada tomo en posesión, cada balda llena. Un archivista consumado.",
      "Obra acabada. El último tomo encontró su sitio — el archivo es tuyo, entero.",
    ],
  },
};

const STATS_SUBTITLE_BANK = {
  fr: [
    "Chaque tome, chaque saison, chaque main qui a tenu un volume — l'archive entière disposée comme un grand cahier de comptable.",
    "Tout est compté, classé, balisé — votre archive ouverte au feuilletage des chiffres.",
    "Les pages du registre — mois par mois, prêts par prêts, tome par tome.",
    "L'inventaire détaillé d'une collection vivante — chaque ligne prise au sérieux.",
    "Le maître-cahier de votre étagère — additionné, classé, illustré.",
    "Là où vivent les chiffres : auteurs, éditeurs, sceaux, dépenses, saisons.",
    "Sept feuillets qui découpent votre archive — du plus prosaïque au plus tendre.",
    "L'étagère dépliée comme un grand livre de comptes — chaque kanji une rubrique.",
    "Votre collection projetée en figures — patiemment additionnée, fidèlement classée.",
    "Les comptes d'un archiviste — tomes, prêts, sceaux, saisons, correspondants.",
    "L'archive en chiffres et en lignes — tout ce qu'on peut compter, on l'a compté.",
    "Le registre tenu jour après jour — votre étagère vue depuis la table de comptage.",
    "Sept registres reliés ensemble — un par feuillet, un par humeur.",
    "Tout ce que la collection rend visible — auteurs, éditeurs, prix, sceaux.",
    "L'envers du décor — ce qui se passe vraiment derrière la beauté des couvertures.",
    "Les comptes ouverts d'une étagère — additions, soustractions, multiplications du temps.",
    "Le détail dont l'œil n'a pas conscience — l'archive en chiffres, en barres, en pourcentages.",
    "Sept volets en sept kanji — la lecture analytique de votre étagère.",
    "Le grand livre de l'archiviste — relié, paginé, indexé.",
    "Tout ce qui se mesure dans votre collection — tenu en chiffres précis.",
  ],
  en: [
    "Every volume, every season, every hand that held a tome — the whole archive laid out like a great ledger book.",
    "Counted, classed, tagged — your archive opened to the riffle of numbers.",
    "Pages of the register — month by month, loan by loan, tome by tome.",
    "The detailed inventory of a living collection — every line taken seriously.",
    "The master ledger of your shelf — summed, classed, illuminated.",
    "Where the figures live: authors, publishers, seals, spending, seasons.",
    "Seven folios that cut across your archive — from the most prosaic to the most tender.",
    "The shelf laid open as a great book of accounts — each kanji a rubric.",
    "Your collection cast as figures — patiently added, faithfully filed.",
    "The accounts of an archivist — volumes, loans, seals, seasons, correspondents.",
    "The archive in figures and lines — everything countable, counted.",
    "The register kept day after day — your shelf seen from the counting table.",
    "Seven registers bound together — one per folio, one per mood.",
    "Everything the collection makes visible — authors, publishers, prices, seals.",
    "The other side of the curtain — what actually happens behind the beauty of the covers.",
    "An open ledger of a shelf — additions, subtractions, multiplications of time.",
    "The detail the eye doesn't notice — the archive in numbers, in bars, in percents.",
    "Seven panels in seven kanji — the analytic reading of your shelf.",
    "The archivist's great book — bound, paginated, indexed.",
    "Everything measurable in your collection — held in precise figures.",
  ],
  es: [
    "Cada tomo, cada estación, cada mano que sostuvo un volumen — el archivo entero dispuesto como un gran libro mayor.",
    "Contado, clasificado, etiquetado — tu archivo abierto al hojeo de las cifras.",
    "Las páginas del registro — mes a mes, préstamo a préstamo, tomo a tomo.",
    "El inventario detallado de una colección viva — cada línea tomada en serio.",
    "El libro maestro de tu estante — sumado, clasificado, iluminado.",
    "Donde viven las cifras: autores, editoriales, sellos, gastos, estaciones.",
    "Siete folios que recorren tu archivo — del más prosaico al más tierno.",
    "El estante desplegado como un gran libro de cuentas — cada kanji una rúbrica.",
    "Tu colección proyectada en cifras — pacientemente sumada, fielmente archivada.",
    "Las cuentas de un archivista — tomos, préstamos, sellos, estaciones, corresponsales.",
    "El archivo en cifras y líneas — todo lo contable, contado.",
    "El registro llevado día tras día — tu estante visto desde la mesa de cuentas.",
    "Siete registros encuadernados juntos — uno por folio, uno por humor.",
    "Todo lo que la colección vuelve visible — autores, editoriales, precios, sellos.",
    "El reverso del decorado — lo que pasa de verdad tras la belleza de las cubiertas.",
    "Las cuentas abiertas de un estante — sumas, restas, multiplicaciones del tiempo.",
    "El detalle que el ojo no nota — el archivo en cifras, en barras, en porcentajes.",
    "Siete paneles en siete kanji — la lectura analítica de tu estante.",
    "El gran libro del archivista — encuadernado, paginado, indexado.",
    "Todo lo medible en tu colección — sostenido en cifras precisas.",
  ],
};

// ─────────────────────────────────────────────────────────────
// Picker
// ─────────────────────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

/**
 * Hash a small seed string into a stable integer. The output is
 * mixed into the daily index so different surfaces don't all
 * roll over on the exact same midnight tick.
 */
function hashSeed(seed) {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) {
    h = (h * 31 + seed.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

/**
 * Deterministic per-day index into an array of length `len`.
 * Same UTC day → same index for everyone (assuming the same
 * `seed`). Crossing UTC midnight bumps to the next entry.
 */
export function dailyIndex(seed, len) {
  if (!len || len <= 0) return 0;
  const days = Math.floor(Date.now() / MS_PER_DAY);
  return (days + hashSeed(seed)) % len;
}

/**
 * Resolve the active language's bank, falling back to English so
 * an unmapped locale never crashes the page.
 */
function bankFor(map, lang) {
  return map[lang] ?? map.en;
}

// ─────────────────────────────────────────────────────────────
// Public hooks
// ─────────────────────────────────────────────────────────────

/**
 * Pick today's profile-byline. Memoised on `lang` so the same
 * render returns the same string (otherwise a re-render right
 * after midnight could swap mid-paint).
 */
export function useDailyByline() {
  const lang = useLang();
  return useMemo(() => {
    const arr = bankFor(BYLINE_BANK, lang);
    return arr[dailyIndex("byline", arr.length)];
  }, [lang]);
}

/**
 * Pick today's stats-page subtitle. Memoised on `lang`.
 */
export function useDailyStatsSubtitle() {
  const lang = useLang();
  return useMemo(() => {
    const arr = bankFor(STATS_SUBTITLE_BANK, lang);
    return arr[dailyIndex("statsSubtitle", arr.length)];
  }, [lang]);
}

/**
 * Map a (totalVolumesOwned, completionRate) pair to one of the
 * five insight brackets the bank is keyed on.
 */
export function pickBracket({ totalVolumesOwned, completionRate }) {
  if (!totalVolumesOwned) return "empty";
  if (completionRate === 100) return "complete";
  if (completionRate > 75) return "almost";
  if (completionRate > 50) return "halfway";
  return "beginning";
}

/**
 * Pick today's insight prose for the given completion bracket.
 * Memoised on `lang` + `bracket` so a quick state flip back and
 * forth (e.g. the user momentarily un-owning a volume mid-edit
 * then re-owning it) doesn't ping-pong the prose.
 */
export function useDailyInsight(bracket) {
  const lang = useLang();
  return useMemo(() => {
    const buckets = bankFor(INSIGHT_BANK, lang);
    const arr = buckets[bracket] ?? buckets.beginning;
    return arr[dailyIndex(`insight-${bracket}`, arr.length)];
  }, [lang, bracket]);
}
