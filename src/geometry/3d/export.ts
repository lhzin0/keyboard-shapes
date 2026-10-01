/**
 * Assembly → glTF/GLB.
 *
 * Every part becomes a node named "<layer>/<part id>" (e.g. "keycaps/keycaps-0"), so any viewer — and our own
 * GLB loader — can toggle layers by name. Instanced parts (switches, keycaps) are baked into one mesh per part.
 * The typing angle is applied to the root node; the desk is Y = 0, the front of the keyboard points to +Z.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { tiltMatrix, type Assembly, type AssemblyPart } from './KeyboardAssembly';
import { ROLE_COLOR, ROLE_FINISH } from './palette';

function bake(part: AssemblyPart): THREE.BufferGeometry {
  if (!part.instances) return part.geometry.clone();
  const count = part.instances.length / 16;
  const m = new THREE.Matrix4();
  const baked: THREE.BufferGeometry[] = [];
  for (let i = 0; i < count; i++) {
    m.fromArray(part.instances, i * 16);
    const g = part.geometry.clone();
    g.applyMatrix4(m);
    baked.push(g);
  }
  const merged = mergeGeometries(baked.map((g) => (g.index ? g.toNonIndexed() : g)), false);
  baked.forEach((g) => g.dispose());
  return merged ?? new THREE.BufferGeometry();
}

export function assemblyToScene(a: Assembly, name = 'keyboard'): THREE.Group {
  const root = new THREE.Group();
  root.name = name;
  const tilt = tiltMatrix(a);
  tilt.decompose(root.position, root.quaternion, root.scale);
  for (const part of a.parts) {
    const finish = ROLE_FINISH[part.role];
    const mat = new THREE.MeshStandardMaterial({ color: ROLE_COLOR[part.role], metalness: finish.metalness, roughness: finish.roughness });
    mat.name = part.role;
    const geo = bake(part);
    // glTF exporter needs normals/positions only; drop anything else for a lean file
    for (const k of Object.keys(geo.attributes)) if (k !== 'position' && k !== 'normal') geo.deleteAttribute(k);
    if (!geo.getAttribute('normal')) geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = `${part.layer}/${part.id}`;
    mesh.userData = { layer: part.layer, role: part.role, centerZ: part.centerZ };
    root.add(mesh);
  }
  return root;
}

export async function assemblyToGlb(a: Assembly, name = 'keyboard'): Promise<ArrayBuffer> {
  const { GLTFExporter } = await import('three/examples/jsm/exporters/GLTFExporter.js');
  const scene = assemblyToScene(a, name);
  const exporter = new GLTFExporter();
  const result = await exporter.parseAsync(scene, { binary: true, onlyVisible: false });
  scene.traverse((o) => {
    if ((o as THREE.Mesh).isMesh) {
      (o as THREE.Mesh).geometry.dispose();
      ((o as THREE.Mesh).material as THREE.Material).dispose();
    }
  });
  return result as ArrayBuffer;
}
