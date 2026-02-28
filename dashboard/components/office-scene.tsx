'use client';

import type { AgentName, AgentState, Phase } from '@/lib/types';

/* ── Types ── */

interface OfficeSceneProps {
  agents: Record<AgentName, AgentState>;
  phase: Phase;
}

type Zone = 'coder' | 'reviewer' | 'planner' | 'waiting';

/* ── Agent zone logic ── */

function getAgentZone(agent: AgentState): Zone {
  if (agent.status === 'idle' || agent.status === 'walking') return 'waiting';
  if (agent.name === 'PLANNER') return 'planner';
  if (agent.name === 'CODER') return 'coder';
  if (agent.name === 'REVIEWER') return 'reviewer';
  return 'waiting';
}

function groupAgentsByZone(agents: Record<AgentName, AgentState>): Record<Zone, AgentState[]> {
  const zones: Record<Zone, AgentState[]> = {
    coder: [],
    reviewer: [],
    planner: [],
    waiting: [],
  };
  for (const agent of Object.values(agents)) {
    zones[getAgentZone(agent)].push(agent);
  }
  return zones;
}

/* ── Style constants ── */

const AGENT_COLORS: Record<AgentName, { bg: string; border: string; text: string }> = {
  PLANNER: { bg: 'bg-violet-500', border: 'border-violet-400', text: 'text-violet-300' },
  CODER: { bg: 'bg-blue-500', border: 'border-blue-400', text: 'text-blue-300' },
  REVIEWER: { bg: 'bg-amber-500', border: 'border-amber-400', text: 'text-amber-300' },
};

const PHASE_BADGE: Record<Phase, string> = {
  idle: 'bg-neutral-800 text-neutral-500',
  planning: 'bg-violet-500/20 text-violet-400',
  coding: 'bg-blue-500/20 text-blue-400',
  reviewing: 'bg-amber-500/20 text-amber-400',
  merging: 'bg-green-500/20 text-green-400',
};

const PHASE_MONITOR: Record<Phase, string> = {
  idle: 'bg-neutral-800',
  planning: 'bg-violet-950/60',
  coding: 'bg-blue-950/60',
  reviewing: 'bg-amber-950/60',
  merging: 'bg-green-950/60',
};

/* ── Sub-components ── */

function AgentCharacter({ agent }: { agent: AgentState }) {
  const colors = AGENT_COLORS[agent.name];
  const isWorking = agent.status === 'working';
  const isWalking = agent.status === 'walking';

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div
        className={`
          relative w-9 h-9 rounded-full ${colors.bg}
          flex items-center justify-center text-sm font-bold text-white
          border-2 ${colors.border}
          ${isWorking ? 'animate-pulse' : ''}
          ${isWalking ? 'animate-bounce' : ''}
        `}
      >
        {agent.name[0]}
        <div
          className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full border border-[#16181d] ${
            agent.status === 'working'
              ? 'bg-green-400'
              : agent.status === 'walking'
                ? 'bg-yellow-400'
                : agent.status === 'done'
                  ? 'bg-emerald-400'
                  : 'bg-neutral-500'
          }`}
        />
      </div>
      <span className={`text-[10px] font-semibold ${colors.text} leading-none`}>
        {agent.name}
      </span>
    </div>
  );
}

function BossZone({ phase }: { phase: Phase }) {
  const monitorBg = PHASE_MONITOR[phase];

  return (
    <div className="flex flex-col items-center gap-3">
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold text-emerald-400 uppercase tracking-wider">
          Komodo HQ
        </span>
      </div>

      {/* Boss desk */}
      <div className="relative w-full max-w-[280px]">
        <div className="h-[72px] rounded-sm bg-amber-950/80 border-2 border-amber-900/60 flex items-center justify-center gap-2 px-3">
          {['tasks', 'status', 'logs'].map((label) => (
            <div
              key={label}
              className={`w-16 h-11 rounded-sm ${monitorBg} border border-neutral-700 flex items-center justify-center`}
            >
              <span className="text-[7px] text-emerald-400/80 font-mono">{label}</span>
            </div>
          ))}
        </div>
        <div className="w-12 h-2 mx-auto mt-0.5 rounded-b bg-neutral-700/60" />
      </div>

      {/* Komodo boss character */}
      <div className="flex flex-col items-center">
        <div className="w-11 h-11 rounded-full bg-emerald-600 border-2 border-emerald-400 flex items-center justify-center text-base font-bold text-white">
          K
        </div>
        <span className="text-[10px] font-bold text-emerald-300 mt-0.5">KOMODO</span>
      </div>
    </div>
  );
}

function CoderDesk({ agents }: { agents: AgentState[] }) {
  return (
    <div className="flex flex-col items-center gap-2 min-w-[140px]">
      <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">
        Coder
      </span>

      <div className="w-[140px] h-[68px] rounded-sm bg-amber-950/80 border-2 border-amber-900/60 flex items-center justify-center">
        {/* Monitor with code */}
        <div className="w-24 h-12 rounded-sm bg-neutral-900 border border-neutral-700 p-1.5 overflow-hidden">
          <div className="text-[5px] font-mono leading-[7px] text-blue-400/90">
            <div className="text-violet-400/70">{'fn main() {'}</div>
            <div>{'  let x = 42;'}</div>
            <div className="text-green-400/70">{'  // build ok'}</div>
            <div className="text-violet-400/70">{'}'}</div>
          </div>
        </div>
      </div>

      {/* Keyboard */}
      <div className="w-16 h-2.5 -mt-1 rounded-sm bg-neutral-700/80 border border-neutral-600/50" />

      {/* Chair + agent */}
      <div className="w-10 h-4 rounded-b bg-neutral-700/50 border border-neutral-600/40" />
      <div className="flex gap-2 mt-1">
        {agents.map((a) => (
          <AgentCharacter key={a.name} agent={a} />
        ))}
      </div>
    </div>
  );
}

function ReviewerDesk({ agents }: { agents: AgentState[] }) {
  return (
    <div className="flex flex-col items-center gap-2 min-w-[140px]">
      <span className="text-[10px] font-bold text-amber-400 uppercase tracking-wider">
        Reviewer
      </span>

      <div className="w-[140px] h-[68px] rounded-sm bg-amber-950/80 border-2 border-amber-900/60 flex items-center justify-center gap-3">
        {/* Document stack */}
        <div className="relative w-12 h-12">
          <div className="absolute inset-0 rotate-2 bg-neutral-200 border border-neutral-300 rounded-[1px]" />
          <div className="absolute inset-0 -rotate-1 bg-neutral-100 border border-neutral-300 rounded-[1px]" />
          <div className="absolute inset-0 bg-white border border-neutral-300 rounded-[1px] p-1.5">
            <div className="space-y-[3px]">
              <div className="h-[2px] w-full bg-neutral-300 rounded-full" />
              <div className="h-[2px] w-3/4 bg-neutral-300 rounded-full" />
              <div className="h-[2px] w-full bg-neutral-300 rounded-full" />
              <div className="h-[2px] w-1/2 bg-red-400 rounded-full" />
              <div className="h-[2px] w-2/3 bg-green-400 rounded-full" />
            </div>
          </div>
        </div>

        {/* Magnifying glass (simple CSS) */}
        <div className="relative w-8 h-10">
          <div className="w-7 h-7 rounded-full border-[3px] border-amber-400/70" />
          <div className="absolute bottom-0 right-0 w-[3px] h-4 bg-amber-600/70 rounded-full rotate-[40deg] origin-top" />
        </div>
      </div>

      {/* Chair + agent */}
      <div className="w-10 h-4 rounded-b bg-neutral-700/50 border border-neutral-600/40" />
      <div className="flex gap-2 mt-1">
        {agents.map((a) => (
          <AgentCharacter key={a.name} agent={a} />
        ))}
      </div>
    </div>
  );
}

function TaskBoard({ agents }: { agents: AgentState[] }) {
  const postItColors = [
    'bg-yellow-300',
    'bg-pink-300',
    'bg-green-300',
    'bg-blue-300',
    'bg-orange-300',
    'bg-violet-300',
  ];

  return (
    <div className="flex flex-col items-center gap-2 min-w-[140px]">
      <span className="text-[10px] font-bold text-violet-400 uppercase tracking-wider">
        Planner
      </span>

      {/* Board */}
      <div className="w-[140px] h-[90px] rounded-sm bg-neutral-800/80 border-2 border-neutral-600/60 p-2">
        <div className="text-[7px] text-neutral-500 mb-1.5 text-center font-semibold uppercase tracking-wide">
          Task Board
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {postItColors.map((color, i) => (
            <div
              key={i}
              className={`aspect-square ${color} rounded-[1px] shadow-sm flex items-center justify-center`}
            >
              <div className="w-3/4 space-y-[2px]">
                <div className="h-[1px] bg-black/15" />
                <div className="h-[1px] bg-black/15 w-2/3" />
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Agent */}
      <div className="flex gap-2 mt-1">
        {agents.map((a) => (
          <AgentCharacter key={a.name} agent={a} />
        ))}
      </div>
    </div>
  );
}

function WaitingRoom({ agents }: { agents: AgentState[] }) {
  return (
    <div className="flex flex-col items-center gap-2 min-w-[130px]">
      <span className="text-[10px] font-bold text-neutral-500 uppercase tracking-wider">
        Waiting Room
      </span>

      {/* Sofa */}
      <div className="relative">
        <div className="w-[110px] h-10 rounded bg-neutral-700/80 border-2 border-neutral-600/60" />
        {/* Arms */}
        <div className="absolute -left-1.5 top-1 w-2 h-8 rounded-l bg-neutral-600/80" />
        <div className="absolute -right-1.5 top-1 w-2 h-8 rounded-r bg-neutral-600/80" />
        {/* Cushions */}
        <div className="absolute top-1 left-3 right-3 h-3 flex gap-1">
          <div className="flex-1 rounded-t bg-neutral-600/50" />
          <div className="flex-1 rounded-t bg-neutral-600/50" />
        </div>
      </div>

      {/* Coffee table */}
      <div className="w-14 h-5 rounded-sm bg-amber-950/60 border border-amber-900/40 flex items-center justify-center">
        <span className="text-[9px]">&#9749;</span>
      </div>

      {/* Agents sitting here */}
      <div className="flex gap-3 flex-wrap justify-center min-h-[44px]">
        {agents.length > 0 ? (
          agents.map((a) => <AgentCharacter key={a.name} agent={a} />)
        ) : (
          <span className="text-[9px] text-neutral-600 italic self-center">empty</span>
        )}
      </div>
    </div>
  );
}

/* ── Decorative elements ── */

function WallClock() {
  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="w-6 h-6 rounded-full border-2 border-neutral-600 bg-neutral-800 flex items-center justify-center">
        <div className="relative w-3 h-3">
          <div className="absolute left-1/2 bottom-1/2 w-[1px] h-1.5 bg-neutral-400 origin-bottom -translate-x-1/2 rotate-[30deg]" />
          <div className="absolute left-1/2 bottom-1/2 w-[1px] h-2 bg-neutral-500 origin-bottom -translate-x-1/2 -rotate-[60deg]" />
        </div>
      </div>
    </div>
  );
}

function PlantPot() {
  return (
    <div className="flex flex-col items-center">
      <div className="text-green-600 text-[10px] leading-none">&#9670;&#9670;</div>
      <div className="w-4 h-3 rounded-b bg-amber-800 border border-amber-700" />
    </div>
  );
}

/* ── Main Component ── */

export function OfficeScene({ agents, phase }: OfficeSceneProps) {
  const zones = groupAgentsByZone(agents);

  return (
    <div
      className="w-full rounded-lg border border-neutral-800 overflow-hidden"
      style={{
        background: '#16181d',
        backgroundImage: [
          'linear-gradient(rgba(255,255,255,0.012) 1px, transparent 1px)',
          'linear-gradient(90deg, rgba(255,255,255,0.012) 1px, transparent 1px)',
        ].join(', '),
        backgroundSize: '20px 20px',
      }}
    >
      {/* Title bar */}
      <div className="border-b border-neutral-800 bg-neutral-900/50 px-4 py-2 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-neutral-200">Komodo Office</span>
          <WallClock />
        </div>
        <span
          className={`text-[10px] px-2.5 py-0.5 rounded-full font-semibold uppercase tracking-wide ${PHASE_BADGE[phase]}`}
        >
          {phase}
        </span>
      </div>

      {/* Scene */}
      <div className="p-6 lg:p-8 flex flex-col items-center gap-8 min-h-[480px]">
        {/* Row 1: Boss Komodo desk — top center */}
        <BossZone phase={phase} />

        {/* Wall/Divider between boss and work floor */}
        <div className="w-full max-w-2xl flex items-center gap-3">
          <div className="flex-1 border-t border-dashed border-neutral-800" />
          <PlantPot />
          <div className="flex-1 border-t border-dashed border-neutral-800" />
          <PlantPot />
          <div className="flex-1 border-t border-dashed border-neutral-800" />
        </div>

        {/* Row 2: Work floor — 4 zones side by side */}
        <div className="flex flex-wrap justify-center gap-8 lg:gap-12 w-full">
          <WaitingRoom agents={zones.waiting} />
          <CoderDesk agents={zones.coder} />
          <ReviewerDesk agents={zones.reviewer} />
          <TaskBoard agents={zones.planner} />
        </div>

        {/* Floor decoration */}
        <div className="flex items-center gap-6 mt-2">
          <PlantPot />
          <div className="text-[9px] text-neutral-700 font-mono">
            &#9632; Komodo Inc. &mdash; AI Development Office
          </div>
          <PlantPot />
        </div>
      </div>
    </div>
  );
}
