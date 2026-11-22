# language: fr
Fonctionnalité: taskquoin upgrade — les versions des outils, sans réseau sauf demande explicite
  `taskquoin upgrade` montre ce qui est installé, utilisé et mesuré ; la réinstallation exige une confirmation tapée.
  Les scénarios n'atteignent jamais le réseau (TASKQUOIN_OFFLINE=1) et ne lancent jamais le vrai npm : un faux npm,
  placé avant lui dans le PATH, laisse une trace et échoue.

  Contexte:
    Soit un dépôt git "calc" dont le test "sum" échoue tant que sum.js n'existe pas

  Scénario: upgrade montre les runtimes sans aller en ligne
    Quand le propriétaire exécute "upgrade"
    Alors la commande réussit
    Et la sortie contient "claude"
    Et la sortie contient "Offline"
    Et la sortie ne contient pas "registry.npmjs.org"

  Scénario: upgrade install peut être annulé
    Soit un Claude Code "9.9.9" installé sur le PATH
    Et un faux npm qui laisse une trace s'il est lancé
    Quand le propriétaire exécute "upgrade install" en tapant une ligne vide
    Alors la commande réussit
    Et la sortie contient "Cancelled"
    Et le faux npm n'a pas été lancé

  Scénario: upgrade install confirmé lance l'installateur hors du dépôt, et son échec donne le code 1
    Soit un Claude Code "9.9.9" installé sur le PATH
    Et un faux npm qui laisse une trace s'il est lancé
    Quand le propriétaire exécute "upgrade install" et confirme en tapant yes
    Alors la commande échoue avec le code 1
    Et le faux npm a été lancé dans HOME avec "install -g @anthropic-ai/claude-code@"
    Et la sortie d'erreur contient "The installer exited with code 1"
