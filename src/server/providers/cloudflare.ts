// Cloudflare's quick tunnels: an https://….trycloudflare.com address for a
// port, no account, through cloudflared over HTTPS (port 443: `--protocol
// http2`, not QUIC on 7844, so VPNs and firewalls let it through). No
// warning page. Limits: 200 requests in flight, no Server-Sent Events; a
// new address each time. cloudflared runs with a home of its own, so a
// ~/.cloudflared/config.yml (which quick tunnels refuse) isn't read.

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { cloudflared } from '../cloudflared.ts';
import { runCommand } from './command.ts';
import type { Provider } from './index.ts';
import { bracketed } from './ssh.ts';

export function cloudflareAddress(text: string): string | null {
  return /https:\/\/[a-z0-9-]+\.trycloudflare\.com(?![\w.-])/i.exec(text)?.[0].toLowerCase() ?? null;
}

export const cloudflare: Provider = {
  info: {
    id: 'cloudflare',
    name: 'Cloudflare',
    types: ['http'],
    via: 'HTTPS, port 443',
    needs: 'cloudflared (downloaded once if the server hasn’t got it)',
    maxLive: 10,
    stable: false,
    notes: ['No warning page. At most 200 requests at once, no Server-Sent Events; a new address each time it connects.'],
  },

  async start(t, ctx, on) {
    let cmd: string;
    try {
      cmd = await cloudflared(ctx.dataDir, { note: ctx.note, download: ctx.download });
    } catch (e) {
      ctx.note(null);
      queueMicrotask(() => on.ended((e as Error).message, true));
      return { stop() {} };
    }
    const home = path.join(ctx.dataDir, 'cloudflared-home');
    mkdirSync(home, { recursive: true });
    const args = ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://${bracketed(t.host)}:${t.port}`];
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    return runCommand(ctx, on, { cmd, args, env, name: 'cloudflared' }, cloudflareAddress);
  },
};
