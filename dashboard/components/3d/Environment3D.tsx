"use client";

import React from 'react';
import { Box, Cylinder, Plane, Sphere, Text } from '@react-three/drei';
import { AnimatedWhiteboard } from './AnimatedWhiteboard';
import { KomodoBoss } from './KomodoBoss';
import { Agent3D } from './Agent3D';
import { SonarScanner3D } from './SonarScanner3D';

interface Environment3DProps {
  agents: any;
  phase?: string;
  cliHealth?: any;
}

// Mobiliario

function Wall({ args, position }: { args: [number, number, number], position: [number, number, number] }) {
  return (
    <Box args={args} position={position} receiveShadow castShadow>
      <meshStandardMaterial color="#dcdde1" roughness={0.8} />
    </Box>
  );
}

function WallScreen({ args, position }: { args: [number, number, number], position: [number, number, number] }) {
  const newArgs = [args[0], 1, args[2]] as [number, number, number];
  const newPos = [position[0], 0.5, position[2]] as [number, number, number];

  return (
    <Box args={newArgs} position={newPos} receiveShadow castShadow>
      <meshStandardMaterial color="#b2bec3" roughness={0.8} />
    </Box>
  );
}

function LDesk({ position, rotation }: { position: [number, number, number], rotation: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      {/* Main desk */}
      <Box args={[2.5, 0.1, 1]} position={[0, 0.8, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#3e2723" />
      </Box>
      {/* L part */}
      <Box args={[1, 0.1, 2]} position={[1.25, .8, -0.5]} castShadow receiveShadow>
        <meshStandardMaterial color="#3e2723" />
      </Box>

      {/* Legs */}
      <Box args={[0.1, 0.8, 0.8]} position={[-1.1, 0.4, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#1a1a1a" />
      </Box>
      <Box args={[0.1, 0.8, 1.5]} position={[1.6, 0.4, -0.5]} castShadow receiveShadow>
        <meshStandardMaterial color="#1a1a1a" />
      </Box>

      {/* Chair */}
      <Box args={[0.6, 0.1, 0.6]} position={[0, 0.4, -1]} castShadow receiveShadow>
        <meshStandardMaterial color="#2c3e50" />
      </Box>
      <Box args={[0.6, 0.6, 0.1]} position={[0, 0.7, -1.3]} castShadow receiveShadow>
        <meshStandardMaterial color="#2c3e50" />
      </Box>
      <Cylinder args={[0.05, 0.05, 0.4]} position={[0, 0.2, -1]} castShadow receiveShadow>
        <meshStandardMaterial color="#111" />
      </Cylinder>

      {/* Monitors */}
      <Box args={[0.8, 0.5, 0.05]} position={[-0.5, 1.1, 0.1]} rotation={[0, -0.2, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#111" />
      </Box>
      <Box args={[0.8, 0.5, 0.05]} position={[0.4, 1.1, 0.1]} rotation={[0, 0.2, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#111" />
      </Box>
      {/* Screen glow */}
      <Box args={[0.75, 0.45, 0.01]} position={[-0.5, 1.1, 0.05]} rotation={[0, -0.2, 0]}>
        <meshStandardMaterial color="#4fc3f7" emissive="#4fc3f7" emissiveIntensity={0.2} />
      </Box>
      <Box args={[0.75, 0.45, 0.01]} position={[0.4, 1.1, 0.05]} rotation={[0, 0.2, 0]}>
        <meshStandardMaterial color="#111" />
      </Box>

      {/* Desk Props */}
      {/* Keyboard */}
      <Box args={[0.6, 0.02, 0.2]} position={[0, 0.86, -0.4]} rotation={[0, 0, 0]} castShadow><meshStandardMaterial color="#222" /></Box>
      <Box args={[0.3, 0.02, 0.2]} position={[-0.8, 0.86, -0.2]} rotation={[0, 0.2, 0]} castShadow><meshStandardMaterial color="#ecf0f1" /></Box> {/* Notebook */}
      <Box args={[0.08, 0.01, 0.15]} position={[-1.1, 0.86, -0.2]} rotation={[0, -0.3, 0]} castShadow><meshStandardMaterial color="#333" /></Box> {/* Mobile */}
      {/* Old Telephone */}
      <group position={[0.8, 0.86, -0.2]} rotation={[0, -0.2, 0]}>
        <Box args={[0.2, 0.1, 0.15]} position={[0, 0, 0]} castShadow><meshStandardMaterial color="#e74c3c" /></Box>
        <Box args={[0.25, 0.05, 0.05]} position={[0, 0.08, 0]} castShadow><meshStandardMaterial color="#c0392b" /></Box>
      </group>
    </group>
  );
}

function Armchair({ position, rotation, color = "#ff7700" }: { position: [number, number, number], rotation: [number, number, number], color?: string }) {
  return (
    <group position={position} rotation={rotation}>
      <Box args={[1.2, 0.4, 1]} position={[0, 0.2, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={color} />
      </Box>
      <Box args={[1.2, 0.8, 0.3]} position={[0, 0.6, -0.35]} castShadow receiveShadow>
        <meshStandardMaterial color={color} />
      </Box>
      <Box args={[0.3, 0.6, 1]} position={[-0.45, 0.5, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={color} />
      </Box>
      <Box args={[0.3, 0.6, 1]} position={[0.45, 0.5, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={color} />
      </Box>
    </group>
  );
}

function Sofa({ position, rotation, color }: { position: [number, number, number], rotation: [number, number, number], color?: string }) {
  return (
    <group position={position} rotation={rotation}>
      <Box args={[3.5, 0.4, 1]} position={[0, 0.2, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={color} />
      </Box>
      <Box args={[3.5, 0.8, 0.3]} position={[0, 0.6, -0.35]} castShadow receiveShadow>
        <meshStandardMaterial color={color} />
      </Box>
      <Box args={[0.3, 0.6, 1]} position={[-1.6, 0.5, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={color} />
      </Box>
      <Box args={[0.3, 0.6, 1]} position={[1.6, 0.5, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={color} />
      </Box>
    </group>
  );
}

function MiniSofa({ position, rotation, color = "#000000" }: { position: [number, number, number], rotation: [number, number, number], color?: string }) {
  return (
    <group position={position} rotation={rotation}>
      <Box args={[1.5, 0.4, 1]} position={[0, 0.2, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={color} />
      </Box>
      <Box args={[1.5, 0.8, 0.3]} position={[0, 0.6, -0.35]} castShadow receiveShadow>
        <meshStandardMaterial color={color} />
      </Box>
      <Box args={[0.3, 0.6, 1]} position={[-0.6, 0.5, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={color} />
      </Box>
      <Box args={[0.3, 0.6, 1]} position={[0.6, 0.5, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={color} />
      </Box>
    </group>
  );
}

function VendingMachine({ position, rotation, color }: { position: [number, number, number], rotation: [number, number, number], color: string }) {
  return (
    <group position={position} rotation={rotation}>
      <Box args={[1, 2, 0.8]} position={[0, 1, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={color} />
      </Box>
      <Box args={[0.8, 1.2, 0.1]} position={[0, 1.2, 0.41]} receiveShadow>
        <meshStandardMaterial color="#88ccff" transparent opacity={0.6} />
      </Box>
      {/* Items */}
      <Box args={[0.15, 0.15, 0.15]} position={[-0.2, 1.5, 0.3]}><meshStandardMaterial color="#fff" /></Box>
      <Box args={[0.15, 0.15, 0.15]} position={[0, 1.5, 0.3]}><meshStandardMaterial color="#ff0" /></Box>
      <Box args={[0.15, 0.15, 0.15]} position={[0.2, 1.5, 0.3]}><meshStandardMaterial color="#f0f" /></Box>

      <Box args={[0.15, 0.15, 0.15]} position={[-0.2, 1.1, 0.3]}><meshStandardMaterial color="#0ff" /></Box>
      <Box args={[0.15, 0.15, 0.15]} position={[0, 1.1, 0.3]}><meshStandardMaterial color="#fff" /></Box>
      <Box args={[0.15, 0.15, 0.15]} position={[0.2, 1.1, 0.3]}><meshStandardMaterial color="#ff0" /></Box>
    </group>
  );
}

function WaterCooler({ position, rotation }: { position: [number, number, number], rotation: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      <Box args={[0.5, 1, 0.5]} position={[0, 0.5, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#ecf0f1" />
      </Box>
      <Cylinder args={[0.2, 0.2, 0.6]} position={[0, 1.3, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#3498db" transparent opacity={0.6} />
      </Cylinder>
    </group>
  );
}

function Bookshelf({ position, rotation }: { position: [number, number, number], rotation: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      <Box args={[1.5, 2.5, 0.6]} position={[0, 1.25, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#5c4033" />
      </Box>
      {/* Shelves */}
      <Box args={[1.3, 0.05, 0.5]} position={[0, 0.8, 0.05]}><meshStandardMaterial color="#3e2723" /></Box>
      <Box args={[1.3, 0.05, 0.5]} position={[0, 1.4, 0.05]}><meshStandardMaterial color="#3e2723" /></Box>
      <Box args={[1.3, 0.05, 0.5]} position={[0, 2.0, 0.05]}><meshStandardMaterial color="#3e2723" /></Box>
      {/* Books */}
      <Box args={[0.1, 0.4, 0.3]} position={[-0.4, 1.05, 0.1]}><meshStandardMaterial color="#e74c3c" /></Box>
      <Box args={[0.1, 0.35, 0.3]} position={[-0.2, 1.0, 0.1]} rotation={[0, 0, 0.1]}><meshStandardMaterial color="#f1c40f" /></Box>
      <Box args={[0.1, 0.4, 0.3]} position={[0.3, 1.65, 0.1]}><meshStandardMaterial color="#3498db" /></Box>
      <Box args={[0.1, 0.4, 0.3]} position={[0.45, 1.65, 0.1]}><meshStandardMaterial color="#2ecc71" /></Box>
    </group>
  );
}

function FilingCabinet({ position, rotation }: { position: [number, number, number], rotation: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      <Box args={[0.8, 1.2, 0.8]} position={[0, 0.6, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#7f8c8d" />
      </Box>
      <Box args={[0.7, 0.3, 0.05]} position={[0, 0.9, 0.41]}><meshStandardMaterial color="#95a5a6" /></Box>
      <Box args={[0.7, 0.3, 0.05]} position={[0, 0.5, 0.41]}><meshStandardMaterial color="#95a5a6" /></Box>
      <Box args={[0.7, 0.3, 0.05]} position={[0, 0.1, 0.41]}><meshStandardMaterial color="#95a5a6" /></Box>
    </group>
  );
}

function PottedPlant({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <Cylinder args={[0.3, 0.2, 0.5]} position={[0, 0.25, 0]} castShadow>
        <meshStandardMaterial color="#aaaaaaff" />
      </Cylinder>
      <Sphere args={[0.5]} position={[0, 0.8, 0]} castShadow>
        <meshStandardMaterial color="#2ecc71" />
      </Sphere>
    </group>
  );
}

function WindowProps({ position, rotation }: { position: [number, number, number], rotation: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      <Box args={[3, 1.5, 0.1]} position={[0, 0, 0]}>
        <meshStandardMaterial color="#ecf0f1" />
      </Box>
      <Box args={[2.8, 1.3, 0.12]} position={[0, 0, 0]}>
        <meshStandardMaterial color="#87ceeb" transparent opacity={0.4} emissive="#87ceeb" emissiveIntensity={0.2} />
      </Box>
    </group>
  );
}

function WallPainting({ position, rotation }: { position: [number, number, number], rotation: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      <Box args={[1.5, 1, 0.1]} position={[0, 0, 0]}>
        <meshStandardMaterial color="#333" />
      </Box>
      <Box args={[1.3, 0.8, 0.12]} position={[0, 0, 0]}>
        <meshStandardMaterial color="#9b59b6" />
      </Box>
    </group>
  );
}

export function Environment3D({ agents, phase, cliHealth }: Environment3DProps) {
  const plannerState = agents?.PLANNER?.status || 'idle';
  const coderState = agents?.CODER?.status || 'idle';
  const reviewerState = agents?.REVIEWER?.status || 'idle';
  const architectState = agents?.ARCHITECT?.status || 'idle';
  const securityState = agents?.SECURITY?.status || 'idle';
  const isAnalyzing = phase === 'analyzing';

  // Derive CLI health status per agent from their assigned CLI
  const getAgentCliStatus = (agentName: string): 'available' | 'rate-limited' | 'down' => {
    if (!cliHealth) return 'available';
    const cli = agents?.[agentName]?.cli;
    if (!cli) return 'available';
    return cliHealth[cli]?.status ?? 'available';
  };

  return (
    <group>
      {/* Floor - Light wood/grey (extended for new back offices) */}
      <Plane args={[16, 20]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, 0, -3]}>
        <meshStandardMaterial color="#aaaaaaff" /> {/* Madera Losas */}
      </Plane>

      {/* Breakroom floor (Tile) */}
      <Plane args={[3.8, 5.8]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, 0.01, 4]}>
        <meshStandardMaterial color="#34495e" />
      </Plane>

      {/* Floor Labels */}
      <Text position={[-2.5, 0.03, -4]} rotation={[-Math.PI / 2, 0, Math.PI / 2]} fontSize={1} color="#7f8c8d" fillOpacity={0.6}>
        PLANNER
      </Text>
      <Text position={[-5, 0.03, 3]} rotation={[-Math.PI / 2, 0, 0]} fontSize={1} color="#7f8c8d" fillOpacity={0.6}>
        CODER
      </Text>
      <Text position={[5, 0.03, 3]} rotation={[-Math.PI / 2, 0, 0]} fontSize={1} color="#7f8c8d" fillOpacity={0.6}>
        REVIEWER
      </Text>
      <Text position={[-4, 0.03, -10]} rotation={[-Math.PI / 2, 0, 0]} fontSize={1} color="#7f8c8d" fillOpacity={0.6}>
        ARCHITECT
      </Text>
      <Text position={[4, 0.03, -10]} rotation={[-Math.PI / 2, 0, 0]} fontSize={1} color="#7f8c8d" fillOpacity={0.6}>
        SECURITY
      </Text>

      {/* Paredes Exteriores del edificio */}
      <Wall args={[16.2, 3, 0.2]} position={[0, 1.5, -13]} /> {/* Fondo (extended) */}
      <Wall args={[0.2, 3, 20.2]} position={[-8, 1.5, -3]} /> {/* Izquierda (extended) */}

      {/* Pared Derecha Exterior (Pantalla media para no ocluir) */}
      <WallScreen args={[0.2, 3, 20.2]} position={[8, 1.5, -3]} /> {/* Derecha (extended) */}

      {/* --- Paredes Interiores Horizontales (dividen oficinas traseras del pasillo Z=-1) --- */}
      {/* Planner (X=-8 a -1). Puerta en X=-2.5 */}
      <WallScreen args={[5, 3, 0.2]} position={[-5.5, 1.5, -1]} />
      <WallScreen args={[1, 3, 0.2]} position={[-1.5, 1.5, -1]} />

      {/* Komodo Boss (X=1 a 8). Puerta en X=2.5 */}
      <WallScreen args={[1, 3, 0.2]} position={[1.5, 1.5, -1]} />
      <WallScreen args={[5, 3, 0.2]} position={[5.5, 1.5, -1]} />

      {/* --- Paredes Interiores Horizontales (dividen oficinas delanteras del pasillo Z=1) --- */}
      {/* Coder (X=-8 a -2). Puerta en X=-3 */}
      <WallScreen args={[4.5, 3, 0.2]} position={[-5.75, 1.5, 1]} />
      <WallScreen args={[0.5, 3, 0.2]} position={[-2.25, 1.5, 1]} />

      {/* Breakroom Frente (X=-2 a 2). Abierto al pasillo en Z=1. */}

      {/* Reviewer (X=2 a 8). Puerta en X=3 */}
      <WallScreen args={[0.5, 3, 0.2]} position={[2.25, 1.5, 1]} />
      <WallScreen args={[4.5, 3, 0.2]} position={[5.75, 1.5, 1]} />

      {/* --- Paredes Divisorias Verticales --- */}
      {/* Planner y Komodo separador tras el pasillo: X=-1 & X=1 (hasta fondo Z=-7) */}
      <WallScreen args={[0.2, 3, 6]} position={[-1, 1.5, -4]} />
      <WallScreen args={[0.2, 3, 6]} position={[1, 1.5, -4]} />

      {/* Coder / Breakroom / Reviewer (Desde Z=1 al Frente Z=7) */}
      <WallScreen args={[0.2, 3, 6]} position={[-2, 1.5, 4]} /> {/* Coder Right Wall */}
      <WallScreen args={[0.2, 3, 6]} position={[2, 1.5, 4]} />  {/* Reviewer Left Wall */}

      {/* --- NEW: Walls for ARCHITECT & SECURITY offices (Z=-7 to Z=-13) --- */}
      {/* Horizontal wall at Z=-7 separating old back row from new offices */}
      {/* ARCHITECT door at X=-4 */}
      <WallScreen args={[3, 3, 0.2]} position={[-6.5, 1.5, -7]} />
      <WallScreen args={[3, 3, 0.2]} position={[-1.5, 1.5, -7]} />
      {/* SECURITY door at X=4 */}
      <WallScreen args={[3, 3, 0.2]} position={[1.5, 1.5, -7]} />
      <WallScreen args={[3, 3, 0.2]} position={[6.5, 1.5, -7]} />

      {/* Vertical divider between ARCHITECT and SECURITY */}
      <WallScreen args={[0.2, 3, 6]} position={[0, 1.5, -10]} />

      {/* ==== MOBILIARIO Y DECORACIÓN POR HABITACIÓN ==== */}

      {/* -- ROOM 1: PLANNER (Arriba Izquierda: X=-4.5, Z=-4) -- */}
      {/* Pizarra en la pared frontal (Z=-6.8) para verla desde la puerta */}
      <AnimatedWhiteboard position={[-3.5, 0, -6.8]} rotation={[0, 0, 0]} isDrawing={plannerState === 'working'} />
      <LDesk position={[-5.5, 0, -3.5]} rotation={[0, Math.PI / 2, 0]} />
      <FilingCabinet position={[-6.5, 0, -6.5]} rotation={[0, 0, 0]} />
      <PottedPlant position={[-7.5, 0, -6.5]} />

      {/* -- ROOM 2: KOMODO BOSS (Arriba Derecha: X=4.5, Z=-4) -- */}
      {/* Komodo desk built-in */}
      <Bookshelf position={[2, 0, -6.5]} rotation={[0, 0, 0]} />
      <KomodoBoss position={[4.5, 0, -4]} />
      <WindowProps position={[7.9, 1.5, -4]} rotation={[0, -Math.PI / 2, 0]} />

      {/* -- BREAKROOM (Centro Frente: X=0, Z=4) -- */}
      {/* Sofás para descanso de los agentes pegados a la pared delantera para desbloquear puerta */}
      <Sofa position={[0, 0, 6.2]} rotation={[0, Math.PI, 0]} color="#e67e22" />
      {/* Maquinas a las paredes laterales */}
      <VendingMachine position={[-1.5, 0, 4]} rotation={[0, Math.PI / 2, 0]} color="#e74c3c" />
      <VendingMachine position={[-1.5, 0, 2.8]} rotation={[0, Math.PI / 2, 0]} color="#2980b9" />
      <WaterCooler position={[1.5, 0, 2]} rotation={[0, -Math.PI / 2, 0]} />

      {/* -- ROOM 3: CODER (Abajo Izquierda: X=-5, Z=4) -- */}
      <WindowProps position={[-7.9, 1.5, 4]} rotation={[0, Math.PI / 2, 0]} />
      <LDesk position={[-6, 0, 4.5]} rotation={[0, Math.PI, 0]} />
      <MiniSofa position={[-5.8, 0, 1.7]} rotation={[0, 0, 0]} color="#c72222" />
      <PottedPlant position={[-7.2, 0, 1.7]} />

      {/* -- ROOM 4: REVIEWER (Abajo Derecha: X=5, Z=4) -- */}
      <LDesk position={[5, 0, 4.5]} rotation={[0, Math.PI, 0]} />
      <FilingCabinet position={[7.5, 0, 1.5]} rotation={[0, -Math.PI / 2, 0]} />
      <PottedPlant position={[7.5, 0, 6.5]} />
      <Bookshelf position={[2.5, 0, 6]} rotation={[0, -Math.PI / 2, 0]} />


      {/* -- ROOM 5: ARCHITECT (Back Left: X=-4, Z=-10) -- */}
      {/* Blueprint whiteboard on back wall */}
      <AnimatedWhiteboard position={[-4, 0, -12.8]} rotation={[0, 0, 0]} isDrawing={architectState === 'working'} />
      <LDesk position={[-5.5, 0, -9.5]} rotation={[0, Math.PI / 2, 0]} />
      <FilingCabinet position={[-7.5, 0, -12.5]} rotation={[0, 0, 0]} />
      <PottedPlant position={[-7.5, 0, -7.5]} />
      {/* Blueprint/diagram decoration on side wall */}
      <WallPainting position={[-7.9, 1.5, -10]} rotation={[0, Math.PI / 2, 0]} />

      {/* -- ROOM 6: SECURITY (Back Right: X=4, Z=-10) -- */}
      <LDesk position={[5, 0, -9.5]} rotation={[0, Math.PI / 2, 0]} />
      <FilingCabinet position={[7.5, 0, -12.5]} rotation={[0, -Math.PI / 2, 0]} />
      <Bookshelf position={[2, 0, -12]} rotation={[0, 0, 0]} />
      <PottedPlant position={[7.5, 0, -7.5]} />
      {/* Security monitor with shield icon (screen glow in green) */}
      <group position={[4, 0, -12.8]} rotation={[0, 0, 0]}>
        {/* Large security monitor */}
        <Box args={[2, 1.5, 0.1]} position={[0, 1.5, 0]} castShadow receiveShadow>
          <meshStandardMaterial color="#111" />
        </Box>
        {/* Screen with green security glow */}
        <Box args={[1.8, 1.3, 0.05]} position={[0, 1.5, 0.06]}>
          <meshStandardMaterial color="#0a2e0a" emissive="#22c55e" emissiveIntensity={0.3} />
        </Box>
        {/* Shield icon (simple geometric representation) */}
        <Box args={[0.5, 0.6, 0.02]} position={[0, 1.6, 0.1]}>
          <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={0.5} />
        </Box>
        <Box args={[0.3, 0.2, 0.02]} position={[0, 1.2, 0.1]}>
          <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={0.5} />
        </Box>
        {/* Lock icon on shield */}
        <Box args={[0.12, 0.15, 0.03]} position={[0, 1.55, 0.12]}>
          <meshStandardMaterial color="#0a2e0a" />
        </Box>
      </group>

      {/* -- SONARQUBE SCANNER (Hallway between Coder and Reviewer) -- */}
      <SonarScanner3D position={[0, 0, -1.5]} isAnalyzing={isAnalyzing} />

      {/* ==== AGENTES DINÁMICOS ==== */}

      {/* PLANNER */}
      <Agent3D
        id="PLANNER"
        status={plannerState}
        shirtColor="#3498db"
        hairColor="#5C4033"
        hairStyle="bun"
        cliStatus={getAgentCliStatus('PLANNER')}
        pathWaypoints={[
          [-1.2, 0, 6.2],     // Descanso en sillón Breakroom (izq)
          [-1.2, 0, 2.5],     // Sale de Breakroom
          [-2.5, 0, 0],       // Pasillo frente a su puerta
          [-2.5, 0, -4.5],    // Puerta de Planner hacia el escritorio
          [-3.5, 0, -5.8]     // Frente a Pizarra blanca (Trabajando) en Z=-6.8
        ]}
        rotationWait={[0, Math.PI, 0]}
        rotationWork={[0, Math.PI, 0]}
        isWhiteboard={true}
      />

      {/* CODER */}
      <Agent3D
        id="CODER"
        status={coderState}
        shirtColor="#e74c3c"
        hairColor="#f1c40f"
        hairStyle="long"
        cliStatus={getAgentCliStatus('CODER')}
        pathWaypoints={[
          [0, 0, 6.2],        // Descanso en sillón Breakroom (centro)
          [0, 0, 2.5],        // Sale hacia puerta
          [-3, 0, 0],         // Pasillo hacia puerta Coder
          [-3, 0, 5.3],       // Entra en su habitacion Coder hacia la silla
          [-6, 0, 5.5]        // Sentado en su silla
        ]}
        rotationWait={[0, Math.PI, 0]}
        rotationWork={[0, Math.PI, 0]}
      />

      {/* REVIEWER */}
      <Agent3D
        id="REVIEWER"
        status={reviewerState}
        shirtColor="#9b59b6"
        hairColor="#111"
        hairStyle="short"
        cliStatus={getAgentCliStatus('REVIEWER')}
        pathWaypoints={[
          [1.2, 0, 6.2],      // Descanso en sillón Breakroom (der)
          [1.2, 0, 2.5],      // Sale hacia puerta
          [3, 0, 0],          // Pasillo hacia puerta Reviewer
          [3, 0, 5.3],        // Entra en su habitacion Reviewer hacia la silla
          [5, 0, 5.5]         // Sentado en su silla
        ]}
        rotationWait={[0, Math.PI, 0]}
        rotationWork={[0, Math.PI, 0]}
      />

      {/* ARCHITECT — teal shirt, short hair, works at blueprint whiteboard */}
      <Agent3D
        id="ARCHITECT"
        status={architectState}
        shirtColor="#0d9488"
        hairColor="#4a3728"
        hairStyle="short"
        cliStatus={getAgentCliStatus('ARCHITECT')}
        pathWaypoints={[
          [-0.5, 0, 6.2],     // Descanso en sillón Breakroom
          [-0.5, 0, 2.5],     // Sale de Breakroom
          [-4, 0, 0],         // Pasillo central
          [-4, 0, -4],        // Cruza zona Planner
          [-4, 0, -7],        // Puerta del despacho Architect
          [-4, 0, -11.8]      // Frente a la pizarra de planos (Trabajando)
        ]}
        rotationWait={[0, Math.PI, 0]}
        rotationWork={[0, Math.PI, 0]}
        isWhiteboard={true}
      />

      {/* SECURITY — dark green shirt, short hair, works at security monitor */}
      <Agent3D
        id="SECURITY"
        status={securityState}
        shirtColor="#166534"
        hairColor="#1a1a2e"
        hairStyle="short"
        cliStatus={getAgentCliStatus('SECURITY')}
        pathWaypoints={[
          [0.5, 0, 6.2],      // Descanso en sillón Breakroom
          [0.5, 0, 2.5],      // Sale de Breakroom
          [4, 0, 0],          // Pasillo central
          [4, 0, -4],         // Cruza zona Boss
          [4, 0, -7],         // Puerta del despacho Security
          [5, 0, -10.5]       // Sentado en su escritorio
        ]}
        rotationWait={[0, Math.PI, 0]}
        rotationWork={[0, Math.PI, 0]}
      />

    </group>
  );
}
