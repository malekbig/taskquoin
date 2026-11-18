# Guide développeur — utiliser Taskquoin au quotidien

> État : **2026.11.0 (alpha)**, usage local. Les approbations se font en ligne de commande ou dans la console `taskquoin` (le Studio arrive en Phase B).

## 1. Une seule fois par machine
Prérequis : Node ≥ 22.18, git, **Claude Code** et **Codex** installés et connectés, **bubblewrap + socat** (Linux / WSL).

```bash
sudo apt install -y bubblewrap socat                # sandbox des commandes (obligatoire)
git clone <dépôt taskquoin> ~/taskquoin && cd ~/taskquoin && npm install --ignore-scripts
~/taskquoin/bin/taskquoin            # premier lancement : le raccourci `taskquoin` s'installe tout seul
```
Au premier lancement dans un terminal, Taskquoin crée le lien `~/.local/bin/taskquoin` (dans votre HOME, sans sudo) ;
ensuite `taskquoin` suffit, partout. Il n'écrase jamais un fichier qui n'est pas le sien ; si `~/.local/bin` n'est pas
dans votre PATH, il ajoute un bloc balisé à `~/.bashrc`. Retirer : `taskquoin setup --remove` (il ne revient plus) ;
désactiver : `TASKQUOIN_NO_SETUP=1`. Rien d'autre n'est installé ; Taskquoin ne modifie jamais `~/.claude` ni `~/.codex`.

## 2. Une seule fois par projet (le lead / propriétaire)
```bash
cd mon-projet                      # un dépôt git, arbre propre
taskquoin init                     # crée taskquoin.yaml (stack détectée : npm test, phpunit, pytest, go test, mvn…)
git add taskquoin.yaml && git commit -m "chore: taskquoin"
taskquoin doctor                   # chaque agent doit être ✔, sinon il ne démarrera pas
```
Si `doctor` montre un ✖ qui ne peut pas être mesuré (aujourd'hui : `connector.write` pour Codex), **le propriétaire** décide :
```bash
taskquoin accept-risk challenger connector.write --reason "…" --expires 2026-12-31 --as <nom>
```
L'acceptation est stockée **hors du dépôt**, datée, liée à l'échec exact ; personne ne peut l'ajouter via `taskquoin.yaml`.

Si vos tests ont besoin d'un fichier ignoré autre que les dépendances (un `dist/` déjà construit, un `.env.test`),
ajoutez-le explicitement — il sera monté en lecture seule et gelé pour l'agent :
```yaml
verify:
  inherit:
    - dist
```

## 3. Pour chaque tâche (le développeur)

```
taskquoin run "…" ─► plan + critique Codex ─► ✋ vous approuvez le plan
                 ─► TDD par Claude ─► tests lancés par Taskquoin (sandbox) ─► preuve RED ─► revue Codex
                 ─► ✋ vous approuvez le diff exact ─► Taskquoin commite sur taskquoin/<run>
```

```bash
taskquoin run "Ajouter la validation du code postal dans l'inscription"
#  → Run run-20261116T0912-a1b2c3 — waiting-approval at approve-plan

taskquoin show run-20261116T0912-a1b2c3 plan          # le plan (fichiers, tests à écrire d'abord, étapes, risques)
taskquoin show run-20261116T0912-a1b2c3 challenge     # la critique indépendante de Codex
taskquoin approve run-20261116T0912-a1b2c3 plan --expect 3f2a9c1b7d44 --as alice   # le hash affiché par status

#  … Claude implémente en TDD, Taskquoin lance VOS tests dans une sandbox (sans réseau),
#  Codex relit le diff ; jusqu'à 2 reprises automatiques si les tests sont rouges ou la revue négative
#  → Run … — waiting-approval at approve-commit

taskquoin show run-20261116T0912-a1b2c3 diff-1        # le diff exact
taskquoin show run-20261116T0912-a1b2c3 verify-1      # la sortie des tests (exécutés par Taskquoin, pas par le modèle)
taskquoin show run-20261116T0912-a1b2c3 red-1         # preuve RED : les tests modifiés, SANS le reste du changement, échouent
taskquoin show run-20261116T0912-a1b2c3 ignored-1     # (si présent) fichiers ignorés laissés par l'agent : hors diff, restés sur votre disque
taskquoin show run-20261116T0912-a1b2c3 review-1      # la revue de Codex et son VERDICT
taskquoin approve run-20261116T0912-a1b2c3 commit --expect 9be41f0c2a77 --as alice # l'arbre git vérifié ; Taskquoin commite CET arbre

git switch main && git merge --ff-only taskquoin/run-20261116T0912-a1b2c3   # ou ouvrez une PR vous-même
```
### Ou depuis la console interactive
`taskquoin` tout seul (dans un terminal) ouvre la console, comme `claude` ou `codex` ; `taskquoin console` aussi.
Le logo s'anime au lancement (désactivable : `TASKQUOIN_NO_ANIMATION=1`), puis l'équipe s'affiche avec son état
réel. Tapez `/` : le menu des commandes apparaît et se filtre à mesure que vous tapez ; Tab complète.
```
taskquoin
taskquoin › /run Ajouter la validation du code postal dans l'inscription
taskquoin › /show plan                 # puis /show challenge
taskquoin › /approve plan              # affiche le hash : vous le RETAPEZ pour approuver (Entrée = annuler)
taskquoin › /show                      # liste les artefacts ; /show diff-1, /show verify-1, /show red-1…
taskquoin › /approve commit
taskquoin › /quit
```
Rien ne se lance sans `/`. Votre nom est demandé une fois par session et enregistré « via taskquoin console ».
La console n'est jamais installée dans Claude Code ou Codex : un modèle ne doit pas pouvoir taper vos approbations.

`taskquoin status` liste les runs ; `taskquoin status <run>` montre l'historique et **la commande d'approbation exacte** (étape + hash).
Vous approuvez toujours **ce que vous avez lu** : le hash du plan, puis l'**arbre git** qui a passé les tests et la revue.
Si quelque chose change entre-temps, votre approbation tombe et Taskquoin revérifie et refait la revue.
Les tests tournent dans une **salle blanche** : l'arbre exact, recopié hors du dépôt, avec seulement vos dépendances
(`node_modules`, `vendor`, `.venv`) en lecture seule — jamais vos autres fichiers ignorés (`.env`, `dist/`, caches).
Pendant un run, ne modifiez pas les dépendances (`npm install`…) : l'agent ne peut pas y écrire, et Taskquoin arrête
le run si elles changent. Travaillez plutôt dans un autre clone ou un `git worktree`.

### Utiliser d'autres IA comme relecteurs (DeepSeek, Mistral, Gemini, OpenRouter, Ollama…)
Toute IA qui parle l'API « compatible OpenAI » peut relire vos diffs, en **texte seul** (elle ne voit que le diff et
les fichiers modifiés, jamais un secret ni un binaire, et n'a aucun accès à votre machine). `taskquoin init` propose
en commentaire celles qu'il détecte (variables de clé présentes, Ollama local) : les décommenter, c'est accepter de
leur envoyer le code du projet.
```yaml
providers:
  deepseek: { url: https://api.deepseek.com/v1, model: deepseek-chat, key: env:DEEPSEEK_API_KEY }
  local:    { url: http://localhost:11434/v1, model: qwen2.5-coder:7b }      # Ollama : rien ne sort de la machine
agents:
  security: { runtime: api, provider: deepseek, description: Revue de sécurité, prompt: You are a security reviewer., capabilities: {}, skills: [security-review] }
workflow:
  challengers: [challenger]
  reviewers: [challenger, security]      # chacun doit approuver
```
La clé reste dans votre environnement (`export DEEPSEEK_API_KEY=…`), jamais dans le dépôt. Sans elle, le run ne
démarre pas. `taskquoin doctor` affiche à qui le code est envoyé. Attention : une clé d'API est payée à l'usage.

### Planifier et coder avec n'importe quelle IA : OpenCode (sans Claude Code)
OpenCode est un agent de code open source qui parle à de nombreux fournisseurs (abonnement ChatGPT, GitHub Copilot,
clés OpenRouter / Mistral…, Ollama local). Taskquoin l'enferme dans sa propre sandbox et **ne lui donne aucune
commande** : il lit et écrit des fichiers, c'est Taskquoin qui lance vos tests.
```bash
npm install -g opencode-ai@1.19.5          # la version mesurée par Taskquoin (installation au niveau utilisateur)
taskquoin connect opencode                 # la connexion de Taskquoin (pas votre OpenCode personnel) : ChatGPT, clé…
taskquoin init                             # sans Claude Code : configuration tout-OpenCode, avec verify.command
taskquoin doctor                           # dit à qui part le code : « openai via OpenCode (…) — hosts: chatgpt.com » (en anglais ; `hôtes :` en français)
```
Choisissez le modèle dans `taskquoin.yaml` (`agents.*.model`, format `fournisseur/modèle`). **Seules les connexions
mesurées sont certifiées** (les hôtes contactés sont connus) : aujourd'hui la connexion ChatGPT (`openai`, type
`oauth`) ; une autre connexion (clé OpenRouter, Copilot, Ollama…) est refusée par `doctor` tant qu'elle n'a pas été
mesurée. Avec une connexion ChatGPT, seuls certains modèles sont acceptés (mesuré : `openai/gpt-6-astra`).
Observé une fois : après la connexion ChatGPT d'OpenCode, la session Codex existante a été invalidée — si Codex
répond « invalidated oauth token », relancez `codex login` ; les deux connexions coexistent ensuite. Un implémenteur OpenCode a jusqu'à
4 reprises quand vos tests échouent (2 quand les relecteurs refusent). Chaque run reçoit uniquement l'identifiant du
fournisseur utilisé ; `taskquoin connect opencode --remove` efface la connexion.

### Langue
La console et la CLI parlent la langue choisie dans cet ordre : `TASKQUOIN_LANG`, puis la préférence enregistrée
(`preferences.json` dans le dossier d'état, `${XDG_STATE_HOME:-~/.local/state}/taskquoin/`, ex. `{"language":"fr"}`), puis
`LC_ALL` / `LC_MESSAGES` / `LANG` (`C` et `POSIX` donnent l'anglais), et l'anglais par défaut. Pour forcer une langue :
`TASKQUOIN_LANG=fr taskquoin`. Les sorties `--json`, le journal du run, les artefacts et les trailers de commit restent
toujours en anglais, comme la marque de la bannière (« ✦ YOUR AI DEV SQUAD ✦ », le slogan, les noms de rôles —
Architect, Developer, Reviewer, Security, Tester — et READY / NOT READY ; les notes qui suivent restent traduites).

## 4. Quand ça ne se passe pas comme prévu
Les messages de Taskquoin suivent votre langue (voir « Langue ») : le tableau cite le texte **anglais**, et les
erreurs de run (`failed`, `needs-human`, `interrupted`) viennent du moteur : elles ne sont jamais traduites (anglais, et
quelques-unes en français) quelle que soit la langue.

| Ce que vous voyez | Ce que ça veut dire | Quoi faire |
|---|---|---|
| `uncommitted changes` au `run` | Taskquoin ne mélange jamais ses changements aux vôtres | commitez ou mettez de côté vos modifications |
| `failed … gate refused agent X` | un agent ne peut pas être certifié sur cette machine | `taskquoin doctor` dit pourquoi (version, sandbox absente, risque non accepté…) |
| `needs-human … tests still failing after 3 attempts` | 3 tentatives sans tests verts | reprenez la main sur la branche `taskquoin/<run>`, ou relancez avec une demande plus précise |
| `needs-human … no failing test demonstrates the change` | les tests passent même sans le code de production : ils ne testent pas le changement | lisez `red-N` ; écrivez (ou demandez) un test qui échoue avant le changement. Un refactor ou une doc sans nouveau test finit ici : commitez-le vous-même depuis la branche |
| `needs-human … RED proof inconclusive` | la preuve RED n'a pas pu s'exécuter correctement (timeout, sandbox, arbre impossible à reconstituer) — ce n'est pas une preuve | lisez `red-N` ; votre dossier de travail n'a pas été touché |
| `needs-human … dependencies changed during the run` | `node_modules` (ou `vendor`, `.venv`…) a changé pendant le run : rien n'est vérifié avec | réinstallez les dépendances (`npm ci`…) et relancez un run |
| `needs-human … Verify refused: … links outside the repository` | un lien symbolique (dans l'arbre ou dans `node_modules`, ex. `npm link`) pointe hors du dépôt : Taskquoin ne peut pas geler ce qu'il cible | remplacez le lien par une vraie copie (`npm install`), ou retirez-le |
| les tests passent chez vous mais échouent dans Taskquoin | ils utilisent un fichier ignoré absent de la salle blanche | ajoutez-le à `verify.inherit` dans `taskquoin.yaml` |
| `failed … gate refused agent security: NOM_DE_LA_CLE is missing — define it in your environment (…)` | la clé du fournisseur d'un juge par API n'est pas définie (ce message reste en anglais dans toutes les langues) | `export NOM_DE_LA_CLE=…` puis relancez |
| `interrupted … HTTP 503` (ou 429, délai) | le fournisseur d'un juge est indisponible (déjà réessayé 2 fois) | `taskquoin resume <run>` plus tard : seuls les juges sans réponse sont rappelés |
| `needs-human … trop gros pour le relecteur …` | le diff dépasse `maxInputChars` de ce fournisseur | découpez la tâche, ou augmentez `maxInputChars` |
| `needs-human … protected configuration changed` | l'agent a touché à la config protégée (CI, `.claude/`, `AGENTS.md`…) | rien n'a été commité ; inspectez la branche |
| `diff changed after approval` | le diff n'est plus celui que vous avez approuvé | relisez `diff-N` et ré-approuvez |
| `approve` refusé : `switch to taskquoin/…` | vous n'êtes pas sur la branche du run | `git switch taskquoin/<run>` |
| `does not match the pending artifact` | le hash donné n'est pas celui en attente | relisez avec `show`, copiez le hash de `status` |
| `changed after approval — re-verified and re-reviewed` | l'arbre a changé après votre accord | relisez le nouveau `diff-N` et ré-approuvez |
| `verification modified tracked files` | les tests modifient le code testé | corrigez les tests ; ils ont tourné en salle blanche, votre dossier n'a pas été touché |
| `interrupted` | une erreur technique (git, disque…) a interrompu le run | `taskquoin resume <run>` |
| `taskquoin.yaml changed since the run started` | la config a changé pendant le run | relancez un run |

## 5. Ce que Taskquoin garantit — et ce qu'il ne fait pas
- **Mesuré sur la machine de référence** (`taskquoin doctor`, tests live coopératifs) : pas de réseau pour les commandes des agents ; pas d'écriture hors du projet ; aucun serveur MCP ; les agents ne commitent pas.
- **Garanti par construction et testé** : le commit est exactement l'arbre vérifié, relu et approuvé (`commit-tree`) ; les tests tournent en salle blanche sur cet arbre, dépendances en lecture seule et gelées pour l'agent (ADR-0014) ; Taskquoin vérifie lui-même que les tests modifiés échouent sans le reste du changement (preuve RED, écrite dans le commit : `RED-Proof:`) — il ne juge pas s'ils testent *le bon* comportement : c'est le rôle de la revue et le vôtre, `red-N` en main ; aucun hook du dépôt n'est exécuté par Taskquoin ; une modification de config protégée n'est jamais commitée ; les tests tournent sans réseau, `.git` en lecture seule, HOME masqué.
- **Hooks de commit du projet** : Taskquoin ne les exécute pas (ils pourraient contenir du code modifié par l'agent) — lancez-les vous-même au merge.
- **Seules les IA** reçoivent du code — par définition : Anthropic (Claude Code), OpenAI (Codex), les fournisseurs que vous listez sous `providers` et le fournisseur du modèle de vos agents OpenCode (`taskquoin doctor` les affiche, avec les hôtes mesurés).
- **Pas encore** : pas de push ni de PR automatiques (R6), pas de Jira (Phase B), pas d'interface graphique (Phase B), pas de reprise automatique d'un run `needs-human`.
- Vous pouvez **continuer à utiliser Claude Code et Codex normalement** à côté : Taskquoin ne touche pas à vos sessions interactives ; votre claude-mem reçoit seulement un résumé structuré de chaque run terminé.

## 6. Coûts et durée
Chaque run appelle Claude (planner, implementer) et Codex (challenger, revue). Un petit changement prend typiquement quelques minutes.
- **Avec un abonnement** (Claude Pro/Max connecté par `claude auth login`, Codex connecté par ChatGPT) : **rien n'est facturé** ; le run consomme une part des limites d'usage de l'abonnement. Taskquoin ne transmet jamais de clé d'API aux agents.
- `costUsd` dans les événements du run est le **coût équivalent API estimé** par Claude Code (quelques dizaines de centimes pour un petit changement) : un ordre de grandeur de la consommation, pas une facture. Il ne devient une dépense réelle que si Claude Code est configuré avec une clé d'API facturée.
