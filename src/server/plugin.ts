// The server part's calls, apart from main.ts so the tests can make it with
// a test host: `watch` (a project's tunnels, again on every change), `list`,
// `add`, `set` (on or off), `restart`, `rename` and `remove`. The tunnels
// left on start as it does.

import { type Host, type Plugin, json } from '@hyperpane/sdk/server';
import type { NewTunnel, Tunnels as TunnelsReply } from '../shared/index.ts';
import { type Options, Tunnels } from './tunnels.ts';

export function make(o: Options = {}): (host: Host) => Promise<Plugin> {
  return async (host) => {
    const tunnels = new Tunnels(host, o);
    await tunnels.load();
    const reply = (list: TunnelsReply['tunnels']): TunnelsReply => ({ tunnels: list, providers: tunnels.providers });

    return json({
      calls: {
        list: ({ project }) => reply(tunnels.list(String(project))),
        add: ({ project, ...n }) => tunnels.add(String(project), n as NewTunnel),
        set: ({ project, id, on }) => tunnels.set(String(project), String(id), !!on).then(() => null),
        restart: ({ project, id }) => tunnels.restart(String(project), String(id)).then(() => null),
        rename: ({ project, id, name }) => tunnels.rename(String(project), String(id), String(name ?? '')).then(() => null),
        remove: ({ project, id }) => tunnels.remove(String(project), String(id)).then(() => null),
      },
      subscriptions: {
        watch: ({ project }, out) => tunnels.watch(String(project), (list) => out.emit(reply(list)), out.signal),
      },
      busy: () => tunnels.busy(),
      projectOff: (project: string) => tunnels.projectOff(project),
      shutdown: () => tunnels.shutdown(),
    })(host);
  };
}

export const plugin = make();
