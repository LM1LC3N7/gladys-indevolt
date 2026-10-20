// -----------------------------------------------------------------------------
// The configuration the user fills (manifest `config_schema`), normalized.
// No secret: the local API of the battery asks for none.
// -----------------------------------------------------------------------------

import { DEFAULT_PORT, MAX_BATTERIES, POLL_DEFAULT, POLL_MAX, POLL_MIN } from './constants.js';

const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

/**
 * An address typed by the user: an IP address or a host name, with an
 * optional port (8080 when absent). A pasted URL ("http://192.168.1.30:8080/rpc")
 * is reduced to its host and port. (The parser of gladys-p1-monitor.)
 * @returns {{ address: string } | { error: 'invalid' } | { empty: true }}
 *   `address` is always `host:port`.
 */
export function parseAddress(raw) {
  let text = String(raw ?? '').trim();
  if (text === '') {
    return { empty: true };
  }
  if (text.length > 300) {
    return { error: 'invalid' };
  }
  text = text.replace(/^[a-z][a-z0-9+.-]*:\/\//i, '').replace(/[/?#].*$/, '');
  // user:password@ never belongs in the address: refused rather than sent around.
  if (text.includes('@')) {
    return { error: 'invalid' };
  }
  const bracketed = /^\[([0-9a-f:.]+)\](?::(\d{1,5}))?$/i.exec(text);
  if (bracketed) {
    return withPort(`[${bracketed[1].toLowerCase()}]`, bracketed[2]);
  }
  if (/^[0-9a-f:.]+$/i.test(text) && (text.match(/:/g) ?? []).length >= 2) {
    return withPort(`[${text.toLowerCase()}]`, undefined);
  }
  const match = /^(.*?)(?::(\d{1,5}))?$/.exec(text);
  const host = match[1];
  if (host.length > 253 || !host.split('.').every((label) => LABEL.test(label))) {
    return { error: 'invalid' };
  }
  return withPort(host.toLowerCase(), match[2]);
}

function withPort(host, port) {
  const number = port === undefined ? DEFAULT_PORT : Number(port);
  if (number < 1 || number > 65535) {
    return { error: 'invalid' };
  }
  return { address: `${host}:${number}` };
}

/** The reading interval (s): a number from 30 to 300, else 30. */
function pollOf(raw) {
  const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return POLL_DEFAULT;
  }
  return Math.min(POLL_MAX, Math.max(POLL_MIN, Math.round(value)));
}

export function normalizeConfig(raw = {}) {
  const addresses = [];
  const invalidAddresses = [];
  const text = typeof raw?.addresses === 'string' ? raw.addresses : '';
  for (const part of text.split(/[\s,;]+/).slice(0, 50)) {
    const parsed = parseAddress(part);
    if (parsed.empty) {
      continue;
    }
    if (parsed.error) {
      // Shown cut short: a pasted text is never echoed whole.
      invalidAddresses.push(part.slice(0, 40));
    } else if (!addresses.includes(parsed.address) && addresses.length < MAX_BATTERIES) {
      addresses.push(parsed.address);
    }
  }
  return { addresses, invalidAddresses, pollInterval: pollOf(raw?.poll_interval) };
}
