"use client";

import React, { useRef } from 'react';
import { Box, Cylinder, Sphere, Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface SonarScanner3DProps {
  position: [number, number, number];
  isAnalyzing: boolean;
}

/**
 * 3D SonarQube analysis station — a server rack/terminal with scanning animation.
 * Placed in the hallway between Coder and Reviewer rooms.
 * Glows and animates when SonarQube analysis is active.
 */
export function SonarScanner3D({ position, isAnalyzing }: SonarScanner3DProps) {
  const scanLineRef = useRef<THREE.Mesh>(null);
  const glowRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);

  useFrame((state) => {
    const time = state.clock.elapsedTime;

    // Scan line moves up and down when analyzing
    if (scanLineRef.current) {
      if (isAnalyzing) {
        scanLineRef.current.position.y = 0.8 + Math.sin(time * 3) * 0.4;
        scanLineRef.current.visible = true;
      } else {
        scanLineRef.current.visible = false;
      }
    }

    // Glow pulse when analyzing
    if (glowRef.current) {
      const mat = glowRef.current.material as THREE.MeshStandardMaterial;
      if (isAnalyzing) {
        mat.emissiveIntensity = 0.4 + Math.sin(time * 4) * 0.3;
      } else {
        mat.emissiveIntensity = 0.05;
      }
    }

    // Point light intensity
    if (lightRef.current) {
      lightRef.current.intensity = isAnalyzing ? 1.5 + Math.sin(time * 4) * 0.8 : 0.2;
    }
  });

  return (
    <group position={position}>
      {/* Server rack base */}
      <Box args={[1.2, 1.8, 0.6]} position={[0, 0.9, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#1a1a2e" />
      </Box>

      {/* Screen panel */}
      <Box
        ref={glowRef}
        args={[0.9, 1.0, 0.05]}
        position={[0, 1.0, 0.33]}
      >
        <meshStandardMaterial
          color={isAnalyzing ? '#00e5ff' : '#1a3a4a'}
          emissive={isAnalyzing ? '#00e5ff' : '#0a2a3a'}
          emissiveIntensity={0.05}
        />
      </Box>

      {/* Scan line (horizontal bar that moves up and down) */}
      <Box
        ref={scanLineRef}
        args={[0.85, 0.02, 0.06]}
        position={[0, 1.0, 0.36]}
        visible={false}
      >
        <meshStandardMaterial
          color="#00ff88"
          emissive="#00ff88"
          emissiveIntensity={1.5}
          transparent
          opacity={0.9}
        />
      </Box>

      {/* Status LEDs */}
      {[0.4, 0.6, 0.8].map((y, i) => (
        <Sphere key={i} args={[0.03]} position={[0.5, y + 0.3, 0.31]}>
          <meshStandardMaterial
            color={isAnalyzing ? ['#00ff88', '#ffcc00', '#00e5ff'][i] : '#333'}
            emissive={isAnalyzing ? ['#00ff88', '#ffcc00', '#00e5ff'][i] : '#111'}
            emissiveIntensity={isAnalyzing ? 0.8 : 0}
          />
        </Sphere>
      ))}

      {/* Top antenna/sensor */}
      <Cylinder args={[0.02, 0.02, 0.4]} position={[0, 2.0, 0]} castShadow>
        <meshStandardMaterial color="#555" />
      </Cylinder>
      <Sphere args={[0.05]} position={[0, 2.2, 0]}>
        <meshStandardMaterial
          color={isAnalyzing ? '#00e5ff' : '#333'}
          emissive={isAnalyzing ? '#00e5ff' : '#111'}
          emissiveIntensity={isAnalyzing ? 1.0 : 0}
        />
      </Sphere>

      {/* Label */}
      <Text
        position={[0, 1.65, 0.34]}
        fontSize={0.12}
        color={isAnalyzing ? '#00e5ff' : '#ffffffff'}
        anchorX="center"
        anchorY="middle"
      >
        SONARQUBE
      </Text>

      {/* Point light for ambient glow when analyzing */}
      <pointLight
        ref={lightRef}
        position={[0, 1.2, 0.8]}
        color="#00e5ff"
        intensity={0.2}
        distance={3}
      />
    </group>
  );
}
