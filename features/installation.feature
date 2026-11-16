# language: fr
Fonctionnalité: Installation et désinstallation sans toucher à ce qui n'appartient pas à Taskquoin

  Contexte:
    Soit un dépôt git "calc" dont le test "sum" échoue tant que sum.js n'existe pas

  Scénario: init crée la configuration et un manifeste hors du dépôt ; uninstall retire seulement ce qui est intact
    Quand le propriétaire exécute "init"
    Alors le fichier "taskquoin.yaml" existe
    Et le manifeste est stocké hors du dépôt
    Quand le propriétaire exécute "uninstall --purge-state"
    Alors le fichier "taskquoin.yaml" n'existe plus

  Scénario: uninstall garde un fichier que l'utilisateur a modifié
    Quand le propriétaire exécute "init"
    Et l'utilisateur ajoute une note dans "taskquoin.yaml"
    Et le propriétaire exécute "uninstall"
    Alors la commande échoue avec un message contenant "kept taskquoin.yaml (modified since init)"
    Et le fichier "taskquoin.yaml" existe
