"use client";

import React, { useRef, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Box, Sphere, Cylinder } from '@react-three/drei';
import * as THREE from 'three';

// Define positions and states for agents
interface Agent3DProps {
  id: string; // 'PLANNER' | 'CODER' | 'REVIEWER'
  status: 'idle' | 'working' | 'walking';
  color: string;
  waitPosition: [number, number, number];
  workPosition: [number, number, number];
  lookAtWork: [number, number, number]; // Rotation when working (euler radians)
  lookAtWait: [number, number, number]; // Rotation when waiting
  isWhiteboard?: boolean; // True for Planner (doesn't sit, no computer)
}

// Vector interpolation speed
const LERP_SPEED = 3.5;

export function Agent3D({ id, status, color, waitPosition, workPosition, lookAtWork, lookAtWait, isWhiteboard }: Agent3DProps) {
  const groupRef = useRef<THREE.Group>(null);
  const handsRef = useRef<THREE.Group>(null);

  // Determine current target position and rotation
  const targetPosition = useMemo(() => new THREE.Vector3(...(status === 'working' ? workPosition : waitPosition)), [status, workPosition, waitPosition]);
  const targetRotation = useMemo(() => new THREE.Euler(...(status === 'working' ? lookAtWork : lookAtWait)), [status, lookAtWork, lookAtWait]);

  useFrame((state, delta) => {
    if (!groupRef.current) return;

    // 1. Move position smoothly
    groupRef.current.position.lerp(targetPosition, delta * LERP_SPEED);

    // 2. Rotate smoothly (quaternion slerp)
    const currentQuat = groupRef.current.quaternion;
    const targetQuat = new THREE.Quaternion().setFromEuler(targetRotation);
    currentQuat.slerp(targetQuat, delta * LERP_SPEED);

    // 3. Hands Animation
    if (handsRef.current) {
      const time = state.clock.elapsedTime;
      // Define walking bobbing logic
      const distanceToTarget = groupRef.current.position.distanceTo(targetPosition);
      const isWalking = distanceToTarget > 0.1;

      if (isWalking) {
        // Walking arm swing
        handsRef.current.children[0].position.z = Math.sin(time * 10) * 0.3;
        handsRef.current.children[1].position.z = Math.sin(time * 10 + Math.PI) * 0.3;
        handsRef.current.children[0].position.y = 0.5;
        handsRef.current.children[1].position.y = 0.5;
      } else if (status === 'working') {
        // Working / Typing / Drawing
        if (isWhiteboard) {
          // Drawing animation (one hand up)
          handsRef.current.children[0].position.y = 1.0 + Math.sin(time * 5) * 0.2;
          handsRef.current.children[0].position.z = 0.5 + Math.cos(time * 4) * 0.2;
          handsRef.current.children[1].position.y = 0.5;
          handsRef.current.children[1].position.z = 0.5;
        } else {
          // Typing animation
          handsRef.current.children[0].position.y = 0.6 + Math.sin(time * 15) * 0.05;
          handsRef.current.children[1].position.y = 0.6 + Math.cos(time * 18) * 0.05;
          handsRef.current.children[0].position.z = 0.5;
          handsRef.current.children[1].position.z = 0.5;
        }
      } else {
        // Idle (hands resting)
        handsRef.current.children[0].position.y = 0.4;
        handsRef.current.children[1].position.y = 0.4;
        handsRef.current.children[0].position.z = 0.2;
        handsRef.current.children[1].position.z = 0.2;
      }
    }
  });

  const isAtDesk = status === 'working' && !isWhiteboard;

  return (
    <group ref={groupRef} position={waitPosition}>
      {/* Etiqueta Flotante */}
      <mesh position={[0, 2.5, 0]}>
        <planeGeometry args={[0.01, 0.01]} />
        <meshBasicMaterial transparent opacity={0} />
      </mesh>

      {/* Cuerpo */}
      <Box args={[0.8, 1, 0.6]} position={[0, 1, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={color} />
      </Box>

      {/* Cabeza */}
      <Sphere args={[0.4]} position={[0, 1.8, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={color} />
      </Sphere>

      {/* Gafas/Ojos (para saber a dónde miran) */}
      <Box args={[0.5, 0.15, 0.1]} position={[0, 1.85, 0.38]} castShadow>
        <meshStandardMaterial color="#111" />
      </Box>

      {/* Manos */}
      <group ref={handsRef}>
        <Sphere args={[0.15]} position={[-0.45, 0.5, 0.2]} castShadow>
          <meshStandardMaterial color={color} />
        </Sphere>
        <Sphere args={[0.15]} position={[0.45, 0.5, 0.2]} castShadow>
          <meshStandardMaterial color={color} />
        </Sphere>
      </group>

      {/* Luz Point emit for computer face glow when working */}
      {isAtDesk && (
        <pointLight position={[0, 1.5, 1]} intensity={3} distance={2} color="#aaf" />
      )}
    </group>
  );
}
