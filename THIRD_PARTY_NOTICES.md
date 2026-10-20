# Third-party notices

This integration is licensed under the Apache License 2.0 (see `LICENSE`). It
contains logic ported from the projects below, distributed under their own
license.

## indevolt-api (Xirt/indevolt-api)

<https://github.com/Xirt/indevolt-api>, the Python library the Indevolt
integration of Home Assistant uses. Version 1.8.8 (`pyproject.toml`), branch
`main` at commit 5b7215b. MIT License.

Ported to JavaScript in `src/indevolt/client.js` and `src/indevolt/model.js`:
the two requests of the local API (`GET /rpc/Sys.GetConfig` and
`POST /rpc/Indevolt.GetData?config={"t":[...]}` on port 8080), the keys
("cJson points") of the system, battery, grid and solar values and their
meaning (`indevolt_api/const.py`), the list of the second-generation models,
and the `BCF-D` announcement on UDP 8099 of the passive discovery. Changed
here: read-only (the library's `Indevolt.SetData`, its charge, discharge and
stop commands, its mode and limit registers are never called nor ported), a
missing or odd value is never read as 0, and the answers are bounded.

Its license notice, reproduced as it appears in its `LICENSE` file:

```
MIT License

Copyright (c) 2026 XirtNL

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Home Assistant, Indevolt integration (home-assistant/core)

<https://github.com/home-assistant/core>, `homeassistant/components/indevolt`
(branch `dev` at commit 9337c03), Apache License 2.0, Copyright the Home
Assistant authors. The keys read for each generation (`const.py`), the units
of each value (W, kWh, Wh for keys 1505 and 11034, %, V, Hz, °C, min), the
meaning of the state codes (1000 / 1001 / 1002) and of the energy modes, and
the rule that a first-generation inverter temperature of 0 °C with the
heating off is a placeholder (`sensor.py`) come from there.

## gladys-p1-monitor and gladys-imeon

The plausibility guard of the energy indexes (`src/guard.js`, its margin made
a parameter in gladys-imeon), the `/data` store (`src/store.js`) and the
address parser (`src/config.js`) come from the sibling integrations
[gladys-p1-monitor](https://github.com/LM1LC3N7/gladys-p1-monitor) and
[gladys-imeon](https://github.com/LM1LC3N7/gladys-imeon), same project,
Apache-2.0.
