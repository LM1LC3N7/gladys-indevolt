// -----------------------------------------------------------------------------
// A fake Indevolt battery: the answers of Sys.GetConfig and Indevolt.GetData,
// shaped after indevolt-api and the Home Assistant integration (the keys and
// units of sensor.py). Invented values.
// -----------------------------------------------------------------------------

export const NOW = Date.parse('2026-10-20T12:00:00Z');
export const ADDRESS = '192.168.1.40:8080';
export const SERIAL = 'SF2000A1B2C3';

export const json = (body, { status = 200, headers = {} } = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

export const identity = ({ sn = SERIAL, type = 'CMS-SF2000', fw = 'V1.2.3' } = {}) => ({
  device: { sn, type, fw, mac: 'aa:bb:cc:dd:ee:ff' },
});

/** The values of a second-generation battery, by key (W, kWh, %, V, Hz, °C; 1505 and 11034 in Wh). */
export const VALUES = {
  606: 1002,
  7101: 1,
  2101: 0,
  2108: 450,
  667: 0,
  2107: 120.5,
  2104: 310.25,
  2105: 0,
  11034: 2500,
  6000: -450,
  6001: 1002,
  6002: 64,
  142: 2.2,
  6004: 1.1,
  6005: 2.3,
  6006: 400.5,
  6007: 350.75,
  6105: 10,
  1501: 820,
  1502: 3.4,
  1505: 1_234_000,
  1664: 400,
  1665: 420,
  1666: 0,
  1667: 0,
  11016: -120,
  2600: 231.4,
  2612: 50.01,
  8646: 152,
  11019: 0,
  11020: 175,
  9012: 23.5,
  11005: 31.2,
};

/** The keys asked by a GetData call (its `config` query). */
export const keysOf = (call) => JSON.parse(call.query.config).t;

/**
 * Routes of one battery. `values` and `who` may change between calls (the
 * test edits them).
 */
export function routes({ values = VALUES, who = identity() } = {}) {
  const state = { values: { ...values }, who };
  const r = {
    state,
    '/rpc/Sys.GetConfig': () => json(state.who),
    '/rpc/Indevolt.GetData': (call) => {
      const answer = {};
      for (const key of keysOf(call)) {
        if (Object.hasOwn(state.values, key)) {
          answer[key] = state.values[key];
        }
      }
      return json(answer);
    },
  };
  return r;
}
