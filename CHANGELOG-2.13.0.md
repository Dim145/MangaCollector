# 2.13.0 — Fiabilité de la synchronisation & durcissement sécurité

Release **mineure** (pas de breaking change) regroupant trois chantiers
majeurs depuis la 2.12.1 :

1. **Refonte de la fiabilité de la synchronisation local ↔ serveur** — le
   correctif du bug où une erreur serveur déclenchait un retry infini et
   des doublons.
2. **Audit de sécurité complet** (frontend + backend) — 16 findings
   corrigés, dont une XSS stockée et une fuite de données entre comptes.
3. **Robustesse du scanner** + une nouvelle fonctionnalité UX.

⚠️ **Déploiement** : cette release ajoute **2 migrations de base de
données** (voir la section *Migrations* en bas). Elles s'appliquent
automatiquement au démarrage du serveur et sont non destructives, mais
elles touchent la table `authors` (dédup + index unique) — sauvegarde
recommandée avant montée de version, comme toujours.

---

## 🔄 Fiabilité de la synchronisation (correctif majeur)

**Le symptôme.** Une modification (ajout / édition de série, édition de
tome) faite hors-ligne puis rejouée pouvait échouer côté serveur sur une
violation de contrainte Postgres — et alors :
- le frontend **rejouait à l'infini, très rapidement** ;
- la modification était quand même appliquée côté serveur, **2-3 fois**
  (doublons) ;
- la seule échappatoire était *Paramètres → Restaurer*, qui jette les
  changements locaux.

**La cause racine.** Le serveur mappait **toute** erreur DB — y compris
une violation d'unicité (`23505`) ou de clé étrangère (`23503`) — vers un
**HTTP 500**. Or le client classe les 5xx comme « à rejouer » : une
violation de contrainte (qui signifie « déjà appliqué / en conflit »)
revenait donc en 500 → tempête de rejeux. En parallèle, plusieurs
écritures n'étaient ni idempotentes ni atomiques, d'où les doublons.

**Les correctifs (de la cause à l'UX) :**

- **Violations de contrainte → 409, plus 500.** `23505`/`23503` sont
  désormais des `409 Conflict` que le client abandonne dès le 1er échec
  (au lieu de rejouer). Détection via `DbErr::sql_err()` (SeaORM 1.1) et
  `db_err.code()` (sqlx). *(`server/src/errors.rs`)*
- **`apply_library_patch` rendu atomique.** Les rebuild de volumes, mise
  à jour des métadonnées et résolution de l'auteur libre tournent dans
  **une seule transaction** — fini la fenêtre « committé puis erreur »
  qui laissait un état partiel rejoué. *(refactor via le pattern `_tx`
  déjà en place : `update_manga_volumes_tx`,
  `resolve_author_from_text_tx`)*
- **Insert de volume idempotent.** `add_volume_tx` utilise `ON CONFLICT
  DO NOTHING` sur l'index unique partiel `(user_id, mal_id, vol_num)` —
  un rejeu est un no-op propre, plus de `23505`. *(corrige aussi un bug
  latent identique dans le sweep nocturne `releases.rs`)*
- **Allocation d'id race-free.** Les ids négatifs des séries et auteurs
  custom passent d'un `MIN(mal_id) - 1` (race-prone sous concurrence) à
  des **séquences Postgres** (`nextval`, non-transactionnel et
  concurrency-safe). Élimine la collision multi-appareils.
- **Déduplication des auteurs + index unique.** Index partiel unique
  `authors (user_id, lower(name))` (insensible à la casse) après dédup
  des doublons existants — empêche le résolveur d'auteur libre de créer
  des doublons.
- **Backoff exponentiel client.** Après un échec, le sync ré-essaie avec
  un délai croissant (1s → 60s) et les déclencheurs externes (focus,
  réseau, intervalle) deviennent no-op pendant le cooldown — fin de la
  tempête « très rapide ». *(`client/src/lib/sync/outbox.js`)*
- **Garde anti-poison + dead-letter.** Une op qui échoue durablement est
  abandonnée après 6 tentatives (clé stable, reset au succès) au lieu de
  bloquer toute la file.

**Nouvelles fonctionnalités liées :**

- ✨ **Bouton « Réessayer » sur le bandeau hors-ligne.** Quand le serveur
  est injoignable avec des changements en attente, un bouton force une
  re-synchronisation immédiate (bypasse le backoff) — l'alternative
  **non destructive** au « Restaurer » nucléaire. *(fr / en / es)*
- ✨ **En-tête `Idempotency-Key`** sur les écritures de l'outbox (clé
  stable par op, dérivée de `<entité>:<pk>:<ts>`). Forward-compatible
  pour une future déduplication serveur ; utile dès aujourd'hui comme
  identifiant de traçage dans les logs. *(autorisé en CORS)*

---

## 🔒 Sécurité (audit complet frontend + backend)

16 findings corrigés (3 HIGH · 6 MEDIUM · 7 LOW), vérifiés par une passe
adversariale.

### HIGH
- **XSS stockée via `release_url`.** Le sweep nocturne écrivait des URLs
  *upstream* (MangaUpdates — contenu tiers) dans un champ rendu en
  `<a href>` sans validation de schéma → `javascript:`/`data:` exécutable
  au clic. Validation `http(s)` côté serveur (au point d'écriture du
  sweep) + garde défensif au rendu.
- **Résidu de données entre comptes au logout.** `clearAllUserData`
  oubliait plusieurs tables Dexie (auteurs, coffrets, snapshots, amis,
  files outbox) → sur appareil partagé, l'utilisateur suivant voyait les
  données du précédent, et ses ops en attente flushaient sous la mauvaise
  session. Remplacé par une purge de **toutes** les tables.
- **Poison-message gelant tout le sync** (voir section Synchronisation).

### MEDIUM
- **Bypass du filtre adulte + fuite wishlist** en compare/copy : un
  prédicat de visibilité unique (`entry_publicly_visible`) partagé par le
  profil public, le compare et la copie.
- **Suppression de compte n'effaçait pas les sessions** (visait une table
  legacy droppée → échec silencieux, RGPD incomplet). Bascule sur le bon
  helper.
- **Injection de formule CSV** à l'export (`=`/`+`/`-`/`@` en tête
  neutralisés).
- **Écho realtime** clobbant les écritures optimistes (coalescing des
  invalidations).
- **« Restaurer » laissait des ops auteur/coffret vivantes** (re-flush
  après abandon).

### LOW
Policy de redirection cappée (anti-SSRF), CRLF strippé dans les flux ICS,
échappement des wildcards ILIKE, gate UUID à l'import, devises à 0
décimale (`??`), timeouts sur les lookups de scan, fuseau horaire du
calendrier (date-only stable).

### Dépendances
- **3 alertes Dependabot HIGH** corrigées via `pnpm.overrides` :
  `@babel/plugin-transform-modules-systemjs` (≥ 7.29.4), `fast-uri`
  (≥ 3.1.2). DevDependencies (build PWA) — bundle runtime non affecté.

---

## 📷 Scanner de code-barres

- **Distinction « panne upstream » vs « pas de résultat ».** Quand MAL
  **et** MangaDex sont injoignables, le serveur renvoie un **502** (au
  lieu d'un `200` + liste vide trompeur) ; le client le route vers son UI
  de retry transitoire au lieu de la modal « aucun résultat ».
- **Modal « limite Google Books atteinte » traduite** (fr / en / es) —
  utilisait jusqu'ici un message anglais brut.
- **Timeouts** sur les lookups ISBN (Google Books `fetch` + axios) — un
  appel bloqué ne fige plus le scanner en « recherche… ».

---

## 🗃️ Migrations de base de données

Deux nouvelles migrations (auto-appliquées au démarrage) :

| Fichier | Effet |
|---|---|
| `20260508120000_authors_unique_ci_name.sql` | Déduplique les auteurs custom (repointe `user_libraries.author_id` sur le survivant, supprime les doublons) puis crée l'index partiel unique `authors (user_id, lower(name)) WHERE user_id IS NOT NULL`. |
| `20260509120000_custom_id_sequences.sql` | Crée les séquences `custom_author_id_seq` et `custom_library_id_seq` (négatives, décrémentantes), amorcées sous le minimum global existant. |

Toutes deux validées contre un Postgres réel (transaction rollback +
données injectées). Non destructives au-delà de la fusion des doublons
d'auteurs (où seule la ligne survivante est conservée).

---

## 📦 Bump de version

| Composant | 2.12.1 → 2.13.0 |
|---|---|
| `client/package.json` | ✓ |
| `server/Cargo.toml` + `Cargo.lock` | ✓ |
| i18n `about.version` (fr / en / es) | `v2.13.0 · …` |

---

## 🔍 Notes de portée

- **Pas de breaking change** — aucune route/API supprimée, schéma
  additif et rétro-compatible.
- **Bundle runtime client** inchangé hors version (les fixes Dependabot
  sont des devDependencies).
- **Vérifications** : `cargo check` + 34 tests serveur, `pnpm lint` +
  `build` client passent propre sur l'ensemble des commits.
- La revue adversariale post-fix a confirmé l'absence de régression et a
  fait remonter un seul effet de bord (race de mint sous concurrence),
  corrigé par les séquences Postgres.

---

## 🧭 Commits inclus (depuis 2.12.1)

```
040e39b chore(release): bump version to 2.13.0
ebc8aa2 fix(sync): race-free custom-id allocation via Postgres sequences
e74b46e feat(sync): stamp outbox writes with an Idempotency-Key header
d01e2e7 feat(sync): force-retry affordance on the offline banner
7375ed7 fix(sync): exponential backoff on the retry cadence
1459239 fix(sync): dedupe custom authors + add case-insensitive unique index
2f48db0 fix(sync): make apply_library_patch atomic
18c1d87 fix(sync): map DB constraint violations to 409 + idempotent volume insert
6bf68c5 refactor(sync): stable dead-letter key + clear on success
8dac200 fix(client): outbox poison-message, cross-account residue, echo flicker, scan hangs
adbeb04 fix(security): compare/copy leaks, sweep XSS sink, GDPR session wipe + hardening
052d021 fix(scan): wire up the 502-routing path that was dead code
4438e1d chore(security): patch 3 high-severity Dependabot alerts
4242a48 fix(scan): localize Google Books rate-limit modal body
b7486be fix(scan): distinguish upstream provider failures from "no match"
```
