"use client";

import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Box } from '@react-three/drei';
import * as THREE from 'three';

// Props: position, rotation, isDrawing (to trigger animation)
export function AnimatedWhiteboard({ position, rotation, isDrawing }: { position: [number, number, number], rotation: [number, number, number], isDrawing: boolean }) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);

  useFrame((state) => {
    if (isDrawing && materialRef.current) {
      // Simulate drawing by slightly animating the emissive intensity or color over time
      materialRef.current.emissiveIntensity = 0.2 + Math.sin(state.clock.elapsedTime * 5) * 0.1;
    } else if (materialRef.current) {
      materialRef.current.emissiveIntensity = 0;
    }
  });

  return (
    <group position={position} rotation={rotation}>
      {/* Pizarra Board */}
      <Box args={[3, 2, 0.1]} position={[0, 1.5, 0]} castShadow receiveShadow>
        <meshStandardMaterial ref={materialRef} color="#ffffff" emissive="#bbffbb" emissiveIntensity={0} />
      </Box>
      
      {/* Marco de Pizarra */}
      <Box args={[3.2, 2.2, 0.05]} position={[0, 1.5, -0.05]} castShadow receiveShadow>
        <meshStandardMaterial color="#8B4513" />
      </Box>
    </group>
  );
}
