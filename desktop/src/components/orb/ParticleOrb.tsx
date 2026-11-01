import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { makeOrbGeometry } from './geometry';
import { lineFragment, lineVertex, pointFragment, pointVertex } from './shaders';

export type OrbState = 'idle' | 'listening' | 'thinking' | 'speaking';
export interface OrbSettings { particleCount?: number; speed?: number; deformation?: number; pointSize?: number; bloom?: number }
const presets = {
  idle: { speed: .32, amplitude: .48, energy: 1.65 },
  listening: { speed: .52, amplitude: .61, energy: 1.9 },
  thinking: { speed: .86, amplitude: .76, energy: 1.75 },
  speaking: { speed: .62, amplitude: .57, energy: 2.1 },
};

function useMotionPreference() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}

function OrbScene({ state, settings, reduced }: { state: OrbState; settings: OrbSettings; reduced: boolean }) {
  const group = useRef<THREE.Group>(null);
  const elapsed = useRef(0);
  const { gl, scene, camera, size, viewport } = useThree();
  const count = Math.round(THREE.MathUtils.clamp(settings.particleCount ?? 12500, 1000, 24000));
  const data = useMemo(() => makeOrbGeometry(count), [count]);
  const uniforms = useMemo(() => ({
    uTime: { value: 0 }, uAmplitude: { value: .48 }, uEnergy: { value: 1.65 },
    uPointSize: { value: 3.5 }, uDpr: { value: 1 },
  }), []);
  const post = useMemo(() => {
    const composer = new EffectComposer(gl);
    const render = new RenderPass(scene, camera);
    const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), .8, .45, .15);
    const output = new OutputPass();
    composer.addPass(render); composer.addPass(bloom); composer.addPass(output);
    return { composer, render, bloom, output };
  }, [gl, scene, camera]);
  useEffect(() => {
    post.composer.setPixelRatio(Math.min(gl.getPixelRatio(), 1.5));
    post.composer.setSize(size.width, size.height);
  }, [post, size.width, size.height, gl]);
  useEffect(() => () => {
    post.render.dispose(); post.bloom.dispose(); post.output.dispose(); post.composer.dispose();
  }, [post]);
  useFrame((_, rawDelta) => {
    const delta = Math.min(rawDelta, .05);
    const target = presets[state];
    elapsed.current += reduced ? 0 : delta * target.speed * (settings.speed ?? 1);
    uniforms.uTime.value = elapsed.current;
    uniforms.uAmplitude.value = reduced ? target.amplitude * (settings.deformation ?? 1) : THREE.MathUtils.damp(uniforms.uAmplitude.value, target.amplitude * (settings.deformation ?? 1), 3, delta);
    const pulse = state === 'speaking' && !reduced ? 1 + .13 * Math.sin(elapsed.current * 9) : 1;
    uniforms.uEnergy.value = reduced ? target.energy : THREE.MathUtils.damp(uniforms.uEnergy.value, target.energy * pulse, 4, delta);
    uniforms.uPointSize.value = settings.pointSize ?? 3.5;
    uniforms.uDpr.value = gl.getPixelRatio();
    post.bloom.strength = settings.bloom ?? .8;
    if (group.current) {
      group.current.rotation.y = elapsed.current * .16;
      group.current.rotation.z = Math.sin(elapsed.current * .13) * .12;
      // Fit in portrait and landscape; pointer parallax is disabled for reduced motion.
      const scale = Math.min(viewport.width, viewport.height) * .32;
      group.current.scale.setScalar(scale);
      if (!reduced) {
        group.current.rotation.x = THREE.MathUtils.damp(group.current.rotation.x, _.pointer.y * .08, 2, delta);
      }
    }
    post.composer.render();
  }, 1);
  return <group ref={group}>
    <points frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[data.positions, 3]} />
        <bufferAttribute attach="attributes-aSize" args={[data.sizes, 1]} />
      </bufferGeometry>
      <shaderMaterial uniforms={uniforms} vertexShader={pointVertex} fragmentShader={pointFragment}
        transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </points>
    <lineSegments frustumCulled={false}>
      <bufferGeometry><bufferAttribute attach="attributes-position" args={[data.lines, 3]} /></bufferGeometry>
      <shaderMaterial uniforms={uniforms} vertexShader={lineVertex} fragmentShader={lineFragment}
        transparent depthWrite={false} blending={THREE.AdditiveBlending} />
    </lineSegments>
  </group>;
}

class OrbBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? <p className="orb-fallback">3D visualization unavailable. Backend status is available below.</p> : this.props.children; }
}
const defaults: OrbSettings = {};
export default function ParticleOrb({ state = 'idle', settings = defaults }: { state?: OrbState; settings?: OrbSettings }) {
  const reduced = useMotionPreference();
  const [visible, setVisible] = useState(!document.hidden);
  useEffect(() => {
    const update = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', update);
    return () => document.removeEventListener('visibilitychange', update);
  }, []);
  return <div className="orb-canvas" role="img" aria-label={`Animated cyan particle orb, ${state}${reduced ? ', reduced motion' : ''}`}>
    <OrbBoundary><Canvas camera={{ position: [0, 0, 4.8], fov: 40 }} dpr={[1, 1.5]}
      frameloop={visible && !reduced ? 'always' : 'demand'}
      gl={{ antialias: false, alpha: false, powerPreference: 'high-performance' }}
      fallback={<p className="orb-fallback">WebGL is required for the particle orb.</p>}>
      <color attach="background" args={['#030609']} />
      <OrbScene state={state} settings={settings} reduced={reduced} />
    </Canvas></OrbBoundary>
  </div>;
}
