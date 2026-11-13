// The row to add a tunnel: what it carries (HTTP, TCP, UDP), through which
// service, to which port (or host:port), with an optional name; and, while
// there are none yet, what the chosen service is and needs.

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { NodeButton, NodeInput, cn } from '@hyperpane/ui';
import { type ProviderId, type ProviderInfo, TYPES, type TunnelType, portProblem } from '../shared/index.ts';

const field = 'rounded-control h-6 border border-[var(--node-border)] bg-transparent px-1.5 text-xs text-[var(--node-fg)] outline-none focus:border-[var(--node-accent)]';

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
          <div className="rounded-control flex h-6 flex-none overflow-hidden border border-[var(--node-border)]" role="radiogroup" aria-label="What it carries">
            {TYPES.map((t) => {
              const none = !providers.some((p) => p.types.includes(t.id));
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={type === t.id}
                  title={none ? `${t.about} No free service without an account carries ${t.name} yet.` : t.about}
                  disabled={none}
                  onClick={() => setType(t.id)}
                  className={cn(
                    'px-2 text-xs transition-colors duration-100 disabled:opacity-40',
                    type === t.id ? 'bg-[color-mix(in_srgb,var(--node-accent)_22%,transparent)] text-[var(--node-fg)]' : 'text-[var(--node-muted)] hover:bg-[var(--node-hover)]',
                  )}
                >
                  {t.name}
                </button>
              );
            })}
          </div>
          <select className={cn(field, 'min-w-0 flex-1')} value={service?.id ?? ''} onChange={(e) => setChosen(e.target.value as ProviderId)} aria-label="Service">
            {carrying.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.via}
              </option>
            ))}
          </select>
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
            <label className="flex items-center gap-1 text-[var(--node-muted)]" title="Keep the same address every time it connects.">
              <input type="checkbox" checked={stable} onChange={(e) => setStable(e.target.checked)} />
              Same address
            </label>
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
