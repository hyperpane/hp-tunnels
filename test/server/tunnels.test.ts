// The server part with a stand-in for ssh (fake-ssh.mjs): a tunnel goes
// live with the address ssh prints, is kept and starts again with the
// plugin, reconnects when it drops, stops for good on a changed host key,
// says when ssh is missing, and keeps to the service's limits.

import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync } from 'node:fs';
import { existsSync } from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { after, test } from 'node:test';
import type { Plugin } from '@hyperpane/sdk/server';
import { invoke, stream, testHost } from '@hyperpane/sdk/testing';
import { make } from '../../src/server/plugin.ts';
import type { Options } from '../../src/server/tunnels.ts';
import { lastWords, plain } from '../../src/server/tunnels.ts';
import { tunnlAddress } from '../../src/server/providers/tunnl.ts';
import type { Tunnel, Tunnels } from '../../src/shared/index.ts';

const FAKE = path.join(import.meta.dirname, 'fake-ssh.mjs');
const WIN = process.platform === 'win32';

interface Made {
  plugin: Plugin;
  dataDir: string;
  log: string;
  list(): Promise<Tunnel[]>;
  until(fn: (t: Tunnel[]) => boolean, what: string): Promise<Tunnel[]>;
  runs(): string[][];
}

async function made(mode: string, o: { dataDir?: string; cmd?: string; connectTimeout?: number; options?: Options } = {}): Promise<Made> {
  const dataDir = o.dataDir ?? mkdtempSync(path.join(os.tmpdir(), 'tunnels-data-'));
  const log = path.join(dataDir, 'ssh-runs.log');
  const host = testHost({ id: 'tunnels', dataDir, projects: [{ id: 'p1', name: 'app', folder: dataDir }] });
  const exec = (cmd: string, args: string[]) => (o.cmd ? { cmd: o.cmd, args } : { cmd: process.execPath, args: [FAKE, log, mode, cmd, ...args] });
  const plugin = await make({ exec, backoff: [0.05], probeEvery: 50, connectTimeout: o.connectTimeout, ...o.options })(host);
  const list = async () => (await invoke<Tunnels>(plugin, { op: 'list', project: 'p1' })).tunnels;
  const m: Made = {
    plugin,
    dataDir,
    log,
    list,
    async until(fn, what) {
      const end = Date.now() + 8000;
      for (;;) {
        const t = await list();
        if (fn(t)) return t;
        if (Date.now() > end) assert.fail(`${what}: ${JSON.stringify(t, null, 1)}`);
        await new Promise((r) => setTimeout(r, 25));
      }
    },
    // Each run's arguments (without the program's name).
    runs: () => (existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l).slice(1)) : []),
  };
  all.push(m);
  return m;
}

const stop = (m: Made) => m.plugin.shutdown?.();
const all: Made[] = [];
after(() => Promise.all(all.map(stop)));

test('a tunnel goes live with the address ssh prints, through its own key and nothing of yours', async () => {
  const m = await made('live');
  const added = await invoke<Tunnel>(m.plugin, { op: 'add', project: 'p1', port: 3000, name: 'web', stable: true });
  assert.equal(added.port, 3000);
  assert.equal(added.host, 'localhost');
  const [t] = await m.until((t) => t[0]?.status === 'live', 'live');
  assert.equal(t.url, 'https://calm-river-5f3a9c21.tunnl.gg');
  assert.equal(t.error, null);
  assert.equal(m.plugin.busy?.(), true, 'busy while a tunnel runs');

  const [args] = m.runs();
  const key = path.join(m.dataDir, 'keys', t.id);
  assert.deepEqual(args.slice(0, 5), ['-F', 'none', '-tt', '-i', key]);
  for (const option of ['IdentitiesOnly=yes', 'IdentityAgent=none', 'ExitOnForwardFailure=yes', 'StrictHostKeyChecking=accept-new']) assert.ok(args.includes(option), option);
  assert.ok(args.includes(`UserKnownHostsFile=${path.join(m.dataDir, 'known_hosts')}`));
  assert.deepEqual(args.slice(-3), ['-R', '80:localhost:3000', 'stable@proxy.tunnl.gg']);
  assert.match(readFileSync(key, 'utf8'), /^-----BEGIN OPENSSH PRIVATE KEY-----\n/);
  if (!WIN) assert.equal(statSync(key).mode & 0o777, 0o600);

  // Off: ssh goes, it stays off (kept), nothing keeps the part busy.
  await invoke(m.plugin, { op: 'set', project: 'p1', id: t.id, on: false });
  const [off] = await m.until((t) => t[0]?.status === 'off', 'off');
  assert.equal(off.on, false);
  assert.equal(off.url, null);
  assert.equal(m.plugin.busy?.(), false);
  const kept = JSON.parse(readFileSync(path.join(m.dataDir, 'tunnels.json'), 'utf8'));
  assert.equal(kept.tunnels[0].on, false);
  assert.equal(kept.tunnels[0].name, 'web');
  await stop(m);
});

test('the tunnels left on start again with the plugin; those off stay off', async () => {
  const first = await made('live');
  const a = await invoke<Tunnel>(first.plugin, { op: 'add', project: 'p1', port: 3000 });
  const b = await invoke<Tunnel>(first.plugin, { op: 'add', project: 'p1', port: 4000 });
  await invoke(first.plugin, { op: 'set', project: 'p1', id: b.id, on: false });
  await first.until((t) => t.find((x) => x.id === a.id)?.status === 'live', 'first live');
  await stop(first);

  const again = await made('live', { dataDir: first.dataDir });
  const list = await again.until((t) => t.find((x) => x.id === a.id)?.status === 'live', 'live again');
  assert.equal(list.find((x) => x.id === b.id)?.status, 'off');
  assert.match(list.find((x) => x.id === a.id)!.url!, /^https:\/\/quick-fox-[0-9a-f]+\.tunnl\.gg$/);
  await stop(again);
});

test('a tunnel that drops reconnects by itself', async () => {
  const m = await made('drop');
  await invoke(m.plugin, { op: 'add', project: 'p1', port: 3000, stable: false });
  await m.until(() => m.runs().length >= 3, 'three connections');
  const [t] = await m.list();
  assert.ok(t.on);
  assert.ok(['connecting', 'retrying', 'live'].includes(t.status), t.status);
  assert.equal(m.runs()[0].at(-1), 'proxy.tunnl.gg');
  await stop(m);
});

test('a changed host key stops it for good, with ssh’s words', async () => {
  const m = await made('hostkey');
  await invoke(m.plugin, { op: 'add', project: 'p1', port: 3000 });
  const [t] = await m.until((t) => t[0]?.status === 'failed', 'failed');
  assert.equal(t.error, 'Host key verification failed.');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(m.runs().length, 1, 'no retry');
  assert.equal(m.plugin.busy?.(), false);
  await stop(m);
});

test('ssh that can’t get through stops it, saying why; Restart tries again', async () => {
  const m = await made('banner');
  await invoke(m.plugin, { op: 'add', project: 'p1', port: 3000 });
  const [t] = await m.until((t) => t[0]?.status === 'failed', 'failed');
  assert.match(t.error!, /tunnl\.gg didn't answer: .*VPN, a proxy or a firewall.*ssh, port 22.*Restart to try again/);
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(m.runs().length, 1, 'no retry');
  assert.equal(m.plugin.busy?.(), false);
  await invoke(m.plugin, { op: 'restart', project: 'p1', id: t.id });
  await m.until(() => m.runs().length === 2, 'tried again');
  await m.until((t) => t[0]?.status === 'failed', 'failed again');
  await stop(m);
});

test('no address in time: it stops ssh and says so', async () => {
  const m = await made('quiet', { connectTimeout: 300 });
  await invoke(m.plugin, { op: 'add', project: 'p1', port: 3000 });
  const [t] = await m.until((t) => t[0]?.status === 'failed', 'failed');
  assert.match(t.error!, /tunnl\.gg didn't give an address in 0\.3 s/);
  assert.equal(m.plugin.busy?.(), false, 'ssh is gone');
  assert.equal(m.runs().length, 1);
  await stop(m);
});

test('without ssh it says so', async () => {
  const m = await made('live', { cmd: path.join(os.tmpdir(), 'no-such-ssh-here') });
  await invoke(m.plugin, { op: 'add', project: 'p1', port: 3000 });
  const [t] = await m.until((t) => t[0]?.status === 'failed', 'failed');
  assert.match(t.error!, /ssh isn't installed on this server/);
  assert.equal(m.plugin.busy?.(), false);
  await stop(m);
});

test('tunnl.gg allows three at once from one server', async () => {
  const m = await made('quiet');
  for (const port of [3001, 3002, 3003, 3004]) await invoke(m.plugin, { op: 'add', project: 'p1', port });
  const list = await m.until((t) => t.length === 4 && t[3].status === 'failed', 'the fourth refused');
  assert.match(list[3].error!, /tunnl\.gg allows 3 tunnels at once/);
  await m.until(() => m.runs().length === 3, 'three ssh runs');
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(m.runs().length, 3, 'never a fourth');
  // One off: the fourth can go.
  await invoke(m.plugin, { op: 'set', project: 'p1', id: list[0].id, on: false });
  await invoke(m.plugin, { op: 'restart', project: 'p1', id: list[3].id });
  await m.until((t) => t[3].status === 'connecting', 'the fourth connecting');
  await stop(m);
});

test('ports and hosts are checked, and nothing reads as an ssh option', async () => {
  const m = await made('live');
  for (const [req, message] of [
    [{ port: 0 }, /whole number from 1 to 65535/],
    [{ port: 70000 }, /whole number/],
    [{ port: 3000, host: '-oProxyCommand=touch /tmp/x' }, /isn't a host name/],
    [{ port: 3000, host: 'a b' }, /isn't a host name/],
    [{ port: 3000, provider: 'ngrok' }, /no tunnel service “ngrok”/],
    [{ port: 3000, type: 'smtp' }, /no tunnel type “smtp”/],
    [{ port: 3000, type: 'udp' }, /No service here carries UDP yet/],
    [{ port: 3000, type: 'tcp', provider: 'tunnl' }, /tunnl\.gg doesn't carry TCP: it carries HTTP/],
    [{ port: 3000, type: 'http', provider: 'bore' }, /bore\.pub doesn't carry HTTP/],
  ] as const) {
    await assert.rejects(invoke(m.plugin, { op: 'add', project: 'p1', ...req }), message);
  }
  const t = await invoke<Tunnel>(m.plugin, { op: 'add', project: 'p1', port: 8080, host: '::1' });
  await m.until((l) => l[0]?.status === 'live', 'live');
  assert.equal(m.runs()[0].at(-2), '80:[::1]:8080');
  await assert.rejects(invoke(m.plugin, { op: 'set', project: 'other', id: t.id, on: false }), /That tunnel is gone/);
  await stop(m);
});

test('watching says whether something answers on the port, and removing forgets the key', async () => {
  const server = net.createServer((s) => s.end()).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const port = (server.address() as net.AddressInfo).port;
  const m = await made('live');
  const t = await invoke<Tunnel>(m.plugin, { op: 'add', project: 'p1', port, stable: true });
  await m.until((l) => l[0]?.status === 'live', 'live');
  const s = stream<Tunnels>(m.plugin, { op: 'watch', project: 'p1' });
  for (;;) {
    const e = await s.next();
    if (e.tunnels[0]?.listening === true) break;
  }
  server.close();
  for (;;) {
    const e = await s.next();
    if (e.tunnels[0]?.listening === false) break;
  }
  s.cancel();
  const key = path.join(m.dataDir, 'keys', t.id);
  assert.ok(existsSync(key));
  await invoke(m.plugin, { op: 'remove', project: 'p1', id: t.id });
  assert.equal(existsSync(key), false);
  assert.deepEqual(await m.list(), []);
  await stop(m);
});

test('the address is found in what the service prints, and the last words are the ones shown', () => {
  const said = plain('\x1b[2J\x1b[1m  tunnl.gg\x1b[0m\r\n  █▀▀█\r\n  Your tunnel: \x1b[32mhttps://Happy-Tiger-a1b2c3d4.tunnl.gg\x1b[0m\r\n');
  assert.equal(tunnlAddress(said), 'https://happy-tiger-a1b2c3d4.tunnl.gg');
  assert.equal(tunnlAddress('https://evil.example/https://x.tunnl.gg.evil.example'), null);
  assert.equal(lastWords('Warning: x\r\n  █▀▀█ \r\nssh: connect to host proxy.tunnl.gg port 22: Connection refused\r\n\r\n'), 'ssh: connect to host proxy.tunnl.gg port 22: Connection refused');
  assert.equal(lastWords('\n\n'), null);
});
