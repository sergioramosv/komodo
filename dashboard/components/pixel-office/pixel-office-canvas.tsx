'use client';

import { useRef, useEffect } from 'react';
import type { AgentName } from '@/lib/types';
import type { AgentVisualState } from '@/hooks/useAgentStates';
import { usePixelAgents } from './use-pixel-agents';
import {
  CANVAS_WIDTH,
  CANVAS_HEIGHT,
  GRID_COLS,
  GRID_ROWS,
  TILE_SIZE,
  TILE_MAP,
} from './office-map';
import type { TileType } from './office-map';

const TILE_COLORS: Record<TileType, string> = {
  floor: '#2d2d3d',
  wall: '#1a1a2e',
  desk: '#5c4033',
  carpet: '#3d2d4d',
  coffee: '#4a3728',
  whiteboard: '#e8e8e8',
};

const FLOOR_ALT = '#32324a';

interface PixelOfficeCanvasProps {
  agents: Record<AgentName, AgentVisualState>;
}

export function PixelOfficeCanvas({ agents }: PixelOfficeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const agentsMapRef = usePixelAgents(agents);
  const lastTimeRef = useRef<number>(0);
  const rafRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Disable image smoothing for crisp pixels
    ctx.imageSmoothingEnabled = false;

    const loop = (time: number) => {
      const deltaMs = lastTimeRef.current ? time - lastTimeRef.current : 16;
      lastTimeRef.current = time;

      // Update all agents
      const map = agentsMapRef.current;
      if (map) {
        for (const agent of map.values()) {
          agent.update(deltaMs);
        }
      }

      // Clear
      ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

      // Draw tiles
      for (let y = 0; y < GRID_ROWS; y++) {
        for (let x = 0; x < GRID_COLS; x++) {
          const tileType = TILE_MAP[y][x];
          if (tileType === 'floor') {
            // Checkerboard pattern
            ctx.fillStyle = (x + y) % 2 === 0 ? TILE_COLORS.floor : FLOOR_ALT;
          } else {
            ctx.fillStyle = TILE_COLORS[tileType];
          }
          ctx.fillRect(x * TILE_SIZE, y * TILE_SIZE, TILE_SIZE, TILE_SIZE);

          // Desk details
          if (tileType === 'desk') {
            // Monitor
            ctx.fillStyle = '#1a1a2e';
            ctx.fillRect(x * TILE_SIZE + 4, y * TILE_SIZE + 3, 12, 8);
            // Screen glow
            ctx.fillStyle = '#4ade80';
            ctx.fillRect(x * TILE_SIZE + 5, y * TILE_SIZE + 4, 10, 6);
          }

          // Whiteboard details
          if (tileType === 'whiteboard') {
            ctx.fillStyle = '#374151';
            ctx.fillRect(x * TILE_SIZE + 2, y * TILE_SIZE + 4, 6, 1);
            ctx.fillRect(x * TILE_SIZE + 2, y * TILE_SIZE + 8, 10, 1);
            ctx.fillRect(x * TILE_SIZE + 2, y * TILE_SIZE + 12, 8, 1);
          }

          // Coffee machine details
          if (tileType === 'coffee') {
            ctx.fillStyle = '#78350f';
            ctx.fillRect(x * TILE_SIZE + 4, y * TILE_SIZE + 2, 12, 14);
            ctx.fillStyle = '#fbbf24';
            ctx.fillRect(x * TILE_SIZE + 6, y * TILE_SIZE + 5, 2, 2);
          }
        }
      }

      // Grid lines (subtle)
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

      // Draw agents (sorted by Y for correct overlap)
      if (map) {
        const sortedAgents = [...map.values()].sort((a, b) => a.pixelY - b.pixelY);
        for (const agent of sortedAgents) {
          agent.drawSelf(ctx);
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
    };
  }, [agentsMapRef]);

  return (
    <div className="flex items-center justify-center w-full h-full min-h-[500px] bg-neutral-950 p-4">
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="border border-neutral-800 rounded-lg"
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  );
}
