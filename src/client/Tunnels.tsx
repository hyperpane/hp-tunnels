// The Tunnels window: the project's tunnels as the server part has them (a
// subscription), each with its public address, whether something answers
// on its port, and on/off, copy, open, restart and remove; and a row to add
// one: what it carries (HTTP, TCP, UDP), through which service, to which
// port.
//
// The add row is Add.tsx, each tunnel a Row.tsx.

import { useEffect, useState } from 'react';
import { useHost, useProject } from '@hyperpane/sdk/client';
import { NodeMessage } from '@hyperpane/ui';
import type { ProviderId, Tunnels as Reply } from '../shared/index.ts';
import { Add } from './Add.tsx';
import { type Call, Row } from './Row.tsx';

const ID = 'tunnels';

export function TunnelsView() {
  const host = useHost();
  const project = useProject();
  const [reply, setReply] = useState<Reply | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!project) return;
    setReply(null);
    setError(null);
    return host.subscribe<Reply>(ID, { op: 'watch', project: project.id }, setReply, { onEnd: (e) => e && setError(e) });
  }, [project?.id, host]);

  if (!project) return <NodeMessage>Open a project to add tunnels to it.</NodeMessage>;
  if (error) return <NodeMessage error>{error}</NodeMessage>;
  if (!reply) return <NodeMessage>Loading…</NodeMessage>;

  const call: Call = (req) => host.call(ID, { project: project.id, ...req }).catch((e: Error) => host.app.toast(e.message, { error: true }));
  const names = Object.fromEntries(reply.providers.map((p) => [p.id, p.name])) as Record<ProviderId, string>;

  return (
    <div className="flex h-full flex-col text-xs text-[var(--node-fg)]">
      <Add providers={reply.providers} onAdd={(req) => call({ op: 'add', ...req })} empty={reply.tunnels.length === 0} />
      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {reply.tunnels.map((t) => (
          <Row key={t.id} t={t} service={names[t.provider] ?? t.provider} call={call} />
        ))}
      </div>
    </div>
  );
}
