"use client";

import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls, OrthographicCamera } from '@react-three/drei';
import { Environment3D } from './3d/Environment3D';

interface OfficeScene3DProps {
  agents: any;
}

export function OfficeScene3D({ agents }: OfficeScene3DProps) {
  return (
    <div className="w-full h-full relative bg-zinc-950 rounded-lg overflow-hidden border border-white/10">
      <Canvas shadows>
        {/* Cámara Isométrica estilo 2.5D */}
        <OrthographicCamera 
          makeDefault 
          position={[20, 20, 20]} 
          zoom={45} 
          near={-100} 
          far={100}
        />
        
        {/* Controles: Permitimos rotar y hacer zoom limitados, pero sin girar debajo del piso */}
        <OrbitControls 
          enablePan={false}
          minPolarAngle={0} 
          maxPolarAngle={Math.PI / 2.1} 
          minZoom={20}
          maxZoom={80}
        />

        {/* Iluminación Base */}
        <ambientLight intensity={0.5} />
        <directionalLight 
          position={[10, 20, 10]} 
          intensity={1.5} 
          castShadow 
          shadow-mapSize={[1024, 1024]} 
          shadow-camera-left={-20}
          shadow-camera-right={20}
          shadow-camera-top={20}
          shadow-camera-bottom={-20}
        />

        {/* Entorno Dinámico */}
        <Suspense fallback={null}>
          <Environment3D agents={agents} />
        </Suspense>
      </Canvas>
    </div>
  );
}
