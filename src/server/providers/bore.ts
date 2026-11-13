// bore.pub: a public TCP port for a local one, no account, nothing to
// install: bore's client is written here (github.com/ekzhang/bore, MIT).
//
// Its protocol: JSON frames ending in a NUL byte, at most 256 bytes, on
// TCP port 7835. The client says {"Hello":0} (any port); the server answers
// {"Hello":PORT}, then "Heartbeat"s, and {"Connection":"<uuid>"} for each
// visitor: the client opens another connection, says {"Accept":"<uuid>"},
// and from then on that connection is the visitor's, joined to the local
// port. {"Challenge":…} asks for a secret (bore.pub has none);
// {"Error":"…"} ends it. Traffic isn't encrypted by bore: what the service
// itself encrypts (TLS, ssh) stays encrypted.

import net from 'node:net';
import type { Provider, Session } from './index.ts';

const HOST = 'bore.pub';
const PORT = 7835;
const MAX_FRAME = 256;
/** The server says Heartbeat every half second or so: this much silence
 * means the connection is gone. */
const SILENCE = 30_000;

type ServerMessage = { Hello: number } | { Connection: string } | { Error: string } | { Challenge: string } | 'Heartbeat';

/** Splits NUL-ended frames out of what arrives. */
export class Frames {
  #buf = Buffer.alloc(0);
  push(chunk: Buffer): unknown[] {
    this.#buf = Buffer.concat([this.#buf, chunk]);
    const out: unknown[] = [];
    for (let at = this.#buf.indexOf(0); at >= 0; at = this.#buf.indexOf(0)) {
      const frame = this.#buf.subarray(0, at).toString('utf8');
      this.#buf = this.#buf.subarray(at + 1);
      if (frame) out.push(JSON.parse(frame));
    }
    if (this.#buf.length > MAX_FRAME) throw new Error('bore sent a frame too long.');
    return out;
  }
  /** What came after the last frame (a visitor's first bytes). */
  rest(): Buffer {
    return this.#buf;
  }
}

export const frame = (message: unknown) => Buffer.from(`${JSON.stringify(message)}\0`);

export const bore: Provider = {
  info: {
    id: 'bore',
    name: 'bore.pub',
    types: ['tcp'],
    via: 'TCP port 7835',
    needs: 'nothing',
    maxLive: 10,
    stable: false,
    notes: ['A public host and port for any TCP service. bore doesn’t encrypt: use it for what encrypts itself (ssh, TLS) or doesn’t matter.'],
  },

  start(t, ctx, on): Session {
    const server = ctx.endpoint ?? { host: HOST, port: PORT };
    const visitors = new Set<net.Socket>();
    let ended = false;
    let silence: ReturnType<typeof setTimeout> | null = null;
    const control = net.connect({ host: server.host, port: server.port });
    control.setKeepAlive(true, 15_000);
    control.setTimeout(20_000, () => end(`${HOST} didn't answer in time.`));

    const end = (said: string, final = false) => {
      if (ended) return;
      ended = true;
      if (silence) clearTimeout(silence);
      control.destroy();
      for (const v of visitors) v.destroy();
      ctx.log(`bore ended: ${said}`);
      on.ended(said, final);
    };
    const quiet = () => {
      if (silence) clearTimeout(silence);
      silence = setTimeout(() => end(`${HOST} went quiet: the connection is gone.`), SILENCE);
      silence.unref?.();
    };

    const accept = (id: string) => {
      const remote = net.connect({ host: server.host, port: server.port });
      const local = net.connect({ host: t.host.replace(/^\[|\]$/g, ''), port: t.port });
      visitors.add(remote);
      visitors.add(local);
      const close = () => {
        remote.destroy();
        local.destroy();
        visitors.delete(remote);
        visitors.delete(local);
      };
      remote.once('connect', () => remote.write(frame({ Accept: id })));
      remote.pipe(local).pipe(remote);
      remote.on('error', close).on('close', close);
      local.on('error', close).on('close', close);
    };

    const frames = new Frames();
    control.once('connect', () => {
      ctx.log(`bore connected to ${server.host}:${server.port}`);
      control.write(frame({ Hello: 0 }));
      control.setTimeout(0);
      quiet();
    });
    control.on('data', (chunk: Buffer) => {
      let messages: unknown[];
      try {
        messages = frames.push(chunk);
      } catch (e) {
        end((e as Error).message);
        return;
      }
      quiet();
      for (const m of messages as ServerMessage[]) {
        if (m === 'Heartbeat') continue;
        if (typeof m !== 'object' || m === null) continue;
        if ('Hello' in m) on.address(`tcp://${HOST === server.host ? HOST : server.host}:${m.Hello}`);
        else if ('Connection' in m) accept(String(m.Connection));
        else if ('Error' in m) end(`${HOST}: ${m.Error}`);
        else if ('Challenge' in m) end(`${HOST} asks for a secret this plugin doesn't have.`, true);
      }
    });
    control.on('error', (e: NodeJS.ErrnoException) => end(`Couldn't reach ${server.host}:${server.port} (${e.code ?? e.message}).`));
    control.on('close', () => end(`${HOST} closed the connection.`));

    return {
      stop() {
        if (ended) return;
        ended = true;
        if (silence) clearTimeout(silence);
        control.destroy();
        for (const v of visitors) v.destroy();
      },
    };
  },
};
