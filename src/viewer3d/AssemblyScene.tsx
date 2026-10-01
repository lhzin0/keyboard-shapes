import { ContactShadows, Environment, Grid, Html, Lightformer, OrbitControls, OrthographicCamera, PerspectiveCamera } from '@react-three/drei';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { memo, useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { tiltMatrix, type Assembly, type AssemblyPart } from '../geometry/3d/KeyboardAssembly';
import { EXPLODE_GAIN, ROLE_COLOR, ROLE_FINISH } from '../geometry/3d/palette';
import { useIsMobile } from '../hooks';
import { useViewer3D } from '../stores';
import type { CheckStatus } from '../types/keyboard';

const STATUS_TINT: Partial<Record<CheckStatus, string>> = { fail: '#f0616d', warn: '#f5b94a' };

/** World-space bounding box of the whole assembly. */
export function assemblyBox(a: Assembly): THREE.Box3 {
  const m = tiltMatrix(a);
  const box = new THREE.Box3();
  for (const p of a.parts) {
    p.geometry.computeBoundingBox();
    const b = p.geometry.boundingBox;
    if (!b) continue;
    if (p.instances) {
      // instanced parts: expand by every instance translation
      for (let i = 0; i < p.instances.length; i += 16) {
        const tx = p.instances[i + 12] ?? 0;
        const tz = p.instances[i + 14] ?? 0;
        const bb = b.clone().translate(new THREE.Vector3(tx, 0, tz)).applyMatrix4(m);
        box.union(bb);
      }
    } else {
      box.union(b.clone().applyMatrix4(m));
    }
  }
  return box;
}

interface PartProps {
  part: AssemblyPart;
  assembly: Assembly;
  clip: THREE.Plane[];
  onPick?(e: ThreeEvent<MouseEvent>): void;
}

const PartMesh = memo(function PartMesh({ part, assembly, clip, onPick }: PartProps) {
  const layer = useViewer3D((s) => s.layers[part.layer]);
  const isolated = useViewer3D((s) => s.isolated);
  const renderMode = useViewer3D((s) => s.renderMode);
  const explode = useViewer3D((s) => s.explode);
  const sectionOn = useViewer3D((s) => s.section.enabled);
  const status = part.component ? assembly.evaluation.componentStatus[part.component] : undefined;

  const visible = layer.visible && (isolated === null || isolated === part.layer);
  // placeholders (data the record does not have) are always drawn as ghosts
  const opacity = layer.opacity * (renderMode === 'transparent' ? 0.38 : 1) * (part.placeholder ? 0.32 : 1);
  const tint = status ? STATUS_TINT[status] : undefined;

  const material = useMemo(() => {
    const finish = ROLE_FINISH[part.role];
    const m = new THREE.MeshStandardMaterial({
      // the case wears the colour measured on its product photo when there is one; everything else uses the palette
      color: part.role === 'case' && assembly.caseColor ? assembly.caseColor : part.role === 'keycap' && assembly.keycapColor ? assembly.keycapColor : ROLE_COLOR[part.role],
      metalness: finish.metalness,
      roughness: finish.roughness,
      envMapIntensity: part.role === 'case' ? 1.1 : 0.9,
    });
    return m;
  }, [part.role, assembly.caseColor, assembly.keycapColor]);

  useEffect(() => {
    material.wireframe = renderMode === 'wireframe';
    material.transparent = opacity < 0.999;
    material.opacity = opacity;
    material.depthWrite = opacity >= 0.999;
    material.side = sectionOn ? THREE.DoubleSide : THREE.FrontSide;
    material.clippingPlanes = clip;
    material.emissive.set(tint ?? '#000000');
    material.emissiveIntensity = tint ? 0.35 : 0;
    material.needsUpdate = true;
  }, [material, renderMode, opacity, sectionOn, clip, tint]);

  useEffect(() => () => material.dispose(), [material]);

  const dz = explode * EXPLODE_GAIN * (part.centerZ - assembly.centerZ);

  const instanced = useMemo(() => {
    if (!part.instances) return null;
    const count = part.instances.length / 16;
    const mesh = new THREE.InstancedMesh(part.geometry, material, count);
    mesh.instanceMatrix.array.set(part.instances);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.frustumCulled = false;
    return mesh;
  }, [part.instances, part.geometry, material]);

  if (!visible) return null;
  return (
    <group position={[0, dz, 0]}>
      {instanced ? (
        <primitive object={instanced} onClick={onPick} />
      ) : (
        <mesh geometry={part.geometry} material={material} onClick={onPick} />
      )}
    </group>
  );
});

function CollisionMarkers({ assembly }: { assembly: Assembly }) {
  const show = useViewer3D((s) => s.showCollisions);
  if (!show) return null;
  const z = (assembly.stack.pcbBottom + assembly.stack.pcbTop) / 2;
  return (
    <group>
      {assembly.evaluation.collisions.map((c, i) => (
        <group key={i} position={[c.at.x, z, c.at.y]}>
          <mesh>
            <sphereGeometry args={[Math.max(3, c.depthMm ?? 3), 20, 14]} />
            <meshBasicMaterial color="#f0616d" transparent opacity={0.55} depthTest={false} />
          </mesh>
          <Html center distanceFactor={250} style={{ pointerEvents: 'none' }}>
            <div style={{ background: '#f0616d', color: '#fff', padding: '2px 6px', borderRadius: 4, fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap' }}>Collision</div>
          </Html>
        </group>
      ))}
    </group>
  );
}

interface MeasureState {
  a?: THREE.Vector3;
  b?: THREE.Vector3;
}

function Measure3D({ state }: { state: MeasureState }) {
  const { a, b } = state;
  const d = a && b ? a.distanceTo(b) : 0;
  return (
    <group>
      {[a, b].map((p, i) =>
        p ? (
          <mesh key={i} position={p}>
            <sphereGeometry args={[1.4, 12, 8]} />
            <meshBasicMaterial color="#5eead4" depthTest={false} />
          </mesh>
        ) : null,
      )}
      {a && b && (
        <>
          <line>
            <bufferGeometry attach="geometry" onUpdate={(g) => g.setFromPoints([a, b])} />
            <lineBasicMaterial color="#5eead4" depthTest={false} />
          </line>
          <Html position={a.clone().lerp(b, 0.5)} center style={{ pointerEvents: 'none' }}>
            <div className="mono" style={{ background: 'var(--surface)', color: 'var(--accent)', border: '1px solid var(--accent)', padding: '2px 8px', borderRadius: 6, fontSize: 12, whiteSpace: 'nowrap' }}>
              {d.toFixed(2)} mm
            </div>
          </Html>
        </>
      )}
    </group>
  );
}

/** Applies camera presets and keeps the target on the model. */
function CameraRig({ box }: { box: THREE.Box3 }) {
  const command = useViewer3D((s) => s.command);
  const projection = useViewer3D((s) => s.projection);
  const { camera, size, invalidate } = useThree();
  const controls = useThree((s) => s.controls) as unknown as { target: THREE.Vector3; update(): void } | null;
  const mobile = useIsMobile();

  useEffect(() => {
    if (!controls) return;
    const center = box.getCenter(new THREE.Vector3());
    const dim = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(dim.x, dim.y, dim.z, 1);
    // camera directions (from the target towards the camera) of the view presets
    const dirs: Record<string, THREE.Vector3> = {
      iso: new THREE.Vector3(0.55, 0.65, 0.9),
      reset: new THREE.Vector3(0.55, 0.65, 0.9),
      top: new THREE.Vector3(0, 1, 0.0001),
      front: new THREE.Vector3(0, 0.12, 1),
      side: new THREE.Vector3(1, 0.12, 0),
    };
    let dist = maxDim * 1.9;
    if (camera instanceof THREE.PerspectiveCamera && size.width > 0 && size.height > 0) {
      // tight fit: project the 8 corners of the box on the camera's right/up axes and take the distance at which
      // every corner is inside both the horizontal and the vertical field of view
      const vfov = (camera.fov * Math.PI) / 180;
      const tanV = Math.tan(vfov / 2);
      const tanH = tanV * (size.width / size.height);
      const forward = (dirs[command.view] ?? dirs['iso']!).clone().normalize().negate();
      const right = new THREE.Vector3().crossVectors(forward, new THREE.Vector3(0, 1, 0)).normalize();
      if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
      const up = new THREE.Vector3().crossVectors(right, forward).normalize();
      let need = 0;
      const corner = new THREE.Vector3();
      for (const x of [box.min.x, box.max.x]) {
        for (const y of [box.min.y, box.max.y]) {
          for (const z of [box.min.z, box.max.z]) {
            corner.set(x, y, z).sub(center);
            const depthOffset = corner.dot(forward);
            need = Math.max(need, Math.abs(corner.dot(right)) / tanH - depthOffset, Math.abs(corner.dot(up)) / tanV - depthOffset);
          }
        }
      }
      // on phones the toolbar and the bottom bar cover part of the canvas: leave room for them
      dist = Math.max(need * (mobile ? 1.32 : 1.1), maxDim * 0.6);
    }
    const dir = (dirs[command.view] ?? dirs['iso']!).clone().normalize();
    camera.position.copy(center).addScaledVector(dir, dist);
    camera.up.set(0, 1, 0);
    controls.target.copy(center);
    if (camera instanceof THREE.OrthographicCamera) {
      const fitW = size.width / (command.view === 'side' ? dim.z : dim.x);
      const fitH = size.height / (command.view === 'top' ? dim.z : dim.y + 20);
      camera.zoom = Math.max(0.2, Math.min(fitW, fitH) * (command.view === 'iso' || command.view === 'reset' ? 0.55 : 0.8));
      camera.updateProjectionMatrix();
    }
    camera.lookAt(center);
    if (mobile && camera instanceof THREE.PerspectiveCamera) {
      // the bottom bar covers the lower part of the canvas: aim a little below the model so it sits higher on screen
      camera.updateMatrixWorld();
      const screenUp = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1);
      const shift = screenUp.multiplyScalar(-dist * Math.tan((camera.fov * Math.PI) / 360) * 0.2);
      camera.position.add(shift);
      controls.target.add(shift);
      camera.lookAt(controls.target);
    }
    controls.update();
    invalidate();
    // re-run when the model changes or the projection swaps (a new camera object is created)
  }, [command.n, projection, box, camera, controls, size.width, size.height, invalidate, command.view, mobile]);
  return null;
}

export function AssemblyScene({ assembly }: { assembly: Assembly }) {
  const section = useViewer3D((s) => s.section);
  const measure = useViewer3D((s) => s.measure);
  const projection = useViewer3D((s) => s.projection);
  const gl = useThree((s) => s.gl);
  const threeState = useThree();
  useEffect(() => {
    // dev-only inspection hook (stripped from production builds)
    if (import.meta.env.DEV) (window as unknown as { __ks?: unknown }).__ks = threeState;
  });
  const [pts, setPts] = useState<MeasureState>({});

  useEffect(() => {
    gl.localClippingEnabled = true;
  }, [gl]);

  useEffect(() => {
    if (!measure) setPts({});
  }, [measure]);

  const box = useMemo(() => assemblyBox(assembly), [assembly]);
  const tilt = useMemo(() => {
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    tiltMatrix(assembly).decompose(pos, quat, new THREE.Vector3());
    return { pos, quat };
  }, [assembly]);

  const clip = useMemo(() => {
    if (!section.enabled) return [] as THREE.Plane[];
    const axisIdx = { x: 0, y: 1, z: 2 }[section.axis];
    const min = [box.min.x, box.min.y, box.min.z][axisIdx] as number;
    const max = [box.max.x, box.max.y, box.max.z][axisIdx] as number;
    const at = min + (max - min) * section.position;
    const n = new THREE.Vector3();
    n.setComponent(axisIdx, section.flip ? -1 : 1);
    return [new THREE.Plane(n, section.flip ? at : -at)];
  }, [section, box]);

  const pick = (e: ThreeEvent<MouseEvent>) => {
    if (!measure) return;
    // ignore clicks that were really orbit drags
    if (e.delta > 4) return;
    e.stopPropagation();
    const p = e.point.clone();
    setPts((s) => (!s.a || (s.a && s.b) ? { a: p } : { a: s.a, b: p }));
  };

  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const span = Math.max(size.x, size.z, 100);

  return (
    <>
      {projection === 'perspective' ? (
        <PerspectiveCamera makeDefault fov={32} near={1} far={8000} position={[300, 260, 420]} />
      ) : (
        <OrthographicCamera makeDefault near={-4000} far={8000} position={[300, 260, 420]} zoom={2} />
      )}
      <OrbitControls
        makeDefault
        enableDamping
        dampingFactor={0.12}
        rotateSpeed={0.8}
        zoomSpeed={0.9}
        maxPolarAngle={Math.PI * 0.92}
        minDistance={30}
        maxDistance={3000}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
        mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
      />
      <CameraRig box={box} />

      {/* Procedural studio environment: soft boxes only, no HDR download (works offline, on GitHub Pages and phones). */}
      <Environment resolution={256} frames={1} environmentIntensity={0.85}>
        <Lightformer form="rect" intensity={2.4} rotation-x={Math.PI / 2} position={[0, 6, -2]} scale={[14, 10, 1]} />
        <Lightformer form="rect" intensity={1.6} rotation-y={Math.PI / 2} position={[-6, 2, 0]} scale={[10, 3, 1]} />
        <Lightformer form="rect" intensity={1.2} rotation-y={-Math.PI / 2} position={[6, 2, 0]} scale={[10, 3, 1]} />
        <Lightformer form="ring" intensity={1.5} position={[0, 3, 8]} scale={4} />
        <color attach="background" args={['#101418']} />
      </Environment>
      <hemisphereLight args={['#ffffff', '#33405a', 0.35]} />
      <directionalLight position={[220, 400, 260]} intensity={1.1} />
      <directionalLight position={[-300, 200, -160]} intensity={0.35} />
      <ContactShadows
        key={assembly.parts.length + (assembly.caseColor ?? '')}
        position={[center.x, 0.04, center.z]}
        scale={Math.max(size.x, size.z) * 1.9}
        far={Math.max(size.y, 40) * 1.4}
        blur={2.8}
        opacity={0.55}
        resolution={512}
        frames={1}
      />

      <Grid
        position={[center.x, -0.05, center.z]}
        args={[span * 4, span * 4]}
        cellSize={10}
        sectionSize={100}
        cellThickness={0.6}
        sectionThickness={1}
        cellColor="#394659"
        sectionColor="#5b6b83"
        fadeDistance={span * 3}
        fadeStrength={1.5}
        infiniteGrid
      />

      <group position={tilt.pos} quaternion={tilt.quat}>
        {assembly.parts.map((p) => (
          <PartMesh key={p.id} part={p} assembly={assembly} clip={clip} onPick={pick} />
        ))}
        <CollisionMarkers assembly={assembly} />
      </group>
      {measure && <Measure3D state={pts} />}
    </>
  );
}
