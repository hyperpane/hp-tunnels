// Whether something answers on a tunnel's local port, so the window can say
// "nothing listening" before visitors find out. It's asked only while
// someone watches: once, then every few seconds.

import net from 'node:net';
import type { TunnelSpec } from '../shared/index.ts';

/** Whether something answers at the tunnel's host and port (TCP; UDP
 * can't be asked): `done` is called once, unless it's UDP. */
export function probe(spec: TunnelSpec, done: (ok: boolean) => void): void {
  if (spec.type === 'udp') return;
  const host = spec.host.replace(/^\[|\]$/g, '');
  const socket = net.connect({ host, port: spec.port });
  let settled = false;
  const finish = (ok: boolean) => {
    if (settled) return;
    settled = true;
    socket.destroy();
    done(ok);
  };
  socket.setTimeout(1500, () => finish(false));
  socket.once('connect', () => finish(true));
  socket.once('error', () => finish(false));
}

/** Runs `tick` now and every `every` ms between start() and stop(). */
export class Probing {
  readonly #every: number;
  readonly #tick: () => void;
  #timer: ReturnType<typeof setInterval> | null = null;

  constructor(every: number, tick: () => void) {
    this.#every = every;
    this.#tick = tick;
  }

  start(): void {
    if (this.#timer) return;
    this.#tick();
    this.#timer = setInterval(this.#tick, this.#every);
    this.#timer.unref?.();
  }

  stop(): void {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
  }
}
