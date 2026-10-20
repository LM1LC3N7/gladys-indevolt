// -----------------------------------------------------------------------------
// The HTTP client: the requests of the library, bounded answers, errors in
// our words, never a write.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { IndevoltClient, configQuery } from '../src/indevolt/client.js';
import { createFetch, timeoutError } from './helpers/fakeFetch.js';
import { ADDRESS, json, keysOf, routes } from './fixtures/indevolt.js';

const clientOf = (hosts) => {
  const fake = createFetch(hosts);
  return { fake, client: new IndevoltClient({ fetchImpl: fake.fetch }) };
};

test('the config query is the JSON of the library, without spaces', () => {
  assert.equal(configQuery([2101, '6002']), '%7B%22t%22:[2101,6002]%7D');
  const url = new URL(`http://${ADDRESS}/rpc/Indevolt.GetData?config=${configQuery([1, 2])}`);
  assert.deepEqual(JSON.parse(url.searchParams.get('config')), { t: [1, 2] });
});

test('Sys.GetConfig by GET, GetData by POST with the keys asked', async () => {
  const { fake, client } = clientOf({ [ADDRESS]: routes() });
  const who = await client.readIdentity(ADDRESS);
  assert.equal(who.serial, 'SF2000A1B2C3');
  const raw = await client.readValues(ADDRESS, [6002, 2108, 4242]);
  assert.equal(raw['6002'], 64);
  assert.equal(raw['2108'], 450);
  assert.ok(!('4242' in raw));
  assert.equal(Object.getPrototypeOf(raw), null);
  const [get, post] = fake.calls;
  assert.equal(get.init.method, 'GET');
  assert.equal(get.path, '/rpc/Sys.GetConfig');
  assert.equal(post.init.method, 'POST');
  assert.equal(post.path, '/rpc/Indevolt.GetData');
  assert.deepEqual(keysOf(post), [6002, 2108, 4242]);
  assert.equal(post.init.redirect, 'manual');
  assert.equal(post.init.body, undefined);
  assert.ok(!('User-Agent' in post.init.headers), 'no User-Agent of our own');
});

test('more than 50 keys: several requests, merged', async () => {
  const { fake, client } = clientOf({ [ADDRESS]: routes() });
  const keys = [6002, ...Array.from({ length: 60 }, (_, i) => 50_000 + i), 2108];
  const raw = await client.readValues(ADDRESS, keys);
  assert.equal(fake.calls.length, 2);
  assert.equal(raw['6002'], 64);
  assert.equal(raw['2108'], 450);
});

test('errors in our words: status, size, not JSON, not an Indevolt answer', async () => {
  const cases = [
    [() => json({}, { status: 429, headers: { 'retry-after': '120' } }), 'rate_limited'],
    [() => json({}, { status: 503 }), 'server'],
    [() => json({}, { status: 404 }), 'http'],
    [() => json({}, { status: 302 }), 'http'],
    [() => json('x'.repeat(70 * 1024)), 'too_large'],
    [() => json('<html>login</html>'), 'not_json'],
    [() => json([1, 2]), 'unknown_answer'],
    [() => json({ device: { sn: '' } }), 'unknown_answer'],
    [
      () => {
        throw timeoutError();
      },
      'timeout',
    ],
  ];
  for (const [handler, code] of cases) {
    const { client } = clientOf({ [ADDRESS]: { '/rpc/Sys.GetConfig': handler } });
    await assert.rejects(client.readIdentity(ADDRESS), (err) => {
      assert.equal(err.code, code);
      assert.doesNotMatch(err.message, /login|html|192\.168/);
      return true;
    });
  }
  const { client } = clientOf({ [ADDRESS]: { '/rpc/Sys.GetConfig': cases[0][0] } });
  await assert.rejects(client.readIdentity(ADDRESS), (err) => err.retryAfter === 120_000);
  const other = clientOf({ [ADDRESS]: { '/rpc/Indevolt.GetData': () => json({ 1: 2 }) } });
  await assert.rejects(other.client.readValues(ADDRESS, [6002]), { code: 'unknown_answer' });
  const none = clientOf({});
  await assert.rejects(none.client.readIdentity(ADDRESS), { code: 'unreachable' });
});

test('read-only: the client has no write, SetData is nowhere in the code', () => {
  for (const file of ['src/indevolt/client.js', 'src/app.js', 'index.js']) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.doesNotMatch(text, /['"`/]Indevolt\.SetData/, file);
    assert.doesNotMatch(text, /47015|47005/, `${file}: no write register`);
  }
});
