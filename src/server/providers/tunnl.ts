// tunnl.gg: an HTTPS address for a port, through the ssh that's already on
// the server. No account, nothing to install. `ssh -t -R 80:HOST:PORT
// proxy.tunnl.gg` (or `stable@…` for the same address every time, made
// from the key) prints the address and keeps the tunnel while the session
// lasts. https://tunnl.gg, server: github.com/klipitkas/tunnl.gg (MIT).

import { runCommand } from './command.ts';
import type { Provider } from './index.ts';
import { bracketed, sshArgs } from './ssh.ts';

const HOST = 'proxy.tunnl.gg';

export function tunnlAddress(text: string): string | null {
  return /https:\/\/[a-z0-9-]+\.tunnl\.gg(?![\w.-])/i.exec(text)?.[0].toLowerCase() ?? null;
}

export const tunnl: Provider = {
  info: {
    id: 'tunnl',
    name: 'tunnl.gg',
    types: ['http'],
    via: 'ssh, port 22',
    needs: 'ssh',
    maxLive: 3,
    stable: true,
    notes: [
      'Browsers see a warning page first (once a day; once a week for a stable address); curl and webhooks don’t.',
      'Free: 3 tunnels at once, 5 GB a day, 24 hours per connection (it reconnects by itself).',
    ],
  },

  async start(t, ctx, on) {
    const args = await sshArgs(ctx, { forward: `80:${bracketed(t.host)}:${t.port}`, to: t.stable ? `stable@${HOST}` : HOST });
    return runCommand(ctx, on, { cmd: 'ssh', args, name: 'ssh' }, tunnlAddress);
  },
};
