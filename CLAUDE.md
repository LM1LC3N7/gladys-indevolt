# CLAUDE.md

Project rules for coding assistants (Claude Code reads this file) and for human
contributors.

## What this is

A Gladys Assistant **external integration**: a Node.js service (Node 22+, ESM,
no build step) that runs in its own sandboxed Docker container and talks to
Gladys through
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js),
its only runtime dependency. It started from the official JavaScript template.

It reads **Indevolt home batteries** through their local HTTP API (port 8080):
`GET /rpc/Sys.GetConfig` and `POST /rpc/Indevolt.GetData?config={"t":[...]}`.
The requests, the keys and their meaning are ported from
[indevolt-api](https://github.com/Xirt/indevolt-api) (MIT, see
`THIRD_PARTY_NOTICES.md`); the units and the keys per generation from the Home
Assistant integration. Unofficial: not affiliated with Indevolt. The protocol
is not documented by Indevolt. **Read-only**: never `onSetValue`, never the
library's `SetData`. Siblings: `gladys-marstek` (another home battery, its
structure), `gladys-p1-monitor` and `gladys-imeon` (the index guard, the
store).

## Commands

```bash
npm install
npm test                                  # node --test, the built-in runner
node --test test/app.test.js              # one file
node --test --test-name-pattern "guard"   # tests whose name matches
npm run audit                             # npm audit --omit=dev
npm run lint                              # ESLint
npm run format:check                      # Prettier, as the CI runs it
npm run format                            # Prettier, fix in place
npx github:GladysAssistant/integration-store .   # store admission checks
```

The CI (`.github/workflows/ci.yml`) runs `format:check`, `lint` and `test` on
Node 22 and 24, and builds the Docker image: run the three commands before
pushing.

## Architecture

```
index.js                          SDK wiring only: handlers registered before connect()
src/app.js                        IndevoltApp: addresses, reads, indexes, pauses, buttons
src/indevolt/client.js            the only HTTP access (bounded body, errors in our words)
src/indevolt/model.js             the keys per generation, the answers -> values (pure)
src/guard.js                      plausibility of an energy index, from gladys-p1-monitor (pure)
src/store.js                      what /data keeps across restarts
src/devices.js                    the device, feature keys, catalog, states (pure)
src/config.js                     addresses and interval, normalized
src/constants.js                  paths, pacing, limits, manifest keys
src/i18n.js                       runtime texts (en/fr)
gladys-assistant-integration.json manifest: name, config_schema, actions, discovery...
docs/en.md, docs/fr.md            user documentation, re-hosted by Gladys (mandatory)
test/                             node --test, against the SDK's fake Gladys (integration-sdk/testing)
.github/scripts/release.mjs       release helpers (manifest bump, changelog), tested in test/
```

## Rules

- **Read-only.** No `onSetValue`, no `Indevolt.SetData`, no write register
  (`test/client.test.js` checks it). A command, if one is ever added, is a
  `button` disabled by default behind an option, never a `switch`.
- **Energy monitoring**: the five indexes of `INDEXES` (`src/devices.js`) are
  the only index features; each passes `IndexGuard` (`src/guard.js`, taken as
  it is): never 0, a drop and a jump never confirmed by repetition nor by
  time, only by the `accept_held_index` action clicked twice (the second click
  accepts only what the first listed, within 5 minutes). No `energy-sensor` /
  `index` (the battery measures no grid import), no `daily-consumption`, never
  `publishEnergyConsumption`. The counters of the day are plain sensors.
- **One read = one address**: the serial of `Sys.GetConfig`, read right
  before the values, decides the device; another battery at that address
  never writes into the previous one's device.
- **Pauses**: 429/5xx pause from 1 min to 6 h, kept in `/data` (end capped
  when read back); never a read faster than the interval; a reconnection to
  Gladys clears neither a pause nor a retry delay.
- **Hostile answers**: bodies bounded to 64 KiB, no redirect followed, own
  keys only, strict numbers, ranges checked.
- **Never a text of the battery in a message**, never a URL in the logs.
- **External ids are forever**: `battery:<serial>`, the `FEATURE` keys of
  `src/devices.js`, the manifest keys. The device published again never loses
  a feature of the created one (`entriesFor`).
- **Units**: only those of `DEVICE_FEATURE_UNITS_BY_CATEGORY` in the core
  (`test/manifest.test.js`).
- **The container rootfs is read-only.** Write only under `/data`:
  `src/store.js` keeps `/data/indevolt-state.json`.
- **Versions belong to the Release workflow** (Actions → Release). Never edit
  `version` in `package.json` or in the manifest, nor the `docker_image` tag,
  by hand. `test/manifest.test.js` checks they agree.
- **Changelog.** Every user-visible change adds a line under `## [Unreleased]`
  in `CHANGELOG.md` (`### Added`, `Changed`, `Fixed`, `Removed`, `Security`).
  Never write a version heading: the Release workflow moves the section.
- **Manifest.** Texts are multi-language objects `{ "en": ..., "fr": ... }`.
  The catalog `description` holds 10 to 100 characters per language.
- **User-facing text** is bilingual (English and French), kept in sync. Files
  are UTF-8 without BOM (`test/encoding.test.js`, sources included).
- **Style.** Prettier formats, ESLint catches mistakes. Comments explain why,
  in English. Tests never touch the network.
