// Why a tunnel's connection ended, said for people, and whether trying
// again could help: a changed host key or a bad option won't fix itself,
// whatever happened before.

import type { ProviderInfo } from '../shared/index.ts';
import { lastWords } from './providers/command.ts';

/** Problems no retry fixes, whatever happened before. */
const FATAL = [/host key verification failed/i, /remote host identification has changed/i, /bad configuration option/i, /no such identity|load key/i];

/** Whether what it said is a problem no retry fixes. */
export function fatal(said: string): boolean {
  return FATAL.some((re) => re.test(said));
}

/** Why a connection failed, said for people: null when the program's own
 * words are the best there is. */
export function explain(said: string, p: ProviderInfo): string | null {
  const blocked = `something on the way (a VPN, a proxy or a firewall) may be blocking ${p.via}. Restart to try again, or try another service.`;
  if (/banner exchange/i.test(said)) return `${p.name} didn't answer: ${blocked}`;
  if (/timed out|didn't answer in time|went quiet/i.test(said)) return `${p.name} didn't answer in time: ${blocked}`;
  if (/could not resolve hostname|nodename nor servname|name or service not known|ENOTFOUND|EAI_AGAIN/i.test(said)) return `${p.name} couldn't be found: is this server online? Restart to try again.`;
  if (/connection refused|no route to host|network is unreachable|connection reset|ECONNREFUSED|EHOSTUNREACH|ENETUNREACH|ECONNRESET/i.test(said))
    return `Couldn't reach ${p.name} (${lastWords(said)}). Restart to try again, or try another service.`;
  if (/permission denied/i.test(said)) return `${p.name} turned the connection down (${lastWords(said)}).`;
  return null;
}

/** Why a connection that never showed its address within `ms` stopped. */
export function timedOut(p: ProviderInfo, ms: number): string {
  return `${p.name} didn't give an address in ${ms / 1000} s: something on the way (a VPN, a proxy or a firewall) may be blocking ${p.via}. Restart to try again, or try another service.`;
}
