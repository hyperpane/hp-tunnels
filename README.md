# Tunnels

Share a port of the server on the internet: pick what it carries (HTTP or
TCP), a service, type the port, press Share, and get a public address. The
tunnel runs on the server, in the plugin's server part, whether or not the
app is open.

## Types and services

| Service | HTTP + WebSocket | TCP | Goes out through | Needs |
| --- | --- | --- | --- | --- |
| [tunnl.gg](https://tunnl.gg) | ✓ (same address possible) | | ssh, port 22 | ssh |
| [Pinggy](https://pinggy.io) | ✓ | ✓ | ssh, port 443 | ssh |
| [Cloudflare](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/do-more-with-tunnels/trycloudflare/) quick tunnels | ✓ | | HTTPS, port 443 | cloudflared (downloaded once) |
| [bore.pub](https://github.com/ekzhang/bore) | | ✓ | TCP port 7835 | nothing |

None needs an account. **UDP:** no free service carries it without an
account or its own app yet (Pinggy's UDP needs its CLI), so it's shown but
can't be picked.

- **HTTP** carries WebSockets too: they start as HTTP. The address is
  `https://…`; click it to open it.
- **TCP** is for anything else on TCP (a database, ssh, a game server): the
  address is a host and a port to connect to.
- **On a VPN or a strict network**, pick a service that goes out on port 443
  (Pinggy, Cloudflare): port 22 and 7835 are often blocked.

What each service is like:

- **tunnl.gg:** browsers see a warning page first (once a day; a week for
  a stable address), curl and webhooks don't. 3 tunnels at once, 5 GB a
  day, 24 hours per connection. **Same address** keeps the address across
  reconnects (made from the tunnel's own key).
- **Pinggy:** free connections last 60 minutes; it reconnects, with a new
  address.
- **Cloudflare:** no warning page; at most 200 requests at once, no
  Server-Sent Events; a new address each time. cloudflared is the server's
  own if it's on its PATH; else version 2026.10.6 is downloaded once from
  Cloudflare's GitHub releases into the plugin's data folder, and used only
  if its SHA-256 is the one Cloudflare published. It runs with `--protocol
  http2` (port 443, not QUIC) and a home of its own (a
  `~/.cloudflared/config.yml` would stop quick tunnels).
- **bore.pub:** the plugin speaks bore's protocol itself. bore doesn't
  encrypt: use it for what encrypts itself (ssh, TLS) or doesn't matter.

**Anyone with an address reaches the port.** Share what's meant to be seen.

## In the window

Each tunnel shows whether it's live, its address (open, copy), and
**nothing listening** while nothing answers on its port. The switch turns
it off and on (kept; those left on start again with the plugin), Restart
reconnects, Remove forgets it (and its key).

- **Connecting** has 30 seconds to get an address.
- A tunnel that **never got through** since it was turned on (a timeout, a
  refused connection, a host that can't be found, a changed host key, a
  missing program) **stops** and says why; Restart tries again.
- One that **was live and drops** reconnects by itself after 2, 5, 10, 30,
  then every 60 seconds.

## How it works

The server part keeps the tunnels in its data folder
(`<server data>/plugins/tunnels/tunnels.json`): they're this server's, not
the project's. Each one that's on is one session of its service: an `ssh`,
a `cloudflared`, or a bore connection of the plugin's own.

The ssh ones use none of your ssh setup (not `~/.ssh/config`, your keys or
your agent): each tunnel has its own Ed25519 key, made by the plugin, in
`keys/`, readable by you only, and the services' host keys are remembered
in the plugin's own `known_hosts`. If one ever changes, the tunnel stops
instead of connecting.

While a tunnel is on, the server part counts as busy, so it isn't stopped
for being idle. Its log (Logs, on its page in Plugins) says when each
session starts and ends, and what it said.

Another service is a file in `src/server/providers/` and a line in its
`index.ts`.

## Develop

```sh
./build.sh --test     # types, plugin.json, and the tests (stand-ins for ssh, cloudflared and bore.pub)
```
