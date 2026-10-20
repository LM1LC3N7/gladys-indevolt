// -----------------------------------------------------------------------------
// A fake `fetch` for the Indevolt client: routes by address (`host:port`) and
// path (without the query), records every call, fails loudly on an
// unexpected one. No test touches the network. (From gladys-imeon.)
// -----------------------------------------------------------------------------

/**
 * `hosts` maps an address ("192.168.1.40:8080") to routes, which map a path
 * ("/rpc/Sys.GetConfig") to handler({ url, host, path, query, init }) ->
 * Response, or throw. A missing address is unreachable.
 */
export function createFetch(hosts) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const { host, pathname, searchParams } = new URL(url);
    const call = { url, host, path: pathname, query: Object.fromEntries(searchParams), init };
    calls.push(call);
    const routes = hosts[host];
    if (!routes) {
      throw refusedError();
    }
    const handler = routes[pathname];
    if (typeof handler !== 'function') {
      throw new Error(`Unexpected Indevolt call in a test: ${host}${pathname}`);
    }
    return handler(call);
  };
  return { fetch: fetchImpl, calls, hosts };
}

/** What fetch throws when the device does not answer in time. */
export const timeoutError = () => {
  const err = new Error('The operation was aborted due to timeout');
  err.name = 'TimeoutError';
  return err;
};

/** What fetch throws when nothing listens at the address. */
export function refusedError() {
  const err = new TypeError('fetch failed');
  err.cause = { code: 'ECONNREFUSED' };
  return err;
}
