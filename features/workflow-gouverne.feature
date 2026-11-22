# language: fr
Fonctionnalité: Workflow gouverné — de la demande au commit vérifié
  Enchaînement : recall → plan (Claude) → challenge (Codex) → ✋ approbation du plan
  → implémentation TDD (Claude) → vérification sandboxée (hôte) → revue (Codex)
  → ✋ approbation du diff exact → commit par Taskquoin → record.
  Les agents ne commitent jamais ; « terminé » est décidé par la vérification, pas par un modèle.

  Contexte:
    Soit un dépôt git "calc" dont le test "sum" échoue tant que sum.js n'existe pas
    Et Taskquoin initialisé dans ce dépôt, mémoire désactivée
    Et le propriétaire de test a accepté le risque "connector.write" pour l'agent "challenger"

  @sandbox
  Scénario: Une demande aboutit à un commit vérifié, après deux approbations humaines
    Quand le propriétaire lance la demande "Ajouter une fonction sum"
    Alors le run attend l'approbation "approve-plan"
    Et l'artefact "plan" contient "PLAN"
    Et l'artefact "challenge" contient "VERDICT: APPROVE"
    Et aucun fichier du dépôt n'a été modifié
    Quand le propriétaire approuve en tant que "alice"
    Alors le run attend l'approbation "approve-commit"
    Et l'artefact "diff-1" contient "sum.js"
    Et l'artefact "verify-1" contient "exit=0"
    Et l'artefact "review-1" contient "VERDICT: APPROVE"
    Et aucun commit n'a été créé sur la branche du run
    Quand le propriétaire approuve en tant que "alice"
    Alors le run est "completed"
    Et le dernier commit de la branche du run contient "Taskquoin-Run:"
    Et le dernier commit de la branche du run contient "Commit-Approved-By: alice"
    Et le dernier commit de la branche du run contient "RED-Proof: proven (attempt 1)"
    Et le dernier commit contient le fichier "sum.js"

  @sandbox
  Scénario: Une demande tapée sans guillemets est prise en entier
    Quand le propriétaire exécute "run Ajouter une fonction sum"
    Alors le run attend l'approbation "approve-plan"
    Et la demande du run est "Ajouter une fonction sum"

  @sandbox
  Scénario: Un run dont le processus a été tué est signalé interrompu et se reprend au même nœud
    Quand le propriétaire lance la demande "Ajouter une fonction sum"
    Alors le run attend l'approbation "approve-plan"
    Soit le processus du run tué pendant le nœud "plan"
    Alors le run est "interrupted" avec la raison contenant "process gone"
    Quand le propriétaire reprend le run
    Alors le run attend l'approbation "approve-plan"
    Et l'historique du run contient "interrupted"

  @sandbox
  Scénario: Des tests rouges déclenchent au plus deux reprises, puis la main revient à l'humain
    Quand le propriétaire lance la demande "Ajouter une fonction sum CASSÉE"
    Et le propriétaire approuve en tant que "alice"
    Alors le run est "needs-human" avec la raison contenant "tests still failing after 3 attempts"
    Et l'artefact "verify-3" contient "exit=1"
    Et aucun commit n'a été créé sur la branche du run

  @sandbox
  Scénario: Une commande de test introuvable dans la salle blanche arrête le run une fois, sans reprise
    Soit le propriétaire configure la commande de test "mytest"
    Quand le propriétaire lance la demande "Ajouter une fonction sum"
    Et le propriétaire approuve en tant que "alice"
    Alors le run est "needs-human" avec la raison contenant "Verify could not run the test command (exit 127)"
    Et l'historique du run contient "implemented:1"
    Et l'historique du run ne contient pas "implemented:2"
    Et aucun commit n'a été créé sur la branche du run

  @sandbox
  Scénario: Une modification de configuration protégée n'atterrit jamais
    Quand le propriétaire lance la demande "Ajouter sum et toucher la CONFIG des agents"
    Et le propriétaire approuve en tant que "alice"
    Alors le run est "needs-human" avec la raison contenant "protected configuration changed: pkg/new/AGENTS.md"
    Et aucun commit n'a été créé sur la branche du run

  @sandbox
  Scénario: Une revue qui demande toujours des changements rend la main après deux reprises
    Quand le propriétaire lance la demande "Ajouter sum — REVUE-NÉGATIVE"
    Et le propriétaire approuve en tant que "alice"
    Alors le run est "needs-human" avec la raison contenant "review still requests changes after 3 attempts"
    Et aucun commit n'a été créé sur la branche du run

  @sandbox
  Scénario: Des tests qui passent sans le changement de production ne prouvent rien (preuve RED)
    Quand le propriétaire lance la demande "Ajouter sum avec un test TAUTOLOGIE"
    Et le propriétaire approuve en tant que "alice"
    Alors le run est "needs-human" avec la raison contenant "no failing test demonstrates the change"
    Et l'artefact "verify-3" contient "exit=0"
    Et l'artefact "red-3" contient "pass WITHOUT your production change"
    Et aucun commit n'a été créé sur la branche du run

  @sandbox
  Scénario: Une preuve RED dont la sortie est tronquée n'est pas une preuve
    Quand le propriétaire lance la demande "Ajouter sum avec un test BAVARD"
    Et le propriétaire approuve en tant que "alice"
    Alors le run est "needs-human" avec la raison contenant "RED proof inconclusive"
    Et l'artefact "red-1" contient "INCONCLUSIVE"
    Et aucun commit n'a été créé sur la branche du run

  @sandbox
  Scénario: La preuve RED est faite par Taskquoin avant la revue
    Quand le propriétaire lance la demande "Ajouter une fonction sum"
    Et le propriétaire approuve en tant que "alice"
    Alors le run attend l'approbation "approve-commit"
    Et l'artefact "red-1" contient "RED proven"
    Et l'artefact "red-1" contient "exit=1"

  @sandbox
  Scénario: La vérification se fait en salle blanche, avec les dépendances installées en lecture seule
    Soit une dépendance "dep" installée dans node_modules (ignorée par git)
    Quand le propriétaire lance la demande "Ajouter sum VIA-DEP"
    Et le propriétaire approuve en tant que "alice"
    Alors le run attend l'approbation "approve-commit"
    Et l'artefact "verify-1" contient "inherited read-only: node_modules"
    Et l'artefact "verify-1" contient "exit=0"

  @sandbox
  Scénario: Une dépendance modifiée pendant le run arrête tout avant la vérification
    Soit une dépendance "dep" installée dans node_modules (ignorée par git)
    Quand le propriétaire lance la demande "Ajouter sum et PATCHER la dépendance"
    Et le propriétaire approuve en tant que "alice"
    Alors le run est "needs-human" avec la raison contenant "dependencies changed during the run: node_modules/dep"
    Et aucun commit n'a été créé sur la branche du run

  @sandbox
  Scénario: Un fichier ignoré laissé par l'agent n'est pas vu par la vérification
    Soit les fichiers "*.local.js" ignorés par git
    Quand le propriétaire lance la demande "Ajouter sum CACHÉ dans un fichier ignoré"
    Et le propriétaire approuve en tant que "alice"
    Alors le run est "needs-human" avec la raison contenant "tests still failing after 3 attempts"
    Et l'artefact "verify-1" contient "impl.local.js"
    Et l'artefact "ignored-1" contient "+ impl.local.js"
    Et aucun commit n'a été créé sur la branche du run

  @sandbox
  Scénario: Les fichiers ignorés laissés par l'agent sont montrés avant l'approbation du commit
    Soit les fichiers "*.local.js" ignorés par git
    Quand le propriétaire lance la demande "Ajouter une fonction sum avec une TRACE"
    Et le propriétaire approuve en tant que "alice"
    Alors le run attend l'approbation "approve-commit"
    Et l'artefact "ignored-1" contient "+ debug.local.js"
    Et l'artefact "review-1" contient "VERDICT: APPROVE"

  @sandbox
  Scénario: Un lien symbolique vers l'extérieur du dépôt bloque la vérification
    Quand le propriétaire lance la demande "Ajouter une fonction sum avec un LIEN-EXTERNE"
    Et le propriétaire approuve en tant que "alice"
    Alors le run est "needs-human" avec la raison contenant "Verify refused: the tree links outside the repository: ext.txt"
    Et aucun commit n'a été créé sur la branche du run

  @sandbox
  Scénario: Une dépendance qui pointe hors du dépôt bloque la vérification
    Soit une dépendance "dep" installée dans node_modules (ignorée par git)
    Et la dépendance "linked" est un lien vers un dossier hors du dépôt
    Quand le propriétaire lance la demande "Ajouter une fonction sum"
    Et le propriétaire approuve en tant que "alice"
    Alors le run est "needs-human" avec la raison contenant "Verify refused: inherited dependencies link outside the repository: node_modules/linked"

  @sandbox
  Scénario: Un secret rangé dans une dépendance reste masqué pendant la vérification
    Soit une dépendance "dep" installée dans node_modules (ignorée par git)
    Et la dépendance "dep" contient le secret "CANARY-DEP-7731" dans ".env"
    Quand le propriétaire lance la demande "Ajouter une fonction sum qui LIT-SECRET"
    Et le propriétaire approuve en tant que "alice"
    Alors le run attend l'approbation "approve-commit"
    Et l'artefact "verify-1" contient "DEP-ENV:DENIED"
    Et l'artefact "verify-1" ne contient pas "CANARY-DEP-7731"

  @sandbox
  Scénario: Un lien qui sort du dépôt en passant par un autre lien est aussi refusé
    Quand le propriétaire lance la demande "Ajouter une fonction sum avec un LIEN-DÉTOURNÉ"
    Et le propriétaire approuve en tant que "alice"
    Alors le run est "needs-human" avec la raison contenant "Verify refused: the tree links outside the repository: payload.js"
    Et aucun commit n'a été créé sur la branche du run

  @sandbox
  Scénario: Un chemin hérité qui est lui-même un lien est refusé
    Soit le propriétaire fait hériter "build/deps" qui est un lien vers un dossier hors du dépôt
    Quand le propriétaire lance la demande "Ajouter une fonction sum"
    Et le propriétaire approuve en tant que "alice"
    Alors le run est "needs-human" avec la raison contenant "Verify refused: inherited path build/deps goes through a symlink"

  @sandbox
  Scénario: Les secrets d'une dépendance restent masqués même derrière un lien ou dans son .git
    Soit une dépendance "dep" installée dans node_modules (ignorée par git)
    Et la dépendance "dep" a un ".env" qui est un lien vers "credentials.txt" contenant "CANARY-LINK-4410"
    Et la dépendance "dep" a un dossier ".git" contenant le secret "CANARY-GIT-5521"
    Quand le propriétaire lance la demande "Ajouter une fonction sum qui LIT-SECRET-LIEN"
    Et le propriétaire approuve en tant que "alice"
    Alors le run attend l'approbation "approve-commit"
    Et l'artefact "verify-1" contient "READ node_modules/dep/.env:DENIED"
    Et l'artefact "verify-1" ne contient pas "CANARY-LINK-4410"
    Et l'artefact "verify-1" ne contient pas "CANARY-GIT-5521"

  @sandbox
  Scénario: Un .env du dépôt qui pointe dans une dépendance reste masqué
    Soit une dépendance "dep" installée dans node_modules (ignorée par git)
    Et la dépendance "dep" contient le fichier "credentials.txt" avec "CANARY-DEPLINK-8832"
    Quand le propriétaire lance la demande "Ajouter une fonction sum ENV-VERS-DEP"
    Et le propriétaire approuve en tant que "alice"
    Alors le run attend l'approbation "approve-commit"
    Et l'artefact "verify-1" contient "READ .env:DENIED"
    Et l'artefact "verify-1" ne contient pas "CANARY-DEPLINK-8832"

  @sandbox
  Scénario: Un lien caché dans le .git d'une dépendance est inspecté comme les autres
    Soit une dépendance "dep" installée dans node_modules (ignorée par git)
    Et la dépendance "dep" a dans son ".git" un lien vers un fichier hors du dépôt
    Quand le propriétaire lance la demande "Ajouter une fonction sum"
    Et le propriétaire approuve en tant que "alice"
    Alors le run est "needs-human" avec la raison contenant "Verify refused: inherited dependencies link outside the repository: node_modules/dep/.git/payload"

  Scénario: Taskquoin refuse de démarrer sur un dépôt avec des modifications non commitées
    Soit une modification non commitée dans le dépôt
    Quand le propriétaire lance la demande "Ajouter une fonction sum"
    Alors la commande échoue avec un message contenant "uncommitted changes"

  @sandbox
  Scénario: Rejouer une approbation ou approuver sans avoir lu est refusé
    Quand le propriétaire lance la demande "Ajouter une fonction sum"
    Et le propriétaire approuve le plan avec un hash qu'il n'a pas lu
    Alors la commande échoue avec un message contenant "does not match the pending artifact"
    Quand le propriétaire approuve en tant que "alice"
    Alors le run attend l'approbation "approve-commit"
    Quand le propriétaire rejoue la même commande d'approbation
    Alors la commande échoue avec un message contenant "not waiting for approve-plan"
    Et aucun commit n'a été créé sur la branche du run

  @sandbox
  Scénario: Si l'arbre change après l'approbation, Taskquoin revérifie et refait la revue
    Quand le propriétaire lance la demande "Ajouter une fonction sum"
    Et le propriétaire approuve en tant que "alice"
    Et le développeur modifie "extra.js" avant d'approuver
    Et le propriétaire approuve en tant que "alice"
    Alors le run attend l'approbation "approve-commit"
    Et le run est "waiting-approval" avec la raison contenant "changed after approval — re-verified and re-reviewed"
    Et aucun commit n'a été créé sur la branche du run
    Quand le propriétaire approuve en tant que "alice"
    Alors le run est "completed"
    Et le dernier commit contient le fichier "extra.js"

  @sandbox
  Scénario: Des tests qui modifient le dépôt pendant la vérification échouent
    Quand le propriétaire lance la demande "Ajouter sum avec un test SUIVI"
    Et le propriétaire approuve en tant que "alice"
    Alors le run est "needs-human" avec la raison contenant "verification modified tracked files"
    Et aucun commit n'a été créé sur la branche du run

  @sandbox
  Scénario: Un test ne peut pas poser un hook git pendant la vérification
    Quand le propriétaire lance la demande "Ajouter sum avec un PIÈGE-GIT"
    Et le propriétaire approuve en tant que "alice"
    Alors le run attend l'approbation "approve-commit"
    Et le dépôt git ne contient aucun hook "pre-commit"
    Quand le propriétaire approuve en tant que "alice"
    Alors le run est "completed"
    Et le dépôt git ne contient aucun hook "pre-commit"

  @sandbox
  Scénario: Renommer un fichier d'instructions protégé est bloqué à l'atterrissage
    Quand le propriétaire lance la demande "Ajouter sum et RENOMME les consignes"
    Et le propriétaire approuve en tant que "alice"
    Alors le run est "needs-human" avec la raison contenant "protected configuration changed: docs/AGENTS.md"
    Et aucun commit n'a été créé sur la branche du run

  @sandbox
  Scénario: Un verdict ambigu du relecteur vaut un refus
    Quand le propriétaire lance la demande "Ajouter sum — VERDICT-AMBIGU"
    Et le propriétaire approuve en tant que "alice"
    Alors le run est "needs-human" avec la raison contenant "review still requests changes"
    Et aucun commit n'a été créé sur la branche du run
