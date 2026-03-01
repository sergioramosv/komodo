"use client";

import React, { useRef, useState, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { Box, Sphere } from '@react-three/drei';
import * as THREE from 'three';

interface Agent3DProps {
  id: string; // 'PLANNER' | 'CODER' | 'REVIEWER'
  status: 'idle' | 'working' | 'walking';
  hairColor: string;
  shirtColor: string;
  hairStyle: 'short' | 'long' | 'bun';
  pathWaypoints: [number, number, number][]; // Array of points from Wait (idx 0) to Work (idx length-1)
  rotationWork: [number, number, number]; // Rotation when working (euler radians)
  rotationWait: [number, number, number]; // Rotation when waiting
  isWhiteboard?: boolean; // True for Planner (doesn't sit, no computer)
}

const LERP_SPEED = 3.5;

export function Agent3D({ id, status, hairColor, shirtColor, hairStyle, pathWaypoints, rotationWork, rotationWait, isWhiteboard }: Agent3DProps) {
  const groupRef = useRef<THREE.Group>(null);
  
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const leftLegRef = useRef<THREE.Group>(null);
  const rightLegRef = useRef<THREE.Group>(null);
  
  const [waypointIndex, setWaypointIndex] = useState(status === 'working' ? pathWaypoints.length - 1 : 0);
  const targetIndex = status === 'working' ? pathWaypoints.length - 1 : 0;
  const isAtDestination = waypointIndex === targetIndex;

  const targetRotation = useMemo(() => new THREE.Euler(...(status === 'working' ? rotationWork : rotationWait)), [status, rotationWork, rotationWait]);

  useFrame((state, delta) => {
    if (!groupRef.current) return;

    const isSitting = status !== 'walking' && (!isWhiteboard || status !== 'working') && isAtDestination;

    const currentWaypoint = new THREE.Vector3(...pathWaypoints[waypointIndex]);
    currentWaypoint.y = isSitting ? -0.3 : 0; 

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
    
    const walkSpeed = 15;
    const walkAngle = Math.sin(time * walkSpeed) * 0.6;

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
        leftArmRef.current.rotation.x = 0;
        rightArmRef.current.rotation.x = 0;
        leftArmRef.current.rotation.z = 0;
        rightArmRef.current.rotation.z = 0;
      }
    }
  });

  const isAtDesk = status === 'working' && !isWhiteboard && isAtDestination;

  return (
    <group ref={groupRef} position={pathWaypoints[0]}>
      <Box args={[0.5, 0.5, 0.5]} position={[0, 1.75, 0]} castShadow receiveShadow>
        <meshStandardMaterial color="#fcd5ce" /> 
      </Box>

      {hairStyle === 'short' && (
        <Box args={[0.55, 0.2, 0.55]} position={[0, 1.95, 0]} castShadow receiveShadow>
          <meshStandardMaterial color={hairColor} />
        </Box>
      )}
      {hairStyle === 'long' && (
        <group>
          <Box args={[0.55, 0.2, 0.55]} position={[0, 1.95, 0]} castShadow receiveShadow>
            <meshStandardMaterial color={hairColor} />
          </Box>
          <Box args={[0.6, 0.5, 0.2]} position={[0, 1.6, -0.2]} castShadow receiveShadow>
            <meshStandardMaterial color={hairColor} />
          </Box>
        </group>
      )}
      {hairStyle === 'bun' && (
        <group>
          <Box args={[0.55, 0.2, 0.55]} position={[0, 1.95, 0]} castShadow receiveShadow>
            <meshStandardMaterial color={hairColor} />
          </Box>
          <Sphere args={[0.15]} position={[0, 2.05, -0.2]} castShadow receiveShadow>
             <meshStandardMaterial color={hairColor} />
          </Sphere>
        </group>
      )}

      <Box args={[0.08, 0.08, 0.05]} position={[-0.15, 1.75, 0.26]} castShadow>
        <meshStandardMaterial color="#111" />
      </Box>
      <Box args={[0.08, 0.08, 0.05]} position={[0.15, 1.75, 0.26]} castShadow>
        <meshStandardMaterial color="#111" />
      </Box>

      <Box args={[0.6, 0.7, 0.4]} position={[0, 1.15, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={shirtColor} />
      </Box>

      <group ref={leftArmRef} position={[-0.4, 1.4, 0]}>
        <Box args={[0.2, 0.6, 0.2]} position={[0, -0.25, 0]} castShadow receiveShadow>
           <meshStandardMaterial color={shirtColor} />
        </Box>
        <Box args={[0.2, 0.15, 0.2]} position={[0, -0.6, 0]} castShadow receiveShadow>
           <meshStandardMaterial color="#fcd5ce" />
        </Box>
      </group>

      <group ref={rightArmRef} position={[0.4, 1.4, 0]}>
        <Box args={[0.2, 0.6, 0.2]} position={[0, -0.25, 0]} castShadow receiveShadow>
           <meshStandardMaterial color={shirtColor} />
        </Box>
        <Box args={[0.2, 0.15, 0.2]} position={[0, -0.6, 0]} castShadow receiveShadow>
           <meshStandardMaterial color="#fcd5ce" />
        </Box>
      </group>

      <group ref={leftLegRef} position={[-0.15, 0.8, 0]}>
        <Box args={[0.25, 0.8, 0.25]} position={[0, -0.4, 0]} castShadow receiveShadow>
           <meshStandardMaterial color="#2980b9" />
        </Box>
      </group>

      <group ref={rightLegRef} position={[0.15, 0.8, 0]}>
        <Box args={[0.25, 0.8, 0.25]} position={[0, -0.4, 0]} castShadow receiveShadow>
           <meshStandardMaterial color="#2980b9" />
        </Box>
      </group>

      {isAtDesk && (
        <pointLight position={[0, 1.5, 1]} intensity={3} distance={2} color="#aaf" />
      )}
    </group>
  );
}
