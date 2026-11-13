// Pinggy: HTTP and TCP tunnels through ssh on port 443 (which most VPNs and
// firewalls let through), no account. `ssh -p 443 -R0:HOST:PORT
// free.pinggy.io` prints `https://….pinggy-free.link`; `tcp@free.pinggy.io`
// prints `tcp://….pinggy.link:PORT`. Free tunnels last 60 minutes; it
// reconnects, with a new address. https://pinggy.io/docs

import { runCommand } from './command.ts';
import type { Provider } from './index.ts';
import { bracketed, sshArgs } from './ssh.ts';

const HOST = 'free.pinggy.io';
const DOMAIN = String.raw`(?:[a-z0-9-]+\.)+pinggy(?:-free)?\.(?:link|online)`;

export function pinggyAddress(text: string, type: 'http' | 'tcp'): string | null {
  if (type === 'tcp') {
    const m = new RegExp(String.raw`tcp://(${DOMAIN}):(\d{1,5})(?![\w.-])`, 'i').exec(text);
    return m ? `tcp://${m[1].toLowerCase()}:${m[2]}` : null;
  }
  return new RegExp(String.raw`https://${DOMAIN}(?![\w.-])`, 'i').exec(text)?.[0].toLowerCase() ?? null;
}

export const pinggy: Provider = {
  info: {
    id: 'pinggy',
    name: 'Pinggy',
    types: ['http', 'tcp'],
    via: 'ssh, port 443',
    needs: 'ssh',
    maxLive: 3,
    stable: false,
    notes: [
      'Goes out on port 443, which most VPNs and firewalls let through.',
      'Free: each connection lasts 60 minutes, then it reconnects with a new address.',
    ],
  },

  async start(t, ctx, on) {
    const type = t.type === 'tcp' ? 'tcp' : 'http';
    const args = await sshArgs(ctx, { port: 443, forward: `0:${bracketed(t.host)}:${t.port}`, to: type === 'tcp' ? `tcp@${HOST}` : HOST });
    return runCommand(ctx, on, { cmd: 'ssh', args, name: 'ssh' }, (text) => pinggyAddress(text, type));
  },
};
