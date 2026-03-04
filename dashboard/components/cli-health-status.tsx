'use client';

import type { CliHealth, CliName } from '@/lib/types';

interface CliHealthStatusProps {
  cliHealth: Record<CliName, CliHealth>;
}

const STATUS_CONFIG: Record<string, { dot: string; ring: string; label: string; labelColor: string }> = {
  available: { dot: 'bg-green-500', ring: 'ring-2 ring-green-500/30', label: 'Available', labelColor: 'bg-green-500/20 text-green-400' },
  'rate-limited': { dot: 'bg-yellow-500', ring: 'ring-2 ring-yellow-500/30 animate-pulse', label: 'Rate Limited', labelColor: 'bg-yellow-500/20 text-yellow-400' },
  down: { dot: 'bg-red-500', ring: 'ring-2 ring-red-500/30', label: 'Down', labelColor: 'bg-red-500/20 text-red-400' },
};

const CLI_LABELS: Record<CliName, string> = {
  claude: 'Claude',
  codex: 'Codex',
  gemini: 'Gemini',
};

function getRemainingMinutes(rateLimitedAt: string | null, cooldownMinutes: number | null): number | null {
  if (!rateLimitedAt || cooldownMinutes == null) return null;
  const elapsed = (Date.now() - new Date(rateLimitedAt).getTime()) / 60000;
  const remaining = Math.ceil(cooldownMinutes - elapsed);
  return remaining > 0 ? remaining : 0;
}

function formatTimestamp(ts: string | null): string {
  if (!ts) return 'Never';
  return new Date(ts).toLocaleTimeString();
}

export function CliHealthStatus({ cliHealth }: CliHealthStatusProps) {
  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="mb-4 text-sm font-medium text-neutral-400">CLI Health</h2>
      <div className="space-y-3">
        {(Object.keys(cliHealth) as CliName[]).map((cli) => {
          const health = cliHealth[cli];
          const cfg = STATUS_CONFIG[health.status] ?? STATUS_CONFIG.down;
          const remaining = getRemainingMinutes(health.rateLimitedAt, health.cooldownMinutes);
          const lastBeat = health.lastHeartbeat ?? health.rateLimitedAt;

          return (
            <div
              key={cli}
              className="flex items-center gap-3 rounded-md border border-neutral-800 bg-neutral-950/50 px-3 py-2.5"
            >
              <span className={`inline-block h-3 w-3 shrink-0 rounded-full ${cfg.dot} ${cfg.ring}`} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{CLI_LABELS[cli]}</span>
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${cfg.labelColor}`}>
                    {cfg.label}
                  </span>
                </div>
                <div className="mt-0.5 flex items-center gap-3 text-xs text-neutral-500">
                  {health.status === 'rate-limited' && remaining != null && (
                    <span className="text-yellow-400">~{remaining}min remaining</span>
                  )}
                  <span>Last heartbeat: {formatTimestamp(lastBeat)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
