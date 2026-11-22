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

  Scénario: Une commande inconnue propose la plus proche, et /help explique une commande
    Soit la langue est "fr"
    Quand le propriétaire tape dans la console : /aprove ; /help approve ; /quit
    Alors la sortie d'erreur contient "vouliez-vous dire /approve"
    Et la sortie contient "/approve <plan|commit>"
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
  Scénario: Un fichier non suivi dans l'arbre de travail : /approve commit fait exactement ce que fait taskquoin approve
    Quand le propriétaire tape dans la console : /run Ajouter une fonction sum ; /quit
    Et le propriétaire tape dans la console : /use <run> ; /approve plan ; alice ; <hash> ; /quit
    Alors le run attend l'approbation "approve-commit"
    Quand le développeur modifie "notes.txt" avant d'approuver
    Et le propriétaire tape dans la console : /use <run> ; /approve commit ; alice ; <hash> ; /quit
    Alors la sortie contient "Bound to the git tree"
    Et la sortie d'erreur ne contient pas "nothing is approved"
    Et le run est "waiting-approval" avec la raison contenant "changed after approval — re-verified and re-reviewed"
    Et aucun commit n'a été créé sur la branche du run
    Quand le propriétaire tape dans la console : /use <run> ; /approve commit ; alice ; <hash> ; /quit
    Alors le run est "completed"
    Et le dernier commit contient le fichier "notes.txt"

  @sandbox
  Scénario: /approve montre ce que l'approbation lie, ce qu'il y a à lire et ce qui a été lu, avant de demander le hash
    Quand le propriétaire tape dans la console : /run Ajouter une fonction sum ; /quit
    Et le propriétaire tape dans la console : /use <run> ; /approve plan ; alice ; <hash> ; /quit
    Alors le run attend l'approbation "approve-commit"
    Quand le propriétaire tape dans la console : /use <run> ; /show diff-1 ; /approve commit ; alice ; <hash> ; /quit
    Alors la sortie contient "Commit approval"
    Et la sortie contient "Bound to the git tree"
    Et la sortie contient "passed"
    Et la sortie contient "proven"
    Et la sortie contient "APPROVE"
    Et la sortie contient "agents never commit"
    Et la sortie contient "Read this session"
    Et la sortie contient "✔ diff-1"
    Et la sortie contient "alice (via taskquoin console)"
    Et la sortie contient "Bound to the git tree" avant "Retype "
    Et le run est "completed"

  @sandbox
  Scénario: /run montre la progression avant le rapport du portail, et /status la frise des étapes
    Quand le propriétaire tape dans la console : /run Ajouter une fonction sum ; /quit
    Alors la sortie contient "started: planner" avant "Run run-"
    Et la sortie contient "plan  planned" avant "Run run-"
    Et la sortie contient "Plan approval"
    Et la sortie contient "waiting  "
    Quand le propriétaire tape dans la console : /use <run> ; /status ; /quit
    Alors la sortie contient "Planning"
    Et la sortie contient "Adversarial critique"
    Et la sortie contient "/show plan"
    Et la sortie ne contient pas "%"

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
