'use client';

import { useRef, useEffect, useCallback } from 'react';
import type { AgentName } from '@/lib/types';
import type { AgentVisualState } from '@/hooks/useAgentStates';
import { usePixelAgents } from './use-pixel-agents';
import { CANVAS_WIDTH, CANVAS_HEIGHT } from './office-map';
import { Camera } from './camera';
import { Renderer } from './renderer';
import { InputHandler } from './input';

interface PixelOfficeCanvasProps {
  agents: Record<AgentName, AgentVisualState>;
  onAgentSelect?: (name: AgentName | null) => void;
}

export function PixelOfficeCanvas({ agents, onAgentSelect }: PixelOfficeCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const agentsMapRef = usePixelAgents(agents);
  const lastTimeRef = useRef<number>(0);
  const rafRef = useRef<number>(0);

  const cameraRef = useRef<Camera | null>(null);
  const rendererRef = useRef<Renderer | null>(null);
  const inputRef = useRef<InputHandler | null>(null);
  const selectedAgentRef = useRef<AgentName | null>(null);

  const onAgentSelectRef = useRef(onAgentSelect);
  onAgentSelectRef.current = onAgentSelect;

  const handleAgentClick = useCallback((name: AgentName | null) => {
    selectedAgentRef.current = name;
    rendererRef.current?.setSelectedAgent(name);

    // Follow mode: center on selected agent
    if (name && agentsMapRef.current) {
      const agent = agentsMapRef.current.get(name);
      if (agent && cameraRef.current) {
        cameraRef.current.followWorld(agent.pixelX, agent.pixelY);
      }
    } else {
      cameraRef.current?.stopFollow();
    }

    onAgentSelectRef.current?.(name);
  }, [agentsMapRef]);

  const handleAgentHover = useCallback((name: AgentName | null) => {
    rendererRef.current?.setHoveredAgent(name);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Initialize Camera, Renderer, InputHandler
    const camera = new Camera(CANVAS_WIDTH, CANVAS_HEIGHT);
    const renderer = new Renderer();
    const input = new InputHandler(
      camera,
      () => agentsMapRef.current ?? new Map(),
      {
        onAgentClick: handleAgentClick,
        onAgentHover: handleAgentHover,
      },
    );

    cameraRef.current = camera;
    rendererRef.current = renderer;
    inputRef.current = input;

    input.mount(canvas);

    const loop = (time: number) => {
      const deltaMs = lastTimeRef.current ? time - lastTimeRef.current : 16;
      lastTimeRef.current = time;
      const deltaSec = deltaMs / 1000;

      // Update agents
      const map = agentsMapRef.current;
      if (map) {
        for (const agent of map.values()) {
          agent.update(deltaMs);
        }

        // Update follow mode target if following
        if (selectedAgentRef.current && camera.isFollowing) {
          const followAgent = map.get(selectedAgentRef.current);
          if (followAgent) {
            camera.followWorld(followAgent.pixelX, followAgent.pixelY);
          }
        }
      }

      // Update camera
      camera.update(deltaSec);

      // Render
      renderer.render(ctx, camera, map ?? new Map());

      rafRef.current = requestAnimationFrame(loop);
    };

    rafRef.current = requestAnimationFrame(loop);

    return () => {
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
      }
      input.unmount();
    };
  }, [agentsMapRef, handleAgentClick, handleAgentHover]);

  return (
    <div className="flex items-center justify-center w-full h-full min-h-[500px] bg-neutral-950 p-4">
      <canvas
        ref={canvasRef}
        width={CANVAS_WIDTH}
        height={CANVAS_HEIGHT}
        className="border border-neutral-800 rounded-lg"
        style={{ imageRendering: 'pixelated', cursor: 'grab' }}
      />
    </div>
  );
}
