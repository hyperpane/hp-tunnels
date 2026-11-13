// ssh as the tunnel services use it: none of the user's ssh setup (not
// ~/.ssh/config, their keys or their agent), only the tunnel's own key, a
// known_hosts of the plugin's own, and a remote forward.

import path from 'node:path';
import type { Context } from './index.ts';

/** `[::1]` for an IPv6 address, as `-R` needs it. */
export function bracketed(host: string): string {
  return host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
}

export async function sshArgs(ctx: Context, o: { port?: number; forward: string; to: string }): Promise<string[]> {
  return [
    // No config file: a ProxyJump or a ControlMaster there would change
    // what this does.
    '-F',
    'none',
    // A terminal on the other end: the services print the address to it.
    '-tt',
    ...(o.port ? ['-p', String(o.port)] : []),
    '-i',
    await ctx.key(),
    '-o',
    'IdentitiesOnly=yes',
    '-o',
    'IdentityAgent=none',
    '-o',
    'PasswordAuthentication=no',
    '-o',
    'KbdInteractiveAuthentication=no',
    '-o',
    `UserKnownHostsFile=${path.join(ctx.dataDir, 'known_hosts')}`,
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    'ConnectTimeout=20',
    '-o',
    'ServerAliveInterval=30',
    '-o',
    'ServerAliveCountMax=3',
    '-o',
    'ExitOnForwardFailure=yes',
    '-o',
    'LogLevel=ERROR',
    '-R',
    o.forward,
    o.to,
  ];
}
