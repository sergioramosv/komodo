"use client";

import { useState } from 'react';
import { useKomodoSocket } from '@/hooks/useKomodoSocket';
import { useAgentStates } from '@/hooks/useAgentStates';
import { useOfficeFeedback } from '@/hooks/useOfficeFeedback';
import { ConnectionStatus } from '@/components/connection-status';
import dynamic from 'next/dynamic';
import { TaskDetailModal } from '@/components/task-detail-modal';
import type { Phase, AgentStatus, DashboardEvent, SonarAnalysisState } from '@/lib/types';

const OfficeScene3D = dynamic(() => import('@/components/office-scene-3d').then(mod => mod.OfficeScene3D), { ssr: false });

/* ── Config ── */

const AGENTS = ['PLANNER', 'ARCHITECT', 'CODER', 'TESTER', 'SECURITY', 'REVIEWER'] as const;

const PHASE_CFG: Record<Phase, { icon: string; label: string; color: string }> = {
  idle: { icon: '○', label: 'Idle', color: 'text-neutral-500' },
  planning: { icon: '✎', label: 'Plan', color: 'text-violet-400' },
  architecting: { icon: '◈', label: 'Arch', color: 'text-cyan-400' },
  coding: { icon: '⌨', label: 'Code', color: 'text-blue-400' },
  testing: { icon: '⚙', label: 'Test', color: 'text-teal-400' },
  security: { icon: '⛨', label: 'Sec', color: 'text-green-400' },
  analyzing: { icon: '◉', label: 'Sonar', color: 'text-cyan-400' },
  reviewing: { icon: '⊘', label: 'Review', color: 'text-amber-400' },
  merging: { icon: '⇢', label: 'Merge', color: 'text-green-400' },
};

const PHASES: Phase[] = ['planning', 'architecting', 'coding', 'testing', 'security', 'analyzing', 'reviewing', 'merging'];

const A_DOT: Record<AgentStatus, string> = { idle: 'bg-neutral-600', walking: 'bg-yellow-500', working: 'bg-blue-500 animate-pulse', done: 'bg-green-500' };
const A_BG: Record<string, string> = { PLANNER: 'border-violet-500/20', ARCHITECT: 'border-cyan-500/20', CODER: 'border-blue-500/20', TESTER: 'border-orange-500/20', SECURITY: 'border-green-500/20', REVIEWER: 'border-amber-500/20' };
const A_BAR: Record<string, string> = { PLANNER: 'bg-violet-500', ARCHITECT: 'bg-cyan-500', CODER: 'bg-blue-500', TESTER: 'bg-orange-500', SECURITY: 'bg-green-500', REVIEWER: 'bg-amber-500' };
const A_TXT: Record<string, string> = { PLANNER: 'text-violet-400', ARCHITECT: 'text-cyan-400', CODER: 'text-blue-400', TESTER: 'text-orange-400', SECURITY: 'text-green-400', REVIEWER: 'text-amber-400' };

const EVT_CLR: Record<string, string> = {
  'task:started': 'text-violet-400', 'task:completed': 'text-green-400', 'pr:created': 'text-cyan-400', 'pr:merged': 'text-green-400',
  'review:cycle:start': 'text-orange-400', 'review:cycle:end': 'text-orange-400', 'agent:rate-limit': 'text-yellow-400',
  'cli:recovered': 'text-green-400', 'budget:exceeded': 'text-red-400', 'security:scan:blocked': 'text-red-400',
  'tester:tests-generated': 'text-teal-400', 'security:scan:complete': 'text-green-400',
};

type Tab = 'overview' | '3d' | 'events' | 'cost';

/* ── Page ── */

export default function DashboardPage() {
  const { snapshot, connected, events, cliHealth, sendCommand } = useKomodoSocket();
  const agentStates = useAgentStates(snapshot, connected);
  const feedback = useOfficeFeedback(events, snapshot);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('overview');

  if (!snapshot) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-center space-y-3">
          <div className="mx-auto h-8 w-8 rounded-full border-2 border-neutral-700 border-t-neutral-400 animate-spin" />
          <p className="text-sm text-neutral-500">Connecting to orchestrator...</p>
        </div>
      </div>
    );
  }

  const totalTurns = AGENTS.reduce((s, n) => s + (snapshot.agents[n]?.totalTurns ?? 0), 0);
  const execState = snapshot.executionState ?? 'stopped';

  return (
    <div className="flex flex-col h-full">

      {/* ═══ STATUS BAR ═══ */}
      <div className="flex items-center gap-2 px-4 py-2 border-b border-neutral-800/40 bg-neutral-950/50 shrink-0 flex-wrap">

        {/* Execution state pill */}
        <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-medium ${
          execState === 'running' ? 'bg-emerald-500/10 text-emerald-400' :
          execState === 'paused' ? 'bg-yellow-500/10 text-yellow-400' :
          'bg-neutral-800 text-neutral-500'
        }`}>
          <span className={`h-1.5 w-1.5 rounded-full ${
            execState === 'running' ? 'bg-emerald-500 animate-pulse' :
            execState === 'paused' ? 'bg-yellow-500' : 'bg-neutral-600'
          }`} />
          {execState === 'running' ? 'Running' : execState === 'paused' ? 'Paused' : 'Stopped'}
        </span>

        {/* Phase steps */}
        <div className="flex items-center gap-px ml-2">
          {PHASES.map((p, i) => {
            const cfg = PHASE_CFG[p];
            const active = snapshot.phase === p;
            const past = PHASES.indexOf(snapshot.phase as Phase) > i;
            return (
              <span key={p} className={`px-1.5 py-0.5 text-[10px] font-medium rounded ${
                active ? `${cfg.color} bg-neutral-800` : past ? 'text-emerald-600' : 'text-neutral-700'
              }`} title={cfg.label}>
                {past ? '✓' : cfg.icon}
              </span>
            );
          })}
        </div>

        <div className="flex-1" />

        {/* Stats */}
        <span className="text-[11px] tabular-nums text-neutral-500">{snapshot.tasksCompleted}/{snapshot.totalTasks || '?'} tasks</span>
        <span className="text-[11px] tabular-nums text-neutral-400 font-medium">${snapshot.totalCost.toFixed(2)}</span>
        {snapshot.currentPR && (
          <span className="text-[11px] text-neutral-600">PR {typeof snapshot.currentPR === 'object' ? `#${snapshot.currentPR.number}` : snapshot.currentPR}</span>
        )}

        {/* Controls */}
        {execState === 'running' && (
          <button onClick={() => sendCommand('pause')} disabled={!connected} className="rounded px-2 py-0.5 text-[11px] font-medium text-yellow-400 bg-yellow-500/10 hover:bg-yellow-500/20 disabled:opacity-40">Pause</button>
        )}
        {(execState === 'running' || execState === 'paused') && (
          <button onClick={() => sendCommand('stop')} disabled={!connected} className="rounded px-2 py-0.5 text-[11px] font-medium text-red-400 bg-red-500/10 hover:bg-red-500/20 disabled:opacity-40">Stop</button>
        )}

        <ConnectionStatus connected={connected} />
      </div>

      {/* ═══ TASK BANNER ═══ */}
      {snapshot.currentTask && (
        <div className="flex items-center gap-3 px-4 py-1.5 border-b border-neutral-800/30 bg-neutral-900/30 shrink-0">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-500 animate-pulse shrink-0" />
          <span className="text-xs font-medium text-neutral-200 truncate flex-1">{snapshot.taskDetails?.title ?? snapshot.currentTask}</span>
          {snapshot.taskDetails?.businessPoints != null && <span className="text-[10px] text-amber-500">{snapshot.taskDetails.businessPoints}BP</span>}
          {snapshot.taskDetails?.devPoints != null && <span className="text-[10px] text-blue-500">{snapshot.taskDetails.devPoints}DP</span>}
          {snapshot.taskDetails && (
            <button onClick={() => setTaskModalOpen(true)} className="text-[10px] text-neutral-500 hover:text-neutral-300 underline">details</button>
          )}
        </div>
      )}

      {/* ═══ TABS ═══ */}
      <div className="flex items-center border-b border-neutral-800/40 px-4 shrink-0">
        {([
          { id: 'overview' as const, label: 'Overview' },
          { id: '3d' as const, label: '3D Office' },
          { id: 'events' as const, label: 'Events' },
          { id: 'cost' as const, label: 'Cost' },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`relative px-3 py-2 text-xs font-medium transition-colors ${
              tab === t.id ? 'text-white' : 'text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {t.label}
            {tab === t.id && <span className="absolute inset-x-1 -bottom-px h-px bg-white rounded-full" />}
          </button>
        ))}
      </div>

      {/* ═══ CONTENT ═══ */}
      <div className="flex-1 overflow-y-auto">

        {/* ── OVERVIEW ── */}
        {tab === 'overview' && (
          <div className="p-4 space-y-4">
            {/* Agent grid */}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
              {AGENTS.map((name) => {
                const a = snapshot.agents[name] ?? { name, status: 'idle' as const, currentTask: null, startedAt: null, totalCost: 0, totalTurns: 0 };
                return (
                  <div key={name} className={`rounded-lg border bg-neutral-900/50 p-3 transition-colors ${
                    a.status === 'working' ? A_BG[name] : 'border-neutral-800/50'
                  }`}>
                    <div className="flex items-center gap-2 mb-1.5">
                      <span className={`h-2 w-2 rounded-full shrink-0 ${A_DOT[a.status] ?? 'bg-neutral-600'}`} />
                      <span className={`text-xs font-semibold ${A_TXT[name]}`}>{name}</span>
                    </div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-[10px] text-neutral-500 capitalize">{a.status}</span>
                      {(a.totalCost ?? 0) > 0 && (
                        <span className="text-[10px] tabular-nums text-neutral-600">${(a.totalCost ?? 0).toFixed(2)}</span>
                      )}
                    </div>
                    {a.currentTask && (
                      <p className="mt-1 truncate text-[10px] text-neutral-400">{a.currentTask}</p>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Two-column: Cost bar + Events */}
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">

              {/* Left: cost summary */}
              <div className="rounded-lg border border-neutral-800/50 bg-neutral-900/50 p-4">
                <div className="flex items-baseline gap-4 mb-3">
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-neutral-500 mb-0.5">Total Cost</p>
                    <p className="text-xl font-bold tabular-nums">${snapshot.totalCost.toFixed(2)}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-neutral-500 mb-0.5">Turns</p>
                    <p className="text-xl font-bold tabular-nums">{totalTurns}</p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-neutral-500 mb-0.5">Tasks</p>
                    <p className="text-xl font-bold tabular-nums">{snapshot.tasksCompleted}</p>
                  </div>
                </div>

                {/* Stacked bar */}
                {snapshot.totalCost > 0 && (
                  <div className="flex h-2 w-full rounded-full overflow-hidden bg-neutral-800 mb-3">
                    {AGENTS.map((n) => {
                      const c = snapshot.agents[n]?.totalCost ?? 0;
                      const pct = (c / snapshot.totalCost) * 100;
                      if (pct < 1) return null;
                      return <div key={n} className={`${A_BAR[n]} first:rounded-l-full last:rounded-r-full`} style={{ width: `${pct}%` }} title={`${n}: $${c.toFixed(2)}`} />;
                    })}
                  </div>
                )}

                {/* Legend */}
                <div className="flex flex-wrap gap-x-4 gap-y-1">
                  {AGENTS.map((n) => {
                    const c = snapshot.agents[n]?.totalCost ?? 0;
                    if (c === 0) return null;
                    return (
                      <div key={n} className="flex items-center gap-1.5 text-[10px]">
                        <span className={`h-1.5 w-1.5 rounded-full ${A_BAR[n]}`} />
                        <span className="text-neutral-400">{n}</span>
                        <span className="tabular-nums text-neutral-500">${c.toFixed(2)}</span>
                      </div>
                    );
                  })}
                </div>

                {/* Budget bars */}
                {snapshot.budget && (snapshot.budget.dailyBudget > 0 || snapshot.budget.weeklyBudget > 0) && (
                  <div className="mt-4 pt-3 border-t border-neutral-800/50 space-y-2">
                    {snapshot.budget.dailyBudget > 0 && (
                      <BudgetBar label="Daily" spent={snapshot.budget.dailySpent} budget={snapshot.budget.dailyBudget} />
                    )}
                    {snapshot.budget.weeklyBudget > 0 && (
                      <BudgetBar label="Weekly" spent={snapshot.budget.weeklySpent} budget={snapshot.budget.weeklyBudget} />
                    )}
                  </div>
                )}
              </div>

              {/* Right: events */}
              <div className="rounded-lg border border-neutral-800/50 bg-neutral-900/50 p-4">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-[10px] uppercase tracking-wider text-neutral-500">Recent Events</p>
                  <button onClick={() => setTab('events')} className="text-[10px] text-neutral-600 hover:text-neutral-400">View all</button>
                </div>
                <div className="space-y-px max-h-52 overflow-y-auto">
                  {events.length === 0 ? (
                    <p className="text-xs text-neutral-700 py-4 text-center">No events yet</p>
                  ) : events.slice(0, 12).map((e) => <EvtRow key={e.id} e={e} />)}
                </div>
              </div>
            </div>

            {/* SonarQube inline */}
            {snapshot.sonarAnalysis && snapshot.sonarAnalysis.status !== 'idle' && (
              <SonarBadge sonar={snapshot.sonarAnalysis} />
            )}
          </div>
        )}

        {/* ── 3D ── */}
        {tab === '3d' && (
          <div className="h-full">
            <OfficeScene3D agents={agentStates.agents} phase={snapshot.phase} cliHealth={cliHealth} />
          </div>
        )}

        {/* ── EVENTS ── */}
        {tab === 'events' && (
          <div className="p-4">
            <div className="rounded-lg border border-neutral-800/50 bg-neutral-900/50 p-4">
              <p className="text-[10px] uppercase tracking-wider text-neutral-500 mb-3">Event Timeline ({events.length})</p>
              {events.length === 0 ? (
                <p className="text-xs text-neutral-700 py-8 text-center">No events recorded</p>
              ) : (
                <div className="space-y-px">
                  {events.map((e) => <EvtRow key={e.id} e={e} />)}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── COST ── */}
        {tab === 'cost' && (
          <div className="p-4 space-y-4">
            {/* Summary cards */}
            <div className="grid grid-cols-3 gap-3">
              <MetricCard label="Total Cost" value={`$${snapshot.totalCost.toFixed(2)}`} />
              <MetricCard label="Total Turns" value={String(totalTurns)} />
              <MetricCard label="Tasks Done" value={`${snapshot.tasksCompleted}/${snapshot.totalTasks || '?'}`} />
            </div>

            {/* Agent table */}
            <div className="rounded-lg border border-neutral-800/50 bg-neutral-900/50 overflow-hidden">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-neutral-800/50 text-[10px] uppercase tracking-wider text-neutral-500">
                    <th className="px-4 py-2.5 text-left font-medium">Agent</th>
                    <th className="px-4 py-2.5 text-left font-medium">Status</th>
                    <th className="px-4 py-2.5 text-right font-medium">Cost</th>
                    <th className="px-4 py-2.5 text-right font-medium">%</th>
                    <th className="px-4 py-2.5 text-right font-medium">Turns</th>
                    <th className="px-4 py-2.5 text-left font-medium">Distribution</th>
                  </tr>
                </thead>
                <tbody>
                  {AGENTS.map((name) => {
                    const a = snapshot.agents[name];
                    const cost = a?.totalCost ?? 0;
                    const turns = a?.totalTurns ?? 0;
                    const pct = snapshot.totalCost > 0 ? (cost / snapshot.totalCost) * 100 : 0;
                    return (
                      <tr key={name} className="border-b border-neutral-800/30 hover:bg-neutral-800/20">
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className={`h-2 w-2 rounded-full ${A_BAR[name]}`} />
                            <span className={`font-medium ${A_TXT[name]}`}>{name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-2.5">
                          <span className={`inline-flex items-center gap-1 capitalize text-neutral-400`}>
                            <span className={`h-1.5 w-1.5 rounded-full ${A_DOT[a?.status ?? 'idle']}`} />
                            {a?.status ?? 'idle'}
                          </span>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-neutral-300">${cost.toFixed(2)}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-neutral-500">{pct.toFixed(0)}%</td>
                        <td className="px-4 py-2.5 text-right tabular-nums text-neutral-500">{turns}</td>
                        <td className="px-4 py-2.5 w-32">
                          <div className="h-1.5 w-full rounded-full bg-neutral-800">
                            <div className={`h-1.5 rounded-full ${A_BAR[name]} transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Budget */}
            {snapshot.budget && (snapshot.budget.dailyBudget > 0 || snapshot.budget.weeklyBudget > 0) && (
              <div className="rounded-lg border border-neutral-800/50 bg-neutral-900/50 p-4">
                <p className="text-[10px] uppercase tracking-wider text-neutral-500 mb-3">Budget</p>
                <div className="space-y-3">
                  {snapshot.budget.dailyBudget > 0 && <BudgetBar label="Daily" spent={snapshot.budget.dailySpent} budget={snapshot.budget.dailyBudget} />}
                  {snapshot.budget.weeklyBudget > 0 && <BudgetBar label="Weekly" spent={snapshot.budget.weeklySpent} budget={snapshot.budget.weeklyBudget} />}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Task modal */}
      {snapshot?.taskDetails && (
        <TaskDetailModal isOpen={taskModalOpen} onClose={() => setTaskModalOpen(false)} task={snapshot.taskDetails} currentPR={snapshot.currentPR} />
      )}
    </div>
  );
}

/* ── Sub-components ── */

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-neutral-800/50 bg-neutral-900/50 p-4">
      <p className="text-[10px] uppercase tracking-wider text-neutral-500 mb-1">{label}</p>
      <p className="text-2xl font-bold tabular-nums">{value}</p>
    </div>
  );
}

function BudgetBar({ label, spent, budget }: { label: string; spent: number; budget: number }) {
  const pct = budget > 0 ? Math.min((spent / budget) * 100, 100) : 0;
  const color = pct >= 100 ? 'bg-red-500' : pct >= 80 ? 'bg-amber-400' : 'bg-emerald-500';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-[10px]">
        <span className="text-neutral-500">{label}</span>
        <span className={`tabular-nums ${pct >= 80 ? (pct >= 100 ? 'text-red-400' : 'text-amber-400') : 'text-neutral-400'}`}>
          ${spent.toFixed(2)} / ${budget.toFixed(2)}
        </span>
      </div>
      <div className="h-1 w-full rounded-full bg-neutral-800">
        <div className={`h-1 rounded-full transition-all ${color}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function SonarBadge({ sonar }: { sonar: SonarAnalysisState }) {
  const cfg = sonar.status === 'running' ? { t: 'Analyzing...', c: 'text-cyan-400 bg-cyan-500/10' }
    : sonar.status === 'done' ? { t: `Quality Gate: ${sonar.qualityGate ?? 'N/A'}`, c: sonar.qualityGate === 'OK' ? 'text-green-400 bg-green-500/10' : 'text-amber-400 bg-amber-500/10' }
    : sonar.status === 'error' ? { t: 'Analysis Failed', c: 'text-red-400 bg-red-500/10' }
    : null;
  if (!cfg) return null;
  return (
    <div className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-xs font-medium ${cfg.c}`}>
      <span>◉</span> SonarQube: {cfg.t}
      {sonar.status === 'running' && <span className="animate-pulse">●</span>}
    </div>
  );
}

function EvtRow({ e }: { e: DashboardEvent }) {
  const t = e.timestamp ? new Date(e.timestamp).toLocaleTimeString() : '--:--';
  const c = EVT_CLR[e.type] ?? 'text-neutral-500';
  return (
    <div className="flex items-start gap-2 rounded px-2 py-1 text-[11px] hover:bg-neutral-800/30">
      <span className="shrink-0 tabular-nums text-neutral-700 w-14">{t}</span>
      {e.agentName && <span className={`shrink-0 font-medium ${c}`}>{e.agentName}</span>}
      <span className="text-neutral-400 truncate">{e.message}</span>
    </div>
  );
}
