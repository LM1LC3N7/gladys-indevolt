// -----------------------------------------------------------------------------
// The integration against the SDK's fake Gladys and fake Indevolt batteries.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { IndevoltApp } from '../src/app.js';
import { ACTIONS, PAUSE_MIN, RETRY_MIN } from '../src/constants.js';
import { buildDevice } from '../src/devices.js';
import { IndevoltClient } from '../src/indevolt/client.js';
import { parseIdentity } from '../src/indevolt/model.js';
import { createMemoryStore } from '../src/store.js';
import { createFetch, refusedError } from './helpers/fakeFetch.js';
import { createFakeTimers } from './helpers/fakeTimers.js';
import { ADDRESS, NOW, SERIAL, identity, json, routes } from './fixtures/indevolt.js';

const SELECTOR = 'indevolt';
const DEVICE = `ext:${SELECTOR}:battery:${SERIAL}`;
const F = (key, serial = SERIAL) => `ext:${SELECTOR}:battery:${serial}:${key}`;
const CONFIG = { addresses: '192.168.1.40' };
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const POLL = 30 * SECOND;

function createLogger() {
  const lines = [];
  const log = (...args) => lines.push(args.map(String).join(' '));
  return { lines, info: log, warn: log, error: log, debug: log };
}

/** The device as the user created it from the discovered one. */
function created({ index, address = ADDRESS, who = identity() } = {}) {
  const gladys = createFakeGladys({ selector: SELECTOR });
  const device = buildDevice(gladys, { ...parseIdentity(who), address });
  if (index) {
    for (const [key, value] of Object.entries(index.values)) {
      const feature = device.features.find((f) => f.external_id === F(key));
      feature.last_value = value;
      feature.last_value_changed = new Date(index.at).toISOString();
    }
  }
  return device;
}

async function setup({
  config = CONFIG,
  hosts = { [ADDRESS]: routes() },
  devices = [],
  store = createMemoryStore(),
  now = NOW,
  scanResults,
} = {}) {
  const fake = createFetch(hosts);
  const gladys = createFakeGladys({ selector: SELECTOR, config, devices, scanResults });
  await gladys.connect();
  const timers = createFakeTimers();
  const clock = { now };
  const logger = createLogger();
  const app = new IndevoltApp({
    gladys,
    logger,
    now: () => clock.now,
    monotonic: () => clock.now,
    timers,
    store,
    client: new IndevoltClient({ fetchImpl: fake.fetch }),
  });
  gladys.onDeviceCreated((device) => app.onDeviceCreated(device));
  gladys.onAction(ACTIONS.TEST, () => app.testConnection());
  gladys.onAction(ACTIONS.ACCEPT_HELD, () => app.acceptHeldIndex());
  /** The next read (or `ms` later). */
  const tick = async (ms = POLL) => {
    clock.now += ms;
    await timers.runIntervals();
  };
  return { app, gladys, timers, clock, logger, fake, tick, store, hosts };
}

const status = (gladys) => gladys.fake.connectionStatus;
const reads = (fake, path = '/rpc/Indevolt.GetData') =>
  fake.calls.filter((c) => c.path === path).length;
const last = (gladys, key, serial) => gladys.fake.lastState(F(key, serial));

test('nothing configured: the status says so, nothing is called', async () => {
  const { app, gladys, fake } = await setup({ config: {} });
  await app.start({});
  await app.idle();
  assert.equal(status(gladys).connected, false);
  assert.match(status(gladys).message.fr, /Aucune batterie Indevolt/);
  assert.equal(fake.calls.length, 0);
  assert.match(String((await gladys.fake.action(ACTIONS.TEST)).data.message.fr), /Aucune batterie/);
  const bad = await setup({ config: { addresses: 'u:p@x' } });
  await bad.app.start({ addresses: 'u:p@x' });
  await bad.app.idle();
  assert.match(status(bad.gladys).message.fr, /pas valides/);
});

test('a typed battery is discovered by its serial; no value before its device is created', async () => {
  const { app, gladys } = await setup();
  await app.start(CONFIG);
  await app.idle();
  const [device] = gladys.fake.discoveredDevices;
  assert.equal(device.external_id, DEVICE);
  assert.equal(device.name, `Indevolt CMS-SF2000 ${SERIAL}`);
  assert.ok(
    device.features.some((f) => f.external_id === F('pv_power_4')),
    'gen 2 has 4 inputs',
  );
  assert.equal(gladys.fake.states.length, 0);
  assert.equal(status(gladys).connected, true);
  assert.match(status(gladys).message.fr, /Découverte/);
});

test('a created battery gets its values and its indexes, read-only, never the consumption endpoint', async () => {
  const { app, gladys, fake, tick, hosts } = await setup({ devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(last(gladys, 'soc'), 64);
  assert.equal(last(gladys, 'discharge_power'), 450);
  assert.equal(last(gladys, 'charge_power'), 0);
  assert.equal(last(gladys, 'battery_power'), -450);
  assert.equal(last(gladys, 'pv_power'), 820);
  assert.equal(last(gladys, 'pv_energy'), 1234);
  assert.equal(last(gladys, 'charged_energy'), 400.5);
  assert.equal(last(gladys, 'output_energy'), 310.25);
  assert.equal(last(gladys, 'off_grid_energy'), undefined, 'an index at 0 is never sent');
  assert.equal(last(gladys, 'pv_energy_production'), undefined, 'computed by the core');
  assert.equal(last(gladys, 'grid_frequency'), 50.01);
  assert.equal(last(gladys, 'battery_temperature'), 23.5);
  assert.match(status(gladys).message.en, /1 of 1 Indevolt battery answering/);
  hosts[ADDRESS].state.values[6006] = 400.6;
  await tick();
  assert.equal(last(gladys, 'charged_energy'), 400.6);
  assert.equal(gladys.fake.publishedEnergyConsumption.length, 0);
  // Read-only: Sys.GetConfig (GET) and Indevolt.GetData (POST, nothing in the body).
  assert.ok(
    fake.calls.every(
      (c) =>
        (c.path === '/rpc/Sys.GetConfig' && c.init.method === 'GET') ||
        (c.path === '/rpc/Indevolt.GetData' && c.init.method === 'POST' && !c.init.body),
    ),
  );
});

test('an index jump is held, shown, and taken only by two clicks, bounded to what was listed', async () => {
  const device = created({ index: { values: { charged_energy: 300 }, at: NOW - MINUTE } });
  const { app, gladys, tick, store, hosts } = await setup({ devices: [device] });
  await app.start(CONFIG);
  await app.idle();
  // Gladys held 300: 400.5 a minute later is a jump.
  assert.equal(last(gladys, 'charged_energy'), 300, 'the last accepted value, never the jump');
  assert.match(status(gladys).message.fr, /saut de 300 à 400\.5 kWh/);
  assert.equal(store.data.indexes[F('charged_energy')].held.to, 400.5);
  // A save of the form accepts nothing; nor does the time.
  await app.start(CONFIG, { fresh: true });
  await app.idle();
  for (let i = 0; i < 20; i += 1) await tick();
  assert.equal(last(gladys, 'charged_energy'), 300);
  // The first click lists, accepts nothing.
  const first = await gladys.fake.action(ACTIONS.ACCEPT_HELD);
  assert.match(first.data.message.en, /second click accepts exactly/);
  assert.match(first.data.message.en, /100\.5 kWh counted at once/);
  await app.idle();
  await tick();
  assert.equal(last(gladys, 'charged_energy'), 300);
  // The second click: what was listed, published at the next read.
  const second = await gladys.fake.action(ACTIONS.ACCEPT_HELD);
  assert.match(
    second.data.message.en,
    /Accepted: CMS-SF2000 SF2000A1B2C3, charged energy index 400\.5 kWh/,
  );
  await app.idle();
  await tick();
  assert.equal(last(gladys, 'charged_energy'), 400.5);
  assert.doesNotMatch(status(gladys).message.fr, /retenu/);
  const nothing = await gladys.fake.action(ACTIONS.ACCEPT_HELD);
  assert.match(nothing.data.message.en, /nothing to accept/);
  // Another jump, listed; it jumps further before the second click: not accepted.
  hosts[ADDRESS].state.values[6006] = 900;
  await tick();
  await gladys.fake.action(ACTIONS.ACCEPT_HELD);
  hosts[ADDRESS].state.values[6006] = 5000;
  await tick();
  const changed = await gladys.fake.action(ACTIONS.ACCEPT_HELD);
  assert.match(changed.data.message.en, /Not accepted, the value changed/);
  await app.idle();
  await tick();
  assert.equal(last(gladys, 'charged_energy'), 400.5);
  // A second click too late is a first click again.
  await gladys.fake.action(ACTIONS.ACCEPT_HELD);
  await tick(6 * MINUTE);
  const late = await gladys.fake.action(ACTIONS.ACCEPT_HELD);
  assert.match(late.data.message.en, /second click accepts exactly/);
});

test('429 and 5xx: a bounded pause kept in /data, never a read before its end', async () => {
  const store = createMemoryStore();
  const r = routes();
  const ok = r['/rpc/Sys.GetConfig'];
  r['/rpc/Sys.GetConfig'] = () => json({}, { status: 429, headers: { 'retry-after': '1' } });
  const { app, gladys, tick, fake, clock } = await setup({ hosts: { [ADDRESS]: r }, store });
  await app.start(CONFIG);
  await app.idle();
  assert.match(status(gladys).message.fr, /demande d’attendre/);
  // Retry-After of 1 s: the pause is never shorter than a minute.
  assert.equal(store.data.pauses[ADDRESS].until, clock.now + PAUSE_MIN);
  const before = fake.calls.length;
  await tick();
  assert.equal(fake.calls.length, before);
  // A reconnection and the test button keep it.
  await app.start(CONFIG);
  await app.idle();
  assert.match(String((await gladys.fake.action(ACTIONS.TEST)).data.message.fr), /en pause/);
  assert.equal(fake.calls.length, before);
  // A restart keeps the pause; a pause from /data far in the future is capped.
  const far = createMemoryStore({
    pauses: { [ADDRESS]: { until: clock.now + 1000 * HOUR, count: 3, code: 'server' } },
  });
  const again = await setup({ hosts: { [ADDRESS]: r }, store: far, now: clock.now });
  await again.app.start(CONFIG);
  await again.app.idle();
  assert.equal(again.fake.calls.length, 0);
  assert.match(status(again.gladys).message.fr, /6 h/);
  // A 503 doubles the pause.
  r['/rpc/Sys.GetConfig'] = () => json({}, { status: 503 });
  await tick(PAUSE_MIN);
  assert.equal(store.data.pauses[ADDRESS].count, 2);
  assert.equal(store.data.pauses[ADDRESS].code, 'server');
  // A save of the form ends the pause.
  r['/rpc/Sys.GetConfig'] = ok;
  await app.start(CONFIG, { fresh: true });
  await app.idle();
  assert.equal(status(gladys).connected, true);
  assert.deepEqual(store.data.pauses, {});
});

test('unreachable: retries from 1 min, doubled; a reconnection keeps the delay', async () => {
  const { app, gladys, tick, fake, logger } = await setup({ hosts: {} });
  await app.start(CONFIG);
  await app.idle();
  assert.match(status(gladys).message.fr, /injoignable.*1 min/);
  await tick();
  assert.equal(reads(fake, '/rpc/Sys.GetConfig'), 1, 'never faster than a minute');
  await tick(RETRY_MIN);
  assert.equal(reads(fake, '/rpc/Sys.GetConfig'), 2);
  assert.match(status(gladys).message.fr, /2 min/);
  await app.start(CONFIG);
  await app.idle();
  assert.equal(reads(fake, '/rpc/Sys.GetConfig'), 2, 'a reconnection does not retry sooner');
  assert.ok(
    logger.lines.every((l) => !/http:\/\//.test(l)),
    'no URL in the logs',
  );
  assert.ok(refusedError() instanceof TypeError);
});

test('another battery at the same address: never written into the device of the first one', async () => {
  const r = routes();
  const { app, gladys, tick } = await setup({ hosts: { [ADDRESS]: r }, devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  const soc = last(gladys, 'soc');
  const states = gladys.fake.states.length;
  r.state.who = identity({ sn: 'OTHER00001', type: 'BK1600' });
  r.state.values[6002] = 12;
  await tick();
  assert.equal(last(gladys, 'soc'), soc);
  assert.equal(gladys.fake.states.length, states, 'not one value of the other battery');
  const ids = gladys.fake.discoveredDevices.map((d) => d.external_id);
  assert.ok(ids.includes(`ext:${SELECTOR}:battery:OTHER00001`));
});

test('discovery: an announcement on UDP 8099 adds the battery; other datagrams are ignored', async () => {
  const scanResults = {
    'udp-broadcast': [
      {
        source_ip: '192.168.1.40',
        source_port: 8099,
        payload_base64: Buffer.from('BCF-D x').toString('base64'),
      },
      {
        source_ip: '192.168.1.99',
        source_port: 8099,
        payload_base64: Buffer.from('hello').toString('base64'),
      },
      {
        source_ip: 'not an ip',
        source_port: 8099,
        payload_base64: Buffer.from('BCF-D').toString('base64'),
      },
    ],
  };
  const { app, gladys, fake } = await setup({ config: {}, scanResults });
  await app.start({});
  await app.idle();
  await app.scan();
  assert.deepEqual(
    gladys.fake.discoveredDevices.map((d) => d.external_id),
    [DEVICE],
  );
  assert.ok(fake.calls.every((c) => c.host === ADDRESS));
  assert.equal(status(gladys).connected, true);
});

test('no read less than a read interval apart, unless the timer, a save or a creation asks', async () => {
  const { app, fake, gladys, tick } = await setup({ devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  assert.equal(reads(fake), 1);
  await app.start(CONFIG);
  await app.idle();
  await app.onDeviceUpdated({ external_id: DEVICE });
  await gladys.fake.action(ACTIONS.ACCEPT_HELD);
  await app.idle();
  assert.equal(reads(fake), 1);
  assert.equal(status(gladys).connected, true);
  await tick();
  assert.equal(reads(fake), 2);
  await app.start(CONFIG, { fresh: true });
  await app.idle();
  assert.equal(reads(fake), 3, 'a save of the form reads at once');
});

test('six batteries: each one read every 60 s, within the 300 states a minute', async () => {
  const hosts = {};
  const addresses = [];
  for (let i = 0; i < 6; i += 1) {
    const address = `192.168.1.${50 + i}:8080`;
    hosts[address] = routes({ who: identity({ sn: `SN0000${i}` }) });
    addresses.push(address.replace(':8080', ''));
  }
  const { app, fake, tick } = await setup({ hosts, config: { addresses: addresses.join(',') } });
  await app.start({ addresses: addresses.join(',') });
  await app.idle();
  assert.equal(reads(fake), 6);
  await tick();
  assert.equal(reads(fake), 6, '30 s later: not yet');
  await tick();
  assert.equal(reads(fake), 12);
});

test('the test button: model, serial, firmware of each battery, in our words otherwise', async () => {
  const r = routes();
  const { app, gladys } = await setup({ hosts: { [ADDRESS]: r } });
  await app.start(CONFIG);
  await app.idle();
  const ok = await gladys.fake.action(ACTIONS.TEST);
  assert.match(
    ok.data.message.fr,
    /Indevolt CMS-SF2000, numéro de série SF2000A1B2C3, firmware V1\.2\.3/,
  );
  r['/rpc/Sys.GetConfig'] = () => json('<html>');
  const odd = await gladys.fake.action(ACTIONS.TEST);
  assert.match(odd.data.message.fr, /n’est pas une donnée/);
  assert.doesNotMatch(odd.data.message.fr, /html/);
});

test('every connection publishes the status and the devices again', async () => {
  const { app, gladys } = await setup({ devices: [created()] });
  await app.start(CONFIG);
  await app.idle();
  const publications = () => gladys.fake.bodies('POST', '/discovered_device').length;
  const statuses = gladys.fake.connectionStatuses.length;
  const discovered = publications();
  await app.start(CONFIG);
  await app.idle();
  assert.equal(status(gladys).connected, true);
  assert.ok(publications() > discovered, 'the devices published again');
  assert.ok(gladys.fake.connectionStatuses.length > statuses, 'the status published again');
});

test('an address removed from the form: its battery (not created) leaves Discovery', async () => {
  const { app, gladys, fake } = await setup();
  await app.start(CONFIG);
  await app.idle();
  assert.equal(gladys.fake.discoveredDevices.length, 1);
  const before = fake.calls.length;
  await app.start({}, { fresh: true });
  await app.idle();
  assert.deepEqual(gladys.fake.discoveredDevices, []);
  assert.equal(fake.calls.length, before, 'no longer read');
});

test('a created device is read at its address after a restart, without the form', async () => {
  const { app, gladys } = await setup({ config: {}, devices: [created()] });
  await app.start({});
  await app.idle();
  assert.equal(last(gladys, 'soc'), 64);
});
