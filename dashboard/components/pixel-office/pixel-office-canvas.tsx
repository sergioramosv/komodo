'use client';

import { useRef, useEffect, useCallback, useState } from 'react';
import type { AgentName, CliHealth } from '@/lib/types';
import type { AgentVisualState } from '@/hooks/useAgentStates';
import { usePixelAgents } from './use-pixel-agents';
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  GRID_COLS,
  GRID_ROWS,
  TILE_SIZE,
  TILE_MAP,
  AGENT_DESKS,
} from './office-map';
import type { TileType } from './office-map';
import { drawSpeechBubble, drawTooltip } from './speech-bubble';

const TILE_COLORS: Record<TileType, string> = {
  floor: '#2d2d3d',
  wall: '#1a1a2e',
  desk: '#5c4033',
  carpet: '#3d2d4d',
  coffee: '#4a3728',
  whiteboard: '#e8e8e8',
};

const FLOOR_ALT = '#32324a';

const STATUS_BADGE: Record<string, { bg: string; text: string }> = {
  working: { bg: 'bg-blue-500/20', text: 'text-blue-400' },
  done:    { bg: 'bg-green-500/20', text: 'text-green-400' },
  walking: { bg: 'bg-yellow-500/20', text: 'text-yellow-400' },
  idle:    { bg: 'bg-neutral-800', text: 'text-neutral-400' },
};

interface PixelOfficeCanvasProps {
  agents: Record<AgentName, AgentVisualState>;
  cliHealth?: CliHealth[];
}

export function PixelOfficeCanvas({ agents, cliHealth }: PixelOfficeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const agentsMapRef = usePixelAgents(agents);
  const lastTimeRef = useRef<number>(0);
  const rafRef = useRef<number>(0);

  const [selectedAgent, setSelectedAgent] = useState<AgentName | null>(null);
  const selectedAgentRef = useRef<AgentName | null>(null);
  selectedAgentRef.current = selectedAgent;

  const hoveredAgentRef = useRef<AgentName | null>(null);

  // Keep agents prop accessible in the animation loop
  const agentsPropRef = useRef(agents);
  agentsPropRef.current = agents;

  const handleCanvasClick = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_WIDTH / rect.width;
    const scaleY = CANVAS_HEIGHT / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    const map = agentsMapRef.current;
    if (!map) {
      setSelectedAgent(null);
      return;
    }

    let clicked: AgentName | null = null;
    for (const [name, agent] of map.entries()) {
      const ax = Math.round(agent.pixelX);
      const ay = Math.round(agent.pixelY);
      if (mx >= ax && mx <= ax + TILE_SIZE && my >= ay - 6 && my <= ay + TILE_SIZE) {
        clicked = name;
        break;
      }
    }
    setSelectedAgent(clicked);
  }, [agentsMapRef]);

  const handleCanvasMouseMove = useCallback((e: MouseEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const scaleX = CANVAS_WIDTH / rect.width;
    const scaleY = CANVAS_HEIGHT / rect.height;
    const mx = (e.clientX - rect.left) * scaleX;
    const my = (e.clientY - rect.top) * scaleY;

    const map = agentsMapRef.current;
    if (!map) {
      hoveredAgentRef.current = null;
      return;
    }

    let hovered: AgentName | null = null;
    for (const [name, agent] of map.entries()) {
      const ax = Math.round(agent.pixelX);
      const ay = Math.round(agent.pixelY);
      if (mx >= ax && mx <= ax + TILE_SIZE && my >= ay - 6 && my <= ay + TILE_SIZE) {
        hovered = name;
        break;
      }
    }
    hoveredAgentRef.current = hovered;
    canvas.style.cursor = hovered ? 'pointer' : 'default';
  }, [agentsMapRef]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('click', handleCanvasClick);
    canvas.addEventListener('mousemove', handleCanvasMouseMove);
    return () => {
      canvas.removeEventListener('click', handleCanvasClick);
      canvas.removeEventListener('mousemove', handleCanvasMouseMove);
    };
  }, [handleCanvasClick, handleCanvasMouseMove]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.imageSmoothingEnabled = false;

    const loop = (time: number) => {
      const deltaMs = lastTimeRef.current ? time - lastTimeRef.current : 16;
      lastTimeRef.current = time;

      const map = agentsMapRef.current;
      if (map) {
        for (const agent of map.values()) {
          agent.update(deltaMs);
        }
      }

      // Compute active agent names for monitor glow
      const activeAgentNames = new Set<AgentName>();
      if (map) {
        for (const [name, agent] of map.entries()) {
          if (agent.status === 'working' || agent.status === 'walking') {
            activeAgentNames.add(name);
          }
        }
      }

      // Clear
      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Draw tiles
      for (let y = 0; y < GRID_ROWS; y++) {
        for (let x = 0; x < GRID_COLS; x++) {
          const tileType = TILE_MAP[y][x];
          if (tileType === 'floor') {
            ctx.fillStyle = (x + y) % 2 === 0 ? TILE_COLORS.floor : FLOOR_ALT;
          } else {
            ctx.fillStyle = TILE_COLORS[tileType];
          }
          ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);

          if (tileType === 'desk') {
            ctx.fillStyle = '#1a1a2e';
            ctx.fillRect(x * TILE_SIZE + 4, y * TILE_SIZE + 3, 12, 8);
            // Active desk: cyan/blue glow; inactive: dark off
            ctx.fillStyle = isDeskActive(x, y, activeAgentNames) ? '#60a5fa' : '#111118';
            ctx.fillRect(x * TILE_SIZE + 5, y * TILE_SIZE + 4, 10, 6);
          }

          if (tileType === 'whiteboard') {
            ctx.fillStyle = '#374151';
            ctx.fillRect(x * TILE_SIZE + 2, y * TILE_SIZE + 4, 6, 1);
            ctx.fillRect(x * TILE_SIZE + 2, y * TILE_SIZE + 8, 10, 1);
            ctx.fillRect(x * TILE_SIZE + 2, y * TILE_SIZE + 12, 8, 1);
          }

          if (tileType === 'coffee') {
            ctx.fillStyle = '#78350f';
            ctx.fillRect(x * TILE_SIZE + 4, y * TILE_SIZE + 2, 12, 14);
            ctx.fillStyle = '#fbbf24';
            ctx.fillRect(x * TILE_SIZE + 6, y * TILE_SIZE + 5, 2, 2);
          }
        }
      }

      // Grid lines
      ctx.strokeStyle = 'rgba(255,255,255,0.03)';
      ctx.lineWidth = 0.5;
      for (let x = 0; x <= GRID_COLS; x++) {
        ctx.beginPath();
        ctx.moveTo(x * TILE_SIZE, 0);
        ctx.lineTo(x * TILE_SIZE, CANVAS_HEIGHT);
        ctx.stroke();
      }
      for (let y = 0; y <= GRID_ROWS; y++) {
        ctx.beginPath();
        ctx.moveTo(0, y * TILE_SIZE);
        ctx.lineTo(CANVAS_WIDTH, y * TILE_SIZE);
        ctx.stroke();
      }

      // Draw agents sorted by Y
      if (map) {
        const sortedAgents = [...map.values()].sort((a, b) => a.pixelY - b.pixelY);
        for (const agent of sortedAgents) {
          agent.drawSelf(ctx);
        }
      }

      // Overlays
      if (map) {
        const sel = selectedAgentRef.current;
        const hov = hoveredAgentRef.current;

        // Selection highlight
        if (sel) {
          const agent = map.get(sel);
          if (agent) {
            const px = Math.round(agent.pixelX);
            const py = Math.round(agent.pixelY);
            ctx.strokeStyle = '#fbbf24';
            ctx.lineWidth = 1.5;
            ctx.strokeRect(px - 2, py - 6, TILE_SIZE + 4, TILE_SIZE + 9);
          }
        }

        // Hover highlight + tooltip
        if (hov && hov !== sel) {
          const agent = map.get(hov);
          if (agent) {
            const px = Math.round(agent.pixelX);
            const py = Math.round(agent.pixelY);
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.lineWidth = 1;
            ctx.strokeRect(px - 1, py - 5, TILE_SIZE + 2, TILE_SIZE + 7);
            drawTooltip(ctx, agent.pixelX, agent.pixelY, hov, agent.status);
          }
        }

        // Speech bubbles for agents with activity text
        for (const [, agent] of map.entries()) {
          if (agent.activity) {
            drawSpeechBubble(ctx, agent.pixelX, agent.pixelY, agent.activity);
          }
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentsMapRef]);

  const selectedData = selectedAgent ? agentsPropRef.current[selectedAgent] : null;
  const selectedCliHealth = selectedData?.cli
    ? cliHealth?.find(h => h.cli === selectedData.cli)
    : null;

  return (
    <div className="relative flex w-full h-full min-h-[500px] bg-neutral-950">
      <div className="flex flex-1 items-center justify-center p-4">
        <canvas
          ref={canvasRef}
          width={CANVAS_WIDTH}
          height={CANVAS_HEIGHT}
          className="border border-neutral-800 rounded-lg"
          style={{ imageRendering: 'pixelated' }}
        />
      </div>

      {/* Agent detail side panel */}
      {selectedAgent && selectedData && (
        <div className="absolute right-0 top-0 bottom-0 w-56 bg-neutral-900 border-l border-neutral-800 overflow-y-auto flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b border-neutral-800">
            <span className="text-sm font-semibold text-white">{selectedAgent}</span>
            <button
              onClick={() => setSelectedAgent(null)}
              className="text-neutral-500 hover:text-white transition-colors text-lg leading-none"
            >
              ×
            </button>
          </div>

          <div className="px-3 py-3 space-y-3 text-xs">
            <div>
              <p className="text-neutral-500 mb-1">Status</p>
              <span className={`inline-block rounded px-2 py-0.5 font-medium capitalize ${STATUS_BADGE[selectedData.status]?.bg ?? 'bg-neutral-800'} ${STATUS_BADGE[selectedData.status]?.text ?? 'text-neutral-400'}`}>
                {selectedData.status}
              </span>
            </div>

            {selectedData.activity && (
              <div>
                <p className="text-neutral-500 mb-1">Activity</p>
                <p className="text-neutral-300 break-words">{selectedData.activity}</p>
              </div>
            )}

            {selectedData.currentTask && (
              <div>
                <p className="text-neutral-500 mb-1">Current Task</p>
                <p className="text-neutral-300 break-words">{selectedData.currentTask}</p>
              </div>
            )}

            {selectedData.cli && (
              <div>
                <p className="text-neutral-500 mb-1">CLI</p>
                <p className="text-neutral-300 font-mono">{selectedData.cli}</p>
              </div>
            )}

            {selectedCliHealth && (
              <div>
                <p className="text-neutral-500 mb-1">CLI Health</p>
                <span className={`inline-block rounded px-2 py-0.5 font-medium ${
                  selectedCliHealth.status === 'available' ? 'bg-green-500/20 text-green-400'
                  : selectedCliHealth.status === 'rate-limited' ? 'bg-yellow-500/20 text-yellow-400'
                  : 'bg-red-500/20 text-red-400'
                }`}>
                  {selectedCliHealth.status}
                </span>
                {selectedCliHealth.cooldownMinutes != null && (
                  <p className="mt-1 text-neutral-500">Cooldown: {selectedCliHealth.cooldownMinutes}m</p>
                )}
              </div>
            )}

            {selectedData.startedAt && (
              <div>
                <p className="text-neutral-500 mb-1">Started</p>
                <p className="text-neutral-400">{new Date(selectedData.startedAt).toLocaleTimeString()}</p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function isDeskActive(tileX: number, tileY: number, activeAgentNames: Set<AgentName>): boolean {
  for (const name of activeAgentNames) {
    const desk = AGENT_DESKS[name];
    if (desk && desk.x === tileX && desk.y === tileY) return true;
  }
  return false;
}
