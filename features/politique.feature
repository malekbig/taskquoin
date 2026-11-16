# language: fr
Fonctionnalité: Verrou de politique avant chaque agent (prepareRun)
  Un agent ne démarre que si chaque restriction obligatoire est certifiée par un mécanisme MESURÉ,
  ou couverte par une acceptation de risque du propriétaire, liée à l'échec exact et datée.

  Contexte:
    Soit un dépôt git "calc" dont le test "sum" échoue tant que sum.js n'existe pas
    Et Taskquoin initialisé dans ce dépôt, mémoire désactivée

  Scénario: Sans acceptation de risque, le challenger Codex est refusé et le run s'arrête avant lui
    Alors l'agent "challenger" est refusé pour "connector.write"
    Et l'agent "planner" est autorisé
    Quand le propriétaire lance la demande "Ajouter une fonction sum"
    Alors le run est "failed" avec la raison contenant "gate refused agent challenger"

  Scénario: Une acceptation de risque est stockée hors du dépôt et rend l'agent autorisable
    Soit le propriétaire de test a accepté le risque "connector.write" pour l'agent "challenger"
    Alors l'agent "challenger" est autorisé avec un risque accepté sur "connector.write"
    Et le fichier "taskquoin.yaml" ne contient pas "exceptions"

  Scénario: Le dépôt ne peut pas retirer le plancher de restrictions obligatoires
    Soit le fichier taskquoin.yaml déclare une liste "mandatory" vide
    Alors l'agent "challenger" est refusé pour "connector.write"

  Scénario: Le dépôt ne peut pas s'auto-approuver un risque
    Soit le fichier taskquoin.yaml déclare des "exceptions"
    Alors la vérification de l'agent "challenger" échoue avec un message contenant "accept-risk"
