# Tests : couverture, résultats et limites

## 1. Exécution

```bash
npm test          # Vitest, 8 fichiers, 78 tests
npm run typecheck # 4 configurations TypeScript (main, web, node, tests)
npm run build     # Vite + tsc
```

Dernière exécution dans cet environnement : **78 tests réussis**, typecheck sans erreur,
build renderer + main réussi.

Les tests utilisent de vrais fichiers temporaires, de vraies archives ZIP et de vrais PNG.
Aucun mock de `fs` pour le noyau : les comportements testés sont ceux de production.

| Fichier | Tests | Objet |
|---|---:|---|
| `tests/packmeta.test.ts` | 9 | table, `pack_format` vs `min/max`, échappement, champs interdits |
| `tests/paths.test.ts` | 6 | traversée, absolus Windows, noms réservés, collisions |
| `tests/imageOps.test.ts` | 13 | redimensionnements, alpha, rotations, recadrage, historique |
| `tests/scan.test.ts` | 9 | dossiers profonds, 3 000 fichiers, ZIP, chemins hostiles, accès refusé |
| `tests/project.test.ts` | 13 | édition, restauration exacte, persistance, texte, recherche, source |
| `tests/export.test.ts` | 14 | export sélectif, ZIP, versions, icône, conflits, disque plein |
| `tests/service.test.ts` | 3 | RPC, tâches, réglages, restrictions démo, intégrité |
| `tests/renderer.test.tsx` | 5 | montage React, explorateur, éditeur, modale d'export (happy-dom) |
| `tests/scripts.test.ts` | 6 | scripts Windows : CRLF, ASCII, cibles de saut, scripts npm, intégrité SHA-256 |

## 2. Cas obligatoires (section 14 du cahier des charges)

| # | Cas exigé | Test(s) réels | Vérification effectuée |
|---:|---|---|---|
| 1 | Importer un dossier à plusieurs niveaux | `scan.test.ts › importe un dossier avec de nombreux niveaux imbriqués` ; `project.test.ts › importe, indexe…` | 11 niveaux, arborescence et compteurs, lecture d'un fichier profond |
| 2 | Parcourir des milliers de fichiers sans blocage | `scan.test.ts › parcourt des milliers de fichiers avec progression` | 3 000 fichiers, progression > 0, < 20 s, scan annulable |
| 3 | Rechercher une texture profondément imbriquée | `project.test.ts › recherche récursivement…` | `ancient_rune` à 8 niveaux, casse, jokers, filtres |
| 4 | Ouvrir et modifier un PNG | `project.test.ts › ouvre, modifie, enregistre…` | pixels décodés, sauvegarde de la copie de travail |
| 5 | Redimensionner en préservant la transparence | `imageOps.test.ts › préserve la transparence…` / `n'assombrit pas les bords…` | nearest exact, alpha prémultiplié, coexistence opaque/transparent |
| 6 | Annuler puis rétablir | `imageOps.test.ts › historique annuler/rétablir` | états successifs, limite 3/mémoire 24, redo vidé après action |
| 7 | Modifier puis restaurer exactement l'initial | `project.test.ts › …restaure exactement l’image d’origine` | empreinte pixels identique, entrée supprimée, fichier de travail supprimé |
| 8 | Fermer/rouvrir sans perdre les modifications | `project.test.ts › conserve les modifications…` | nouveau `ProjectManager`, pixels identiques, onglet actif restauré |
| 9 | Exporter une seule texture modifiée | `export.test.ts › exporte une seule texture modifiée…` | 2 fichiers exactement, contenu identique à la copie de travail |
| 10 | Exporter plusieurs fichiers de dossiers différents | `export.test.ts › exporte plusieurs fichiers…ZIP` | bloc + item + langue, 4 entrées, chemins relatifs exacts |
| 11 | Vérifier qu'aucun fichier non modifié n'est exporté | mêmes tests + `exclut les fichiers non modifiés…` | liste comparée au disque/au ZIP, exclus ignorés |
| 12 | Vérifier les chemins relatifs | `export.test.ts` (dossier et ZIP) + `paths.test.ts` | aucun préfixe, aucun dossier parent, sécurité des chemins |
| 13 | `pack.mcmeta` valide pour la version choisie | `packmeta.test.ts` (9 tests) + `export.test.ts › adapte…` / `produit…chaque version` | 1.19.4/1.20/1.20.2/1.21.5/1.21.9/1.21.11/26.2/26.3, champs interdits |
| 14 | ZIP sans dossier parent | `export.test.ts › …ZIP sans dossier parent` | `pack.mcmeta` à la racine, aucun préfixe `PackZip/` |
| 15 | Fichier illisible / accès refusé / disque plein | `scan.test.ts › dossier illisible`, `project.test.ts › PNG corrompu et illisible`, `export.test.ts › disque plein simulé` | avertissements sans crash, `ENOSPC` injecté, sortie nettoyée |
| 16 | Conflit de nom à l'export | `export.test.ts › ne remplace jamais silencieusement` | `ConflictError`, contenu précédent intact, nom proposé, remplacement confirmé |
| 17 | Sources strictement inchangées | `project.test.ts` (hachages avant/après), `export.test.ts`, `service.test.ts` | `hashTree` SHA-256 identique avant/après édition, rescan, export |

## 3. Couverture supplémentaire

- ZIP : lecture sans extraction, entrée introuvable, archive contenant `../` refusée, doublons,
  antislashs normalisés.
- `pack.mcmeta` : description avec guillemets, antislash, saut de ligne, emoji, `§`, champ vide,
  version personnalisée non vérifiée, champs `supported_formats`/`min_format` incompatibles.
- Export : pack vide, icône `pack.png`, écrasement refusé puis confirmé, sortie dans la source
  bloquée, source disparue mais copies de travail exportables, ZIP source inchangé.
- Projet : exclusion/réintégration, rescan après ajout de fichier, relocalisation après suppression
  de la source, suppression de projet sans toucher aux sources, chemins inconnus refusés.
- Service : création via tâche, progression, `needsOverwrite`, réglages persistants après
  redémarrage, restriction du mode démo, tâche inconnue.
- Interface : montage réel, restauration du dernier projet, explorateur, ouverture d'une texture
  dans l'éditeur (canvas + outils), éditeur `.mcmeta` (JSON valide), modale d'export avec aperçu
  RPC.

## 4. Non testé ici / à faire dans le jeu

Aucun Minecraft n'est installé dans l'environnement. Les tests sont **structurels** :

- JSON `pack.mcmeta` valide, champs corrects pour la version ;
- arborescence exacte du dossier/ZIP, chemins conformes ;
- lecture par un parseur ZIP indépendant (`yauzl`) ;
- aucune altération des sources.

**Validation manuelle recommandée** (non exécutée) :

1. Exporter le pack au format ZIP pour la version réellement installée.
2. Copier le fichier dans `%APPDATA%\.minecraft\resourcepacks`.
3. Options → Packs de ressources : le pack doit apparaître avec son nom, sa description et son
   icône, sans mention « incompatible » pour la version ciblée.
4. Activer le pack, vérifier en jeu la texture modifiée, ses dimensions et sa transparence.
5. Vérifier qu'aucune autre texture n'est remplacée (puisque aucun fichier non modifié n'est inclus).
6. Tester une texture redimensionnée (16×16 → 64×64) et une texture translucide (verre/feuillage).

## 5. Limites des tests

- Le disque plein est simulé par injection d'une erreur `ENOSPC` dans le writer (impossible de
  remplir réellement le disque du sandbox sans risque).
- Les tests d'accès refusé utilisent `chmod 000` et sont ignorés si la suite tourne en root.
- Le rendu canvas n'est pas vérifié visuellement (pas de navigateur graphique disponible) ; les
  opérations pixel sont testées indépendamment, et l'interface est montée avec happy-dom.
- Les scripts `downloadALL.bat` / `start.bat` n'ont pas été exécutés (environnement Linux) :
  leur syntaxe est contrôlée par une suite dédiée (`tests/scripts.test.ts` : existence, CRLF,
  absence de caractère non-ASCII, cibles de saut valides, blocs équilibrés, scripts npm référencés,
  vérification SHA-256 avant extraction, absence de commande destructive) et chaque commande sous-jacente
  (`npm ci`/`npm install`, `npm run demo:assets`, `npm run build`, `npm run run:desktop`) est
  testée ou vérifiée séparément. La vérification SHA-256 s'appuie sur `Get-FileHash`.
- L'installateur Windows n'a pas été produit dans ce sandbox (binaire Electron non téléchargeable) ;
  la procédure de build est fournie et testée jusqu'à la compilation TypeScript/Vite.
