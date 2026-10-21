# TODO

## Before announcing

- [ ] Test on a real Gladys 5.2+ with a real Indevolt battery (ideally a
      first-generation BK1600 and a second-generation SolidFlex 2000): test
      button, discovery, device creation, the indexes in the energy
      monitoring.
- [ ] Test the Docker image (no Docker on the development PC yet).
- [ ] Run the store validator (`npx github:GladysAssistant/integration-store .`):
      the development agent could not run it.
- [ ] Turn on "Private vulnerability reporting" (SECURITY.md points there).
- [ ] Add the `gladys-assistant-integration` topic to publish in the store
      (after the first release: the store validator needs the GHCR image).

## To confirm on a real battery (built without one)

- [ ] That the firmware takes the `config` query with `{`, `}` and `"`
      percent-encoded (`%7B%22t%22:[...]%7D`, what an HTTP client sends) and
      a POST without a body, as the library's aiohttp request.
- [ ] The answer of GetData: a flat object `{ "<key>": value }` with numbers
      (Home Assistant reads it as is); the units (kWh for most counters, Wh
      for 1505 and 11034).
- [ ] The sign of the battery power (6000) and of the meter power
      (21028 / 11016): the charge and discharge powers come from the state
      (6001), whatever the sign; the meter stays a plain sensor until its sign
      is known (then `grid-sensor` / `power`).
- [ ] The `BCF-D` announcement on UDP 8099: how often a battery sends it
      (the core listens 10 s per scan).
- [ ] Whether a firmware update resets a lifetime counter (the guard holds it
      until the user accepts).
- [ ] The off-grid output counter (2105) on a battery without a backup
      output: 0 forever (then never published).

## Decisions

- **Versions**: 0.1.0 set once by hand when leaving the template (package,
  lock file, manifest, image tag `ghcr.io/lm1lc3n7/gladys-indevolt:0.1.0`), as
  for the sibling integrations; the Release workflow owns them from now on
  (the first patch release gives 0.1.1).
- **Reused project**: indevolt-api (Xirt, MIT, 1.8.8, `main` at commit
  5b7215b), cloned read-only in `_ref/indevolt-api`, ported to JavaScript:
  the two requests, the keys, the second-generation models, the passive
  discovery. The keys per generation, units and state codes come from the
  Home Assistant integration (Apache-2.0, `_ref/ha-indevolt`). The SDK stays
  the only runtime dependency. The guard, the store and the address parser
  come from gladys-p1-monitor through gladys-imeon (guard file identical to
  gladys-imeon's: the approved guard with `maxKw` as a parameter); the
  structure (several batteries, typed or discovered, by serial) from
  gladys-marstek; the 30-minute production from gladys-apsystems. The
  template's demo files were removed (`git rm`).
- **Read-only (v1)**: no `onSetValue`, no forced charge or discharge, no
  energy mode, no limit, no light or bypass switch. The energy mode and the
  reserve are read-only codes. `SetData` is not ported (tested).
- **External id**: `battery:<serial>` (the `Sys.GetConfig` serial, checked
  `[A-Za-z0-9_-]{4,40}`); the address is only a param (`INDEVOLT_ADDRESS`),
  with the model, generation and firmware, so that a created device is read
  after a restart without the form.
- **One read = one address**: `Sys.GetConfig` before every `GetData` (one
  more small GET every 30 s), so the serial that answers decides the device
  (DHCP swap: the values go to the other battery's own device). Review 1, M3:
  GetData also asks key 0 (the serial, `IndevoltSystem.SERIAL_NUMBER`); a
  serial of a plausible shape that differs from `Sys.GetConfig`'s skips the
  read. When key 0 is absent or odd (its format is not confirmed), a swap
  between the two requests (a few ms) is the risk left; the indexes stay
  protected by the guard.
- **DHCP move** (review 1, I1): a serial answering at a new address forgets
  its old address (out of the discovered ones and the targets, unless typed or
  another battery answered there); a full Discovery (six addresses) evicts a
  discovered address that is silent, failing or not answering yet, so a new
  announcement is never ignored. The same serial at two addresses in a round
  (a host name and its IP) is read at the first only (typed, then created,
  then discovered), logged once.
- **Connection: close** (review 1, I3): every request sends it, as the
  library ("prevent keep-alive reuse on embedded firmware"): Node's fetch would
  otherwise reuse a connection the firmware may not serve again.
- **Energy indexes (lot 6 rules)**: the lifetime counters charged (6006),
  discharged (6007), AC output (2104), off-grid output (2105) and solar
  (1505, Wh → kWh) are the indexes (`battery-storage` / `charge-index`,
  `discharge-index`, `home-output-sensor` / `index`, `off-grid-index`,
  `energy-production-sensor` / `index` with its `thirty-minutes-production`
  declared with UUID v5 ids). Each passes the IndexGuard with `maxKw` by
  generation (review 1, I2): 2 kW for the first (the library: 1.2 kW charge,
  0.8 kW discharge), 12 kW for the second (10.8 kW), and `slackKwh` 0.5; the
  same margin bounds the second click. The AC input
  (2107) and bypass (11034) counters, whose role is not documented, are plain
  sensors; the counters of the day too. No `energy-sensor` / `index`: the
  battery measures no grid import, nothing is billed. No `daily-*`, no
  `publishEnergyConsumption` (tested).
- **Acceptance in two clicks** (lot 11 brief): the first click of "Accept the
  held index" lists every index held and accepts nothing; the second, from
  3 s (review 1, M1: a double-click is one click) to 5 minutes later, accepts only the indexes listed, and only when each still shows
  the listed value (a jump may have grown by at most the margin of the guard
  since). The guard then bounds the acceptance as in gladys-p1-monitor. The
  pending list lives in memory only.
- **Powers**: `charge_power` / `discharge_power` (`battery-storage`) from the
  absolute battery power and the state (1001 charging, 1002 discharging,
  1000 both 0); `output_power` (2108, `home-output-sensor` / `power`);
  `pv_power` (1501, `energy-production-sensor` / `power`); every other power is
  a plain sensor in W (signed ones from -100 kW to 100 kW).
- **Units**: only those of `DEVICE_FEATURE_UNITS_BY_CATEGORY` (tested); Hz,
  minutes, the rated capacity, the reserve go in plain sensors with the unit
  in the name.
- **Enums** as integers with the meaning in the name: battery state (0-2),
  energy mode (0, 1, 4, 5), operating mode (0-2).
- **Generations**: as the library, the five models it lists are generation 2,
  any other one is 1. Each generation reads its own keys (fewer than 50, one
  request); the device of a generation never loses a feature it was created
  with.
- **Pace**: 30 s by default (Home Assistant), 30-300 s; reads only happen at
  the ticks of the interval: from four batteries on, each battery is read every
  two intervals (review 1, M5). `publishChangedStates` with a 10-minute
  heartbeat.
- **States per minute** (review 1, I4): a sliding budget of 270 states over
  60 s (the core refuses a whole batch beyond 300 in its minute): a battery
  whose batch would go beyond is not sent at this read (its values go at its
  next read). A save of the form no longer forgets the published states (only
  a (re)connection to Gladys does), so it never sends every value twice in a
  minute. Six second-generation batteries: 204 states a read.
- **/data writes** (review 1, M6): one save a round, after every battery was
  read and BEFORE any value is sent (a crash in between never sends an index
  /data does not know); a pause saves at once.
- **Logs** (review 1, M4): a held index is logged once per hold, a seventh
  battery once.
- **Discovery results** (review 1, M2): the `BCF-D` announcements are kept
  first, then bounded (200), so foreign datagrams on 8099 never push them out.
- **429 / 5xx**: pause `{ until, count, code, status }` per address in
  `/data`, from Retry-After or 1 min doubled, bounded 1 min - 6 h; the end
  read back from `/data` is capped at 6 h from the load; the test button never
  asks a paused battery.
- **Unreachable**: 1 min (never faster than a read), doubled up to 15 min;
  kept across reconnections, reset by a save of the form.
- **No credentials**: the local API asks for none, so there is no secret and
  no "credentials refused" stop. A 401/403 is an HTTP error (retried with the
  delays above).
- **Hostile answers**: bodies bounded to 64 KiB, no redirect followed, JSON
  parsed once, own keys only (the merged answer has no prototype), strict
  numbers (`num`), ranges checked, serial, model and firmware checked by
  pattern before being shown.
- **No custom User-Agent**, no imitation: Node's own fetch, the requests of
  the library. No Bluetooth.
- **Discovery**: passive (`udp-broadcast` on 8099, the `BCF-D` announcements,
  no packet sent), not the active `AT+IGDEVICEIP` broadcast whose answers go
  to a fixed port 10000 the core does not listen to.
- **Gladys version**: `>=5.2.0`, like the other energy integrations.

## Ideas

- The battery packs (SOC, SOH, temperatures, voltages of up to six packs, gen 2).
- The meter power as `grid-sensor` / `power` once its sign is confirmed.
- Commands (real-time charge/discharge, energy mode, reserve) as buttons behind
  options disabled by default, the stop never blocked, once tested on a real
  battery.
