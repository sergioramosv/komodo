'use client';

/* ── Types ── */

export type AgentType = 'komodo' | 'planner' | 'coder' | 'reviewer';
export type AnimationState = 'idle' | 'walking' | 'working';

interface AgentAvatarProps {
  name: AgentType;
  state?: AnimationState;
  size?: number;
  className?: string;
}

/* ── Sprite sub-components ── */

function KomodoSprite() {
  return (
    <g>
      {/* Head spikes */}
      <polygon points="16,7 18,1 20,7" fill="#34d399" />
      <polygon points="22,5 24,0 26,5" fill="#34d399" />
      <polygon points="28,7 30,1 32,7" fill="#34d399" />

      {/* Head */}
      <circle cx="24" cy="17" r="12" fill="#059669" />

      {/* Eyes */}
      <g className="agent-eyes">
        <ellipse cx="19" cy="15" rx="2.5" ry="3" fill="white" />
        <ellipse cx="29" cy="15" rx="2.5" ry="3" fill="white" />
        <circle cx="20" cy="15" r="1.5" fill="#111" />
        <circle cx="30" cy="15" r="1.5" fill="#111" />
      </g>

      {/* Mouth — confident smirk */}
      <path
        d="M20 22 Q24 25 28 22"
        stroke="#065f46"
        strokeWidth="1.5"
        fill="none"
        strokeLinecap="round"
      />

      {/* Body — suit */}
      <rect x="14" y="30" width="20" height="20" rx="4" fill="#374151" />
      {/* Lapels */}
      <path d="M24 30 L19 37" stroke="#4b5563" strokeWidth="1.5" fill="none" />
      <path d="M24 30 L29 37" stroke="#4b5563" strokeWidth="1.5" fill="none" />
      {/* Tie */}
      <polygon points="24,30 22,35 24,40 26,35" fill="#ef4444" />

      {/* Arms */}
      <g className="agent-arms">
        <rect x="8" y="32" width="6" height="13" rx="3" fill="#059669" />
        <rect x="34" y="32" width="6" height="13" rx="3" fill="#059669" />
      </g>

      {/* Legs */}
      <rect x="16" y="49" width="6" height="9" rx="3" fill="#059669" />
      <rect x="26" y="49" width="6" height="9" rx="3" fill="#059669" />
      {/* Shoes */}
      <rect x="15" y="55" width="8" height="5" rx="2.5" fill="#1f2937" />
      <rect x="25" y="55" width="8" height="5" rx="2.5" fill="#1f2937" />
    </g>
  );
}

function PlannerSprite() {
  return (
    <g>
      {/* Hair */}
      <ellipse cx="24" cy="9" rx="13" ry="6" fill="#7c3aed" />

      {/* Head */}
      <circle cx="24" cy="17" r="11" fill="#fcd9b6" />

      {/* Eyes */}
      <g className="agent-eyes">
        <circle cx="20" cy="15" r="2" fill="white" />
        <circle cx="28" cy="15" r="2" fill="white" />
        <circle cx="20.5" cy="15.5" r="1" fill="#111" />
        <circle cx="28.5" cy="15.5" r="1" fill="#111" />
      </g>

      {/* Smile */}
      <path
        d="M21 22 Q24 25 27 22"
        stroke="#c68642"
        strokeWidth="1"
        fill="none"
        strokeLinecap="round"
      />

      {/* Body */}
      <rect x="14" y="30" width="20" height="20" rx="4" fill="#8b5cf6" />
      {/* Collar */}
      <path d="M19 30 L24 34 L29 30" stroke="#a78bfa" strokeWidth="1.5" fill="none" />

      {/* Arms */}
      <g className="agent-arms">
        <rect x="8" y="32" width="6" height="13" rx="3" fill="#fcd9b6" />
        <rect x="34" y="32" width="6" height="13" rx="3" fill="#fcd9b6" />
      </g>

      {/* Clipboard in left hand */}
      <g className="agent-accessory">
        <rect x="3" y="34" width="9" height="12" rx="1" fill="#e4e4e7" />
        <rect x="5" y="33" width="5" height="2.5" rx="1" fill="#a1a1aa" />
        <line x1="5" y1="37" x2="10" y2="37" stroke="#a1a1aa" strokeWidth="0.8" />
        <line x1="5" y1="39.5" x2="10" y2="39.5" stroke="#a1a1aa" strokeWidth="0.8" />
        <line x1="5" y1="42" x2="8" y2="42" stroke="#a1a1aa" strokeWidth="0.8" />
      </g>

      {/* Legs */}
      <rect x="16" y="49" width="6" height="9" rx="3" fill="#fcd9b6" />
      <rect x="26" y="49" width="6" height="9" rx="3" fill="#fcd9b6" />
      {/* Shoes */}
      <rect x="15" y="55" width="8" height="5" rx="2.5" fill="#7c3aed" />
      <rect x="25" y="55" width="8" height="5" rx="2.5" fill="#7c3aed" />
    </g>
  );
}

function CoderSprite() {
  return (
    <g>
      {/* Hoodie hood behind head */}
      <path d="M12 25 Q12 4 24 4 Q36 4 36 25" fill="#3b82f6" />

      {/* Head */}
      <circle cx="24" cy="17" r="10" fill="#fcd9b6" />

      {/* Eyes */}
      <g className="agent-eyes">
        <circle cx="20" cy="15" r="2" fill="white" />
        <circle cx="28" cy="15" r="2" fill="white" />
        <circle cx="20.5" cy="15.5" r="1" fill="#111" />
        <circle cx="28.5" cy="15.5" r="1" fill="#111" />
      </g>

      {/* Mouth — focused flat line */}
      <line
        x1="21" y1="22" x2="27" y2="22"
        stroke="#c68642"
        strokeWidth="1"
        strokeLinecap="round"
      />

      {/* Body — hoodie */}
      <rect x="12" y="28" width="24" height="22" rx="4" fill="#3b82f6" />
      {/* Zipper */}
      <line x1="24" y1="28" x2="24" y2="50" stroke="#2563eb" strokeWidth="1" />
      {/* Hoodie pocket */}
      <rect x="17" y="38" width="14" height="6" rx="2" fill="#2563eb" />
      {/* Hood strings */}
      <line x1="20" y1="28" x2="19" y2="32" stroke="#60a5fa" strokeWidth="1" />
      <line x1="28" y1="28" x2="29" y2="32" stroke="#60a5fa" strokeWidth="1" />

      {/* Arms — hoodie sleeves */}
      <g className="agent-arms">
        <rect x="6" y="30" width="6" height="14" rx="3" fill="#3b82f6" />
        <rect x="36" y="30" width="6" height="14" rx="3" fill="#3b82f6" />
      </g>

      {/* Legs — dark jeans */}
      <rect x="15" y="49" width="7" height="9" rx="3" fill="#1e3a5f" />
      <rect x="26" y="49" width="7" height="9" rx="3" fill="#1e3a5f" />
      {/* Shoes */}
      <rect x="14" y="55" width="9" height="5" rx="2.5" fill="#1e40af" />
      <rect x="25" y="55" width="9" height="5" rx="2.5" fill="#1e40af" />
    </g>
  );
}

function ReviewerSprite() {
  return (
    <g>
      {/* Hair — slicked back */}
      <path d="M13 15 Q13 5 24 5 Q35 5 35 15" fill="#78350f" />

      {/* Head */}
      <circle cx="24" cy="17" r="11" fill="#fcd9b6" />

      {/* Glasses frame */}
      <circle cx="18" cy="16" r="5" fill="none" stroke="#f59e0b" strokeWidth="2" />
      <circle cx="30" cy="16" r="5" fill="none" stroke="#f59e0b" strokeWidth="2" />
      {/* Bridge */}
      <line x1="23" y1="16" x2="25" y2="16" stroke="#f59e0b" strokeWidth="1.5" />
      {/* Temple arms */}
      <line x1="13" y1="15" x2="10" y2="13" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" />
      <line x1="35" y1="15" x2="38" y2="13" stroke="#f59e0b" strokeWidth="1.5" strokeLinecap="round" />
      {/* Lens glare */}
      <circle cx="16" cy="14" r="1.5" fill="white" opacity="0.3" />
      <circle cx="28" cy="14" r="1.5" fill="white" opacity="0.3" />

      {/* Eyes behind glasses */}
      <g className="agent-eyes">
        <circle cx="18" cy="16.5" r="1.5" fill="#111" />
        <circle cx="30" cy="16.5" r="1.5" fill="#111" />
      </g>

      {/* Mouth — analytical */}
      <path
        d="M22 23 Q24 21 26 23"
        stroke="#c68642"
        strokeWidth="1"
        fill="none"
        strokeLinecap="round"
      />

      {/* Body */}
      <rect x="14" y="30" width="20" height="20" rx="4" fill="#f59e0b" />
      {/* Vest */}
      <rect x="17" y="30" width="14" height="16" rx="2" fill="#d97706" />

      {/* Arms */}
      <g className="agent-arms">
        <rect x="8" y="32" width="6" height="13" rx="3" fill="#fcd9b6" />
        <rect x="34" y="32" width="6" height="13" rx="3" fill="#fcd9b6" />
      </g>

      {/* Magnifying glass in right hand */}
      <g className="agent-accessory">
        <circle cx="39" cy="38" r="3.5" fill="none" stroke="#92400e" strokeWidth="1.5" />
        <circle cx="39" cy="38" r="2" fill="white" opacity="0.15" />
        <line
          x1="42" y1="41" x2="44" y2="44"
          stroke="#92400e"
          strokeWidth="2"
          strokeLinecap="round"
        />
      </g>

      {/* Legs */}
      <rect x="16" y="49" width="6" height="9" rx="3" fill="#92400e" />
      <rect x="26" y="49" width="6" height="9" rx="3" fill="#92400e" />
      {/* Shoes */}
      <rect x="15" y="55" width="8" height="5" rx="2.5" fill="#78350f" />
      <rect x="25" y="55" width="8" height="5" rx="2.5" fill="#78350f" />
    </g>
  );
}

/* ── Main component ── */

export function AgentAvatar({
  name,
  state = 'idle',
  size = 48,
  className = '',
}: AgentAvatarProps) {
  const height = Math.round(size * 1.33);

  return (
    <div
      className={`agent-avatar agent-${state} inline-flex ${className}`}
      style={{ width: size, height }}
    >
      <svg viewBox="0 0 48 64" width={size} height={height}>
        {name === 'komodo' && <KomodoSprite />}
        {name === 'planner' && <PlannerSprite />}
        {name === 'coder' && <CoderSprite />}
        {name === 'reviewer' && <ReviewerSprite />}
      </svg>
    </div>
  );
}
