// -----------------------------------------------------------------------------
// The answers of an Indevolt battery -> our values. Pure.
//
// The keys ("cJson points") and their meaning come from indevolt-api (Xirt,
// MIT, `indevolt_api/const.py`), the units and the keys read per generation
// from the Home Assistant integration (Apache-2.0, `sensor.py`, `const.py`):
// the values are already in their unit (W, kWh, %, V, Hz, °C), except the
// two counters Home Assistant declares in Wh (1505 and 11034).
//
// Hostile answers: only own keys are read (never the prototype), only finite
// numbers (or strings of digits) are taken, every value is checked against a
// range; anything else is left out, never read as 0.
// -----------------------------------------------------------------------------

import { DAY_ENERGY_MAX, ENERGY_MAX, POWER_MAX } from '../constants.js';

/** The models the library counts as the second generation (Sys.GetConfig `device.type`). */
export const GEN2_TYPES = new Set([
  'CMS-SP2000',
  'CMS-SF2000',
  'CMS-SP3000',
  'CMS-SF3000',
  'CMS-SF1200',
]);

/** The keys read (indevolt_api/const.py), by name. */
export const KEY = {
  /** The serial, also in the values: a check that the same battery answered both requests. */
  SERIAL_NUMBER: 0,
  OPERATING_MODE: 606,
  ENERGY_MODE: 7101,
  AC_INPUT_POWER: 2101,
  AC_OUTPUT_POWER: 2108,
  BYPASS_POWER: 667,
  TOTAL_INPUT_ENERGY: 2107,
  TOTAL_OUTPUT_ENERGY: 2104,
  OFF_GRID_OUTPUT_ENERGY: 2105,
  BYPASS_INPUT_ENERGY_WH: 11034,
  HEATING_STATE: 7121,
  BATTERY_POWER: 6000,
  BATTERY_STATE: 6001,
  SOC: 6002,
  RATED_CAPACITY: 142,
  DAILY_CHARGING: 6004,
  DAILY_DISCHARGING: 6005,
  TOTAL_CHARGING: 6006,
  TOTAL_DISCHARGING: 6007,
  REMAINING_CHARGING_TIME: 11019,
  REMAINING_DISCHARGING_TIME: 11020,
  DISCHARGE_LIMIT: 6105,
  PV_POWER: 1501,
  PV_DAILY: 1502,
  PV_TOTAL_WH: 1505,
  PV_POWER_1: 1664,
  PV_POWER_2: 1665,
  PV_POWER_3: 1666,
  PV_POWER_4: 1667,
  METER_POWER_GEN1: 21028,
  METER_POWER_GEN2: 11016,
  GRID_VOLTAGE: 2600,
  GRID_FREQUENCY: 2612,
  CYCLES_GEN2: 8646,
  GEN1_INVERTER_TEMPERATURE: 7600,
  GEN1_PACK_TEMPERATURE: 7605,
  GEN2_MAIN_TEMPERATURE: 9012,
  GEN2_TRANSFORMER_TEMPERATURE: 11005,
};

const COMMON = [
  KEY.SERIAL_NUMBER,
  KEY.OPERATING_MODE,
  KEY.ENERGY_MODE,
  KEY.AC_INPUT_POWER,
  KEY.AC_OUTPUT_POWER,
  KEY.BYPASS_POWER,
  KEY.TOTAL_INPUT_ENERGY,
  KEY.TOTAL_OUTPUT_ENERGY,
  KEY.OFF_GRID_OUTPUT_ENERGY,
  KEY.BYPASS_INPUT_ENERGY_WH,
  KEY.BATTERY_POWER,
  KEY.BATTERY_STATE,
  KEY.SOC,
  KEY.RATED_CAPACITY,
  KEY.DAILY_CHARGING,
  KEY.DAILY_DISCHARGING,
  KEY.TOTAL_CHARGING,
  KEY.TOTAL_DISCHARGING,
  KEY.DISCHARGE_LIMIT,
  KEY.PV_POWER,
  KEY.PV_DAILY,
  KEY.PV_TOTAL_WH,
  KEY.PV_POWER_1,
  KEY.PV_POWER_2,
];

/** The keys read from a battery of each generation (one request each: fewer than 50). */
export const KEYS = {
  1: [
    ...COMMON,
    KEY.METER_POWER_GEN1,
    KEY.HEATING_STATE,
    KEY.GEN1_INVERTER_TEMPERATURE,
    KEY.GEN1_PACK_TEMPERATURE,
  ],
  2: [
    ...COMMON,
    KEY.PV_POWER_3,
    KEY.PV_POWER_4,
    KEY.METER_POWER_GEN2,
    KEY.GRID_VOLTAGE,
    KEY.GRID_FREQUENCY,
    KEY.CYCLES_GEN2,
    KEY.REMAINING_CHARGING_TIME,
    KEY.REMAINING_DISCHARGING_TIME,
    KEY.GEN2_MAIN_TEMPERATURE,
    KEY.GEN2_TRANSFORMER_TEMPERATURE,
  ],
};

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** A number the battery sent: a finite number, or a string of a plain decimal number. */
export function num(v) {
  if (typeof v === 'number') {
    return Number.isFinite(v) ? v : undefined;
  }
  if (typeof v === 'string' && /^-?\d{1,12}(\.\d{1,9})?$/.test(v.trim())) {
    return Number(v.trim());
  }
  return undefined;
}

const SERIAL = /^[A-Za-z0-9_-]{4,40}$/;
const MODEL = /^[A-Za-z0-9][A-Za-z0-9 ._-]{0,39}$/;
const FIRMWARE = /^[A-Za-z0-9][A-Za-z0-9 ._+-]{0,39}$/;

/**
 * Sys.GetConfig -> `{ serial, model, generation, firmware }`, or undefined
 * when it is not an Indevolt answer (no serial of a plausible shape). The
 * model and firmware are dropped, not kept, when their shape is odd.
 */
/**
 * The serial a GetData answer gives (key 0), when it has a plausible shape;
 * undefined otherwise (its format is not documented: an odd one is ignored).
 */
export function serialOfValues(raw) {
  if (!isObject(raw) || !Object.hasOwn(raw, '0')) {
    return undefined;
  }
  const value = raw['0'];
  const text = typeof value === 'string' ? value.trim() : '';
  return SERIAL.test(text) ? text : undefined;
}

export function parseIdentity(answer) {
  const device = isObject(answer) && Object.hasOwn(answer, 'device') ? answer.device : undefined;
  if (!isObject(device) || !Object.hasOwn(device, 'sn')) {
    return undefined;
  }
  const serial = typeof device.sn === 'string' ? device.sn.trim() : String(num(device.sn) ?? '');
  if (!SERIAL.test(serial)) {
    return undefined;
  }
  const type =
    Object.hasOwn(device, 'type') && typeof device.type === 'string' ? device.type.trim() : '';
  const fw = Object.hasOwn(device, 'fw') && typeof device.fw === 'string' ? device.fw.trim() : '';
  const model = MODEL.test(type) ? type : undefined;
  return {
    serial,
    model,
    // As the library: the five models it lists are generation 2, any other one is 1.
    generation: model && GEN2_TYPES.has(model) ? 2 : 1,
    firmware: FIRMWARE.test(fw) ? fw : undefined,
  };
}

/** The value of `key` in a GetData answer, a number within [min, max], else undefined. */
function read(raw, key, min, max) {
  const name = String(key);
  if (!Object.hasOwn(raw, name)) {
    return undefined;
  }
  const v = num(raw[name]);
  return v !== undefined && v >= min && v <= max ? v : undefined;
}

/** Whether a GetData answer has at least one of the keys asked (an Indevolt answer). */
export function hasAnyKey(raw, keys) {
  return isObject(raw) && keys.some((k) => Object.hasOwn(raw, String(k)));
}

/** A code among `codes` -> its index (0, 1, 2...), else undefined. */
const codeOf = (value, codes) => {
  const i = codes.indexOf(value);
  return i === -1 ? undefined : i;
};

const kwhOfWh = (wh) => (wh === undefined ? undefined : wh / 1000);

/**
 * A GetData answer -> `{ name: number }` (only what came, checked), for a
 * battery of `generation`. Powers in W, energies in kWh, durations in min.
 */
export function parseValues(raw, generation) {
  if (!isObject(raw)) {
    return {};
  }
  const power = (k) => read(raw, k, -POWER_MAX, POWER_MAX);
  const positivePower = (k) => read(raw, k, 0, POWER_MAX);
  const total = (k) => read(raw, k, 0, ENERGY_MAX);
  const day = (k) => read(raw, k, 0, DAY_ENERGY_MAX);
  const temperature = (k) => read(raw, k, -40, 120);
  const v = {};

  v.soc = read(raw, KEY.SOC, 0, 100);
  v.batteryPower = power(KEY.BATTERY_POWER);
  // 1000 static, 1001 charging, 1002 discharging (Home Assistant) -> 0, 1, 2.
  v.batteryState = codeOf(read(raw, KEY.BATTERY_STATE, 0, 1e6), [1000, 1001, 1002]);
  // Charge and discharge powers from the state, whatever the sign of the power.
  if (v.batteryState !== undefined && v.batteryPower !== undefined) {
    const magnitude = Math.abs(v.batteryPower);
    v.chargePower = v.batteryState === 1 ? magnitude : 0;
    v.dischargePower = v.batteryState === 2 ? magnitude : 0;
  }
  v.energyMode = read(raw, KEY.ENERGY_MODE, 0, 5);
  if (![0, 1, 4, 5].includes(v.energyMode)) {
    v.energyMode = undefined;
  }
  // 1000 main, 1001 sub, 1002 standalone -> 0, 1, 2.
  v.operatingMode = codeOf(read(raw, KEY.OPERATING_MODE, 0, 1e6), [1000, 1001, 1002]);
  v.acInputPower = positivePower(KEY.AC_INPUT_POWER);
  v.acOutputPower = positivePower(KEY.AC_OUTPUT_POWER);
  v.bypassPower = power(KEY.BYPASS_POWER);
  v.totalAcInput = total(KEY.TOTAL_INPUT_ENERGY);
  v.totalAcOutput = total(KEY.TOTAL_OUTPUT_ENERGY);
  v.offGridEnergy = total(KEY.OFF_GRID_OUTPUT_ENERGY);
  v.bypassEnergy = kwhOfWh(read(raw, KEY.BYPASS_INPUT_ENERGY_WH, 0, ENERGY_MAX * 1000));
  v.ratedCapacity = read(raw, KEY.RATED_CAPACITY, 0, 1000);
  v.dayCharged = day(KEY.DAILY_CHARGING);
  v.dayDischarged = day(KEY.DAILY_DISCHARGING);
  v.totalCharged = total(KEY.TOTAL_CHARGING);
  v.totalDischarged = total(KEY.TOTAL_DISCHARGING);
  v.dischargeLimit = read(raw, KEY.DISCHARGE_LIMIT, 0, 100);
  v.pvPower = positivePower(KEY.PV_POWER);
  v.dayPv = day(KEY.PV_DAILY);
  v.pvEnergy = kwhOfWh(read(raw, KEY.PV_TOTAL_WH, 0, ENERGY_MAX * 1000));
  v.pvPower1 = positivePower(KEY.PV_POWER_1);
  v.pvPower2 = positivePower(KEY.PV_POWER_2);
  if (generation === 2) {
    v.pvPower3 = positivePower(KEY.PV_POWER_3);
    v.pvPower4 = positivePower(KEY.PV_POWER_4);
    v.meterPower = power(KEY.METER_POWER_GEN2);
    v.gridVoltage = read(raw, KEY.GRID_VOLTAGE, 0, 1000);
    v.gridFrequency = read(raw, KEY.GRID_FREQUENCY, 0, 100);
    v.cycles = read(raw, KEY.CYCLES_GEN2, 0, 1e6);
    v.remainingCharge = read(raw, KEY.REMAINING_CHARGING_TIME, 0, 1e6);
    v.remainingDischarge = read(raw, KEY.REMAINING_DISCHARGING_TIME, 0, 1e6);
    v.temperature = temperature(KEY.GEN2_MAIN_TEMPERATURE);
    v.inverterTemperature = temperature(KEY.GEN2_TRANSFORMER_TEMPERATURE);
  } else {
    v.meterPower = power(KEY.METER_POWER_GEN1);
    v.temperature = temperature(KEY.GEN1_PACK_TEMPERATURE);
    // A 0 °C with the heating off is the "idle" placeholder of the firmware
    // (Home Assistant hides it), never a temperature.
    const inverter = temperature(KEY.GEN1_INVERTER_TEMPERATURE);
    const heating = read(raw, KEY.HEATING_STATE, 0, 1e6);
    v.inverterTemperature = inverter === 0 && heating !== 1000 ? undefined : inverter;
  }
  for (const name of Object.keys(v)) {
    if (v[name] === undefined) {
      delete v[name];
    }
  }
  return v;
}
