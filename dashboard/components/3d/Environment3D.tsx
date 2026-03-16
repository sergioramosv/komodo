"use client";

import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Box, Cylinder, Plane, Sphere, Text, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { AnimatedWhiteboard } from './AnimatedWhiteboard';
import { KomodoBoss } from './KomodoBoss';
import { Agent3D } from './Agent3D';
import { SonarScanner3D } from './SonarScanner3D';

interface Environment3DProps {
  agents: any;
  phase?: string;
  cliHealth?: any;
}

/* ═══════════════════════════════════════════════════════════════════
   COLOR PALETTE — Professional muted tones
   ═══════════════════════════════════════════════════════════════════ */
const C = {
  // Walls & structure
  wallExterior: '#e8e4df',   // warm off-white
  wallInterior: '#f0ece6',
  ceiling: '#f5f3ef',
  baseboard: '#8a8580',

  // Floors
  woodLight: '#c4a882',
  woodDark: '#b09470',
  tileLight: '#4a4a4f',
  tileDark: '#3d3d42',
  carpet: '#6b6b70',

  // Glass
  glass: '#c8dce8',
  glassTint: '#e0eaf0',
  metalFrame: '#707075',

  // Furniture
  deskTop: '#d4c4a8',        // light birch wood
  deskLegs: '#505055',       // dark metal
  chairSeat: '#3a3a3f',      // charcoal
  chairBase: '#606065',
  monitorBlack: '#1a1a1e',
  monitorScreen: '#2a4a6a',
  keyboard: '#2a2a2e',

  // Accents
  plantGreen: '#5a8a5a',
  plantPot: '#8a7a6a',
  potSoil: '#5a4a3a',
  bookRed: '#9a4a4a',
  bookBlue: '#4a5a8a',
  bookGreen: '#5a7a5a',
  bookYellow: '#b09a5a',

  // Seating
  sofaLeather: '#5a4a3a',
  armchairFabric: '#6a6060',
  cushion: '#7a6a5a',
};

/* ═══════════════════════════════════════════════════════════════════
   STRUCTURAL COMPONENTS
   ═══════════════════════════════════════════════════════════════════ */


function GlassPartition({
  args, position, vertical = false,
}: {
  args: [number, number, number]; position: [number, number, number]; vertical?: boolean;
}) {
  const [w, h, d] = args;
  const frameThick = 0.06;
  return (
    <group position={position}>
      {/* Bottom metal rail */}
      <Box args={[w, frameThick, d]} position={[0, frameThick / 2, 0]}>
        <meshStandardMaterial color={C.metalFrame} metalness={0.6} roughness={0.3} />
      </Box>
      {/* Top metal rail */}
      <Box args={[w, frameThick, d]} position={[0, h - frameThick / 2, 0]}>
        <meshStandardMaterial color={C.metalFrame} metalness={0.6} roughness={0.3} />
      </Box>
      {/* Glass pane */}
      <Box args={[w - 0.02, h - frameThick * 2 - 0.1, d]} position={[0, h / 2, 0]}>
        <meshPhysicalMaterial
          color={C.glass}
          transparent
          opacity={0.18}
          roughness={0.05}
          metalness={0.0}
          transmission={0.6}
        />
      </Box>
      {/* Vertical frame posts */}
      {vertical && (
        <>
          <Box args={[frameThick, h, d]} position={[-w / 2 + frameThick / 2, h / 2, 0]}>
            <meshStandardMaterial color={C.metalFrame} metalness={0.6} roughness={0.3} />
          </Box>
          <Box args={[frameThick, h, d]} position={[w / 2 - frameThick / 2, h / 2, 0]}>
            <meshStandardMaterial color={C.metalFrame} metalness={0.6} roughness={0.3} />
          </Box>
        </>
      )}
    </group>
  );
}

function CeilingWithLights({ width, depth, position, lightPositions }: {
  width: number; depth: number; position: [number, number, number];
  lightPositions: [number, number][];
}) {
  const ceilingY = 3.0;
  return (
    <group position={position}>
      {/* Ceiling plane */}
      <Plane args={[width, depth]} rotation={[Math.PI / 2, 0, 0]} position={[0, ceilingY, 0]}>
        <meshStandardMaterial color={C.ceiling} roughness={1} />
      </Plane>
      {/* Recessed LED panels */}
      {lightPositions.map(([lx, lz], i) => (
        <group key={i} position={[lx, ceilingY - 0.02, lz]}>
          {/* LED panel frame */}
          <Box args={[1.8, 0.04, 0.6]} position={[0, 0, 0]}>
            <meshStandardMaterial color="#e0e0e0" roughness={0.5} />
          </Box>
          {/* Light surface */}
          <Plane args={[1.6, 0.45]} rotation={[Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
            <meshStandardMaterial color="#fff8f0" emissive="#fff8f0" emissiveIntensity={0.4} />
          </Plane>
          {/* Actual light */}
          <pointLight position={[0, -0.5, 0]} intensity={0.6} distance={8} color="#fff5e6" castShadow={false} />
        </group>
      ))}
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   FLOOR COMPONENTS
   ═══════════════════════════════════════════════════════════════════ */

function WoodFloor({ width, depth, position }: { width: number; depth: number; position: [number, number, number] }) {
  const strips: React.ReactNode[] = [];
  const stripW = 0.5;
  const count = Math.ceil(width / stripW);
  for (let i = 0; i < count; i++) {
    const x = -width / 2 + stripW / 2 + i * stripW;
    const color = i % 2 === 0 ? C.woodLight : C.woodDark;
    strips.push(
      <Box key={i} args={[stripW - 0.02, 0.02, depth]} position={[x, 0, 0]}>
        <meshStandardMaterial color={color} roughness={0.8} />
      </Box>
    );
  }
  return <group position={position}>{strips}</group>;
}

function TileFloor({ width, depth, position }: { width: number; depth: number; position: [number, number, number] }) {
  const tiles: React.ReactNode[] = [];
  const tileSize = 1;
  const cols = Math.ceil(width / tileSize);
  const rows = Math.ceil(depth / tileSize);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = -width / 2 + tileSize / 2 + c * tileSize;
      const z = -depth / 2 + tileSize / 2 + r * tileSize;
      const color = (r + c) % 2 === 0 ? C.tileLight : C.tileDark;
      tiles.push(
        <Box key={`${r}-${c}`} args={[tileSize - 0.03, 0.02, tileSize - 0.03]} position={[x, 0, z]}>
          <meshStandardMaterial color={color} roughness={0.6} />
        </Box>
      );
    }
  }
  return <group position={position}>{tiles}</group>;
}

/* ═══════════════════════════════════════════════════════════════════
   FURNITURE COMPONENTS
   ═══════════════════════════════════════════════════════════════════ */

function LShapedDesk({ position, rotation, mirror }: {
  position: [number, number, number]; rotation: [number, number, number]; mirror?: boolean;
}) {
  const mx = mirror ? -1 : 1;
  return (
    <group position={position} rotation={rotation}>
      {/* Main tabletop */}
      <RoundedBox args={[2.4, 0.05, 0.8]} radius={0.02} position={[0, 0.74, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={C.deskTop} roughness={0.45} />
      </RoundedBox>
      {/* L extension */}
      <RoundedBox args={[0.8, 0.05, 1.6]} radius={0.02} position={[mx * 1.2, 0.74, -0.4]} castShadow receiveShadow>
        <meshStandardMaterial color={C.deskTop} roughness={0.45} />
      </RoundedBox>
      {/* Corner filler */}
      <RoundedBox args={[0.4, 0.05, 0.4]} radius={0.02} position={[mx * 0.9, 0.74, -0.2]} castShadow>
        <meshStandardMaterial color={C.deskTop} roughness={0.45} />
      </RoundedBox>

      {/* Metal frame legs — A-frame style */}
      {/* Back-left */}
      <Box args={[0.04, 0.72, 0.6]} position={[-1.1 * mx, 0.37, 0.05]}>
        <meshStandardMaterial color={C.deskLegs} metalness={0.7} roughness={0.2} />
      </Box>
      {/* Back-right */}
      <Box args={[0.04, 0.72, 0.6]} position={[0.9 * mx, 0.37, 0.05]}>
        <meshStandardMaterial color={C.deskLegs} metalness={0.7} roughness={0.2} />
      </Box>
      {/* L extension leg */}
      <Box args={[0.6, 0.72, 0.04]} position={[mx * 1.2, 0.37, -1.1]}>
        <meshStandardMaterial color={C.deskLegs} metalness={0.7} roughness={0.2} />
      </Box>
      {/* Cross beam */}
      <Box args={[2.0, 0.04, 0.04]} position={[0, 0.15, 0.2]}>
        <meshStandardMaterial color={C.deskLegs} metalness={0.6} roughness={0.3} />
      </Box>

      {/* Cable management tray */}
      <Box args={[1.8, 0.03, 0.15]} position={[0, 0.65, 0.25]}>
        <meshStandardMaterial color={C.deskLegs} metalness={0.4} roughness={0.5} />
      </Box>
      {/* Under-desk cable basket on L */}
      <Box args={[0.5, 0.03, 0.8]} position={[mx * 1.2, 0.5, -0.4]}>
        <meshStandardMaterial color={C.deskLegs} metalness={0.4} roughness={0.5} />
      </Box>

      {/* Desk accessories on L extension */}
      {/* Notebook/papers */}
      <Box args={[0.25, 0.02, 0.35]} position={[mx * 1.2, 0.77, -0.3]}>
        <meshStandardMaterial color="#e8e4df" roughness={0.9} />
      </Box>
      {/* Pen holder */}
      <Cylinder args={[0.03, 0.035, 0.1]} position={[mx * 1.35, 0.82, -0.6]}>
        <meshStandardMaterial color="#5a5a5e" roughness={0.6} />
      </Cylinder>
      {/* Coffee mug */}
      <Cylinder args={[0.035, 0.03, 0.08]} position={[mx * 1.0, 0.81, -0.8]}>
        <meshStandardMaterial color="#fff" roughness={0.4} />
      </Cylinder>
    </group>
  );
}

function ErgonomicChair({ position, rotation }: { position: [number, number, number]; rotation: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      {/* 5-star base */}
      {[0, 1, 2, 3, 4].map((i) => {
        const angle = (i * Math.PI * 2) / 5;
        return (
          <Cylinder key={i} args={[0.02, 0.02, 0.35]} position={[Math.sin(angle) * 0.22, 0.02, Math.cos(angle) * 0.22]} rotation={[0, 0, Math.PI / 2 - angle]}>
            <meshStandardMaterial color={C.chairBase} metalness={0.6} roughness={0.3} />
          </Cylinder>
        );
      })}
      {/* Wheels */}
      {[0, 1, 2, 3, 4].map((i) => {
        const angle = (i * Math.PI * 2) / 5;
        return (
          <Sphere key={`w${i}`} args={[0.035]} position={[Math.sin(angle) * 0.22, 0.035, Math.cos(angle) * 0.22]}>
            <meshStandardMaterial color="#222" roughness={0.8} />
          </Sphere>
        );
      })}
      {/* Gas lift */}
      <Cylinder args={[0.03, 0.03, 0.3]} position={[0, 0.2, 0]}>
        <meshStandardMaterial color={C.chairBase} metalness={0.7} roughness={0.2} />
      </Cylinder>
      {/* Seat */}
      <RoundedBox args={[0.5, 0.08, 0.48]} radius={0.03} position={[0, 0.4, 0]} castShadow>
        <meshStandardMaterial color={C.chairSeat} roughness={0.9} />
      </RoundedBox>
      {/* Backrest */}
      <RoundedBox args={[0.46, 0.5, 0.06]} radius={0.03} position={[0, 0.72, -0.22]} rotation={[0.15, 0, 0]} castShadow>
        <meshStandardMaterial color={C.chairSeat} roughness={0.9} />
      </RoundedBox>
      {/* Armrests */}
      <Box args={[0.04, 0.18, 0.25]} position={[-0.25, 0.5, -0.05]}>
        <meshStandardMaterial color={C.chairBase} metalness={0.5} roughness={0.3} />
      </Box>
      <Box args={[0.12, 0.03, 0.2]} position={[-0.25, 0.6, -0.05]}>
        <meshStandardMaterial color={C.chairSeat} roughness={0.8} />
      </Box>
      <Box args={[0.04, 0.18, 0.25]} position={[0.25, 0.5, -0.05]}>
        <meshStandardMaterial color={C.chairBase} metalness={0.5} roughness={0.3} />
      </Box>
      <Box args={[0.12, 0.03, 0.2]} position={[0.25, 0.6, -0.05]}>
        <meshStandardMaterial color={C.chairSeat} roughness={0.8} />
      </Box>
    </group>
  );
}

function MonitorOnArm({ position, rotation, screenColor }: {
  position: [number, number, number]; rotation: [number, number, number]; screenColor?: string;
}) {
  return (
    <group position={position} rotation={rotation}>
      {/* Desk clamp */}
      <Box args={[0.08, 0.04, 0.08]} position={[0, 0, 0]}>
        <meshStandardMaterial color={C.deskLegs} metalness={0.7} roughness={0.2} />
      </Box>
      {/* Vertical arm */}
      <Cylinder args={[0.015, 0.015, 0.35]} position={[0, 0.18, 0]}>
        <meshStandardMaterial color={C.deskLegs} metalness={0.7} roughness={0.2} />
      </Cylinder>
      {/* Horizontal arm */}
      <Box args={[0.03, 0.03, 0.15]} position={[0, 0.35, -0.07]}>
        <meshStandardMaterial color={C.deskLegs} metalness={0.7} roughness={0.2} />
      </Box>
      {/* Monitor bezel */}
      <RoundedBox args={[0.7, 0.42, 0.025]} radius={0.01} position={[0, 0.35, -0.16]} castShadow>
        <meshStandardMaterial color={C.monitorBlack} roughness={0.4} />
      </RoundedBox>
      {/* Screen — faces -Z (towards the person sitting) */}
      <Plane args={[0.64, 0.36]} position={[0, 0.35, -0.175]} rotation={[0, Math.PI, 0]}>
        <meshStandardMaterial
          color={screenColor || C.monitorScreen}
          emissive={screenColor || C.monitorScreen}
          emissiveIntensity={0.15}
        />
      </Plane>
    </group>
  );
}

function Workstation({ position, rotation, screenColor, mirror }: {
  position: [number, number, number]; rotation: [number, number, number];
  screenColor?: string; mirror?: boolean;
}) {
  // Scale 1.35x so furniture matches agent character size
  return (
    <group position={position} rotation={rotation} scale={[1.35, 1.35, 1.35]}>
      <LShapedDesk position={[0, 0, 0]} rotation={[0, 0, 0]} mirror={mirror} />
      <ErgonomicChair position={[0, 0, -0.8]} rotation={[0, 0.1, 0]} />
      {/* Dual monitors */}
      <MonitorOnArm position={[-0.5, 0.74, 0.15]} rotation={[0, -0.15, 0]} screenColor={screenColor} />
      <MonitorOnArm position={[0.35, 0.74, 0.15]} rotation={[0, 0.15, 0]} screenColor={screenColor} />
      {/* Keyboard */}
      <RoundedBox args={[0.42, 0.015, 0.14]} radius={0.005} position={[0, 0.76, -0.2]}>
        <meshStandardMaterial color={C.keyboard} roughness={0.7} />
      </RoundedBox>
      {/* Mouse pad + mouse */}
      <RoundedBox args={[0.22, 0.005, 0.18]} radius={0.01} position={[0.4, 0.755, -0.2]}>
        <meshStandardMaterial color="#2a2a2e" roughness={0.95} />
      </RoundedBox>
      <RoundedBox args={[0.06, 0.025, 0.1]} radius={0.01} position={[0.4, 0.765, -0.2]}>
        <meshStandardMaterial color={C.keyboard} roughness={0.7} />
      </RoundedBox>
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   DECORATION COMPONENTS
   ═══════════════════════════════════════════════════════════════════ */

function ModernPlant({ position, size = 1 }: { position: [number, number, number]; size?: number }) {
  const s = size;
  return (
    <group position={position}>
      {/* Pot */}
      <Cylinder args={[0.18 * s, 0.14 * s, 0.3 * s]} position={[0, 0.15 * s, 0]} castShadow>
        <meshStandardMaterial color={C.plantPot} roughness={0.85} />
      </Cylinder>
      {/* Soil */}
      <Cylinder args={[0.16 * s, 0.16 * s, 0.03]} position={[0, 0.31 * s, 0]}>
        <meshStandardMaterial color={C.potSoil} roughness={1} />
      </Cylinder>
      {/* Trunk */}
      <Cylinder args={[0.02 * s, 0.03 * s, 0.4 * s]} position={[0, 0.5 * s, 0]}>
        <meshStandardMaterial color="#6a5a4a" roughness={0.9} />
      </Cylinder>
      {/* Leaves (multiple small spheres for bushy look) */}
      {[[0, 0.8, 0], [-0.1, 0.75, 0.08], [0.1, 0.75, -0.06], [0.05, 0.85, 0.05], [-0.06, 0.82, -0.08]].map(
        ([lx, ly, lz], i) => (
          <Sphere key={i} args={[0.12 * s]} position={[lx * s, ly * s, lz * s]}>
            <meshStandardMaterial color={C.plantGreen} roughness={0.9} />
          </Sphere>
        )
      )}
    </group>
  );
}

function Bookshelf({ position, rotation }: { position: [number, number, number]; rotation: [number, number, number] }) {
  const shelfYs = [0.02, 0.5, 1.0, 1.5, 2.0];
  const bookRows = [
    [C.bookRed, C.bookBlue, C.bookGreen, C.bookYellow, C.bookBlue, C.bookRed],
    [C.bookGreen, C.bookRed, C.bookYellow, C.bookBlue, C.bookGreen, C.bookYellow],
    [C.bookBlue, C.bookYellow, C.bookRed, C.bookGreen, C.bookRed, C.bookBlue],
    [C.bookYellow, C.bookGreen, C.bookBlue, C.bookRed, C.bookYellow, C.bookGreen],
  ];
  return (
    <group position={position} rotation={rotation}>
      {/* Thin back panel — flush against wall */}
      <Box args={[1.4, 2.2, 0.03]} position={[0, 1.1, 0]} castShadow>
        <meshStandardMaterial color="#e8e4e0" roughness={0.5} />
      </Box>
      {/* Side panels — white metal */}
      {[-0.68, 0.68].map((x, i) => (
        <Box key={i} args={[0.03, 2.2, 0.3]} position={[x, 1.1, 0.16]} castShadow>
          <meshStandardMaterial color="#e0dcd8" roughness={0.4} metalness={0.1} />
        </Box>
      ))}
      {/* Shelves — light wood */}
      {shelfYs.map((sy, i) => (
        <RoundedBox key={i} args={[1.33, 0.025, 0.28]} radius={0.005} position={[0, sy, 0.155]}>
          <meshStandardMaterial color={C.deskTop} roughness={0.45} />
        </RoundedBox>
      ))}
      {/* Top cap */}
      <RoundedBox args={[1.4, 0.025, 0.3]} radius={0.005} position={[0, 2.2, 0.16]}>
        <meshStandardMaterial color="#e0dcd8" roughness={0.4} metalness={0.1} />
      </RoundedBox>
      {/* Books on shelves 1-4 */}
      {bookRows.map((colors, row) => (
        <group key={row}>
          {colors.map((color, i) => {
            const h = 0.3 + (i * 37 % 7) * 0.02;
            const w = 0.065 + (i % 3) * 0.01;
            const x = -0.5 + i * 0.16;
            const baseY = shelfYs[row] + 0.025;
            return (
              <RoundedBox key={i} args={[w, h, 0.2]} radius={0.005}
                position={[x, baseY + h / 2, 0.15]}>
                <meshStandardMaterial color={color} roughness={0.85} />
              </RoundedBox>
            );
          })}
        </group>
      ))}
      {/* Decorative items on top shelf */}
      <Sphere args={[0.06]} position={[0.3, 2.1, 0.18]}>
        <meshStandardMaterial color="#e8e4df" roughness={0.4} />
      </Sphere>
      <Cylinder args={[0.04, 0.035, 0.12]} position={[-0.35, 2.08, 0.15]}>
        <meshStandardMaterial color={C.plantPot} roughness={0.8} />
      </Cylinder>
      <Sphere args={[0.06]} position={[-0.35, 2.17, 0.15]}>
        <meshStandardMaterial color={C.plantGreen} roughness={0.9} />
      </Sphere>
    </group>
  );
}

function FilingCabinet({ position, rotation }: { position: [number, number, number]; rotation: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      <RoundedBox args={[0.5, 1.1, 0.55]} radius={0.02} position={[0, 0.55, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#8a8a8e" metalness={0.3} roughness={0.5} />
      </RoundedBox>
      {/* Drawers */}
      {[0.2, 0.55, 0.9].map((dy, i) => (
        <group key={i}>
          <Box args={[0.44, 0.28, 0.02]} position={[0, dy, 0.28]}>
            <meshStandardMaterial color="#9a9a9e" metalness={0.3} roughness={0.4} />
          </Box>
          {/* Handle */}
          <Box args={[0.15, 0.02, 0.02]} position={[0, dy, 0.3]}>
            <meshStandardMaterial color={C.metalFrame} metalness={0.7} roughness={0.2} />
          </Box>
        </group>
      ))}
    </group>
  );
}

function WallClock({ position, rotation }: { position: [number, number, number]; rotation: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      <Cylinder args={[0.25, 0.25, 0.04]} rotation={[Math.PI / 2, 0, 0]}>
        <meshStandardMaterial color="#e8e4df" roughness={0.5} />
      </Cylinder>
      <Cylinder args={[0.22, 0.22, 0.01]} rotation={[Math.PI / 2, 0, 0]} position={[0, 0, -0.025]}>
        <meshStandardMaterial color="#fff" roughness={0.3} />
      </Cylinder>
      {/* Hands */}
      <Box args={[0.01, 0.15, 0.005]} position={[0, 0.04, -0.03]} rotation={[0, 0, 0.3]}>
        <meshStandardMaterial color="#222" />
      </Box>
      <Box args={[0.008, 0.1, 0.005]} position={[0.03, 0, -0.03]} rotation={[0, 0, -0.8]}>
        <meshStandardMaterial color="#222" />
      </Box>
    </group>
  );
}

function WallArt({ position, rotation, color = '#4a5a8a' }: {
  position: [number, number, number]; rotation: [number, number, number]; color?: string;
}) {
  return (
    <group position={position} rotation={rotation}>
      {/* Frame */}
      <Box args={[1.0, 0.7, 0.03]} castShadow>
        <meshStandardMaterial color="#5a5a5e" roughness={0.4} metalness={0.2} />
      </Box>
      {/* Canvas */}
      <Box args={[0.88, 0.58, 0.01]} position={[0, 0, -0.015]}>
        <meshStandardMaterial color={color} roughness={0.9} />
      </Box>
    </group>
  );
}

function SecurityMonitor({ position, rotation }: { position: [number, number, number]; rotation: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      {/* Wall mount bracket */}
      <Box args={[0.15, 0.15, 0.08]} position={[0, 1.5, 0]}>
        <meshStandardMaterial color={C.deskLegs} metalness={0.6} roughness={0.3} />
      </Box>
      {/* Large monitor */}
      <RoundedBox args={[1.4, 0.9, 0.04]} radius={0.01} position={[0, 1.5, -0.06]} castShadow>
        <meshStandardMaterial color={C.monitorBlack} roughness={0.4} />
      </RoundedBox>
      {/* Screen with green security glow */}
      <Plane args={[1.3, 0.8]} position={[0, 1.5, -0.085]}>
        <meshStandardMaterial color="#0a2a0a" emissive="#1a6a2a" emissiveIntensity={0.2} />
      </Plane>
      {/* Shield icon */}
      <Box args={[0.25, 0.3, 0.005]} position={[0, 1.55, -0.09]}>
        <meshStandardMaterial color="#2a8a3a" emissive="#2a8a3a" emissiveIntensity={0.4} transparent opacity={0.7} />
      </Box>
    </group>
  );
}

function ModernSofa({ position, rotation, color = C.sofaLeather }: {
  position: [number, number, number]; rotation: [number, number, number]; color?: string;
}) {
  return (
    <group position={position} rotation={rotation} scale={[1.3, 1.3, 1.3]}>
      {/* Base/seat */}
      <RoundedBox args={[1.6, 0.35, 0.75]} radius={0.06} position={[0, 0.25, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={color} roughness={0.85} />
      </RoundedBox>
      {/* Back cushion */}
      <RoundedBox args={[1.5, 0.45, 0.2]} radius={0.06} position={[0, 0.6, -0.28]} castShadow>
        <meshStandardMaterial color={color} roughness={0.9} />
      </RoundedBox>
      {/* Armrests */}
      <RoundedBox args={[0.15, 0.3, 0.65]} radius={0.04} position={[-0.75, 0.45, 0.02]} castShadow>
        <meshStandardMaterial color={color} roughness={0.85} />
      </RoundedBox>
      <RoundedBox args={[0.15, 0.3, 0.65]} radius={0.04} position={[0.75, 0.45, 0.02]} castShadow>
        <meshStandardMaterial color={color} roughness={0.85} />
      </RoundedBox>
      {/* Metal legs */}
      {[[-0.6, -0.25], [-0.6, 0.25], [0.6, -0.25], [0.6, 0.25]].map(([lx, lz], i) => (
        <Cylinder key={i} args={[0.02, 0.02, 0.08]} position={[lx, 0.04, lz]}>
          <meshStandardMaterial color={C.metalFrame} metalness={0.7} roughness={0.2} />
        </Cylinder>
      ))}
    </group>
  );
}

function CoffeeTable({ position }: { position: [number, number, number] }) {
  return (
    <group position={position} scale={[1.3, 1.3, 1.3]}>
      <RoundedBox args={[0.8, 0.04, 0.5]} radius={0.02} position={[0, 0.35, 0]} castShadow>
        <meshStandardMaterial color={C.deskTop} roughness={0.5} />
      </RoundedBox>
      {[[-0.3, -0.18], [-0.3, 0.18], [0.3, -0.18], [0.3, 0.18]].map(([lx, lz], i) => (
        <Cylinder key={i} args={[0.015, 0.015, 0.33]} position={[lx, 0.17, lz]}>
          <meshStandardMaterial color={C.metalFrame} metalness={0.7} roughness={0.2} />
        </Cylinder>
      ))}
      {/* Coffee cup */}
      <Cylinder args={[0.04, 0.03, 0.07]} position={[0.15, 0.41, 0.05]}>
        <meshStandardMaterial color="#fff" roughness={0.4} />
      </Cylinder>
    </group>
  );
}

function VendingMachine({ position, rotation, color }: {
  position: [number, number, number]; rotation: [number, number, number]; color: string;
}) {
  return (
    <group position={position} rotation={rotation}>
      <RoundedBox args={[0.8, 1.9, 0.65]} radius={0.03} position={[0, 0.95, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={color} roughness={0.6} />
      </RoundedBox>
      {/* Glass front */}
      <Box args={[0.65, 1.1, 0.04]} position={[0, 1.15, 0.33]}>
        <meshPhysicalMaterial color={C.glassTint} transparent opacity={0.3} roughness={0.05} />
      </Box>
      {/* Items inside */}
      {[[-0.15, 1.5], [0.05, 1.5], [0.25, 1.5], [-0.15, 1.1], [0.05, 1.1], [0.25, 1.1]].map(([x, y], i) => (
        <Cylinder key={i} args={[0.04, 0.04, 0.12]} position={[x, y, 0.2]} rotation={[0, 0, Math.PI / 2]}>
          <meshStandardMaterial color={['#ddd', '#ff6', '#f6f', '#6ff', '#ddd', '#ff6'][i]} roughness={0.3} />
        </Cylinder>
      ))}
    </group>
  );
}

function WaterCooler({ position, rotation }: { position: [number, number, number]; rotation: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      <RoundedBox args={[0.35, 0.9, 0.35]} radius={0.02} position={[0, 0.45, 0]} castShadow>
        <meshStandardMaterial color="#e8e4df" roughness={0.5} />
      </RoundedBox>
      <Cylinder args={[0.12, 0.12, 0.45]} position={[0, 1.12, 0]} castShadow>
        <meshStandardMaterial color="#6aaae8" transparent opacity={0.5} roughness={0.1} />
      </Cylinder>
    </group>
  );
}

function RoomSign({ position, rotation, label, color = '#fff' }: {
  position: [number, number, number]; rotation: [number, number, number]; label: string; color?: string;
}) {
  return (
    <group position={position} rotation={rotation}>
      <RoundedBox args={[2, 0.6, 0.04]} radius={0.04} castShadow>
        <meshStandardMaterial color="#1a1a2e" roughness={0.3} metalness={0.4} />
      </RoundedBox>
      <Text
        position={[0, 0.1, 0.125]}
        fontSize={0.28}
        color={color}
        anchorX="center"
        anchorY="middle"
        fontWeight={700}
      >
        {label}
      </Text>
    </group>
  );
}

function WindowFrame({ position, rotation }: { position: [number, number, number]; rotation: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      {/* Frame */}
      <Box args={[2.5, 1.6, 0.08]}>
        <meshStandardMaterial color="#d0ccc6" roughness={0.5} />
      </Box>
      {/* Glass panes (2 panes) */}
      <Box args={[1.15, 1.4, 0.03]} position={[-0.6, 0, 0]}>
        <meshPhysicalMaterial color="#a0c8e8" transparent opacity={0.25} roughness={0.02} transmission={0.5} />
      </Box>
      <Box args={[1.15, 1.4, 0.03]} position={[0.6, 0, 0]}>
        <meshPhysicalMaterial color="#a0c8e8" transparent opacity={0.25} roughness={0.02} transmission={0.5} />
      </Box>
      {/* Divider */}
      <Box args={[0.04, 1.5, 0.06]} position={[0, 0, 0]}>
        <meshStandardMaterial color="#d0ccc6" roughness={0.5} />
      </Box>
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   HALLWAY & NEW INTERIOR COMPONENTS
   ═══════════════════════════════════════════════════════════════════ */

function OfficePrinter({ position, rotation }: { position: [number, number, number]; rotation: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      {/* Body */}
      <RoundedBox args={[0.8, 0.5, 0.6]} radius={0.03} position={[0, 0.6, 0]} castShadow>
        <meshStandardMaterial color="#e0ddd8" roughness={0.5} />
      </RoundedBox>
      {/* Top scanner lid */}
      <Box args={[0.75, 0.04, 0.55]} position={[0, 0.87, 0]}>
        <meshStandardMaterial color="#c8c5c0" roughness={0.4} />
      </Box>
      {/* Paper tray */}
      <Box args={[0.5, 0.06, 0.35]} position={[0, 0.33, 0.15]}>
        <meshStandardMaterial color="#d8d5d0" roughness={0.6} />
      </Box>
      {/* Papers in tray */}
      <Box args={[0.45, 0.03, 0.3]} position={[0, 0.37, 0.15]}>
        <meshStandardMaterial color="#fff" roughness={0.9} />
      </Box>
      {/* Control panel */}
      <Box args={[0.2, 0.08, 0.02]} position={[0.2, 0.82, 0.3]}>
        <meshStandardMaterial color="#1a1a20" roughness={0.3} />
      </Box>
      {/* LED indicator */}
      <Sphere args={[0.015]} position={[0.35, 0.82, 0.31]}>
        <meshStandardMaterial color="#22c55e" emissive="#22c55e" emissiveIntensity={0.8} />
      </Sphere>
      {/* Legs/stand */}
      <Box args={[0.7, 0.35, 0.5]} position={[0, 0.175, 0]}>
        <meshStandardMaterial color="#d0cdc8" roughness={0.5} />
      </Box>
    </group>
  );
}

function CoffeeMachine({ position, rotation }: { position: [number, number, number]; rotation: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      {/* Body */}
      <RoundedBox args={[0.4, 0.55, 0.35]} radius={0.02} position={[0, 0.85, 0]} castShadow>
        <meshStandardMaterial color="#2a2a2e" roughness={0.4} />
      </RoundedBox>
      {/* Water tank (back) */}
      <Box args={[0.3, 0.45, 0.1]} position={[0, 0.8, -0.15]}>
        <meshStandardMaterial color="#6aaae8" transparent opacity={0.4} roughness={0.1} />
      </Box>
      {/* Drip tray */}
      <Box args={[0.3, 0.02, 0.2]} position={[0, 0.58, 0.05]}>
        <meshStandardMaterial color="#3a3a3e" metalness={0.3} roughness={0.4} />
      </Box>
      {/* Cup */}
      <Cylinder args={[0.03, 0.025, 0.07]} position={[0, 0.62, 0.05]}>
        <meshStandardMaterial color="#fff" roughness={0.4} />
      </Cylinder>
      {/* Small table/counter */}
      <Box args={[0.5, 0.58, 0.4]} position={[0, 0.29, 0]}>
        <meshStandardMaterial color="#7a6a5a" roughness={0.7} />
      </Box>
    </group>
  );
}

function BulletinBoard({ position, rotation }: { position: [number, number, number]; rotation: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      {/* Cork board */}
      <Box args={[1.2, 0.9, 0.04]} castShadow>
        <meshStandardMaterial color="#b8956a" roughness={0.95} />
      </Box>
      {/* Frame */}
      {[[-0.6, 0], [0.6, 0]].map(([x], i) => (
        <Box key={`v${i}`} args={[0.04, 0.9, 0.05]} position={[x, 0, 0]}>
          <meshStandardMaterial color="#6a5a4a" roughness={0.7} />
        </Box>
      ))}
      {[[0, -0.45], [0, 0.45]].map(([x, y], i) => (
        <Box key={`h${i}`} args={[1.2, 0.04, 0.05]} position={[x, y, 0]}>
          <meshStandardMaterial color="#6a5a4a" roughness={0.7} />
        </Box>
      ))}
      {/* Sticky notes */}
      {[
        { pos: [-0.3, 0.15, 0.025] as [number, number, number], color: '#ffeb3b' },
        { pos: [0.1, 0.2, 0.025] as [number, number, number], color: '#4fc3f7' },
        { pos: [-0.15, -0.15, 0.025] as [number, number, number], color: '#f48fb1' },
        { pos: [0.3, -0.1, 0.025] as [number, number, number], color: '#a5d6a7' },
        { pos: [0.35, 0.25, 0.025] as [number, number, number], color: '#ffcc80' },
      ].map(({ pos, color }, i) => (
        <Box key={i} args={[0.2, 0.2, 0.005]} position={pos} rotation={[0, 0, (i - 2) * 0.08]}>
          <meshStandardMaterial color={color} roughness={0.9} />
        </Box>
      ))}
      {/* Push pins */}
      {[[-0.3, 0.25], [0.1, 0.3], [-0.15, -0.05], [0.3, 0], [0.35, 0.35]].map(([x, y], i) => (
        <Sphere key={`p${i}`} args={[0.02]} position={[x, y, -0.03]}>
          <meshStandardMaterial color={['#e53935', '#1e88e5', '#e53935', '#43a047', '#ff8f00'][i]} roughness={0.3} />
        </Sphere>
      ))}
    </group>
  );
}

function AnimatedServerRack({ position, rotation }: { position: [number, number, number]; rotation: [number, number, number] }) {
  const ledsRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    if (!ledsRef.current) return;
    const t = state.clock.elapsedTime;
    ledsRef.current.children.forEach((child, i) => {
      if (child instanceof THREE.Mesh && child.material instanceof THREE.MeshStandardMaterial) {
        const blink = Math.sin(t * (3 + i * 1.7) + i * 2.3) > 0.2;
        child.material.emissiveIntensity = blink ? 0.8 : 0.1;
      }
    });
  });

  return (
    <group position={position} rotation={rotation}>
      {/* Rack frame */}
      <RoundedBox args={[0.6, 1.8, 0.5]} radius={0.02} position={[0, 0.9, 0]} castShadow>
        <meshStandardMaterial color="#1a1a22" roughness={0.4} />
      </RoundedBox>
      {/* Server units */}
      {[0.25, 0.55, 0.85, 1.15, 1.45].map((y, i) => (
        <group key={i}>
          <Box args={[0.52, 0.2, 0.02]} position={[0, y, 0.26]}>
            <meshStandardMaterial color="#2a2a32" roughness={0.3} metalness={0.2} />
          </Box>
          {/* Vents */}
          <Box args={[0.15, 0.12, 0.005]} position={[0.18, y, 0.27]}>
            <meshStandardMaterial color="#0a0a12" roughness={0.5} />
          </Box>
        </group>
      ))}
      {/* Animated blinking LEDs */}
      <group ref={ledsRef}>
        {[0.25, 0.55, 0.85, 1.15, 1.45].flatMap((y, ri) =>
          [-0.15, -0.1, -0.05, 0, 0.05].map((lx, li) => (
            <Sphere key={`${ri}-${li}`} args={[0.012]} position={[lx, y, 0.28]}>
              <meshStandardMaterial
                color="#22c55e"
                emissive="#22c55e"
                emissiveIntensity={0.8}
              />
            </Sphere>
          ))
        )}
      </group>
    </group>
  );
}

function Fridge({ position, rotation }: { position: [number, number, number]; rotation: [number, number, number] }) {
  return (
    <group position={position} rotation={rotation}>
      {/* Body */}
      <RoundedBox args={[0.65, 1.7, 0.6]} radius={0.03} position={[0, 0.85, 0]} castShadow>
        <meshStandardMaterial color="#e8e6e2" roughness={0.4} />
      </RoundedBox>
      {/* Door split line */}
      <Box args={[0.6, 0.01, 0.02]} position={[0, 1.15, 0.31]}>
        <meshStandardMaterial color="#c8c6c2" roughness={0.5} />
      </Box>
      {/* Upper handle (freezer) */}
      <Box args={[0.25, 0.02, 0.03]} position={[0.12, 1.5, 0.33]}>
        <meshStandardMaterial color="#aaa" metalness={0.4} roughness={0.3} />
      </Box>
      {/* Lower handle (fridge) */}
      <Box args={[0.25, 0.02, 0.03]} position={[0.12, 0.7, 0.33]}>
        <meshStandardMaterial color="#aaa" metalness={0.4} roughness={0.3} />
      </Box>
      {/* Brand badge */}
      <Box args={[0.12, 0.04, 0.005]} position={[0, 1.62, 0.315]}>
        <meshStandardMaterial color="#bbb" metalness={0.5} roughness={0.2} />
      </Box>
    </group>
  );
}

function StatusLED({ position, status }: { position: [number, number, number]; status: string }) {
  const color = status === 'working' ? '#22c55e' : status === 'walking' ? '#eab308' : '#6b7280';
  return (
    <Sphere args={[0.04]} position={position}>
      <meshStandardMaterial
        color={color}
        emissive={color}
        emissiveIntensity={status === 'idle' ? 0.2 : 0.8}
      />
    </Sphere>
  );
}

function HallwayRunner({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Runner rug */}
      <Box args={[12, 0.01, 1.2]} position={[0, 0.01, 0]} receiveShadow>
        <meshStandardMaterial color="#4a3a5a" roughness={0.95} />
      </Box>
      {/* Border stripes */}
      <Box args={[12, 0.012, 0.06]} position={[0, 0.012, 0.55]}>
        <meshStandardMaterial color="#6a5a7a" roughness={0.9} />
      </Box>
      <Box args={[12, 0.012, 0.06]} position={[0, 0.012, -0.55]}>
        <meshStandardMaterial color="#6a5a7a" roughness={0.9} />
      </Box>
    </group>
  );
}

function LogoFloor({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* Komodo "K" logo on hallway floor */}
      <Text
        position={[0, 0.02, 0]}
        rotation={[-Math.PI / 2, 0, 0]}
        fontSize={0.8}
        color="#5a4a6a"
        anchorX="center"
        anchorY="middle"
        fontWeight={700}
      >
        KOMODO
      </Text>
    </group>
  );
}

/* ═══════════════════════════════════════════════════════════════════
   MAIN SCENE
   ═══════════════════════════════════════════════════════════════════ */

export function Environment3D({ agents, phase, cliHealth }: Environment3DProps) {
  const plannerState = agents?.PLANNER?.status || 'idle';
  const coderState = agents?.CODER?.status || 'idle';
  const reviewerState = agents?.REVIEWER?.status || 'idle';
  const architectState = agents?.ARCHITECT?.status || 'idle';
  const securityState = agents?.SECURITY?.status || 'idle';
  const testerState = agents?.TESTER?.status || 'idle';
  const isAnalyzing = phase === 'analyzing';

  const getAgentCliStatus = (agentName: string): 'available' | 'rate-limited' | 'down' => {
    if (!cliHealth) return 'available';
    const cli = agents?.[agentName]?.cli;
    if (!cli) return 'available';
    return cliHealth[cli]?.status ?? 'available';
  };

  return (
    <group>
      {/* ═══ FLOORS ═══ */}

      {/* Base floor (beneath everything) */}
      <Plane args={[16, 14]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[0, -0.01, 0]}>
        <meshStandardMaterial color="#888" roughness={1} />
      </Plane>

      {/* Office wood floors */}
      <WoodFloor width={9} depth={6} position={[-4.5, 0.01, -4]} />   {/* Planner+Architect */}
      <WoodFloor width={8} depth={6} position={[4, 0.01, -4]} />      {/* Boss */}
      <WoodFloor width={7} depth={6} position={[-5.5, 0.01, 4]} />    {/* Coder+Security */}
      <WoodFloor width={6} depth={6} position={[5, 0.01, 4]} />       {/* Reviewer */}

      {/* Breakroom tile */}
      <TileFloor width={4} depth={6} position={[0, 0.01, 4]} />

      {/* Hallway carpet */}
      <Plane args={[17, 2]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow position={[-0.5, 0.005, 0]}>
        <meshStandardMaterial color={C.carpet} roughness={0.95} />
      </Plane>

      {/* ═══ CEILING WITH LIGHTS ═══ */}

      <CeilingWithLights width={9} depth={6} position={[-4.5, 0, -4]}
        lightPositions={[[-2, 0], [2, 0]]} />
      <CeilingWithLights width={8} depth={6} position={[4, 0, -4]}
        lightPositions={[[0, 0]]} />
      <CeilingWithLights width={4} depth={6} position={[0, 0, 4]}
        lightPositions={[[0, 0]]} />
      <CeilingWithLights width={7} depth={6} position={[-5.5, 0, 4]}
        lightPositions={[[-1, 0], [1.5, 0]]} />
      <CeilingWithLights width={6} depth={6} position={[5, 0, 4]}
        lightPositions={[[0, 0]]} />

      {/* ═══ EXTERIOR WALLS — glass so camera can see inside ═══ */}
      <GlassPartition args={[17.2, 3, 0.1]} position={[-0.5, 0, -7]} vertical />
      <GlassPartition args={[0.1, 3, 14.2]} position={[-9, 0, 0]} vertical />
      <GlassPartition args={[17.2, 3, 0.1]} position={[-0.5, 0, 7]} vertical />
      <GlassPartition args={[0.1, 3, 14.2]} position={[8, 0, 0]} vertical />

      {/* ═══ INTERIOR GLASS PARTITIONS ═══ */}

      {/* --- Z=-1 row: Planner+Architect | Boss --- */}
      {/* Planner+Architect wall (X=-9 to 0, door at X=-1.5) */}
      <GlassPartition args={[6.5, 2.8, 0.08]} position={[-5.75, 0, -1]} vertical />
      <GlassPartition args={[1, 2.8, 0.08]} position={[-0.5, 0, -1]} />
      {/* Boss wall (X=0 to 8, door at X=1.5) */}
      <GlassPartition args={[1, 2.8, 0.08]} position={[0.5, 0, -1]} />
      <GlassPartition args={[5.5, 2.8, 0.08]} position={[5.25, 0, -1]} vertical />

      {/* --- Z=1 row: Coder+Security | Breakroom | Reviewer --- */}
      <GlassPartition args={[5.5, 2.8, 0.08]} position={[-6.25, 0, 1]} vertical />
      <GlassPartition args={[0.5, 2.8, 0.08]} position={[-2.25, 0, 1]} />
      <GlassPartition args={[0.5, 2.8, 0.08]} position={[2.25, 0, 1]} />
      <GlassPartition args={[4.5, 2.8, 0.08]} position={[5.75, 0, 1]} vertical />

      {/* --- Vertical dividers --- */}
      <GlassPartition args={[0.08, 2.8, 6]} position={[0, 0, -4]} vertical />
      <GlassPartition args={[0.08, 2.8, 6]} position={[-2, 0, 4]} vertical />
      <GlassPartition args={[0.08, 2.8, 6]} position={[2, 0, 4]} vertical />

      {/* ═══ HALLWAY (Z=-1 to Z=1) ═══ */}
      <HallwayRunner position={[-0.5, 0, 0]} />
      <LogoFloor position={[-0.5, 0, 0]} />

      {/* Printer against north wall of hallway */}
      <OfficePrinter position={[-6, 0, -0.7]} rotation={[0, 0, 0]} />

      {/* Coffee machine against south wall of hallway */}
      <CoffeeMachine position={[6, 0, 0.7]} rotation={[0, Math.PI, 0]} />

      {/* Bulletin board on back wall of Planner+Architect room */}
      <BulletinBoard position={[-7.5, 1.6, -6.9]} rotation={[0, 0, 0]} />

      {/* ═══ ROOM 1: PLANNER + ARCHITECT (X=-9 to 0, Z=-1 to -7) ═══ */}
      <RoomSign position={[-7, 1.8, -1]} rotation={[0, 0, 0]} label="PLANNER" color="#5a7a9a" />
      <RoomSign position={[-4, 1.8, -1]} rotation={[0, 0, 0]} label="ARCHITECT" color="#4a8a7a" />

      {/* Shared whiteboard on back wall (center) */}
      <AnimatedWhiteboard position={[-4.5, 0, -6.8]} rotation={[0, 0, 0]} isDrawing={plannerState === 'working' || architectState === 'working'} />

      {/* Architect's workstation — against LEFT wall, facing right */}
      <Workstation position={[-7, 0, -3.5]} rotation={[0, Math.PI / 2, 0]} screenColor="#2a5a6a" />
      <StatusLED position={[-7, 1.3, -3]} status={architectState} />

      {/* Filing cabinet against back wall */}
      <FilingCabinet position={[-1.5, 0, -6.5]} rotation={[0, 0, 0]} />
      {/* Plant in corner */}
      <ModernPlant position={[-8.2, 0, -1.5]} size={1.2} />
      {/* Bookshelf against right divider wall (X=0) */}
      <Bookshelf position={[-0.15, 0, -4]} rotation={[0, -Math.PI / 2, 0]} />
      <WallArt position={[-8.9, 1.8, -5.5]} rotation={[0, Math.PI / 2, 0]} color="#4a6a7a" />
      <ModernPlant position={[-0.6, 0, -2]} />

      {/* ═══ ROOM 2: KOMODO BOSS (X=0 to 8, Z=-1 to -7) ═══ */}
      <KomodoBoss position={[4.5, 0, -4]} />
      {/* Bookshelf against left divider wall (X=0) */}
      <Bookshelf position={[0.15, 0, -5]} rotation={[0, Math.PI / 2, 0]} />
      <WindowFrame position={[7.9, 1.8, -4]} rotation={[0, -Math.PI / 2, 0]} />
      {/* Plant in back corner */}
      <ModernPlant position={[7.2, 0, -6.2]} />
      <SonarScanner3D position={[5, 0, -6.5]} isAnalyzing={isAnalyzing} />
      {/* KOMODO sign on glass wall next to door */}
      <RoomSign position={[3.7, 1.8, -1]} rotation={[0, 0, 0]} label="KOMODO" color="#e8c860" />

      {/* ═══ BREAKROOM (X=-2 to 2, Z=1 to 7) ═══ */}
      {/* Sofa against back wall (Z=7), seats 2 — facing south */}
      <ModernSofa position={[0, 0, 6]} rotation={[0, Math.PI, 0]} color={C.sofaLeather} />
      {/* Sofa against right wall (X=2), seats 2 — facing left */}
      <ModernSofa position={[1.3, 0, 4.2]} rotation={[0, -Math.PI / 2, 0]} color={C.armchairFabric} />
      <CoffeeTable position={[0, 0, 4.5]} />
      {/* Vending machine against left wall — agent 5 stands here */}
      <VendingMachine position={[-1.5, 0, 2.5]} rotation={[0, Math.PI / 2, 0]} color="#7a3a3a" />
      {/* Fridge against left wall, next to vending machine */}
      <Fridge position={[-1.6, 0, 5]} rotation={[0, Math.PI / 2, 0]} />
      {/* Water cooler against right wall */}
      <WaterCooler position={[1.7, 0, 2]} rotation={[0, -Math.PI / 2, 0]} />
      <WallClock position={[0, 2.2, 6.9]} rotation={[0, Math.PI, 0]} />
      {/* Small plant in back corner */}
      <ModernPlant position={[1.5, 0, 6.2]} size={0.6} />

      {/* ═══ ROOM 3: CODER + SECURITY (X=-9 to -2, Z=1 to 7) ═══ */}
      <RoomSign position={[-7, 1.8, 1]} rotation={[0, Math.PI, 0]} label="CODER" color="#9a5a5a" />
      <RoomSign position={[-4.8, 1.8, 1]} rotation={[0, Math.PI, 0]} label="SECURITY" color="#3a6a4a" />
      <WindowFrame position={[-8.9, 1.8, 5]} rotation={[0, Math.PI / 2, 0]} />

      {/* Coder workstation — against LEFT wall (back area), facing right */}
      <Workstation position={[-7, 0, 4.7]} rotation={[0, Math.PI / 2, 0]} screenColor="#2a4a6a" mirror />

      {/* Security workstation — against LEFT wall (front area), facing right */}
      <Workstation position={[-4, 0, 4.7]} rotation={[0, Math.PI / 2, 0]} screenColor="#1a4a2a" mirror />

      {/* Security wall monitor — on back wall */}
      <SecurityMonitor position={[-5.5, 0, 6.9]} rotation={[0, Math.PI, 0]} />

      {/* Server rack against left wall */}
      <AnimatedServerRack position={[-8.5, 0, 3]} rotation={[0, Math.PI / 2, 0]} />

      {/* Status LEDs on desks */}
      <StatusLED position={[-7, 1.3, 4.2]} status={coderState} />
      <StatusLED position={[-4, 1.3, 4.2]} status={securityState} />

      {/* Plant in back corner */}
      <ModernPlant position={[-2.5, 0, 6.2]} size={1.1} />
      {/* Filing cabinet against right divider wall */}
      <FilingCabinet position={[-8.5, 0, 1.8]} rotation={[0, Math.PI / 2, 0]} />
      <WallArt position={[-8.9, 1.8, 3.8]} rotation={[0, Math.PI / 2, 0]} color="#3a5a3a" />

      {/* ═══ ROOM 4: REVIEWER (X=2 to 8, Z=1 to 7) ═══ */}
      <RoomSign position={[5, 1.8, 1]} rotation={[0, Math.PI, 0]} label="REVIEWER" color="#7a5a8a" />
      {/* Desk against back wall, facing south */}
      <Workstation position={[5.5, 0, 5]} rotation={[0, Math.PI, 0]} screenColor="#5a3a6a" mirror />
      <StatusLED position={[5.5, 1.3, 5.5]} status={reviewerState} />
      {/* Filing cabinet against right wall */}
      <FilingCabinet position={[7.5, 0, 1.8]} rotation={[0, -Math.PI / 2, 0]} />
      {/* Plant in back corner */}
      <ModernPlant position={[2.8, 0, 6.2]} />
      {/* Bookshelf against left divider wall */}
      {/* Bookshelf against left divider wall (X=2) */}
      <Bookshelf position={[2.15, 0, 4]} rotation={[0, Math.PI / 2, 0]} />
      <WallArt position={[7.9, 1.8, 4.5]} rotation={[0, -Math.PI / 2, 0]} color="#6a4a5a" />

      {/* ═══ ROOM 4 (shared): TESTER workstation near entry ═══ */}
      <RoomSign position={[3, 1.8, 1]} rotation={[0, Math.PI, 0]} label="TESTER" color="#cc5500" />
      {/* Tester desk near room entry, facing south */}
      <Workstation position={[3.5, 0, 3]} rotation={[0, Math.PI, 0]} screenColor="#7a3a00" />
      <StatusLED position={[3.5, 1.3, 3.5]} status={testerState} />

      {/* ═══ AGENTS ═══ */}

      {/* PLANNER — sofa back-wall left seat → whiteboard [-4.5, -6.8] */}
      <Agent3D
        id="PLANNER"
        status={plannerState}
        shirtColor="#5a7a9a"
        hairColor="#5C4033"
        hairStyle="bun"
        cliStatus={getAgentCliStatus('PLANNER')}
        pathWaypoints={[
          [-0.6, 0, 5.8],
          [-0.5, 0, 2.5],
          [-1.5, 0, 0],
          [-5, 0, -3],
          [-5, 0, -5.8],
        ]}
        rotationWait={[0, Math.PI, 0]}
        rotationWork={[0, Math.PI, 0]}
        isWhiteboard={true}
      />

      {/* ARCHITECT — sofa back-wall right seat → whiteboard [-4.5, -6.8] */}
      <Agent3D
        id="ARCHITECT"
        status={architectState}
        shirtColor="#4a8a7a"
        hairColor="#4a3728"
        hairStyle="short"
        cliStatus={getAgentCliStatus('ARCHITECT')}
        pathWaypoints={[
          [0.6, 0, 5.8],
          [0.5, 0, 2.5],
          [-1.5, 0, 0],
          [-3.5, 0, -3],
          [-3.5, 0, -5.8],
        ]}
        rotationWait={[0, Math.PI, 0]}
        rotationWork={[0, Math.PI, 0]}
        isWhiteboard={true}
      />

      {/* CODER — sofa right-wall upper seat → desk [-7, 4.7] facing right, chair at ~[-8, 4.7] */}
      <Agent3D
        id="CODER"
        status={coderState}
        shirtColor="#9a5a5a"
        hairColor="#c4a040"
        hairStyle="long"
        cliStatus={getAgentCliStatus('CODER')}
        pathWaypoints={[
          [1.3, 0, 4.8],
          [0.5, 0, 2.5],
          [-3, 0, 0],
          [-5.5, 0, 3],
          [-8, 0, 4.7],
        ]}
        rotationWait={[0, -Math.PI / 2, 0]}
        rotationWork={[0, Math.PI / 2, 0]}
      />

      {/* SECURITY — sofa right-wall lower seat → desk [-4, 4.7] facing right, chair at ~[-5, 4.7] */}
      <Agent3D
        id="SECURITY"
        status={securityState}
        shirtColor="#3a6a4a"
        hairColor="#1a1a2e"
        hairStyle="short"
        cliStatus={getAgentCliStatus('SECURITY')}
        pathWaypoints={[
          [1.3, 0, 3.6],
          [0, 0, 2.5],
          [-3, 0, 0],
          [-3.5, 0, 3],
          [-5, 0, 4.7],
        ]}
        rotationWait={[0, -Math.PI / 2, 0]}
        rotationWork={[0, Math.PI / 2, 0]}
      />

      {/* REVIEWER — standing by vending machine → desk [5.5, 5] facing south, chair at ~[5.5, 6] */}
      <Agent3D
        id="REVIEWER"
        status={reviewerState}
        shirtColor="#7a5a8a"
        hairColor="#1a1a1a"
        hairStyle="short"
        cliStatus={getAgentCliStatus('REVIEWER')}
        standWhenIdle
        pathWaypoints={[
          [-1.4, 0, 3.5],
          [0, 0, 2],
          [3, 0, 0],
          [4, 0, 4],
          [5.5, 0, 6],
        ]}
        rotationWait={[0, Math.PI / 3, 0]}
        rotationWork={[0, Math.PI, 0]}
      />

      {/* TESTER — breakroom center → hallway → Room 4 entry → desk [3.5, 3] */}
      <Agent3D
        id="TESTER"
        status={testerState}
        shirtColor="#cc5500"
        hairColor="#ff6600"
        hairStyle="short"
        cliStatus={getAgentCliStatus('TESTER')}
        pathWaypoints={[
          [0, 0, 5],
          [0, 0, 2.5],
          [2.5, 0, 0],
          [3, 0, 2],
          [3.5, 0, 3.5],
        ]}
        rotationWait={[0, -Math.PI / 4, 0]}
        rotationWork={[0, Math.PI, 0]}
      />
    </group>
  );
}
