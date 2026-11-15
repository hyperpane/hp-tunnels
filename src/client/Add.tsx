// The row to add a tunnel: what it carries (HTTP, TCP, UDP), through which
// service, to which port (or host:port), with an optional name; and, while
// there are none yet, what the chosen service is and needs.

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Checkbox, NodeButton, NodeInput, NodeSelect, Tabs, cn } from '@hyperpane/ui';
import { type ProviderId, type ProviderInfo, TYPES, type TunnelType, portProblem } from '../shared/index.ts';


export function Add({ providers, onAdd, empty }: { providers: ProviderInfo[]; onAdd(req: Record<string, unknown>): Promise<unknown>; empty: boolean }) {
  const [type, setType] = useState<TunnelType>('http');
  const carrying = providers.filter((p) => p.types.includes(type));
  const [chosen, setChosen] = useState<ProviderId | null>(null);
  const service = carrying.find((p) => p.id === chosen) ?? carrying[0] ?? null;
  const [port, setPort] = useState('');
  const [name, setName] = useState('');
  const [stable, setStable] = useState(true);
  const [busy, setBusy] = useState(false);
  // `3000`, or `host:3000` for another machine the server reaches.
  const cut = port.lastIndexOf(':');
  const [hostPart, portPart] = cut >= 0 ? [port.slice(0, cut), port.slice(cut + 1)] : ['', port];
  const n = Number(portPart);
  const problem = portPart ? portProblem(n) : null;

  const submit = async () => {
    if (!service || !portPart || problem || busy) return;
    setBusy(true);
    await onAdd({ type, provider: service.id, port: n, host: hostPart || undefined, name: name.trim() || undefined, stable: service.stable && stable });
    setBusy(false);
    setPort('');
    setName('');
  };

  return (
    <>
      <form
        className="flex flex-col gap-1.5 border-b border-[var(--node-border)] p-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <Tabs
            variant="pills"
            label="What it carries"
            className="h-6"
            value={type}
            onValueChange={setType}
            items={TYPES.map((t) => {
              const none = !providers.some((p) => p.types.includes(t.id));
              const title = none ? `${t.about} No free service without an account carries ${t.name} yet.` : t.about;
              // A disabled tab takes no pointer, so its tooltip is on its
              // name, which does.
              return { value: t.id, label: none ? <span className="pointer-events-auto" title={title}>{t.name}</span> : t.name, title, disabled: none };
            })}
          />
          <NodeSelect
            className="min-w-0 flex-1"
            value={(service?.id ?? '') as ProviderId}
            options={carrying.map((p) => ({ value: p.id, label: `${p.name} · ${p.via}` }))}
            onChange={(id) => setChosen(id as ProviderId)}
            aria-label="Service"
          />
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <NodeInput
            className={cn('w-28', problem && 'border-[var(--ansi-1)]')}
            placeholder={type === 'tcp' ? 'Port (5432)' : 'Port (3000)'}
            title={problem ?? 'The port to share: 3000, or host:3000 for another machine this server reaches.'}
            value={port}
            onChange={(e) => setPort(e.target.value.trim())}
            aria-label="Port"
          />
          <NodeInput className="min-w-20 flex-1" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
          {service?.stable && (
            <Checkbox className="gap-1.5 text-xs text-[var(--node-muted)]" title="Keep the same address every time it connects." label="Same address" checked={stable} onCheckedChange={setStable} />
          )}
          <NodeButton type="submit" disabled={!service || !portPart || !!problem || busy}>
            <Plus />
            Share
          </NodeButton>
        </div>
      </form>
      {empty && service && (
        <div className="flex flex-col gap-1.5 p-3 text-[var(--node-muted)]">
          <p className="text-[var(--node-fg)]">Share a port of this server on the internet.</p>
          <p>{TYPES.find((t) => t.id === type)?.about} Anyone with the address reaches the port.</p>
          <p>
            <span className="text-[var(--node-fg)]">{service.name}</span> goes out through {service.via} and needs {service.needs}.
          </p>
          {service.notes.map((note) => (
            <p key={note}>{note}</p>
          ))}
        </div>
      )}
    </>
  );
}
