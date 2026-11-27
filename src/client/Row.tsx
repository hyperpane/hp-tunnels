// One tunnel in the list: its status, name, local port and service; whether
// something answers on the port; restart, remove and on/off; its public
// address with copy and open; and what it's doing or why it stopped.

import { Copy, ExternalLink, RotateCw, Trash2 } from '@hyperpane/icons';
import { formatAgo, useHost } from '@hyperpane/sdk/client';
import { Chip, Dot, Switch, ToolButton, cn } from '@hyperpane/ui';
import { type Tunnel, shownAddress } from '../shared/index.ts';

/** Each status's colour: the dot and its words. */
const COLOR: Record<Tunnel['status'], string> = {
  live: 'var(--green-soft-foreground)',
  connecting: 'var(--amber-soft-foreground)',
  retrying: 'var(--amber-soft-foreground)',
  failed: 'var(--destructive-soft-foreground)',
  off: 'color-mix(in srgb, var(--node-muted) 60%, transparent)',
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
  const busy = t.status === 'connecting' || t.status === 'retrying';
  return (
    <div
      data-tunnel={t.id}
      className="group/row rounded-control flex flex-none items-start gap-3 px-2 py-2 transition-colors duration-100 hover:bg-[var(--node-hover)]"
    >
      <span className="flex h-5 w-2 flex-none items-center justify-center" title={SAID[t.status]}>
        <Dot color={COLOR[t.status]} pulse={busy} className="size-2" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        {/* What it is; a narrow window wraps it rather than squeeze its tools. */}
        <div className="flex min-h-5 min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span className="min-w-0 truncate font-medium">{t.name || `Port ${t.port}`}</span>
          <span className="flex-none font-mono text-xs text-[var(--node-muted)] tabular-nums">{target}</span>
          <Chip className="flex-none" title={`Through ${service}`}>
            {t.type.toUpperCase()} · {service}
          </Chip>
          {t.listening === false && on && (
            <Chip color="amber" className="flex-none" title={`Nothing answers at ${t.host}:${t.port} on the server yet: visitors get an error until your app runs`}>
              Nothing listening
            </Chip>
          )}
        </div>
        {t.url && (
          <div className="flex min-h-5 min-w-0 items-center gap-1">
            {web ? (
              <button
                type="button"
                className={cn('min-w-0 truncate text-left font-mono text-xs text-[var(--node-accent)] hover:underline', t.status !== 'live' && 'opacity-50')}
                title="Open in the browser"
                onClick={() => host.app.openExternal(t.url!)}
              >
                {shownAddress(t.url)}
              </button>
            ) : (
              <span
                className={cn('min-w-0 truncate font-mono text-xs select-text', t.status !== 'live' && 'opacity-50')}
                title={`Connect to this host and port (${t.type.toUpperCase()})`}
              >
                {shownAddress(t.url)}
              </span>
            )}
          </div>
        )}
        <div className="min-w-0 text-xs text-[var(--node-muted)]">
          {t.error ? (
            <span className={t.status === 'failed' ? 'text-[var(--destructive-soft-foreground)]' : undefined}>{t.error}</span>
          ) : (
            <span>
              <span style={{ color: t.status === 'off' ? undefined : COLOR[t.status] }}>{t.note ?? SAID[t.status]}</span>
              {t.status === 'live' && ` ${formatAgo(t.since)}`}
              {t.stable && ' · same address every time'}
            </span>
          )}
        </div>
      </div>
      <div className="flex h-5 flex-none items-center gap-0.5">
        {/* The tools show on hover (always, with a finger); on/off always. */}
        <span className="flex items-center gap-0.5 opacity-0 transition-opacity duration-100 group-hover/row:opacity-100 has-[:focus-visible]:opacity-100 touch:opacity-100">
          {t.url && (
            <ToolButton label="Copy the address" icon={Copy} onClick={() => void host.app.clipboardWrite({ text: web ? t.url! : shownAddress(t.url!) })} />
          )}
          {t.url && web && <ToolButton label="Open in the browser" icon={ExternalLink} onClick={() => host.app.openExternal(t.url!)} />}
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
        </span>
        <Switch
          className="ms-1.5 flex-none"
          checked={on}
          label={on ? 'Turn off' : 'Turn on'}
          hideLabel
          onCheckedChange={(v) => void call({ op: 'set', id: t.id, on: v })}
        />
      </div>
    </div>
  );
}
