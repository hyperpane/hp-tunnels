// The Tunnels window: the project's tunnels as the server part has them (a
// subscription), each with its public address, whether something answers
// on its port, and on/off, copy, open, restart and remove; and a row to add
// one: what it carries (HTTP, TCP, UDP), through which service, to which
// port.
//
// Its output (linked in nodes mode): a tunnel's public address, once it's
// live with one. Each address goes out once.
//
// The add row is Add.tsx, each tunnel a Row.tsx.

import { useEffect, useRef, useState } from 'react';
import { useHost, useProject } from '@hyperpane/sdk/client';
import { CircleAlert, FolderOpen } from '@hyperpane/icons';
import { Empty, SectionHeader, Spinner } from '@hyperpane/ui';
import type { ProviderId, Tunnels as Reply } from '../shared/index.ts';
import { Add } from './Add.tsx';
import { type Call, Row } from './Row.tsx';
import { ACCENT } from './accent.ts';

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

  // The address each tunnel last sent, and the last one sent at all. A
  // tunnel that comes up (or gets a new address) sends it; when several do
  // in one update, the last of them goes.
  const sent = useRef(new Map<string, string>());
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!reply) return;
    let next: string | null = null;
    for (const t of reply.tunnels) {
      if (t.status !== 'live' || !t.url || sent.current.get(t.id) === t.url) continue;
      sent.current.set(t.id, t.url);
      next = t.url;
    }
    if (next && next !== last.current) {
      last.current = next;
      host.ports.emit('url', next);
    }
  }, [host, reply]);

  if (!project)
    return <Empty size="compact" className="h-full" icon={<FolderOpen />} title="No project" description="Open a project to add tunnels to it." />;
  if (error)
    return (
      <Empty
        size="compact"
        className="h-full"
        icon={<CircleAlert className="text-[var(--destructive-soft-foreground)]" />}
        title="Couldn’t load the tunnels"
        description={error}
      />
    );
  if (!reply)
    return (
      <div className="flex h-full items-center justify-center gap-2 text-[13px] text-[var(--node-muted)]">
        <Spinner size="sm" />
        Loading
      </div>
    );

  const call: Call = (req) => host.call(ID, { project: project.id, ...req }).catch((e: Error) => host.app.toast(e.message, { error: true }));
  const names = Object.fromEntries(reply.providers.map((p) => [p.id, p.name])) as Record<ProviderId, string>;

  const live = reply.tunnels.filter((t) => t.status === 'live').length;
  return (
    <div className="flex h-full flex-col text-[13px] leading-5 text-[var(--node-fg)]" style={ACCENT}>
      <Add providers={reply.providers} onAdd={(req) => call({ op: 'add', ...req })} empty={reply.tunnels.length === 0} />
      {reply.tunnels.length > 0 && (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-1.5 pt-2 pb-1.5">
          <SectionHeader
            label="Tunnels"
            count={reply.tunnels.length}
            actions={live > 0 ? <span className="text-xs text-[var(--green-soft-foreground)] tabular-nums">{live} live</span> : undefined}
          />
          <div className="flex flex-col gap-0.5">
            {reply.tunnels.map((t) => (
              <Row key={t.id} t={t} service={names[t.provider] ?? t.provider} call={call} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
