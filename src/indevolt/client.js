// -----------------------------------------------------------------------------
// The local HTTP API of an Indevolt battery, plain HTTP on the home network
// (port 8080), no cloud, no account, after indevolt-api (Xirt, MIT, see
// THIRD_PARTY_NOTICES.md):
// - GET /rpc/Sys.GetConfig answers `{ device: { sn, type, fw, mac } }`;
// - POST /rpc/Indevolt.GetData?config={"t":[<keys>]} answers the values of
//   those keys, `{ "<key>": value }`.
// The protocol is not documented by Indevolt: every answer is bounded
// (64 KiB), parsed once, and read only through src/indevolt/model.js.
//
// READ-ONLY: the SetData method of the library (charge, discharge, mode,
// limits) is never called, nor ported. There is no method for it here.
//
// Errors carry our own words and codes, never a text of the battery, never
// a URL.
// -----------------------------------------------------------------------------

import { HTTP_TIMEOUT, KEYS_PER_REQUEST, MAX_BODY_BYTES, PATHS } from '../constants.js';
import { hasAnyKey, parseIdentity } from './model.js';

export class IndevoltError extends Error {
  /**
   * @param {'timeout'|'unreachable'|'http'|'server'|'rate_limited'|'too_large'|'not_json'|
   *   'unknown_answer'} code
   */
  constructor(code, { status, retryAfter } = {}) {
    super(code);
    this.name = 'IndevoltError';
    this.code = code;
    this.status = status;
    /** ms, from a Retry-After header (429, 503), when given. */
    this.retryAfter = retryAfter;
  }
}

/** A network failure (while connecting or while reading the body), in our words. */
function networkError(err) {
  if (err instanceof IndevoltError) {
    return err;
  }
  const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError';
  return new IndevoltError(timeout ? 'timeout' : 'unreachable');
}

/** The body, read up to `limit` bytes: a longer one is not an Indevolt answer. */
async function readBounded(response, limit) {
  if (!response.body) {
    return '';
  }
  const reader = response.body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    size += value.byteLength;
    if (size > limit) {
      await reader.cancel().catch(() => {});
      throw new IndevoltError('too_large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks.map((c) => Buffer.from(c))).toString('utf8');
}

/** Retry-After in seconds (or an HTTP date) -> ms, undefined when absent or odd. */
function retryAfterOf(response, now) {
  const raw = response.headers?.get?.('retry-after');
  if (!raw) {
    return undefined;
  }
  if (/^\d{1,9}$/.test(raw.trim())) {
    return Number(raw.trim()) * 1000;
  }
  const at = Date.parse(raw);
  return Number.isFinite(at) ? Math.max(0, at - now()) : undefined;
}

/**
 * The `config` query of GetData, as the library writes it: the JSON without
 * spaces, `{"t":[2101,6002]}`. Only `{`, `}` and `"` are escaped (what an
 * HTTP client must escape in a query); digits, `[`, `]`, `,` and `:` stay.
 */
export function configQuery(keys) {
  const json = JSON.stringify({ t: keys.map((k) => Math.trunc(Number(k))) });
  return json.replaceAll('{', '%7B').replaceAll('}', '%7D').replaceAll('"', '%22');
}

export class IndevoltClient {
  constructor({
    fetchImpl = (...args) => globalThis.fetch(...args),
    timeout = HTTP_TIMEOUT,
    now = Date.now,
  } = {}) {
    this.fetch = fetchImpl;
    this.timeout = timeout;
    this.now = now;
    /** Requests one after the other, never two at once (an embedded web server). */
    this.queue = Promise.resolve();
  }

  /** One request to `address` (`host:port`): its parsed JSON object. */
  request(address, path, { method = 'GET', query = '' } = {}) {
    const run = async () => {
      let response;
      let text;
      try {
        response = await this.fetch(`http://${address}${path}${query ? `?${query}` : ''}`, {
          method,
          headers: { Accept: 'application/json' },
          // A redirect is never followed: the requests stay on this address.
          redirect: 'manual',
          signal: AbortSignal.timeout(this.timeout),
        });
        // The body can fail too (timeout, connection cut): same errors.
        text = await readBounded(response, MAX_BODY_BYTES);
      } catch (err) {
        throw networkError(err);
      }
      const status = response.status;
      if (status === 429 || status >= 500) {
        throw new IndevoltError(status === 429 ? 'rate_limited' : 'server', {
          status,
          retryAfter: retryAfterOf(response, this.now),
        });
      }
      if (status < 200 || status >= 300) {
        throw new IndevoltError('http', { status });
      }
      let answer;
      try {
        answer = JSON.parse(text);
      } catch {
        throw new IndevoltError('not_json');
      }
      if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) {
        throw new IndevoltError('unknown_answer');
      }
      return answer;
    };
    const job = this.queue.then(run, run);
    this.queue = job.catch(() => {});
    return job;
  }

  /** Sys.GetConfig: `{ serial, model, generation, firmware }` (src/indevolt/model.js). */
  async readIdentity(address) {
    const identity = parseIdentity(await this.request(address, PATHS.CONFIG));
    if (!identity) {
      throw new IndevoltError('unknown_answer');
    }
    return identity;
  }

  /**
   * Indevolt.GetData for `keys`, 50 at a time: the answers merged into one
   * object without prototype (a key "__proto__" stays a plain key).
   */
  async readValues(address, keys) {
    const raw = Object.create(null);
    for (let i = 0; i < keys.length; i += KEYS_PER_REQUEST) {
      const chunk = keys.slice(i, i + KEYS_PER_REQUEST);
      const answer = await this.request(address, PATHS.DATA, {
        method: 'POST',
        query: `config=${configQuery(chunk)}`,
      });
      if (!hasAnyKey(answer, chunk)) {
        throw new IndevoltError('unknown_answer');
      }
      for (const key of chunk) {
        const name = String(key);
        if (Object.hasOwn(answer, name)) {
          raw[name] = answer[name];
        }
      }
    }
    return raw;
  }
}
