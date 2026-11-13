// The other services: Pinggy (HTTP and TCP, ssh on port 443), Cloudflare's
// quick tunnels (cloudflared: its download is checked before it's used),
// and bore (the plugin's own client, against a bore server made here: a
// visitor's bytes reach the local port and come back).

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import type { Plugin } from '@hyperpane/sdk/server';
import { invoke, testHost } from '@hyperpane/sdk/testing';
import { VERSION, cloudflared, fromTgz } from '../../src/server/cloudflared.ts';
import { make } from '../../src/server/plugin.ts';
import { Frames, frame } from '../../src/server/providers/bore.ts';
import { pinggyAddress } from '../../src/server/providers/pinggy.ts';
import type { Options } from '../../src/server/tunnels.ts';
import type { Tunnel, Tunnels } from '../../src/shared/index.ts';

const FAKE = path.join(import.meta.dirname, 'fake-ssh.mjs');
const stops: (() => unknown)[] = [];
after(() => Promise.all(stops.map((f) => f())));

async function made(mode: string, options: Options = {}) {
  const dataDir = mkdtempSync(path.join(os.tmpdir(), 'tunnels-p-'));
  const log = path.join(dataDir, 'runs.log');
  const host = testHost({ id: 'tunnels', dataDir, projects: [{ id: 'p1', name: 'app', folder: dataDir }] });
  const exec = (cmd: string, args: string[]) => ({ cmd: process.execPath, args: [FAKE, log, mode, cmd, ...args] });
  const plugin: Plugin = await make({ exec, backoff: [0.05], connectTimeout: 3000, ...options })(host);
  stops.push(() => plugin.shutdown?.());
  const list = async () => (await invoke<Tunnels>(plugin, { op: 'list', project: 'p1' })).tunnels;
  const until = async (fn: (t: Tunnel[]) => boolean, what: string) => {
    const end = Date.now() + 8000;
    for (;;) {
      const t = await list();
      if (fn(t)) return t;
      if (Date.now() > end) assert.fail(`${what}: ${JSON.stringify(t, null, 1)}`);
      await new Promise((r) => setTimeout(r, 25));
    }
  };
  const runs = (): string[][] => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  return { plugin, dataDir, list, until, runs };
}

test('Pinggy: HTTP and TCP through ssh on port 443', async () => {
  const m = await made('live');
  await invoke(m.plugin, { op: 'add', project: 'p1', type: 'http', provider: 'pinggy', port: 3000 });
  await invoke(m.plugin, { op: 'add', project: 'p1', type: 'tcp', provider: 'pinggy', port: 5432 });
  const [web, db] = await m.until((t) => t.length === 2 && t.every((x) => x.status === 'live'), 'both live');
  assert.match(web.url!, /^https:\/\/uljtt-[0-9a-f]+\.run\.pinggy-free\.link$/);
  assert.equal(db.url, 'tcp://rnxyz-1-2-3-4.a.free.pinggy.link:41234');
  const httpRun = m.runs().find((r) => r.at(-1) === 'free.pinggy.io')!;
  const tcpRun = m.runs().find((r) => r.at(-1) === 'tcp@free.pinggy.io')!;
  assert.equal(httpRun[0], 'ssh');
  assert.deepEqual(httpRun.slice(-3), ['-R', '0:localhost:3000', 'free.pinggy.io']);
  assert.deepEqual(tcpRun.slice(-3), ['-R', '0:localhost:5432', 'tcp@free.pinggy.io']);
  assert.equal(httpRun[httpRun.indexOf('-p') + 1], '443');
  assert.equal(web.stable, false, 'Pinggy has no stable address for free');
});

test('Pinggy’s addresses, and nothing that only looks like one', () => {
  assert.equal(pinggyAddress('http://a-1.run.pinggy-free.link\nhttps://a-1.run.pinggy-free.link', 'http'), 'https://a-1.run.pinggy-free.link');
  assert.equal(pinggyAddress('tcp://x.a.pinggy.link:1234', 'tcp'), 'tcp://x.a.pinggy.link:1234');
  assert.equal(pinggyAddress('https://a.pinggy-free.link.evil.example', 'http'), null);
  assert.equal(pinggyAddress('https://a.run.pinggy-free.link', 'tcp'), null);
});

test('Cloudflare: cloudflared over HTTP/2 (port 443), with a home of its own', async () => {
  const m = await made('live');
  // A copy where the plugin keeps the one it downloads: no download here.
  const copy = path.join(m.dataDir, 'bin', `cloudflared-${VERSION}`, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  mkdirSync(path.dirname(copy), { recursive: true });
  writeFileSync(copy, '');
  await invoke(m.plugin, { op: 'add', project: 'p1', provider: 'cloudflare', port: 8080 });
  const [t] = await m.until((t) => t[0]?.status === 'live', 'live');
  assert.match(t.url!, /^https:\/\/brave-lion-[0-9a-f]+\.trycloudflare\.com$/);
  const [run] = m.runs();
  assert.match(run[0], /cloudflared(\.exe)?$/);
  assert.deepEqual(run.slice(1), ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', 'http://localhost:8080']);
});

test('cloudflared that isn’t what Cloudflare published is never used', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'cf-'));
  const notes: (string | null)[] = [];
  const download = { fetch: async (_url: string, progress: (d: number) => void) => (progress(1), Buffer.from('not cloudflared')) };
  await assert.rejects(
    cloudflared(dir, { note: (n) => notes.push(n), download, platform: 'linux-x64', env: { PATH: '' } }),
    /isn't the one Cloudflare published/,
  );
  assert.ok(notes.includes('Downloading cloudflared… 100%'));
  assert.equal(existsSync(path.join(dir, 'bin', `cloudflared-${VERSION}`, 'cloudflared')), false);
  await assert.rejects(cloudflared(dir, { note() {}, download, platform: 'plan9-mips', env: { PATH: '' } }), /no cloudflared download for plan9-mips/);
});

test('the file out of a .tar.gz', { skip: process.platform === 'win32' }, () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tgz-'));
  writeFileSync(path.join(dir, 'README'), 'x'.repeat(700));
  writeFileSync(path.join(dir, 'cloudflared'), 'the program');
  execFileSync('tar', ['-czf', path.join(dir, 'a.tgz'), '-C', dir, 'README', 'cloudflared']);
  assert.equal(fromTgz(readFileSync(path.join(dir, 'a.tgz')), 'cloudflared').toString(), 'the program');
  assert.throws(() => fromTgz(readFileSync(path.join(dir, 'a.tgz')), 'other'), /no other in the download/);
});

/** A bore server, as bore.pub runs it: Hello, heartbeats, and a visitor. */
async function boreServer() {
  const accepted: { id: string; socket: net.Socket }[] = [];
  let control: net.Socket | null = null;
  const said: unknown[] = [];
  const server = net.createServer((socket) => {
    const frames = new Frames();
    socket.on('data', (chunk: Buffer) => {
      for (const m of frames.push(chunk) as Record<string, unknown>[]) {
        said.push(m);
        if ('Hello' in m) {
          control = socket;
          socket.write(frame({ Hello: 45678 }));
          const beat = setInterval(() => socket.write(frame('Heartbeat')), 50);
          socket.on('close', () => clearInterval(beat));
        } else if ('Accept' in m) {
          accepted.push({ id: String(m.Accept), socket });
        }
      }
    });
    socket.on('error', () => {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  stops.push(() => server.close());
  return { port: (server.address() as net.AddressInfo).port, accepted, said, control: () => control };
}

test('bore: a public TCP port, and a visitor’s bytes reach the local port and come back', async () => {
  const bore = await boreServer();
  const echo = net.createServer((s) => s.pipe(s)).listen(0, '127.0.0.1');
  await new Promise((r) => echo.once('listening', r));
  stops.push(() => echo.close());
  const local = (echo.address() as net.AddressInfo).port;

  const m = await made('quiet', { boreEndpoint: { host: '127.0.0.1', port: bore.port } });
  await invoke(m.plugin, { op: 'add', project: 'p1', type: 'tcp', provider: 'bore', port: local });
  const [t] = await m.until((t) => t[0]?.status === 'live', 'live');
  assert.equal(t.url, 'tcp://127.0.0.1:45678');
  assert.deepEqual(bore.said[0], { Hello: 0 });
  assert.equal(m.runs().length, 0, 'nothing to run');

  // A visitor: the server asks, the plugin accepts on a new connection.
  bore.control()!.write(frame({ Connection: '6f1c2b0e-0000-4000-8000-000000000001' }));
  for (let i = 0; i < 200 && !bore.accepted.length; i++) await new Promise((r) => setTimeout(r, 10));
  const [visitor] = bore.accepted;
  assert.equal(visitor.id, '6f1c2b0e-0000-4000-8000-000000000001');
  const back = new Promise<string>((resolve) => {
    let got = '';
    visitor.socket.on('data', (d) => {
      got += d.toString();
      if (got.includes('hello')) resolve(got);
    });
  });
  visitor.socket.write('hello');
  assert.equal(await back, 'hello');

  // The server goes: it was live, so it tries again.
  bore.control()!.destroy();
  await m.until((t) => t[0]?.status === 'retrying' || t[0]?.status === 'live', 'reconnecting');
  await m.until(() => bore.said.filter((x) => typeof x === 'object' && x && 'Hello' in x).length >= 2, 'a second Hello');
});

test('bore that can’t be reached stops, saying so', async () => {
  const closed = net.createServer().listen(0, '127.0.0.1');
  await new Promise((r) => closed.once('listening', r));
  const port = (closed.address() as net.AddressInfo).port;
  closed.close();
  const m = await made('quiet', { boreEndpoint: { host: '127.0.0.1', port } });
  await invoke(m.plugin, { op: 'add', project: 'p1', type: 'tcp', provider: 'bore', port: 5432 });
  const [t] = await m.until((t) => t[0]?.status === 'failed', 'failed');
  assert.match(t.error!, /Couldn't reach bore\.pub \(.*ECONNREFUSED.*\)\. Restart to try again, or try another service\./);
});
