# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [0.1.2] - 2026-10-23

## [0.1.1] - 2026-10-21

### Added

- Local reading of Indevolt home batteries through their HTTP API (port 8080),
  as the indevolt-api library does: `Sys.GetConfig` (serial, model, firmware)
  right before every `Indevolt.GetData`, every 30 s by default (30 to 300 s).
  Read-only: no charge, no discharge, no change of mode or limit is ever sent.
- Discovery of the batteries by their `BCF-D` announcements on UDP 8099
  (captured by the Gladys core), or typed addresses, up to six batteries.
- One device per battery, by its serial: state of charge, charge and discharge
  power, battery power and state, solar power (total and per input), AC output,
  AC input and bypass power, meter power, grid voltage and frequency,
  temperatures, energy and operating modes, rated capacity, emergency reserve,
  cycles, remaining times, the counters of the day as plain sensors. First and
  second generations, with their own keys.
- Five energy indexes for the Gladys energy monitoring (charged, discharged,
  AC output, off-grid output, solar production with its 30-minute
  production), through the guard of gladys-p1-monitor: never 0, jumps and
  drops held until the "Accept the held index" button is clicked twice (the
  first click lists, the second accepts exactly what was listed).
- Another battery answering at an address never writes into the device of
  the previous one.
- HTTP 429 and 5xx pause a battery from 1 minute to 6 hours (kept in `/data`);
  an unreachable battery is tried again after 1 minute, doubled up to 15
  minutes, never faster than the reading interval. Answers bounded to 64 KiB.
- Each reconnection to Gladys publishes the devices, every value and the
  status again; a device published again never loses a feature of the
  created one.
- "Test the connection" and "Accept the held index" buttons.
- A battery moved by DHCP is read at its new address only, once found there
  (Discovery or the form); two batteries that swap their addresses are both
  still read; a full Discovery makes room for a new announcement; the same
  battery at two addresses is read once.
- The margin of the index guard follows the generation: 2 kW for the first,
  12 kW for the second.
- Every request asks the battery to close the connection
  (`Connection: close`), as the library does for the embedded firmware.
- At most 270 states are sent in any minute; a save of the form no longer
  sends every value again. One `/data` write a read round.
- A double-click on "Accept the held index" counts as one
  click. Foreign datagrams on UDP 8099 never hide an announcement. A held
  index is logged once.
- Documentation in English and French; `LICENSE` (Apache-2.0) and
  `THIRD_PARTY_NOTICES.md` (MIT notice of indevolt-api), shipped in the image.

[Unreleased]: https://github.com/LM1LC3N7/gladys-indevolt/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/LM1LC3N7/gladys-indevolt/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/LM1LC3N7/gladys-indevolt/releases/tag/v0.1.1
