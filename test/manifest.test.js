// -----------------------------------------------------------------------------
// The manifest is the contract with Gladys and the store: these tests tie it
// to the code, so a key renamed on one side only fails here. And the devices
// only use the units the core accepts for their category.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as TYPES,
  DEVICE_FEATURE_UNITS as U,
} from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { ACTIONS, DISCOVERY_PORT, POLL_DEFAULT, POLL_MAX, POLL_MIN } from '../src/constants.js';
import { CATALOG, INDEXES, buildDevice } from '../src/devices.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const manifest = JSON.parse(read('gladys-assistant-integration.json'));
const pkg = JSON.parse(read('package.json'));
const lock = JSON.parse(read('package-lock.json'));
const index = read('index.js');
const dockerfile = read('Dockerfile');

function* texts(node, path = '') {
  if (Array.isArray(node)) {
    for (const [i, item] of node.entries()) {
      yield* texts(item, `${path}[${i}]`);
    }
  } else if (node && typeof node === 'object') {
    if ('en' in node || 'fr' in node) {
      yield [path, node];
      return;
    }
    for (const [key, value] of Object.entries(node)) {
      yield* texts(value, `${path}.${key}`);
    }
  }
}

test('the store basics; version 0.1.0 everywhere', () => {
  assert.equal(manifest.manifest_version, 1);
  assert.equal(manifest.type, 'device');
  assert.equal(pkg.version, '0.1.0');
  assert.equal(manifest.docker_image, `ghcr.io/lm1lc3n7/gladys-indevolt:${manifest.version}`);
  assert.equal(manifest.version, pkg.version);
  assert.equal(lock.version, pkg.version);
  assert.equal(lock.name, pkg.name);
  assert.equal(lock.packages[''].version, pkg.version);
  assert.equal(pkg.name, 'gladys-indevolt');
  assert.deepEqual(manifest.categories, ['energy']);
  assert.deepEqual(manifest.transports, ['local']);
  assert.deepEqual(manifest.network_discovery, [
    { type: 'udp-broadcast', ports: [DISCOVERY_PORT] },
  ]);
  assert.match(manifest.gladys_version, />=\s*5\.2\.0/);
  for (const lang of ['en', 'fr']) {
    const length = manifest.description[lang].length;
    assert.ok(length >= 10 && length <= 100, `description.${lang}: ${length} characters`);
    assert.ok(read(`docs/${lang}.md`).length >= 300, `docs/${lang}.md is too short for the store`);
  }
  assert.match(manifest.description.en, /Unofficial/);
  assert.match(manifest.description.fr, /Non officiel/);
});

test('the docs say it was never tested with a real device', () => {
  assert.match(read('docs/fr.md'), /[Jj]amais\s+testé\s+avec\s+un\s+vrai\s+appareil/);
  assert.match(read('docs/en.md'), /[Nn]ever\s+tested\s+with\s+a\s+real\s+device/);
  assert.match(read('README.md'), /[Nn]ever\s+tested\s+with\s+a\s+real\s+device/);
});

test('every text is in English and French; placeholders too', () => {
  for (const [path, text] of texts(manifest)) {
    for (const lang of ['en', 'fr']) {
      assert.ok(text[lang]?.trim(), `${path} needs ${lang}`);
    }
  }
  for (const field of manifest.config_schema) {
    if ('placeholder' in field) {
      assert.equal(typeof field.placeholder, 'object', `${field.key}.placeholder`);
    }
  }
});

test('the configuration matches the code; no secret is asked', () => {
  const fields = Object.fromEntries(manifest.config_schema.map((f) => [f.key, f]));
  assert.deepEqual(Object.keys(fields), ['intro', 'addresses', 'poll_interval']);
  assert.equal(fields.addresses.type, 'string');
  assert.equal(fields.poll_interval.type, 'number');
  assert.equal(fields.poll_interval.default, POLL_DEFAULT);
  assert.equal(fields.poll_interval.min, POLL_MIN);
  assert.equal(fields.poll_interval.max, POLL_MAX);
  assert.ok(manifest.config_schema.every((f) => f.type !== 'secret'));
  for (const link of fields.intro.links) {
    assert.match(link.url, /^https:\/\//);
  }
});

test('the actions of the manifest are the handlers of the code; read-only', () => {
  assert.deepEqual(
    manifest.actions.map((a) => a.key),
    Object.values(ACTIONS),
  );
  assert.ok(index.includes('onAction(ACTIONS.TEST'));
  assert.ok(index.includes('onAction(ACTIONS.ACCEPT_HELD'));
  assert.ok(index.includes('onDeviceCreated'));
  assert.ok(index.includes('onScanRequest'));
  assert.ok(index.includes("on('connected'"));
  assert.ok(!index.includes('onSetValue'), 'no command: read-only');
  assert.match(manifest.actions[1].description.en, /First click: lists.*Second click/);
});

test('the licenses ship in the image; no name in LICENSE', () => {
  assert.match(dockerfile, /COPY LICENSE THIRD_PARTY_NOTICES\.md/);
  const license = read('LICENSE');
  assert.match(license, /Apache License\s+Version 2\.0/);
  assert.match(license, /Copyright \[yyyy\] \[name of copyright owner\]/);
  const notices = read('THIRD_PARTY_NOTICES.md');
  assert.match(notices, /indevolt-api/);
  assert.match(notices, /Copyright \(c\) 2026 XirtNL/);
  assert.match(notices, /Permission is hereby granted, free of charge/);
});

test('the code never feeds the energy consumption endpoint, nor publishes a scene event', () => {
  for (const file of ['index.js', 'src/app.js', 'src/devices.js']) {
    assert.doesNotMatch(read(file), /publishEnergyConsumption\(|publishSceneEvent\(/, file);
  }
});

// The units the core accepts per category (server/utils/constants.js
// DEVICE_FEATURE_UNITS_BY_CATEGORY), for the categories used here.
const UNITS_BY_CATEGORY = {
  [C.BATTERY_STORAGE]: [U.PERCENT, U.WATT, U.KILOWATT, U.WATT_HOUR, U.KILOWATT_HOUR],
  [C.HOME_OUTPUT_SENSOR]: [U.WATT, U.KILOWATT, U.WATT_HOUR, U.KILOWATT_HOUR],
  [C.ENERGY_PRODUCTION_SENSOR]: [U.WATT, U.KILOWATT, U.WATT_HOUR, U.KILOWATT_HOUR],
  [C.ENERGY_SENSOR]: [U.AMPERE, U.VOLT, U.WATT, U.KILOWATT, U.WATT_HOUR, U.KILOWATT_HOUR],
  [C.DEVICE_TEMPERATURE_SENSOR]: [U.CELSIUS, U.FAHRENHEIT],
  [C.UNKNOWN]: [],
};

test('every feature uses a unit the core accepts for its category; keys unique', () => {
  const gladys = createFakeGladys({ selector: 'indevolt' });
  for (const generation of [1, 2]) {
    const device = buildDevice(gladys, { serial: 'ABCD1234', generation, address: 'x:8080' });
    const keys = new Set();
    for (const f of device.features) {
      assert.ok(f.category in UNITS_BY_CATEGORY, `${f.external_id}: ${f.category}`);
      if (f.unit !== undefined) {
        assert.ok(UNITS_BY_CATEGORY[f.category].includes(f.unit), `${f.external_id}: ${f.unit}`);
      }
      assert.equal(f.read_only, true, f.external_id);
      assert.ok(!keys.has(f.external_id));
      keys.add(f.external_id);
    }
  }
  // The indexes are exactly the five guarded ones; no energy-sensor index (nothing billed).
  const indexTypes = new Set([
    TYPES.BATTERY_STORAGE.CHARGE_INDEX,
    TYPES.BATTERY_STORAGE.DISCHARGE_INDEX,
    TYPES.HOME_OUTPUT_SENSOR.INDEX,
    TYPES.HOME_OUTPUT_SENSOR.OFF_GRID_INDEX,
    TYPES.ENERGY_PRODUCTION_SENSOR.INDEX,
  ]);
  const indexes = CATALOG.filter(
    (e) => e.spec.category !== C.UNKNOWN && indexTypes.has(e.spec.type),
  );
  assert.deepEqual(indexes.map((e) => e.key).sort(), INDEXES.map((i) => i.key).sort());
  assert.ok(
    !CATALOG.some(
      (e) => e.spec.category === C.ENERGY_SENSOR && e.spec.type === TYPES.ENERGY_SENSOR.INDEX,
    ),
  );
  assert.ok(!CATALOG.some((e) => /daily/.test(e.spec.type)));
});
