# Capitaine

IDE « IA-first » personnel, inspiré d'[Orca](https://github.com/stablyai/orca).
Version 0.1 : gestion de projets + terminaux par projet. macOS, Windows et Linux.

## Fonctionnalités

- **Projets** : ajouter un dossier, renommer (double-clic), réordonner (glisser-déposer), ouvrir dans le gestionnaire de fichiers, retirer. La liste est sauvegardée dans `projects.json` du dossier de données de l'app.
- **Terminaux** : plusieurs onglets par projet, ouverts dans le dossier du projet avec votre shell par défaut (`$SHELL -l` sur mac/Linux, PowerShell 7 → Windows PowerShell → cmd sur Windows).
- Les terminaux **restent vivants** quand vous changez d'onglet ou de projet (pratique pour laisser tourner un agent). Un point signale une sortie non lue.
- `exit` ferme l'onglet ; un code de sortie ≠ 0 laisse l'onglet ouvert pour lire l'erreur.
- **Terminaux côte à côte** : divise un onglet à droite ou en bas, autant de fois que tu veux (boutons en haut à droite ou raccourcis). Glisse un séparateur pour redimensionner, double-clic pour égaliser. Chaque panneau a son en-tête (nom, statut de l'agent, ×), et un clic dessus lui donne le focus.
- **Explorateur de fichiers** du projet actif, à droite des terminaux (masquable avec le bouton en haut à droite, redimensionnable par son bord gauche) :
  - arborescence chargée à la demande et rafraîchie toute seule quand un fichier change ;
  - **statut git** : modifié (M, orange), nouveau (U/A, vert), renommé, en conflit, et fichiers ignorés estompés. Un point sur un dossier replié indique un changement à l'intérieur. Pratique pour voir ce que Claude a touché ;
  - **glisser un fichier dans un terminal** (depuis l'explorateur ou depuis le bureau) insère son chemin, correctement échappé : idéal pour le donner à Claude ;
  - **double-clic** : ouvre le fichier dans l'éditeur intégré (voir ci-dessous) ;
  - clic droit : ouvrir dans l'éditeur, ouvrir avec l'application par défaut, insérer le chemin dans le terminal actif, copier le chemin / le chemin relatif, afficher dans le gestionnaire de fichiers.
- **Éditeur de fichiers intégré** (Monaco, le moteur de VS Code, embarqué : marche hors ligne) :
  - s'ouvre dans un onglet à côté des terminaux ; rouvrir un fichier déjà ouvert ramène son onglet ;
  - coloration syntaxique selon l'extension, thème assorti à l'app ;
  - **⌘S / Ctrl+S** enregistre (seulement quand l'éditeur a le focus, pour laisser Ctrl+S aux terminaux) ;
  - modifications non enregistrées : **●** sur l'onglet ; fermer l'onglet ou la fenêtre demande *Enregistrer / Ne pas enregistrer / Annuler* ;
  - **fichier modifié sur le disque** (par un agent, par exemple) : rechargement automatique si tu n'as rien modifié (Ctrl+Z ramène la version précédente) ; sinon un bandeau te laisse *prendre la version du disque* ou *garder la tienne* ;
  - fichiers binaires ou de plus de 5 Mo : message et bouton pour les ouvrir dans l'application du système.
- **Barre latérale redimensionnable** : glisse son bord droit (double-clic pour revenir à la largeur par défaut). La largeur est mémorisée.
- Titre d'onglet fourni par le shell (celui du panneau actif), renommable (double-clic). Clic molette = fermer.
- Liens cliquables dans le terminal, rendu WebGL.

### Suivi des agents (Claude Code)

Lancez simplement `claude` dans un terminal : Capitaine le détecte tout seul, sans hook ni configuration.

- Sous chaque projet, la barre latérale liste les sessions Claude ouvertes, avec le **nom de la session**, le **statut** et depuis combien de temps :
  - ⟳ **Travaille**
  - ? **Attend ta réponse** (question), 🛡 **Attend ta permission**, 🔑 **Connexion requise**, avec le texte de la question
  - ✓ **Terminé** (fin du tour)
  - ○ **En attente d'une consigne**
- Les **sous-agents** en cours s'affichent sous leur session.
- Le projet et l'onglet affichent le statut le plus urgent, et un résumé global est affiché en bas de la barre latérale.
- **Notification système** quand Claude t'attend ou a terminé, sauf si tu regardes déjà ce terminal. Un clic dessus ouvre le bon terminal.

Comment ça marche : Claude Code (≥ 2.1.295) implémente le [Program Status Protocol](https://www.superlogical.com/rex/docs/build/program-status) (OSC 7501). Il sonde le terminal (`OSC 7501 ; ?`), Capitaine répond, puis Claude écrit son état dans le flux du terminal (`state=working`, `state=blocked:kind=question:msg=…`, sous-agents via `id=…`). Le nom de session vient du titre du terminal. Si Claude plante sans prévenir, Capitaine le voit quand le shell repasse au premier plan (macOS/Linux). C'est le canal de secours d'Orca, qui utilise en plus des hooks.

`node scripts/fake-agent.mjs` dans un terminal de Capitaine rejoue ces séquences sans consommer de tokens.

## Raccourcis

| Action              | macOS  | Windows / Linux  |
| ------------------- | ------ | ---------------- |
| Nouvel onglet       | ⌘T     | Ctrl+Shift+T     |
| Fermer le terminal (panneau actif) | ⌘W | Ctrl+Shift+W |
| Diviser à droite    | ⌘D     | Ctrl+Shift+D     |
| Diviser en bas      | ⌘⇧D    | Ctrl+Shift+E     |
| Panneau suivant / précédent | ⌘⌥→ / ⌘⌥← | Ctrl+Alt+→ / ← |
| Onglet suivant      | ⌘⇧]    | Ctrl+Tab         |
| Onglet précédent    | ⌘⇧[    | Ctrl+Shift+Tab   |
| Ajouter un projet   | ⌘O     | Ctrl+Shift+O     |
| Afficher / masquer l'explorateur | ⌘B | Ctrl+Shift+B |
| Copier / Coller     | ⌘C / ⌘V | Ctrl+Shift+C / V |

Sur Windows/Linux, `Ctrl+<lettre>` reste au shell (Ctrl+C, Ctrl+W, Ctrl+R…), d'où les `Ctrl+Shift`.

## Développement

```bash
npm install
npm run dev        # lance l'app avec rechargement à chaud
npm run typecheck
npm run build && npm run smoke   # test E2E headless (Linux), statut agents inclus, captures dans smoke-shots/
```

Si `npm install` ne télécharge pas le binaire Electron : `node node_modules/electron/install.js`.

**Linux (Ubuntu 23.10+) : `The SUID sandbox helper binary was found, but is not configured correctly`.**
Ubuntu bloque les user namespaces dont le sandbox Chromium a besoin, et Electron se rabat alors sur `chrome-sandbox`, qui doit appartenir à root (à refaire après chaque réinstallation d'Electron) :

```bash
sudo chown root:root node_modules/electron/dist/chrome-sandbox
sudo chmod 4755 node_modules/electron/dist/chrome-sandbox
```

`node-pty` est un module natif. Sur Linux il est compilé à l'installation (il faut `python3`, `make`, `g++`) ; sur macOS et Windows des binaires précompilés sont fournis.

## Distribution

```bash
npm run dist:mac     # .dmg + .zip   (à lancer sur un Mac)
npm run dist:win     # installeur NSIS (à lancer sur Windows)
npm run dist:linux   # AppImage + .deb
```

Chaque plateforme se package sur son propre OS (module natif). Les binaires sont produits dans `dist/`.
Une icône peut être ajoutée dans `resources/` (`icon.png` 1024×1024, `icon.icns`, `icon.ico`).

## Architecture

Même socle qu'Orca : Electron + electron-vite + React + TypeScript + Tailwind + zustand + xterm.js + node-pty.

```
src/
  main/            processus principal (Node)
    index.ts         fenêtre, IPC
    pty-manager.ts   cycle de vie des shells (node-pty), sortie regroupée par lots
    shell.ts         choix du shell et de l'environnement selon l'OS
    project-store.ts persistance des projets (JSON, écriture atomique)
    menu.ts          menu natif + raccourcis selon la plateforme
    file-system.ts   listing des dossiers, surveillance des changements, statut git
  preload/         pont sécurisé `window.capitaine` (contextIsolation + sandbox)
  shared/types.ts  contrat d'API main ⇄ renderer
  renderer/src/    interface React
    store.ts         état (projets, onglets, terminal actif par projet, agents)
    agent-status.ts  parseur OSC 7501 + modèle session / sous-agents
    agent-notifications.ts  notifications système
    explorer-store.ts  état de l'explorateur (dossiers dépliés, listings, statut git)
    terminal-registry.ts  insertion de texte dans un terminal (glisser-déposer, menu)
    editor-store.ts  état des onglets éditeur (modifié, conflit) et confirmations de fermeture
    editor/          Monaco (chargé à la demande) et sessions d'édition (lecture, sauvegarde, changements externes)
    layout.ts        arbre de division d'un onglet (split, fermeture, tailles, calcul des positions)
    pty-bus.ts       un seul listener IPC, routé vers chaque terminal
    components/      Sidebar, Workspace (onglets), TerminalView (xterm)
```

## Pistes pour la suite

- Restaurer les onglets (et le scrollback) au redémarrage
- Glisser un onglet dans un autre pour les mettre côte à côte
- Lancer un agent (Claude Code, Codex…) en un clic dans un terminal
- Worktrees git par tâche, comme Orca
- Diff des changements faits par un agent, éditeur dans un split à côté d'un terminal
