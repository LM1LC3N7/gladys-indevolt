import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeConfig, parseAddress } from '../src/config.js';

test('addresses: host and port, 8080 by default, URLs reduced, credentials refused', () => {
  assert.deepEqual(parseAddress('192.168.1.40'), { address: '192.168.1.40:8080' });
  assert.deepEqual(parseAddress('http://192.168.1.40:8081/rpc'), { address: '192.168.1.40:8081' });
  assert.deepEqual(parseAddress('Battery.local'), { address: 'battery.local:8080' });
  assert.deepEqual(parseAddress('fe80::1'), { address: '[fe80::1]:8080' });
  assert.deepEqual(parseAddress('[fe80::1]:81'), { address: '[fe80::1]:81' });
  assert.deepEqual(parseAddress(''), { empty: true });
  for (const bad of ['u:p@1.2.3.4', '1.2.3.4:70000', 'a_b', 'x'.repeat(400)]) {
    assert.ok(parseAddress(bad).error, bad);
  }
});

test('the configuration: up to six addresses, the interval bounded', () => {
  const config = normalizeConfig({
    addresses:
      '192.168.1.40, 192.168.1.41;192.168.1.40 bad_host 1.1.1.1 2.2.2.2 3.3.3.3 4.4.4.4 5.5.5.5',
    poll_interval: 10,
  });
  assert.deepEqual(config.addresses, [
    '192.168.1.40:8080',
    '192.168.1.41:8080',
    '1.1.1.1:8080',
    '2.2.2.2:8080',
    '3.3.3.3:8080',
    '4.4.4.4:8080',
  ]);
  assert.deepEqual(config.invalidAddresses, ['bad_host']);
  assert.equal(config.pollInterval, 30);
  assert.equal(normalizeConfig({ poll_interval: '120' }).pollInterval, 120);
  assert.equal(normalizeConfig({ poll_interval: 10_000 }).pollInterval, 300);
  assert.equal(normalizeConfig({ poll_interval: 'x' }).pollInterval, 30);
  assert.deepEqual(normalizeConfig().addresses, []);
});
