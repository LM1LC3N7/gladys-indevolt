// -----------------------------------------------------------------------------
// The integration itself: the batteries (typed in the configuration, found by
// their announcements on the network, or created in Gladys), read every 30 s
// (Sys.GetConfig, then Indevolt.GetData), their devices, the five energy
// indexes checked by their guards, the pauses kept in /data, the test and
// accept buttons. index.js only wires the SDK handlers to it.
//
// READ-ONLY: nothing is ever sent to a battery but the two reads; no charge,
// no discharge, no change of mode or limit (no onSetValue at all).
//
// A read is one address: whoever answers there (its serial, read right
// before the values) gets the values. Another battery at that address after
// a DHCP swap gets its own device, never the history of the previous one.
//
// The created devices are read from `gladys.devices`, which the SDK keeps up
// to date (connection, creation, update, deletion): never a copy of our own.
//
// Two clocks: `now` (wall clock) dates the indexes and the pauses kept in
// /data; `monotonic` paces the reads and retries, so that a wall clock set
// back never stops them.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { normalizeConfig, parseAddress } from './config.js';
import {
  ACCEPT_CONFIRM_WITHIN,
  DISCOVERY_MAGIC,
  DISCOVERY_SECONDS,
  INDEX_MAX_KW,
  INDEX_SLACK_KWH,
  MAX_BATTERIES,
  PAUSE_MAX,
  PAUSE_MIN,
  RETRY_MAX,
  RETRY_MIN,
  SPACING_PER_BATTERY,
  STATE_HEARTBEAT,
  TEST_ANSWER_WITHIN,
} from './constants.js';
import { INDEXES, buildDevice, ids, readStates, round } from './devices.js';
import { IndexGuard } from './guard.js';
import { T } from './i18n.js';
import { IndevoltClient } from './indevolt/client.js';
import { KEYS, parseValues } from './indevolt/model.js';
import { createFileStore } from './store.js';

const defaultTimers = { setTimeout, clearTimeout, setInterval, clearInterval };

const GUARD_LIMITS = { maxKw: INDEX_MAX_KW, slackKwh: INDEX_SLACK_KWH };

/** A timer that fires a little early still reads (the pace of the timer itself). */
const PACE_TOLERANCE = 1000;

const SERIAL = /^[A-Za-z0-9_-]{4,40}$/;

const param = (device, name) => device?.params?.find((p) => p.name === name)?.value;

/** The index Gladys already holds for a feature of a created device, when it says so. */
function lastValueOf(device, featureId) {
  const feature = (device?.features ?? []).find((f) => f.external_id === featureId);
  const value = Number(feature?.last_value);
  const at = Date.parse(feature?.last_value_changed ?? '');
  return feature?.last_value !== null &&
    feature?.last_value !== undefined &&
    Number.isFinite(value) &&
    Number.isFinite(at)
    ? { value, at }
    : undefined;
}

/** A pause read back from /data: `{ until, count, code, status }`, its end capped from now. */
function validPause(pause, now) {
  if (
    !pause ||
    !Number.isFinite(pause.until) ||
    !Number.isInteger(pause.count) ||
    pause.count < 1 ||
    (pause.code !== 'rate_limited' && pause.code !== 'server')
  ) {
    return undefined;
  }
  return {
    until: Math.min(pause.until, now + PAUSE_MAX),
    count: Math.min(pause.count, 32),
    code: pause.code,
    status: Number.isInteger(pause.status) ? pause.status : null,
  };
}

/** An address to read, and how it went (kept across reconnections, in memory). */
function newTarget(address) {
  return {
    address,
    failures: 0,
    nextTryAt: 0,
    lastError: undefined,
    /** HTTP 429/5xx: `{ until, count, code, status }`, kept in /data. */
    pause: undefined,
    /** Monotonic time of the last read started. */
    lastReadAt: undefined,
    /** The serial of the battery that answered the last good read. */
    serial: undefined,
  };
}

export class IndevoltApp {
  constructor({
    gladys,
    logger = createLogger({ name: 'indevolt' }),
    now = Date.now,
    monotonic = () => performance.now(),
    timers = defaultTimers,
    client,
    store = createFileStore(),
  }) {
    this.gladys = gladys;
    this.logger = logger;
    this.now = now;
    this.monotonic = monotonic;
    this.timers = timers;
    this.client = client ?? new IndevoltClient({ now });
    /** /data: the guards and the pauses. */
    this.store = store;
    this.savedKey = undefined;
    this.config = normalizeConfig();
    /** address (`host:port`) -> target. */
    this.targets = new Map();
    /** Addresses found by the announcements, kept until the container stops. */
    this.discovered = new Set();
    /** serial -> { serial, model, generation, firmware, address }. */
    this.batteries = new Map();
    /** By index feature external id: IndexGuard. */
    this.guards = new Map();
    /** The first click of "Accept the held index": `{ at, list }`, in memory only. */
    this.pendingAccept = undefined;
    this.publishedDevices = undefined;
    const kept = store.load();
    /** address -> pause read back from /data. */
    this.savedPauses = new Map();
    if (kept.pauses && typeof kept.pauses === 'object') {
      for (const [address, pause] of Object.entries(kept.pauses)) {
        const valid = validPause(pause, now());
        if (valid && !parseAddress(address).error) {
          this.savedPauses.set(address, valid);
        }
      }
    }
    this.timer = undefined;
    this.busy = undefined;
    this.busyGeneration = undefined;
    this.firstRun = Promise.resolve();
    this.lastStatus = undefined;
    this.generation = 0;
    this.lifecycle = Promise.resolve();
  }

  // --- Lifecycle -------------------------------------------------------------

  /**
   * `fresh`: the user saved the form (not a reconnection): the retry delays
   * and the pauses end. It accepts no index held back.
   */
  start(raw = {}, { fresh = false } = {}) {
    return this.serialize(() => this.doStart(raw, { fresh }));
  }

  stop() {
    return this.serialize(() => this.doStop());
  }

  /** Resolves once every queued start/stop and the first read after it are done (tests). */
  async idle() {
    await this.lifecycle;
    await this.firstRun;
  }

  serialize(job) {
    const run = this.lifecycle.then(job, job);
    this.lifecycle = run.catch(() => {});
    return run;
  }

  async doStart(raw, { fresh = false } = {}) {
    await this.doStop();
    const generation = ++this.generation;
    this.config = normalizeConfig(raw);
    this.loadCreated();
    this.rebuildTargets();
    if (fresh) {
      let saved = false;
      for (const target of this.targets.values()) {
        target.failures = 0;
        target.nextTryAt = 0;
        target.lastError = undefined;
        if (target.pause) {
          target.pause = undefined;
          saved = true;
        }
      }
      if (saved) {
        await this.saveState();
      }
    }
    // The core keeps the connection status and the Discovery list in memory:
    // a restarted Gladys has lost them, so they are always sent again.
    this.lastStatus = undefined;
    this.publishedDevices = undefined;
    this.gladys.forgetPublishedStates?.();
    await this.discover();
    await this.updateStatus({ starting: true });
    // Always armed, whatever the first read gives: never a dead integration.
    this.timer = this.timers.setInterval(
      () => this.run(generation, () => this.round()),
      this.config.pollInterval * 1000,
    );
    // Not awaited: a start (a save of the form) answers at once. A
    // reconnection less than a read after the last one waits for the timer.
    this.firstRun = this.run(generation, () => this.round({ force: fresh }));
  }

  async doStop() {
    this.generation += 1;
    if (this.timer !== undefined) {
      this.timers.clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  /** Run a job of a generation: nothing after a restart. */
  async run(generation, job) {
    if (generation !== this.generation) {
      return;
    }
    try {
      await job();
    } catch (err) {
      this.logger.error(`Indevolt: unexpected error (${err?.name ?? 'Error'})`);
    }
  }

  async setStatus(connected, message) {
    const key = JSON.stringify([connected, message ?? null]);
    if (key === this.lastStatus) {
      return;
    }
    this.lastStatus = key;
    await this.gladys
      .setConnectionStatus(connected, message)
      .catch((err) => this.logger.warn(`setConnectionStatus failed: ${err.message}`));
  }

  // --- Batteries and addresses -----------------------------------------------------

  /** The batteries created in Gladys: their serial, address and generation are in the params. */
  loadCreated() {
    for (const device of this.gladys.devices ?? []) {
      const serial = String(param(device, 'INDEVOLT_SERIAL') ?? '');
      const parsed = parseAddress(param(device, 'INDEVOLT_ADDRESS'));
      if (
        !SERIAL.test(serial) ||
        !parsed.address ||
        device.external_id !== this.external(serial).device
      ) {
        continue;
      }
      const known = this.batteries.get(serial);
      if (known) {
        continue;
      }
      if (this.batteries.size >= MAX_BATTERIES) {
        break;
      }
      const model = param(device, 'INDEVOLT_MODEL');
      const firmware = param(device, 'INDEVOLT_FIRMWARE');
      this.batteries.set(serial, {
        serial,
        model: typeof model === 'string' && model ? model : undefined,
        generation: param(device, 'INDEVOLT_GENERATION') === '2' ? 2 : 1,
        firmware: typeof firmware === 'string' && firmware ? firmware : undefined,
        address: parsed.address,
      });
    }
  }

  /** The addresses to read: typed, then created, then discovered (at most MAX_BATTERIES). */
  rebuildTargets() {
    const created = [...this.batteries.values()].filter((b) => this.createdDevice(b.serial));
    const wanted = [...this.config.addresses, ...created.map((b) => b.address), ...this.discovered];
    const next = new Map();
    for (const address of wanted) {
      if (next.has(address) || next.size >= MAX_BATTERIES) {
        continue;
      }
      const target = this.targets.get(address) ?? newTarget(address);
      if (this.savedPauses.has(address)) {
        // Read back from /data once: a save of the form that ends it is final.
        target.pause ??= this.savedPauses.get(address);
        this.savedPauses.delete(address);
      }
      next.set(address, target);
    }
    this.targets = next;
    // A battery no longer created nor at an address read (removed from the
    // form) leaves the Discovery list.
    for (const [serial, battery] of this.batteries) {
      if (!next.has(battery.address) && !this.createdDevice(serial)) {
        this.batteries.delete(serial);
      }
    }
  }

  external(serial) {
    return ids(this.gladys, serial);
  }

  /** The created Gladys device of a battery, undefined until the user creates it. */
  createdDevice(serial) {
    const id = this.external(serial).device;
    return (this.gladys.devices ?? []).find((d) => d.external_id === id);
  }

  /** A short name of a battery in the texts: its model and serial. */
  label(battery) {
    return [battery.model, battery.serial].filter(Boolean).join(' ');
  }

  async discover({ force = false } = {}) {
    const devices = [...this.batteries.values()].map((b) =>
      buildDevice(this.gladys, b, this.createdDevice(b.serial)),
    );
    const json = JSON.stringify(devices);
    if (!force && json === this.publishedDevices) {
      return;
    }
    this.publishedDevices = json;
    await this.gladys
      .publishDiscoveredDevices(devices)
      .catch((err) => this.logger.warn(`Publishing the Indevolt devices failed: ${err.message}`));
  }

  /**
   * The Discover tab asks: the announcements captured by the core (a `BCF-D`
   * datagram on UDP 8099), a read of the new addresses, then the list.
   */
  async scan() {
    const generation = this.generation;
    let results = [];
    try {
      results = await this.gladys.scanNetwork('udp-broadcast', {
        timeoutSeconds: DISCOVERY_SECONDS,
      });
    } catch (err) {
      this.logger.warn(`Indevolt discovery failed: ${err.message}`);
    }
    let added = 0;
    for (const result of Array.isArray(results) ? results.slice(0, 200) : []) {
      const payload = Buffer.from(String(result?.payload_base64 ?? '').slice(0, 2048), 'base64');
      if (!payload.subarray(0, DISCOVERY_MAGIC.length).equals(Buffer.from(DISCOVERY_MAGIC))) {
        continue;
      }
      const parsed = parseAddress(typeof result.source_ip === 'string' ? result.source_ip : '');
      if (parsed.address && !this.discovered.has(parsed.address)) {
        if (this.discovered.size >= MAX_BATTERIES) {
          break;
        }
        this.discovered.add(parsed.address);
        added += 1;
      }
    }
    if (generation !== this.generation) {
      return;
    }
    if (added > 0) {
      this.logger.info(`Indevolt discovery: ${added} new address(es)`);
      this.rebuildTargets();
    }
    // The new addresses are read now; the others keep their pace.
    await this.run(generation, () => this.round());
    await this.discover({ force: true });
  }

  async onDeviceCreated(device) {
    const battery = [...this.batteries.values()].find(
      (b) => this.external(b.serial).device === device?.external_id,
    );
    if (!battery) {
      return;
    }
    // A new device: no reference of its indexes yet (nor a state kept in
    // /data for a deleted device of the same id), its values right away.
    const kept = this.store.load();
    for (const { key } of INDEXES) {
      const id = this.external(battery.serial).feature(key);
      this.guards.delete(id);
      if (kept.indexes) delete kept.indexes[id];
    }
    await this.store
      .save(kept)
      .catch((err) =>
        this.logger.warn(`Clearing the Indevolt index state failed (${err?.code ?? 'error'})`),
      );
    this.savedKey = undefined;
    this.rebuildTargets();
    await this.run(this.generation, () => this.round({ force: true, only: battery.address }));
  }

  async onDeviceUpdated(device) {
    if (
      [...this.batteries.values()].some(
        (b) => this.external(b.serial).device === device?.external_id,
      )
    ) {
      // Read now unless a read was made less than a read interval ago.
      await this.run(this.generation, () => this.round());
    }
  }

  // --- /data -------------------------------------------------------------------------

  /** Keeps the guards and the pauses in /data when they changed. */
  async saveState() {
    const indexes = {};
    for (const [id, guard] of this.guards) {
      indexes[id] = guard.state();
    }
    const pauses = {};
    for (const target of this.targets.values()) {
      if (target.pause) {
        pauses[target.address] = target.pause;
      }
    }
    const kept = this.store.load();
    const state = {
      pauses,
      indexes: {
        ...(kept.indexes && typeof kept.indexes === 'object' ? kept.indexes : {}),
        ...indexes,
      },
    };
    const key = JSON.stringify(state);
    if (key === this.savedKey) {
      return;
    }
    try {
      await this.store.save(state);
      this.savedKey = key;
    } catch (err) {
      this.logger.warn(`Saving the Indevolt state in /data failed (${err?.code ?? 'error'})`);
    }
  }

  // --- Reads -------------------------------------------------------------------------

  /** The time between two reads of an address: the interval, more with many batteries. */
  readGap() {
    return Math.max(this.config.pollInterval * 1000, SPACING_PER_BATTERY * this.targets.size);
  }

  /** The wait after a failure: never faster than a read, doubled up to 15 min. */
  retryWait(failures) {
    const first = Math.max(RETRY_MIN, this.readGap());
    return Math.min(first * 2 ** failures, Math.max(RETRY_MAX, first));
  }

  /**
   * One round over the addresses; a round still running is never doubled.
   * Without `force` (a reconnection, an update, a scan, an acceptance), an
   * address read less than a read interval ago waits. `only`: one address.
   */
  round({ force = false, only } = {}) {
    if (this.busy) {
      if (this.busyGeneration === this.generation) {
        return this.busy;
      }
      return this.busy.then(() => this.round({ force, only }));
    }
    this.busyGeneration = this.generation;
    this.busy = this.doRound(force, only).finally(() => {
      this.busy = undefined;
    });
    return this.busy;
  }

  async doRound(force, only) {
    const generation = this.generation;
    const gone = () => generation !== this.generation;
    for (const target of [...this.targets.values()]) {
      if (gone()) return;
      if (only && target.address !== only) continue;
      const mono = this.monotonic();
      if (mono < target.nextTryAt) continue;
      if (target.pause && this.now() < target.pause.until) continue;
      if (
        !force &&
        target.lastReadAt !== undefined &&
        mono - target.lastReadAt < this.readGap() - PACE_TOLERANCE
      ) {
        continue;
      }
      await this.readTarget(target, gone);
    }
    if (gone()) return;
    await this.discover();
    await this.saveState();
    await this.updateStatus();
  }

  async readTarget(target, gone) {
    const mono = this.monotonic();
    target.lastReadAt = mono;
    let identity;
    let raw;
    try {
      // Who answers at this address, right before its values.
      identity = await this.client.readIdentity(target.address);
      raw = await this.client.readValues(target.address, KEYS[identity.generation]);
    } catch (err) {
      if (!gone()) await this.failed(target, err, mono);
      return;
    }
    if (gone()) return;
    target.failures = 0;
    target.nextTryAt = 0;
    target.lastError = undefined;
    target.pause = undefined;
    let battery = this.batteries.get(identity.serial);
    if (!battery) {
      if (this.batteries.size >= MAX_BATTERIES) {
        this.logger.warn(
          `More than ${MAX_BATTERIES} Indevolt batteries: ${identity.serial} ignored`,
        );
        return;
      }
      battery = { serial: identity.serial };
      this.batteries.set(identity.serial, battery);
      this.logger.info(`Indevolt battery ${identity.serial} at ${target.address}`);
    } else if (battery.address !== target.address) {
      this.logger.info(`Indevolt battery ${identity.serial} now answers at ${target.address}`);
    }
    if (target.serial && target.serial !== identity.serial) {
      // DHCP: the address now belongs to another battery. The previous one
      // gets nothing from here (its device keeps its history).
      this.logger.warn(`${target.address} now answers as ${identity.serial}, not ${target.serial}`);
    }
    target.serial = identity.serial;
    Object.assign(battery, {
      model: identity.model,
      generation: identity.generation,
      firmware: identity.firmware,
      address: target.address,
    });
    await this.publish(battery, parseValues(raw, identity.generation));
  }

  async failed(target, err, mono) {
    const code = err?.code ?? 'error';
    target.lastError = err;
    // Our own words only (IndevoltError codes): never a text of the battery.
    this.logger.warn(
      `Indevolt read of ${target.address} failed: ${code}${err?.status ? ` ${err.status}` : ''}`,
    );
    if (code === 'rate_limited' || code === 'server') {
      const count = (target.pause?.count ?? 0) + 1;
      const asked = err.retryAfter ?? PAUSE_MIN * 2 ** (count - 1);
      const wait = Math.min(Math.max(asked, PAUSE_MIN, this.readGap()), PAUSE_MAX);
      target.pause = { until: this.now() + wait, count, code, status: err.status ?? null };
      target.nextTryAt = mono + wait;
      await this.saveState();
      return;
    }
    const wait = this.retryWait(target.failures);
    target.failures += 1;
    target.nextTryAt = mono + wait;
  }

  /** The guard of an index of a created device, from Gladys and /data. */
  guardOf(created, id) {
    if (!this.guards.has(id)) {
      const saved = this.store.load().indexes?.[id];
      this.guards.set(
        id,
        new IndexGuard(lastValueOf(created, id), saved, this.now(), GUARD_LIMITS),
      );
    }
    return this.guards.get(id);
  }

  /** The states of a read, the indexes through their guard. */
  async publish(battery, values) {
    const created = this.createdDevice(battery.serial);
    if (!created) {
      return;
    }
    const external = this.external(battery.serial);
    const now = this.now();
    const indexes = {};
    for (const { key, value } of INDEXES) {
      const id = external.feature(key);
      const guard = this.guardOf(created, id);
      const total = values[value] === undefined ? undefined : round(values[value], 3);
      if (total === undefined) {
        // Not in this answer: the last accepted value keeps its date in Gladys.
        indexes[key] = guard.held ? guard.last?.value : undefined;
        continue;
      }
      const plausible = guard.accept(total, now);
      if (!plausible && total > 0) {
        this.logger.warn(
          `Indevolt ${battery.serial} ${key} ${guard.held?.direction === 'down' ? 'drop' : 'jump'} held back: the "Accept the held index" button takes it`,
        );
      }
      // While a value is held, the last accepted one is sent again (no delta for the core).
      indexes[key] = plausible ? total : guard.held ? guard.last?.value : undefined;
    }
    // The guards are in /data BEFORE Gladys gets the values: a crash in
    // between never sends an index /data does not know.
    await this.saveState();
    const features = new Set((created.features ?? []).map((f) => f.external_id));
    // Only the features the created device has (they are fixed at its creation).
    const states = readStates(external, values, indexes).filter((s) =>
      features.has(s.device_feature_external_id),
    );
    if (states.length === 0) {
      return;
    }
    await this.gladys
      .publishChangedStates(states, { heartbeat: STATE_HEARTBEAT })
      .catch((err) => this.logger.warn(`Publishing the Indevolt values failed: ${err.message}`));
  }

  // --- Status ------------------------------------------------------------------------

  /** Every index held back, of every created device: `{ id, label, name, direction, from, to }`. */
  heldList() {
    const list = [];
    for (const battery of this.batteries.values()) {
      const created = this.createdDevice(battery.serial);
      if (!created) continue;
      for (const { name, key } of INDEXES) {
        const id = this.external(battery.serial).feature(key);
        const held = this.guardOf(created, id).held;
        if (held) {
          list.push({ id, label: this.label(battery), name, ...held });
        }
      }
    }
    return list;
  }

  async updateStatus({ starting = false } = {}) {
    const targets = [...this.targets.values()];
    const bad =
      this.config.invalidAddresses.length > 0 ? [T.badAddresses(this.config.invalidAddresses)] : [];
    if (targets.length === 0) {
      await this.setStatus(false, bad.length > 0 ? bad[0] : T.notConfigured);
      return;
    }
    const now = this.now();
    const mono = this.monotonic();
    const answering = targets.filter(
      (t) => t.serial && !t.lastError && !(t.pause && now < t.pause.until),
    );
    if (starting && answering.length === 0 && targets.every((t) => !t.lastError && !t.pause)) {
      await this.setStatus(false, T.connecting);
      return;
    }
    const notes = [];
    for (const t of targets) {
      if (t.pause && now < t.pause.until) {
        notes.push(T.paused(t.address, t.pause, t.pause.until - now));
      } else if (t.lastError) {
        notes.push(T.failing(t.address, t.lastError, Math.max(0, t.nextTryAt - mono)));
      }
    }
    const withoutDevice = [...this.batteries.values()].filter(
      (b) => !this.createdDevice(b.serial),
    ).length;
    if (withoutDevice > 0) {
      notes.push(T.notes.noDevice(withoutDevice));
    }
    const held = this.heldList();
    if (held.length > 0) {
      notes.push(T.notes.held(held));
    }
    notes.push(...bad);
    await this.setStatus(answering.length > 0, T.status(answering.length, targets.length, notes));
  }

  // --- Configuration screen buttons -------------------------------------------------

  /**
   * "Accept the held index", in two clicks: the first lists every index held
   * (nothing is accepted), the second, within 5 minutes, accepts exactly what
   * the first listed, and only when it still shows that value (or what may
   * have come since, src/guard.js). A save of the form never accepts.
   */
  async acceptHeldIndex() {
    const list = this.heldList();
    const mono = this.monotonic();
    const now = this.now();
    const pending = this.pendingAccept;
    this.pendingAccept = undefined;
    if (!pending || mono - pending.at > ACCEPT_CONFIRM_WITHIN) {
      if (list.length === 0) {
        return T.accept.nothing;
      }
      this.pendingAccept = { at: mono, listedAt: now, list };
      return T.accept.confirm(list, ACCEPT_CONFIRM_WITHIN);
    }
    const accepted = [];
    const changed = [];
    for (const entry of pending.list) {
      const guard = this.guards.get(entry.id);
      const held = guard?.held;
      const margin = guard ? guard.margin(pending.listedAt, now) : 0;
      const same =
        held &&
        held.direction === entry.direction &&
        held.from === entry.from &&
        (entry.direction === 'up'
          ? held.to >= entry.to && held.to - entry.to <= margin
          : Math.abs(held.to - entry.to) <= margin);
      if (same && guard.acceptHeld()) {
        accepted.push({ ...entry, to: held.to });
      } else if (held) {
        changed.push(entry);
      }
    }
    if (accepted.length === 0 && changed.length === 0) {
      return T.accept.nothing;
    }
    for (const { label, name, direction } of accepted) {
      this.logger.info(
        `Indevolt ${label} ${name} index ${direction === 'down' ? 'drop' : 'jump'} accepted by the user`,
      );
    }
    // Published at the next read of the battery (now, unless one was made
    // less than a read interval ago or a pause runs).
    this.firstRun = this.run(this.generation, () => this.round());
    return T.accept.done(accepted, changed);
  }

  /** The test button: Sys.GetConfig of every address, once (never during a pause). */
  async testConnection() {
    const targets = [...this.targets.values()].slice(0, MAX_BATTERIES);
    if (targets.length === 0) {
      return this.config.invalidAddresses.length > 0
        ? T.badAddresses(this.config.invalidAddresses)
        : T.test.none;
    }
    let timer;
    const late = new Promise((resolve) => {
      timer = this.timers.setTimeout(() => resolve(T.test.slow), TEST_ANSWER_WITHIN);
    });
    try {
      return await Promise.race([this.check(targets), late]);
    } finally {
      this.timers.clearTimeout(timer);
    }
  }

  async check(targets) {
    const lines = [];
    for (const target of targets) {
      const now = this.now();
      if (target.pause && now < target.pause.until) {
        // A click never makes a request the pause forbids.
        lines.push(T.test.waiting(target.address, target.pause.until - now));
        continue;
      }
      const mono = this.monotonic();
      try {
        const identity = await this.client.readIdentity(target.address);
        lines.push(T.test.ok(target.address, identity));
      } catch (err) {
        if (['rate_limited', 'server'].includes(err?.code)) {
          // The same rule as a read: a 429/5xx pauses.
          await this.failed(target, err, mono);
        }
        lines.push(T.test.failed(target.address, err));
      }
    }
    return T.test.lines(lines);
  }
}
