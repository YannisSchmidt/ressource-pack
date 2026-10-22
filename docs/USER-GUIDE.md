# Guide utilisateur

## 1. Créer un projet

1. Cliquer sur **Créer un projet** (écran d'accueil) ou **Nouveau projet** (fenêtre Projets).
2. Donner un nom au projet.
3. Choisir la source :
   - **Dossier** : un dossier contenant `assets/`, ou tout dossier de ressources compatible ;
   - **Archive ZIP/JAR** : lue directement, sans extraction.
4. Valider : l'importation affiche sa progression (fichiers analysés) et peut être annulée.
   À la fin, le projet s'ouvre sur l'explorateur.

Aucun fichier source n'est copié en dehors du projet, déplacé ou modifié. Seuls les noms,
tailles, dates et extensions sont indexés ; les images sont lues à la demande.

## 2. Se repérer dans l'interface

- **Barre supérieure** : nom du projet (modifiable, `Entrée` ou clic ailleurs), projets,
  enregistrement, annuler/rétablir, vérification de la source, paramètres, aide, **Exporter**.
- **Colonne gauche** : source et boutons Vérifier/Rescanner/Relocaliser ; onglets
  **Arborescence**, **Recherche**, **Modifiés** ; statistiques et export.
- **Zone centrale** : explorateur (grille ou liste) ou onglets d'édition. Le bouton
  **Fichiers** referme l'éditeur sans fermer les onglets.
- **Colonne droite** : **Outils** et **Informations** pour l'onglet actif, ou fiche du fichier /
  dossier sélectionné, ou résumé du pack.
- **Barre d'état** : nombre de fichiers, modifications, progression des tâches, état de sauvegarde.

### Explorateur

- Double-clic sur un dossier → l'ouvrir ; sur un fichier → l'ouvrir dans l'éditeur (PNG/texte).
- Flèches ← / → / ↑ pour l'historique de navigation et le dossier parent.
- Tri par nom/type/taille/date (clic sur le sélecteur, second clic inverse).
- « Images seulement » masque les fichiers non-image **sans les retirer** de l'index.
- Les badges indiquent : modifié, exclu, erreur, texture animée ; les dimensions et l'extension
  sont affichées quand connues.

### Recherche

- Saisir un nom, un fragment de chemin ou un joker (`*.png`, `stone*`).
- Filtres : extension, catégorie (texture, modèle, langue, son, shader, métadonnées, texte),
  « uniquement les fichiers modifiés ».
- Un clic ouvre l'emplacement (dossier + sélection) ; **Ouvrir** ouvre le fichier.
- `Ctrl+K` place le curseur dans la recherche. Le total réel est affiché, même si la liste est
  limitée (400 résultats) pour rester fluide.

### Liste des modifications

Chaque entrée affiche le nom, le chemin, les dimensions avant/après (ou tailles), l'état, et permet :

- **ouvrir** le fichier dans l'éditeur ;
- **exclure** du pack (la modification est conservée mais non exportée) ;
- **réintégrer** une modification exclue ;
- **annuler** la modification (retour au fichier source, copie de travail supprimée).

## 3. Éditeur d'image

Ouvrir un PNG par double-clic. Vous pouvez ouvrir plusieurs textures : les onglets restent
accessibles au-dessus de la zone centrale.

### Navigation

- Molette : zoom centré sur le curseur ; boutons `−`/`+` ; pourcentage affiché.
- **Ajuster** (aussi `Ctrl+0`) : l'image entière dans la fenêtre ; **1:1** : échelle réelle.
- Espace + glisser (ou bouton du milieu) : déplacer l'image.
- Damier : transparence ; grille de pixels à partir de 800 % ; alpha et couleur sous le curseur
  affichés dans la barre inférieure.

### Outils

| Outil | Raccourci | Détails |
|---|---|---|
| Crayon | `B` | taille 1 à 16 px, couleur avec alpha |
| Gomme | `E` | rend les pixels transparents |
| Pipette | `I` | prélève la couleur et l'alpha |
| Remplissage | `G` | zone contiguë, tolérance 0 |
| Sélection | `M` | rectangle ; copier/couper/coller/effacer/recadrer |

Palette de 36 couleurs, couleur libre, opacité 0–255. Les opérations de sélection sont également
accessibles depuis la colonne de droite et par `Ctrl+C/X/V`, `Suppr`.

### Transformations

Rotation 90° gauche/droite, 180°, miroirs horizontal/vertical, recadrage sur sélection,
redimensionnement du canevas (ancrage centré), luminosité/contraste avec aperçu.

### Résolution

Bouton **Résolution** : largeur/hauteur libres, presets 16/32/64/128/256/512, verrouillage des
proportions, méthodes **plus proche voisin** (recommandé pixel art), bilinéaire, bicubique, box.
L'aperçu avant/après est affiché, la mémoire estimée et un avertissement signale les risques de
dégradation ou de semi-transparence. **Original** restaure les dimensions initiales.

Le chemin, le nom et l'extension ne changent jamais. À l'export, la texture redimensionnée est
écrite au même emplacement relatif.

### Historique et sauvegarde

- `Ctrl+Z` / `Ctrl+Y` : 40 états maximum, plafond mémoire de 96 Mo.
- `Ctrl+S` : enregistre la copie de travail dans le projet (pas dans la source).
- L'autosauvegarde (activée par défaut) enregistre 1 s après la dernière modification.
- L'indicateur d'onglet et la barre d'état signalent les changements non enregistrés.
- **Comparer** affiche un curseur avant/après entre le source et la version courante.

## 4. Éditeur de texte

Les fichiers JSON, `.mcmeta`, `.lang`, `.txt`, shaders, YAML, etc. s'ouvrent dans un éditeur
monospace. Les fichiers JSON sont validés en direct (badge « JSON valide/invalide »). Limite :
4 Mo, UTF-8. Les modifications suivent le même principe que les images (copie de travail, chemin
identique, export si modifié).

## 5. Configurer et exporter

Bouton **Exporter** (ou `Ctrl+E`) :

1. **Nom du resource pack** et nom de fichier/dossier.
2. **Description** affichée dans Minecraft (échappement JSON automatique).
3. **Version Minecraft ciblée** : table vérifiée du 2026-10-22 ; option « Version personnalisée »
   (format majeur/mineur) avec avertissement explicite de non-vérification.
4. **Format** : archive ZIP (recommandé) ou dossier.
5. **Dossier de sortie** via le bouton Parcourir.
6. **Icône** facultative : PNG, carrée de préférence (128×128 conseillé) → `pack.png`.
7. **Aperçu Minecraft** : nom, description, version, icône.
8. **Récapitulatif** : nombre de fichiers modifiés, total de fichiers du pack, taille estimée,
   chemin, avertissements et erreurs bloquantes ; `pack.mcmeta` consultable.
9. **Exporter maintenant** : progression, annulation possible. En cas de conflit, choisir un autre
   nom ou confirmer le remplacement.
10. Après l'export : compte exact, vérifications de structure, avertissements, boutons
    **Ouvrir le dossier de destination** et **Ouvrir le dossier resourcepacks** si détecté.

Le projet reste ouvert après l'export. Rien n'est supprimé de vos modifications.

### Contenu exact du pack

- les fichiers **modifiés et actifs** uniquement, à leur chemin relatif exact ;
- `pack.mcmeta` généré ;
- `pack.png` seulement si une icône est choisie.

Aucun fichier original non modifié, aucun dossier vide, aucun fichier factice, aucun préfixe
supplémentaire. Dans le ZIP, `pack.mcmeta` est à la racine.

## 6. Source déplacée, modifiée ou absente

- **Vérifier** rescane la source et compare les fichiers à l'index (ajouts, retraits, tailles/dates).
- **Rescanner** met à jour l'index et signale les originaux modifiés ou manquants dans les
  modifications existantes (la version de travail reste exportable).
- **Relocaliser** permet de choisir le nouvel emplacement du dossier/archive ; les modifications
  et leurs chemins relatifs sont conservés.
- Si la source manque à l'ouverture, une bannière le signale ; l'export reste possible avec les
  copies de travail, avec un avertissement.
- L'annulation d'une modification exige une source accessible (pour ne pas perdre de données).

## 7. Paramètres

- Sauvegarde automatique oui/non.
- Affichage par défaut des fichiers non-images.
- Taille des miniatures (petite/moyenne/grande).
- Dossier `resourcepacks` personnalisé (sinon détection automatique Windows/macOS/Linux).
- Accès au dossier de données du projet et aux dossiers détectés.

## 8. Dépannage

| Symptôme | Cause probable / solution |
|---|---|
| « Source introuvable » | Dossier/archive déplacé → **Relocaliser**. Les modifications restent stockées. |
| « PNG illisible » | Fichier corrompu ou tronqué → vérifier le fichier source ; il n'est pas modifié. |
| Texture animée refusée | APNG (plusieurs frames) : l'éditeur statique risquerait de détruire l'animation. Utilisez un outil dédié. |
| JSON invalide | Corrigez la syntaxe avant d'enregistrer ; Minecraft ne chargerait pas le fichier. |
| Pack « incompatible » dans Minecraft | Vérifier la version cible et relancer l'export ; une version personnalisée n'est pas garantie. |
| Export bloqué | Lire les erreurs de l'aperçu (copie de travail manquante, sortie dans la source, nom de fichier Windows invalide…). |
| Conflit à l'export | Choisir le nom proposé ou confirmer explicitement le remplacement. |
| L'application desktop ne démarre pas | Vérifier Node 22+, relancer `npm install` (binaire Electron), puis `npm start`. |
| Aperçu web limité | Normal : il n'accède qu'au dossier de démonstration. Utilisez la version desktop. |

## 9. Raccourcis complets

Voir la fenêtre **Aide & raccourcis** (`F1`) dans l'application.
