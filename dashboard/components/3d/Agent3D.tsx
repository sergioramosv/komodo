"use client";

import React, { useRef, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Box, Sphere, Cylinder, RoundedBox, Plane } from '@react-three/drei';
import * as THREE from 'three';

interface Agent3DProps {
  id: string;
  status: 'idle' | 'working' | 'walking';
  hairColor: string;   // used as accent color for the robot
  shirtColor: string;  // main body color
  hairStyle: 'short' | 'long' | 'bun'; // ignored for robots
  pathWaypoints: [number, number, number][];
  rotationWork: [number, number, number];
  rotationWait: [number, number, number];
  isWhiteboard?: boolean;
  standWhenIdle?: boolean;
  cliStatus?: 'available' | 'rate-limited' | 'down';
}

const CLI_STATUS_COLORS: Record<string, string> = {
  available: '#22c55e',
  'rate-limited': '#eab308',
  down: '#ef4444',
};

const LERP_SPEED = 3.5;

// Robot face expressions per agent
const FACE_ICONS: Record<string, string> = {
  PLANNER: '📋',
  CODER: '</>',
  REVIEWER: '✓',
  ARCHITECT: '⚙',
  SECURITY: '🛡',
  TESTER: '🐛',
};

export function Agent3D({ id, status, hairColor, shirtColor, pathWaypoints, rotationWork, rotationWait, isWhiteboard, standWhenIdle, cliStatus = 'available' }: Agent3DProps) {
  const groupRef = useRef<THREE.Group>(null);
  const indicatorRef = useRef<THREE.Mesh>(null);
  const screenRef = useRef<THREE.Group>(null);

  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);

  const [waypointIndex, setWaypointIndex] = useState(status === 'working' ? pathWaypoints.length - 1 : 0);
  const targetIndex = status === 'working' ? pathWaypoints.length - 1 : 0;
  const isAtDestination = waypointIndex === targetIndex;

  const targetRotation = useMemo(() => new THREE.Euler(...(status === 'working' ? rotationWork : rotationWait)), [status, rotationWork, rotationWait]);

  const accent = hairColor; // repurpose as accent/trim color
  const metalDark = '#909098';
  const metalMid = '#b0b0b8';
  const metalLight = '#c8c8d0';
  const screenGlow = shirtColor;

  useFrame((state, delta) => {
    if (!groupRef.current) return;

    const isSitting = status !== 'walking' && (!isWhiteboard || status !== 'working') && !standWhenIdle && isAtDestination;

    const currentWaypoint = new THREE.Vector3(...pathWaypoints[waypointIndex]);
    currentWaypoint.y = isSitting ? -0.2 : 0;

    const distToWaypoint = groupRef.current.position.distanceTo(currentWaypoint);

    if (distToWaypoint < 0.2 && !isAtDestination) {
      setWaypointIndex(prev => prev < targetIndex ? prev + 1 : prev - 1);
    }

    groupRef.current.position.lerp(currentWaypoint, delta * LERP_SPEED);

    let quatTarget = new THREE.Quaternion().setFromEuler(targetRotation);

    if (!isAtDestination && distToWaypoint > 0.5) {
      const dir = currentWaypoint.clone().sub(groupRef.current.position).normalize();
      const angle = Math.atan2(dir.x, dir.z);
      quatTarget = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    }

    groupRef.current.quaternion.slerp(quatTarget, delta * LERP_SPEED);

    const time = state.clock.elapsedTime;
    const isWalking = !isAtDestination || distToWaypoint > 0.1;

    const walkSpeed = 12;
    const walkAngle = Math.sin(time * walkSpeed) * 0.4;

    if (leftArmRef.current && rightArmRef.current && leftLegRef.current && rightLegRef.current) {
      if (isWalking) {
        leftArmRef.current.rotation.x = walkAngle;
        rightArmRef.current.rotation.x = -walkAngle;
        leftLegRef.current.rotation.x = -walkAngle;
        rightLegRef.current.rotation.x = walkAngle;
        leftArmRef.current.rotation.z = 0;
        rightArmRef.current.rotation.z = 0;
      } else if (status === 'working') {
        if (isSitting) {
          leftLegRef.current.rotation.x = -Math.PI / 2;
          rightLegRef.current.rotation.x = -Math.PI / 2;
        } else {
          leftLegRef.current.rotation.x = 0;
          rightLegRef.current.rotation.x = 0;
        }

        if (isWhiteboard) {
          leftArmRef.current.rotation.x = -0.2;
          rightArmRef.current.rotation.x = -Math.PI / 1.5 + Math.sin(time * 8) * 0.2;
          rightArmRef.current.rotation.z = 0.2 + Math.cos(time * 6) * 0.1;
        } else {
          const typeAngle = -Math.PI / 2.5;
          leftArmRef.current.rotation.x = typeAngle + Math.sin(time * 20) * 0.05;
          rightArmRef.current.rotation.x = typeAngle + Math.cos(time * 25) * 0.05;
          leftArmRef.current.rotation.z = 0.1;
          rightArmRef.current.rotation.z = -0.1;
        }
      } else {
        if (isSitting) {
          leftLegRef.current.rotation.x = -Math.PI / 2;
          rightLegRef.current.rotation.x = -Math.PI / 2;
        } else {
          leftLegRef.current.rotation.x = 0;
          rightLegRef.current.rotation.x = 0;
        }
        // Idle: subtle mechanical sway
        const idle = Math.sin(time * 1.2) * 0.02;
        leftArmRef.current.rotation.x = idle;
        rightArmRef.current.rotation.x = -idle;
        leftArmRef.current.rotation.z = 0;
        rightArmRef.current.rotation.z = 0;
      }
    }

    // Screen flicker when working
    if (screenRef.current) {
      if (status === 'working') {
        const flicker = 0.3 + Math.sin(time * 6) * 0.1;
        screenRef.current.children.forEach(child => {
          if ((child as THREE.Mesh).material && 'emissiveIntensity' in (child as THREE.Mesh).material) {
            ((child as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = flicker;
          }
        });
      }
    }

    // CLI status indicator
    if (indicatorRef.current) {
      indicatorRef.current.position.y = 2.45 + Math.sin(time * 2) * 0.05;
      if (cliStatus === 'rate-limited') {
        const pulse = 1 + Math.sin(time * 4) * 0.3;
        indicatorRef.current.scale.setScalar(pulse);
      } else {
        indicatorRef.current.scale.setScalar(1);
      }
    }
  });

  const isAtDesk = status === 'working' && !isWhiteboard && isAtDestination;
  const indicatorColor = CLI_STATUS_COLORS[cliStatus] ?? CLI_STATUS_COLORS.available;
  const isWorking = status === 'working';
  const ei = isWorking ? 0.6 : 0.25; // emissive intensity for face elements

  return (
    <group ref={groupRef} position={pathWaypoints[0]}>

      {/* ══════════════════════════════════════════
          HEAD — Rounded box with screen face
          ══════════════════════════════════════════ */}
      <group position={[0, 1.7, 0]}>
        {/* Main head casing */}
        <RoundedBox args={[0.6, 0.55, 0.5]} radius={0.08} position={[0, 0, 0]} castShadow receiveShadow>
          <meshStandardMaterial color={metalDark} roughness={0.4} metalness={0.2} />
        </RoundedBox>

        {/* Front face plate — slightly inset */}
        <RoundedBox args={[0.52, 0.42, 0.04]} radius={0.04} position={[0, -0.02, 0.24]}>
          <meshStandardMaterial color="#3a3a48" roughness={0.2} metalness={0.15} />
        </RoundedBox>

        {/* Screen / visor */}
        <group ref={screenRef}>
          <RoundedBox args={[0.46, 0.34, 0.02]} radius={0.03} position={[0, -0.02, 0.26]}>
            <meshStandardMaterial
              color={screenGlow}
              emissive={screenGlow}
              emissiveIntensity={isWorking ? 0.35 : 0.15}
              roughness={0.1}
            />
          </RoundedBox>
        </group>

        {/* ── UNIQUE FACE PER AGENT ── */}
        {id === 'PLANNER' && (
          /* PLANNER: Wide analytical eyes + grid lines on screen */
          <group>
            {/* Wide rectangle eyes */}
            <RoundedBox args={[0.14, 0.08, 0.01]} radius={0.02} position={[-0.11, 0.03, 0.28]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei} />
            </RoundedBox>
            <RoundedBox args={[0.14, 0.08, 0.01]} radius={0.02} position={[0.11, 0.03, 0.28]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei} />
            </RoundedBox>
            {/* Thin line mouth — thoughtful */}
            <RoundedBox args={[0.14, 0.02, 0.01]} radius={0.008} position={[0, -0.1, 0.28]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei * 0.6} />
            </RoundedBox>
            {/* Grid lines on screen */}
            {[-0.1, 0, 0.1].map((x, i) => (
              <RoundedBox key={`v${i}`} args={[0.008, 0.3, 0.005]} radius={0.002} position={[x, -0.02, 0.275]}>
                <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei * 0.15} transparent opacity={0.3} />
              </RoundedBox>
            ))}
            {[-0.06, 0.06].map((y, i) => (
              <RoundedBox key={`h${i}`} args={[0.42, 0.008, 0.005]} radius={0.002} position={[0, y, 0.275]}>
                <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei * 0.15} transparent opacity={0.3} />
              </RoundedBox>
            ))}
          </group>
        )}

        {id === 'CODER' && (
          /* CODER: </> bracket eyes + terminal cursor mouth */
          <group>
            {/* Left eye: < */}
            <RoundedBox args={[0.1, 0.03, 0.01]} radius={0.01} position={[-0.14, 0.06, 0.28]} rotation={[0, 0, 0.5]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei} />
            </RoundedBox>
            <RoundedBox args={[0.1, 0.03, 0.01]} radius={0.01} position={[-0.14, -0.02, 0.28]} rotation={[0, 0, -0.5]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei} />
            </RoundedBox>
            {/* Right eye: > */}
            <RoundedBox args={[0.1, 0.03, 0.01]} radius={0.01} position={[0.14, 0.06, 0.28]} rotation={[0, 0, -0.5]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei} />
            </RoundedBox>
            <RoundedBox args={[0.1, 0.03, 0.01]} radius={0.01} position={[0.14, -0.02, 0.28]} rotation={[0, 0, 0.5]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei} />
            </RoundedBox>
            {/* Slash between */}
            <RoundedBox args={[0.03, 0.14, 0.01]} radius={0.01} position={[0, 0.02, 0.28]} rotation={[0, 0, 0.2]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei * 0.7} />
            </RoundedBox>
            {/* Terminal cursor mouth */}
            <RoundedBox args={[0.08, 0.1, 0.01]} radius={0.01} position={[0, -0.12, 0.28]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei * 0.5} />
            </RoundedBox>
          </group>
        )}

        {id === 'REVIEWER' && (
          /* REVIEWER: One square eye + one circle monocle eye + checkmark mouth */
          <group>
            {/* Left eye: square */}
            <RoundedBox args={[0.09, 0.09, 0.01]} radius={0.02} position={[-0.12, 0.03, 0.28]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei} />
            </RoundedBox>
            {/* Right eye: monocle ring */}
            <Cylinder args={[0.08, 0.08, 0.01, 16]} position={[0.12, 0.03, 0.28]} rotation={[Math.PI / 2, 0, 0]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei * 0.5} />
            </Cylinder>
            <Cylinder args={[0.055, 0.055, 0.012, 16]} position={[0.12, 0.03, 0.282]} rotation={[Math.PI / 2, 0, 0]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei} />
            </Cylinder>
            {/* Monocle handle */}
            <RoundedBox args={[0.015, 0.1, 0.01]} radius={0.005} position={[0.2, -0.02, 0.28]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei * 0.3} />
            </RoundedBox>
            {/* Checkmark mouth */}
            <RoundedBox args={[0.06, 0.03, 0.01]} radius={0.008} position={[-0.02, -0.12, 0.28]} rotation={[0, 0, -0.4]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei * 0.5} />
            </RoundedBox>
            <RoundedBox args={[0.1, 0.03, 0.01]} radius={0.008} position={[0.06, -0.1, 0.28]} rotation={[0, 0, 0.5]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei * 0.5} />
            </RoundedBox>
          </group>
        )}

        {id === 'ARCHITECT' && (
          /* ARCHITECT: Crosshair/plus eyes + small square mouth */
          <group>
            {/* Left eye: + crosshair */}
            <RoundedBox args={[0.12, 0.025, 0.01]} radius={0.008} position={[-0.12, 0.03, 0.28]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei} />
            </RoundedBox>
            <RoundedBox args={[0.025, 0.12, 0.01]} radius={0.008} position={[-0.12, 0.03, 0.28]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei} />
            </RoundedBox>
            {/* Right eye: + crosshair */}
            <RoundedBox args={[0.12, 0.025, 0.01]} radius={0.008} position={[0.12, 0.03, 0.28]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei} />
            </RoundedBox>
            <RoundedBox args={[0.025, 0.12, 0.01]} radius={0.008} position={[0.12, 0.03, 0.28]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei} />
            </RoundedBox>
            {/* Blueprint scan lines */}
            <RoundedBox args={[0.42, 0.006, 0.005]} radius={0.002} position={[0, 0.1, 0.275]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei * 0.15} transparent opacity={0.3} />
            </RoundedBox>
            <RoundedBox args={[0.42, 0.006, 0.005]} radius={0.002} position={[0, -0.05, 0.275]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei * 0.15} transparent opacity={0.3} />
            </RoundedBox>
            {/* Small square mouth */}
            <RoundedBox args={[0.06, 0.04, 0.01]} radius={0.01} position={[0, -0.12, 0.28]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei * 0.4} />
            </RoundedBox>
          </group>
        )}

        {id === 'SECURITY' && (
          /* SECURITY: Narrow slit eyes + shield + stern mouth */
          <group>
            {/* Narrow slit eyes */}
            <RoundedBox args={[0.14, 0.04, 0.01]} radius={0.015} position={[-0.11, 0.04, 0.28]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei} />
            </RoundedBox>
            <RoundedBox args={[0.14, 0.04, 0.01]} radius={0.015} position={[0.11, 0.04, 0.28]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei} />
            </RoundedBox>
            {/* Shield icon below eyes */}
            <RoundedBox args={[0.12, 0.1, 0.01]} radius={0.02} position={[0, -0.06, 0.28]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei * 0.2} />
            </RoundedBox>
            <RoundedBox args={[0.08, 0.06, 0.012]} radius={0.015} position={[0, -0.04, 0.282]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei * 0.4} />
            </RoundedBox>
            {/* Stern line mouth */}
            <RoundedBox args={[0.16, 0.025, 0.01]} radius={0.01} position={[0, -0.14, 0.28]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei * 0.4} />
            </RoundedBox>
          </group>
        )}

        {id === 'TESTER' && (
          /* TESTER: Big round bug-inspector eyes + coil antennas + curved smile */
          <group>
            {/* Left eye — large round sphere */}
            <Sphere args={[0.07, 12, 12]} position={[-0.11, 0.04, 0.28]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei} />
            </Sphere>
            {/* Left pupil */}
            <Sphere args={[0.035, 10, 10]} position={[-0.11, 0.04, 0.295]}>
              <meshStandardMaterial color="#ff6600" emissive="#ff6600" emissiveIntensity={ei * 0.8} />
            </Sphere>
            {/* Right eye — large round sphere */}
            <Sphere args={[0.07, 12, 12]} position={[0.11, 0.04, 0.28]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei} />
            </Sphere>
            {/* Right pupil */}
            <Sphere args={[0.035, 10, 10]} position={[0.11, 0.04, 0.295]}>
              <meshStandardMaterial color="#ff6600" emissive="#ff6600" emissiveIntensity={ei * 0.8} />
            </Sphere>
            {/* Curved smile — angled RoundedBoxes forming arc */}
            <RoundedBox args={[0.08, 0.025, 0.01]} radius={0.008} position={[-0.07, -0.1, 0.28]} rotation={[0, 0, 0.5]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei * 0.6} />
            </RoundedBox>
            <RoundedBox args={[0.06, 0.025, 0.01]} radius={0.008} position={[0, -0.12, 0.28]} rotation={[0, 0, 0]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei * 0.6} />
            </RoundedBox>
            <RoundedBox args={[0.08, 0.025, 0.01]} radius={0.008} position={[0.07, -0.1, 0.28]} rotation={[0, 0, -0.5]}>
              <meshStandardMaterial color="#fff" emissive="#fff" emissiveIntensity={ei * 0.6} />
            </RoundedBox>
            {/* Coil antenna left — rizado decoration on head top */}
            <Cylinder args={[0.018, 0.018, 0.06, 8]} position={[-0.1, 0.29, 0]} rotation={[0, 0, 0.3]}>
              <meshStandardMaterial color="#ff6600" roughness={0.4} metalness={0.2} />
            </Cylinder>
            <Sphere args={[0.028, 10, 10]} position={[-0.12, 0.34, 0]}>
              <meshStandardMaterial color="#ff6600" emissive="#ff6600" emissiveIntensity={0.4} />
            </Sphere>
            {/* Coil antenna right */}
            <Cylinder args={[0.018, 0.018, 0.06, 8]} position={[0.1, 0.29, 0]} rotation={[0, 0, -0.3]}>
              <meshStandardMaterial color="#ff6600" roughness={0.4} metalness={0.2} />
            </Cylinder>
            <Sphere args={[0.028, 10, 10]} position={[0.12, 0.34, 0]}>
              <meshStandardMaterial color="#ff6600" emissive="#ff6600" emissiveIntensity={0.4} />
            </Sphere>
          </group>
        )}

        {/* Accent stripe on top */}
        <RoundedBox args={[0.5, 0.04, 0.42]} radius={0.02} position={[0, 0.26, 0]}>
          <meshStandardMaterial color={accent} roughness={0.4} metalness={0.2} />
        </RoundedBox>

        {/* Antenna */}
        <Cylinder args={[0.02, 0.02, 0.2, 8]} position={[0, 0.38, 0]} castShadow>
          <meshStandardMaterial color={metalMid} metalness={0.25} roughness={0.35} />
        </Cylinder>
        <Sphere args={[0.045, 12, 12]} position={[0, 0.5, 0]}>
          <meshStandardMaterial
            color={indicatorColor}
            emissive={indicatorColor}
            emissiveIntensity={0.6}
          />
        </Sphere>

        {/* Side vents */}
        {[-1, 1].map(side => (
          <group key={side} position={[side * 0.31, 0, 0]}>
            {[0.08, 0, -0.08].map((vy, i) => (
              <RoundedBox key={i} args={[0.02, 0.03, 0.2]} radius={0.005} position={[0, vy, 0]}>
                <meshStandardMaterial color={metalMid} metalness={0.2} roughness={0.4} />
              </RoundedBox>
            ))}
          </group>
        ))}
      </group>

      {/* ══════════════════════════════════════════
          NECK — short piston
          ══════════════════════════════════════════ */}
      <Cylinder args={[0.08, 0.1, 0.12, 8]} position={[0, 1.38, 0]}>
        <meshStandardMaterial color={metalMid} metalness={0.25} roughness={0.35} />
      </Cylinder>

      {/* ══════════════════════════════════════════
          TORSO — main chassis
          ══════════════════════════════════════════ */}
      <RoundedBox args={[0.55, 0.6, 0.35]} radius={0.06} position={[0, 1.05, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={metalDark} roughness={0.4} metalness={0.2} />
      </RoundedBox>

      {/* Chest plate with accent color */}
      <RoundedBox args={[0.42, 0.35, 0.04]} radius={0.04} position={[0, 1.1, 0.17]}>
        <meshStandardMaterial color={shirtColor} roughness={0.5} metalness={0.15} />
      </RoundedBox>

      {/* Power core — glowing circle on chest */}
      <Cylinder args={[0.06, 0.06, 0.02, 16]} position={[0, 1.15, 0.2]} rotation={[Math.PI / 2, 0, 0]}>
        <meshStandardMaterial
          color={accent}
          emissive={accent}
          emissiveIntensity={isWorking ? 0.5 : 0.2}
        />
      </Cylinder>

      {/* ID badge */}
      <RoundedBox args={[0.2, 0.08, 0.02]} radius={0.01} position={[0, 0.92, 0.18]}>
        <meshStandardMaterial color="#e8e8e8" roughness={0.5} />
      </RoundedBox>

      {/* Waist joint ring */}
      <Cylinder args={[0.22, 0.22, 0.06, 16]} position={[0, 0.72, 0]}>
        <meshStandardMaterial color={metalMid} metalness={0.25} roughness={0.35} />
      </Cylinder>

      {/* ══════════════════════════════════════════
          ARMS — mechanical joints
          ══════════════════════════════════════════ */}
      <group ref={leftArmRef} position={[-0.35, 1.2, 0]}>
        {/* Shoulder joint */}
        <Sphere args={[0.08, 12, 12]} position={[0, 0, 0]}>
          <meshStandardMaterial color={metalLight} metalness={0.25} roughness={0.35} />
        </Sphere>
        {/* Upper arm */}
        <RoundedBox args={[0.12, 0.28, 0.12]} radius={0.03} position={[0, -0.18, 0]} castShadow>
          <meshStandardMaterial color={metalDark} roughness={0.4} metalness={0.2} />
        </RoundedBox>
        {/* Elbow joint */}
        <Sphere args={[0.06, 10, 10]} position={[0, -0.35, 0]}>
          <meshStandardMaterial color={metalLight} metalness={0.25} roughness={0.35} />
        </Sphere>
        {/* Forearm */}
        <RoundedBox args={[0.1, 0.22, 0.1]} radius={0.03} position={[0, -0.48, 0]} castShadow>
          <meshStandardMaterial color={metalDark} roughness={0.4} metalness={0.2} />
        </RoundedBox>
        {/* Hand — claw/gripper */}
        <RoundedBox args={[0.1, 0.08, 0.12]} radius={0.02} position={[0, -0.62, 0]} castShadow>
          <meshStandardMaterial color={metalMid} metalness={0.2} roughness={0.35} />
        </RoundedBox>
      </group>

      <group ref={rightArmRef} position={[0.35, 1.2, 0]}>
        <Sphere args={[0.08, 12, 12]} position={[0, 0, 0]}>
          <meshStandardMaterial color={metalLight} metalness={0.25} roughness={0.35} />
        </Sphere>
        <RoundedBox args={[0.12, 0.28, 0.12]} radius={0.03} position={[0, -0.18, 0]} castShadow>
          <meshStandardMaterial color={metalDark} roughness={0.4} metalness={0.2} />
        </RoundedBox>
        <Sphere args={[0.06, 10, 10]} position={[0, -0.35, 0]}>
          <meshStandardMaterial color={metalLight} metalness={0.25} roughness={0.35} />
        </Sphere>
        <RoundedBox args={[0.1, 0.22, 0.1]} radius={0.03} position={[0, -0.48, 0]} castShadow>
          <meshStandardMaterial color={metalDark} roughness={0.4} metalness={0.2} />
        </RoundedBox>
        <RoundedBox args={[0.1, 0.08, 0.12]} radius={0.02} position={[0, -0.62, 0]} castShadow>
          <meshStandardMaterial color={metalMid} metalness={0.2} roughness={0.35} />
        </RoundedBox>
      </group>

      {/* ══════════════════════════════════════════
          LEGS — mechanical pistons
          ══════════════════════════════════════════ */}
      <group ref={leftLegRef} position={[-0.14, 0.7, 0]}>
        {/* Hip joint */}
        <Sphere args={[0.07, 10, 10]} position={[0, 0, 0]}>
          <meshStandardMaterial color={metalLight} metalness={0.25} roughness={0.35} />
        </Sphere>
        {/* Upper leg */}
        <RoundedBox args={[0.13, 0.28, 0.13]} radius={0.03} position={[0, -0.18, 0]} castShadow>
          <meshStandardMaterial color={metalDark} roughness={0.4} metalness={0.2} />
        </RoundedBox>
        {/* Knee joint */}
        <Sphere args={[0.06, 10, 10]} position={[0, -0.35, 0]}>
          <meshStandardMaterial color={metalLight} metalness={0.25} roughness={0.35} />
        </Sphere>
        {/* Lower leg */}
        <RoundedBox args={[0.11, 0.22, 0.11]} radius={0.03} position={[0, -0.48, 0]} castShadow>
          <meshStandardMaterial color={metalDark} roughness={0.4} metalness={0.2} />
        </RoundedBox>
        {/* Foot — flat plate */}
        <RoundedBox args={[0.14, 0.06, 0.22]} radius={0.02} position={[0, -0.62, 0.03]} castShadow>
          <meshStandardMaterial color={metalMid} metalness={0.2} roughness={0.35} />
        </RoundedBox>
      </group>

      <group ref={rightLegRef} position={[0.14, 0.7, 0]}>
        <Sphere args={[0.07, 10, 10]} position={[0, 0, 0]}>
          <meshStandardMaterial color={metalLight} metalness={0.25} roughness={0.35} />
        </Sphere>
        <RoundedBox args={[0.13, 0.28, 0.13]} radius={0.03} position={[0, -0.18, 0]} castShadow>
          <meshStandardMaterial color={metalDark} roughness={0.4} metalness={0.2} />
        </RoundedBox>
        <Sphere args={[0.06, 10, 10]} position={[0, -0.35, 0]}>
          <meshStandardMaterial color={metalLight} metalness={0.25} roughness={0.35} />
        </Sphere>
        <RoundedBox args={[0.11, 0.22, 0.11]} radius={0.03} position={[0, -0.48, 0]} castShadow>
          <meshStandardMaterial color={metalDark} roughness={0.4} metalness={0.2} />
        </RoundedBox>
        <RoundedBox args={[0.14, 0.06, 0.22]} radius={0.02} position={[0, -0.62, 0.03]} castShadow>
          <meshStandardMaterial color={metalMid} metalness={0.2} roughness={0.35} />
        </RoundedBox>
      </group>

      {/* ══════════════════════════════════════════
          EFFECTS
          ══════════════════════════════════════════ */}

      {/* Desk screen glow when working */}
      {isAtDesk && (
        <pointLight position={[0, 1.5, 0.8]} intensity={2} distance={2} color={screenGlow} />
      )}

      {/* CLI Status Indicator — floating above antenna */}
      <Sphere ref={indicatorRef} args={[0.08, 16, 16]} position={[0, 2.45, 0]}>
        <meshStandardMaterial color={indicatorColor} emissive={indicatorColor} emissiveIntensity={0.8} />
      </Sphere>
      <pointLight position={[0, 2.45, 0]} intensity={1} distance={0.8} color={indicatorColor} />
    </group>
  );
}
