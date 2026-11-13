// The client part: the Tunnels window. The tunnels themselves run in the
// server part, on the server, whether or not this window is open.

import { mount } from '@hyperpane/sdk/client';
import { NodeMessage } from '@hyperpane/ui';
import { TunnelsView } from './Tunnels.tsx';

mount((host) =>
  host.view.type === 'node' && host.view.kind === 'tunnels' ? <TunnelsView /> : <NodeMessage error>Tunnels has no “{host.view.type}” view here.</NodeMessage>,
);
