# Architecture technique

## 1. Vue d'ensemble

```
┌──────────────────────────── Electron ────────────────────────────┐
│                                                                  │
│  Renderer (React, sandboxé)          Main (Node)                 │
│  ┌───────────────────────┐  IPC    ┌──────────────────────────┐  │
│  │ interface, éditeur    │◄───────►│ Service RPC (noyau)       │  │
│  │ canvas, mémoires      │         │  ├─ projets / index       │  │
│  └───────────────────────┘         │  ├─ sources dossier/ZIP    │  │
│                                    │  ├─ PNG / opérations       │  │
│  Aperçu web (même renderer)        │  ├─ export + vérification  │  │
│  HTTP local + Vite ───────────────►│  └─ tâches annulables      │  │
│                                    └──────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

Le noyau (`src/core`) ne dépend ni de React ni d'Electron. Le renderer appelle un **contrat RPC
unique** :

- Electron : `ipcRenderer.invoke('atelier:rpc', method, params)` via `preload` (contextIsolation,
  nodeIntegration désactivé) ;
- aperçu web : `POST /api/rpc` sur le serveur local, avec le même `Service`.

Les tâches longues sont lancées immédiatement et exposent un `taskId` ; l'interface interroge
`task.get` toutes les 240 ms. Aucune requête bloquante n'occupe le thread de rendu.

## 2. Modules

| Fichier | Rôle |
|---|---|
| `src/shared/types.ts` | Contrat de données commun (projet, fichiers, export, tâches, réglages). |
| `src/shared/packFormats.ts` | Table Minecraft vérifiée, résolution de version, génération et validation de `pack.mcmeta`. |
| `src/core/source.ts` | `DirectorySource` et `ZipSource` : scan, lecture, progression, vérification, refus des chemins dangereux. |
| `src/core/project.ts` | Persistance des projets, index, copies de travail, hachages, changements, icône, rescan/relocalisation. |
| `src/core/imageOps.ts` | Opérations pures sur RGBA (redimensionnement alpha-prémultiplié, rotations, remplissage, luminosité…). |
| `src/core/png.ts` | Décodage/encodage PNG, détection de format et d'APNG, miniatures, limites mémoire. |
| `src/core/history.ts` | Pile annuler/rétablir bornée en nombre d'états et en octets. |
| `src/core/search.ts` | Recherche sur index, jokers, scores, filtres. |
| `src/core/tree.ts` | Construction de l'arborescence et comptage récursif. |
| `src/core/export.ts` | Sélection stricte des fichiers, `pack.mcmeta`, écriture dossier/ZIP, conflits, vérification. |
| `src/core/service.ts` | API RPC, réglages, tâches, restrictions du mode démo. |
| `src/core/tasks.ts` | Gestionnaire de tâches avec progression, annulation et résultats. |
| `src/main/*` | Fenêtre Electron, IPC, dialogues natifs, détection `resourcepacks`, sécurité de navigation. |
| `src/server/webServer.ts` | Serveur HTTP local + middleware Vite + API RPC pour l'aperçu. |
| `src/renderer/*` | Interface React, éditeur canvas, éditeur texte, modales, CSS sombre. |

## 3. Contrat RPC

Groupes disponibles (voir `RpcMethod` dans `src/shared/types.ts`) :

- **application** : `app.info`, `app.saveSettings`, `app.chooseSource`, `app.chooseOutputDir`,
  `app.chooseIcon`, `app.chooseImage`, `app.openPath`, `app.revealPath`, `app.minecraftFolder` ;
- **projets** : `project.list/create/open/close/delete/rename`, `project.verifySource`,
  `project.rescan`, `project.relocate`, `project.savePack`, `project.saveUi`,
  `project.stats`, `project.changes` ;
- **fichiers** : `fs.list`, `fs.info`, `file.search` ;
- **édition** : `image.open/thumbnail/save/revert/exclude/include/setIcon/getIcon`,
  `text.open/save` ;
- **export** : `export.preview`, `export.run` ;
- **tâches** : `task.get`, `task.cancel`.

Toutes les erreurs métier sont des `UserError` avec code stable. Les transports renvoient une
enveloppe `{ok, result}` ou `{ok:false, error:{message, code}}` ; l'interface les transforme en
notifications lisibles (jamais de stack technique à l'écran).

## 4. Format de projet

`<userData>/projects/<uuid>/project.json` :

```json
{
  "schemaVersion": 1,
  "id": "uuid",
  "name": "Mon pack",
  "source": {
    "type": "directory",
    "path": "C:/ressources/minecraft",
    "importedAt": "2026-10-22T20:00:00.000Z",
    "fileCount": 2297,
    "totalBytes": 1234567,
    "scannerVersion": 1,
    "statMtimeMs": 1729627200000
  },
  "pack": {
    "name": "Mon pack",
    "description": "Textures personnalisées",
    "targetVersion": "1.21.9",
    "format": "zip",
    "outputDir": "C:/Users/.../Downloads/Atelier Resource Pack"
  },
  "changes": {
    "assets/minecraft/textures/block/stone.png": {
      "relPath": "assets/minecraft/textures/block/stone.png",
      "kind": "image",
      "status": "modified",
      "originalSize": 605,
      "originalByteHash": "…",
      "originalPixelHash": "…",
      "originalWidth": 16,
      "originalHeight": 16,
      "workSize": 612,
      "workByteHash": "…",
      "workPixelHash": "…",
      "workWidth": 32,
      "workHeight": 32,
      "modifiedAt": "2026-10-22T20:05:00.000Z"
    }
  },
  "ui": { "openTabs": ["assets/…/stone.png"], "activeTab": "assets/…/stone.png" }
}
```

`index.json` contient les entrées indexées (chemin relatif, taille, date, extension, catégorie,
dimensions éventuelles) et les avertissements du scan. Il n'est pas réécrit à chaque frappe.

Les copies de travail sont sous `work/<chemin relatif exact>` ; il n'existe jamais de préfixe
supplémentaire, ce qui garantit le chemin final dans le pack.

## 5. Suivi des modifications

1. Au premier enregistrement d'une image, le fichier source est lu et décodé.
2. On calcule :
   - SHA-256 des octets source (`originalByteHash`) ;
   - SHA-256 des **pixels RGBA + dimensions** (`originalPixelHash`) ;
   - idem pour la copie de travail ré-encodée.
3. Si les empreintes de pixels et les dimensions sont identiques, la modification est **retirée**
   (fichier de travail supprimé, entrée `changes` supprimée) : aucun export, badge disparu.
4. Sinon, une entrée `modified` est enregistrée avec dimensions et tailles avant/après.
5. `excluded` conserve la copie de travail mais l'exclut de l'export ; `error` signale une copie
   manquante. `rescan`/`verifySource` détectent une source déplacée, modifiée ou supprimée.
6. L'export relit les copies de travail, vérifie les PNG, l'icône et `pack.mcmeta`, puis compare
   la sortie réellement écrite à la liste attendue. Toute anomalie bloque ou nettoie l'export.

Les noms, tailles et dates ne servent **jamais** seuls à décider qu'un contenu a changé.

## 6. Export sélectif : algorithme

1. Récupérer uniquement les changements `status === 'modified'` (les exclus et erreurs sont
   ignorés avec avertissement).
2. Lire chaque copie de travail, vérifier sa lisibilité et, pour les images, qu'il s'agit d'un PNG.
3. Résoudre la version cible et construire `pack.mcmeta` selon son style (`pack_format` ou
   `min_format`/`max_format`), puis le valider avec la même table.
4. Vérifier l'icône (PNG carré recommandé), ajouter `pack.png` si présente.
5. Calculer le chemin de sortie, détecter un conflit et proposer un nom libre. Un remplacement
   exige une confirmation explicite ; un dossier existant qui ne ressemble pas à un pack est
   refusé (pas de suppression hasardeuse).
6. Écrire dans un dossier temporaire (ou un ZIP temporaire), puis renommer. En cas d'échec ou
   d'annulation, la sortie partielle est supprimée.
7. Relire la sortie et comparer l'ensemble exact des chemins à la liste attendue :
   `pack.mcmeta` à la racine, aucun préfixe de dossier parent, aucun fichier original non modifié,
   aucun dossier vide. L'export n'est déclaré réussi qu'après cette vérification.

## 7. Table `pack.mcmeta` et mise à jour

`src/shared/packFormats.ts` contient la table complète des formats ressource (relevé
`minecraft.wiki/w/Pack_format`, `PACK_FORMAT_SOURCE.checkedAt = 2026-10-22`), une table d'alias
(`1.20.1 → 1.20`, `1.21.10 → 1.21.9`, etc.) et la logique :

- format < 69 → `pack_format` entier ;
- format ≥ 69 → `min_format`/`max_format` en `[majeur, mineur]`, **sans** `pack_format` ni
  `supported_formats` ;
- version inconnue → acceptée uniquement via `custom:major[.minor]`, avec
  `verified: false` et un avertissement affiché dans l'aperçu et dans l'export.

**Mise à jour** : ajouter l'entrée correspondante dans `PACK_FORMATS` (id, libellé, majeur,
mineur, style, `verified: true`), mettre à jour `PACK_FORMAT_SOURCE.checkedAt`, ajouter les alias
de versions mineures si nécessaire, puis exécuter `npm test` (les tests couvrent 1.20.1, 1.21.9,
1.21.11, 26.1, 26.2, 26.3, les champs interdits et la sérialisation). Aucun autre fichier n'a
besoin d'être modifié ; l'interface lit directement la table.

## 8. Sécurité

- `normalizeRelPath` refuse chemins absolus, lecteurs Windows, segments `..`, caractères de
  contrôle ; `joinInside` vérifie le chemin résolu.
- Les noms de sortie sont nettoyés (caractères interdits Windows, noms réservés, longueur) ;
  `pack.mcmeta`, `pack.png` et les fichiers sont écrits directement dans la racine choisie.
- Les archives sont lues sans extraction ; une entrée `../`/absolue provoque le refus de l'archive
  (aucun fichier écrit). Les doublons sont signalés.
- Les sources sont ouvertes en lecture seule ; les liens symboliques sont ignorés en scan et
  refusés en lecture.
- Electron : `contextIsolation`, pas de `nodeIntegration`, navigation externe bloquée, liens
  `https` ouverts dans le navigateur système.
- Aucun appel réseau dans le noyau. L'aperçu web est un serveur local restreint au dossier de démo.

## 9. Performance

- Indexation en flux, statistiques par lots de 32, progression ~8 fois/s, annulation coopérative.
- Listings par dossier ; dimensions PNG lues par préfixe (64 Ko) et mises en cache.
- Miniatures à la demande, cache LRU (900 entrées), invalidation ciblée à l'enregistrement.
- Interface : listes virtualisées (grille et liste), pas de chargement de toutes les images.
- Opérations longues hors du thread de rendu, tâches annulables, écritures atomiques.
- Limites de sécurité uniquement : 16 384 px/côté, 100 Mpx, 4 Mo pour l'éditeur texte,
  512 Mo pour une entrée ZIP. Aucune limite de profondeur, de nombre de fichiers ou de projets.

## 10. Choix et compromis

- **Electron** : pas de Rust dans l'environnement, écosystème Node mûr pour ZIP/PNG, packaging
  Windows direct. Coût : binaire plus lourd qu'une application Tauri.
- **PNG uniquement éditable** : garantit une réécriture correcte et la conservation de l'alpha ;
  les autres formats sont visibles et exportables tels quels (textes), jamais réencodés.
- **Hachage pixel** : plus coûteux qu'un hash d'octets, mais indispensable pour « modifier puis
  restaurer exactement » et pour ne pas exporter un PNG simplement ré-encodé.
- **Index JSON** : simple, inspectable et suffisant pour des dizaines de milliers de fichiers ;
  une base SQLite serait envisageable pour des millions d'entrées.
