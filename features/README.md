# Spécifications exécutables (Gherkin, en français)

Ces fichiers décrivent **l'enchaînement** de Taskquoin en langage naturel ; chaque phrase est exécutée.

| Fichier | Ce qu'il décrit |
|---|---|
| `workflow-gouverne.feature` | demande → plan → challenge → ✋ approbation → TDD → vérification sandboxée → revue → ✋ approbation du diff → commit ; reprises (≤ 2), barrière d'atterrissage, refus sur dépôt sale |
| `politique.feature` | le verrou avant chaque agent : plancher obligatoire, acceptation de risque hors du dépôt, refus d'auto-approbation |
| `installation.feature` | `init` / `uninstall` sans toucher à ce qui n'appartient pas à Taskquoin |
| `commandes.feature` | chaque commande de la CLI, ses sorties et ses erreurs d'usage (codes 0 / 1 / 2) |

```
Demande ──► recall ──► plan (Claude, lecture seule) ──► challenge (Codex, lecture seule)
        ──► ✋ approbation du plan (liée au hash du plan)
        ──► implémentation TDD (Claude, sandbox) ──► vérification (tests du projet, bubblewrap, sans réseau)
        ──► revue (Codex, VERDICT) ──┬─ APPROVE ─► ✋ approbation du diff exact ─► commit par Taskquoin ─► record
                                     └─ tests rouges / CHANGES_REQUESTED ─► reprise (≤ 2) ─► sinon main à l'humain
```

## Lancer
```bash
npm run features      # affiche chaque scénario étape par étape (✔ Soit… ✔ Quand… ✔ Alors…)
npm test              # tout, y compris ces scénarios
```

## Ce que c'est — et ce que ce n'est pas
- **Vrai** : la CLI Taskquoin, git, le store de contrôle (isolé dans un HOME temporaire), la vérification dans bubblewrap, `npm test`.
- **Simulé** : Claude Code et Codex sont remplacés par des faux déterministes (`support/fakes/`) — zéro token.
  Les sandboxes des runtimes eux-mêmes sont prouvées par les tests live (`tests/live-*.e2e.test.ts`, `TQ_E2E=1`).
- Les scénarios `@sandbox` exigent bubblewrap + socat ; sinon ils sont ignorés avec la raison.
- Pas de Cucumber : un lanceur minimal (`support/gherkin.ts`) sur `node:test` — aucune dépendance ajoutée.
  Une étape non définie **et** une ligne non reconnue (mot-clé mal orthographié) font **échouer** le scénario.
- Les sandboxes des runtimes sont des **mesures coopératives** (tests live) ; ces scénarios prouvent l'orchestration et la politique.
