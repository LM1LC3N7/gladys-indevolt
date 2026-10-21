// -----------------------------------------------------------------------------
// The answers -> our values: strict numbers, ranges, generations, never the
// prototype.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KEYS, num, parseIdentity, parseValues } from '../src/indevolt/model.js';
import { KEYS_PER_REQUEST } from '../src/constants.js';
import { VALUES, identity } from './fixtures/indevolt.js';

test('identity: serial, model, generation as the library counts it, firmware', () => {
  assert.deepEqual(parseIdentity(identity()), {
    serial: 'SF2000A1B2C3',
    model: 'CMS-SF2000',
    generation: 2,
    firmware: 'V1.2.3',
  });
  assert.equal(parseIdentity(identity({ type: 'BK1600' })).generation, 1);
  assert.equal(parseIdentity(identity({ type: '<script>' })).model, undefined);
  assert.equal(parseIdentity(identity({ type: '<script>' })).generation, 1);
  for (const bad of [
    null,
    [],
    {},
    { device: null },
    { device: { sn: '' } },
    { device: { sn: 'a b' } },
    { device: { sn: 'x'.repeat(41) } },
    JSON.parse('{"__proto__": {"device": {"sn": "ABCDEF"}}}'),
    { device: JSON.parse('{"__proto__": {"sn": "ABCDEF"}}') },
  ]) {
    assert.equal(parseIdentity(bad), undefined, JSON.stringify(bad));
  }
});

test('only the keys Home Assistant reads: never key 0 (its format is not confirmed)', () => {
  assert.ok(!KEYS[1].includes(0) && !KEYS[2].includes(0));
});

test('the keys of each generation fit in one request', () => {
  for (const gen of [1, 2]) {
    assert.ok(KEYS[gen].length <= KEYS_PER_REQUEST);
    assert.equal(new Set(KEYS[gen]).size, KEYS[gen].length);
  }
  assert.ok(KEYS[2].includes(11016) && !KEYS[2].includes(21028));
  assert.ok(KEYS[1].includes(21028) && !KEYS[1].includes(11016));
});

test('values of a second-generation battery, in their unit', () => {
  const v = parseValues(VALUES, 2);
  assert.equal(v.soc, 64);
  assert.equal(v.batteryState, 2);
  assert.equal(v.dischargePower, 450, 'the state says discharging, whatever the sign');
  assert.equal(v.chargePower, 0);
  assert.equal(v.pvEnergy, 1234, 'Wh -> kWh');
  assert.equal(v.bypassEnergy, 2.5, 'Wh -> kWh');
  assert.equal(v.totalCharged, 400.5);
  assert.equal(v.offGridEnergy, 0);
  assert.equal(v.meterPower, -120);
  assert.equal(v.operatingMode, 2);
  assert.equal(v.energyMode, 1);
  assert.equal(v.gridFrequency, 50.01);
  assert.equal(v.temperature, 23.5);
});

test('first generation: its own meter key; a 0 °C inverter with the heating off is left out', () => {
  const raw = { 21028: 300, 11016: 999, 7600: 0, 7121: 1001, 7605: 18, 6001: 1001, 6000: 300 };
  const v = parseValues(raw, 1);
  assert.equal(v.meterPower, 300);
  assert.equal(v.inverterTemperature, undefined);
  assert.equal(v.temperature, 18);
  assert.equal(v.chargePower, 300);
  assert.equal(v.dischargePower, 0);
  assert.equal(parseValues({ 7600: 0, 7121: 1000 }, 1).inverterTemperature, 0);
  assert.equal(parseValues({ 7600: 41 }, 1).inverterTemperature, 41);
  assert.equal(v.gridVoltage, undefined, 'gen 2 only');
});

test('a missing, odd or out-of-range value is left out, never read as 0', () => {
  const v = parseValues(
    {
      6002: 140,
      6000: 'abc',
      2108: -5,
      1501: '820',
      6006: null,
      6007: true,
      7101: 3,
      6001: 999,
      2104: 1e12,
      9012: 500,
    },
    2,
  );
  assert.deepEqual(v, { pvPower: 820 });
  assert.deepEqual(parseValues(JSON.parse('{"__proto__": {"6002": 50}}'), 2), {});
  assert.deepEqual(parseValues(null, 2), {});
  assert.equal(num('1e3'), undefined);
  assert.equal(num(' 12.5 '), 12.5);
  assert.equal(num(Infinity), undefined);
});
