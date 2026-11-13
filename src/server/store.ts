// Where the tunnels are kept: tunnels.json in the plugin's data folder
// (they're this machine's, not the project's). Reading it brings older
// entries up to date and drops what no longer makes sense; saving writes a
// whole new file in place of the old, one save after another.

import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Host } from '@hyperpane/sdk/server';
import { DEFAULT_HOST, type TunnelSpec, hostProblem, portProblem } from '../shared/index.ts';
import { provider } from './providers/index.ts';

const FILE = 'tunnels.json';

export class Store {
  readonly #host: Host;
  #saving: Promise<void> = Promise.resolve();

  constructor(host: Host) {
    this.#host = host;
  }

  /** The tunnels kept, each one checked: none when there's no file yet. */
  async load(): Promise<TunnelSpec[]> {
    let kept: unknown;
    try {
      kept = JSON.parse(await readFile(path.join(this.#host.dataDir, FILE), 'utf8'));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') this.#host.log(`${FILE} couldn't be read: ${(e as Error).message}`);
      return [];
    }
    const specs: TunnelSpec[] = [];
    const list = (kept as { tunnels?: unknown })?.tunnels;
    for (const t of Array.isArray(list) ? list : []) {
      // Tunnels kept before there were types are HTTP.
      const spec = { type: 'http', ...(t as object) } as TunnelSpec;
      // Kept when 127.0.0.1 was the default: localhost reaches ::1 too.
      if (spec.host === '127.0.0.1') spec.host = DEFAULT_HOST;
      const p = provider(spec.provider);
      if (typeof spec?.id !== 'string' || !p || !p.info.types.includes(spec.type) || portProblem(spec.port) || hostProblem(spec.host)) continue;
      specs.push({ ...spec, name: String(spec.name ?? ''), stable: !!spec.stable && p.info.stable, on: !!spec.on });
    }
    return specs;
  }

  /** Keeps these tunnels, after any save still under way. */
  save(specs: Iterable<TunnelSpec>): Promise<void> {
    const text = JSON.stringify({ version: 1, tunnels: [...specs] }, null, 2);
    const file = path.join(this.#host.dataDir, FILE);
    this.#saving = this.#saving.then(async () => {
      await mkdir(this.#host.dataDir, { recursive: true });
      await writeFile(`${file}.tmp`, text, { mode: 0o600 });
      await rename(`${file}.tmp`, file);
    });
    return this.#saving;
  }

  /** Waits for the last save. */
  settled(): Promise<void> {
    return this.#saving;
  }
}
