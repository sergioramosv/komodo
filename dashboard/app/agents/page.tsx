'use client';

import { useState, useRef, useEffect } from 'react';
import { useKomodoSocket } from '@/hooks/useKomodoSocket';
import { ConnectionStatus } from '@/components/connection-status';
import type { AgentName, AgentStatus, AgentLog, Phase } from '@/lib/types';

/* ── Agent config ── */

const AGENT_NAMES: AgentName[] = ['PLANNER', 'CODER', 'REVIEWER'];

const AGENT_ACCENT: Record<AgentName, { color: string; bg: string; border: string; ring: string }> = {
  PLANNER: { color: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/30', ring: 'ring-violet-500/20' },
  CODER: { color: 'text-blue-400', bg: 'bg-blue-500/10', border: 'border-blue-500/30', ring: 'ring-blue-500/20' },
  REVIEWER: { color: 'text-amber-400', bg: 'bg-amber-500/10', border: 'border-amber-500/30', ring: 'ring-amber-500/20' },
};

const AGENT_ICON: Record<AgentName, string> = {
  PLANNER: '✎',
  CODER: '⌨',
  REVIEWER: '⊘',
};

const STATUS_COLORS: Record<AgentStatus, { dot: string; label: string; bg: string }> = {
  idle: { dot: 'bg-neutral-500', label: 'text-neutral-400', bg: 'bg-neutral-500/10' },
  walking: { dot: 'bg-yellow-500', label: 'text-yellow-400', bg: 'bg-yellow-500/10' },
  working: { dot: 'bg-blue-500 animate-pulse', label: 'text-blue-400', bg: 'bg-blue-500/10' },
  done: { dot: 'bg-green-500', label: 'text-green-400', bg: 'bg-green-500/10' },
};

const MODEL_BADGE: Record<string, { label: string; color: string; bg: string }> = {
  'claude': { label: 'Claude', color: 'text-orange-300', bg: 'bg-orange-500/10' },
  'sonnet': { label: 'Sonnet', color: 'text-blue-300', bg: 'bg-blue-500/10' },
  'opus': { label: 'Opus', color: 'text-violet-300', bg: 'bg-violet-500/10' },
  'haiku': { label: 'Haiku', color: 'text-green-300', bg: 'bg-green-500/10' },
  'codex': { label: 'Codex', color: 'text-orange-300', bg: 'bg-orange-500/10' },
  'gemini': { label: 'Gemini', color: 'text-cyan-300', bg: 'bg-cyan-500/10' },
};

const PHASE_TO_AGENT: Record<Phase, AgentName | null> = {
  idle: null,
  planning: 'PLANNER',
  coding: 'CODER',
  analyzing: null,
  reviewing: 'REVIEWER',
  merging: null,
};

/* ── Helpers ── */

function getElapsedTime(startedAt: string | null): string {
  if (!startedAt) return '--';
  const elapsed = Date.now() - new Date(startedAt).getTime();
  if (elapsed < 0) return '--';
  const secs = Math.floor(elapsed / 1000);
  const mins = Math.floor(secs / 60);
  const hrs = Math.floor(mins / 60);
  if (hrs > 0) return `${hrs}h ${mins % 60}m`;
  if (mins > 0) return `${mins}m ${secs % 60}s`;
  return `${secs}s`;
}

function getModelBadge(cli?: string | null, model?: string | null) {
  const key = model || cli || '';
  // Check for partial matches (e.g., "claude-sonnet-4" matches "sonnet")
  for (const [pattern, badge] of Object.entries(MODEL_BADGE)) {
    if (key.toLowerCase().includes(pattern)) return badge;
  }
  if (key) return { label: key, color: 'text-neutral-300', bg: 'bg-neutral-500/10' };
  return null;
}

/* ── Page ── */

export default function AgentsPage() {
  const { snapshot, connected, events, agentLogs } = useKomodoSocket();
  const [selectedAgent, setSelectedAgent] = useState<AgentName | null>(null);

  // Determine which agent is active based on phase
  const activeAgent = snapshot ? PHASE_TO_AGENT[snapshot.phase] : null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Agents</h1>
        <ConnectionStatus connected={connected} />
      </div>

      {!snapshot ? (
        <p className="text-neutral-500">Waiting for orchestrator connection...</p>
      ) : (
        <>
          {/* Agent Cards Grid */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {AGENT_NAMES.map((name) => {
              const agent = snapshot.agents[name];
              const accent = AGENT_ACCENT[name];
              const statusCfg = STATUS_COLORS[agent.status];
              const isSelected = selectedAgent === name;
              const isActive = activeAgent === name;
              const badge = getModelBadge(agent.cli, agent.model);
              const logCount = (agentLogs[name] || []).length;

              return (
                <button
                  key={name}
                  onClick={() => setSelectedAgent(isSelected ? null : name)}
                  className={`group relative rounded-lg border p-4 text-left transition-all ${
                    isSelected
                      ? `${accent.border} ${accent.bg} ring-2 ${accent.ring}`
                      : isActive
                        ? `border-neutral-700 bg-neutral-900 ring-1 ${accent.ring}`
                        : 'border-neutral-800 bg-neutral-900 hover:border-neutral-700 hover:bg-neutral-800/50'
                  }`}
                >
                  {/* Agent header */}
                  <div className="flex items-center gap-3">
                    <span className={`flex h-9 w-9 items-center justify-center rounded-lg text-lg ${accent.bg} ${accent.color}`}>
                      {AGENT_ICON[name]}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h3 className={`text-sm font-bold ${isSelected ? accent.color : 'text-neutral-100'}`}>
                        {name}
                      </h3>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className={`inline-block h-2 w-2 rounded-full ${statusCfg.dot}`} />
                        <span className={`text-xs capitalize ${statusCfg.label}`}>{agent.status}</span>
                      </div>
                    </div>
                    {badge && (
                      <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${badge.color} ${badge.bg}`}>
                        {badge.label}
                      </span>
                    )}
                  </div>

                  {/* Browser validation indicator */}
                  {agent.browserValidation && (
                    <div className="mt-3 flex items-center gap-1.5 rounded bg-pink-500/10 px-2 py-1 text-xs font-medium text-pink-400">
                      <span>🌐</span>
                      Browser Validation
                    </div>
                  )}

                  {/* Current task */}
                  {agent.currentTask && (
                    <p className={`${agent.browserValidation ? 'mt-1.5' : 'mt-3'} truncate text-xs text-neutral-400`}>
                      {agent.currentTask}
                    </p>
                  )}

                  {/* Stats row */}
                  <div className="mt-3 flex items-center gap-3 text-xs text-neutral-500">
                    {agent.startedAt && (
                      <span>{getElapsedTime(agent.startedAt)}</span>
                    )}
                    {(agent.totalCost ?? 0) > 0 && (
                      <span>${agent.totalCost?.toFixed(2)}</span>
                    )}
                    {(agent.completedTasks ?? 0) > 0 && (
                      <span>{agent.completedTasks} tasks</span>
                    )}
                    {logCount > 0 && (
                      <span className="ml-auto rounded bg-neutral-800 px-1.5 py-0.5 text-neutral-400">
                        {logCount} logs
                      </span>
                    )}
                  </div>
                </button>
              );
            })}

            {/* KOMODO orchestrator card */}
            <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-500/10 text-lg text-green-400">
                  K
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold text-neutral-100">KOMODO</h3>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className={`inline-block h-2 w-2 rounded-full ${
                      snapshot.phase === 'idle' ? 'bg-neutral-500' : 'bg-green-500 animate-pulse'
                    }`} />
                    <span className={`text-xs capitalize ${
                      snapshot.phase === 'idle' ? 'text-neutral-400' : 'text-green-400'
                    }`}>
                      {snapshot.phase}
                    </span>
                  </div>
                </div>
                <span className="rounded px-1.5 py-0.5 text-xs font-medium text-green-300 bg-green-500/10">
                  Orchestrator
                </span>
              </div>

              {snapshot.currentTask && (
                <p className="mt-3 truncate text-xs text-neutral-400">
                  {snapshot.taskDetails?.title ?? snapshot.currentTask}
                </p>
              )}

              <div className="mt-3 flex items-center gap-3 text-xs text-neutral-500">
                <span>${snapshot.totalCost.toFixed(2)}</span>
                <span>{snapshot.tasksCompleted} completed</span>
                {snapshot.reviewCycle > 0 && (
                  <span className="rounded bg-orange-500/10 px-1.5 py-0.5 text-orange-400">
                    Review #{snapshot.reviewCycle}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Agent Detail Panel */}
          {selectedAgent && (
            <AgentDetail
              agent={snapshot.agents[selectedAgent]}
              logs={agentLogs[selectedAgent] || []}
              events={events}
              accent={AGENT_ACCENT[selectedAgent]}
              onClose={() => setSelectedAgent(null)}
            />
          )}
        </>
      )}
    </div>
  );
}

/* ── Agent Detail Component ── */

interface AgentDetailProps {
  agent: {
    name: AgentName;
    status: AgentStatus;
    currentTask: string | null;
    startedAt: string | null;
    cli?: string | null;
    model?: string | null;
    totalCost?: number;
    totalTurns?: number;
    completedTasks?: number;
    browserValidation?: boolean;
  };
  logs: AgentLog[];
  events: { id: string; type: string; timestamp: string; agentName: string | null; message: string }[];
  accent: { color: string; bg: string; border: string; ring: string };
  onClose: () => void;
}

function AgentDetail({ agent, logs, events, accent, onClose }: AgentDetailProps) {
  const statusCfg = STATUS_COLORS[agent.status];
  const badge = getModelBadge(agent.cli, agent.model);
  const agentEvents = events.filter((e) => e.agentName === agent.name);
  const [activeTab, setActiveTab] = useState<'logs' | 'history'>('logs');

  return (
    <section className={`rounded-lg border ${accent.border} ${accent.bg}/5 overflow-hidden`}>
      {/* Detail Header */}
      <div className="flex items-center justify-between border-b border-neutral-800 px-5 py-4">
        <div className="flex items-center gap-3">
          <span className={`flex h-10 w-10 items-center justify-center rounded-lg text-xl ${accent.bg} ${accent.color}`}>
            {AGENT_ICON[agent.name]}
          </span>
          <div>
            <div className="flex items-center gap-2">
              <h2 className={`text-lg font-bold ${accent.color}`}>{agent.name}</h2>
              <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${statusCfg.bg} ${statusCfg.label}`}>
                <span className={`inline-block h-1.5 w-1.5 rounded-full ${statusCfg.dot}`} />
                {agent.status}
              </span>
              {badge && (
                <span className={`rounded px-2 py-0.5 text-xs font-medium ${badge.color} ${badge.bg}`}>
                  {badge.label}
                </span>
              )}
            </div>
            {agent.currentTask && (
              <p className="mt-0.5 text-sm text-neutral-400">{agent.currentTask}</p>
            )}
          </div>
        </div>
        <button
          onClick={onClose}
          className="rounded-md p-1.5 text-neutral-500 transition-colors hover:bg-neutral-800 hover:text-neutral-300"
        >
          ✕
        </button>
      </div>

      {/* Stats Bar */}
      <div className="flex flex-wrap gap-6 border-b border-neutral-800 px-5 py-3">
        <Stat label="Status" value={agent.status} />
        {agent.browserValidation && (
          <Stat label="Mode" value="🌐 Browser" />
        )}
        <Stat label="Active Time" value={getElapsedTime(agent.startedAt)} />
        <Stat label="Cost" value={`$${(agent.totalCost ?? 0).toFixed(2)}`} />
        <Stat label="Turns" value={String(agent.totalTurns ?? 0)} />
        <Stat label="Tasks Done" value={String(agent.completedTasks ?? 0)} />
        {agent.startedAt && (
          <Stat label="Started" value={new Date(agent.startedAt).toLocaleTimeString()} />
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-neutral-800">
        <button
          onClick={() => setActiveTab('logs')}
          className={`px-5 py-2.5 text-sm font-medium transition-colors ${
            activeTab === 'logs'
              ? `${accent.color} border-b-2 ${accent.border}`
              : 'text-neutral-500 hover:text-neutral-300'
          }`}
        >
          Live Log ({logs.length})
        </button>
        <button
          onClick={() => setActiveTab('history')}
          className={`px-5 py-2.5 text-sm font-medium transition-colors ${
            activeTab === 'history'
              ? `${accent.color} border-b-2 ${accent.border}`
              : 'text-neutral-500 hover:text-neutral-300'
          }`}
        >
          Event History ({agentEvents.length})
        </button>
      </div>

      {/* Tab Content */}
      <div className="max-h-96">
        {activeTab === 'logs' ? (
          <LiveLogTerminal logs={logs} accent={accent} />
        ) : (
          <EventHistory events={agentEvents} />
        )}
      </div>
    </section>
  );
}

/* ── Stat Component ── */

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-neutral-500">{label}</p>
      <p className="text-sm font-medium capitalize text-neutral-200">{value}</p>
    </div>
  );
}

/* ── Live Log Terminal ── */

function LiveLogTerminal({ logs, accent }: { logs: AgentLog[]; accent: { color: string } }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  // Auto-scroll to bottom when new logs arrive
  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs.length, autoScroll]);

  const handleScroll = () => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    // If user scrolled up more than 50px from bottom, disable auto-scroll
    setAutoScroll(scrollHeight - scrollTop - clientHeight < 50);
  };

  if (logs.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-neutral-600">
        <div className="text-center">
          <p>No logs yet</p>
          <p className="mt-1 text-xs">Logs will appear here when the agent starts working</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="max-h-96 overflow-y-auto bg-neutral-950/50 p-3 font-mono text-xs"
      >
        {logs.map((log) => (
          <div key={log.id} className="flex gap-2 py-0.5 hover:bg-neutral-800/30">
            <span className="shrink-0 text-neutral-600 tabular-nums">
              {new Date(log.timestamp).toLocaleTimeString()}
            </span>
            {log.kind === 'tool' ? (
              <>
                <span className="shrink-0 text-cyan-400">[tool]</span>
                <span className="text-cyan-300">{log.content}</span>
                {log.detail && (
                  <span className="truncate text-neutral-500">{log.detail}</span>
                )}
              </>
            ) : (
              <>
                <span className={`shrink-0 ${accent.color}`}>[text]</span>
                <span className="text-neutral-300">{log.content}</span>
              </>
            )}
          </div>
        ))}
      </div>
      {!autoScroll && (
        <button
          onClick={() => {
            setAutoScroll(true);
            if (scrollRef.current) {
              scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
            }
          }}
          className="absolute bottom-3 right-3 rounded bg-neutral-800 px-2 py-1 text-xs text-neutral-400 transition-colors hover:bg-neutral-700 hover:text-neutral-300"
        >
          Scroll to bottom
        </button>
      )}
    </div>
  );
}

/* ── Event History ── */

function EventHistory({ events }: { events: { id: string; timestamp: string; message: string }[] }) {
  if (events.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-neutral-600">
        No events recorded for this agent
      </div>
    );
  }

  return (
    <div className="max-h-96 overflow-y-auto p-3">
      {events.map((evt) => (
        <div key={evt.id} className="flex items-start gap-3 rounded px-2 py-1.5 text-sm hover:bg-neutral-800/50">
          <span className="shrink-0 tabular-nums text-neutral-600">
            {new Date(evt.timestamp).toLocaleTimeString()}
          </span>
          <span className="text-neutral-300">{evt.message}</span>
        </div>
      ))}
    </div>
  );
}
