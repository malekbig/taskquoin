# language: fr
Fonctionnalité: Le Dashboard, un écran en lecture seule — refus propre sans terminal
  `taskquoin dashboard` ne sert qu'à regarder : sans terminal il renvoie vers `taskquoin status`,
  et depuis la console `/dashboard` lance ce même écran dans son propre processus.

  Contexte:
    Soit un dépôt git "calc" dont le test "sum" échoue tant que sum.js n'existe pas
    Et Taskquoin initialisé dans ce dépôt, mémoire désactivée

  Scénario: Le Dashboard refuse sans terminal et renvoie vers taskquoin status
    Quand le propriétaire exécute "dashboard"
    Alors la commande échoue avec le code 1
    Et la sortie d'erreur contient "taskquoin status"
    Et la sortie ne contient pas "run"

  Scénario: /dashboard depuis la console sans terminal : message, la console continue
    Quand le propriétaire tape dans la console : /dashboard ; /help dashboard ; /quit
    Alors la sortie d'erreur contient "taskquoin status"
    Et la sortie contient "/dashboard"
    Et aucun run n'a été lancé

  Scénario: Le Dashboard d'un run inconnu échoue
    Quand le propriétaire exécute "dashboard run-zzz"
    Alors la commande échoue avec le code 1
    Et la sortie d'erreur contient "unknown run run-zzz"
