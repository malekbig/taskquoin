# language: fr
Fonctionnalité: Les commandes de la CLI taskquoin
  Chaque commande, ses sorties attendues et ses erreurs d'usage.
  Codes de sortie : 0 = succès · 1 = refusé / vérification en échec · 2 = erreur d'usage.

  Contexte:
    Soit un dépôt git "calc" dont le test "sum" échoue tant que sum.js n'existe pas

  Scénario: help liste toutes les commandes
    Quand le propriétaire exécute "help"
    Alors la commande réussit
    Et la sortie contient "init"
    Et la sortie contient "doctor"
    Et la sortie contient "check <agent>"
    Et la sortie contient "accept-risk"
    Et la sortie contient "run"
    Et la sortie contient "approve <run> <plan|commit> --expect <hash>"
    Et la sortie contient "resume <run>"
    Et la sortie contient "status"
    Et la sortie contient "show <run> <artifact>"
    Et la sortie contient "uninstall"

  Scénario: une commande inconnue est une erreur d'usage
    Quand le propriétaire exécute "deploy"
    Alors la commande échoue avec le code 2
    Et la sortie d'erreur contient "usage: taskquoin"

  Scénario: le lanceur bin/taskquoin exécute la même CLI
    Quand le propriétaire utilise le lanceur avec "help"
    Alors la commande réussit
    Et la sortie contient "approve <run>"

  Scénario: toute commande de projet exige taskquoin.yaml
    Quand le propriétaire exécute "doctor"
    Alors la commande échoue avec le code 1
    Et la sortie d'erreur contient "run \"taskquoin init\""

  @sandbox
  Scénario: doctor certifie chaque agent et refuse celui qui ne peut pas l'être
    Soit Taskquoin initialisé dans ce dépôt, mémoire désactivée
    Quand le propriétaire exécute "doctor"
    Alors la commande échoue avec le code 1
    Et la sortie contient "Runtime claude: 2.1.325"
    Et la sortie contient "Bash sandbox (bubblewrap + socat): ✔"
    Et la sortie contient "Agent planner (claude)"
    Et la sortie contient "✖ connector.write"
    Et la sortie contient "Verdict: 2 of 3 agents can run"

  @sandbox
  Scénario: après acceptation du risque, doctor autorise les trois agents
    Soit Taskquoin initialisé dans ce dépôt, mémoire désactivée
    Et le propriétaire de test a accepté le risque "connector.write" pour l'agent "challenger"
    Quand le propriétaire exécute "doctor"
    Alors la commande réussit
    Et la sortie contient "⚠ connector.write accepted risk (approved by test-owner until 2099-12-31"
    Et la sortie contient "Verdict: all 3 agents can run."

  Scénario: check affiche le détail d'un agent ; un agent inconnu est une erreur d'usage
    Soit Taskquoin initialisé dans ce dépôt, mémoire désactivée
    Quand le propriétaire exécute "check planner"
    Alors la commande réussit
    Et la sortie contient "✔ fs.write ENFORCED"
    Quand le propriétaire exécute "check ghost"
    Alors la commande échoue avec le code 2
    Et la sortie d'erreur contient "known agents: planner, implementer, challenger"

  Scénario: accept-risk refuse une date passée, une raison absente ou une capacité qui n'échoue pas
    Soit Taskquoin initialisé dans ce dépôt, mémoire désactivée
    Quand le propriétaire exécute "accept-risk challenger connector.write --reason x --expires 2001-01-01 --as test-owner"
    Alors la commande échoue avec le code 2
    Et la sortie d'erreur contient "in the past"
    Quand le propriétaire exécute "accept-risk challenger connector.write --expires 2099-01-01 --as test-owner"
    Alors la commande échoue avec le code 2
    Quand le propriétaire exécute "accept-risk planner fs.write --reason x --expires 2099-01-01 --as test-owner"
    Alors la commande échoue avec le code 1
    Et la sortie d'erreur contient "nothing to accept"

  Scénario: run sans demande est une erreur d'usage
    Soit Taskquoin initialisé dans ce dépôt, mémoire désactivée
    Quand le propriétaire exécute "run"
    Alors la commande échoue avec le code 2

  @sandbox
  Scénario: status, show et approve autour d'un run en attente
    Soit Taskquoin initialisé dans ce dépôt, mémoire désactivée
    Et le propriétaire de test a accepté le risque "connector.write" pour l'agent "challenger"
    Quand le propriétaire exécute "status"
    Alors la commande réussit
    Quand le propriétaire lance la demande "Ajouter une fonction sum"
    Et le propriétaire exécute "status"
    Alors la sortie contient "waiting-approval"
    Et la sortie contient "Ajouter une fonction sum"
    Quand le propriétaire exécute "status {run}"
    Alors la sortie contient "recall"
    Et la sortie contient "plan"
    Et la sortie contient "challenge"
    Quand le propriétaire exécute "show {run} diff-1"
    Alors la commande échoue avec le code 1
    Et la sortie d'erreur contient "available: plan, challenge"
    Quand le propriétaire exécute "approve {run}"
    Alors la commande échoue avec le code 2
    Quand le propriétaire exécute "approve run-inconnu plan --expect 0123456789ab --as alice"
    Alors la commande échoue avec le code 1
    Quand le propriétaire revient sur la branche initiale
    Et le propriétaire approuve en tant que "alice"
    Alors la commande échoue avec le code 1
    Et la sortie d'erreur contient "switch to taskquoin/"

  Scénario: uninstall sans installation préalable ne supprime rien
    Quand le propriétaire exécute "uninstall"
    Alors la commande échoue avec le code 1
    Et la sortie d'erreur contient "no manifest"
