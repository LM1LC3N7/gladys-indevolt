// -----------------------------------------------------------------------------
// Runtime texts shown in Gladys. Every text is a { en, fr } object. They never
// quote a text of the battery: only our own words, error codes, addresses
// and serials.
// -----------------------------------------------------------------------------

const seconds = (ms) => Math.max(1, Math.round(ms / 1000));
const minutes = (ms) => Math.max(1, Math.round(ms / 60_000));
const hours = (ms) => Math.max(1, Math.round(ms / 3_600_000));
export const delay = (ms) => {
  if (ms >= 2 * 3_600_000) return { en: `${hours(ms)} h`, fr: `${hours(ms)} h` };
  if (ms >= 60_000) return { en: `${minutes(ms)} min`, fr: `${minutes(ms)} min` };
  return { en: `${seconds(ms)} s`, fr: `${seconds(ms)} s` };
};

/** Our words for an error code of src/indevolt/client.js. */
const REASON = {
  timeout: { en: 'no answer', fr: 'pas de réponse' },
  unreachable: { en: 'unreachable', fr: 'injoignable' },
  http: { en: 'HTTP error', fr: 'erreur HTTP' },
  server: { en: 'error of the battery', fr: 'erreur de la batterie' },
  rate_limited: { en: 'too many requests', fr: 'trop de requêtes' },
  too_large: { en: 'answer too large', fr: 'réponse trop grande' },
  not_json: { en: 'answer that is not data', fr: 'réponse qui n’est pas une donnée' },
  unknown_answer: {
    en: 'not an Indevolt answer (is the local API of the battery turned on?)',
    fr: 'réponse qui n’est pas celle d’une Indevolt (l’API locale de la batterie est-elle activée ?)',
  },
};

export function reason(err) {
  const text = REASON[err?.code] ?? { en: 'unexpected error', fr: 'erreur inattendue' };
  const status =
    (err?.code === 'http' || err?.code === 'server') && Number.isInteger(err.status)
      ? ` ${err.status}`
      : '';
  return { en: `${text.en}${status}`, fr: `${text.fr}${status}` };
}

const INDEX = {
  charged: { en: 'charged energy index', fr: 'index d’énergie chargée' },
  discharged: { en: 'discharged energy index', fr: 'index d’énergie déchargée' },
  output: { en: 'AC output energy index', fr: 'index d’énergie de sortie AC' },
  offGrid: { en: 'off-grid output energy index', fr: 'index d’énergie de sortie hors réseau' },
  pv: { en: 'solar production index', fr: 'index de production solaire' },
};

const kwh = (value) => Math.round(value * 1000) / 1000;

const sentences = (lang, list) => list.map((n) => n[lang]).join(' ');
const both = (list) => ({ en: sentences('en', list), fr: sentences('fr', list) });

/** "<battery> <index>: from → to" in our words, for a held index. */
const heldLine = ({ label, name, direction, from, to }) =>
  direction === 'down'
    ? {
        en: `${label}, ${INDEX[name].en}: dropped from ${kwh(from)} to ${kwh(to)} kWh, held back (the last accepted value is sent again).`,
        fr: `${label}, ${INDEX[name].fr} : baisse de ${kwh(from)} à ${kwh(to)} kWh, retenue (la dernière valeur acceptée est renvoyée).`,
      }
    : {
        en: `${label}, ${INDEX[name].en}: jumped from ${kwh(from)} to ${kwh(to)} kWh, held back (not sent to the energy monitoring).`,
        fr: `${label}, ${INDEX[name].fr} : saut de ${kwh(from)} à ${kwh(to)} kWh, retenu (non envoyé au suivi énergétique).`,
      };

export const T = {
  notConfigured: {
    en: 'No Indevolt battery yet: open the "Discover" tab (the batteries announce themselves on the network), or type their IP addresses in the configuration.',
    fr: 'Aucune batterie Indevolt pour l’instant : ouvrez l’onglet « Découverte » (les batteries s’annoncent sur le réseau), ou saisissez leurs adresses IP dans la configuration.',
  },
  badAddresses: (list) => ({
    en: `These addresses are not valid and are ignored: ${list.join(', ')}. Enter IP addresses or host names, with an optional port (e.g. 192.168.1.40, 192.168.1.41:8080).`,
    fr: `Ces adresses ne sont pas valides et sont ignorées : ${list.join(', ')}. Saisissez des adresses IP ou des noms d’hôte, avec un port éventuel (ex. 192.168.1.40, 192.168.1.41:8080).`,
  }),
  connecting: {
    en: 'Reading the Indevolt batteries…',
    fr: 'Lecture des batteries Indevolt…',
  },
  /** One battery that does not answer: its address, our reason, the next try. */
  failing: (address, err, wait) => ({
    en: `${address} could not be read (${reason(err).en}): new try in ${delay(wait).en}.`,
    fr: `${address} n’a pas pu être lue (${reason(err).fr}) : nouvel essai dans ${delay(wait).fr}.`,
  }),
  /** HTTP 429 or 5xx: a pause, kept across restarts. */
  paused: (address, pause, wait) => ({
    en: `${address} asks to wait (${reason(pause).en}): reads paused, new try in ${delay(wait).en}.`,
    fr: `${address} demande d’attendre (${reason(pause).fr}) : lectures en pause, nouvel essai dans ${delay(wait).fr}.`,
  }),
  /** `answering` batteries out of `total`; `notes`: { en, fr } texts after it. */
  status: (answering, total, notes = []) => {
    const first =
      answering > 0
        ? {
            en: `${answering} of ${total} Indevolt batter${total > 1 ? 'ies' : 'y'} answering.`,
            fr: `${answering} batterie${answering > 1 ? 's' : ''} Indevolt sur ${total} répond${answering > 1 ? 'ent' : ''}.`,
          }
        : {
            en: `No Indevolt battery answers (${total} known).`,
            fr: `Aucune batterie Indevolt ne répond (${total} connue${total > 1 ? 's' : ''}).`,
          };
    return both([first, ...notes]);
  },
  notes: {
    noDevice: (count) =>
      count > 1
        ? {
            en: `${count} batteries found without their device: create them from the "Discover" tab to receive their values.`,
            fr: `${count} batteries trouvées sans leur appareil : créez-les depuis l’onglet « Découverte » pour recevoir leurs valeurs.`,
          }
        : {
            en: 'A battery found without its device: create it from the "Discover" tab to receive its values.',
            fr: 'Une batterie trouvée sans son appareil : créez-le depuis l’onglet « Découverte » pour recevoir ses valeurs.',
          },
    /** `held`: [{ label, name, direction, from, to }]. */
    held: (held) =>
      both([
        ...held.map(heldLine),
        {
          en: 'If it is right, click "Accept the held index" twice in the configuration of the integration (the first click lists, the second accepts exactly what was listed). Saving the configuration accepts nothing.',
          fr: 'Si c’est juste, cliquez deux fois sur « Accepter l’index retenu » dans la configuration de l’intégration (le premier clic liste, le second accepte exactement ce qui a été listé). Enregistrer la configuration n’accepte rien.',
        },
      ]),
  },
  accept: {
    nothing: {
      en: 'No index is held back: nothing to accept.',
      fr: 'Aucun index n’est retenu : rien à accepter.',
    },
    /** First click: what a second click would accept. */
    confirm: (held, within) =>
      both([
        {
          en: 'A second click accepts exactly these values:',
          fr: 'Un second clic accepte exactement ces valeurs :',
        },
        ...held.map((h) =>
          h.direction === 'down'
            ? {
                en: `${h.label}, ${INDEX[h.name].en}: ${kwh(h.from)} → ${kwh(h.to)} kWh (a drop: 0 kWh counted).`,
                fr: `${h.label}, ${INDEX[h.name].fr} : ${kwh(h.from)} → ${kwh(h.to)} kWh (une baisse : 0 kWh compté).`,
              }
            : {
                en: `${h.label}, ${INDEX[h.name].en}: ${kwh(h.from)} → ${kwh(h.to)} kWh (${kwh(h.to - h.from)} kWh counted at once).`,
                fr: `${h.label}, ${INDEX[h.name].fr} : ${kwh(h.from)} → ${kwh(h.to)} kWh (${kwh(h.to - h.from)} kWh comptés d’un coup).`,
              },
        ),
        {
          en: `Click "Accept the held index" again, after a few seconds and within ${delay(within).en}, to accept them; accept only if this energy was real.`,
          fr: `Cliquez de nouveau sur « Accepter l’index retenu », après quelques secondes et dans les ${delay(within).fr}, pour les accepter ; n’acceptez que si cette énergie est réelle.`,
        },
      ]),
    /** Second click: `accepted` and `changed` are lists of held entries. */
    done: (accepted, changed) =>
      both([
        ...accepted.map((h) => ({
          en: `Accepted: ${h.label}, ${INDEX[h.name].en} ${kwh(h.to)} kWh, sent at the next read.`,
          fr: `Accepté : ${h.label}, ${INDEX[h.name].fr} ${kwh(h.to)} kWh, envoyé à la prochaine lecture.`,
        })),
        ...(changed.length > 0
          ? [
              {
                en: `Not accepted, the value changed since the first click: ${changed.map((h) => `${h.label}, ${INDEX[h.name].en}`).join('; ')}. Click again to list it.`,
                fr: `Non accepté, la valeur a changé depuis le premier clic : ${changed.map((h) => `${h.label}, ${INDEX[h.name].fr}`).join(' ; ')}. Cliquez de nouveau pour la lister.`,
              },
            ]
          : []),
        { en: 'A different value stays held.', fr: 'Une autre valeur reste retenue.' },
      ]),
  },
  test: {
    none: {
      en: 'No battery to test: type an address in the configuration, or open the "Discover" tab.',
      fr: 'Aucune batterie à tester : saisissez une adresse dans la configuration, ou ouvrez l’onglet « Découverte ».',
    },
    ok: (address, identity) => ({
      en: `${address}: Indevolt ${identity.model ?? '?'}, serial ${identity.serial}${identity.firmware ? `, firmware ${identity.firmware}` : ''} (generation ${identity.generation}).`,
      fr: `${address} : Indevolt ${identity.model ?? '?'}, numéro de série ${identity.serial}${identity.firmware ? `, firmware ${identity.firmware}` : ''} (génération ${identity.generation}).`,
    }),
    failed: (address, err) => ({
      en: `${address}: ${reason(err).en}.`,
      fr: `${address} : ${reason(err).fr}.`,
    }),
    waiting: (address, wait) => ({
      en: `${address}: paused, not asked (new try in ${delay(wait).en}).`,
      fr: `${address} : en pause, non interrogée (nouvel essai dans ${delay(wait).fr}).`,
    }),
    slow: {
      en: 'The batteries are slow to answer: look at the integration status in a minute.',
      fr: 'Les batteries tardent à répondre : regardez l’état de l’intégration dans une minute.',
    },
    lines: (lines) => both(lines),
  },
};
