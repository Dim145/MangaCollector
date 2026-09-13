# Aide

Tout ce que fait l'application, expliqué une fois. Les mots japonais qui
servent de repères visuels sont détaillés dans le [glossaire](/glossary).

## Ajouter une série

Depuis **Ajouter**, cherche par titre : les résultats viennent de
MyAnimeList, avec MangaDex en secours. Une série ajoutée arrive avec son
nombre de tomes, sa jaquette et ses genres.

- Une série absente des deux catalogues se crée à la main, avec ton
  propre titre et ton propre nombre de tomes.
- Le bouton **scan** de l'en-tête lit un code-barres et t'amène
  directement au bon endroit.
- L'import depuis MyAnimeList, AniList, MangaDex ou un CSV Yamtrack se
  fait dans les réglages.

## Les tomes

Chaque série a sa page, et chaque tome y a son état. Un clic sur une
case marque le tome comme possédé ; le crayon ouvre le tiroir de détail.

- **Possédé** et **lu** sont indépendants : on peut avoir un tome sans
  l'avoir lu, et l'inverse.
- Le prix et la boutique servent aux statistiques de dépense.
- L'édition **collector** se signale par le sceau 限.
- Un **coffret** regroupe plusieurs tomes sous un seul prix.

## L'exemplaire physique

Le tiroir d'un tome décrit l'objet, pas l'œuvre.

- **État** : neuf, comme neuf, bon, correct, abîmé.
- **Emplacement** : où il vit, en texte libre. Les noms déjà utilisés
  sont proposés.
- **Doubles** : le nombre d'exemplaires en plus du premier. Le sceau ×N
  apparaît sur la case du tome.
- **Acheté le** et **ISBN** : la date d'achat et le code-barres du dos.

## Prêts

Prêter un tome se fait depuis son tiroir. Le tome reste à toi, il est
simplement ailleurs.

- Un prêt peut viser un **ami** de l'application, et l'autre côté voit
  alors le tome dans ses emprunts.
- Une **date de retour** facultative fait passer le prêt en retard
  quand elle est dépassée ; le compteur de la navigation le signale.
- Le **registre** garde chaque prêt jamais fait, retours compris, et
  s'exporte en CSV.

## Le scanneur

Le scanneur est entièrement dans le navigateur : aucune image ne quitte
l'appareil.

- Un code déjà sur l'étagère ouvre la série, propose de compter un
  double, ou passe au suivant.
- Un code inconnu part vers le flux d'ajout, avec le titre déjà
  rempli quand un catalogue le connaît.
- Sans caméra, ou si elle est refusée : **une photo** ou la **saisie
  manuelle** suivent exactement le même chemin.
- Sur un dos sombre, la **torche** et le **zoom** apparaissent quand
  l'appareil sait les faire.

## Rangement et inventaire

- **Rangement** liste les emplacements et ce qu'ils contiennent. On y
  déplace des tomes par sélection, ou en scannant leurs dos.
- **Inventaire** compte une étagère : scanne les dos un à un, ce qui n'a
  jamais été scanné est ce qui manque. Les tomes prêtés sont mis à part.
- Les deux peuvent imprimer une **planche d'étiquettes** avec le
  code-barres de chaque tome.

## Hors ligne

L'application garde une copie locale de la collection et fonctionne sans
réseau.

- Une modification faite hors ligne est enregistrée tout de suite et
  part au serveur au retour du réseau, dans l'ordre.
- Plusieurs appareils se synchronisent entre eux dès qu'ils sont en
  ligne.
- Le scanneur et la recherche dans ta propre bibliothèque marchent hors
  ligne. Seule l'interrogation des catalogues demande du réseau.

## Sauvegarde

Les réglages proposent un export complet.

- **JSON** : tout, y compris les prêts, le rangement et les notes.
  C'est le format à réimporter.
- **CSV** : une ligne par tome, pour un tableur.
- À l'import, **fusionner** complète ce qui manque, **remplacer**
  restaure l'état du fichier.

## Réglages

- **Thème** clair ou sombre, et sept couleurs d'accent.
- **Langue** : français, anglais, espagnol.
- **Profil public** : une adresse partageable qui montre ta collection
  sans tes prix ni tes notes.
- **Vibrations** et **sons** se coupent séparément.
