# language: fr
Fonctionnalité: Juges par API — n'importe quelle IA compatible OpenAI relit le diff, en texte seul
  Un juge `runtime: api` reçoit seulement ce qu'on lui envoie (jamais un secret ni un binaire), rend un verdict, et
  chaque relecteur listé doit approuver. Le fournisseur est autorisé par le projet (taskquoin.yaml) ; la clé reste
  dans l'environnement.

  Contexte:
    Soit un dépôt git "calc" dont le test "sum" échoue tant que sum.js n'existe pas
    Et Taskquoin initialisé dans ce dépôt, mémoire désactivée
    Et le propriétaire de test a accepté le risque "connector.write" pour l'agent "challenger"

  @sandbox
  Scénario: Un juge de sécurité par API approuve : le commit nomme les deux relecteurs
    Soit un juge de sécurité "security" servi par un fournisseur local qui approuve
    Quand le propriétaire lance la demande "Ajouter une fonction sum"
    Et le propriétaire approuve en tant que "alice"
    Alors le run attend l'approbation "approve-commit"
    Et l'artefact "review-1" contient "## security (api: 127.0.0.1"
    Et le fournisseur local a reçu 1 requête
    Et aucune requête reçue par le fournisseur ne contient "Read the repository"
    Quand le propriétaire approuve en tant que "alice"
    Alors le run est "completed"
    Et le dernier commit de la branche du run contient "Reviewed-By: challenger (codex), security (api: 127.0.0.1"

  @sandbox
  Scénario: Un juge par API qui refuse toujours rend la main à l'humain en le nommant
    Soit un juge de sécurité "security" servi par un fournisseur local qui refuse
    Quand le propriétaire lance la demande "Ajouter une fonction sum"
    Et le propriétaire approuve en tant que "alice"
    Alors le run est "needs-human" avec la raison contenant "review still requests changes after 3 attempts — security"
    Et aucun commit n'a été créé sur la branche du run

  Scénario: Sans la clé du fournisseur, le run ne démarre même pas
    Soit un juge de sécurité "security" servi par un fournisseur local qui approuve
    Et la clé du fournisseur est absente
    Quand le propriétaire lance la demande "Ajouter une fonction sum"
    Alors la commande échoue avec un message contenant "FAKE_PROVIDER_KEY is missing"
    Et le fournisseur local a reçu 0 requête

  @sandbox
  Scénario: Un secret et un binaire modifiés ne sont jamais envoyés au juge
    Soit un juge de sécurité "security" servi par un fournisseur local qui approuve
    Quand le propriétaire lance la demande "Ajouter une fonction sum avec SECRET-ET-BINAIRE"
    Et le propriétaire approuve en tant que "alice"
    Alors le run attend l'approbation "approve-commit"
    Et les requêtes reçues par le fournisseur contiennent "[fichier secret modifié : .env.local — contenu non envoyé]"
    Et les requêtes reçues par le fournisseur contiennent "[changement binaire : logo.bin]"
    Et aucune requête reçue par le fournisseur ne contient "CANARY-JUDGE-5511"
    Et l'artefact "diff-1" contient "CANARY-JUDGE-5511"

  @sandbox
  Scénario: Une panne du fournisseur laisse un run reprenable, sans redemander à Codex
    Soit un juge de sécurité "security" servi par un fournisseur local qui est en panne
    Quand le propriétaire lance la demande "Ajouter une fonction sum"
    Et le propriétaire approuve en tant que "alice"
    Alors le run est "interrupted" avec la raison contenant "HTTP 503"
    Et le fournisseur local a reçu 3 requêtes
    Quand le fournisseur local se met à approuver
    Et le propriétaire reprend le run
    Alors le run attend l'approbation "approve-commit"
    Et le fournisseur local a reçu 4 requêtes

  @sandbox
  Scénario: Une clé retirée avant l'approbation du plan bloque l'approbation sans rien changer au run
    Soit un juge de sécurité "security" servi par un fournisseur local qui approuve
    Quand le propriétaire lance la demande "Ajouter une fonction sum"
    Alors le run attend l'approbation "approve-plan"
    Soit la clé du fournisseur est absente
    Quand le propriétaire approuve le plan sans vérifier le résultat
    Alors la sortie d'erreur contient "FAKE_PROVIDER_KEY is missing"
    Et le run attend l'approbation "approve-plan"
    Et le fournisseur local a reçu 0 requête

  @sandbox
  Scénario: Un juge par API peut être le seul critique et le seul relecteur ; status montre à qui le code est envoyé
    Soit un juge de sécurité "security" servi par un fournisseur local qui approuve
    Et le juge "security" est le seul critique et le seul relecteur, sans agent challenger
    Quand le propriétaire lance la demande "Ajouter une fonction sum"
    Et le propriétaire approuve en tant que "alice"
    Alors le run attend l'approbation "approve-commit"
    Et le fournisseur local a reçu 2 requêtes
    Quand le propriétaire consulte le run
    Alors la sortie contient "Judges: security (api: 127.0.0.1"
