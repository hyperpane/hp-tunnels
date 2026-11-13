// The tunnels this server runs: kept in the plugin's data folder (they're
// this machine's, not the project's), each one a session of its service
// while it's on (an ssh, a cloudflared, a bore connection).
//
// A tunnel that was live and drops reconnects by itself, a little later
// each time. One that never got through since it was turned on (a timeout,
// a refused connection, a changed host key, a missing program) stops and
// says why; Restart tries again. Those left on start again with the plugin.
//
// This is the manager the requests go to: what's kept is in store.ts, the
// sessions and their retries in runs.ts, the port checks in probe.ts.

import { randomBytes } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { type Host, PluginError } from '@hyperpane/sdk/server';
import {
  DEFAULT_HOST,
  MAX_TUNNELS,
  type NewTunnel,
  type ProviderInfo,
  TYPES,
  type Tunnel,
  type TunnelSpec,
  type TunnelType,
  hostProblem,
  portProblem,
} from '../shared/index.ts';
import type { Download } from './cloudflared.ts';
import { dropKey } from './keys.ts';
import { Probing, probe } from './probe.ts';
import { lastWords, plain } from './providers/command.ts';
import { PROVIDERS, type Provider, firstFor, provider } from './providers/index.ts';
import { Runs } from './runs.ts';
import { Store } from './store.ts';

export { lastWords, plain };
export { explain } from './explain.ts';

export interface Options {
  /** Runs a program in place of another (the tests' stand-ins). */
  exec?: (cmd: string, args: string[]) => { cmd: string; args: string[] };
  /** Seconds before each retry; the last one repeats. */
  backoff?: number[];
  /** How often the ports are checked while someone watches, in ms. */
  probeEvery?: number;
  /** How long a connection has to show its address, in ms. */
  connectTimeout?: number;
  /** Where bore connects (the tests' own server). */
  boreEndpoint?: { host: string; port: number };
  /** How cloudflared is downloaded (the tests' own). */
  download?: Download;
}

export class Tunnels {
  readonly #host: Host;
  readonly #store: Store;
  readonly #runs: Runs;
  readonly #probing: Probing;
  readonly #specs = new Map<string, TunnelSpec>();
  readonly #listening = new Map<string, boolean>();
  readonly #changes = new EventEmitter();
  #watchers = 0;

  constructor(host: Host, o: Options = {}) {
    this.#host = host;
    const settings = { ...o, backoff: o.backoff ?? [2, 5, 10, 30, 60], connectTimeout: o.connectTimeout ?? 30_000 };
    this.#store = new Store(host);
    this.#runs = new Runs(host, settings, (id) => this.#specs.get(id), (project) => this.#changed(project));
    this.#probing = new Probing(o.probeEvery ?? 5000, () => {
      for (const spec of this.#specs.values()) this.#probeOne(spec);
    });
    this.#changes.setMaxListeners(0);
  }

  get providers(): ProviderInfo[] {
    return Object.values(PROVIDERS).map((p) => p.info);
  }

  /** Reads what's kept and starts the tunnels left on. */
  async load(): Promise<void> {
    for (const spec of await this.#store.load()) this.#specs.set(spec.id, spec);
    for (const spec of this.#specs.values()) if (spec.on) this.#runs.start(spec, true);
  }

  /** A project's tunnels, as they are now. */
  list(project: string): Tunnel[] {
    return [...this.#specs.values()]
      .filter((s) => s.project === project)
      .sort((a, b) => a.created - b.created)
      .map((s) => {
        const run = this.#runs.get(s.id);
        return {
          ...s,
          status: run?.status ?? 'off',
          url: run?.url ?? null,
          error: run?.error ?? null,
          note: run?.note ?? null,
          since: run?.since ?? s.created,
          listening: s.type === 'udp' ? null : (this.#listening.get(s.id) ?? null),
        };
      });
  }

  /** Calls `send` with the project's tunnels now and on every change, until
   * `signal` aborts. */
  async watch(project: string, send: (t: Tunnel[]) => void, signal: AbortSignal): Promise<void> {
    const emit = () => send(this.list(project));
    this.#changes.on(project, emit);
    this.#watchers++;
    this.#probing.start();
    emit();
    try {
      await new Promise<void>((resolve) => {
        if (signal.aborted) resolve();
        else signal.addEventListener('abort', () => resolve(), { once: true });
      });
    } finally {
      this.#changes.off(project, emit);
      if (--this.#watchers === 0) this.#probing.stop();
    }
  }

  async add(project: string, n: NewTunnel): Promise<Tunnel> {
    if (typeof project !== 'string' || !project) throw new PluginError('Open a project to add tunnels to it.');
    const type = (n?.type ?? 'http') as TunnelType;
    if (!TYPES.some((t) => t.id === type)) throw new PluginError(`There's no tunnel type “${type}”: it's http, tcp or udp.`);
    const port = Number(n?.port);
    const host = String(n?.host ?? '').trim() || DEFAULT_HOST;
    const problem = portProblem(port) ?? hostProblem(host);
    if (problem) throw new PluginError(problem);
    let p: Provider | null;
    if (n?.provider) {
      p = provider(n.provider);
      if (!p) throw new PluginError(`There's no tunnel service “${n.provider}”.`);
      if (!p.info.types.includes(type)) throw new PluginError(`${p.info.name} doesn't carry ${type.toUpperCase()}: it carries ${p.info.types.map((x) => x.toUpperCase()).join(' and ')}.`);
    } else {
      p = firstFor(type);
      if (!p) throw new PluginError(`No service here carries ${type.toUpperCase()} yet.`);
    }
    if (this.#specs.size >= MAX_TUNNELS) throw new PluginError(`This server keeps at most ${MAX_TUNNELS} tunnels: remove one first.`);
    const spec: TunnelSpec = {
      id: randomBytes(6).toString('hex'),
      project,
      type,
      provider: p.info.id,
      host,
      port,
      name: String(n?.name ?? '').trim().slice(0, 60),
      stable: !!n?.stable && p.info.stable,
      on: true,
      created: Date.now(),
    };
    this.#specs.set(spec.id, spec);
    await this.#save();
    this.#runs.start(spec, true);
    this.#probeOne(spec);
    return this.list(project).find((t) => t.id === spec.id)!;
  }

  /** Turns a tunnel on or off (it stays that way after a restart). */
  async set(project: string, id: string, on: boolean): Promise<void> {
    const spec = this.#own(project, id);
    spec.on = !!on;
    await this.#save();
    if (spec.on) this.#runs.start(spec, true);
    else this.#runs.stop(spec.id);
  }

  /** Starts it again now: a new connection (the same address when it's
   * stable). */
  async restart(project: string, id: string): Promise<void> {
    const spec = this.#own(project, id);
    if (!spec.on) return this.set(project, id, true);
    this.#runs.stop(spec.id);
    this.#runs.start(spec, true);
  }

  async rename(project: string, id: string, name: string): Promise<void> {
    const spec = this.#own(project, id);
    spec.name = String(name ?? '').trim().slice(0, 60);
    await this.#save();
    this.#changed(project);
  }

  async remove(project: string, id: string): Promise<void> {
    const spec = this.#own(project, id);
    this.#runs.stop(id);
    this.#runs.delete(id);
    this.#listening.delete(id);
    this.#specs.delete(id);
    await this.#save();
    await dropKey(this.#host.dataDir, id).catch(() => {});
    this.#changed(spec.project);
  }

  /** Whether any tunnel is running (the part mustn't idle-stop then). */
  busy(): boolean {
    return this.#runs.busy();
  }

  /** The project turned the plugin off: its tunnels stop (they start again
   * with the plugin, if still on). */
  projectOff(project: string): void {
    for (const spec of this.#specs.values()) if (spec.project === project) this.#runs.stop(spec.id);
  }

  /** Everything stops; what's on stays on, for next time. */
  async shutdown(): Promise<void> {
    this.#probing.stop();
    this.#runs.shutdown();
    await this.#store.settled();
  }

  #own(project: string, id: string): TunnelSpec {
    const spec = this.#specs.get(String(id));
    if (!spec || spec.project !== project) throw new PluginError('That tunnel is gone.');
    return spec;
  }

  #changed(project: string) {
    this.#changes.emit(project);
  }

  #save(): Promise<void> {
    return this.#store.save(this.#specs.values());
  }

  /** Checks the tunnel's port, and tells its watchers when that changed. */
  #probeOne(spec: TunnelSpec) {
    probe(spec, (ok) => {
      if (this.#listening.get(spec.id) === ok || !this.#specs.has(spec.id)) return;
      this.#listening.set(spec.id, ok);
      this.#changed(spec.project);
    });
  }
}
