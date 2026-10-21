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
      const feature = device.features.find((f) => f.external_id === F(key, who.device.sn));
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

// --- Review 1 -------------------------------------------------------------------------

const announce = (ip) => ({
  source_ip: ip,
  source_port: 8099,
  payload_base64: Buffer.from('BCF-D').toString('base64'),
});

test('I1: a battery moved by DHCP is read at its new address only, even after six moves', async () => {
  const hosts = { [ADDRESS]: routes() };
  const scanResults = { 'udp-broadcast': [announce('192.168.1.40')] };
  const { app, gladys, tick, fake } = await setup({ config: {}, hosts, scanResults });
  await app.start({});
  await app.idle();
  await app.scan();
  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
  await app.idle();
  assert.equal(last(gladys, 'soc'), 64);
  let previous = ADDRESS;
  for (let n = 41; n <= 47; n += 1) {
    const address = `192.168.1.${n}:8080`;
    delete hosts[previous];
    hosts[address] = routes();
    hosts[address].state.values[6002] = n;
    gladys.fake.scanResults['udp-broadcast'] = [announce(`192.168.1.${n}`)];
    await tick(2 * MINUTE);
    await app.scan();
    assert.equal(last(gladys, 'soc'), n, `found at .${n}`);
    assert.deepEqual([...app.targets.keys()], [address], `only .${n} is read`);
    assert.match(status(gladys).message.en, /^1 of 1 Indevolt battery answering/);
    previous = address;
  }
  const param = (name) =>
    gladys.fake.discoveredDevices[0].params.find((p) => p.name === name).value;
  assert.equal(param('INDEVOLT_ADDRESS'), '192.168.1.47:8080');
  assert.ok(fake.calls.length > 0);
});

test('I1: a full Discovery makes room for a new announcement; a typed address always stays', async () => {
  const hosts = {};
  const scanResults = { 'udp-broadcast': [] };
  for (let i = 0; i < 6; i += 1) scanResults['udp-broadcast'].push(announce(`192.168.1.${60 + i}`));
  hosts['192.168.1.70:8080'] = routes();
  const { app, gladys } = await setup({ config: {}, hosts, scanResults });
  await app.start({});
  await app.idle();
  await app.scan();
  assert.equal(app.discovered.size, 6, 'six silent addresses');
  gladys.fake.scanResults['udp-broadcast'] = [announce('192.168.1.70')];
  await app.scan();
  assert.ok(app.discovered.has('192.168.1.70:8080'));
  assert.equal(gladys.fake.discoveredDevices[0].external_id, DEVICE);
  const kept = [...app.discovered].find((a) => a !== '192.168.1.70:8080');
  app.config.addresses = [kept];
  app.forgetAddress(kept);
  assert.ok(app.discovered.has(kept), 'a typed address is never forgotten');
});

test('I2: the margin of the guard follows the generation (2 kW for the first one)', async () => {
  for (const [type, held] of [
    ['BK1600', true],
    ['CMS-SF2000', false],
  ]) {
    const who = identity({ type });
    const r = routes({ who });
    // 14 h without a rise, then +100 kWh of solar: 2 kW x 14 h = 28 kWh, 12 kW x 14 h = 168 kWh.
    const device = created({ who, index: { values: { pv_energy: 1134 }, at: NOW - 14 * HOUR } });
    const { app, gladys } = await setup({ hosts: { [ADDRESS]: r }, devices: [device] });
    await app.start(CONFIG);
    await app.idle();
    assert.equal(last(gladys, 'pv_energy'), held ? 1134 : 1234, type);
  }
});

test('I4: six batteries and a save of the form: at most 270 states in a minute', async () => {
  const hosts = {};
  const devices = [];
  const addresses = [];
  for (let i = 0; i < 6; i += 1) {
    const address = `192.168.1.${50 + i}:8080`;
    const who = identity({ sn: `SN0000${i}` });
    hosts[address] = routes({ who });
    devices.push(created({ who, address }));
    addresses.push(address);
  }
  const config = { addresses: addresses.join(',') };
  const { app, gladys, tick, clock } = await setup({ hosts, devices, config });
  await app.start(config);
  await app.idle();
  const first = gladys.fake.states.length;
  assert.ok(first > 150 && first <= 270, `${first}`);
  // 10 s later, every value changed, the form saved.
  clock.now += 10 * SECOND;
  for (const r of Object.values(hosts)) {
    for (const key of Object.keys(r.state.values)) {
      if (typeof r.state.values[key] === 'number') r.state.values[key] += 1;
    }
  }
  await app.start(config, { fresh: true });
  await app.idle();
  assert.ok(gladys.fake.states.length <= 270, `${gladys.fake.states.length} states in 10 s`);
  // The batteries left out get their values at their next read.
  await tick(MINUTE);
  for (let i = 0; i < 6; i += 1) {
    assert.equal(last(gladys, 'soc', `SN0000${i}`), 65, `SN0000${i}`);
  }
});

test('M1: a double-click is one click; M4: a held jump is logged once', async () => {
  const device = created({ index: { values: { charged_energy: 300 }, at: NOW - MINUTE } });
  const { app, gladys, tick, logger, clock } = await setup({ devices: [device] });
  await app.start(CONFIG);
  await app.idle();
  for (let i = 0; i < 10; i += 1) await tick();
  assert.equal(logger.lines.filter((l) => /held back/.test(l)).length, 1);
  await gladys.fake.action(ACTIONS.ACCEPT_HELD);
  clock.now += 100;
  const fast = await gladys.fake.action(ACTIONS.ACCEPT_HELD);
  assert.match(fast.data.message.en, /second click accepts exactly/);
  clock.now += 5 * SECOND;
  const slow = await gladys.fake.action(ACTIONS.ACCEPT_HELD);
  assert.match(slow.data.message.en, /Accepted/);
});

test('M2: foreign datagrams never push the announcement out', async () => {
  const noise = Array.from({ length: 300 }, (_, i) => ({
    source_ip: `10.0.${Math.floor(i / 250)}.${i % 250}`,
    source_port: 8099,
    payload_base64: Buffer.from('noise').toString('base64'),
  }));
  const scanResults = { 'udp-broadcast': [...noise, announce('192.168.1.40')] };
  const { app, gladys } = await setup({ config: {}, scanResults });
  await app.start({});
  await app.idle();
  await app.scan();
  assert.equal(gladys.fake.discoveredDevices[0]?.external_id, DEVICE);
});

const A40 = '192.168.1.40:8080';
const A41 = '192.168.1.41:8080';
const battery = (sn, soc) => {
  const r = routes({ who: identity({ sn }) });
  r.state.values[6002] = soc;
  return r;
};

/** Two batteries swap their addresses (DHCP): each one is read at its new address. */
async function checkSwap({ app, gladys, hosts, tick }) {
  assert.equal(last(gladys, 'soc', 'SNAAAA01'), 40);
  assert.equal(last(gladys, 'soc', 'SNBBBB01'), 41);
  hosts[A40] = battery('SNBBBB01', 51);
  hosts[A41] = battery('SNAAAA01', 50);
  await tick();
  await tick();
  assert.equal(last(gladys, 'soc', 'SNAAAA01'), 50);
  assert.equal(last(gladys, 'soc', 'SNBBBB01'), 51);
  assert.deepEqual([...app.targets.keys()].sort(), [A40, A41]);
  assert.match(status(gladys).message.en, /^2 of 2 Indevolt batteries answering/);
}

test('R1: two discovered batteries swap their addresses: both still read', async () => {
  const hosts = { [A40]: battery('SNAAAA01', 40), [A41]: battery('SNBBBB01', 41) };
  const scanResults = { 'udp-broadcast': [announce('192.168.1.40'), announce('192.168.1.41')] };
  const setupDone = await setup({ config: {}, hosts, scanResults });
  const { app, gladys } = setupDone;
  await app.start({});
  await app.idle();
  await app.scan();
  for (const device of gladys.fake.discoveredDevices) {
    await gladys.fake.deviceCreated(device);
    await app.idle();
  }
  await checkSwap(setupDone);
});

test('R1: two batteries only created (after a restart) swap their addresses: both still read', async () => {
  const hosts = { [A40]: battery('SNAAAA01', 40), [A41]: battery('SNBBBB01', 41) };
  const devices = [
    created({ who: identity({ sn: 'SNAAAA01' }), address: A40 }),
    created({ who: identity({ sn: 'SNBBBB01' }), address: A41 }),
  ];
  const setupDone = await setup({ config: {}, hosts, devices });
  await setupDone.app.start({});
  await setupDone.app.idle();
  await checkSwap(setupDone);
});

test('R1: a move whose old address is read after the new one leaves one address', async () => {
  const hosts = { [A41]: battery('SNAAAA01', 40) };
  const scanResults = { 'udp-broadcast': [announce('192.168.1.41')] };
  // The new address is typed (read first), the old one discovered (read after).
  const config = { addresses: '192.168.1.42' };
  const { app, gladys, tick } = await setup({ config, hosts, scanResults });
  await app.start(config);
  await app.idle();
  await app.scan();
  await gladys.fake.deviceCreated(gladys.fake.discoveredDevices[0]);
  await app.idle();
  delete hosts[A41];
  hosts['192.168.1.42:8080'] = battery('SNAAAA01', 42);
  for (let i = 0; i < 8; i += 1) await tick();
  assert.equal(last(gladys, 'soc', 'SNAAAA01'), 42);
  assert.deepEqual([...app.targets.keys()], ['192.168.1.42:8080']);
  assert.match(status(gladys).message.en, /^1 of 1 Indevolt battery answering/);
});

test('M6: /data written once a round, never once a battery', async () => {
  const base = createMemoryStore();
  let saves = 0;
  const store = { ...base, load: base.load, save: async (s) => ((saves += 1), base.save(s)) };
  const hosts = {};
  const devices = [];
  const addresses = [];
  for (let i = 0; i < 2; i += 1) {
    const address = `192.168.1.${50 + i}:8080`;
    const who = identity({ sn: `SN0000${i}` });
    hosts[address] = routes({ who });
    devices.push(created({ who, address }));
    addresses.push(address);
  }
  const config = { addresses: addresses.join(',') };
  const { app, tick } = await setup({ hosts, devices, config, store });
  await app.start(config);
  await app.idle();
  const before = saves;
  for (let i = 0; i < 5; i += 1) {
    for (const r of Object.values(hosts)) r.state.values[6006] += 0.01;
    await tick();
  }
  assert.ok(saves - before <= 5, `${saves - before} saves in 5 rounds`);
});
