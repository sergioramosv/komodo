"use client";

import React from 'react';
import { Box, Cylinder, Plane, Sphere } from '@react-three/drei';
import { AnimatedWhiteboard } from './AnimatedWhiteboard';
import { KomodoBoss } from './KomodoBoss';
import { Agent3D } from './Agent3D';

interface Environment3DProps {
  agents: any;
}

// Helpers for simple modular desk
function Desk({ position, rotation = [0, 0, 0] }: { position: [number, number, number], rotation?: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      <Box args={[2, 0.1, 1]} position={[0, 0.8, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#A0522D" />
      </Box>
      <Box args={[0.1, 0.8, 0.8]} position={[-0.9, 0.4, 0]} castShadow receiveShadow>
         <meshStandardMaterial color="#8B4513" />
      </Box>
      <Box args={[0.1, 0.8, 0.8]} position={[0.9, 0.4, 0]} castShadow receiveShadow>
         <meshStandardMaterial color="#8B4513" />
      </Box>
      {/* Computer */}
      <Box args={[0.8, 0.6, 0.1]} position={[0, 1.2, 0.1]} castShadow receiveShadow>
        <meshStandardMaterial color="#222" />
      </Box>
      {/* Screen (Black when off, but Agent3D light will illuminate it when they work) */}
      <Box args={[0.7, 0.5, 0.05]} position={[0, 1.2, 0.06]} receiveShadow>
        <meshStandardMaterial color="#111" />
      </Box>
    </group>
  );
}

function WaitChair({ position, rotation }: { position: [number, number, number], rotation: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      <Cylinder args={[0.4, 0.4, 0.1]} position={[0, 0.4, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#ff7700" />
      </Cylinder>
      <Cylinder args={[0.05, 0.05, 0.4]} position={[0, 0.2, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#999" />
      </Cylinder>
    </group>
  );
}

export function Environment3D({ agents }: Environment3DProps) {
  // Extract states. Fallbacks if agent disappears from DB
  const plannerState = agents?.PLANNER?.status || 'idle';
  const coderState = agents?.CODER?.status || 'idle';
  const reviewerState = agents?.REVIEWER?.status || 'idle';

  return (
    <group>
      {/* Piso */}
      <Plane args={[30, 30]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, 0, 0]}>
        <meshStandardMaterial color="#333333" />
      </Plane>

      {/* Paredes de fondo */}
      <Box args={[30, 5, 0.5]} position={[0, 2.5, -15]} receiveShadow>
         <meshStandardMaterial color="#1f1f1f" />
      </Box>
      <Box args={[0.5, 5, 30]} position={[-15, 2.5, 0]} receiveShadow>
         <meshStandardMaterial color="#1f1f1f" />
      </Box>

      {/* Komodo Boss Area (Centro atrás) */}
      <KomodoBoss position={[0, 0, -10]} />

      {/* Whiteboard (Pared Izquierda para Planner) */}
      <AnimatedWhiteboard position={[-8, 0, -8]} rotation={[0, Math.PI / 4, 0]} isDrawing={plannerState === 'working'} />

      {/* Desks for Coder and Reviewer */}
      <Desk position={[-4, 0, 0]} rotation={[0, Math.PI / 2, 0]} />
      <Desk position={[4, 0, 0]} rotation={[0, -Math.PI / 2, 0]} />

      {/* Waiting Chairs (Sala de espera - derecha) */}
      <WaitChair position={[10, 0, 5]} rotation={[0, -Math.PI / 2, 0]} />
      <WaitChair position={[10, 0, 7]} rotation={[0, -Math.PI / 2, 0]} />
      <WaitChair position={[10, 0, 9]} rotation={[0, -Math.PI / 2, 0]} />

      {/* Decoración Plantas */}
      <group position={[12, 0, -12]}>
        <Cylinder args={[0.5, 0.4, 0.8]} position={[0, 0.4, 0]} castShadow>
          <meshStandardMaterial color="#d4a373" />
        </Cylinder>
        <Sphere args={[1.2]} position={[0, 1.5, 0]} castShadow>
          <meshStandardMaterial color="#2d6a4f" />
        </Sphere>
      </group>

      {/* ==== AGENTES DINÁMICOS ==== */}

      {/* PLANNER */}
      <Agent3D 
        id="PLANNER"
        status={plannerState}
        color="#3498db" // Azul
        waitPosition={[10, 0, 5]} // Chair 1
        lookAtWait={[0, -Math.PI / 2, 0]}
        workPosition={[-6, 0, -6]} // Frente a Whiteboard
        lookAtWork={[0, -(3 * Math.PI) / 4, 0]} // Mirando a la pizarra
        isWhiteboard={true}
      />

      {/* CODER */}
      <Agent3D 
        id="CODER"
        status={coderState}
        color="#e74c3c" // Rojo
        waitPosition={[10, 0, 7]} // Chair 2
        lookAtWait={[0, -Math.PI / 2, 0]}
        workPosition={[-3, 0, 0]} // Escritorio 1
        lookAtWork={[0, -Math.PI / 2, 0]} // Mirando al monitor
      />

      {/* REVIEWER */}
      <Agent3D 
        id="REVIEWER"
        status={reviewerState}
        color="#9b59b6" // Morado
        waitPosition={[10, 0, 9]} // Chair 3
        lookAtWait={[0, -Math.PI / 2, 0]}
        workPosition={[3, 0, 0]} // Escritorio 2
        lookAtWork={[0, Math.PI / 2, 0]} // Mirando al monitor
      />

    </group>
  );
}
