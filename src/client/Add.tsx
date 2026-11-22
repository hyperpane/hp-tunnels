// The row to add a tunnel: what it carries (HTTP, TCP, UDP), through which
// service, to which port (or host:port), with an optional name; and, while
// there are none yet, what the chosen service is and needs.

import { useState } from 'react';
import { Globe, Plus } from 'lucide-react';
import { Checkbox, Empty, NodeButton, NodeInput, NodeSelect, Tabs, cn } from '@hyperpane/ui';
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
        className="flex flex-none flex-col gap-3 border-b border-[var(--node-border)] p-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <div className="flex flex-wrap items-end gap-x-2 gap-y-3">
          <Field label="Carries">
            <Tabs
              variant="pills"
              label="What it carries"
              value={type}
              onValueChange={setType}
              items={TYPES.map((t) => {
                const none = !providers.some((p) => p.types.includes(t.id));
                const title = none ? `${t.about} No free service without an account carries ${t.name} yet` : t.about;
                // A disabled tab takes no pointer, so its tooltip is on its
                // name, which does.
                return {
                  value: t.id,
                  label: none ? (
                    <span className="pointer-events-auto" title={title}>
                      {t.name}
                    </span>
                  ) : (
                    t.name
                  ),
                  title,
                  disabled: none,
                };
              })}
            />
          </Field>
          <Field label="Through" className="min-w-40 flex-1">
            <NodeSelect
              className="w-full"
              value={(service?.id ?? '') as ProviderId}
              options={carrying.map((p) => ({ value: p.id, label: `${p.name} · ${p.via}` }))}
              onChange={(id) => setChosen(id as ProviderId)}
              aria-label="Service"
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-end gap-x-2 gap-y-3">
          <Field label="Port" className="w-28">
            <NodeInput
              className={cn('w-full font-mono', problem && 'border-[var(--ansi-1)]')}
              placeholder={type === 'tcp' ? 'Port (5432)' : 'Port (3000)'}
              title={problem ?? 'The port to share: 3000, or host:3000 for another machine this server reaches'}
              value={port}
              onChange={(e) => setPort(e.target.value.trim())}
              aria-label="Port"
            />
          </Field>
          <Field label="Name" className="min-w-24 flex-1">
            <NodeInput className="w-full" placeholder="Optional" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name" />
          </Field>
          {service?.stable && (
            <Checkbox
              className="h-7 gap-1.5 px-1 text-xs text-[var(--node-muted)] touch:h-9"
              title="Keep the same address every time it connects"
              label="Same address"
              checked={stable}
              onCheckedChange={setStable}
            />
          )}
          <NodeButton type="submit" variant="primary" disabled={!service || !portPart || !!problem || busy}>
            <Plus />
            Share
          </NodeButton>
        </div>
      </form>
      {empty && service && (
        <Empty
          bordered={false}
          className="min-h-0 flex-1 overflow-y-auto"
          icon={<Globe />}
          title="Share a port of this server on the internet"
          description={
            <span className="flex flex-col gap-1.5">
              <span>{TYPES.find((t) => t.id === type)?.about} Anyone with the address reaches the port.</span>
              <span>
                <span className="text-[var(--node-fg)]">{service.name}</span> goes out through {service.via} and needs {service.needs}.
              </span>
              {service.notes.map((note) => (
                <span key={note}>{note}</span>
              ))}
            </span>
          }
        />
      )}
    </>
  );
}

/** A field with its name above it. A div, not a label: what's in it names
 * itself (aria-label), and a row of tabs isn't one control. */
function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={cn('flex min-w-0 flex-col gap-1.5', className)}>
      <span className="text-2xs font-medium text-[var(--node-muted)]">{label}</span>
      {children}
    </div>
  );
}
