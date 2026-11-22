// One tunnel in the list: its status, name, local port and service; whether
// something answers on the port; restart, remove and on/off; its public
// address with copy and open; and what it's doing or why it stopped.

import { Copy, ExternalLink, RotateCw, Trash2 } from 'lucide-react';
import { formatAgo, useHost } from '@hyperpane/sdk/client';
import { Badge, Switch, ToolButton, cn } from '@hyperpane/ui';
import { type Tunnel, shownAddress } from '../shared/index.ts';

const DOT: Record<Tunnel['status'], string> = {
  live: 'bg-[var(--ansi-2)]',
  connecting: 'bg-[var(--ansi-3)] animate-pulse',
  retrying: 'bg-[var(--ansi-3)] animate-pulse',
  failed: 'bg-[var(--ansi-1)]',
  off: 'bg-[var(--node-muted)] opacity-50',
};

const SAID: Record<Tunnel['status'], string> = {
  live: 'Live',
  connecting: 'Connecting',
  retrying: 'Reconnecting',
  failed: 'Stopped',
  off: 'Off',
};

export type Call = (req: Record<string, unknown>) => Promise<unknown>;

export function Row({ t, service, call }: { t: Tunnel; service: string; call: Call }) {
  const host = useHost();
  const on = t.on;
  const target = t.host === '127.0.0.1' || t.host === 'localhost' ? `:${t.port}` : `${t.host}:${t.port}`;
  const web = t.type === 'http';
  return (
    <div className="group rounded-control flex flex-none flex-col gap-0.5 px-2 py-1.5 transition-colors duration-75 hover:bg-[var(--node-hover)]">
      <div className="flex min-h-7 items-center gap-1">
        {/* What it is; a narrow window wraps it rather than squeeze its tools. */}
        <div className="flex min-w-0 flex-1 items-center gap-2 max-sm:flex-wrap max-sm:gap-y-0.5">
          <span className={cn('size-2 flex-none rounded-full', DOT[t.status])} title={SAID[t.status]} />
          <span className="truncate font-medium">{t.name || `Port ${t.port}`}</span>
          <span className="flex-none font-mono text-[var(--node-muted)] tabular-nums">{target}</span>
          <Badge size="sm" shape="rounded" className="flex-none text-[var(--node-muted)]" title={`Through ${service}`}>
            {t.type.toUpperCase()} · {service}
          </Badge>
          {t.listening === false && on && (
            <span
              className="text-2xs flex-none text-[var(--ansi-3)]"
              title={`Nothing answers at ${t.host}:${t.port} on the server yet: visitors get an error until your app runs`}
            >
              nothing listening
            </span>
          )}
        </div>
        <ToolButton label="Restart" icon={RotateCw} disabled={!on} onClick={() => void call({ op: 'restart', id: t.id })} />
        <ToolButton
          label="Remove"
          icon={Trash2}
          onClick={async () => {
            const ok = await host.ui.confirm({
              title: `Remove ${t.name || `the tunnel to port ${t.port}`}?`,
              message: t.stable ? 'Its address goes with it: a new tunnel gets a new one' : 'It stops, and its address stops working',
              confirm: 'Remove',
              destructive: true,
            });
            if (ok) void call({ op: 'remove', id: t.id });
          }}
        />
        <Switch
          className="ms-1 flex-none"
          checked={on}
          label={on ? 'Turn off' : 'Turn on'}
          hideLabel
          onCheckedChange={(v) => void call({ op: 'set', id: t.id, on: v })}
        />
      </div>
      {t.url && (
        <div className="flex min-w-0 items-center gap-1 pl-4">
          {web ? (
            <button
              type="button"
              className={cn('truncate text-left font-mono text-[var(--node-accent)] hover:underline', t.status !== 'live' && 'opacity-50')}
              title="Open in the browser"
              onClick={() => host.app.openExternal(t.url!)}
            >
              {shownAddress(t.url)}
            </button>
          ) : (
            <span
              className={cn('truncate font-mono select-text', t.status !== 'live' && 'opacity-50')}
              title={`Connect to this host and port (${t.type.toUpperCase()})`}
            >
              {shownAddress(t.url)}
            </span>
          )}
          <ToolButton label="Copy the address" icon={Copy} onClick={() => void host.app.clipboardWrite({ text: web ? t.url! : shownAddress(t.url!) })} />
          {web && <ToolButton label="Open in the browser" icon={ExternalLink} onClick={() => host.app.openExternal(t.url!)} />}
        </div>
      )}
      <div className="text-2xs pl-4 text-[var(--node-muted)]">
        {t.error ? (
          <span className={t.status === 'failed' ? 'text-[var(--ansi-1)]' : undefined}>{t.error}</span>
        ) : (
          <span>
            {t.note ?? SAID[t.status]}
            {t.status === 'live' && ` ${formatAgo(t.since)}`}
            {t.stable && ' · same address every time'}
          </span>
        )}
      </div>
    </div>
  );
}
