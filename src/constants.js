// -----------------------------------------------------------------------------
// Constants shared by the integration. Every key stored by Gladys (actions,
// manifest keys, feature keys in src/devices.js) is forever: never rename one.
// -----------------------------------------------------------------------------

export const ACTIONS = { TEST: 'test_connection', ACCEPT_HELD: 'accept_held_index' };

/**
 * The external id of a battery: `battery:<serial>`, the serial its
 * `Sys.GetConfig` answer gives: a new IP address of the same battery keeps its
 * device and history.
 */
export const EXTERNAL_ID_TYPE = 'battery';

// --- The local HTTP API of the battery (as indevolt-api reads it) ----------------
export const DEFAULT_PORT = 8080;
export const PATHS = {
  /** GET: `{ device: { sn, type, fw, mac } }`, read before every read of the values. */
  CONFIG: '/rpc/Sys.GetConfig',
  /** POST `?config={"t":[...]}`: the values of the keys asked, `{ "<key>": value }`. */
  DATA: '/rpc/Indevolt.GetData',
};
/** The library asks for its keys 50 at a time (Home Assistant's batch size). */
export const KEYS_PER_REQUEST = 50;
/** The library waits up to 10 s for an answer. */
export const HTTP_TIMEOUT = 10_000;
/** The answers are a few hundred bytes: more is not an Indevolt answer. */
export const MAX_BODY_BYTES = 64 * 1024;

// --- Discovery: the batteries announce themselves on the network -----------------
/** Passive discovery: a `BCF-D` datagram broadcast by the battery on UDP 8099. */
export const DISCOVERY_PORT = 8099;
export const DISCOVERY_MAGIC = 'BCF-D';
/** How long the Gladys core listens for the announcements (s). */
export const DISCOVERY_SECONDS = 10;

// --- Limits --------------------------------------------------------------------------
/** Batteries read by one integration (typed, discovered or created). */
export const MAX_BATTERIES = 6;

// --- Schedule ------------------------------------------------------------------------
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
/** The reading interval of the form (s): 30 s as Home Assistant, 30 to 300. */
export const POLL_DEFAULT = 30;
export const POLL_MIN = 30;
export const POLL_MAX = 300;
/**
 * Batteries read at each interval: with more, each battery is read every two
 * intervals (four to six batteries), so that six stay within the 300 states a
 * minute of Gladys. Reads only happen at the ticks of the interval.
 */
export const BATTERIES_PER_INTERVAL = 3;
/** The states sent in any 60 s, at most (the core refuses a whole batch beyond 300). */
export const STATES_PER_MINUTE = 270;
/** The second click of "Accept the held index" counts only this long after the first. */
export const ACCEPT_CONFIRM_AFTER = 3 * SECOND;
/** An unreachable battery: tried again after 1 min (never faster than a read), doubled up to 15 min. */
export const RETRY_MIN = MINUTE;
export const RETRY_MAX = 15 * MINUTE;
/** HTTP 429 or 5xx: a pause from 60 s to 6 h, kept in /data. */
export const PAUSE_MIN = MINUTE;
export const PAUSE_MAX = 6 * HOUR;
/** Unchanged values are sent again after this delay (publishChangedStates heartbeat). */
export const STATE_HEARTBEAT = 10 * MINUTE;
/** The test button answers within this delay. */
export const TEST_ANSWER_WITHIN = 25 * SECOND;
/** The second click of "Accept the held index" must come within this delay of the first. */
export const ACCEPT_CONFIRM_WITHIN = 5 * MINUTE;

// --- Energy indexes -------------------------------------------------------------------
/**
 * The guard of an index (src/guard.js), by generation: no Indevolt battery
 * charges, discharges, delivers or produces more than this on average between
 * two reads. The library gives the first generation 1.2 kW of charge and
 * 0.8 kW of discharge, the second 10.8 kW: a little margin on top.
 */
export const INDEX_MAX_KW = { 1: 2, 2: 12 };
/** kWh always accepted on top of INDEX_MAX_KW × hours (rounding, a late read). */
export const INDEX_SLACK_KWH = 0.5;

/** A power above this (W) is a glitch. */
export const POWER_MAX = 100_000;
/** A lifetime counter above this (kWh) is a glitch. */
export const ENERGY_MAX = 10_000_000;
/** A counter of the day above this (kWh) is a glitch. */
export const DAY_ENERGY_MAX = 2_000;
