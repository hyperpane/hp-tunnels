// A stand-in for ssh and cloudflared, for the tests:
// `node fake-ssh.mjs LOG MODE PROGRAM ...args`. It writes PROGRAM and its
// arguments to LOG (one JSON line per run) and then, by MODE:
//   live     prints an address as the service would (with colors and a QR
//            code for tunnl.gg, a box for cloudflared), stays
//   drop     prints an address, exits after a moment
//   hostkey  says the host key changed, exits 255
//   banner   times out as a blocked ssh does, exits 255
//   quiet    prints nothing, stays

import { appendFileSync } from 'node:fs';

const [log, mode, program, ...args] = process.argv.slice(2);
appendFileSync(log, `${JSON.stringify([program, ...args])}\n`);
const to = args.at(-1);
const random = () => Math.random().toString(16).slice(2, 10);

function address() {
  if (/cloudflared/.test(program)) {
    process.stderr.write('2026-11-13T03:00:00Z INF Requesting new quick Tunnel on trycloudflare.com...\n');
    process.stderr.write('2026-11-13T03:00:01Z INF +--------------------------------------------------------------------------------------------+\n');
    process.stderr.write(`2026-11-13T03:00:01Z INF |  https://brave-lion-${random()}.trycloudflare.com                                  |\n`);
    process.stderr.write('2026-11-13T03:00:01Z INF +--------------------------------------------------------------------------------------------+\n');
    return;
  }
  if (to === 'tcp@free.pinggy.io') {
    process.stdout.write('\x1b[2J\x1b[HYou are not authenticated.\r\n  \x1b[1mtcp://rnxyz-1-2-3-4.a.free.pinggy.link:41234\x1b[0m\r\n');
    return;
  }
  if (to === 'free.pinggy.io') {
    const name = `uljtt-${random()}`;
    process.stdout.write(`\x1b[2J\x1b[H  http://${name}.run.pinggy-free.link\r\n  https://${name}.run.pinggy-free.link\r\n`);
    return;
  }
  const name = to.startsWith('stable@') ? 'calm-river-5f3a9c21' : `quick-fox-${random()}`;
  process.stdout.write('\x1b[2J\x1b[H\x1b[1m  tunnl.gg\x1b[0m\r\n\r\n');
  process.stdout.write('  █▀▀▀▀▀█ ▄▀▄ █▀▀▀▀▀█\r\n  █ ███ █ ▀▄▀ █ ███ █\r\n');
  process.stdout.write(`\r\n  Your tunnel: \x1b[32mhttps://${name}.tunnl.gg\x1b[0m\r\n`);
}

if (mode === 'live') {
  address();
  setInterval(() => {}, 1 << 30);
} else if (mode === 'drop') {
  address();
  setTimeout(() => {
    process.stderr.write(`Connection to ${to} closed by remote host.\r\n`);
    process.exit(255);
  }, 150);
} else if (mode === 'hostkey') {
  process.stderr.write('@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@@\n');
  process.stderr.write('@    WARNING: REMOTE HOST IDENTIFICATION HAS CHANGED!     @\n');
  process.stderr.write('Host key verification failed.\n');
  process.exit(255);
} else if (mode === 'banner') {
  setTimeout(() => {
    process.stderr.write('Connection timed out during banner exchange\r\nConnection to 46.62.160.120 port 22 timed out\r\n');
    process.exit(255);
  }, 50);
} else {
  setInterval(() => {}, 1 << 30);
}
