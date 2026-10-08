// viz3d.ts — tiện ích three.js dùng cho Galaxy (tinh hà tri thức). Shader energy-orb/plasma + starfield +
// force-layout 3D nhẹ (tự viết, node ít → khỏi thêm lib). Tách riêng để KHÔNG đụng BrainViz đang chạy.
import * as THREE from 'three'

// ── GLSL: simplex noise 3D (Ashima) + fbm — cùng kỹ thuật BrainViz cho glow volumetric ──
const SNOISE = `
vec4 permute(vec4 x){return mod(((x*34.0)+1.0)*x,289.0);}
vec4 taylorInvSqrt(vec4 r){return 1.79284291400159-0.85373472095314*r;}
float snoise(vec3 v){
  const vec2 C=vec2(1.0/6.0,1.0/3.0); const vec4 D=vec4(0.0,0.5,1.0,2.0);
  vec3 i=floor(v+dot(v,C.yyy)); vec3 x0=v-i+dot(i,C.xxx);
  vec3 g=step(x0.yzx,x0.xyz); vec3 l=1.0-g; vec3 i1=min(g.xyz,l.zxy); vec3 i2=max(g.xyz,l.zxy);
  vec3 x1=x0-i1+C.xxx; vec3 x2=x0-i2+C.yyy; vec3 x3=x0-D.yyy;
  i=mod(i,289.0);
  vec4 p=permute(permute(permute(i.z+vec4(0.0,i1.z,i2.z,1.0))+i.y+vec4(0.0,i1.y,i2.y,1.0))+i.x+vec4(0.0,i1.x,i2.x,1.0));
  float n_=1.0/7.0; vec3 ns=n_*D.wyz-D.xzx;
  vec4 j=p-49.0*floor(p*ns.z*ns.z);
  vec4 x_=floor(j*ns.z); vec4 y_=floor(j-7.0*x_);
  vec4 x=x_*ns.x+ns.yyyy; vec4 y=y_*ns.x+ns.yyyy; vec4 h=1.0-abs(x)-abs(y);
  vec4 b0=vec4(x.xy,y.xy); vec4 b1=vec4(x.zw,y.zw);
  vec4 s0=floor(b0)*2.0+1.0; vec4 s1=floor(b1)*2.0+1.0; vec4 sh=-step(h,vec4(0.0));
  vec4 a0=b0.xzyw+s0.xzyw*sh.xxyy; vec4 a1=b1.xzyw+s1.xzyw*sh.zzww;
  vec3 p0=vec3(a0.xy,h.x); vec3 p1=vec3(a0.zw,h.y); vec3 p2=vec3(a1.xy,h.z); vec3 p3=vec3(a1.zw,h.w);
  vec4 norm=taylorInvSqrt(vec4(dot(p0,p0),dot(p1,p1),dot(p2,p2),dot(p3,p3)));
  p0*=norm.x; p1*=norm.y; p2*=norm.z; p3*=norm.w;
  vec4 m=max(0.6-vec4(dot(x0,x0),dot(x1,x1),dot(x2,x2),dot(x3,x3)),0.0); m=m*m;
  return 42.0*dot(m*m,vec4(dot(p0,x0),dot(p1,x1),dot(p2,x2),dot(p3,x3)));
}`
const FBM = `float fbm(vec3 p){ float a=0.5,s=0.0; for(int i=0;i<4;i++){ s+=a*snoise(p); p*=2.02; a*=0.5; } return s; }`

export const ORB_VERT = `
varying vec3 vN; varying vec3 vView; varying vec3 vPos;
void main(){
  vN = normalize(normalMatrix*normal);
  vec4 mv = modelViewMatrix*vec4(position,1.0);
  vView = normalize(-mv.xyz); vPos = position;
  gl_Position = projectionMatrix*mv;
}`

// hành tinh tri thức: lõi sáng + rìa mờ + noise cuộn. uBright = độ tin/độ-mới, uActive = đang được recall.
export const PLANET_FRAG = SNOISE + FBM + `
uniform vec3 uColor; uniform float uTime; uniform float uActive; uniform float uBright; uniform float uSeed;
varying vec3 vN; varying vec3 vView; varying vec3 vPos;
void main(){
  vec3 d = normalize(vPos);
  float ndv = max(dot(normalize(vN), normalize(vView)), 0.0);
  float n = fbm(d*3.0 + vec3(0.0,uTime*0.35,0.0))*0.6 + fbm(d*7.0 - vec3(uTime*0.3))*0.4;
  n = n*0.5+0.5;
  float core = pow(ndv, 1.3);
  float rim  = pow(1.0-ndv, 2.2);
  float energy = 0.08 + core*(0.35 + 0.8*n) + rim*0.55;
  float pulse = 0.82 + 0.18*sin(uTime*2.0 + uSeed*6.2831);
  energy *= (0.45 + uBright*0.75 + uActive*1.1) * pulse;
  vec3 col = uColor * energy;
  col += vec3(1.0) * pow(n,3.0) * 0.22 * (core+0.2);
  col += uColor * uActive * rim * 0.9;            // recall → rìa bừng sáng
  gl_FragColor = vec4(col, clamp(energy,0.0,1.0));
}`

// lõi tinh hà (hành tinh trung tâm — node nhiều liên kết nhất): plasma cuộn, sáng sâu.
export const CORE_FRAG = SNOISE + FBM + `
uniform vec3 uColor; uniform float uTime;
varying vec3 vN; varying vec3 vView; varying vec3 vPos;
void main(){
  vec3 d = normalize(vPos); vec3 q = d*2.2;
  vec3 w = vec3(fbm(q+vec3(0.0,uTime*0.28,0.0)), fbm(q+vec3(5.2,uTime*0.22,1.3)), fbm(q+vec3(1.7,uTime*0.25,8.3)));
  float n = fbm(q*1.5 + w*1.9 + vec3(0.0,uTime*0.32,0.0)); n=n*0.5+0.5;
  float fil = fbm(d*6.0 + w*2.2 - vec3(uTime*0.45));
  float ndv = max(dot(normalize(vN), normalize(vView)),0.0);
  float rim = pow(1.0-ndv,2.0);
  vec3 col = mix(uColor*0.3, uColor, smoothstep(0.22,0.82,n));
  col += uColor*smoothstep(0.62,0.95,fil)*0.7;
  col += vec3(0.8,0.95,1.0)*rim*0.8;
  col *= (0.42+0.58*n);
  gl_FragColor = vec4(col, clamp(0.5+n*0.42+rim*0.5,0.0,1.0));
}`

// ── EDGE shader (đường sao = cung cong) — per-vertex alpha + color → progressive disclosure ──
// uOpacity = núm vặn live (mặc định mờ); aAlpha = trạng thái từng cạnh (ẩn/mờ/sáng theo hover+time-travel).
export const EDGE_VERT = `
attribute vec3 aColor; attribute float aAlpha;
varying vec3 vColor; varying float vAlpha;
void main(){ vColor=aColor; vAlpha=aAlpha; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`
export const EDGE_FRAG = `
precision mediump float; uniform float uOpacity;
varying vec3 vColor; varying float vAlpha;
void main(){ float a=vAlpha*uOpacity; if(a<=0.002) discard; gl_FragColor=vec4(vColor,a); }`

// lấy mẫu CUNG CONG mềm a→b (quadratic bezier): điểm giữa nâng RA NGOÀI tâm cầu → dây cong, không cắt ngang.
// lift ∝ chiều dài (cạnh dài cong nhiều hơn để vòng qua, không xuyên khối). Trả mảng điểm (SEG+1).
export function sampleArc(a: THREE.Vector3, b: THREE.Vector3, seg = 14, liftK = 0.22): THREE.Vector3[] {
  const mid = a.clone().add(b).multiplyScalar(0.5)
  const len = a.distanceTo(b)
  let out = mid.clone(); if (out.lengthSq() < 1e-4) out.copy(a).add(b).normalize() // tránh 0
  out.normalize()
  const ctrl = mid.addScaledVector(out, len * liftK)
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= seg; i++) {
    const t = i / seg, it = 1 - t
    // B(t) = it²·a + 2·it·t·ctrl + t²·b
    pts.push(new THREE.Vector3(
      it * it * a.x + 2 * it * t * ctrl.x + t * t * b.x,
      it * it * a.y + 2 * it * t * ctrl.y + t * t * b.y,
      it * it * a.z + 2 * it * t * ctrl.z + t * t * b.z,
    ))
  }
  return pts
}

// màu theo zone (chòm sao) — gold = lõi/người, cyan = dự án, lục = đã học, tím = entity…
export const ZONE_COLOR: Record<string, string> = {
  context: '#ffd27f', projects: '#3fd3ff', learned: '#5fe39a', entities: '#b48bff',
  skills: '#ffae6b', timeline: '#7fb0d0', decisions: '#ff8bd0', memory: '#5fd9c9', agents: '#c77dff', ghost: '#46566a',
}
export const zoneCol = (z: string) => new THREE.Color(ZONE_COLOR[z] || '#7fb0d0')

export function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return ((h >>> 0) % 1000000) / 1000000
}

// nền sao bay (parallax) — như BrainViz, làm tinh hà có chiều sâu.
export function makeStars(scene: THREE.Scene, n: number, spread: number, size: number, op: number, color: number): THREE.Points {
  const a = new Float32Array(n * 3)
  for (let i = 0; i < n * 3; i++) a[i] = (Math.random() - 0.5) * spread
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a, 3))
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ color, size, transparent: true, opacity: op, sizeAttenuation: true, depthWrite: false, blending: THREE.AdditiveBlending }))
  scene.add(pts); return pts
}

// ── FORCE-LAYOUT 3D nhẹ: charge repulsion + link spring + center gravity + disk-flatten (Y) ──
// Giữ vị trí cũ (prev) cho node đã có → tinh hà NỞ mượt, không nhảy loạn khi thêm node.
export type FNode = { id: string; mass: number }
export type FLink = { source: string; target: string; weight: number }
export function forceLayout3D(nodes: FNode[], links: FLink[], prev: Map<string, THREE.Vector3>, iters = 220): Map<string, THREE.Vector3> {
  const pos = new Map<string, THREE.Vector3>()
  const idx = new Map<string, number>()
  nodes.forEach((n, i) => {
    idx.set(n.id, i)
    const p = prev.get(n.id)
    // node mới: gieo trên đĩa quanh tâm (góc theo hash → ổn định giữa các lần)
    if (p) pos.set(n.id, p.clone())
    else { const a = hash01(n.id) * Math.PI * 2, r = 20 + hash01(n.id + 'r') * 40; pos.set(n.id, new THREE.Vector3(Math.cos(a) * r, (hash01(n.id + 'y') - 0.5) * 12, Math.sin(a) * r)) }
  })
  const arr = nodes.map((n) => pos.get(n.id)!)
  const vel = arr.map(() => new THREE.Vector3())
  const adj = links.map((l) => ({ a: idx.get(l.source), b: idx.get(l.target), w: l.weight })).filter((e) => e.a !== undefined && e.b !== undefined) as { a: number; b: number; w: number }[]
  const K_REP = 2600, K_LINK = 0.045, REST = 26, CENTER = 0.012, FLATTEN = 0.82, DAMP = 0.86
  const tmp = new THREE.Vector3()
  for (let it = 0; it < iters; it++) {
    // repulsion (O(n²) — node ít nên ổn)
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      tmp.copy(arr[i]).sub(arr[j]); let d2 = tmp.lengthSq(); if (d2 < 1) d2 = 1
      const f = (K_REP * (nodes[i].mass / 14) * (nodes[j].mass / 14)) / d2
      tmp.multiplyScalar(f / Math.sqrt(d2)); vel[i].add(tmp); vel[j].sub(tmp)
    }
    // link spring (kéo node nối nhau lại — cụm theo cấu trúc THẬT)
    for (const e of adj) {
      tmp.copy(arr[e.b]).sub(arr[e.a]); const d = tmp.length() || 1
      tmp.multiplyScalar((K_LINK * (0.5 + e.w) * (d - REST)) / d)
      vel[e.a].add(tmp); vel[e.b].sub(tmp)
    }
    for (let i = 0; i < arr.length; i++) {
      vel[i].x -= arr[i].x * CENTER; vel[i].z -= arr[i].z * CENTER; vel[i].y -= arr[i].y * CENTER * 2.5 // hút về đĩa
      vel[i].multiplyScalar(DAMP)
      arr[i].add(tmp.copy(vel[i]).clampLength(0, 6))
      arr[i].y *= FLATTEN // ép dẹt thành đĩa tinh hà
    }
  }
  return pos
}

// ── SPHERE-LAYOUT 3D (quả cầu tri thức): node nằm trên VỎ mặt cầu bán kính R, ──
// cluster theo zone thành "lục địa" trên bề mặt; node degree cao = lõi (kéo vào trong, sáng).
// Layout chạy 1 LẦN tới settle (deterministic theo hash → ổn định) rồi FREEZE — time-travel chỉ đổi visibility.
export function sphereLayout3D(
  nodes: FNode[], links: FLink[],
  zoneOf: (id: string) => string,
  degree: Map<string, number>,
  coreId: string,
  R = 132, iters = 150,
): Map<string, THREE.Vector3> {
  const pos = new Map<string, THREE.Vector3>()
  const idx = new Map<string, number>()
  const UP = new THREE.Vector3(0, 1, 0), RT = new THREE.Vector3(1, 0, 0)

  // mỗi zone → 1 tâm "lục địa" trên mặt cầu đơn vị (phân bố golden-angle cho đều)
  const zoneList = [...new Set(nodes.map((n) => zoneOf(n.id)))]
  const GA = Math.PI * (3 - Math.sqrt(5))
  const Z = Math.max(1, zoneList.length)
  const zoneDir = new Map<string, THREE.Vector3>()
  zoneList.forEach((z, i) => {
    const y = Z === 1 ? 0 : 1 - ((i + 0.5) / Z) * 2
    const rr = Math.sqrt(Math.max(0, 1 - y * y))
    const th = GA * i
    zoneDir.set(z, new THREE.Vector3(Math.cos(th) * rr, y, Math.sin(th) * rr).normalize())
  })

  // bán kính đích mỗi node: hub (degree cao) vào trong, lá nằm sát vỏ; core = tâm
  let maxDeg = 1; for (const d of degree.values()) if (d > maxDeg) maxDeg = d
  const targetR = new Map<string, number>()
  const t1 = new THREE.Vector3(), t2 = new THREE.Vector3()
  nodes.forEach((n, i) => {
    idx.set(n.id, i)
    const dn = (degree.get(n.id) || 0) / maxDeg
    const tr = n.id === coreId ? 0 : R * (0.74 + 0.26 * (1 - dn))
    targetR.set(n.id, tr)
    const c = zoneDir.get(zoneOf(n.id)) || UP
    t1.crossVectors(c, Math.abs(c.y) < 0.92 ? UP : RT).normalize()
    t2.crossVectors(c, t1).normalize()
    const a = hash01(n.id) * Math.PI * 2
    const spread = 0.32 + hash01(n.id + 's') * 0.55
    const dir = c.clone().addScaledVector(t1, Math.cos(a) * spread).addScaledVector(t2, Math.sin(a) * spread).normalize()
    pos.set(n.id, dir.multiplyScalar(tr || 1))
  })
  if (coreId && pos.has(coreId)) pos.get(coreId)!.set(0, 0, 0)

  const arr = nodes.map((n) => pos.get(n.id)!)
  const vel = arr.map(() => new THREE.Vector3())
  const adj = links.map((l) => ({ a: idx.get(l.source), b: idx.get(l.target), w: l.weight })).filter((e) => e.a !== undefined && e.b !== undefined) as { a: number; b: number; w: number }[]
  const tmp = new THREE.Vector3()
  const K_REP = 13, K_LINK = 0.02, DAMP = 0.82
  for (let it = 0; it < iters; it++) {
    // đẩy nhau (trải đều trên vỏ) — O(n²), node ít nên ổn
    for (let i = 0; i < arr.length; i++) for (let j = i + 1; j < arr.length; j++) {
      tmp.copy(arr[i]).sub(arr[j]); let d2 = tmp.lengthSq(); if (d2 < 1) d2 = 1
      const f = (K_REP * R) / d2
      tmp.multiplyScalar(f / Math.sqrt(d2)); vel[i].add(tmp); vel[j].sub(tmp)
    }
    // lò xo link — node nối nhau kéo lại (lục địa gắn theo cấu trúc THẬT)
    for (const e of adj) {
      tmp.copy(arr[e.b]).sub(arr[e.a]).multiplyScalar(K_LINK * (0.4 + e.w))
      vel[e.a].add(tmp); vel[e.b].sub(tmp)
    }
    for (let i = 0; i < arr.length; i++) {
      vel[i].multiplyScalar(DAMP)
      arr[i].add(tmp.copy(vel[i]).clampLength(0, R * 0.06))
      const tr = targetR.get(nodes[i].id)!
      if (tr > 0) arr[i].setLength(tr); else arr[i].set(0, 0, 0) // ép về vỏ cầu (bán kính đích)
    }
  }
  return pos
}

// ── VOLUME-LAYOUT 3D ('dải ngân hà hình cầu' — quả cầu ĐẶC): node lấp đầy CẢ thể tích ball R, ──
// KHÔNG chỉ lớp vỏ. Cluster theo zone = các sub-sphere rải TRONG thể tích (tâm cụm phân bố trong ball);
// sub-sphere radius ∝ cbrt(count) → cụm data nhiều thì TO; node trong cụm lấp đầy thể tích sub-sphere
// (điểm 3D trong ball, deterministic theo hash → dày về tâm cụm); node degree-cao kéo về lõi (origin).
// 100% deterministic (không sim ngẫu nhiên) → chạy 1 LẦN rồi FREEZE; chỉ vài iter repulsion tâm-cụm cho đỡ chồng.
export function volumeLayout3D(
  nodes: FNode[],
  zoneOf: (id: string) => string,
  degree: Map<string, number>,
  coreId: string,
  R = 130,
): Map<string, THREE.Vector3> {
  const pos = new Map<string, THREE.Vector3>()
  const ORIGIN = new THREE.Vector3(0, 0, 0)

  // gom node theo zone
  const groups = new Map<string, FNode[]>()
  for (const n of nodes) { let g = groups.get(zoneOf(n.id)); if (!g) { g = []; groups.set(zoneOf(n.id), g) } g.push(n) }
  const zoneList = [...groups.keys()]
  const Z = Math.max(1, zoneList.length)
  const GA = Math.PI * (3 - Math.sqrt(5))

  let maxDeg = 1; for (const d of degree.values()) if (d > maxDeg) maxDeg = d

  // điểm trên mặt cầu đơn vị deterministic từ 2 hash (hướng phân bố đều)
  const sphereDir = (u: number, v: number) => {
    const th = u * Math.PI * 2, z = 2 * v - 1, rr = Math.sqrt(Math.max(0, 1 - z * z))
    return new THREE.Vector3(Math.cos(th) * rr, Math.sin(th) * rr, z)
  }

  // mỗi zone → 1 cụm (sub-sphere): tâm trong thể tích ball, bán kính ∝ cbrt(số node)
  type Cl = { center: THREE.Vector3; radius: number; zone: string }
  const SUB_BASE = R * 0.155, SUB_MIN = R * 0.07, SUB_MAX = R * 0.42
  const clusters: Cl[] = zoneList.map((z, i) => {
    const count = groups.get(z)!.length
    const subR = Math.min(SUB_MAX, Math.max(SUB_MIN, SUB_BASE * Math.cbrt(count)))
    // hướng tâm cụm: golden-angle (đều quanh khối); bán kính tâm: phân bố thể tích (cbrt), chừa chỗ cho subR
    const y = Z === 1 ? 0 : 1 - ((i + 0.5) / Z) * 2
    const rr = Math.sqrt(Math.max(0, 1 - y * y))
    const th = GA * i
    const dir = new THREE.Vector3(Math.cos(th) * rr, y, Math.sin(th) * rr).normalize()
    const cr = (R - subR) * (0.24 + 0.66 * Math.cbrt(hash01(z + 'cr')))
    return { center: dir.multiplyScalar(cr), radius: subR, zone: z }
  })

  // vài iter đẩy tâm cụm cho đỡ chồng + clamp gọn TRONG ball (sub-sphere không tràn ra ngoài R)
  const tmp = new THREE.Vector3()
  for (let it = 0; it < 24; it++) {
    for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
      const a = clusters[i], b = clusters[j]
      tmp.copy(a.center).sub(b.center); const d = tmp.length() || 0.001
      const minD = (a.radius + b.radius) * 0.9
      if (d < minD) { tmp.multiplyScalar(((minD - d) / d) * 0.5); a.center.add(tmp); b.center.sub(tmp) }
    }
    for (const c of clusters) { const lim = Math.max(0, R * 0.96 - c.radius); if (c.center.length() > lim) c.center.setLength(lim) }
  }
  const clOf = new Map(clusters.map((c) => [c.zone, c]))

  // đặt node: điểm trong THỂ TÍCH sub-sphere (lấp đầy, dày về tâm cụm), hub degree-cao kéo về lõi
  for (const n of nodes) {
    if (n.id === coreId) { pos.set(n.id, new THREE.Vector3(0, 0, 0)); continue }  // lõi = trạm trung tâm tại origin
    const c = clOf.get(zoneOf(n.id))!
    const dir = sphereDir(hash01(n.id + 'u'), hash01(n.id + 'v'))
    const rr = c.radius * Math.pow(hash01(n.id + 'rr'), 0.62)  // expo>1/3 → dày về tâm cụm (đốm đặc sáng)
    const p = c.center.clone().addScaledVector(dir, rr)
    const dn = (degree.get(n.id) || 0) / maxDeg
    if (dn > 0) p.lerp(ORIGIN, 0.42 * dn)            // node nhiều liên kết trôi về lõi → density cao về tâm
    if (p.length() > R * 0.97) p.setLength(R * 0.97) // BOUNDED: clamp gọn trong quả cầu lớn
    pos.set(n.id, p)
  }
  return pos
}

// ── GALAXY-LAYOUT 3D ('dải ngân hà hình cầu' — MẶC ĐỊNH MỚI) ──────────────────────────────────
// Khác volumeLayout: node CÓ LIÊN KẾT trong cùng cụm được KÉO LẠI GẦN NHAU bằng force nội cụm
// → dây nối NGẮN, gọn trong cụm; mỗi cụm là 1 chòm sao có CẤU TRÚC (không rải mù làm edge cắt ngang).
// Trả {pos, info}: info giữ {center, local} để núm vặn live rescale khoảng-cách-cụm + density mà KHÔNG re-sim.
//   pos = center·distScale + local·densityScale  (component tự tính lại — O(n), không force lại).
// 100% deterministic (seed theo hash, không Math.random) → tính 1 LẦN rồi FREEZE.
export type LayoutInfo = Map<string, { center: THREE.Vector3; local: THREE.Vector3 }>
export function galaxyLayout3D(
  nodes: FNode[], links: FLink[],
  zoneOf: (id: string) => string,
  degree: Map<string, number>,
  coreId: string,
  R = 130,
): { pos: Map<string, THREE.Vector3>; info: LayoutInfo } {
  const pos = new Map<string, THREE.Vector3>()
  const info: LayoutInfo = new Map()

  // gom node theo zone (bỏ core — core ngồi lõi origin)
  const groups = new Map<string, FNode[]>()
  for (const n of nodes) { if (n.id === coreId) continue; let g = groups.get(zoneOf(n.id)); if (!g) { g = []; groups.set(zoneOf(n.id), g) } g.push(n) }
  const zoneList = [...groups.keys()]
  const Z = Math.max(1, zoneList.length)
  const GA = Math.PI * (3 - Math.sqrt(5))

  let maxDeg = 1; for (const d of degree.values()) if (d > maxDeg) maxDeg = d

  const sphereDir = (u: number, v: number) => {
    const th = u * Math.PI * 2, z = 2 * v - 1, rr = Math.sqrt(Math.max(0, 1 - z * z))
    return new THREE.Vector3(Math.cos(th) * rr, Math.sin(th) * rr, z)
  }

  // mỗi zone → 1 cụm cầu: tâm rải trong THỂ TÍCH ball, bán kính ∝ cbrt(count) → cụm data nhiều thì TO
  type Cl = { center: THREE.Vector3; radius: number; zone: string }
  const SUB_BASE = R * 0.15, SUB_MIN = R * 0.07, SUB_MAX = R * 0.40
  const clusters: Cl[] = zoneList.map((z, i) => {
    const count = groups.get(z)!.length
    const subR = Math.min(SUB_MAX, Math.max(SUB_MIN, SUB_BASE * Math.cbrt(count)))
    const y = Z === 1 ? 0 : 1 - ((i + 0.5) / Z) * 2
    const rr = Math.sqrt(Math.max(0, 1 - y * y))
    const th = GA * i
    const dir = new THREE.Vector3(Math.cos(th) * rr, y, Math.sin(th) * rr).normalize()
    const cr = (R - subR) * (0.26 + 0.6 * Math.cbrt(hash01(z + 'cr')))
    return { center: dir.multiplyScalar(cr), radius: subR, zone: z }
  })
  // đẩy tâm cụm cho đỡ chồng + clamp gọn TRONG ball (cụm không tràn ra ngoài quả cầu lớn)
  const t = new THREE.Vector3()
  for (let it = 0; it < 24; it++) {
    for (let i = 0; i < clusters.length; i++) for (let j = i + 1; j < clusters.length; j++) {
      const a = clusters[i], b = clusters[j]
      t.copy(a.center).sub(b.center); const d = t.length() || 0.001
      const minD = (a.radius + b.radius) * 0.92
      if (d < minD) { t.multiplyScalar(((minD - d) / d) * 0.5); a.center.add(t); b.center.sub(t) }
    }
    for (const c of clusters) { const lim = Math.max(0, R * 0.96 - c.radius); if (c.center.length() > lim) c.center.setLength(lim) }
  }
  const clOf = new Map(clusters.map((c) => [c.zone, c]))

  // core = trạm trung tâm tại origin (sáng nhất)
  if (coreId) { pos.set(coreId, new THREE.Vector3(0, 0, 0)); info.set(coreId, { center: new THREE.Vector3(), local: new THREE.Vector3() }) }

  // FORCE NỘI CỤM (local, tâm cụm = origin) — kéo node nối nhau lại gần → chòm sao có cấu trúc, dây ngắn
  const tmp = new THREE.Vector3()
  for (const z of zoneList) {
    const cl = clOf.get(z)!
    const members = groups.get(z)!
    const m = members.length
    const idx = new Map<string, number>()
    // seed: điểm trong ball cụm (deterministic), dày về tâm
    const local = members.map((n, k) => {
      idx.set(n.id, k)
      const dir = sphereDir(hash01(n.id + 'u'), hash01(n.id + 'v'))
      const rr = cl.radius * Math.pow(hash01(n.id + 'rr'), 0.55)
      return dir.multiplyScalar(rr)
    })
    if (m > 1) {
      const vel = local.map(() => new THREE.Vector3())
      // link nội cụm (2 đầu cùng zone)
      const intra = links
        .filter((l) => zoneOf(l.source) === z && zoneOf(l.target) === z && idx.has(l.source) && idx.has(l.target))
        .map((l) => ({ a: idx.get(l.source)!, b: idx.get(l.target)!, w: l.weight }))
      const REST = cl.radius * 0.42, K_REP = cl.radius * cl.radius * 0.18, K_LINK = 0.08, DAMP = 0.84
      const iters = Math.min(120, 50 + m * 2)
      for (let it = 0; it < iters; it++) {
        for (let i = 0; i < m; i++) for (let j = i + 1; j < m; j++) {
          tmp.copy(local[i]).sub(local[j]); let d2 = tmp.lengthSq(); if (d2 < 1) d2 = 1
          const f = K_REP / d2
          tmp.multiplyScalar(f / Math.sqrt(d2)); vel[i].add(tmp); vel[j].sub(tmp)
        }
        for (const e of intra) { // lò xo: node nối nhau về khoảng REST → dây ngắn, gọn
          tmp.copy(local[e.b]).sub(local[e.a]); const d = tmp.length() || 1
          tmp.multiplyScalar((K_LINK * (0.5 + e.w) * (d - REST)) / d)
          vel[e.a].add(tmp); vel[e.b].sub(tmp)
        }
        for (let i = 0; i < m; i++) {
          const dn = (degree.get(members[i].id) || 0) / maxDeg
          vel[i].addScaledVector(local[i], -(0.02 + 0.06 * dn))  // hub (degree cao) hút về tâm cụm → chòm có lõi
          vel[i].multiplyScalar(DAMP)
          local[i].add(tmp.copy(vel[i]).clampLength(0, cl.radius * 0.08))
          if (local[i].length() > cl.radius) local[i].setLength(cl.radius) // BOUNDED trong sub-sphere
        }
      }
    }
    for (let i = 0; i < m; i++) {
      const id = members[i].id
      const p = cl.center.clone().add(local[i])
      if (p.length() > R * 0.97) p.setLength(R * 0.97)
      pos.set(id, p)
      info.set(id, { center: cl.center.clone(), local: local[i].clone() })
    }
  }
  return { pos, info }
}
