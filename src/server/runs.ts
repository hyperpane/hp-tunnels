// The tunnels that are on, each one a session of its service (an ssh, a
// cloudflared, a bore connection) and what's known about it: connecting,
// live at an address, waiting to reconnect, or stopped and why.
//
// A tunnel that was live and drops reconnects by itself, a little later
// each time. One that never got through since it was turned on (a timeout,
// a refused connection, a changed host key, a missing program) stops and
// says why. A service allows only so many at once from one server.

import type { ChildProcess } from 'node:child_process';
import type { Host } from '@hyperpane/sdk/server';
import type { Status, TunnelSpec } from '../shared/index.ts';
import { explain, fatal, timedOut } from './explain.ts';
import { keyFor } from './keys.ts';
import { lastWords, plain } from './providers/command.ts';
import { type Context, type Session, provider } from './providers/index.ts';
import type { Options } from './tunnels.ts';

export interface Run {
  session: Session | null;
  /** Which start this is: events of an older one are ignored. */
  serial: number;
  status: Status;
  url: string | null;
  error: string | null;
  note: string | null;
  since: number;
  /** Retries since it was last live a while. */
  attempt: number;
  timer: ReturnType<typeof setTimeout> | null;
  deadline: ReturnType<typeof setTimeout> | null;
  /** What it printed, for the reason it ended. */
  out: string;
  liveAt: number;
  /** Holds one of the service's places: connecting, live or waiting to
   * reconnect. */
  active: boolean;
  /** It was live since it was last turned on: a drop then is the network
   * blinking, and it keeps trying. */
  wasLive: boolean;
}

export type Settings = Options & { backoff: number[]; connectTimeout: number };

export class Runs {
  readonly #host: Host;
  readonly #o: Settings;
  /** The tunnel as it's kept now (gone: undefined). */
  readonly #spec: (id: string) => TunnelSpec | undefined;
  /** Tells a project's watchers something changed. */
  readonly #changed: (project: string) => void;
  readonly #runs = new Map<string, Run>();
  #stopped = false;

  constructor(host: Host, o: Settings, spec: (id: string) => TunnelSpec | undefined, changed: (project: string) => void) {
    this.#host = host;
    this.#o = o;
    this.#spec = spec;
    this.#changed = changed;
  }

  get(id: string): Run | undefined {
    return this.#runs.get(id);
  }

  /** Forgets a tunnel's run (stop it first). */
  delete(id: string): void {
    this.#runs.delete(id);
  }

  /** Whether any tunnel is running or waiting to reconnect. */
  busy(): boolean {
    for (const run of this.#runs.values()) if (run.session || run.timer) return true;
    return false;
  }

  /** Every run stops, and none starts again. */
  shutdown(): void {
    this.#stopped = true;
    for (const id of this.#runs.keys()) this.stop(id);
  }

  #set(id: string, run: Run, status: Status, error: string | null = run.error) {
    run.status = status;
    run.error = error;
    run.since = Date.now();
    const spec = this.#spec(id);
    if (spec) this.#changed(spec.project);
  }

  #liveCount(providerId: string, except: string): number {
    let n = 0;
    for (const [id, run] of this.#runs) {
      if (id !== except && run.active && this.#spec(id)?.provider === providerId) n++;
    }
    return n;
  }

  #context(spec: TunnelSpec, run: Run, serial: number): Context {
    const exec = this.#o.exec;
    return {
      dataDir: this.#host.dataDir,
      key: () => keyFor(this.#host.dataDir, spec.id),
      spawn: (cmd, args, o) => {
        const to = exec ? exec(cmd, args) : { cmd, args };
        return this.#host.spawn(to.cmd, to.args, { ...o, project: spec.project }) as ChildProcess;
      },
      note: (text) => {
        if (run.serial !== serial || run.note === text) return;
        run.note = text;
        this.#changed(spec.project);
      },
      log: (text) => this.#host.log(`${spec.id} (${spec.provider}): ${text}`),
      endpoint: this.#o.boreEndpoint,
      download: this.#o.download,
    };
  }

  /** `fresh`: turned on (or restarted) now, not a retry. */
  start(spec: TunnelSpec, fresh: boolean) {
    if (this.#stopped) return;
    const p = provider(spec.provider)!;
    let run = this.#runs.get(spec.id);
    if (run?.session) return;
    if (!run) {
      run = { session: null, serial: 0, status: 'off', url: null, error: null, note: null, since: Date.now(), attempt: 0, timer: null, deadline: null, out: '', liveAt: 0, active: false, wasLive: false };
      this.#runs.set(spec.id, run);
    }
    if (run.timer) clearTimeout(run.timer);
    run.timer = null;
    if (fresh) {
      run.attempt = 0;
      run.wasLive = false;
      run.error = null;
    }
    if (this.#liveCount(spec.provider, spec.id) >= p.info.maxLive) {
      run.active = false;
      this.#set(spec.id, run, 'failed', `${p.info.name} allows ${p.info.maxLive} tunnels at once from one server: turn another off first.`);
      return;
    }
    run.active = true;
    run.out = '';
    run.note = null;
    const serial = ++run.serial;
    const r = run;
    this.#set(spec.id, run, run.attempt > 0 ? 'retrying' : 'connecting');
    const current = () => r.serial === serial && this.#runs.get(spec.id) === r && !this.#stopped;

    let wasTimedOut = false;
    let over = false;
    const ended = (said: string, final = false) => {
      if (!current() || over) return;
      over = true;
      if (r.deadline) clearTimeout(r.deadline);
      r.deadline = null;
      r.session = null;
      r.note = null;
      if (!this.#spec(spec.id)?.on) {
        r.active = false;
        this.#set(spec.id, r, 'off', null);
        return;
      }
      const text = plain(`${r.out}\n${said}`);
      const explained = wasTimedOut ? timedOut(p.info, this.#o.connectTimeout) : explain(text, p.info);
      const isFatal = fatal(text);
      const reason = isFatal ? (lastWords(text) ?? said) : (explained ?? lastWords(said) ?? lastWords(text) ?? 'It stopped.');
      // A changed host key, a missing program, or a connection that never
      // worked since it was turned on: it stops, and says why. One that was
      // live keeps trying: that's the network blinking.
      if (final || isFatal || ((explained || wasTimedOut) && !r.wasLive)) {
        r.active = false;
        this.#set(spec.id, r, 'failed', reason);
        return;
      }
      if (r.liveAt && Date.now() - r.liveAt > 60_000) r.attempt = 0;
      const wait = this.#o.backoff[Math.min(r.attempt, this.#o.backoff.length - 1)] * 1000;
      r.attempt++;
      r.liveAt = 0;
      this.#set(spec.id, r, 'retrying', reason);
      r.timer = setTimeout(() => {
        r.timer = null;
        const again = this.#spec(spec.id);
        if (again?.on) this.start(again, false);
      }, wait);
      r.timer.unref?.();
    };
    const handlers = {
      output: (text: string) => {
        if (current()) r.out = (r.out + text).slice(-16_384);
      },
      address: (url: string) => {
        if (!current() || over) return;
        if (r.deadline) clearTimeout(r.deadline);
        r.deadline = null;
        r.url = url;
        r.liveAt = Date.now();
        r.wasLive = true;
        r.note = null;
        this.#set(spec.id, r, 'live', null);
      },
      ended,
    };

    // A placeholder until the session exists, so busy() and stop see it.
    const placeholder: Session = { stop() {} };
    r.session = placeholder;
    Promise.resolve()
      .then(() => p.start(spec, this.#context(spec, r, serial), handlers))
      .then(
        (session) => {
          if (!current()) {
            session.stop();
            return;
          }
          // It may have ended already (a program that isn't there).
          if (r.session === placeholder) r.session = session;
          else return;
          // The time limit runs from when it starts connecting (a download
          // before that doesn't count).
          if (r.status === 'live') return;
          r.deadline = setTimeout(() => {
            if (!current() || r.status === 'live') return;
            this.#host.log(`${spec.id} (${spec.provider}): no address after ${this.#o.connectTimeout / 1000} s; it said: ${JSON.stringify(plain(r.out).slice(-600))}`);
            wasTimedOut = true;
            session.stop();
            ended('timed out');
          }, this.#o.connectTimeout);
          r.deadline.unref?.();
        },
        (e: Error) => ended(e.message, true),
      );
  }

  stop(id: string) {
    const run = this.#runs.get(id);
    if (!run) return;
    if (run.timer) clearTimeout(run.timer);
    if (run.deadline) clearTimeout(run.deadline);
    run.timer = null;
    run.deadline = null;
    run.serial++;
    const session = run.session;
    run.session = null;
    run.active = false;
    run.attempt = 0;
    run.note = null;
    session?.stop();
    run.url = null;
    this.#set(id, run, 'off', null);
  }
}
