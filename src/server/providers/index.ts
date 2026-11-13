// The services tunnels go through. Each one starts a session for a tunnel
// (a program, or a connection of the plugin's own) and tells the manager
// what happens: the address once it has one, and why it ended. The manager
// does the rest: retries, time limits, what's shown.

import type { ChildProcess, SpawnOptions } from 'node:child_process';
import type { ProviderId, ProviderInfo, TunnelSpec } from '../../shared/index.ts';
import type { Download } from '../cloudflared.ts';
import { bore } from './bore.ts';
import { cloudflare } from './cloudflare.ts';
import { pinggy } from './pinggy.ts';
import { tunnl } from './tunnl.ts';

export interface Context {
  /** The plugin's data folder (keys, known hosts, downloaded tools). */
  dataDir: string;
  /** The tunnel's own ssh key file, made the first time. */
  key(): Promise<string>;
  /** Starts a program, tracked by the server (the tests put a stand-in
   * in its place). */
  spawn(cmd: string, args: string[], o: SpawnOptions): ChildProcess;
  /** Says what it's doing while it gets ready (null: done). */
  note(text: string | null): void;
  log(text: string): void;
  /** Where to connect, for a provider that connects itself (the tests put
   * a local server here). */
  endpoint?: { host: string; port: number };
  /** How cloudflared is downloaded (the tests give their own). */
  download?: Download;
}

export interface Handlers {
  /** What it printed (for the log, and for the reason it ended). */
  output(text: string): void;
  /** Its public address: it's live. */
  address(url: string): void;
  /** It ended. `said`: what it printed last, or why; `final`: no retry can
   * help (a changed host key, a missing program). */
  ended(said: string, final?: boolean): void;
}

export interface Session {
  stop(): void;
}

export interface Provider {
  info: ProviderInfo;
  start(t: TunnelSpec, ctx: Context, on: Handlers): Session | Promise<Session>;
}

export const PROVIDERS: Record<ProviderId, Provider> = { tunnl, pinggy, cloudflare, bore };

export function provider(id: string): Provider | null {
  return Object.hasOwn(PROVIDERS, id) ? PROVIDERS[id as ProviderId] : null;
}

/** The first service that carries `type`. */
export function firstFor(type: string): Provider | null {
  return Object.values(PROVIDERS).find((p) => (p.info.types as string[]).includes(type)) ?? null;
}
