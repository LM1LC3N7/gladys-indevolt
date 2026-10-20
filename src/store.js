// -----------------------------------------------------------------------------
// The state kept in /data (the only writable place of the container): the
// guards of the energy indexes and the pauses after a 429/5xx, by battery, so
// that a restart never forgets a jump the user has not accepted nor retries
// too soon. Never any text of the battery. A small JSON file, written through
// a temporary file and a rename. Failures are logged, never fatal. (Taken from
// gladys-imeon, itself from gladys-p1-monitor.)
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { rename, writeFile } from 'node:fs/promises';

export const DEFAULT_STATE_FILE = '/data/indevolt-state.json';

export function createFileStore(file = DEFAULT_STATE_FILE) {
  /** The saves one after the other: two never share the temporary file. */
  let queue = Promise.resolve();
  const write = async (data) => {
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify(data), 'utf8');
    await rename(tmp, file);
  };
  return {
    load() {
      try {
        const data = JSON.parse(readFileSync(file, 'utf8'));
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
      } catch {
        return {};
      }
    },
    save(data) {
      const job = queue.then(
        () => write(data),
        () => write(data),
      );
      queue = job.catch(() => {});
      return job;
    },
  };
}

/** The same in memory (tests). */
export function createMemoryStore(initial = {}) {
  let data = structuredClone(initial);
  return {
    load: () => structuredClone(data),
    async save(next) {
      data = structuredClone(next);
    },
    get data() {
      return data;
    },
  };
}
