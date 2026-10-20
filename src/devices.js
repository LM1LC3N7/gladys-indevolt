// -----------------------------------------------------------------------------
// The Gladys device of an Indevolt battery and its states. Pure.
//
// External id (forever): battery:<serial>, the serial of Sys.GetConfig.
// Feature keys (forever): see FEATURE below.
//
// Energy rules of the Gladys core (server/utils/constants.js, the comments of
// DEVICE_FEATURE_TYPES, and the lot 6 rules of this project):
// - the cumulative counters of the battery are the indexes: charged and
//   discharged energy (`battery-storage` / `charge-index`, `discharge-index`),
//   energy delivered to the home and on the backup output
//   (`home-output-sensor` / `index`, `off-grid-index`) and the solar
//   production (`energy-production-sensor` / `index`, with its
//   `thirty-minutes-production` declared here, ids computed (UUID v5) so an
//   "Update" in Discovery keeps the same rows; the integration never publishes
//   that one). Every index goes through the guard (src/guard.js): never 0, a
//   jump or a drop held until the user accepts it;
// - the battery measures no grid import: there is NO `energy-sensor` / `index`
//   (nothing billed), no `daily-consumption`, never publishEnergyConsumption;
// - the counters of the day and the AC input and bypass counters are plain
//   sensors, kWh in the name: never an index;
// - the meter power, whose sign is not documented, and every signed power are
//   plain sensors, W in the name;
// - units: only the ones the core lists for the category
//   (DEVICE_FEATURE_UNITS_BY_CATEGORY): %, W, kWh for battery-storage, W, kWh
//   for home-output-sensor and energy-production-sensor, V for energy-sensor,
//   °C for device-temperature-sensor, none for unknown (the unit is then in
//   the name).
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { DAY_ENERGY_MAX, ENERGY_MAX, EXTERNAL_ID_TYPE, POWER_MAX } from './constants.js';

/** Feature keys (forever). */
export const FEATURE = {
  SOC: 'soc',
  CHARGE_POWER: 'charge_power',
  DISCHARGE_POWER: 'discharge_power',
  BATTERY_POWER: 'battery_power',
  BATTERY_STATE: 'battery_state',
  CHARGED_ENERGY: 'charged_energy',
  DISCHARGED_ENERGY: 'discharged_energy',
  OUTPUT_POWER: 'output_power',
  OUTPUT_ENERGY: 'output_energy',
  OFF_GRID_ENERGY: 'off_grid_energy',
  INPUT_POWER: 'input_power',
  INPUT_ENERGY: 'input_energy',
  BYPASS_POWER: 'bypass_power',
  BYPASS_ENERGY: 'bypass_energy',
  PV_POWER: 'pv_power',
  PV_ENERGY: 'pv_energy',
  /** 30-minute production: fed by the Gladys core from the index, never by the integration. */
  PV_30MIN: 'pv_energy_production',
  PV_POWER_1: 'pv_power_1',
  PV_POWER_2: 'pv_power_2',
  PV_POWER_3: 'pv_power_3',
  PV_POWER_4: 'pv_power_4',
  DAY_PV: 'energy_pv_today',
  DAY_CHARGED: 'energy_charged_today',
  DAY_DISCHARGED: 'energy_discharged_today',
  METER_POWER: 'meter_power',
  GRID_VOLTAGE: 'grid_voltage',
  GRID_FREQUENCY: 'grid_frequency',
  ENERGY_MODE: 'energy_mode',
  OPERATING_MODE: 'operating_mode',
  RATED_CAPACITY: 'rated_capacity',
  DISCHARGE_LIMIT: 'discharge_limit',
  CYCLES: 'cycles',
  REMAINING_CHARGE: 'remaining_charge_time',
  REMAINING_DISCHARGE: 'remaining_discharge_time',
  TEMPERATURE: 'battery_temperature',
  INVERTER_TEMPERATURE: 'inverter_temperature',
};

/**
 * The guarded indexes: their feature, the value they come from (src/indevolt/model.js)
 * and their name in the texts (src/i18n.js).
 */
export const INDEXES = [
  { name: 'charged', key: FEATURE.CHARGED_ENERGY, value: 'totalCharged' },
  { name: 'discharged', key: FEATURE.DISCHARGED_ENERGY, value: 'totalDischarged' },
  { name: 'output', key: FEATURE.OUTPUT_ENERGY, value: 'totalAcOutput' },
  { name: 'offGrid', key: FEATURE.OFF_GRID_ENERGY, value: 'offGridEnergy' },
  { name: 'pv', key: FEATURE.PV_ENERGY, value: 'pvEnergy' },
];

/** The external ids of the battery with this serial. */
export const ids = (gladys, serial) => gladys.externalIds(EXTERNAL_ID_TYPE, serial);

/** Namespace of the feature ids of this integration (random, fixed forever). */
const ID_NAMESPACE = Buffer.from('3b9d27c0e5f14a6c9e2a71d4b8c06f53', 'hex');

/** A deterministic UUID (version 5, RFC 9562) of a name (as gladys-apsystems). */
export function uuidOf(name) {
  const hash = createHash('sha1').update(ID_NAMESPACE).update(String(name), 'utf8').digest();
  const bytes = hash.subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

// --- The catalog ------------------------------------------------------------------
//
// Each entry: the feature key, the value of src/indevolt/model.js it shows,
// its rounding, the generations that have it, and how it is declared.

const BOTH = [1, 2];
const GEN2 = [2];

const def = (key, value, digits, gens, spec) => ({ key, value, digits, gens, spec });

const measure = (name, category, type, extra = {}) => ({ name, category, type, ...extra });
/** A value shown, never summed nor billed: no energy category, no unit (it is in the name). */
const plain = (name, extra = {}) => measure(name, C.UNKNOWN, T.SENSOR.DECIMAL, extra);
const code = (name, max) => measure(name, C.UNKNOWN, T.SENSOR.INTEGER, { max });
const signedPower = (name) => plain(`${name} (W)`, { min: -POWER_MAX, max: POWER_MAX });
const positivePower = (name) => plain(`${name} (W)`, { max: POWER_MAX });
const lifetime = (name) => plain(`${name} (kWh, total)`, { max: ENERGY_MAX });
const today = (name) => plain(`${name} (kWh, today)`, { max: DAY_ENERGY_MAX });
const index = (name, category, type) =>
  measure(name, category, type, { unit: U.KILOWATT_HOUR, max: ENERGY_MAX });
const watts = (name, category, type) =>
  measure(name, category, type, { unit: U.WATT, max: POWER_MAX });
const temperature = (name) =>
  measure(name, C.DEVICE_TEMPERATURE_SENSOR, T.SENSOR.DECIMAL, {
    unit: U.CELSIUS,
    min: -40,
    max: 120,
  });

export const CATALOG = [
  def(FEATURE.SOC, 'soc', 0, BOTH, {
    ...measure('State of charge', C.BATTERY_STORAGE, T.BATTERY_STORAGE.BATTERY_LEVEL),
    unit: U.PERCENT,
    max: 100,
  }),
  def(
    FEATURE.CHARGE_POWER,
    'chargePower',
    0,
    BOTH,
    watts('Charge power', C.BATTERY_STORAGE, T.BATTERY_STORAGE.CHARGE_POWER),
  ),
  def(
    FEATURE.DISCHARGE_POWER,
    'dischargePower',
    0,
    BOTH,
    watts('Discharge power', C.BATTERY_STORAGE, T.BATTERY_STORAGE.DISCHARGE_POWER),
  ),
  def(FEATURE.BATTERY_POWER, 'batteryPower', 0, BOTH, signedPower('Battery power')),
  def(
    FEATURE.BATTERY_STATE,
    'batteryState',
    0,
    BOTH,
    code('Battery state (0 = idle, 1 = charging, 2 = discharging)', 2),
  ),
  def(
    FEATURE.CHARGED_ENERGY,
    'totalCharged',
    3,
    BOTH,
    index('Charged energy', C.BATTERY_STORAGE, T.BATTERY_STORAGE.CHARGE_INDEX),
  ),
  def(
    FEATURE.DISCHARGED_ENERGY,
    'totalDischarged',
    3,
    BOTH,
    index('Discharged energy', C.BATTERY_STORAGE, T.BATTERY_STORAGE.DISCHARGE_INDEX),
  ),
  def(
    FEATURE.OUTPUT_POWER,
    'acOutputPower',
    0,
    BOTH,
    watts('AC output power', C.HOME_OUTPUT_SENSOR, T.HOME_OUTPUT_SENSOR.POWER),
  ),
  def(
    FEATURE.OUTPUT_ENERGY,
    'totalAcOutput',
    3,
    BOTH,
    index('AC output energy', C.HOME_OUTPUT_SENSOR, T.HOME_OUTPUT_SENSOR.INDEX),
  ),
  def(
    FEATURE.OFF_GRID_ENERGY,
    'offGridEnergy',
    3,
    BOTH,
    index('Off-grid output energy', C.HOME_OUTPUT_SENSOR, T.HOME_OUTPUT_SENSOR.OFF_GRID_INDEX),
  ),
  def(FEATURE.INPUT_POWER, 'acInputPower', 0, BOTH, positivePower('AC input power')),
  def(FEATURE.INPUT_ENERGY, 'totalAcInput', 3, BOTH, lifetime('AC input energy')),
  def(FEATURE.BYPASS_POWER, 'bypassPower', 0, BOTH, signedPower('Bypass power')),
  def(FEATURE.BYPASS_ENERGY, 'bypassEnergy', 3, BOTH, lifetime('Bypass input energy')),
  def(
    FEATURE.PV_POWER,
    'pvPower',
    0,
    BOTH,
    watts('Solar power', C.ENERGY_PRODUCTION_SENSOR, T.ENERGY_PRODUCTION_SENSOR.POWER),
  ),
  def(
    FEATURE.PV_ENERGY,
    'pvEnergy',
    3,
    BOTH,
    index('Solar production index', C.ENERGY_PRODUCTION_SENSOR, T.ENERGY_PRODUCTION_SENSOR.INDEX),
  ),
  // Declared only: the core computes it from the index.
  def(FEATURE.PV_30MIN, undefined, 3, BOTH, {
    ...index(
      'Solar production index (30-minute production)',
      C.ENERGY_PRODUCTION_SENSOR,
      T.ENERGY_PRODUCTION_SENSOR.THIRTY_MINUTES_PRODUCTION,
    ),
  }),
  def(FEATURE.PV_POWER_1, 'pvPower1', 0, BOTH, positivePower('Solar input 1')),
  def(FEATURE.PV_POWER_2, 'pvPower2', 0, BOTH, positivePower('Solar input 2')),
  def(FEATURE.PV_POWER_3, 'pvPower3', 0, GEN2, positivePower('Solar input 3')),
  def(FEATURE.PV_POWER_4, 'pvPower4', 0, GEN2, positivePower('Solar input 4')),
  def(FEATURE.DAY_PV, 'dayPv', 3, BOTH, today('Solar production')),
  def(FEATURE.DAY_CHARGED, 'dayCharged', 3, BOTH, today('Charged')),
  def(FEATURE.DAY_DISCHARGED, 'dayDischarged', 3, BOTH, today('Discharged')),
  def(FEATURE.METER_POWER, 'meterPower', 0, BOTH, signedPower('Energy meter power')),
  def(FEATURE.GRID_VOLTAGE, 'gridVoltage', 1, GEN2, {
    ...measure('Grid voltage', C.ENERGY_SENSOR, T.ENERGY_SENSOR.VOLTAGE),
    unit: U.VOLT,
    max: 1000,
    keep_history: false,
  }),
  // No frequency category or Hz unit in the core: a plain decimal, named with its unit.
  def(FEATURE.GRID_FREQUENCY, 'gridFrequency', 2, GEN2, plain('Grid frequency (Hz)', { max: 100 })),
  def(
    FEATURE.ENERGY_MODE,
    'energyMode',
    0,
    BOTH,
    code(
      'Energy mode (0 = outdoor portable, 1 = self-consumption, 4 = real-time control, 5 = schedule)',
      5,
    ),
  ),
  def(
    FEATURE.OPERATING_MODE,
    'operatingMode',
    0,
    BOTH,
    code('Operating mode (0 = main, 1 = sub, 2 = standalone)', 2),
  ),
  def(
    FEATURE.RATED_CAPACITY,
    'ratedCapacity',
    2,
    BOTH,
    plain('Rated capacity (kWh)', { max: 1000 }),
  ),
  def(
    FEATURE.DISCHARGE_LIMIT,
    'dischargeLimit',
    0,
    BOTH,
    plain('Discharge limit, emergency reserve (%)', { max: 100 }),
  ),
  def(FEATURE.CYCLES, 'cycles', 0, GEN2, plain('Equivalent full cycles', { max: 1e6 })),
  def(
    FEATURE.REMAINING_CHARGE,
    'remainingCharge',
    0,
    GEN2,
    plain('Remaining charging time (min)', { max: 1e6 }),
  ),
  def(
    FEATURE.REMAINING_DISCHARGE,
    'remainingDischarge',
    0,
    GEN2,
    plain('Remaining discharging time (min)', { max: 1e6 }),
  ),
  def(FEATURE.TEMPERATURE, 'temperature', 1, BOTH, temperature('Battery temperature')),
  def(
    FEATURE.INVERTER_TEMPERATURE,
    'inverterTemperature',
    1,
    BOTH,
    temperature('Inverter temperature'),
  ),
];

/** The feature keys of a created device (its features are fixed at its creation). */
export function keysOfDevice(device) {
  return new Set(
    (device?.features ?? []).map((f) =>
      String(f.external_id ?? '')
        .split(':')
        .at(-1),
    ),
  );
}

/**
 * The catalog entries of a battery: those of its generation, plus every one
 * the created device already has (published again, a device never loses a
 * feature: "Update" in Discovery would drop its history).
 */
export function entriesFor(generation, createdKeys = new Set()) {
  return CATALOG.filter((e) => e.gens.includes(generation) || createdKeys.has(e.key));
}

/**
 * The device of a battery. `battery`: `{ serial, model, generation, firmware,
 * address }`; `created`: the device the user created, when there is one.
 */
export function buildDevice(gladys, battery, created) {
  const external = ids(gladys, battery.serial);
  const pvIndexId = external.feature(FEATURE.PV_ENERGY);
  const features = entriesFor(battery.generation, keysOfDevice(created)).map(({ key, spec }) => {
    const feature = {
      min: 0,
      read_only: true,
      has_feedback: false,
      keep_history: true,
      ...spec,
      external_id: external.feature(key),
    };
    if (key === FEATURE.PV_ENERGY) {
      feature.id = uuidOf(pvIndexId);
    } else if (key === FEATURE.PV_30MIN) {
      feature.id = uuidOf(external.feature(FEATURE.PV_30MIN));
      feature.energy_parent_id = uuidOf(pvIndexId);
    }
    return feature;
  });
  return {
    name: ['Indevolt', battery.model, battery.serial].filter(Boolean).join(' '),
    external_id: external.device,
    features,
    params: [
      { name: 'INDEVOLT_ADDRESS', value: battery.address },
      { name: 'INDEVOLT_SERIAL', value: battery.serial },
      { name: 'INDEVOLT_MODEL', value: battery.model ?? '' },
      { name: 'INDEVOLT_GENERATION', value: String(battery.generation) },
      { name: 'INDEVOLT_FIRMWARE', value: battery.firmware ?? '' },
    ],
  };
}

export const round = (value, digits) => {
  const r = Math.round(value * 10 ** digits) / 10 ** digits;
  return Object.is(r, -0) ? 0 : r;
};

const isNumber = (value) => typeof value === 'number' && Number.isFinite(value);

const INDEX_KEYS = new Set(INDEXES.map((i) => i.key));

/**
 * The states of a read. `values`: src/indevolt/model.js parseValues;
 * `indexes`: by feature key, the values the guards let through (undefined: not
 * published this time). An index is never taken from `values` directly.
 */
export function readStates(external, values, indexes = {}) {
  const states = [];
  for (const { key, value, digits, spec } of CATALOG) {
    let v;
    if (INDEX_KEYS.has(key)) {
      // Never 0 (the guard never lets 0 through, checked again here).
      v = isNumber(indexes[key]) && indexes[key] > 0 ? indexes[key] : undefined;
    } else if (value !== undefined) {
      v = values[value];
    }
    if (!isNumber(v)) {
      continue;
    }
    const r = round(v, digits);
    const min = spec.min ?? 0;
    if (r < min || (spec.max !== undefined && r > spec.max)) {
      continue;
    }
    states.push({ device_feature_external_id: external.feature(key), state: r });
  }
  return states;
}
