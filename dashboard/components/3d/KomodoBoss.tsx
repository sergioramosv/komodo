"use client";

import React, { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Box, Sphere, Cylinder } from '@react-three/drei';
import * as THREE from 'three';

export function KomodoBoss({ position }: { position: [number, number, number] }) {
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const tailRef = useRef<THREE.Group>(null);
  
  // Animación de bucle para Komodo tecleando y moviendo la cola
  useFrame((state) => {
    const time = state.clock.elapsedTime;
    if (leftArmRef.current && rightArmRef.current) {
      // Movimiento rápido de brazos articulados para simular tecleo intenso
      leftArmRef.current.rotation.x = -Math.PI / 2.5 + Math.sin(time * 20) * 0.1;
      rightArmRef.current.rotation.x = -Math.PI / 2.5 + Math.cos(time * 25) * 0.1;
    }
    if (tailRef.current) {
      // Cola moviéndose felizmente mientras trabaja
      tailRef.current.rotation.y = Math.sin(time * 3) * 0.2;
    }
  });

  return (
    <group position={position}>
      {/* ===== SILLA BOSS ===== */}
      <Box args={[0.8, 0.1, 0.8]} position={[0, 0.4, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#1a1a1a" />
      </Box>
      <Box args={[0.1, 0.4, 0.1]} position={[0, 0.2, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#444" />
      </Box>
      {/* Ruedas y base */}
      <Box args={[0.8, 0.05, 0.1]} position={[0, 0.05, 0]} castShadow />
      <Box args={[0.1, 0.05, 0.8]} position={[0, 0.05, 0]} castShadow />
      
      {/* Respaldo Alto (Silla Gaming/Boss) */}
      <Box args={[0.8, 1.2, 0.1]} position={[0, 1.05, -0.35]} castShadow receiveShadow>
        <meshStandardMaterial color="#1a1a1a" />
      </Box>
      {/* Acentos silla */}
      <Box args={[0.6, 1.0, 0.11]} position={[0, 1.05, -0.34]} castShadow>
        <meshStandardMaterial color="#2E8B57" />
      </Box>

      {/* ===== KOMODO DRAGON VOXEL ===== */}
      <group position={[0, 0.45, 0]}>
        {/* Piernas Sentadas */}
        <Box args={[0.25, 0.25, 0.6]} position={[-0.2, 0.125, 0.2]} castShadow>
           <meshStandardMaterial color="#228B22" />
        </Box>
        <Box args={[0.25, 0.25, 0.6]} position={[0.2, 0.125, 0.2]} castShadow>
           <meshStandardMaterial color="#228B22" />
        </Box>

        {/* Torso */}
        <Box args={[0.6, 0.8, 0.5]} position={[0, 0.6, 0]} castShadow receiveShadow>
          <meshStandardMaterial color="#3CB371" />
        </Box>
        {/* Barriga más clara */}
        <Box args={[0.4, 0.6, 0.52]} position={[0, 0.55, 0.01]} castShadow receiveShadow>
          <meshStandardMaterial color="#98FB98" />
        </Box>

        {/* Cola (Pivote en la base de la espalda) */}
        <group ref={tailRef} position={[0, 0.2, -0.25]}>
          <Box args={[0.2, 0.2, 0.8]} position={[0, 0, -0.4]} castShadow>
            <meshStandardMaterial color="#228B22" />
          </Box>
        </group>

        {/* Cabeza (Komodo) */}
        <group position={[0, 1.2, 0.1]}>
           {/* Cráneo */}
           <Box args={[0.5, 0.4, 0.5]} position={[0, 0, 0]} castShadow receiveShadow>
             <meshStandardMaterial color="#3CB371" />
           </Box>
           {/* Hocico Voxel */}
           <Box args={[0.4, 0.2, 0.4]} position={[0, -0.1, 0.45]} castShadow receiveShadow>
             <meshStandardMaterial color="#228B22" />
           </Box>
           {/* Ojos */}
           <Box args={[0.1, 0.1, 0.1]} position={[-0.26, 0.1, 0.1]} castShadow>
             <meshStandardMaterial color="#000" />
           </Box>
           <Box args={[0.1, 0.1, 0.1]} position={[0.26, 0.1, 0.1]} castShadow>
             <meshStandardMaterial color="#000" />
           </Box>
           {/* Cresta dorsal (Spikes) */}
           <Box args={[0.1, 0.1, 0.4]} position={[0, 0.25, -0.1]} castShadow>
             <meshStandardMaterial color="#ADFF2F" />
           </Box>
        </group>

        {/* Brazo Izquierdo (Pivote hombro) */}
        <group ref={leftArmRef} position={[-0.4, 0.8, 0]}>
          <Box args={[0.2, 0.5, 0.2]} position={[0, -0.2, 0]} castShadow>
             <meshStandardMaterial color="#3CB371" />
          </Box>
          <Box args={[0.2, 0.15, 0.2]} position={[0, -0.5, 0]} castShadow>
             <meshStandardMaterial color="#228B22" />
          </Box>
        </group>

        {/* Brazo Derecho (Pivote hombro) */}
        <group ref={rightArmRef} position={[0.4, 0.8, 0]}>
          <Box args={[0.2, 0.5, 0.2]} position={[0, -0.2, 0]} castShadow>
             <meshStandardMaterial color="#3CB371" />
          </Box>
          <Box args={[0.2, 0.15, 0.2]} position={[0, -0.5, 0]} castShadow>
             <meshStandardMaterial color="#228B22" />
          </Box>
        </group>
      </group>

      {/* ===== ESCRITORIO DEL JEFE (L-SHAPE + MULTI-MONITOR) ===== */}
      <group position={[0, 0, 0.2]}>
        <Box args={[2.5, 0.1, 1]} position={[0, 0.8, 1]} castShadow receiveShadow>
          <meshStandardMaterial color="#3e2723" />
        </Box>
        {/* L-Shape ala izquierda */}
        <Box args={[1, 0.1, 2]} position={[-1.75, 0.8, 0.5]} castShadow receiveShadow>
          <meshStandardMaterial color="#3e2723" />
        </Box>
        {/* Patas */}
        <Box args={[0.1, 0.8, 0.8]} position={[-1.1, 0.4, 1]} castShadow receiveShadow>
           <meshStandardMaterial color="#1f1f1f" />
        </Box>
        <Box args={[0.1, 0.8, 0.8]} position={[1.1, 0.4, 1]} castShadow receiveShadow>
           <meshStandardMaterial color="#1f1f1f" />
        </Box>

        {/* Monitor Principal Ultrawide */}
        <Box args={[1.6, 0.7, 0.1]} position={[0, 1.25, 1.2]} castShadow receiveShadow>
          <meshStandardMaterial color="#222" />
        </Box>
        <Box args={[1.5, 0.6, 0.11]} position={[0, 1.25, 1.15]} castShadow receiveShadow>
          {/* Pantalla mostrando código matriz verde */}
          <meshStandardMaterial color="#00ff00" emissive="#00cc00" emissiveIntensity={0.6} />
        </Box>
        

        {/* Keyboard */}
        <Box args={[0.6, 0.02, 0.2]} position={[0, 0.86, 0.8]} rotation={[0, 0, 0]} castShadow>
          <meshStandardMaterial color="#222" />
        </Box>

        {/* Taza de café */}
        <Cylinder args={[0.08, 0.08, 0.2]} position={[0.8, 0.95, 0.8]} castShadow>
          <meshStandardMaterial color="#ff5252" />
        </Cylinder>
        
        {/* Luz de pantalla del jefe iluminándole la cara */}
        <pointLight position={[0, 1.4, 0.8]} intensity={4} distance={4} color="#bbffbb" />
      </group>
    </group>
  );
}
