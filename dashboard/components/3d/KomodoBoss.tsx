"use client";

import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Box, Sphere, Cylinder } from '@react-three/drei';
import * as THREE from 'three';

export function KomodoBoss({ position }: { position: [number, number, number] }) {
  const handsRef = useRef<THREE.Group>(null);
  
  // Animación de bucle para Komodo tecleando
  useFrame((state) => {
    if (handsRef.current) {
      const time = state.clock.elapsedTime;
      // Movimiento rápido de manos en Y y Z para simular tecleo
      handsRef.current.children[0].position.y = 0.6 + Math.sin(time * 15) * 0.05;
      handsRef.current.children[1].position.y = 0.6 + Math.cos(time * 18) * 0.05;
    }
  });

  return (
    <group position={position}>
      {/* Silla */}
      <Cylinder args={[0.3, 0.3, 0.5]} position={[0, 0.25, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#444" />
      </Cylinder>
      
      {/* Cuerpo (Komodo Dragon / Boss) - Verde */}
      <Box args={[0.8, 1, 0.6]} position={[0, 1, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#2E8B57" />
      </Box>

      {/* Cabeza */}
      <Box args={[0.5, 0.5, 0.6]} position={[0, 1.75, 0.2]} castShadow receiveShadow>
        <meshStandardMaterial color="#3CB371" />
      </Box>

      {/* Manos */}
      <group ref={handsRef}>
        <Sphere args={[0.15]} position={[-0.3, 0.6, 0.5]} castShadow>
          <meshStandardMaterial color="#3CB371" />
        </Sphere>
        <Sphere args={[0.15]} position={[0.3, 0.6, 0.5]} castShadow>
          <meshStandardMaterial color="#3CB371" />
        </Sphere>
      </group>

      {/* Escritorio Jefe */}
      <Box args={[2, 0.1, 1]} position={[0, 0.8, 1]} castShadow receiveShadow>
        <meshStandardMaterial color="#8B4513" />
      </Box>
      <Box args={[0.1, 0.8, 0.8]} position={[-0.9, 0.4, 1]} castShadow receiveShadow>
         <meshStandardMaterial color="#5C4033" />
      </Box>
      <Box args={[0.1, 0.8, 0.8]} position={[0.9, 0.4, 1]} castShadow receiveShadow>
         <meshStandardMaterial color="#5C4033" />
      </Box>

      {/* Monitor Jefe (Siempre encendido) */}
      <Box args={[1.2, 0.7, 0.1]} position={[0, 1.2, 1.2]} castShadow receiveShadow>
        <meshStandardMaterial color="#222" />
      </Box>
      <Box args={[1.1, 0.6, 0.11]} position={[0, 1.2, 1.15]} castShadow receiveShadow>
        <meshStandardMaterial color="#00ff00" emissive="#00ff00" emissiveIntensity={0.5} />
      </Box>
      
      {/* Luz de pantalla del jefe */}
      <pointLight position={[0, 1.3, 0.8]} intensity={5} distance={3} color="#bbffbb" />
    </group>
  );
}
