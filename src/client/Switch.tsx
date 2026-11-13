// The on/off switch on a tunnel's row.

import { cn } from '@hyperpane/ui';

export function Switch({ on, label, onChange }: { on: boolean; label: string; onChange(on: boolean): void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      title={label}
      onClick={() => onChange(!on)}
      className={cn(
        'relative h-4 w-7 flex-none rounded-full transition-colors duration-100',
        on ? 'bg-[var(--node-accent)]' : 'bg-[color-mix(in_srgb,var(--node-fg)_20%,transparent)]',
      )}
    >
      <span className={cn('absolute top-0.5 size-3 rounded-full bg-white transition-[left] duration-100', on ? 'left-3.5' : 'left-0.5')} />
    </button>
  );
}
