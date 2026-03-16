'use client';

import { useRef, useEffect } from 'react';
import type { AgentName } from '@/lib/types';
import type { AgentVisualState } from '@/hooks/useAgentStates';
import { PixelAgent } from './pixel-agent';
import { AGENT_DESKS, AGENT_IDLE_ZONES } from './office-map';

const AGENT_NAMES: AgentName[] = ['PLANNER', 'ARCHITECT', 'CODER', 'TESTER', 'SECURITY', 'REVIEWER'];

export function usePixelAgents(agents: Record<AgentName, AgentVisualState>) {
  const agentsMapRef = useRef<Map<AgentName, PixelAgent> | null>(null);
  const prevStatusRef = useRef<Record<string, string>>({});

  // Initialize agents once
  if (!agentsMapRef.current) {
    const map = new Map<AgentName, PixelAgent>();
    for (const name of AGENT_NAMES) {
      const idlePos = AGENT_IDLE_ZONES[name];
      map.set(name, new PixelAgent(name, idlePos));
    }
    agentsMapRef.current = map;
  }

  // React to status changes
  useEffect(() => {
    const map = agentsMapRef.current;
    if (!map) return;

    for (const name of AGENT_NAMES) {
      const agent = map.get(name);
      if (!agent) continue;

      const status = agents[name]?.status ?? 'idle';
      const prevStatus = prevStatusRef.current[name];

      // Always sync status and activity so speech bubbles stay fresh
      agent.status = status;
      agent.activity = agents[name]?.activity ?? null;

      if (status === prevStatus) continue;
      prevStatusRef.current[name] = status;

      if (status === 'working' || status === 'walking') {
        // Walk to desk, then start typing
        const desk = AGENT_DESKS[name];
        if (agent.state !== 'WALK' || agent.tileX !== desk.x || agent.tileY !== desk.y) {
          agent.setTarget(desk, () => {
            agent.state = 'TYPE';
            agent.frame = 0;
          });
        }
      } else if (status === 'idle') {
        // Walk to idle zone
        const idleZone = AGENT_IDLE_ZONES[name];
        agent.setTarget(idleZone, () => {
          agent.state = 'IDLE';
          agent.frame = 0;
        });
      } else if (status === 'done') {
        // Stay at desk but stop typing
        agent.state = 'SIT';
        agent.frame = 0;
      }
    }
  }, [agents]);

  return agentsMapRef;
}
