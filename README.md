# Meshtastic Log Analyser

A Progressive Web App for reading, analysing, and debugging [Meshtastic](https://meshtastic.org) device logs — either live over a serial connection or by dropping in a saved log file.

## Features

- **Live serial connection** — connect to a Meshtastic device over USB serial and stream logs in real time
- **Log file analysis** — drag and drop a saved log file to run it through the full analysis pipeline
- **Device summary sidebar** — extracts hardware model, firmware version, radio configuration, GPS, battery, memory, NodeDB, BLE, MQTT, and event counters from the log stream
- **Hop scaling charts** — visualises per-hop node counts and the scaled-seen-per-hour histogram
- **Lines of interest** — annotated log lines with gutter markers and hover tooltips explaining what each event means
- **Level and module filtering** — filter by log level (DBG/INF/WRN/ERR/CRT) and by module tag
- **PII redaction** — masks node IDs, GPS coordinates, node names, and BLE peer names
- **Save log** — download the current session as a plain-text file

## Browser support

Requires the [Web Serial API](https://wicg.github.io/serial/): Chrome 89+, Edge 89+, Opera 76+. Firefox and Safari are not supported for live serial; log file analysis works in any modern browser.

## Privacy

Served statically and cached for offline use. No analytics are collected. All serial communication and log processing happens locally in the browser.

## Building

Requires Node.js and npm.

```sh
npm install
npm run build   # production build → dist/
npm run dev     # local dev server
```

## Licence

GPL-3.0. Based on [GoogleChromeLabs/serial-terminal](https://github.com/GoogleChromeLabs/serial-terminal) (Apache-2.0) and incorporates patterns and knowledge from the [Meshtastic](https://github.com/meshtastic/firmware) source code. Both upstream projects are compatible with GPL-3.0.
