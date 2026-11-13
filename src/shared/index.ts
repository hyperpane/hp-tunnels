// What both parts share: a tunnel as it's kept, as it runs, and the
// services that carry them.

/** What a tunnel carries. `http` is HTTP and HTTPS, WebSockets included
 * (they start as HTTP); `tcp` any TCP (a database, ssh, a game); `udp` UDP. */
export type TunnelType = 'http' | 'tcp' | 'udp';

export const TYPES: { id: TunnelType; name: string; about: string }[] = [
  { id: 'http', name: 'HTTP', about: 'A web app or API, WebSockets included: an https address.' },
  { id: 'tcp', name: 'TCP', about: 'Any TCP service (a database, ssh, a game server): a host and a port.' },
  { id: 'udp', name: 'UDP', about: 'A UDP service (a game, DNS, VoIP): a host and a port.' },
];

/** The services a tunnel can go through. */
export type ProviderId = 'tunnl' | 'pinggy' | 'cloudflare' | 'bore';

export interface ProviderInfo {
  id: ProviderId;
  name: string;
  /** The types it carries. */
  types: TunnelType[];
  /** How it reaches the service (`ssh, port 22`): what a VPN or a firewall
   * has to let through. */
  via: string;
  /** What it needs on the server (`ssh`). */
  needs: string;
  /** At most this many of its tunnels live at once, from one server. */
  maxLive: number;
  /** Whether a tunnel can keep the same address when it reconnects. */
  stable: boolean;
  /** What to tell people about it. */
  notes: string[];
}

/** A tunnel as it's kept on the server. */
export interface TunnelSpec {
  id: string;
  /** The project it belongs to. */
  project: string;
  type: TunnelType;
  provider: ProviderId;
  /** What it forwards to, as seen from the server: `localhost`, or another
   * machine the server reaches. */
  host: string;
  port: number;
  /** A name for it, or empty. */
  name: string;
  /** Keep the same public address every time (its own key). */
  stable: boolean;
  /** Whether it should be running: kept across restarts. */
  on: boolean;
  /** Milliseconds since 1970. */
  created: number;
}

export type Status = 'off' | 'connecting' | 'live' | 'retrying' | 'failed';

/** A tunnel with what it's doing now. */
export interface Tunnel extends TunnelSpec {
  status: Status;
  /** Its public address while it's live (and the last one, while it
   * reconnects): `https://…` for HTTP, `tcp://host:port` for TCP. */
  url: string | null;
  /** Why it isn't live, when something went wrong. */
  error: string | null;
  /** What it's doing, while it gets ready (`Downloading cloudflared… 40%`). */
  note: string | null;
  /** Since when it has this status. */
  since: number;
  /** Whether something answers at host:port (null: not checked, or UDP). */
  listening: boolean | null;
}

/** What the `watch` subscription sends: a project's tunnels, again on every
 * change. */
export interface Tunnels {
  tunnels: Tunnel[];
  providers: ProviderInfo[];
}

/** The `add` call's request (with `project`). */
export interface NewTunnel {
  port: number;
  type?: TunnelType;
  host?: string;
  name?: string;
  stable?: boolean;
  provider?: ProviderId;
}

export const MAX_TUNNELS = 20;
/** `localhost`, not 127.0.0.1: a dev server often listens on ::1 only
 * (Vite does on macOS), and localhost reaches either. */
export const DEFAULT_HOST = 'localhost';

/** A port, or why it isn't one. */
export function portProblem(port: unknown): string | null {
  if (typeof port !== 'number' || !Number.isInteger(port) || port < 1 || port > 65535) return 'A port is a whole number from 1 to 65535.';
  return null;
}

/** A host to forward to, or why it isn't one: a name or an IP address,
 * nothing that could be read as a command's option. */
export function hostProblem(host: unknown): string | null {
  if (typeof host !== 'string' || !host) return 'Say which host to forward to (localhost for this server).';
  if (host.length > 253 || !/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$|^\[?[0-9A-Fa-f:.]+\]?$/.test(host)) return `“${host}” isn't a host name or an IP address.`;
  return null;
}

/** The address as people read it: no `https://`; `host:port` for TCP. */
export function shownAddress(url: string): string {
  return url.replace(/^(https|tcp|udp):\/\//, '');
}
