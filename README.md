# gladys-indevolt

Unofficial [Gladys Assistant](https://gladysassistant.com) integration for
**Indevolt home batteries** (SolidFlex, PowerFlex, BK1600...). It reads each
battery through its local API (HTTP, port 8080), without any cloud nor
account, every 30 seconds: state of charge, charge and discharge power, solar
power, AC output, temperatures, modes, and five energy indexes for the Gladys
energy monitoring. **Read-only**: it never starts a charge or a discharge and
never changes a mode or a limit.

**Never tested with a real device.** Not affiliated with Indevolt.

- User guide: [English](docs/en.md), [français](docs/fr.md).
- Requirements: Gladys 5.2.0 or later, the battery on the same network.

## How it works

- `GET /rpc/Sys.GetConfig` (serial, model, firmware) right before every
  `POST /rpc/Indevolt.GetData?config={"t":[...]}` (the values), as the
  [indevolt-api](https://github.com/Xirt/indevolt-api) library (MIT) does.
  Ported to JavaScript, see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
- Discovery: the `BCF-D` announcements of the batteries on UDP 8099, captured
  by the Gladys core (`network_discovery`), or the addresses typed.
- The five indexes pass the guard of gladys-p1-monitor (`src/guard.js`): never
  0, jumps and drops held until the "Accept the held index" button is clicked
  twice (the first click lists, the second accepts what was listed).
- 429 and 5xx pause a battery (kept in `/data`), an unreachable one is retried
  from 1 to 15 minutes; answers bounded to 64 KiB.

## Development

```bash
npm install
npm test
npm run lint
npm run format:check
npm run audit
```

See [CLAUDE.md](CLAUDE.md) for the project rules, [TODO.md](TODO.md) for the
decisions and what is left to check on a real battery.

## License

Apache-2.0, see [LICENSE](LICENSE) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
