# Release Calendar Proxy — protocole

Ce document décrit **le contrat HTTP** que doit respecter un service tiers pour
servir de proxy de calendrier de sorties à Mangacollector. Toute implémentation
qui répond aux endpoints décrits ici peut remplacer l'implémentation de
référence (`manga-release-proxy`, en Rust). Le but est de pouvoir réécrire ce
service dans n'importe quel langage / framework sans toucher Mangacollector.

---

## 1. Pourquoi un proxy ?

Mangacollector délègue la collecte des annonces de tomes à venir à un service
externe. Cela permet :

- de **garder le backend léger** : le scraping de ~10 catalogues d'éditeurs
  + les API métadonnées (ANN, MangaUpdates) restent hors du processus principal ;
- de **rendre la fonctionnalité opt-in** : sans proxy configuré, la
  fonctionnalité Calendrier est désactivée — Mangacollector continue de tourner
  sans rien savoir des sorties à venir ;
- de **scaler indépendamment** : le proxy peut être déployé en plusieurs
  instances derrière un cache Redis partagé, sans toucher au backend principal.

Mangacollector garde uniquement Google Books **en process** (un appel HTTP
léger, peu coûteux) et fusionne ses résultats avec ceux du proxy. Tout le reste
(éditeurs, ANN, MangaUpdates, OpenLibrary…) vit dans le proxy.

---

## 2. Brancher un proxy à Mangacollector

Côté Mangacollector, deux variables d'environnement contrôlent la connexion :

| Variable | Défaut | Rôle |
|---|---|---|
| `EXTERNAL_PROXY_URL` | *(non défini)* | URL de base du proxy (ex. `http://manga-release-proxy:3001`). **Quand cette variable est absente ou vide, la fonctionnalité Calendrier est entièrement désactivée** — l'endpoint `discover_upcoming_with_locale` retourne une liste vide sans appeler quoi que ce soit. |
| `EXTERNAL_PROXY_TIMEOUT_SECS` | `150` | Timeout HTTP par requête vers le proxy. Doit rester **≥ 30 s au-dessus** du `AGGREGATE_DEADLINE_SECS` du proxy (cf. §6) pour absorber le temps de sérialisation et le transit réseau. |

Aucune autre configuration n'est nécessaire côté Mangacollector. Le proxy est
appelé sans authentification — il est attendu de tourner sur un réseau interne
non exposé publiquement (intranet Docker, VPC, k8s service).

---

## 3. Endpoints

Un proxy compatible **doit** exposer deux endpoints HTTP en `GET`, retournant
des réponses `Content-Type: application/json` (sauf `/health`).

### 3.1 `GET /health`

Sonde de liveness. Doit répondre **rapidement** sans toucher aucune source en
amont (pas de fetch éditeur, pas de Jikan, pas de MangaDex).

| Élément | Valeur attendue |
|---|---|
| Statut | `200 OK` |
| Body | `ok` (text/plain) ou `{"status":"ok"}` (application/json) — peu importe, Mangacollector ne lit pas ce body. |

```bash
$ curl http://manga-release-proxy:3001/health
ok
```

### 3.2 `GET /v1/upcoming`

Le seul endpoint utile fonctionnellement. Résout un identifiant de manga vers
sa liste de **tomes à paraître** sur les marchés demandés.

#### Paramètres de query string

| Nom | Type | Requis | Défaut | Description |
|---|---|---|---|---|
| `mal_id` | entier (i32 / i64) | au moins l'un des deux | — | Identifiant MyAnimeList du manga. |
| `mangadex_id` | string (UUID v4) | au moins l'un des deux | — | Identifiant MangaDex du manga. |
| `locales` | string CSV | non | `fr,en` | Codes ISO 639-1 séparés par virgules (ex. `fr,en,es`). Le code spécial `any` peut être inclus pour forcer les sources « language-agnostic ». |

**Au moins un des deux identifiants** (`mal_id` ou `mangadex_id`) doit être
fourni. Une requête sans aucun des deux **doit** retourner `400 Bad Request`
avec un body JSON décrivant l'erreur.

```bash
# Requête type — Mangacollector envoie toujours mal_id, parfois mangadex_id
$ curl 'http://manga-release-proxy:3001/v1/upcoming?mal_id=13&locales=fr,en'
```

#### Codes de retour attendus

| Code | Quand ? | Action côté Mangacollector |
|---|---|---|
| `200 OK` | Réponse normale, body JSON valide. | Parse + merge avec ses propres hits Google Books. |
| `400 Bad Request` | Paramètres invalides (aucun id, locales malformé). | Logue, retourne une cascade vide. |
| `429 Too Many Requests` | Rate limit dépassé. | Logue, retourne une cascade vide. |
| `5xx` / timeout / connect error | Proxy down ou en panne. | Logue au niveau DEBUG, retourne une cascade vide. **Aucune erreur ne remonte à l'utilisateur** — la feature dégrade gracieusement. |

---

## 4. Format de réponse JSON

Le body de `200 OK` sur `/v1/upcoming` doit respecter ce schéma :

```jsonc
{
  // Clé stable de la série, utilisable pour la déduplication client-side.
  // Format: "mal:{id}" si mal_id fourni, sinon "mangadex:{id}".
  "key": "mal:13",

  // Titres alternatifs résolus depuis MAL et/ou MangaDex.
  // L'ordre est SIGNIFICATIF : les titres les plus susceptibles de matcher
  // les slugs des éditeurs sont en tête. Mangacollector ne consomme pas ce
  // champ directement — il sert au debug et à la transparence du résultat.
  "titles": [
    "One Piece",
    "ワンピース",
    "ONE PIECE"
  ],

  // Liste des tomes à paraître, triée par `release_date` ascendant.
  // PEUT être vide même en cas de succès (la série n'a aucune annonce).
  "releases": [
    {
      // Identifiant slug de la source qui a produit cette ligne.
      // Valeurs typiques: "ann", "mangaupdates", "kioon", "glenat",
      // "delcourt", "akata", "imho", "pika", "kurokawa", "seven_seas".
      // Une autre implémentation peut introduire ses propres identifiants;
      // Mangacollector mappe tout ce qui n'est pas "ann" / "mangaupdates"
      // vers l'origine "editor" en interne.
      "source": "ann",

      // Titre tel que la source le diffuse. Pas forcément identique au
      // titre canonique du `titles` — peut être en langue cible.
      "series_title": "One Piece",

      // Numéro de tome annoncé. Entier positif.
      "vol_num": 112,

      // Date de sortie en ISO 8601 (UTC). DOIT être dans le futur — le
      // proxy filtre les annonces déjà parues avant de répondre.
      "release_date": "2026-07-07T00:00:00Z",

      // Optionnel — ISBN-13 quand la source le fournit, sinon `null`.
      "isbn": "9782344075500",

      // Optionnel — URL de la fiche produit chez la source, sinon `null`.
      // Mangacollector l'utilise comme lien de pré-commande dans le drawer.
      "url": "https://www.glenat.com/glenat-manga/one-piece-tome-112-...",

      // Locale de la sortie en ISO 639-1. `null` pour les sources
      // language-agnostic (ANN, MangaUpdates).
      "locale": "fr"
    }
  ]
}
```

### Garanties attendues sur le contenu

Pour qu'une implémentation soit considérée correcte, elle **doit** :

- ne renvoyer que des `release_date` strictement dans le futur (au moment où la
  réponse est calculée) ;
- dédoublonner les lignes identiques sur `(source, locale, vol_num, release_date)` ;
- trier `releases` par `release_date` ascendant (la première ligne est la
  prochaine sortie) ;
- toujours fournir le triplet `{source, series_title, vol_num, release_date}` —
  les trois autres champs (`isbn`, `url`, `locale`) peuvent être `null` ;
- répondre en moins de **150 secondes** au pire cas (sans quoi Mangacollector
  coupe la connexion).

---

## 5. Exemples concrets

Trois réponses réelles capturées sur l'implémentation de référence (port `3001`,
cache chaud). Elles couvrent les trois cas que doit savoir gérer un proxy
correct : succès riche multi-source, succès via résolution croisée de titres,
échec gracieux quand aucun titre ne match les slugs éditeurs.

### 5.1 Succès massif multi-source — One Piece (`mal_id=13`)

```bash
$ curl 'http://localhost:3001/v1/upcoming?mal_id=13&locales=fr,en'
```

```json
{
  "key": "mal:13",
  "titles": [
    "One Piece",
    "One Piece: Ace’s Story—The Manga",
    "One Piece Episode Ace",
    "ワンピース エピソード A",
    "ワンピース エピソード エース",
    "Roronoa Zoro, Umi ni Chiru",
    "ロロノア・ゾロ海に散る",
    "Ван Піс: Ророноа Зоро за бортом",
    "One Piece Special - Boichi Crossover",
    "ナミvsカリファ",
    "One Piece Episode A",
    "Roronoa Zoro Falls Into the Sea",
    "Nami vs. Kalifa"
  ],
  "releases": [
    {
      "source": "glenat",
      "series_title": "One Piece Roman - Novel Heroines",
      "vol_num": 2,
      "release_date": "2026-05-06T00:00:00Z",
      "isbn": "9782344075357",
      "url": "https://www.glenat.com/glenat-manga/one-piece-roman-novel-heroines-tome-02-9782344075357/",
      "locale": "fr"
    },
    {
      "source": "glenat",
      "series_title": "One Piece Vivre Card - Saison 01",
      "vol_num": 7,
      "release_date": "2026-05-06T00:00:00Z",
      "isbn": "9782344071229",
      "url": "https://www.glenat.com/glenat-manga/one-piece-vivre-cards-saison-01-tome-07-9782344071229/",
      "locale": "fr"
    },
    {
      "source": "glenat",
      "series_title": "One Piece Vivre Card - Saison 01",
      "vol_num": 8,
      "release_date": "2026-06-03T00:00:00Z",
      "isbn": "9782344071236",
      "url": "https://www.glenat.com/glenat-manga/one-piece-vivre-card-saison-01-tome-08-9782344071236/",
      "locale": "fr"
    },
    {
      "source": "glenat",
      "series_title": "One Piece Magazine",
      "vol_num": 16,
      "release_date": "2026-06-17T00:00:00Z",
      "isbn": "9782344070437",
      "url": "https://www.glenat.com/glenat-manga/one-piece-magazine-tome-16-9782344070437/",
      "locale": "fr"
    },
    {
      "source": "glenat",
      "series_title": "One Piece Vivre Card - Saison 01",
      "vol_num": 9,
      "release_date": "2026-07-01T00:00:00Z",
      "isbn": "9782344071243",
      "url": "https://www.glenat.com/glenat-manga/one-piece-vivre-card-saison-01-tome-09-9782344071243/",
      "locale": "fr"
    },
    {
      "source": "ann",
      "series_title": "One Piece",
      "vol_num": 112,
      "release_date": "2026-07-07T00:00:00Z",
      "isbn": null,
      "url": null,
      "locale": null
    },
    {
      "source": "ann",
      "series_title": "One Piece",
      "vol_num": 113,
      "release_date": "2026-11-10T00:00:00Z",
      "isbn": null,
      "url": null,
      "locale": null
    }
  ]
}
```

**Lecture** — Glénat sert 5 lignes pour les spin-offs (Vivre Card, Magazine,
Roman) avec ISBN + URL produit, locale `fr`. ANN sert 2 lignes pour les tomes
principaux à venir, sans ISBN ni URL et avec `locale: null` — ANN n'est pas
spécifique à un marché, ses dates sont des annonces internationales.

Notez que les `series_title` Glénat sont des **sous-séries** (« One Piece
Vivre Card », « One Piece Magazine »), pas le tronc principal. Mangacollector
les surface telles quelles à l'utilisateur.

### 5.2 Succès via enrichissement croisé — Slime (`mal_id=87609`)

```bash
$ curl 'http://localhost:3001/v1/upcoming?mal_id=87609&locales=fr,en'
```

```json
{
  "key": "mal:87609",
  "titles": [
    "Tensei shitara Slime Datta Ken",
    "Regarding Reincarnated to Slime",
    "That Time I Got Reincarnated as a Slime",
    "Re: My Reincarnation as a Slime",
    "Moi, quand je me réincarne en Slime",
    "TenSura",
    "Odrodzony jako galareta",
    "転生したらスライムだった件",
    "Tensei Slime",
    "TenSli",
    "In Regards to My Reincarnation as a Slime",
    "Vita da Slime",
    "О моём перерождении в слизь",
    "เกิดใหม่ทั้งทีก็เป็นสไลม์ไปซะแล้ว",
    "关于我转生后成为史莱姆的那件事",
    "전생했더니 슬라임이었던 건에 대하여",
    "Aquella vez que me convertí en Slime",
    "ذلك الوقت الذي تجسدت فيه كسلايم",
    "Kun jälleensynnyin hirviönä",
    "O zaman bir balçık olarak reenkarne oldum",
    "O zaman bir slime olarak reenkarne oldum",
    "Meine Wiedergeburt als Schleim in einer anderen Welt",
    "Lúc Đó Tôi Đã Chuyển Sinh Thành Slime"
  ],
  "releases": [
    {
      "source": "kurokawa",
      "series_title": "Moi, quand je me réincarne en Slime",
      "vol_num": 30,
      "release_date": "2026-07-02T00:00:00Z",
      "isbn": "9791042021825",
      "url": "https://www.lisez.com/livres/moi-quand-je-me-reincarne-en-slime-tome-30/9791042021825",
      "locale": "fr"
    },
    {
      "source": "kurokawa",
      "series_title": "Moi, quand je me réincarne en Slime - Trinité",
      "vol_num": 11,
      "release_date": "2026-08-20T00:00:00Z",
      "isbn": "9791042021856",
      "url": "https://www.lisez.com/livres/moi-quand-je-me-reincarne-en-slime-trinite-tome-11/9791042021856",
      "locale": "fr"
    }
  ]
}
```

**Lecture** — Cas le plus instructif. Le caller a fourni uniquement un `mal_id`,
or MAL renvoie « Tensei shitara Slime Datta Ken » comme titre canonique — un
titre romaji qui ne match aucun slug éditeur français. **Sans résolution
croisée**, les scrapers FR (Kurokawa via Lisez.com) ne trouveraient rien.

L'implémentation de référence détecte que `mangadex_id` est absent, lance un
**search MangaDex par le titre canonique MAL**, récupère les `altTitles`
multilingues, et c'est dans ces alt-titles que se trouve le titre français
« Moi, quand je me réincarne en Slime » (position 5 du `titles`). Une fois ce
titre injecté dans la liste des candidats, le scraper Kurokawa peut
substring-matcher l'URL `/livres/moi-quand-je-me-reincarne-en-slime-tome-30/...`
et remonter la fiche.

Un implémenteur qui omet cette étape de cross-search verrait son proxy
retourner `releases: []` pour la majorité des séries traduites en français —
toute l'utilité est dans cette résolution.

### 5.3 Échec gracieux — Frieren (`mal_id=126287`)

```bash
$ curl 'http://localhost:3001/v1/upcoming?mal_id=126287&locales=fr'
```

```json
{
  "key": "mal:126287",
  "titles": [
    "Sousou no Frieren",
    "Frieren at the Funeral",
    "Frieren: Beyond Journey's End",
    "Frieren the Slayer",
    "葬送のフリーレン",
    "Фрирен, провожающая в последний путь",
    "葬送的芙莉蓮",
    "장송의 프리렌",
    "คำอธิษฐานในวันที่จากลา Frieren",
    "Φρίρεν: Πέρα από το Τέλος του Ταξιδιού",
    "Frieren: Nach dem Ende der Reise",
    "Frieren: Remnants Of The Departed",
    "Frieren: Más allá del final",
    "Frieren: Más allá del fin del viaje",
    "Pháp Sư Tiễn Táng Frieren"
  ],
  "releases": []
}
```

**Lecture** — Frieren EST publié en France (chez Ki-oon) sous le titre court
« Frieren ». Pourtant, le proxy retourne `releases: []`. Pourquoi ?

Aucun des 15 titres alternatifs résolus depuis MAL/MangaDex n'est exactement
« Frieren » seul — tous portent un sous-titre (« Sousou no Frieren », « Frieren
the Slayer », « Frieren: Beyond Journey's End »…). Le matching slug-substring
des scrapers est unidirectionnel : il vérifie que **le slug URL éditeur
contient le slug du titre user**, pas l'inverse. Donc :

- slug user (depuis « Frieren the Slayer ») → `frieren-the-slayer`
- slug Ki-oon URL → `frieren`
- `"frieren".contains("frieren-the-slayer")` → **false**

Aucun match, aucune ligne. **Le proxy répond `200 OK` avec une liste vide** —
c'est le comportement attendu. Il ne retourne **pas** d'erreur HTTP, ne loggue
pas en `WARN`, ne propage rien à Mangacollector. La feature dégrade
silencieusement et l'utilisateur voit simplement « aucune annonce » dans son
calendrier.

Un implémenteur qui voudrait améliorer ce cas pourrait ajouter une heuristique
de matching plus tolérante (Levenshtein, prefix match dans les deux sens,
détection de mots-pivots). Le contrat HTTP n'impose rien — c'est une
opportunité d'optimisation laissée à chaque implémentation.

---

## 6. Contraintes opérationnelles

### 6.1 Cache

Une implémentation **devrait** mettre en cache à plusieurs niveaux pour ne pas
retraverser tout le réseau de sources à chaque requête. Les TTL recommandés
(repris de l'implémentation de référence) :

| Couche | TTL recommandé | Rationnel |
|---|---|---|
| Mapping `id → titres` (Jikan, MangaDex) | **7 jours** | Les titres canoniques bougent rarement. |
| Sitemaps éditeurs | **24 h** | Les calendriers d'éditeurs évoluent par cycle hebdomadaire. |
| Pages produit individuelles | **24 h** | Cohérent avec les sitemaps. |
| Réponse agrégée par série | `min(prochaine_sortie - now, 24 h)` | Cap à 24 h pour absorber les replanifications éditeur (un T15 décalé d'une semaine). |
| Cache miss négatif (« aucun hit ») | **24 h** | Évite de hammer pour des séries sans annonce. |

L'implémentation de référence utilise Redis avec un fallback `moka` en mémoire ;
un autre proxy peut utiliser Memcached, SQLite, ou même un simple `HashMap` —
le contrat HTTP est silent à ce sujet.

### 6.2 Budget temps (deadline)

Le scraping cold-cache d'une série populaire peut générer 50-100 requêtes
sortantes (sitemaps + pages produit chez plusieurs éditeurs). Une implémentation
doit :

- définir un **deadline global** (par défaut 120 s dans la référence) ;
- **harvester les résultats partiels** des sources qui ont déjà fini quand le
  deadline trippe — ne **JAMAIS** retourner `Vec::new()` en cas de timeout
  global, au risque de masquer toutes les sources qui avaient déjà répondu ;
- **ne pas mettre en cache** une réponse partielle (deadline-aborted), pour
  laisser une chance au prochain appel d'aller plus loin ;
- s'auto-paciser avec les éditeurs (typiquement 250-500 ms entre fetches d'une
  même source) — éthique de scraping respectueux.

### 6.3 Rate limiting

Optionnel mais **fortement recommandé** : une implémentation devrait limiter
les requêtes par IP source pour éviter qu'un client mal configuré ne sature le
proxy.

L'implémentation de référence ship avec `tower_governor` configuré via
`RATE_LIMIT_PER_MINUTE=60` et `RATE_LIMIT_BURST=10`. Une autre implémentation
peut utiliser ce qu'elle veut tant que le contrat HTTP est respecté
(retour `429` avec body JSON descriptif).

### 6.4 Locales supportées

Une implémentation doit au minimum gérer `fr` et `en`. `es` est un bonus
souhaitable. Le code spécial `any` (locale-agnostic) doit toujours être
accepté et traité comme « renvoie aussi les sources sans préférence linguistique ».

Une locale inconnue ne doit **pas** déclencher de `400` — elle doit simplement
être ignorée silencieusement (filtrée hors du dispatch des sources).

### 6.5 Gestion d'erreur

| Erreur côté proxy | Action attendue |
|---|---|
| Une source upstream timeout | Logue au niveau DEBUG, l'exclut de la réponse, continue avec les autres. |
| Toutes les sources échouent | Retourne `200 OK` avec `releases: []`. **Pas** de `5xx`. |
| Body de Jikan / MangaDex malformé | Idem : la résolution de titres dégrade vers `[]` mais la requête réussit. |
| Erreur de parse interne (panic, bug) | `500 Internal Server Error` — Mangacollector traitera comme empty. |

La règle générale : **un proxy correct ne fait jamais retourner d'erreur à
Mangacollector qu'il ne peut pas gérer**. Tout est best-effort.

---

## 7. Versioning

Le préfixe `/v1/` dans le path de l'endpoint principal documente la version du
contrat. Toute évolution **rétrocompatible** (ajout de champs optionnels dans
la réponse, nouvelle locale, nouveau code de retour informationnel) reste sous
`/v1/`. Toute évolution **cassante** (changement de schéma, retrait de champs)
introduira `/v2/` aux côtés de `/v1/` avec une période de chevauchement.

Mangacollector consomme exclusivement `/v1/` aujourd'hui.
