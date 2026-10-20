# Indevolt

Intégration **non officielle**, sans lien avec Indevolt. Elle lit vos
batteries domestiques **Indevolt** (SolidFlex, PowerFlex, BK1600…) sur votre
réseau local, par leur API locale (HTTP, port 8080), sans cloud ni compte.

**Jamais testé avec un vrai appareil** : l'intégration a été écrite d'après la
bibliothèque [indevolt-api](https://github.com/Xirt/indevolt-api) utilisée par
Home Assistant, sans batterie Indevolt sous la main. Le protocole local n'est
pas documenté par Indevolt. Vos retours sont les bienvenus.

## Lecture seule

L'intégration **ne fait que lire**. Elle ne lance jamais de charge ni de
décharge, ne change jamais le mode d'énergie, la réserve de secours ou une
limite de puissance. Le mode d'énergie et la réserve sont affichés, pas
modifiables : utilisez l'application Indevolt pour les changer.

## Ce que vous obtenez

Un appareil par batterie, identifié par son numéro de série (une nouvelle
adresse IP garde l'appareil et son historique) :

- niveau de charge (%), puissances de charge et de décharge (W), puissance
  de la batterie (W, signée), état (0 = au repos, 1 = en charge, 2 = en
  décharge) ;
- puissance solaire totale et par entrée (W), puissance de sortie AC vers la
  maison (W), puissance d'entrée AC, puissance de bypass, puissance du
  compteur (W, signe non documenté) ;
- tension et fréquence du réseau (2e génération), températures de la batterie
  et de l'onduleur ;
- mode d'énergie (0 = portable/extérieur, 1 = autoconsommation, 4 = pilotage
  temps réel, 5 = programme), mode de fonctionnement (0 = principal,
  1 = secondaire, 2 = autonome), capacité nominale, réserve de secours, cycles
  et temps restants (2e génération) ;
- les compteurs du jour (solaire, chargé, déchargé) en capteurs simples ;
- **cinq index d'énergie** pour le suivi énergétique de Gladys : énergie
  chargée et déchargée, énergie de sortie AC, énergie de sortie hors réseau,
  production solaire (avec sa production par demi-heure, calculée par
  Gladys).

La batterie ne mesure pas ce que la maison prend au réseau : l'intégration ne
crée **aucun index de consommation** facturé.

## Prérequis

- Gladys 5.2.0 ou plus récent.
- La batterie sur le même réseau que Gladys, son API locale joignable sur le
  port 8080.

## Configuration

1. Installez l'intégration depuis le store de Gladys.
2. Ouvrez l'onglet **Découverte** : les batteries s'annoncent sur le réseau
   (diffusion UDP sur le port 8099, écoutée par Gladys). Ou saisissez leurs
   adresses IP dans **Adresses IP des batteries**, séparées par des virgules
   (avec `:port` seulement si ce n'est pas 8080), six au plus.
3. Créez l'appareil de chaque batterie depuis l'onglet **Découverte**.
4. **Intervalle de lecture** : 30 s par défaut (comme Home Assistant), de 30 à
   300 s. Au-delà de trois batteries, chacune est lue un peu moins souvent
   (10 s par batterie), pour rester sous les 300 états par minute de Gladys.

Le bouton **Tester la connexion** demande une fois à chaque batterie son
modèle, son numéro de série et son firmware.

## Index d'énergie retenus

Gladys compte chaque hausse d'un index en entier. Pour ne jamais compter une
énergie fictive, chaque index passe par une garde :

- une valeur à 0 n'est jamais envoyée (un index hors réseau jamais utilisé
  reste vide) ;
- une baisse, ou une hausse plus rapide que 15 kW en moyenne, est **retenue** :
  la dernière valeur acceptée est renvoyée, et l'état de l'intégration
  l'affiche. Ni le temps ni la répétition ne la confirment ;
- si elle est juste, cliquez **deux fois** sur **Accepter l'index retenu** :
  le premier clic liste ce qui est retenu sans rien accepter, le second, dans
  les 5 minutes, accepte exactement ce qui a été listé (un saut est alors
  compté d'un coup, une baisse ne compte rien). Si la valeur a bougé entre les
  deux clics, elle n'est pas acceptée : recommencez. Enregistrer la
  configuration n'accepte rien.

## Erreurs

- Une batterie injoignable est réessayée après 1 minute, puis 2, jusqu'à
  15 minutes, jamais plus vite que l'intervalle de lecture.
- Une réponse HTTP 429 ou 5xx met la batterie en pause de 1 minute à 6 heures,
  gardée dans `/data` après un redémarrage.
- Enregistrer la configuration relance tout de suite les lectures.
- Si une autre batterie répond à une adresse (changement d'adresse DHCP), ses
  valeurs vont dans son propre appareil, jamais dans celui de la précédente.

## Confidentialité

Rien ne sort de votre réseau : l'intégration ne parle qu'aux batteries, en
HTTP local. L'API locale de la batterie ne demande aucun identifiant.
