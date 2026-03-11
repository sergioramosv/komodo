"use client";

import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, OrthographicCamera, Environment } from '@react-three/drei';
import { Environment3D } from './3d/Environment3D';

interface OfficeScene3DProps {
  agents: any;
  phase?: string;
  cliHealth?: any;
}

export function OfficeScene3D({ agents, phase, cliHealth }: OfficeScene3DProps) {
  return (
    <div className="w-full h-full relative bg-zinc-950 overflow-hidden">
      <Canvas shadows>
        {/* Isometric camera */}
        <OrthographicCamera
          makeDefault
          position={[20, 20, 20]}
          zoom={26}
          near={-100}
          far={100}
        />

        {/* Controls */}
        <OrbitControls
          enablePan
          minPolarAngle={0.3}
          maxPolarAngle={Math.PI / 2.2}
          minZoom={15}
          maxZoom={80}
        />

        {/* Warm ambient fill */}
        <ambientLight intensity={0.35} color="#fff5e6" />

        {/* Main directional (sun) — warm, soft shadows */}
        <directionalLight
          position={[12, 18, 8]}
          intensity={0.8}
          color="#fff8f0"
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-camera-left={-15}
          shadow-camera-right={15}
          shadow-camera-top={15}
          shadow-camera-bottom={-15}
          shadow-bias={-0.001}
        />

        {/* Secondary fill light from opposite side (no shadows) */}
        <directionalLight
          position={[-8, 12, -6]}
          intensity={0.25}
          color="#e8eaf0"
        />

        {/* Slight blue hemisphere for sky bounce */}
        <hemisphereLight intensity={0.2} color="#e8f0ff" groundColor="#8a7a6a" />

        {/* Scene */}
        <Suspense fallback={null}>
          {/* Environment map for metallic reflections (no background) */}
          <Environment preset="city" environmentIntensity={0.3} background={false} />
          <Environment3D agents={agents} phase={phase} cliHealth={cliHealth} />
        </Suspense>
      </Canvas>
    </div>
  );
}
