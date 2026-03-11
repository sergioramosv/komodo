"use client";

import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Box, Sphere, Cylinder, RoundedBox } from '@react-three/drei';
import * as THREE from 'three';

// Mech-dragon color palette
const M = {
  frameDark: '#3a5a3a',
  frameMid: '#4a6a4a',
  panelDark: '#3a6a3a',
  panelMid: '#4a8a4a',
  panelLight: '#5a9a5a',
  joint: '#7a8a7a',
  jointLight: '#8a9a8a',
  glow: '#00ff44',
  glowDim: '#00aa2a',
  eye: '#00ff44',
  metal: '#7a7a82',
  metalLight: '#9a9aa2',
  chair: '#2a2a30',
  chairAccent: '#2a6a2a',
  deskTop: '#5a4838',
  screen: '#00ff44',
  clawMetal: '#8a8a92',
};

export function KomodoBoss({ position }: { position: [number, number, number] }) {
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const tailRef = useRef<THREE.Group>(null);
  const jawRef = useRef<THREE.Group>(null);

  useFrame((state) => {
    const time = state.clock.elapsedTime;
    if (leftArmRef.current && rightArmRef.current) {
      leftArmRef.current.rotation.x = -Math.PI / 2.5 + Math.sin(time * 20) * 0.08;
      rightArmRef.current.rotation.x = -Math.PI / 2.5 + Math.cos(time * 25) * 0.08;
    }
    if (tailRef.current) {
      tailRef.current.rotation.y = Math.sin(time * 2) * 0.2;
    }
    if (jawRef.current) {
      // Subtle jaw movement — opens slightly when "talking"
      jawRef.current.rotation.x = Math.sin(time * 3) > 0.7 ? 0.08 : 0;
    }
  });

  const ei = 0.5; // emissive intensity for glowing parts

  return (
    <group position={position}>

      {/* ═══════════════════════════════════════════
          BOSS CHAIR
          ═══════════════════════════════════════════ */}
      <group>
        {/* 5-star base */}
        {[0, 1, 2, 3, 4].map(i => {
          const a = (i * Math.PI * 2) / 5;
          return (
            <group key={i}>
              <Cylinder args={[0.025, 0.025, 0.45]} position={[Math.sin(a) * 0.3, 0.025, Math.cos(a) * 0.3]} rotation={[0, 0, Math.PI / 2 - a]}>
                <meshStandardMaterial color={M.metal} metalness={0.25} roughness={0.35} />
              </Cylinder>
              <Sphere args={[0.04]} position={[Math.sin(a) * 0.3, 0.04, Math.cos(a) * 0.3]}>
                <meshStandardMaterial color="#222" roughness={0.8} />
              </Sphere>
            </group>
          );
        })}
        <Cylinder args={[0.04, 0.04, 0.35, 8]} position={[0, 0.22, 0]}>
          <meshStandardMaterial color={M.metal} metalness={0.25} roughness={0.35} />
        </Cylinder>
        <RoundedBox args={[0.85, 0.1, 0.8]} radius={0.04} position={[0, 0.45, 0]} castShadow>
          <meshStandardMaterial color={M.chair} roughness={0.85} />
        </RoundedBox>
        <RoundedBox args={[0.8, 1.2, 0.08]} radius={0.04} position={[0, 1.1, -0.38]} castShadow>
          <meshStandardMaterial color={M.chair} roughness={0.85} />
        </RoundedBox>
        {/* Accent stripes */}
        <RoundedBox args={[0.1, 1.0, 0.09]} radius={0.03} position={[0, 1.1, -0.37]}>
          <meshStandardMaterial color={M.chairAccent} roughness={0.5} />
        </RoundedBox>
        {[-0.32, 0.32].map((x, i) => (
          <RoundedBox key={i} args={[0.05, 0.8, 0.09]} radius={0.02} position={[x, 1.1, -0.37]}>
            <meshStandardMaterial color={M.chairAccent} roughness={0.5} />
          </RoundedBox>
        ))}
        <RoundedBox args={[0.35, 0.2, 0.08]} radius={0.04} position={[0, 1.75, -0.38]}>
          <meshStandardMaterial color={M.chair} roughness={0.85} />
        </RoundedBox>
        {/* Armrests */}
        {[-1, 1].map(s => (
          <group key={s}>
            <Cylinder args={[0.025, 0.025, 0.3, 8]} position={[s * 0.42, 0.6, -0.1]}>
              <meshStandardMaterial color={M.metal} metalness={0.2} roughness={0.4} />
            </Cylinder>
            <RoundedBox args={[0.08, 0.03, 0.25]} radius={0.01} position={[s * 0.42, 0.76, -0.05]}>
              <meshStandardMaterial color={M.chair} roughness={0.8} />
            </RoundedBox>
          </group>
        ))}
      </group>

      {/* ═══════════════════════════════════════════
          MECH-DRAGON BODY
          ═══════════════════════════════════════════ */}
      <group position={[0, 0.48, 0]}>

        {/* ── LEGS (sitting) ── */}
        {[-0.18, 0.18].map((x, i) => (
          <group key={i}>
            <RoundedBox args={[0.2, 0.2, 0.5]} radius={0.04} position={[x, 0.12, 0.15]} castShadow>
              <meshStandardMaterial color={M.frameDark} roughness={0.4} metalness={0.2} />
            </RoundedBox>
            {/* Knee joint */}
            <Sphere args={[0.07]} position={[x, 0.12, 0.42]}>
              <meshStandardMaterial color={M.joint} metalness={0.25} roughness={0.35} />
            </Sphere>
            {/* Feet — angular claws */}
            <RoundedBox args={[0.22, 0.06, 0.16]} radius={0.02} position={[x, 0.03, 0.5]} castShadow>
              <meshStandardMaterial color={M.frameMid} roughness={0.4} metalness={0.2} />
            </RoundedBox>
            {/* 3 claw tips */}
            {[-0.06, 0, 0.06].map((cx, j) => (
              <RoundedBox key={j} args={[0.03, 0.04, 0.1]} radius={0.01} position={[x + cx, 0.02, 0.6]}>
                <meshStandardMaterial color={M.clawMetal} metalness={0.3} roughness={0.3} />
              </RoundedBox>
            ))}
          </group>
        ))}

        {/* ── TORSO — armored chassis ── */}
        <RoundedBox args={[0.58, 0.7, 0.45]} radius={0.08} position={[0, 0.58, 0]} castShadow receiveShadow>
          <meshStandardMaterial color={M.frameDark} roughness={0.4} metalness={0.2} />
        </RoundedBox>
        {/* Front chest plate */}
        <RoundedBox args={[0.44, 0.5, 0.04]} radius={0.04} position={[0, 0.6, 0.22]}>
          <meshStandardMaterial color={M.panelMid} roughness={0.45} metalness={0.2} />
        </RoundedBox>
        {/* Power core — glowing reactor */}
        <Cylinder args={[0.08, 0.08, 0.03, 16]} position={[0, 0.65, 0.25]} rotation={[Math.PI / 2, 0, 0]}>
          <meshStandardMaterial color={M.glow} emissive={M.glow} emissiveIntensity={ei} />
        </Cylinder>
        <Cylinder args={[0.05, 0.05, 0.035, 16]} position={[0, 0.65, 0.255]} rotation={[Math.PI / 2, 0, 0]}>
          <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei * 0.3} />
        </Cylinder>
        {/* Glow light from core */}
        <pointLight position={[0, 0.65, 0.4]} intensity={1} distance={1.5} color={M.glow} />

        {/* Back armor panels */}
        {[0.4, 0.6, 0.8].map((y, i) => (
          <RoundedBox key={i} args={[0.42, 0.04, 0.04]} radius={0.015} position={[0, y, -0.2]}>
            <meshStandardMaterial color={M.panelLight} roughness={0.45} metalness={0.2} />
          </RoundedBox>
        ))}
        {/* Side vents */}
        {[-1, 1].map(s => (
          <group key={s} position={[s * 0.3, 0.6, 0]}>
            {[-0.06, 0, 0.06].map((vy, i) => (
              <RoundedBox key={i} args={[0.02, 0.03, 0.25]} radius={0.005} position={[0, vy, 0]}>
                <meshStandardMaterial color={M.jointLight} metalness={0.2} roughness={0.4} />
              </RoundedBox>
            ))}
          </group>
        ))}

        {/* Waist ring */}
        <Cylinder args={[0.24, 0.26, 0.06, 16]} position={[0, 0.22, 0]}>
          <meshStandardMaterial color={M.joint} metalness={0.25} roughness={0.35} />
        </Cylinder>

        {/* ── TAIL — segmented mech tail ── */}
        <group ref={tailRef} position={[0, 0.25, -0.22]}>
          {/* Segment 1 */}
          <RoundedBox args={[0.14, 0.14, 0.3]} radius={0.04} position={[0, 0, -0.15]} castShadow>
            <meshStandardMaterial color={M.frameDark} roughness={0.4} metalness={0.2} />
          </RoundedBox>
          <Sphere args={[0.055]} position={[0, 0, -0.32]}>
            <meshStandardMaterial color={M.joint} metalness={0.25} roughness={0.35} />
          </Sphere>
          {/* Segment 2 */}
          <RoundedBox args={[0.1, 0.1, 0.25]} radius={0.03} position={[0, 0, -0.48]} castShadow>
            <meshStandardMaterial color={M.frameMid} roughness={0.4} metalness={0.2} />
          </RoundedBox>
          <Sphere args={[0.04]} position={[0, 0, -0.62]}>
            <meshStandardMaterial color={M.joint} metalness={0.25} roughness={0.35} />
          </Sphere>
          {/* Segment 3 — tip */}
          <RoundedBox args={[0.06, 0.06, 0.2]} radius={0.02} position={[0, 0, -0.74]} castShadow>
            <meshStandardMaterial color={M.frameDark} roughness={0.4} metalness={0.2} />
          </RoundedBox>
          {/* Tail tip glow */}
          <Sphere args={[0.035]} position={[0, 0, -0.86]}>
            <meshStandardMaterial color={M.glow} emissive={M.glow} emissiveIntensity={0.3} />
          </Sphere>
          {/* Dorsal fin plates on tail */}
          {[-0.22, -0.42, -0.6].map((z, i) => (
            <RoundedBox key={i} args={[0.03, 0.08 - i * 0.015, 0.06]} radius={0.01} position={[0, 0.1 - i * 0.02, z]}>
              <meshStandardMaterial color={M.panelLight} roughness={0.45} metalness={0.2} />
            </RoundedBox>
          ))}
        </group>

        {/* ── HEAD — robotic dragon head ── */}
        <group position={[0, 1.08, 0.08]}>
          {/* Skull casing */}
          <RoundedBox args={[0.5, 0.4, 0.42]} radius={0.08} position={[0, 0, 0]} castShadow receiveShadow>
            <meshStandardMaterial color={M.frameDark} roughness={0.4} metalness={0.2} />
          </RoundedBox>

          {/* Upper snout — angular, mechanical */}
          <RoundedBox args={[0.38, 0.16, 0.35]} radius={0.05} position={[0, -0.02, 0.32]} castShadow>
            <meshStandardMaterial color={M.frameMid} roughness={0.4} metalness={0.2} />
          </RoundedBox>
          {/* Snout tip plate */}
          <RoundedBox args={[0.3, 0.1, 0.06]} radius={0.03} position={[0, -0.02, 0.52]}>
            <meshStandardMaterial color={M.panelMid} roughness={0.45} metalness={0.2} />
          </RoundedBox>
          {/* Nostrils — glowing slits */}
          {[-0.08, 0.08].map((x, i) => (
            <RoundedBox key={i} args={[0.04, 0.02, 0.02]} radius={0.008} position={[x, 0.02, 0.56]}>
              <meshStandardMaterial color={M.glow} emissive={M.glow} emissiveIntensity={0.2} />
            </RoundedBox>
          ))}

          {/* Lower jaw — animated */}
          <group ref={jawRef} position={[0, -0.12, 0.2]}>
            <RoundedBox args={[0.34, 0.08, 0.32]} radius={0.03} position={[0, 0, 0.05]} castShadow>
              <meshStandardMaterial color={M.frameDark} roughness={0.4} metalness={0.2} />
            </RoundedBox>
            {/* Teeth — small metal triangles */}
            {[-0.1, -0.04, 0.04, 0.1].map((x, i) => (
              <RoundedBox key={i} args={[0.025, 0.04, 0.02]} radius={0.005} position={[x, 0.05, 0.2]}>
                <meshStandardMaterial color={M.clawMetal} metalness={0.3} roughness={0.3} />
              </RoundedBox>
            ))}
          </group>
          {/* Upper teeth */}
          {[-0.1, -0.04, 0.04, 0.1].map((x, i) => (
            <RoundedBox key={i} args={[0.025, 0.04, 0.02]} radius={0.005} position={[x, -0.12, 0.42]}>
              <meshStandardMaterial color={M.clawMetal} metalness={0.3} roughness={0.3} />
            </RoundedBox>
          ))}

          {/* Eyes — glowing green with vertical slit */}
          {[-1, 1].map(s => (
            <group key={s} position={[s * 0.23, 0.06, 0.14]}>
              {/* Eye socket */}
              <RoundedBox args={[0.14, 0.1, 0.08]} radius={0.03}>
                <meshStandardMaterial color="#2a2a30" roughness={0.3} metalness={0.2} />
              </RoundedBox>
              {/* Glowing eye */}
              <RoundedBox args={[0.1, 0.07, 0.02]} radius={0.02} position={[0, 0, 0.04]}>
                <meshStandardMaterial color={M.eye} emissive={M.eye} emissiveIntensity={0.6} />
              </RoundedBox>
              {/* Vertical slit pupil */}
              <RoundedBox args={[0.015, 0.06, 0.025]} radius={0.005} position={[0, 0, 0.05]}>
                <meshStandardMaterial color="#000" />
              </RoundedBox>
              {/* Eye glow */}
              <pointLight position={[0, 0, 0.1]} intensity={0.3} distance={0.5} color={M.eye} />
            </group>
          ))}

          {/* Dorsal crest — angular fin plates */}
          {[0, 0.08, 0.16].map((z, i) => (
            <RoundedBox key={i} args={[0.03, 0.14 - i * 0.02, 0.05]} radius={0.01} position={[0, 0.24 - i * 0.015, -0.08 + z]}>
              <meshStandardMaterial color={M.panelLight} roughness={0.45} metalness={0.2} />
            </RoundedBox>
          ))}

          {/* Brow ridges — angular armor */}
          {[-1, 1].map(s => (
            <RoundedBox key={s} args={[0.14, 0.04, 0.12]} radius={0.015} position={[s * 0.18, 0.14, 0.1]}>
              <meshStandardMaterial color={M.panelMid} roughness={0.45} metalness={0.2} />
            </RoundedBox>
          ))}
        </group>

        {/* ── ARMS — mechanical ── */}
        <group ref={leftArmRef} position={[-0.38, 0.78, 0]}>
          <Sphere args={[0.08]}>
            <meshStandardMaterial color={M.joint} metalness={0.25} roughness={0.35} />
          </Sphere>
          <RoundedBox args={[0.15, 0.36, 0.15]} radius={0.04} position={[0, -0.22, 0]} castShadow>
            <meshStandardMaterial color={M.frameDark} roughness={0.4} metalness={0.2} />
          </RoundedBox>
          <Sphere args={[0.06]} position={[0, -0.42, 0]}>
            <meshStandardMaterial color={M.joint} metalness={0.25} roughness={0.35} />
          </Sphere>
          <RoundedBox args={[0.13, 0.2, 0.13]} radius={0.03} position={[0, -0.55, 0]} castShadow>
            <meshStandardMaterial color={M.frameMid} roughness={0.4} metalness={0.2} />
          </RoundedBox>
          {/* Claw hand */}
          <RoundedBox args={[0.14, 0.06, 0.12]} radius={0.02} position={[0, -0.68, 0.02]}>
            <meshStandardMaterial color={M.frameDark} roughness={0.4} metalness={0.2} />
          </RoundedBox>
          {[-0.04, 0.04].map((cx, i) => (
            <RoundedBox key={i} args={[0.025, 0.06, 0.04]} radius={0.008} position={[cx, -0.72, 0.06]}>
              <meshStandardMaterial color={M.clawMetal} metalness={0.3} roughness={0.3} />
            </RoundedBox>
          ))}
        </group>

        <group ref={rightArmRef} position={[0.38, 0.78, 0]}>
          <Sphere args={[0.08]}>
            <meshStandardMaterial color={M.joint} metalness={0.25} roughness={0.35} />
          </Sphere>
          <RoundedBox args={[0.15, 0.36, 0.15]} radius={0.04} position={[0, -0.22, 0]} castShadow>
            <meshStandardMaterial color={M.frameDark} roughness={0.4} metalness={0.2} />
          </RoundedBox>
          <Sphere args={[0.06]} position={[0, -0.42, 0]}>
            <meshStandardMaterial color={M.joint} metalness={0.25} roughness={0.35} />
          </Sphere>
          <RoundedBox args={[0.13, 0.2, 0.13]} radius={0.03} position={[0, -0.55, 0]} castShadow>
            <meshStandardMaterial color={M.frameMid} roughness={0.4} metalness={0.2} />
          </RoundedBox>
          <RoundedBox args={[0.14, 0.06, 0.12]} radius={0.02} position={[0, -0.68, 0.02]}>
            <meshStandardMaterial color={M.frameDark} roughness={0.4} metalness={0.2} />
          </RoundedBox>
          {[-0.04, 0.04].map((cx, i) => (
            <RoundedBox key={i} args={[0.025, 0.06, 0.04]} radius={0.008} position={[cx, -0.72, 0.06]}>
              <meshStandardMaterial color={M.clawMetal} metalness={0.3} roughness={0.3} />
            </RoundedBox>
          ))}
        </group>
      </group>

      {/* ═══════════════════════════════════════════
          BOSS DESK — L-shape multi-monitor
          ═══════════════════════════════════════════ */}
      <group position={[0, 0, 0.2]}>
        {/* Main desktop */}
        <RoundedBox args={[2.4, 0.06, 0.9]} radius={0.02} position={[0, 0.78, 1]} castShadow receiveShadow>
          <meshStandardMaterial color={M.deskTop} roughness={0.5} />
        </RoundedBox>
        {/* L-wing */}
        <RoundedBox args={[0.9, 0.06, 1.8]} radius={0.02} position={[-1.65, 0.78, 0.45]} castShadow>
          <meshStandardMaterial color={M.deskTop} roughness={0.5} />
        </RoundedBox>
        {/* Metal legs */}
        {[[-1.05, 0.65], [1.05, 0.65], [-2, -0.3]].map(([x, z], i) => (
          <Box key={i} args={[0.06, 0.76, 0.06]} position={[x, 0.39, z]} castShadow>
            <meshStandardMaterial color={M.metal} metalness={0.2} roughness={0.4} />
          </Box>
        ))}

        {/* Ultrawide monitor */}
        <RoundedBox args={[1.6, 0.65, 0.04]} radius={0.02} position={[0, 1.2, 1.35]} castShadow>
          <meshStandardMaterial color="#1a1a1e" roughness={0.3} />
        </RoundedBox>
        <RoundedBox args={[1.5, 0.55, 0.02]} radius={0.02} position={[0, 1.2, 1.33]}>
          <meshStandardMaterial color="#001a00" emissive={M.screen} emissiveIntensity={0.35} roughness={0.1} />
        </RoundedBox>
        <Box args={[0.08, 0.25, 0.08]} position={[0, 0.93, 1.35]}>
          <meshStandardMaterial color={M.metal} metalness={0.25} roughness={0.35} />
        </Box>

        {/* Side monitor */}
        <RoundedBox args={[0.65, 0.5, 0.04]} radius={0.02} position={[-1.35, 1.15, 1.1]} rotation={[0, -0.5, 0]} castShadow>
          <meshStandardMaterial color="#1a1a1e" roughness={0.3} />
        </RoundedBox>
        <RoundedBox args={[0.55, 0.4, 0.02]} radius={0.02} position={[-1.35, 1.15, 1.08]} rotation={[0, -0.5, 0]}>
          <meshStandardMaterial color="#001a00" emissive={M.screen} emissiveIntensity={0.25} roughness={0.1} />
        </RoundedBox>

        {/* Keyboard */}
        <RoundedBox args={[0.55, 0.03, 0.18]} radius={0.01} position={[0, 0.82, 0.8]}>
          <meshStandardMaterial color="#1a1a1e" roughness={0.5} />
        </RoundedBox>
        {/* Mouse */}
        <RoundedBox args={[0.06, 0.025, 0.1]} radius={0.01} position={[0.45, 0.8, 0.8]}>
          <meshStandardMaterial color="#1a1a1e" roughness={0.5} />
        </RoundedBox>
        {/* Coffee mug */}
        <Cylinder args={[0.045, 0.04, 0.1, 12]} position={[0.85, 0.86, 0.85]} castShadow>
          <meshStandardMaterial color="#cc3333" roughness={0.5} />
        </Cylinder>

        {/* Screen glow */}
        <pointLight position={[0, 1.3, 0.9]} intensity={2.5} distance={3} color="#44ff66" />
      </group>
    </group>
  );
}
