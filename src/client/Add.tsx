// The card to add a tunnel: what it carries (HTTP, TCP, UDP), through which
// service, to which port (or host:port), with an optional name; and, while
// there are none yet, what the chosen service is and needs.

import { useState } from 'react';
import { Globe, Plus } from '@hyperpane/icons';
import { Button, Checkbox, Empty, Input, SegmentedControl, Select, cn } from '@hyperpane/ui';
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
      <div className="flex-none p-3 pb-1">
        <form
          className="rounded-card flex flex-col gap-2 bg-[var(--surface-raised)] p-2"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedControl
              size="sm"
              label="What it carries"
              value={type}
              onValueChange={(v) => setType(v as TunnelType)}
              options={TYPES.map((t) => {
                const none = !providers.some((p) => p.types.includes(t.id));
                const title = none ? `${t.about} No free service without an account carries ${t.name} yet` : t.about;
                // A disabled option takes no pointer, so its tooltip is on
                // its name, which does.
                return {
                  value: t.id,
                  label: (
                    <span className="pointer-events-auto px-1" title={title}>
                      {t.name}
                    </span>
                  ),
                  srLabel: t.name,
                  disabled: none,
                };
              })}
            />
            <Select
              size="sm"
              variant="ghost"
              className="min-w-40 flex-1"
              triggerLabel="Service"
              triggerClassName="[&_svg]:size-3.5"
              value={service?.id ?? ''}
              options={carrying.map((p) => ({ value: p.id, label: `${p.name} · ${p.via}` }))}
              onValueChange={(id: string) => setChosen(id as ProviderId)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input
              size="sm"
              variant="secondary"
              containerClassName="w-32 flex-none"
              className="font-mono"
              error={!!problem}
              placeholder={type === 'tcp' ? 'Port, 5432' : 'Port, 3000'}
              title={problem ?? 'The port to share: 3000, or host:3000 for another machine this server reaches'}
              value={port}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPort(e.target.value.trim())}
              aria-label="Port"
            />
            <Input
              size="sm"
              variant="secondary"
              containerClassName="min-w-24 flex-1"
              placeholder="Name (optional)"
              value={name}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
              aria-label="Name"
            />
            {service?.stable && (
              <Checkbox
                className="h-7 gap-1.5 px-1 text-[13px] text-[var(--node-muted)] touch:h-9"
                title="Keep the same address every time it connects"
                label="Same address"
                checked={stable}
                onCheckedChange={setStable}
              />
            )}
            <Button type="submit" size="sm" loading={busy} disabled={!service || !portPart || !!problem || busy}>
              <Plus className="size-3.5" />
              Share
            </Button>
          </div>
          {problem && <p className={cn('px-1 text-xs text-[var(--destructive-soft-foreground)]')}>{problem}</p>}
        </form>
      </div>
      {empty && service && (
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <Empty
            size="compact"
            className="my-auto"
            icon={<Globe />}
            title="Share a port of this server on the internet"
            description={
              <span className="flex flex-col gap-1.5">
                <span>{TYPES.find((t) => t.id === type)?.about} Anyone with the address reaches the port.</span>
                <span>
                  <span className="font-medium text-[var(--node-fg)]">{service.name}</span> goes out through {service.via} and needs {service.needs}.
                </span>
                {service.notes.map((note) => (
                  <span key={note}>{note}</span>
                ))}
              </span>
            }
          />
        </div>
      )}
    </>
  );
}
