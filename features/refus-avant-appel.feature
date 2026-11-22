# language: fr
Fonctionnalité: Un run refusé l'est avant le premier appel payant
  Tout agent que le workflow appellera (planificateur, implémenteur, challengers, relecteurs) passe sa porte avant
  que quoi que ce soit ne démarre : un refus connu d'avance ne coûte ni appel, ni branche, ni run.

  Contexte:
    Soit un dépôt git "calc" dont le test "sum" échoue tant que sum.js n'existe pas
    Et Taskquoin initialisé dans ce dépôt, mémoire désactivée

  @sandbox
  Scénario: Une restriction non mesurée d'un challenger Codex refuse le run avant le planificateur
    Quand le propriétaire lance la demande "Ajouter une fonction sum"
    Alors la commande échoue avec le code 1
    Et la sortie d'erreur contient "connector.write"
    Et la sortie d'erreur contient "taskquoin accept-risk challenger connector.write"
    Et aucun agent n'a été appelé
    Et aucune branche de run n'existe

  Scénario: Une version de runtime non mesurée renvoie vers upgrade, sans appel ni branche
    Soit un Claude Code "9.9.9" installé sur le PATH
    Quand le propriétaire lance la demande "Ajouter une fonction sum"
    Alors la commande échoue avec le code 1
    Et la sortie d'erreur contient "taskquoin upgrade"
    Et aucun agent n'a été appelé
    Et aucune branche de run n'existe
