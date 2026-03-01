'use client';

import { useEffect, useRef, useState } from 'react';
import type { AgentName, Phase } from '@/lib/types';
import type { AgentVisualState } from '@/hooks/useAgentStates';
import type { OfficeFeedback } from '@/hooks/useOfficeFeedback';
import { AgentAvatar } from './agent-avatar';
import type { AgentType, AnimationState } from './agent-avatar';

/* ── Types ── */

interface OfficeSceneProps {
  agents: Record<AgentName, AgentVisualState>;
  phase: Phase;
  feedback?: OfficeFeedback;
}

/* ── Movement constants ── */

const TRANSITION_MS = 1000;

const WAITING_LEFT: Record<AgentName, string> = {
  CODER:    '7%',
  PLANNER:  '12.5%',
  REVIEWER: '18%',
};

const DESK_LEFT: Record<AgentName, string> = {
  CODER:    '37.5%',
  REVIEWER: '62.5%',
  PLANNER:  '87.5%',
};

function getAgentLeft(agent: AgentVisualState): string {
  if (agent.status === 'idle') return WAITING_LEFT[agent.name];
  return DESK_LEFT[agent.name];
}

/* ── Style constants ── */

const AGENT_COLORS: Record<AgentName, { bg: string; border: string; text: string; bubble: string }> = {
  PLANNER: { bg: 'bg-violet-500', border: 'border-violet-400', text: 'text-violet-300', bubble: 'border-violet-500/60' },
  CODER: { bg: 'bg-blue-500', border: 'border-blue-400', text: 'text-blue-300', bubble: 'border-blue-500/60' },
  REVIEWER: { bg: 'bg-amber-500', border: 'border-amber-400', text: 'text-amber-300', bubble: 'border-amber-500/60' },
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

/* ── Movement detection hook ── */

function useAgentMovement(agents: Record<AgentName, AgentVisualState>): Set<AgentName> {
  const prevLeftRef = useRef<Record<string, string>>({});
  const [movingAgents, setMovingAgents] = useState<Set<AgentName>>(new Set());

  const statusKey = Object.values(agents)
    .map((a) => `${a.name}:${a.status}`)
    .join(',');

  useEffect(() => {
    const moving = new Set<AgentName>();

    for (const agent of Object.values(agents)) {
      const newLeft = getAgentLeft(agent);
      const prevLeft = prevLeftRef.current[agent.name];

      if (prevLeft !== undefined && prevLeft !== newLeft) {
        moving.add(agent.name);
      }
      prevLeftRef.current[agent.name] = newLeft;
    }

    if (moving.size > 0) {
      setMovingAgents(moving);
      const timer = setTimeout(() => setMovingAgents(new Set()), TRANSITION_MS);
      return () => clearTimeout(timer);
    }
  }, [statusKey]); // eslint-disable-line react-hooks/exhaustive-deps

  return movingAgents;
}

/* ── Feedback sub-components ── */

/** AC1: Enhanced speech bubble with colored border and typing dots */
function SpeechBubble({ text, agentName }: { text: string; agentName: AgentName }) {
  const colors = AGENT_COLORS[agentName];
  return (
    <div className="absolute -top-9 left-1/2 whitespace-nowrap z-10 speech-bubble-appear">
      <div className={`relative bg-neutral-900/95 border ${colors.bubble} rounded-lg px-2 py-1 shadow-lg`}>
        <div className="flex items-center gap-1.5">
          {/* Typing indicator dots */}
          <span className="flex gap-[2px]">
            <span className="w-[3px] h-[3px] rounded-full bg-current opacity-60 typing-dot" style={{ animationDelay: '0s' }} />
            <span className="w-[3px] h-[3px] rounded-full bg-current opacity-60 typing-dot" style={{ animationDelay: '0.15s' }} />
            <span className="w-[3px] h-[3px] rounded-full bg-current opacity-60 typing-dot" style={{ animationDelay: '0.3s' }} />
          </span>
          <span className="text-[8px] text-neutral-200 leading-none">{text}</span>
        </div>
        {/* Speech bubble tail */}
        <div className="absolute -bottom-[5px] left-1/2 -translate-x-1/2">
          <div className="w-0 h-0 border-l-[4px] border-r-[4px] border-t-[5px] border-l-transparent border-r-transparent border-t-neutral-900/95" />
        </div>
      </div>
    </div>
  );
}

/** AC2: Confetti/sparkle effect when a task completes */
function ConfettiEffect() {
  const pieces = Array.from({ length: 28 }, (_, i) => {
    const colors = [
      'bg-yellow-400', 'bg-green-400', 'bg-blue-400',
      'bg-pink-400', 'bg-violet-400', 'bg-red-400',
      'bg-cyan-400', 'bg-orange-400',
    ];
    return {
      id: i,
      color: colors[i % colors.length],
      left: `${Math.round((i * 3.6 + 1.5) % 98 + 1)}%`,
      delay: `${(i * 0.1).toFixed(1)}s`,
      duration: `${(2.2 + (i % 5) * 0.3).toFixed(1)}s`,
      width: i % 3 === 0 ? 7 : i % 3 === 1 ? 5 : 4,
      height: i % 4 === 0 ? 4 : i % 4 === 1 ? 7 : 5,
    };
  });

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-50">
      {pieces.map((p) => (
        <div
          key={p.id}
          className={`absolute ${p.color} rounded-sm confetti-piece`}
          style={{
            left: p.left,
            top: '-8px',
            width: `${p.width}px`,
            height: `${p.height}px`,
            animationDelay: p.delay,
            animationDuration: p.duration,
          }}
        />
      ))}
      {/* Sparkle flash overlay */}
      <div className="absolute inset-0 bg-white/5 confetti-flash" />
    </div>
  );
}

/** AC3 & AC4: Review verdict icon (green check or red X) */
function ReviewVerdictIcon({ verdict }: { verdict: 'APPROVED' | 'REQUEST_CHANGES' }) {
  const isApproved = verdict === 'APPROVED';
  return (
    <div className="absolute -top-10 left-1/2 z-20 verdict-appear">
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center shadow-lg ${
          isApproved
            ? 'bg-green-500 shadow-green-500/40'
            : 'bg-red-500 shadow-red-500/40'
        }`}
      >
        <span className="text-white text-xs font-bold">
          {isApproved ? '\u2713' : '\u2717'}
        </span>
      </div>
    </div>
  );
}

/** AC5: Floating PR notification with GitHub icon */
function PRNotification({ prNumber }: { prNumber: number }) {
  return (
    <div className="absolute top-12 right-3 z-40 pr-notification-slide">
      <div className="flex items-center gap-2 bg-neutral-800/95 border border-neutral-600 rounded-lg px-3 py-2 shadow-xl">
        {/* GitHub icon */}
        <svg className="w-4 h-4 text-neutral-300" viewBox="0 0 16 16" fill="currentColor">
          <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
        </svg>
        <span className="text-sm font-semibold text-cyan-400">PR #{prNumber}</span>
        <span className="text-[9px] text-neutral-500">created</span>
      </div>
    </div>
  );
}

/** AC6: Enhanced review cycle badge showing current/max */
function ReviewCycleBadge({ current, max }: { current: number; max: number }) {
  return (
    <div className="absolute -top-2 -left-3 z-10">
      <div className="px-1.5 h-[18px] rounded-full bg-orange-500 border border-orange-400 flex items-center justify-center shadow-md">
        <span className="text-[7px] font-bold text-white leading-none whitespace-nowrap">
          {current}/{max}
        </span>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function AgentCharacter({
  agent,
  isMoving = false,
  reviewVerdict = null,
  reviewCycleDisplay = null,
}: {
  agent: AgentVisualState;
  isMoving?: boolean;
  reviewVerdict?: OfficeFeedback['reviewVerdict'];
  reviewCycleDisplay?: OfficeFeedback['reviewCycleDisplay'];
}) {
  const colors = AGENT_COLORS[agent.name];
  const showVerdict = agent.name === 'REVIEWER' && reviewVerdict;
  const showBubble = agent.activity && !isMoving && !showVerdict;
  const showReviewCycle = agent.name === 'REVIEWER' && reviewCycleDisplay && agent.status === 'working';

  const avatarName = agent.name.toLowerCase() as AgentType;
  let animState: AnimationState = 'idle';
  if (isMoving || agent.status === 'walking') animState = 'walking';
  else if (agent.status === 'working') animState = 'working';

  return (
    <div className="flex flex-col items-center gap-0.5">
      <div className="relative">
        {/* Review verdict icon (takes precedence over speech bubble) */}
        {showVerdict && <ReviewVerdictIcon verdict={reviewVerdict!.type} />}

        {/* Speech bubble */}
        {showBubble && <SpeechBubble text={agent.activity!} agentName={agent.name} />}

        {/* Review cycle badge */}
        {showReviewCycle && (
          <ReviewCycleBadge current={reviewCycleDisplay!.current} max={reviewCycleDisplay!.max} />
        )}

        <div className="relative">
          <AgentAvatar name={avatarName} state={animState} size={32} />
          {/* Status dot */}
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
        <AgentAvatar
          name="komodo"
          state={phase === 'idle' ? 'idle' : 'working'}
          size={44}
        />
        <span className="text-[10px] font-bold text-emerald-300 mt-0.5">KOMODO</span>
      </div>
    </div>
  );
}

function CoderDesk() {
  return (
    <div className="flex flex-col items-center gap-2">
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

      {/* Chair */}
      <div className="w-10 h-4 rounded-b bg-neutral-700/50 border border-neutral-600/40" />
    </div>
  );
}

function ReviewerDesk() {
  return (
    <div className="flex flex-col items-center gap-2">
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

        {/* Magnifying glass */}
        <div className="relative w-8 h-10">
          <div className="w-7 h-7 rounded-full border-[3px] border-amber-400/70" />
          <div className="absolute bottom-0 right-0 w-[3px] h-4 bg-amber-600/70 rounded-full rotate-[40deg] origin-top" />
        </div>
      </div>

      {/* Chair */}
      <div className="w-10 h-4 rounded-b bg-neutral-700/50 border border-neutral-600/40" />
    </div>
  );
}

/** AC7: Dynamic task board with mini post-its reflecting sprint progress */
function TaskBoard({ sprintProgress, phase }: {
  sprintProgress: { completed: number; total: number };
  phase: Phase;
}) {
  const total = Math.max(sprintProgress.total, 1);
  const displayCount = Math.min(total, 6);

  const phasePostIt: Record<Phase, string> = {
    idle: 'bg-yellow-300',
    planning: 'bg-violet-300',
    coding: 'bg-blue-300',
    reviewing: 'bg-amber-300',
    merging: 'bg-green-300',
  };

  const tasks = Array.from({ length: displayCount }, (_, i) => {
    if (i < sprintProgress.completed) return 'completed' as const;
    if (i === sprintProgress.completed && phase !== 'idle') return 'current' as const;
    return 'pending' as const;
  });

  return (
    <div className="flex flex-col items-center gap-2">
      <span className="text-[10px] font-bold text-violet-400 uppercase tracking-wider">
        Planner
      </span>

      {/* Board */}
      <div className="w-[140px] h-[90px] rounded-sm bg-neutral-800/80 border-2 border-neutral-600/60 p-2">
        <div className="text-[7px] text-neutral-500 mb-1.5 text-center font-semibold uppercase tracking-wide">
          Sprint {sprintProgress.completed}/{total}
        </div>
        <div className="grid grid-cols-3 gap-1.5">
          {tasks.map((status, i) => (
            <div
              key={i}
              className={`aspect-square rounded-[1px] shadow-sm flex items-center justify-center ${
                status === 'completed'
                  ? 'bg-green-300'
                  : status === 'current'
                    ? `${phasePostIt[phase]} postit-pulse`
                    : 'bg-neutral-600/40'
              }`}
            >
              {status === 'completed' ? (
                <span className="text-[8px] text-green-800 font-bold">{'\u2713'}</span>
              ) : status === 'current' ? (
                <span className="text-[7px] text-neutral-800 font-bold">{'\u25B8'}</span>
              ) : (
                <div className="w-3/4 space-y-[2px]">
                  <div className="h-[1px] bg-black/10" />
                  <div className="h-[1px] bg-black/10 w-2/3" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function WaitingRoom() {
  return (
    <div className="flex flex-col items-center gap-2">
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
    </div>
  );
}

/* ── Agent movement layer ── */

function AgentLayer({
  agents,
  movingAgents,
  feedback,
}: {
  agents: Record<AgentName, AgentVisualState>;
  movingAgents: Set<AgentName>;
  feedback?: OfficeFeedback;
}) {
  return (
    <div className="relative w-full h-16 mt-1">
      {Object.values(agents).map((agent) => {
        const left = getAgentLeft(agent);
        const isMoving = movingAgents.has(agent.name);

        return (
          <div
            key={agent.name}
            className="absolute top-0 -translate-x-1/2"
            style={{
              left,
              transition: `left ${TRANSITION_MS}ms ease-in-out`,
            }}
          >
            <AgentCharacter
              agent={agent}
              isMoving={isMoving}
              reviewVerdict={feedback?.reviewVerdict}
              reviewCycleDisplay={feedback?.reviewCycleDisplay}
            />
          </div>
        );
      })}
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

export function OfficeScene({ agents, phase, feedback }: OfficeSceneProps) {
  const movingAgents = useAgentMovement(agents);

  return (
    <div
      className="relative w-full rounded-lg border border-neutral-800 overflow-hidden"
      style={{
        background: '#16181d',
        backgroundImage: [
          'linear-gradient(rgba(255,255,255,0.012) 1px, transparent 1px)',
          'linear-gradient(90deg, rgba(255,255,255,0.012) 1px, transparent 1px)',
        ].join(', '),
        backgroundSize: '20px 20px',
      }}
    >
      {/* AC2: Confetti overlay on task completion */}
      {feedback?.showConfetti && <ConfettiEffect />}

      {/* AC5: PR notification */}
      {feedback?.prNotification && <PRNotification prNumber={feedback.prNotification.number} />}

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
        {/* Row 1: Boss Komodo desk */}
        <BossZone phase={phase} />

        {/* Wall/Divider between boss and work floor */}
        <div className="w-full max-w-2xl flex items-center gap-3">
          <div className="flex-1 border-t border-dashed border-neutral-800" />
          <PlantPot />
          <div className="flex-1 border-t border-dashed border-neutral-800" />
          <PlantPot />
          <div className="flex-1 border-t border-dashed border-neutral-800" />
        </div>

        {/* Row 2: Work floor — zones grid + agent movement layer */}
        <div className="w-full max-w-3xl">
          <div className="grid grid-cols-4 gap-4 lg:gap-8 w-full">
            <div className="flex justify-center">
              <WaitingRoom />
            </div>
            <div className="flex justify-center">
              <CoderDesk />
            </div>
            <div className="flex justify-center">
              <ReviewerDesk />
            </div>
            <div className="flex justify-center">
              <TaskBoard
                sprintProgress={feedback?.sprintProgress ?? { completed: 0, total: 0 }}
                phase={phase}
              />
            </div>
          </div>

          {/* Agents — positioned absolutely, CSS transition on left */}
          <AgentLayer agents={agents} movingAgents={movingAgents} feedback={feedback} />
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
