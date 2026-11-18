# language: fr
Fonctionnalité: Console interactive — les mêmes commandes, approuvées par un humain qui retape le hash
  `taskquoin console` n'ajoute aucune logique : chaque ligne `/…` appelle une commande existante.
  Rien ne se lance sans `/` ; une approbation exige de retaper le hash affiché.

  Contexte:
    Soit un dépôt git "calc" dont le test "sum" échoue tant que sum.js n'existe pas
    Et Taskquoin initialisé dans ce dépôt, mémoire désactivée
    Et le propriétaire de test a accepté le risque "connector.write" pour l'agent "challenger"

  Scénario: L'aide de la console, et un texte libre ne lance rien
    Soit la langue est "fr"
    Quand le propriétaire tape dans la console : /help ; ajoute une fonction sum ; /quit
    Alors la sortie contient "/approve <plan|commit>"
    Et la sortie contient "Rien n'est lancé sans commande"
    Et aucun run n'a été lancé

  @sandbox
  Scénario: De la demande au commit depuis la console, en retapant chaque hash
    Quand le propriétaire tape dans la console : /run Ajouter une fonction sum ; /quit
    Alors le run attend l'approbation "approve-plan"
    Quand le propriétaire tape dans la console : /use <run> ; /show plan ; /approve plan ; alice ; <hash> ; /quit
    Alors le run attend l'approbation "approve-commit"
    Quand le propriétaire tape dans la console : /use <run> ; /show ; /quit
    Alors la sortie contient "verify-1  "
    Et la sortie contient "red-1  "
    Quand le propriétaire tape dans la console : /use <run> ; /approve commit ; alice ; <hash> ; /quit
    Alors le run est "completed"
    Et le dernier commit de la branche du run contient "Commit-Approved-By: alice (via taskquoin console)"

  @sandbox
  Scénario: Un hash mal retapé n'approuve rien
    Soit la langue est "fr"
    Quand le propriétaire tape dans la console : /run Ajouter une fonction sum ; /quit
    Et le propriétaire tape dans la console : /use <run> ; /approve plan ; alice ; 000000000000 ; /quit
    Alors la sortie d'erreur contient "ne correspond pas"
    Et le run attend l'approbation "approve-plan"
    Quand le propriétaire tape dans la console : /use <run> ; /approve plan ; /quit ; /quit
    Alors la sortie d'erreur contient "une commande n'est pas un nom"
    Et le run attend l'approbation "approve-plan"
