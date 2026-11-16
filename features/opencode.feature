# language: fr
Fonctionnalité: OpenCode — n'importe quelle IA écrit le code, sans commandes, dans la sandbox de Taskquoin
  Le planner, l'implémenteur et le relecteur tournent sur OpenCode avec le modèle choisi par le projet. L'implémenteur
  lit et écrit des fichiers, rien d'autre : c'est Taskquoin qui lance les tests (salle blanche, preuve RED) et qui
  commite, après deux approbations humaines. La connexion au fournisseur est celle de Taskquoin, jamais l'OpenCode
  personnel de l'utilisateur.

  Contexte:
    Soit un dépôt git "calc" dont le test "sum" échoue tant que sum.js n'existe pas
    Et Taskquoin initialisé dans ce dépôt pour OpenCode, mémoire désactivée

  @sandbox
  Scénario: Une demande aboutit à un commit vérifié avec un implémenteur OpenCode sans commandes
    Soit le fournisseur "openai" connecté pour OpenCode
    Quand le propriétaire lance la demande "Ajouter une fonction sum"
    Et le propriétaire approuve en tant que "alice"
    Alors le run attend l'approbation "approve-commit"
    Quand le propriétaire approuve en tant que "alice"
    Alors le run est "completed"
    Et le dernier commit de la branche du run contient "Reviewed-By: challenger (opencode: openai/gpt-6-astra)"

  @sandbox
  Scénario: Des tests qui restent rouges donnent quatre reprises, puis la main revient à l'humain
    Soit le fournisseur "openai" connecté pour OpenCode
    Quand le propriétaire lance la demande "Ajouter une fonction sum CASSÉE"
    Et le propriétaire approuve en tant que "alice"
    Alors le run est "needs-human" avec la raison contenant "tests still failing after 5 attempts"
    Et aucun commit n'a été créé sur la branche du run

  @sandbox
  Scénario: La configuration OpenCode du dépôt n'est ni chargée ni modifiable, et l'implémenteur sait qu'il n'a pas de commandes
    Soit le fournisseur "openai" connecté pour OpenCode
    Et le dépôt contient une configuration OpenCode piégée
    Quand le propriétaire lance la demande "Ajouter une fonction sum avec RAPPORT"
    Et le propriétaire approuve en tant que "alice"
    Alors le run attend l'approbation "approve-commit"
    Et l'artefact "diff-1" contient "config-du-depot: non lue"
    Et l'artefact "diff-1" contient "dossier-.opencode: invisible"
    Et l'artefact "diff-1" contient "instructions-docs: vides"
    Et l'artefact "diff-1" contient "ecriture-opencode.json: refusée"
    Et l'artefact "diff-1" contient "sans-commandes: oui"

  Scénario: Sans connexion du fournisseur, doctor refuse l'agent OpenCode et le run ne démarre pas
    Quand le propriétaire exécute "doctor"
    Alors la commande échoue avec le code 1
    Et la sortie contient "fournisseur \"openai\" non connecté pour Taskquoin — lancez : taskquoin connect opencode"
    Quand le propriétaire lance la demande "Ajouter une fonction sum"
    Alors la commande échoue avec un message contenant "non connecté"
    Et le dépôt est resté sur la branche initiale

  @sandbox
  Scénario: doctor dit à qui le code est envoyé via OpenCode, et par quels hôtes
    Soit le fournisseur "openai" connecté pour OpenCode
    Quand le propriétaire exécute "doctor"
    Alors la commande réussit
    Et la sortie contient "openai via OpenCode (openai/gpt-6-astra) — hôtes : chatgpt.com — planner, implementer, challenger"
