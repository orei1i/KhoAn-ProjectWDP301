'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Eye, EyeOff, Home, Layers, Minus, Plus, RefreshCw } from 'lucide-react';
import { PUBLIC_UNIT_STATUS, type PublicSiteUnit, type PublicUnitStatus, type UnitCategory } from '@ssm/shared';
import { cx } from '@/shared/ui';
import { UNIT_CATEGORY } from '@/shared/lib/labels';
import type { Site3DType } from './facility-3d-panel';
import { buildLayout, floorLabel, type PlacedLabel, type PlacedSlab, type PlacedUnit, type SiteLayout } from './layout';
import { COLOR, siteProps, type BoxSpec, type SignSpec, type TreeSpec } from './site-props';

// Màu ô theo trạng thái: cửa cuốn xanh thương hiệu = còn trống; xám = không thuê được; cam = đang chọn.
const UNIT_COLORS: Record<PublicUnitStatus | 'PICKED', { door: string; roof: string; body: string }> = {
  AVAILABLE: { door: '#14a085', roof: '#5fcdb4', body: COLOR.wall },
  UNAVAILABLE: { door: '#a3aeab', roof: '#ccd3d1', body: COLOR.wallShade },
  PICKED: { door: '#f97316', roof: '#fdba74', body: '#fff3e6' },
};
const STATUSES: PublicUnitStatus[] = ['AVAILABLE', 'UNAVAILABLE'];

const DEFAULT_AZIMUTH = 0.62;
const DEFAULT_POLAR = 0.98;
const MAX_POLAR = 1.42;
const SLAB_THICK = 0.3;

const tmp = new THREE.Object3D();
const tmpColor = new THREE.Color();
const WHITE = new THREE.Color('#ffffff');
const seat = (mesh: THREE.InstancedMesh | null, count: number, fill: (i: number, o: THREE.Object3D) => void, colorOf?: (i: number) => THREE.ColorRepresentation) => {
  if (!mesh) return;
  for (let i = 0; i < count; i++) {
    tmp.position.set(0, 0, 0); tmp.scale.set(1, 1, 1); tmp.rotation.set(0, 0, 0);
    fill(i, tmp);
    tmp.updateMatrix();
    mesh.setMatrixAt(i, tmp.matrix);
    if (colorOf) mesh.setColorAt(i, tmpColor.set(colorOf(i)));
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.computeBoundingSphere();
};

/** Mọi khối hộp tĩnh của cảnh gộp vào một instanced mesh — một lần vẽ. */
function Boxes({ items, cast = true }: { items: BoxSpec[]; cast?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    seat(ref.current, items.length, (i, o) => { o.position.set(...items[i].p); o.scale.set(...items[i].s); }, (i) => items[i].c);
  }, [items]);
  if (items.length === 0) return null;
  return (
    <instancedMesh key={items.length} ref={ref} args={[undefined, undefined, items.length]} castShadow={cast} receiveShadow>
      <boxGeometry />
      <meshStandardMaterial roughness={0.92} />
    </instancedMesh>
  );
}

function Trees({ items }: { items: TreeSpec[] }) {
  const lower = useRef<THREE.InstancedMesh>(null);
  const upper = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    seat(lower.current, items.length, (i, o) => { const t = items[i]; o.position.set(t.x, 1.2 + t.h * 0.3, t.z); o.scale.set(1.7, t.h * 0.6, 1.7); }, (i) => items[i].c);
    seat(upper.current, items.length, (i, o) => { const t = items[i]; o.position.set(t.x, 1.2 + t.h * 0.72, t.z); o.scale.set(1.25, t.h * 0.5, 1.25); }, (i) => items[i].c);
  }, [items]);
  if (items.length === 0) return null;
  return (
    <>
      <instancedMesh key={`a${items.length}`} ref={lower} args={[undefined, undefined, items.length]} castShadow><coneGeometry args={[1, 1, 7]} /><meshStandardMaterial roughness={1} flatShading /></instancedMesh>
      <instancedMesh key={`b${items.length}`} ref={upper} args={[undefined, undefined, items.length]} castShadow><coneGeometry args={[1, 1, 7]} /><meshStandardMaterial roughness={1} flatShading /></instancedMesh>
    </>
  );
}

// ---- chữ trên cảnh: vẽ bằng canvas, không tải font ngoài
function useCanvasTexture(draw: (ctx: CanvasRenderingContext2D, c: HTMLCanvasElement) => void, deps: unknown[]) {
  const tex = useMemo(() => {
    const c = document.createElement('canvas');
    draw(c.getContext('2d')!, c);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    t.userData.aspect = c.width / c.height;
    return t;
  }, deps);
  useEffect(() => () => tex.dispose(), [tex]);
  return tex;
}

const FONT = "'Segoe UI', Roboto, Arial, sans-serif";

function Sign({ spec }: { spec: SignSpec }) {
  const tex = useCanvasTexture((ctx, c) => {
    c.width = 512; c.height = 160;
    ctx.fillStyle = COLOR.brandDark; ctx.beginPath(); ctx.roundRect(0, 0, 512, 160, 24); ctx.fill();
    ctx.fillStyle = COLOR.brand; ctx.beginPath(); ctx.roundRect(28, 30, 100, 100, 20); ctx.fill();
    ctx.strokeStyle = '#fff'; ctx.lineWidth = 8; ctx.lineJoin = 'round'; ctx.beginPath();
    ctx.moveTo(48, 72); ctx.lineTo(78, 48); ctx.lineTo(108, 72); ctx.lineTo(108, 112); ctx.lineTo(48, 112); ctx.closePath(); ctx.moveTo(62, 112); ctx.lineTo(62, 88); ctx.lineTo(94, 88); ctx.lineTo(94, 112); ctx.stroke();
    ctx.font = `800 96px ${FONT}`; ctx.textBaseline = 'middle'; ctx.fillStyle = '#fff'; ctx.fillText('Kho', 150, 86);
    const w = ctx.measureText('Kho').width; ctx.fillStyle = '#aee8d9'; ctx.fillText('An', 150 + w, 86);
  }, []);
  return <mesh position={spec.p}><planeGeometry args={[spec.w, spec.w * (160 / 512)]} /><meshBasicMaterial map={tex} toneMapped={false} /></mesh>;
}

function FloorPlate({ label }: { label: PlacedLabel }) {
  const tex = useCanvasTexture((ctx, c) => {
    const font = `700 44px ${FONT}`;
    ctx.font = font;
    c.width = Math.ceil(ctx.measureText(label.text).width) + 56; c.height = 76;
    ctx.fillStyle = 'rgba(255,255,255,.92)'; ctx.beginPath(); ctx.roundRect(0, 0, c.width, c.height, 16); ctx.fill();
    ctx.font = font; ctx.fillStyle = '#0e554a'; ctx.textBaseline = 'middle'; ctx.fillText(label.text, 28, 40);
  }, [label.text]);
  return (
    <mesh position={[label.x, label.y, label.z]} rotation-x={-Math.PI / 2}>
      <planeGeometry args={[label.size * (tex.userData.aspect as number), label.size]} />
      <meshBasicMaterial map={tex} transparent toneMapped={false} />
    </mesh>
  );
}

/** Thanh cửa cuốn: sọc ngang nhân với màu của từng ô. */
function useSlatTexture() {
  const tex = useCanvasTexture((ctx, c) => {
    c.width = 4; c.height = 64;
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 4, 64);
    ctx.fillStyle = 'rgba(0,0,0,.2)';
    for (let y = 0; y < 64; y += 8) ctx.fillRect(0, y + 6, 4, 2);
  }, []);
  return tex;
}

const colorsOf = (p: PlacedUnit, selected: ReadonlySet<string>) => UNIT_COLORS[selected.has(p.unit._id) ? 'PICKED' : p.unit.status];

/** Các ô kho: thân + cửa + nắp là ba instanced mesh; thân nhận sự kiện chuột theo `instanceId`. */
function Units({ units, selected, hoverId, onHover, onTap }: {
  units: PlacedUnit[]; selected: ReadonlySet<string>; hoverId: string | null;
  onHover: (p: PlacedUnit | null, e?: ThreeEvent<PointerEvent>) => void; onTap: (p: PlacedUnit, e: ThreeEvent<MouseEvent>) => void;
}) {
  const body = useRef<THREE.InstancedMesh>(null);
  const door = useRef<THREE.InstancedMesh>(null);
  const roof = useRef<THREE.InstancedMesh>(null);
  const slats = useSlatTexture();
  const invalidate = useThree((s) => s.invalidate);
  const gl = useThree((s) => s.gl);

  useLayoutEffect(() => {
    seat(body.current, units.length, (i, o) => { const p = units[i]; o.position.set(p.x, p.y + p.h / 2, p.z); o.scale.set(p.w, p.h, p.d); });
    seat(door.current, units.length, (i, o) => { const p = units[i]; o.position.set(p.x, p.y + p.h * 0.43, p.z + p.d / 2 + 0.03); o.scale.set(p.w * 0.84, p.h * 0.82, 0.06); });
    seat(roof.current, units.length, (i, o) => { const p = units[i]; o.position.set(p.x, p.y + p.h + 0.04, p.z); o.scale.set(p.w + 0.06, 0.08, p.d + 0.06); });
    gl.shadowMap.needsUpdate = true;
    invalidate();
  }, [units, gl, invalidate]);

  // Tô màu tách riêng khỏi vị trí: rê chuột / chọn ô chỉ đổi màu, bóng đổ không cần vẽ lại.
  useLayoutEffect(() => {
    for (let i = 0; i < units.length; i++) {
      const p = units[i];
      const c = colorsOf(p, selected);
      const lift = p.unit._id === hoverId ? 0.3 : 0;
      for (const [mesh, hex] of [[body.current, c.body], [door.current, c.door], [roof.current, c.roof]] as const) mesh?.setColorAt(i, tmpColor.set(hex).lerp(WHITE, lift));
    }
    for (const m of [body.current, door.current, roof.current]) if (m?.instanceColor) m.instanceColor.needsUpdate = true;
    invalidate();
  }, [units, selected, hoverId, invalidate]);

  const count = units.length;
  if (count === 0) return null;
  return (
    <>
      <instancedMesh key={`b${count}`} ref={body} args={[undefined, undefined, count]} castShadow receiveShadow
        onPointerMove={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); if (e.instanceId !== undefined && e.nativeEvent.buttons === 0) onHover(units[e.instanceId], e); }}
        onPointerOut={() => onHover(null)}
        onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); if (e.instanceId !== undefined && e.delta < 7) onTap(units[e.instanceId], e); }}>
        <boxGeometry />
        <meshStandardMaterial roughness={0.9} />
      </instancedMesh>
      <instancedMesh key={`d${count}`} ref={door} args={[undefined, undefined, count]}><boxGeometry /><meshStandardMaterial map={slats} roughness={0.7} /></instancedMesh>
      <instancedMesh key={`r${count}`} ref={roof} args={[undefined, undefined, count]} receiveShadow><boxGeometry /><meshStandardMaterial roughness={0.85} /></instancedMesh>
    </>
  );
}

/** Mũi ghim nổi trên các ô đang chọn — nhìn từ xa vẫn thấy. */
function Pins({ units, selected }: { units: PlacedUnit[]; selected: ReadonlySet<string> }) {
  const picked = useMemo(() => units.filter((p) => selected.has(p.unit._id)), [units, selected]);
  const ref = useRef<THREE.InstancedMesh>(null);
  const invalidate = useThree((s) => s.invalidate);
  useLayoutEffect(() => {
    seat(ref.current, picked.length, (i, o) => { const p = picked[i]; o.position.set(p.x, p.y + p.h + 1.4, p.z); o.scale.set(0.8, 1.8, 0.8); o.rotation.x = Math.PI; });
    invalidate();
  }, [picked, invalidate]);
  if (picked.length === 0) return null;
  return <instancedMesh key={picked.length} ref={ref} args={[undefined, undefined, picked.length]} frustumCulled={false}><coneGeometry args={[1, 1, 6]} /><meshBasicMaterial color="#f97316" toneMapped={false} /></instancedMesh>;
}

/** Sàn các tầng trên: kính mờ nên vẫn thấy các dãy tầng dưới; không đổ bóng, không chặn chuột (rê chuột trúng ô gần mắt nhất). */
function GlassDecks({ slabs }: { slabs: PlacedSlab[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    seat(ref.current, slabs.length, (i, o) => { const s = slabs[i]; o.position.set(s.x, s.y + SLAB_THICK / 2, s.z); o.scale.set(s.w, SLAB_THICK, s.d); });
  }, [slabs]);
  if (slabs.length === 0) return null;
  return (
    <instancedMesh key={slabs.length} ref={ref} args={[undefined, undefined, slabs.length]}>
      <boxGeometry />
      <meshStandardMaterial color={COLOR.slab} transparent opacity={0.34} depthWrite={false} roughness={0.5} />
    </instancedMesh>
  );
}

/** Khung từng tầng đang hiện: sàn trệt đặc, viền sàn, lan can thấp ở tường sau và bốn cột góc. */
function frameOf(slabs: PlacedSlab[]): BoxSpec[] {
  const out: BoxSpec[] = [];
  const topLevel = Math.max(...slabs.map((s) => s.level));
  for (const s of slabs) {
    if (s.level === 0) out.push({ p: [s.x, s.y + SLAB_THICK / 2, s.z], s: [s.w, SLAB_THICK, s.d], c: COLOR.deck });
    const top = s.y + SLAB_THICK;
    const x0 = s.x - s.w / 2; const x1 = s.x + s.w / 2; const z0 = s.z - s.d / 2; const z1 = s.z + s.d / 2;
    for (const z of [z0, z1]) out.push({ p: [s.x, top - 0.08, z], s: [s.w, 0.16, 0.16], c: COLOR.beam });
    for (const x of [x0, x1]) out.push({ p: [x, top - 0.08, s.z], s: [0.16, 0.16, s.d], c: COLOR.beam });
    out.push({ p: [s.x, top + 0.4, z0 + 0.08], s: [s.w, 0.8, 0.16], c: COLOR.wall });
    if (s.level === topLevel) continue; // tầng trên cùng không còn gì để đỡ
    const h = s.storey - SLAB_THICK;
    for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) out.push({ p: [x, top + h / 2, z], s: [0.26, h, 0.26], c: COLOR.column });
  }
  return out;
}

interface RigApi { zoom: (factor: number) => void; reset: () => void; top: () => void }

/** Camera + OrbitControls: kéo xoay, chụm / lăn phóng to; có khung hình đích để chuyển 3D ⇄ nhìn từ trên mượt. Chỉ vẽ khi có thay đổi (frameloop demand). */
function Rig({ lot, topMode, autoRotate, api, compass }: {
  lot: SiteLayout['bounds']; topMode: boolean; autoRotate: boolean; api: RefObject<RigApi | null>; compass: RefObject<HTMLSpanElement | null>;
}) {
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  const get = useThree((s) => s.get);
  const controls = useRef<OrbitControls | null>(null);
  const goal = useRef<{ pos: THREE.Vector3; target: THREE.Vector3 } | null>(null);
  const centre = useMemo(() => new THREE.Vector3((lot.minX + lot.maxX) / 2, 1, (lot.minZ + lot.maxZ) / 2), [lot]);

  const fitDistance = () => {
    const { width, height } = get().size;
    const aspect = height > 0 ? width / height : 1;
    const v = THREE.MathUtils.degToRad(camera.fov);
    const h = 2 * Math.atan(Math.tan(v / 2) * aspect);
    const r = Math.hypot(lot.maxX - lot.minX, lot.maxZ - lot.minZ) / 2;
    // Màn hình dọc ưu tiên khu nhà, cho phép cắt bớt sân và cây ở hai bên.
    return (r * (aspect < 1 ? 0.72 : 0.84)) / Math.sin(Math.min(v, h) / 2);
  };
  const poseOf = (azimuth: number, polar: number, dist: number) => new THREE.Vector3().setFromSphericalCoords(dist, polar, azimuth).add(centre);

  useLayoutEffect(() => {
    const dist = fitDistance();
    const c = new OrbitControls(camera, gl.domElement);
    c.enableDamping = true;
    c.dampingFactor = 0.12;
    c.autoRotateSpeed = 0.9;
    c.maxPolarAngle = MAX_POLAR;
    c.minDistance = 5;
    c.maxDistance = dist * 2.2;
    c.target.copy(centre);
    camera.far = dist * 6;
    camera.near = 0.5;
    camera.position.copy(poseOf(DEFAULT_AZIMUTH, DEFAULT_POLAR, dist));
    camera.updateProjectionMatrix();
    c.update();
    const onChange = () => invalidate();
    const onStart = () => { goal.current = null; };
    c.addEventListener('change', onChange);
    c.addEventListener('start', onStart);
    controls.current = c;
    invalidate();
    return () => { c.removeEventListener('change', onChange); c.removeEventListener('start', onStart); c.dispose(); controls.current = null; };
  }, [camera, gl, centre, invalidate]);

  useEffect(() => {
    const c = controls.current;
    if (!c) return;
    // Nhìn từ trên: kéo một ngón / chuột trái để dời bản đồ thay vì xoay.
    c.enableRotate = !topMode;
    c.mouseButtons.LEFT = topMode ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE;
    c.touches.ONE = topMode ? THREE.TOUCH.PAN : THREE.TOUCH.ROTATE;
    c.autoRotate = autoRotate && !topMode;
    invalidate();
  }, [topMode, autoRotate, invalidate]);

  api.current = {
    zoom: (factor) => {
      const c = controls.current;
      if (!c) return;
      const offset = camera.position.clone().sub(c.target);
      const dist = THREE.MathUtils.clamp(offset.length() * factor, c.minDistance, c.maxDistance);
      goal.current = { pos: c.target.clone().add(offset.setLength(dist)), target: c.target.clone() };
      invalidate();
    },
    reset: () => { goal.current = { pos: poseOf(DEFAULT_AZIMUTH, DEFAULT_POLAR, fitDistance()), target: centre.clone() }; invalidate(); },
    top: () => { goal.current = { pos: centre.clone().add(new THREE.Vector3(0, fitDistance() * 1.08, 0.02)), target: centre.clone() }; invalidate(); },
  };

  useFrame((_, delta) => {
    const c = controls.current;
    if (!c) return;
    const dt = Math.min(delta, 0.05);
    const g = goal.current;
    if (g) {
      const k = 1 - Math.exp(-dt * 7);
      camera.position.lerp(g.pos, k);
      c.target.lerp(g.target, k);
      if (camera.position.distanceTo(g.pos) < 0.05) { camera.position.copy(g.pos); c.target.copy(g.target); goal.current = null; }
      invalidate();
    }
    // Không cho dời ra khỏi khu đất.
    c.target.x = THREE.MathUtils.clamp(c.target.x, lot.minX, lot.maxX);
    c.target.z = THREE.MathUtils.clamp(c.target.z, lot.minZ, lot.maxZ);
    c.target.y = THREE.MathUtils.clamp(c.target.y, 0, lot.maxY);
    c.update(dt);
    if (compass.current) compass.current.style.transform = `rotate(${c.getAzimuthalAngle()}rad)`;
  });
  return null;
}

/** Chạy một lần khi cảnh thay đổi — bóng đổ cũng chỉ vẽ lại lúc đó, xoay camera không tốn lại. */
function ShadowSetup({ refresh }: { refresh: unknown }) {
  const gl = useThree((s) => s.gl);
  const invalidate = useThree((s) => s.invalidate);
  useEffect(() => {
    gl.shadowMap.autoUpdate = false;
    gl.shadowMap.needsUpdate = true;
    invalidate();
  }, [gl, refresh, invalidate]);
  return null;
}

const toolBtn = 'grid size-9 place-items-center rounded-lg bg-white/95 text-stone-700 shadow ring-1 ring-stone-200 transition-colors hover:bg-stone-50 disabled:opacity-40';

export default function FacilityScene({ units, types, selected, onToggle, onBlocked, onContextLost }: {
  units: PublicSiteUnit[]; types: Site3DType[]; selected: readonly string[];
  onToggle: (unit: PublicSiteUnit) => void; onBlocked: (message: string) => void; onContextLost: () => void;
}) {
  // Đổi thời hạn thì giá đổi nhưng kích thước không: bố cục chỉ theo ô + kích thước, nên camera và cảnh được giữ nguyên.
  const sizesKey = JSON.stringify(types.map((t) => [t._id, t.category, t.dimensions]));
  const layout = useMemo(() => buildLayout(units, JSON.parse(sizesKey).map(([_id, category, dimensions]: [string, UnitCategory, Site3DType['dimensions']]) => ({ _id, category, dimensions }))), [units, sizesKey]);
  const props = useMemo(() => siteProps(layout), [layout]);
  const lot = useMemo(() => ({ ...props.lot, maxY: layout.bounds.maxY }), [props, layout]);
  const typeOf = useMemo(() => new Map(types.map((t) => [t._id, t])), [types]);
  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const [topMode, setTopMode] = useState(false);
  const [autoRotate, setAutoRotate] = useState(false);
  const [hiddenFloors, setHiddenFloors] = useState<readonly number[]>([]);
  const [layersOpen, setLayersOpen] = useState(false);
  // Thẻ thông tin ô: chuột → bám theo con trỏ; cảm ứng → ghim phía trên chú thích tới lần chạm kế tiếp.
  const [info, setInfo] = useState<{ placed: PlacedUnit; touch: boolean } | null>(null);

  const box = useRef<HTMLDivElement>(null);
  const tip = useRef<HTMLDivElement>(null);
  const compass = useRef<HTMLSpanElement>(null);
  const rig = useRef<RigApi | null>(null);
  const lastTouch = useRef(0);
  const pointer = useRef({ x: 0, y: 0 });
  // Rời chế độ 3D thì fiber tự giải phóng WebGL (cũng phát webglcontextlost) — chỉ báo lỗi khi cảnh còn đang mở.
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);

  const hidden = useMemo(() => new Set(hiddenFloors), [hiddenFloors]);
  const shownUnits = useMemo(() => layout.units.filter((p) => !hidden.has(p.floor)), [layout, hidden]);
  const shownSlabs = useMemo(() => layout.slabs.filter((s) => !hidden.has(s.floor)), [layout, hidden]);
  const upperSlabs = useMemo(() => shownSlabs.filter((s) => s.level > 0), [shownSlabs]);
  const shownLabels = useMemo(() => layout.labels.filter((l) => !hidden.has(l.floor)), [layout, hidden]);
  const frame = useMemo(() => frameOf(shownSlabs), [shownSlabs]);
  const counts = useMemo(() => {
    const out: Record<PublicUnitStatus, number> = { AVAILABLE: 0, UNAVAILABLE: 0 };
    for (const u of units) out[u.status]++;
    return out;
  }, [units]);

  const moveTip = () => {
    const el = tip.current;
    const host = box.current;
    if (!el || !host) return;
    const r = host.getBoundingClientRect();
    const x = Math.min(pointer.current.x - r.left + 14, r.width - el.offsetWidth - 8);
    const y = Math.max(8, Math.min(pointer.current.y - r.top + 14, r.height - el.offsetHeight - 8));
    el.style.transform = `translate(${Math.max(8, x)}px, ${y}px)`;
  };
  useLayoutEffect(() => { if (info && !info.touch) moveTip(); }, [info]);
  const onHover = (p: PlacedUnit | null, e?: ThreeEvent<PointerEvent>) => {
    // Chạm vừa xong trình duyệt phát thêm pointer ảo — bỏ qua để thẻ của lần chạm không bị mất.
    if (e && e.nativeEvent.pointerType !== 'mouse') return;
    if (Date.now() - lastTouch.current < 700) return;
    if (e) pointer.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
    setInfo((cur) => (cur?.placed.unit._id === p?.unit._id && !cur?.touch ? cur : p ? { placed: p, touch: false } : null));
    if (p) moveTip();
  };
  const onTap = (p: PlacedUnit, e: ThreeEvent<MouseEvent>) => {
    // Trình duyệt cũ có thể không báo pointerType trên click — không chắc là chuột thì coi như chạm.
    const touch = (e.nativeEvent as PointerEvent).pointerType !== 'mouse';
    if (touch) { lastTouch.current = Date.now(); setInfo({ placed: p, touch: true }); }
    const u = p.unit;
    if (selectedSet.has(u._id)) { onToggle(u); return; }
    if (u.status !== 'AVAILABLE') return;
    const off = typeOf.get(u.unitTypeId)?.offReason;
    if (off) { onBlocked(off); return; }
    onToggle(u);
  };

  // Nhìn từ trên thì các tầng chồng khít lên nhau — xem từng tầng một (mặc định tầng thấp nhất); góc 3D thì bật / tắt tự do.
  const onlyFloor = (f: number) => layout.floors.filter((x) => x !== f);
  const toggleFloor = (f: number) => setHiddenFloors((c) => (topMode ? onlyFloor(f) : c.includes(f) ? c.filter((x) => x !== f) : [...c, f]));
  const goTop = (on: boolean) => {
    setTopMode(on);
    setInfo(null);
    setHiddenFloors(on ? onlyFloor(layout.floors[0]) : []);
    if (on) { setLayersOpen(true); rig.current?.top(); } else rig.current?.reset();
  };

  const t = info ? typeOf.get(info.placed.unit.unitTypeId) : undefined;
  const iu = info?.placed.unit;
  const infoPicked = !!iu && selectedSet.has(iu._id);
  const canPick = !!iu && iu.status === 'AVAILABLE' && !t?.offReason;
  const lightSize = Math.max(lot.maxX - lot.minX, lot.maxZ - lot.minZ) * 0.72;

  return (
    <div>
      <div ref={box} role="group" aria-label="Mô hình 3D minh hoạ bố trí chi nhánh — có thể dùng sơ đồ 2D thay thế" className={cx('relative h-[62vh] max-h-[640px] min-h-[380px] overflow-hidden rounded-xl bg-[#e8ebea] ring-1 ring-stone-200', info && canPick && !info.touch && 'cursor-pointer')}>
        <Canvas
          flat shadows="percentage" frameloop="demand" dpr={[1, 1.75]} gl={{ antialias: true }} camera={{ fov: 36, position: [40, 50, 60] }}
          onCreated={({ gl }) => { gl.domElement.addEventListener('webglcontextlost', (e) => { e.preventDefault(); if (mounted.current) onContextLost(); }); }}
          onPointerMissed={() => setInfo(null)}
        >
          <color attach="background" args={[COLOR.ground]} />
          <hemisphereLight args={['#ffffff', '#dfe5e3', 2]} />
          <directionalLight
            position={[lightSize * 0.75, lightSize * 1.25, lightSize * 0.55]} intensity={2} castShadow
            shadow-mapSize={[2048, 2048]} shadow-radius={5} shadow-bias={-0.0004} shadow-normalBias={0.04}
            shadow-camera-left={-lightSize} shadow-camera-right={lightSize} shadow-camera-top={lightSize} shadow-camera-bottom={-lightSize} shadow-camera-near={1} shadow-camera-far={lightSize * 4}
          />
          <ShadowSetup refresh={`${hiddenFloors.join()}|${units.length}`} />
          <mesh rotation-x={-Math.PI / 2} position={[0, -0.02, 0]} receiveShadow>
            <planeGeometry args={[lightSize * 9, lightSize * 9]} />
            <meshStandardMaterial color={COLOR.ground} roughness={1} />
          </mesh>
          <Boxes items={props.flats} cast={false} />
          <Boxes items={props.solids} />
          <Trees items={props.trees} />
          {props.signs.map((s) => <Sign key={`${s.p[0]}|${s.p[2]}`} spec={s} />)}
          <Boxes items={frame} />
          {shownLabels.map((l) => <FloorPlate key={`${l.floor}|${l.text}|${l.x}|${l.z}`} label={l} />)}
          <Units units={shownUnits} selected={selectedSet} hoverId={iu?._id ?? null} onHover={onHover} onTap={onTap} />
          <Pins units={shownUnits} selected={selectedSet} />
          <GlassDecks slabs={upperSlabs} />
          <Rig lot={lot} topMode={topMode} autoRotate={autoRotate} api={rig} compass={compass} />
        </Canvas>

        {/* ---- góc trái: 3D / nhìn từ trên + ẩn hiện tầng */}
        <div className="pointer-events-none absolute left-2 top-2 flex flex-col items-start gap-2">
          <div role="group" aria-label="Góc nhìn" className="pointer-events-auto inline-flex rounded-lg bg-white/95 p-0.5 shadow ring-1 ring-stone-200">
            <button type="button" aria-pressed={!topMode} onClick={() => goTop(false)} className={cx('rounded-md px-2.5 py-1.5 text-xs font-semibold', !topMode ? 'bg-ink text-white' : 'text-stone-600')}>3D</button>
            <button type="button" aria-pressed={topMode} onClick={() => goTop(true)} className={cx('rounded-md px-2.5 py-1.5 text-xs font-semibold', topMode ? 'bg-ink text-white' : 'text-stone-600')}>Nhìn từ trên</button>
          </div>
          {layout.floors.length > 1 && (
            <div className="pointer-events-auto flex flex-col items-start gap-1">
              <button type="button" aria-expanded={layersOpen} onClick={() => setLayersOpen((v) => !v)} className="inline-flex items-center gap-1.5 rounded-lg bg-white/95 px-2.5 py-1.5 text-xs font-semibold text-stone-700 shadow ring-1 ring-stone-200">
                <Layers className="size-3.5" />Tầng{hiddenFloors.length > 0 ? ` (${layout.floors.length - hiddenFloors.length}/${layout.floors.length})` : ''}
              </button>
              {layersOpen && [...layout.floors].reverse().map((f) => {
                const off = hidden.has(f);
                return (
                  <button key={f} type="button" aria-pressed={!off} onClick={() => toggleFloor(f)} className={cx('inline-flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-xs font-medium shadow ring-1', off ? 'bg-stone-100/95 text-stone-400 ring-stone-200' : 'bg-white/95 text-stone-800 ring-brand-300')}>
                    {floorLabel(f)}{off ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5 text-brand-600" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* ---- góc phải: la bàn, phóng to / thu nhỏ, về góc mặc định, xoay tự động */}
        <div className="absolute right-2 top-2 flex flex-col gap-1.5">
          <span role="img" title="Hướng Bắc (tượng trưng)" aria-label="Hướng Bắc (tượng trưng)" className="grid size-9 place-items-center rounded-full bg-white/95 shadow ring-1 ring-stone-200">
            <span ref={compass} className="relative grid size-8 place-items-center" style={{ transform: `rotate(${DEFAULT_AZIMUTH}rad)` }}>
              <svg viewBox="0 0 24 24" className="size-5" aria-hidden><path d="M12 5l3 7H9z" fill="#0d6b5b" /><path d="M12 21l-3-9h6z" fill="#c3cdca" /></svg>
              <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 text-[8px] font-bold leading-none text-brand-700">B</span>
            </span>
          </span>
          <button type="button" aria-label="Phóng to" title="Phóng to" className={toolBtn} onClick={() => rig.current?.zoom(0.72)}><Plus className="size-4" /></button>
          <button type="button" aria-label="Thu nhỏ" title="Thu nhỏ" className={toolBtn} onClick={() => rig.current?.zoom(1.38)}><Minus className="size-4" /></button>
          <button type="button" aria-label="Về góc mặc định" title="Về góc mặc định" className={toolBtn} onClick={() => goTop(false)}><Home className="size-4" /></button>
          <button type="button" aria-label="Xoay tự động" title="Xoay tự động" aria-pressed={autoRotate} disabled={topMode} className={cx(toolBtn, autoRotate && 'bg-brand-600 text-white ring-brand-600 hover:bg-brand-700')} onClick={() => setAutoRotate((v) => !v)}><RefreshCw className="size-4" /></button>
        </div>

        {/* ---- chú thích trạng thái */}
        <ul aria-label="Chú thích màu ô" className="pointer-events-none absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] flex-wrap gap-x-3 gap-y-1 rounded-lg bg-white/95 px-2.5 py-1.5 text-[11px] font-medium text-stone-700 shadow ring-1 ring-stone-200">
          <li className="inline-flex items-center gap-1.5"><span className="size-3 rounded-sm" style={{ background: UNIT_COLORS.PICKED.door }} />Đang chọn{selected.length ? ` (${selected.length})` : ''}</li>
          {STATUSES.map((s) => <li key={s} className="inline-flex items-center gap-1.5"><span className="size-3 rounded-sm" style={{ background: UNIT_COLORS[s].door }} />{PUBLIC_UNIT_STATUS[s].label} ({counts[s]})</li>)}
        </ul>

        {/* ---- thẻ thông tin ô */}
        {info && iu && (
          <div ref={tip} role="status" className={cx('pointer-events-none absolute min-w-40 max-w-[15rem] rounded-lg bg-white px-3 py-2 text-xs shadow-lift ring-1 ring-stone-200', info.touch ? 'bottom-16 left-1/2 -translate-x-1/2' : 'left-0 top-0')}>
            <p className="flex items-center justify-between gap-3"><b className="font-mono text-sm text-ink">{iu.unitNumber}</b><span className={cx('font-medium', iu.status === 'AVAILABLE' ? 'text-brand-700' : 'text-stone-500')}>{infoPicked ? 'Đang chọn' : PUBLIC_UNIT_STATUS[iu.status].label}</span></p>
            {t ? (
              <>
                <p className="mt-0.5 text-stone-700">{t.name} · {t.dimensions.widthM}×{t.dimensions.depthM}×{t.dimensions.heightM} m</p>
                <p className="text-stone-500">{UNIT_CATEGORY[t.category]}{iu.location.zone ? ` · ${iu.location.zone}` : ''} · {floorLabel(iu.location.floor)}</p>
                <p className="mt-0.5 font-semibold tabular-nums text-ink">{t.priceText}</p>
              </>
            ) : <p className="mt-0.5 text-stone-500">{floorLabel(iu.location.floor)}</p>}
            {t?.offReason && iu.status === 'AVAILABLE' && <p className="mt-1 text-amber-800">{t.offReason}</p>}
            {canPick && !t?.offReason && <p className="mt-1 font-medium text-brand-700">{infoPicked ? 'Bấm để bỏ chọn' : 'Bấm để chọn ô này'}</p>}
          </div>
        )}
      </div>
      <p className="mt-2 text-xs text-stone-500">Mô hình minh hoạ bố trí — không đúng tỉ lệ mặt bằng thật. {topMode && layout.floors.length > 1 ? 'Chọn tầng ở mục “Tầng” để xem từng tầng.' : 'Kéo để xoay, chụm hoặc lăn chuột để phóng to.'}</p>
    </div>
  );
}
