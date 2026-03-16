"use client";

import { useState } from 'react';
import { useKomodoSocket } from '@/hooks/useKomodoSocket';
import { useAgentStates } from '@/hooks/useAgentStates';
import { useOfficeFeedback } from '@/hooks/useOfficeFeedback';
import { ConnectionStatus } from '@/components/connection-status';
import dynamic from 'next/dynamic';
import { ExecutionControls } from '@/components/execution-controls';
import { BudgetWidget } from '@/components/budget-widget';
import { ProjectSelector } from '@/components/project-selector';
import { MultiProjectOverview } from '@/components/multi-project-overview';
import { TaskDetailModal } from '@/components/task-detail-modal';
import { Settings } from 'lucide-react';
import type { Phase, AgentStatus, DashboardEvent, SonarAnalysisState } from '@/lib/types';

const OfficeScene3D = dynamic(() => import('@/components/office-scene-3d').then(mod => mod.OfficeScene3D), { ssr: false });

/* ── Constants ── */

const ALL_AGENTS = ['PLANNER', 'ARCHITECT', 'CODER', 'TESTER', 'SECURITY', 'REVIEWER'] as const;

const PHASE_CONFIG: Record<Phase, { icon: string; label: string; color: string }> = {
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

const PHASE_ORDER: Phase[] = ['planning', 'architecting', 'coding', 'testing', 'security', 'analyzing', 'reviewing', 'merging'];

const STATUS_DOT: Record<AgentStatus, string> = {
  idle: 'bg-neutral-600',
  walking: 'bg-yellow-500',
  working: 'bg-blue-500 animate-pulse',
  done: 'bg-green-500',
};

const AGENT_COLORS: Record<string, string> = {
  PLANNER: 'bg-violet-500',
  ARCHITECT: 'bg-cyan-500',
  CODER: 'bg-blue-500',
  TESTER: 'bg-orange-500',
  SECURITY: 'bg-green-500',
  REVIEWER: 'bg-amber-500',
};

const AGENT_TEXT: Record<string, string> = {
  PLANNER: 'text-violet-400',
  ARCHITECT: 'text-cyan-400',
  CODER: 'text-blue-400',
  TESTER: 'text-orange-400',
  SECURITY: 'text-green-400',
  REVIEWER: 'text-amber-400',
};

const EVENT_COLORS: Record<string, string> = {
  'agent:state-change': 'text-blue-400',
  'task:started': 'text-violet-400',
  'task:completed': 'text-green-400',
  'pr:created': 'text-cyan-400',
  'pr:merged': 'text-green-400',
  'cost:updated': 'text-amber-400',
  'review:cycle:start': 'text-orange-400',
  'review:cycle:end': 'text-orange-400',
  'execution:state-change': 'text-emerald-400',
  'browser:check': 'text-pink-400',
  'sonar:analysis:start': 'text-cyan-400',
  'sonar:analysis:complete': 'text-cyan-400',
  'sonar:analysis:error': 'text-red-400',
  'agent:rate-limit': 'text-yellow-400',
  'cli:recovered': 'text-green-400',
  'session:auto-resumed': 'text-emerald-400',
  'budget:warning': 'text-amber-400',
  'budget:exceeded': 'text-red-400',
  'budget:reset': 'text-emerald-400',
  'multi-project:run-started': 'text-violet-400',
  'multi-project:project-selected': 'text-violet-400',
  'multi-project:project-switch': 'text-violet-400',
  'multi-project:run-completed': 'text-green-400',
  'multi-project:all-backlogs-empty': 'text-neutral-400',
  'tester:tests-generated': 'text-teal-400',
  'agent:tester:working': 'text-teal-400',
  'agent:tester:done': 'text-teal-400',
  'agent:tester:idle': 'text-teal-400',
  'security:scan:start': 'text-green-400',
  'security:scan:complete': 'text-green-400',
  'security:scan:blocked': 'text-red-400',
};

type HomeTab = 'overview' | '3d' | 'events' | 'cost';

/* ── Page ── */

export default function DashboardPage() {
  const { snapshot, connected, events, cliHealth, sendCommand } = useKomodoSocket();
  const agentStates = useAgentStates(snapshot, connected);
  const feedback = useOfficeFeedback(events, snapshot);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<HomeTab>('overview');

  if (!snapshot) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <ConnectionStatus connected={connected} />
          <p className="mt-3 text-neutral-500">Waiting for orchestrator connection...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* ═══ TOP BAR: Phase + Task + Controls ═══ */}
      <div className="flex items-center gap-3 flex-wrap">
        {/* Phase pipeline — compact */}
        <div className="flex items-center gap-0.5">
          {PHASE_ORDER.map((phase, i) => {
            const cfg = PHASE_CONFIG[phase];
            const isActive = snapshot.phase === phase;
            const isPast = PHASE_ORDER.indexOf(snapshot.phase as Phase) > i;
            return (
              <div key={phase} className="flex items-center">
                {i > 0 && <div className={`mx-0.5 h-px w-2 ${isPast ? 'bg-green-500' : 'bg-neutral-700'}`} />}
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  isActive ? `${cfg.color} bg-neutral-800 ring-1 ring-neutral-700`
                  : isPast ? 'text-green-500 bg-green-500/10'
                  : 'text-neutral-600'
                }`}>
                  {isPast ? '✓' : cfg.icon} {cfg.label}
                </span>
              </div>
            );
          })}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Task + stats compact */}
        <div className="flex items-center gap-3 text-sm">
          <span className="tabular-nums text-neutral-400">
            {snapshot.tasksCompleted}/{snapshot.totalTasks || '?'} tasks
          </span>
          <span className="tabular-nums font-medium">${snapshot.totalCost.toFixed(2)}</span>
          {snapshot.currentPR && (
            <span className="text-xs text-neutral-500">
              PR {typeof snapshot.currentPR === 'object' ? `#${snapshot.currentPR.number}` : snapshot.currentPR}
            </span>
          )}
        </div>

        {/* Controls */}
        <ExecutionControls
          executionState={snapshot.executionState ?? 'stopped'}
          phase={snapshot.phase}
          connected={connected}
          onPause={() => sendCommand('pause')}
          onStop={() => sendCommand('stop')}
        />
        <ConnectionStatus connected={connected} />
      </div>

      {/* ═══ CURRENT TASK (if any) ═══ */}
      {snapshot.currentTask && (
        <div className="flex items-center gap-3 rounded-lg border border-neutral-800 bg-neutral-900 px-4 py-2.5">
          <span className="text-sm font-semibold flex-1 truncate">
            {snapshot.taskDetails?.title ?? snapshot.currentTask}
          </span>
          {snapshot.taskDetails?.businessPoints != null && (
            <span className="rounded bg-amber-500/10 px-2 py-0.5 text-xs font-medium text-amber-400">
              {snapshot.taskDetails.businessPoints} BP
            </span>
          )}
          {snapshot.taskDetails?.devPoints != null && (
            <span className="rounded bg-blue-500/10 px-2 py-0.5 text-xs font-medium text-blue-400">
              {snapshot.taskDetails.devPoints} DP
            </span>
          )}
          {snapshot.taskDetails && (
            <button
              onClick={() => setTaskModalOpen(true)}
              className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800 hover:text-white"
            >
              Details
            </button>
          )}
        </div>
      )}

      {/* ═══ TABS ═══ */}
      <div className="flex items-center gap-1 border-b border-neutral-800">
        {([
          { id: 'overview' as const, label: 'Overview' },
          { id: '3d' as const, label: '3D Office' },
          { id: 'events' as const, label: `Events (${events.length})` },
          { id: 'cost' as const, label: 'Cost' },
        ]).map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`relative px-4 py-2 text-sm font-medium transition-colors ${
              activeTab === tab.id
                ? 'text-white'
                : 'text-neutral-500 hover:text-neutral-300'
            }`}
          >
            {tab.label}
            {activeTab === tab.id && (
              <span className="absolute bottom-0 left-1 right-1 h-0.5 rounded-full bg-white" />
            )}
          </button>
        ))}
      </div>

      {/* ═══ TAB CONTENT ═══ */}

      {activeTab === 'overview' && (
        <div className="space-y-4">
          {/* Agent Cards — 6 in a row */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {ALL_AGENTS.map((name) => {
              const agent = snapshot.agents[name] ?? { name, status: 'idle' as const, currentTask: null, startedAt: null, totalCost: 0, totalTurns: 0 };
              return (
                <div key={name} className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
                  <div className="flex items-center gap-2">
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${STATUS_DOT[agent.status] ?? 'bg-neutral-600'}`} />
                    <span className={`text-sm font-bold ${AGENT_TEXT[name] ?? 'text-neutral-300'}`}>{name}</span>
                  </div>
                  <div className="mt-1.5 flex items-center justify-between text-xs text-neutral-500">
                    <span className="capitalize">{agent.status}</span>
                    {(agent.totalCost ?? 0) > 0 && <span className="tabular-nums">${(agent.totalCost ?? 0).toFixed(2)}</span>}
                  </div>
                  {agent.currentTask && (
                    <p className="mt-1 truncate text-xs text-neutral-400">{agent.currentTask}</p>
                  )}
                </div>
              );
            })}
          </div>

          {/* Bottom row: Budget + SonarQube + Multi-project */}
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            {/* Budget */}
            {snapshot.budget && (
              <BudgetWidget budget={snapshot.budget} totalCost={snapshot.totalCost} />
            )}

            {/* SonarQube */}
            {snapshot.sonarAnalysis && snapshot.sonarAnalysis.status !== 'idle' && (
              <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
                <SonarStatus sonar={snapshot.sonarAnalysis} />
              </div>
            )}

            {/* Multi-project */}
            {snapshot.multiProject?.enabled && (
              <div className="space-y-3">
                <ProjectSelector
                  multiProject={snapshot.multiProject}
                  selectedProject={selectedProject}
                  onSelectProject={setSelectedProject}
                />
                <MultiProjectOverview
                  multiProject={snapshot.multiProject}
                  selectedProject={selectedProject}
                  budget={snapshot.budget}
                  totalCost={snapshot.totalCost}
                />
              </div>
            )}
          </div>

          {/* Recent events — last 5 compact */}
          {events.length > 0 && (
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-3">
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-medium text-neutral-400">Recent Events</h3>
                <button
                  onClick={() => setActiveTab('events')}
                  className="text-xs text-neutral-500 hover:text-neutral-300"
                >
                  View all
                </button>
              </div>
              <div className="space-y-0.5">
                {events.slice(0, 5).map((evt) => (
                  <EventRow key={evt.id} event={evt} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === '3d' && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 overflow-hidden" style={{ height: 'calc(100vh - 12rem)' }}>
          <OfficeScene3D agents={agentStates.agents} phase={snapshot.phase} cliHealth={cliHealth} />
        </div>
      )}

      {activeTab === 'events' && (
        <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
          <h2 className="mb-3 text-sm font-medium text-neutral-400">Event Timeline</h2>
          {events.length === 0 ? (
            <p className="text-sm text-neutral-600">No events yet</p>
          ) : (
            <div className="space-y-0.5 max-h-[calc(100vh-14rem)] overflow-y-auto">
              {events.map((evt) => (
                <EventRow key={evt.id} event={evt} />
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'cost' && (
        <div className="space-y-4">
          {/* Budget widget */}
          {snapshot.budget && (
            <BudgetWidget budget={snapshot.budget} totalCost={snapshot.totalCost} />
          )}

          {/* Agent cost breakdown */}
          <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
            <h2 className="mb-3 text-sm font-medium text-neutral-400">Agent Cost & Turns</h2>
            <div className="flex gap-6 mb-4">
              <div>
                <p className="text-xs text-neutral-500">Total Cost</p>
                <p className="text-2xl font-bold tabular-nums">${snapshot.totalCost.toFixed(2)}</p>
              </div>
              <div>
                <p className="text-xs text-neutral-500">Total Turns</p>
                <p className="text-2xl font-bold tabular-nums">
                  {ALL_AGENTS.reduce((s, n) => s + ((snapshot.agents[n]?.totalTurns ?? 0)), 0)}
                </p>
              </div>
              <div>
                <p className="text-xs text-neutral-500">Tasks Done</p>
                <p className="text-2xl font-bold tabular-nums">{snapshot.tasksCompleted}</p>
              </div>
            </div>

            {/* Color bar */}
            {snapshot.totalCost > 0 && (
              <div className="flex h-3 w-full rounded-full overflow-hidden bg-neutral-800 mb-4">
                {ALL_AGENTS.map((name) => {
                  const cost = snapshot.agents[name]?.totalCost ?? 0;
                  const pct = (cost / snapshot.totalCost) * 100;
                  if (pct < 0.5) return null;
                  return <div key={name} className={`${AGENT_COLORS[name]} transition-all`} style={{ width: `${pct}%` }} title={`${name}: $${cost.toFixed(2)}`} />;
                })}
              </div>
            )}

            {/* Per-agent table */}
            <div className="space-y-2">
              {ALL_AGENTS.map((name) => {
                const agent = snapshot.agents[name];
                const cost = agent?.totalCost ?? 0;
                const turns = agent?.totalTurns ?? 0;
                const tasks = agent?.completedTasks ?? 0;
                const pct = snapshot.totalCost > 0 ? ((cost / snapshot.totalCost) * 100).toFixed(0) : '0';

                return (
                  <div key={name} className="flex items-center gap-3 text-sm">
                    <span className={`inline-block h-2.5 w-2.5 rounded-full ${AGENT_COLORS[name]}`} />
                    <span className={`w-24 font-medium ${AGENT_TEXT[name]}`}>{name}</span>
                    <span className="tabular-nums text-neutral-300">${cost.toFixed(2)}</span>
                    <span className="text-neutral-600 text-xs">({pct}%)</span>
                    <span className="ml-auto tabular-nums text-neutral-500 text-xs">{turns} turns</span>
                    {tasks > 0 && <span className="tabular-nums text-neutral-600 text-xs">{tasks} tasks</span>}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Task Detail Modal */}
      {snapshot?.taskDetails && (
        <TaskDetailModal
          isOpen={taskModalOpen}
          onClose={() => setTaskModalOpen(false)}
          task={snapshot.taskDetails}
          currentPR={snapshot.currentPR}
        />
      )}
    </div>
  );
}

/* ── SonarQube Status Component ── */

function SonarStatus({ sonar }: { sonar: SonarAnalysisState }) {
  const statusConfig: Record<string, { label: string; color: string; bg: string }> = {
    running: { label: 'Analyzing...', color: 'text-cyan-400', bg: 'bg-cyan-500/10' },
    done: { label: `Quality Gate: ${sonar.qualityGate ?? 'N/A'}`, color: sonar.qualityGate === 'OK' ? 'text-green-400' : 'text-amber-400', bg: sonar.qualityGate === 'OK' ? 'bg-green-500/10' : 'bg-amber-500/10' },
    error: { label: 'Analysis Failed', color: 'text-red-400', bg: 'bg-red-500/10' },
    skipped: { label: 'Skipped', color: 'text-neutral-400', bg: 'bg-neutral-800' },
  };

  const cfg = statusConfig[sonar.status];
  if (!cfg) return null;

  return (
    <div className={`flex items-center gap-2 rounded px-3 py-1.5 text-xs font-medium ${cfg.color} ${cfg.bg}`}>
      <span>◉</span>
      <span>SonarQube: {cfg.label}</span>
      {sonar.status === 'running' && <span className="animate-pulse">●</span>}
      {sonar.issues && sonar.issues.total > 0 && (
        <span className="ml-auto text-neutral-500">
          {sonar.issues.BLOCKER > 0 && `${sonar.issues.BLOCKER} blocker `}
          {sonar.issues.CRITICAL > 0 && `${sonar.issues.CRITICAL} critical `}
          {sonar.issues.total} total
        </span>
      )}
    </div>
  );
}

/* ── Event Row Component ── */

function EventRow({ event }: { event: DashboardEvent }) {
  const time = event.timestamp
    ? new Date(event.timestamp).toLocaleTimeString()
    : '--:--:--';

  const color = EVENT_COLORS[event.type] ?? 'text-neutral-400';

  return (
    <div className="flex items-start gap-2 rounded px-2 py-1 text-xs hover:bg-neutral-800/50">
      <span className="shrink-0 tabular-nums text-neutral-600">{time}</span>
      {event.agentName && (
        <span className={`shrink-0 font-medium ${color}`}>{event.agentName}</span>
      )}
      <span className="text-neutral-300 truncate">{event.message}</span>
    </div>
  );
}
