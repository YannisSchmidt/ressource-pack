# Atelier Resource Pack

Éditeur de **resource packs Minecraft Java Edition** à partir des fichiers de ressources du jeu
(ou de tout dossier compatible). Application desktop **Electron + React + TypeScript**, interface
entièrement en français, utilisable hors ligne.

> **Principe fondateur** : à l'export, seuls les fichiers réellement modifiés sont copiés, avec
> `pack.mcmeta` et une icône facultative. Les fichiers sources ne sont **jamais** modifiés.

---

## 1. Ce qui fonctionne réellement

| Domaine | Fonctionnalités implémentées et vérifiées |
|---|---|
| Import | Dossier ou archive ZIP/JAR, sans extraction, profondeur illimitée, milliers de fichiers, progression, annulation, avertissements (fichiers illisibles, liens symboliques, entrées ZIP dangereuses). |
| Explorateur | Arborescence récursive, navigation précédent/suivant/parent, fil d'Ariane, double-clic d'ouverture, tri nom/type/taille/date, vues grille et liste virtualisées, miniatures paresseuses, dimensions PNG, extension, badges source/modifié/exclu, filtre « images seulement ». |
| Recherche | Récursive, insensible à la casse, jokers `*.png`/`?`, filtres extension/catégorie, « modifiés uniquement », résultats avec miniature et chemin, limite d'affichage explicite avec total réel, annulation par nouvelle requête. |
| Éditeur d'image | Zoom/molette, déplacement (espace + glisser), damier, ajustement, échelle 1:1, alpha, crayon, gomme, pipette, remplissage contigu, sélection rectangle, copier/couper/coller/effacer/recadrer, rotations, miroirs, luminosité/contraste, canevas, redimensionnement (plus proche voisin, bilinéaire, bicubique, box) avec aperçu et avertissements, annuler/rétablir (40 états, plafond mémoire), comparaison avant/après à curseur, palette et couleurs avec alpha. |
| Modification | Copie de travail sous le **chemin relatif exact**, détection par empreinte **des pixels** (pas nom/taille/date), retour à l'original détecté automatiquement, exclusion/réintégration, restauration depuis le source, fichiers texte (JSON, `.mcmeta`, `.lang`, shaders…) éditables avec validation JSON. |
| Projet | Persistance JSON + index + dossier de travail, réouverture des onglets, plusieurs projets, renommage, suppression sécurisée, détection de source déplacée, vérification/rescan, relocalisation. |
| `pack.mcmeta` | Table de compatibilité vérifiée (1.6.1 → 26.3), `pack_format` pour ≤ 1.21.8, `min_format`/`max_format` pour 1.21.9+, table obsolète refusée explicitement, versions personnalisées avec avertissement, description JSON échappée, validation avant écriture. |
| Export | **Bouton « EXPORTER MON RESOURCE PACK »**, dossier ou ZIP, `pack.mcmeta` à la racine, `pack.png` facultatif, conflits non écrasés sans confirmation, vérification de structure après écriture, compte exact, nettoyage en cas d'échec, ouverture du dossier de destination et du dossier `resourcepacks` détecté. |
| Sécurité | Aucun envoi réseau (hors service RPC local), sources en lecture seule, refus des chemins `..`/absolus, refus des ZIP hostiles, contrôle des dimensions/mémoire, écritures atomiques, limites de taille explicites. |

---

## 2. Démarrage rapide

Prérequis : **Node.js 22+** et npm 10+ (Windows 10/11, macOS ou Linux pour le développement).

```bash
npm install
```

### Application desktop (mode réel)

```bash
# Développement (Vite + Electron)
npm run dev:desktop

# Compilation puis lancement
npm start
```

> Dans un environnement sans accès au CDN Electron (CI restrictive), l'installation du binaire
> Electron peut échouer. Utilisez alors `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install` pour compiler
> et tester, mais le lancement desktop nécessitera une installation normale sur une machine connectée.

### Aperçu web de démonstration

```bash
npm run dev:web
# → http://localhost:5173
```

Cet aperçu utilise **le même noyau** (Service RPC, projet, éditeur, export) via une passerelle HTTP
locale, avec un jeu de ressources fictif généré dans le dossier temporaire
`atelier-resource-pack-demo` (2 297 fichiers, textures 16×16, dossiers imbriqués, archive ZIP).
Il est **limité à ce dossier de démo** : il ne peut pas lire les fichiers de votre ordinateur.
Pour travailler sur vos vraies ressources, utilisez l'application desktop.

### Compilation d'un exécutable Windows

Sur Windows (ou une machine Linux avec Wine pour les cibles NSIS) :

```bash
npm run dist:win
```

Génère dans `release/` :

- `AtelierResourcePack-<version>-x64.exe` (installateur NSIS, choix du dossier, raccourcis) ;
- `AtelierResourcePack-portable-<version>.exe` (exécutable portable).

La configuration se trouve dans `electron-builder.yml` ; l'icône dans `build/icon.png`.
Aucun certificat de signature n'est fourni : Windows SmartScreen peut afficher un avertissement.
Pour les autres plateformes : `npm run dist:linux`.

> **Limite de l'environnement de développement actuel** : l'installateur Windows n'a pas pu être
> produit ici (sandbox Linux, téléchargement du binaire Electron bloqué par un proxy TLS). La
> chaîne de compilation est vérifiée (`npm run build`, `npm run typecheck`, tests) et la commande
> exacte est fournie ci-dessus.

---

## 3. Prise en main

1. **Créer un projet** → choisir un dossier de ressources (par exemple les assets extraits d'un
   `client.jar`/`version.json`) ou une archive ZIP. Le nom du projet est libre.
2. **Explorer / rechercher** une texture : double-clic pour l'ouvrir dans l'éditeur.
3. **Modifier** les pixels ou la résolution. `Ctrl+S` enregistre la copie de travail dans le projet.
   Le fichier source reste intact. L'autosauvegarde est active par défaut (1 s).
4. **Vérifier** la liste « Modifiés » dans la barre latérale. Chaque entrée peut être ouverte,
   exclue du pack ou annulée (retour à l'original).
5. **Exporter** : renseigner le nom, la description, la version Minecraft cible, l'icône
   facultative, le dossier de sortie et le format (dossier/ZIP). L'aperçu récapitule exactement les
   fichiers inclus ; l'export vérifie ensuite la structure produite.
6. **Installer dans Minecraft** : copier le dossier ou le `.zip` dans
   `%APPDATA%\.minecraft\resourcepacks`, puis Options → Packs de ressources.

### Raccourcis principaux

| Raccourci | Action |
|---|---|
| `Ctrl+S` | Enregistrer l'onglet actif |
| `Ctrl+Z` / `Ctrl+Y` | Annuler / rétablir (éditeur d'image) |
| `Ctrl+O` | Liste des projets |
| `Ctrl+E` | Exporter |
| `Ctrl+K` | Recherche |
| `B` / `E` / `I` / `G` / `M` | Crayon / Gomme / Pipette / Remplissage / Sélection |
| `Ctrl+C` / `X` / `V` | Copier / couper / coller la sélection |
| `Suppr` | Effacer la sélection |
| Molette | Zoom (éditeur) |
| `Espace` + glisser | Déplacer l'image |
| `Ctrl+0` / `Ctrl+1` | Ajuster / échelle réelle |
| `F1` | Aide et raccourcis |

---

## 4. Où sont stockées les données ?

Electron utilise le dossier de données de l'application (`app.getPath('userData')`, affiché dans
les paramètres). Chaque projet contient :

```
<userData>/projects/<uuid>/
  project.json   métadonnées, configuration du pack, changements (hashs, dimensions, état)
  index.json     index des chemins, tailles, dates, extensions, catégories
  work/          copies de travail, arborescence identique à la source
  icon.png       icône facultative du pack
```

Les fichiers sources ne sont ouverts qu'en lecture (aucune écriture, aucun déplacement). Les
modifications sont mises à jour de façon atomique (fichier temporaire + renommage).

---

## 5. Compatibilité `pack.mcmeta`

Table vérifiée le **2026-10-22** à partir du [Minecraft Wiki — Pack format](https://minecraft.wiki/w/Pack_format)
(également visible dans l'application, section « Table de compatibilité »).

| Versions Minecraft | Format ressource | Champs générés |
|---|---|---|
| 1.6.1 – 1.21.8 | 1 → 64 | `pack_format` |
| 1.21.9 – 1.21.10 | 69.0 | `min_format: [69, 0]`, `max_format: [69, 0]` |
| 1.21.11 | 75.0 | `min_format: [75, 0]`, `max_format: [75, 0]` |
| 26.1 – 26.1.2 | 84.0 | `min_format: [84, 0]`, `max_format: [84, 0]` |
| 26.2 | 88.0 | `min_format: [88, 0]`, `max_format: [88, 0]` |
| 26.3 | 97.1 | `min_format: [97, 1]`, `max_format: [97, 1]` |

Depuis la 1.21.9, `supported_formats` est retiré et `pack_format` n'est plus requis pour les packs
modernes ; l'application ne génère aucun champ incompatible. Une version absente de la table peut
être saisie manuellement (format majeur/mineur) : elle est alors **explicitement marquée non
vérifiée** et l'export affiche un avertissement. La procédure de mise à jour de la table est
documentée dans [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md#mise-à-jour-de-la-table-de-compatibilité).

> La compatibilité réelle dans le jeu n'est pas testée automatiquement : Minecraft n'est pas
> installé dans l'environnement de développement. La checklist de validation en jeu est fournie
> dans [docs/TESTS.md](docs/TESTS.md#validation-en-jeu-non-exécutée-ici).

---

## 6. Tests

```bash
npm test          # 72 tests (Vitest) : noyau, export, service, interface React
npm run typecheck # 4 configurations TypeScript
npm run build     # renderer (Vite) + main/preload (tsc)
```

Couverture détaillée des 17 cas obligatoires, résultats et limites : [docs/TESTS.md](docs/TESTS.md).

Points vérifiés automatiquement, entre autres :

- import récursif, ZIP sans extraction, archive hostile refusée, 3 000 fichiers indexés ;
- recherche profonde, casse, jokers, filtres, modifiés uniquement ;
- édition PNG, redimensionnement avec transparence, annuler/rétablir ;
- retour exact à l'état initial détecté par empreinte de pixels ;
- fermeture/réouverture du projet sans perte ;
- export d'une ou plusieurs textures, aucun fichier non modifié dans la sortie ;
- chemins relatifs exacts, `pack.mcmeta` par version, ZIP sans dossier parent ;
- conflit d'export, remplacement confirmé, disque plein simulé, accès refusé ;
- **empreintes SHA-256 des sources identiques avant/après tout le cycle**.

---

## 7. Architecture et décisions techniques

```
src/
  shared/     types communs + table de compatibilité + génération/validation pack.mcmeta
  core/       noyau Node testable : sources, index, recherche, PNG, pixels, projet, export, service RPC
  main/       Electron : BrowserWindow, dialogues natifs, IPC, détection Minecraft
  server/     passerelle HTTP locale pour l'aperçu web (même service, dossier démo restreint)
  renderer/   React : interface, éditeur d'image, éditeur de texte, modales
scripts/      générateur de ressources de démonstration
tests/        72 tests Vitest (dont tests d'interface happy-dom)
docs/         architecture, tests, guide utilisateur
```

- **Electron plutôt que Tauri** : le poste de développement ne dispose pas de Rust ; le noyau
  Node réutilise des bibliothèques matures (`pngjs`, `yauzl`, `yazl`) sans compilation native, et
  le packaging Windows est direct. L'interface React reste portable.
- **Un seul noyau, deux transports** : le renderer appelle un contrat RPC (`window.desktop.invoke`
  en Electron, `POST /api/rpc` en aperçu web). Le noyau ne connaît ni React ni Electron.
- **Pas de serveur distant** : l'aperçu web est un serveur local de démonstration ; en desktop,
  aucune requête réseau n'est émise (les liens de documentation ouvrent le navigateur).
- **Détection des modifications par pixels** : un PNG ré-encodé peut différer octet par octet tout
  en étant visuellement identique. Le hachage SHA-256 des pixels RGBA + dimensions permet un
  retour exact à l'original ; un re-encodage sans changement n'est pas exporté.
- **Sécurité des chemins** : normalisation stricte, refus de `..`, des chemins absolus/lecteurs,
  des noms réservés Windows à l'écriture, vérification `joinInside`, refus des ZIP hostiles.
- **Performance** : index en mémoire, listings par dossier, miniatures paresseuses et cache LRU,
  virtualisation des listes, opérations longues en tâches annulables, aucune limite artificielle de
  profondeur ou de nombre de fichiers (seules les limites physiques et de sécurité s'appliquent).

Détails complets : [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). Guide : [docs/USER-GUIDE.md](docs/USER-GUIDE.md).

---

## 8. Limites connues (honnêtes)

1. **Édition d'image limitée aux PNG statiques.** Les JPEG/GIF/BMP/WebP/TGA sont indexés,
   affichés et exportables (fichiers texte) mais pas réécrits, pour ne pas corrompre des formats
   non pris en charge. Les PNG animés (APNG) sont détectés et protégés en lecture seule ; les
   textures animées par bandes + `.png.mcmeta` restent éditables (image statique).
2. **Ré-encodage PNG** : la copie de travail est écrite en RGBA 8 bits sans métadonnées annexes
   (chunks iCCP/tEXt perdus), avec conservation stricte des pixels et de l'alpha. Le nom,
   l'extension et le chemin ne changent jamais.
3. **Éditeur de texte** : UTF-8 uniquement, limite de 4 Mo, pas d'historique applicatif dédié
   (le undo natif du champ texte et la restauration à l'original sont disponibles).
4. **Images énormes** : limite de sécurité de 16 384 px par côté et 100 millions de pixels
   (avertissement mémoire avant opération). Aucune autre limite de taille de projet.
5. **Archives ZIP** : chiffrement non pris en charge ; une archive contenant un chemin dangereux
   (`../`, absolu) est refusée en bloc (aucune extraction n'a lieu). Les entrées dupliquées sont
   signalées, la première est utilisée.
6. **Compatibilité Minecraft** : table vérifiée à la date indiquée ; les versions futures doivent
   être ajoutées (fichier unique documenté) ou saisies manuellement avec avertissement. Aucun test
   automatique dans le jeu n'a été effectué ici.
7. **Exécutable Windows non généré dans ce sandbox** (binaire Electron non téléchargeable) ;
   procédure de compilation et configuration de packaging fournies. L'installateur n'est pas signé.
8. **Aperçu web** : volontairement restreint au dossier de démonstration, sans dialogues natifs ni
   ouverture de dossiers ; il sert à visualiser et tester l'application, pas à éditer vos fichiers.
9. **Serveur local d'aperçu** : il n'est pas destiné à être exposé sur un réseau public ; il
   n'implémente pas d'authentification (portée strictement locale en usage normal).

---

## 9. Licence

MIT — voir [LICENSE](LICENSE). Les ressources de démonstration sont générées localement et ne
contiennent aucun asset Minecraft officiel.
