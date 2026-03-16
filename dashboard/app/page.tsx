"use client";

import { useState } from 'react';
import { useKomodoSocket } from '@/hooks/useKomodoSocket';
import { useAgentStates } from '@/hooks/useAgentStates';
import { useOfficeFeedback } from '@/hooks/useOfficeFeedback';
import { ConnectionStatus } from '@/components/connection-status';
import dynamic from 'next/dynamic';
import { ExecutionControls } from '@/components/execution-controls';
import { CliHealthStatus } from '@/components/cli-health-status';
import { BudgetWidget } from '@/components/budget-widget';
import { ProjectSelector } from '@/components/project-selector';
import { MultiProjectOverview } from '@/components/multi-project-overview';
import { TaskDetailModal } from '@/components/task-detail-modal';
import { Settings } from 'lucide-react';

const OfficeScene3D = dynamic(() => import('@/components/office-scene-3d').then(mod => mod.OfficeScene3D), { ssr: false });
const PixelOfficeCanvas = dynamic(() => import('@/components/pixel-office/pixel-office-canvas').then(mod => mod.PixelOfficeCanvas), { ssr: false });
import type { Phase, AgentStatus, DashboardEvent, SonarAnalysisState } from '@/lib/types';

/* ── Phase config ── */

const PHASE_CONFIG: Record<Phase, { icon: string; label: string; color: string }> = {
  idle: { icon: '○', label: 'Idle', color: 'text-neutral-500' },
  planning: { icon: '✎', label: 'Planning', color: 'text-violet-400' },
  architecting: { icon: '◈', label: 'Architecting', color: 'text-cyan-400' },
  coding: { icon: '⌨', label: 'Coding', color: 'text-blue-400' },
  testing: { icon: '⚙', label: 'Testing', color: 'text-teal-400' },
  security: { icon: '⛨', label: 'Security', color: 'text-green-400' },
  analyzing: { icon: '◉', label: 'SonarQube', color: 'text-cyan-400' },
  reviewing: { icon: '⊘', label: 'Reviewing', color: 'text-amber-400' },
  merging: { icon: '⇢', label: 'Merging', color: 'text-green-400' },
};

const PHASE_ORDER: Phase[] = ['planning', 'architecting', 'coding', 'testing', 'security', 'analyzing', 'reviewing', 'merging'];

/* ── Agent status colors ── */

const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: 'bg-neutral-600',
  walking: 'bg-yellow-500',
  working: 'bg-blue-500',
  done: 'bg-green-500',
};

const STATUS_RING: Record<AgentStatus, string> = {
  idle: '',
  walking: 'ring-2 ring-yellow-500/30',
  working: 'ring-2 ring-blue-500/30 animate-pulse',
  done: 'ring-2 ring-green-500/30',
};

/* ── Event type colors ── */

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

/* ── Page ── */

export default function DashboardPage() {
  const { snapshot, connected, events, cliHealth, sendCommand } = useKomodoSocket();
  const agentStates = useAgentStates(snapshot, connected);
  const feedback = useOfficeFeedback(events, snapshot);
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [officeView, setOfficeView] = useState<'3d' | 'pixel'>('3d');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Dashboard</h1>
        <ConnectionStatus connected={connected} />
      </div>

      {!snapshot ? (
        <p className="text-neutral-500">Waiting for orchestrator connection...</p>
      ) : (
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <div className="space-y-6 xl:col-span-1">
            {/* Current Task Card */}
            <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
              <h2 className="mb-3 text-sm font-medium text-neutral-400">Current Task</h2>
              {snapshot.currentTask ? (
                <div className="space-y-3">
                  <p className="text-lg font-semibold">
                    {snapshot.taskDetails?.title ?? snapshot.currentTask}
                  </p>
                  {snapshot.taskDetails?.userStory && (
                    <p className="text-sm text-neutral-400">{snapshot.taskDetails.userStory}</p>
                  )}

                  {/* Points */}
                  {(snapshot.taskDetails?.devPoints != null || snapshot.taskDetails?.businessPoints != null) && (
                    <div className="flex gap-3">
                      {snapshot.taskDetails?.businessPoints != null && (
                        <div className="flex items-center gap-1.5 rounded bg-amber-500/10 px-2.5 py-1">
                          <span className="text-amber-400">💼</span>
                          <span className="text-sm font-medium text-amber-400">
                            {snapshot.taskDetails.businessPoints} BP
                          </span>
                        </div>
                      )}
                      {snapshot.taskDetails?.devPoints != null && (
                        <div className="flex items-center gap-1.5 rounded bg-blue-500/10 px-2.5 py-1">
                          <span className="text-blue-400"><Settings size={16} /></span>
                          <span className="text-sm font-medium text-blue-400">
                            {snapshot.taskDetails.devPoints} DP
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Developer & Sprint */}
                  <div className="flex flex-wrap gap-2 text-xs text-neutral-500">
                    {snapshot.taskDetails?.assignedDeveloper && (
                      <span className="flex items-center gap-1 rounded bg-neutral-800 px-2 py-0.5">
                        <span>&#128100;</span> {snapshot.taskDetails.assignedDeveloper}
                      </span>
                    )}
                    {snapshot.taskDetails?.sprint && (
                      <span className="rounded bg-neutral-800 px-2 py-0.5">
                        &#127939; {snapshot.taskDetails.sprint}
                      </span>
                    )}
                    {snapshot.currentPR && (
                      <span className="rounded bg-neutral-800 px-2 py-0.5">
                        PR: {typeof snapshot.currentPR === 'object' ? `#${snapshot.currentPR.number}` : snapshot.currentPR}
                      </span>
                    )}
                  </div>

                  {/* View Task button */}
                  {snapshot.taskDetails && (
                    <button
                      onClick={() => setTaskModalOpen(true)}
                      className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-800/50 px-3 py-2 text-xs font-medium text-neutral-300 transition-colors hover:bg-neutral-700 hover:text-white"
                    >
                      View Task Details
                    </button>
                  )}
                </div>
              ) : (
                <p className="text-neutral-500">No task running</p>
              )}
            </section>

            {/* Execution Controls */}
            <ExecutionControls
              executionState={snapshot.executionState ?? 'stopped'}
              phase={snapshot.phase}
              connected={connected}
              onPause={() => sendCommand('pause')}
              onStop={() => sendCommand('stop')}
            />

            {/* Multi-Project Selector & Overview */}
            {snapshot.multiProject?.enabled && (
              <>
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
              </>
            )}


            {/* Agent Cards */}
            <section className="grid grid-cols-1 gap-4 sm:grid-cols-3 xl:grid-cols-1">
              {(["PLANNER","ARCHITECT","CODER","TESTER","SECURITY","REVIEWER"] as const).map((name) => { const agent = snapshot.agents[name] ?? { name, status: "idle" as const, currentTask: null, startedAt: null };
                const dotColor = STATUS_COLORS[agent.status] ?? 'bg-neutral-600';
                const ring = STATUS_RING[agent.status] ?? '';

                return (
                  <div
                    key={agent.name}
                    className="rounded-lg border border-neutral-800 bg-neutral-900 p-4"
                  >
                    <div className="flex items-center gap-3">
                      <span className={`inline-block h-3 w-3 rounded-full ${dotColor} ${ring}`} />
                      <h3 className="text-sm font-semibold">{agent.name}</h3>
                      <span className={`ml-auto rounded px-2 py-0.5 text-xs font-medium capitalize ${agent.status === 'working' ? 'bg-blue-500/20 text-blue-400'
                        : agent.status === 'done' ? 'bg-green-500/20 text-green-400'
                          : 'bg-neutral-800 text-neutral-400'
                        }`}>
                        {agent.status}
                      </span>
                    </div>
                    {agent.currentTask && (
                      <p className="mt-2 truncate text-sm text-neutral-400">{agent.currentTask}</p>
                    )}
                    {agent.startedAt && (
                      <p className="mt-1 text-xs text-neutral-500">
                        Since {new Date(agent.startedAt).toLocaleTimeString()}
                      </p>
                    )}
                  </div>
                );
              })}
            </section>

            {/* Agent Cost & Turns Breakdown */}
            <AgentCostBreakdown agents={snapshot.agents} totalCost={snapshot.totalCost} />

            {/* Tasks */}
            <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
              <h3 className="mb-1 text-sm font-medium text-neutral-400">Tasks</h3>
              <div className="mt-2 text-2xl font-bold tabular-nums">
                {snapshot.tasksCompleted}
                <span className="text-sm font-normal text-neutral-500 ml-1">
                  / {snapshot.totalTasks || '?'}
                </span>
              </div>
            </section>

            {/* Event Timeline */}
            <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
              <h2 className="mb-4 text-sm font-medium text-neutral-400">Recent Events</h2>
              {events.length === 0 ? (
                <p className="text-sm text-neutral-600">No events yet</p>
              ) : (
                <div className="space-y-1">
                  {events.map((evt) => (
                    <EventRow key={evt.id} event={evt} />
                  ))}
                </div>
              )}
            </section>
          </div>

          <div className="xl:col-span-2 flex flex-col min-h-[600px] h-[calc(100vh-8rem)] rounded-lg border border-neutral-800 bg-neutral-900 overflow-hidden relative">
            {/* Phase Indicator */}
            <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
              <h2 className="mb-4 text-sm font-medium text-neutral-400">Phase</h2>
              {snapshot.phase === 'idle' ? (
                <div className="flex items-center gap-2">
                  <span className="text-lg text-neutral-500">○</span>
                  <span className="text-neutral-500">Idle — waiting for next task</span>
                </div>
              ) : (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    {PHASE_ORDER.map((phase, i) => {
                      const cfg = PHASE_CONFIG[phase];
                      const isActive = snapshot.phase === phase;
                      const isPast = PHASE_ORDER.indexOf(snapshot.phase as Phase) > i;

                      return (
                        <div key={phase} className="flex items-center">
                          {i > 0 && (
                            <div
                              className={`mx-1 h-px w-2 sm:w-4 ${isPast ? 'bg-green-500' : 'bg-neutral-700'
                                }`}
                            />
                          )}
                          <div
                            className={`flex items-center gap-1.5 rounded-full px-2 py-1 text-xs sm:px-3 sm:py-1.5 sm:text-sm font-medium transition-all ${isActive
                              ? `${cfg.color} bg-neutral-800 ring-1 ring-neutral-700`
                              : isPast
                                ? 'text-green-500 bg-green-500/10'
                                : 'text-neutral-600'
                              }`}
                          >
                            <span className="text-base">{isActive ? cfg.icon : isPast ? '✓' : cfg.icon}</span>
                            {cfg.label}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {/* SonarQube Analysis inline status */}
                  {snapshot.sonarAnalysis && snapshot.sonarAnalysis.status !== 'idle' && (
                    <SonarStatus sonar={snapshot.sonarAnalysis} />
                  )}
                </div>
              )}
            </section>

            {/* Office View Toggle */}
            <div className="flex items-center gap-1 px-4 py-2 border-b border-neutral-800">
              <button
                onClick={() => setOfficeView('3d')}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${officeView === '3d' ? 'bg-neutral-700 text-white' : 'text-neutral-500 hover:text-neutral-300'}`}
              >
                3D Office
              </button>
              <button
                onClick={() => setOfficeView('pixel')}
                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${officeView === 'pixel' ? 'bg-neutral-700 text-white' : 'text-neutral-500 hover:text-neutral-300'}`}
              >
                Pixel Office
              </button>
            </div>

            {/* Office Scene — real-time agent visualization */}
            {officeView === '3d' ? (
              <OfficeScene3D agents={agentStates.agents} phase={snapshot.phase} cliHealth={cliHealth} />
            ) : (
              <PixelOfficeCanvas agents={agentStates.agents} cliHealth={cliHealth} />
            )}
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

/* ── Agent Cost Breakdown Component ── */

const AGENT_COLORS: Record<string, string> = {
  PLANNER: 'bg-violet-500',
  ARCHITECT: 'bg-cyan-500',
  CODER: 'bg-blue-500',
  TESTER: 'bg-orange-500',
  SECURITY: 'bg-green-500',
  REVIEWER: 'bg-amber-500',
};

function AgentCostBreakdown({ agents, totalCost }: { agents: Record<string, { name: string; totalCost?: number; totalTurns?: number; completedTasks?: number }>; totalCost: number }) {
  const allNames = ["PLANNER","ARCHITECT","CODER","TESTER","SECURITY","REVIEWER"] as const; const allAgents = allNames.map(n => agents[n] ?? { name: n, totalCost: 0, totalTurns: 0 });
  const totalTurns = allAgents.reduce((sum, a) => sum + (a.totalTurns ?? 0), 0);

  if (totalCost === 0 && totalTurns === 0) return null;

  return (
    <section className="rounded-lg border border-neutral-800 bg-neutral-900 p-5">
      <h2 className="mb-3 text-sm font-medium text-neutral-400">Agent Cost & Turns</h2>

      {/* Totals row */}
      <div className="flex gap-4 mb-4">
        <div>
          <p className="text-xs text-neutral-500">Total Cost</p>
          <p className="text-lg font-bold tabular-nums">${totalCost.toFixed(2)}</p>
        </div>
        <div>
          <p className="text-xs text-neutral-500">Total Turns</p>
          <p className="text-lg font-bold tabular-nums">{totalTurns}</p>
        </div>
      </div>

      {/* Cost bar */}
      {totalCost > 0 && (
        <div className="flex h-2.5 w-full rounded-full overflow-hidden bg-neutral-800 mb-3">
          {allAgents.map((agent) => {
            const pct = totalCost > 0 ? ((agent.totalCost ?? 0) / totalCost) * 100 : 0;
            if (pct < 0.5) return null;
            return (
              <div
                key={agent.name}
                className={`${AGENT_COLORS[agent.name] ?? 'bg-neutral-500'} transition-all`}
                style={{ width: `${pct}%` }}
                title={`${agent.name}: $${(agent.totalCost ?? 0).toFixed(2)} (${pct.toFixed(0)}%)`}
              />
            );
          })}
        </div>
      )}

      {/* Per-agent breakdown */}
      <div className="space-y-1.5">
        {allAgents.map((agent) => {
          const cost = agent.totalCost ?? 0;
          const turns = agent.totalTurns ?? 0;
          if (cost === 0 && turns === 0) return null;
          const pct = totalCost > 0 ? ((cost / totalCost) * 100).toFixed(0) : '0';

          return (
            <div key={agent.name} className="flex items-center gap-2 text-xs">
              <span className={`inline-block h-2 w-2 rounded-full ${AGENT_COLORS[agent.name] ?? 'bg-neutral-500'}`} />
              <span className="w-20 font-medium text-neutral-300">{agent.name}</span>
              <span className="tabular-nums text-neutral-400">${cost.toFixed(2)}</span>
              <span className="text-neutral-600">({pct}%)</span>
              <span className="ml-auto tabular-nums text-neutral-500">{turns} turns</span>
            </div>
          );
        })}
      </div>
    </section>
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
  const isBrowserCheck = event.type === 'browser:check';
  const screenshot = isBrowserCheck ? (event.metadata?.screenshot as string | undefined) : undefined;
  const errors = isBrowserCheck ? (event.metadata?.errors as string[] | undefined) : undefined;

  return (
    <div className="rounded px-2 py-1.5 text-sm hover:bg-neutral-800/50">
      <div className="flex items-start gap-3">
        <span className="shrink-0 tabular-nums text-neutral-600">{time}</span>
        {isBrowserCheck && <span className="shrink-0">🌐</span>}
        {event.agentName && (
          <span className={`shrink-0 font-medium ${color}`}>{event.agentName}</span>
        )}
        <span className="text-neutral-300">{event.message}</span>
      </div>
      {/* Console errors */}
      {errors && errors.length > 0 && (
        <div className="mt-1.5 ml-8 space-y-0.5">
          {errors.slice(0, 5).map((err, i) => (
            <p key={i} className="truncate rounded bg-red-500/10 px-2 py-0.5 font-mono text-xs text-red-400">
              {err}
            </p>
          ))}
          {errors.length > 5 && (
            <p className="text-xs text-neutral-500">+{errors.length - 5} more</p>
          )}
        </div>
      )}
      {/* Screenshot thumbnail */}
      {screenshot && (
        <a
          href={screenshot}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1.5 ml-8 inline-block"
        >
          <img
            src={screenshot}
            alt="Browser screenshot"
            className="h-16 w-28 rounded border border-neutral-700 object-cover transition-opacity hover:opacity-80"
          />
        </a>
      )}
    </div>
  );
}
