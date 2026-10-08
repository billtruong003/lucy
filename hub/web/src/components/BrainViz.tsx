import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

// ════════════════════════════════════════════════════════════════════════
//  Lucy Neural Core — plexus network sphere (giữa) + vành HUD sci-fi (ngoài)
//  • Node data = chấm trên mặt cầu, nối nhau bằng lưới tam giác (plexus).
//  • Core L.U.C.Y = lõi năng lượng ở tâm, sáng xuyên qua.
//  • Vành HUD = SVG overlay nét, xoay nhiều lớp (arc-reactor frame).
//  • Hover 1 chấm → phóng to + hiện thẻ nội dung (tên/loại/status/đang chạy).
// ════════════════════════════════════════════════════════════════════════

// ---- knobs (tinh chỉnh nhanh) ----
const SPHERE_R = 46          // bán kính khối plexus (world)
const CAM_Z = 210            // camera lùi xa -> khối vừa lọt lỗ HUD
const DOT_BASE = 0.95        // bán kính chấm mặc định
const KNN = 3                // mỗi chấm nối ~3 hàng xóm gần nhất

const COLORS: Record<string, string> = {
  core: '#bff8ff', zone: '#9fe9ff', model: '#36d4d0', voice: '#41e3b0', channel: '#46c6ec', api: '#62e89a',
}
const col3 = (g: string) => new THREE.Color(COLORS[g] || '#7fb0d0')
function hash01(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  return ((h >>> 0) % 1000000) / 1000000
}

// readout HUD: 4 zone chính + góc đặt text + helper cung tròn
const ZONE_META = [
  { id: 'z_agents', label: 'AGENTS', group: 'model' },
  { id: 'z_channels', label: 'CHANNELS', group: 'channel' },
  { id: 'z_money', label: 'MONEY', group: 'api' },
  { id: 'z_dev', label: 'DEV', group: 'api' },
]
const ZONE_ANGLE: Record<string, number> = { z_agents: 210, z_channels: 330, z_money: 150, z_dev: 30 }
const TOP = -Math.PI / 2
const POL = (r: number, a: number): [number, number] => [500 + r * Math.cos(a), 500 + r * Math.sin(a)]
const ARC = (r: number, a0: number, a1: number) => {
  const [x0, y0] = POL(r, a0), [x1, y1] = POL(r, a1)
  const large = a1 - a0 > Math.PI ? 1 : 0
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`
}

type GNode = { id: string; label: string; group: string; val: number; active?: boolean; load?: number; zone?: string; status?: string }
type GLink = { source: string; target: string; active?: boolean; flow?: number }
type Tele = { nodes: GNode[]; links: GLink[]; running: { model: string; prompt: string; elapsed: number }[] }

// ---- mock fallback (xem viz khi chưa có backend) ----
const SAMPLE: Tele = {
  running: [],
  links: [],
  nodes: [
    { id: 'lucy', label: 'L.U.C.Y', group: 'core', val: 28, active: true, status: 'live' },
    { id: 'z_agents', label: 'AGENTS', group: 'zone', val: 15, status: 'live' },
    { id: 'z_channels', label: 'CHANNELS', group: 'zone', val: 15, status: 'live' },
    { id: 'z_money', label: 'MONEY·DATA', group: 'zone', val: 15, status: 'live' },
    { id: 'z_dev', label: 'DEV', group: 'zone', val: 15, status: 'live' },
    { id: 'sonnet', label: 'Claude Sonnet', group: 'model', val: 13, zone: 'z_agents', active: true, status: 'live' },
    { id: 'opus', label: 'Claude Opus', group: 'model', val: 13, zone: 'z_agents', status: 'live' },
    { id: 'grok', label: 'Grok', group: 'model', val: 9, zone: 'z_agents', status: 'planned' },
    { id: 'telegram', label: 'Telegram', group: 'channel', val: 10, zone: 'z_channels', status: 'live' },
    { id: 'aki', label: 'Aki · Discord', group: 'channel', val: 10, zone: 'z_channels', status: 'live' },
    { id: 'hub', label: 'Web Hub', group: 'channel', val: 11, zone: 'z_channels', active: true, status: 'live' },
    { id: 'cmc', label: 'CoinMarketCap', group: 'api', val: 8, zone: 'z_money', status: 'planned' },
    { id: 'gold', label: 'Gold XAU', group: 'api', val: 8, zone: 'z_money', status: 'planned' },
    { id: 'research', label: 'Research Cron', group: 'api', val: 9, zone: 'z_money', status: 'planned' },
    { id: 'github', label: 'GitHub', group: 'api', val: 8, zone: 'z_dev', status: 'planned' },
    { id: 'hf', label: 'HuggingFace', group: 'api', val: 8, zone: 'z_dev', status: 'planned' },
  ],
}

type Info = { nodes: GNode[]; zones: { id: string; label: string; group: string; n: number; active: number }[]; active: number; live: number; planned: number; total: number }
function computeInfo(t: Tele): Info {
  const surface = t.nodes.filter((n) => n.group !== 'core')
  const zones = ZONE_META.map((z) => {
    const kids = surface.filter((n) => n.zone === z.id)
    return { ...z, n: kids.length, active: kids.filter((k) => k.active).length }
  }).filter((z) => z.n > 0)
  const planned = surface.filter((n) => n.status && n.status !== 'live').length
  return { nodes: surface, zones, active: surface.filter((n) => n.active).length, planned, live: surface.length - planned, total: surface.length }
}

// ---- GLSL: simplex noise 3D (Ashima) + fbm ----
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
const ORB_VERT = `
varying vec3 vN; varying vec3 vView; varying vec3 vPos;
void main(){
  vN = normalize(normalMatrix*normal);
  vec4 mv = modelViewMatrix*vec4(position,1.0);
  vView = normalize(-mv.xyz); vPos = position;
  gl_Position = projectionMatrix*mv;
}`
// chấm/lõi năng lượng volumetric: sáng giữa mờ rìa + noise cuộn, additive
const ENERGY_FRAG = SNOISE + FBM + `
uniform vec3 uColor; uniform float uTime; uniform float uActive; uniform float uBoost; uniform float uSeed;
varying vec3 vN; varying vec3 vView; varying vec3 vPos;
void main(){
  vec3 d = normalize(vPos);
  float ndv = max(dot(normalize(vN), normalize(vView)), 0.0);
  float n = fbm(d*3.0 + vec3(0.0,uTime*0.5,0.0))*0.6 + fbm(d*7.5 - vec3(uTime*0.4))*0.4;
  n = n*0.5+0.5;
  float core = pow(ndv, 1.2);
  float rim  = pow(1.0-ndv, 2.3);
  float energy = 0.10 + core*(0.42 + 0.85*n) + rim*0.6;
  float pulse = 0.82 + 0.18*sin(uTime*2.0 + uSeed*6.2831);
  energy *= (0.92 + uBoost*0.7 + uActive*0.85) * pulse;
  vec3 col = uColor * energy;
  col += vec3(1.0) * pow(n,3.0) * 0.22 * (core+0.2);
  gl_FragColor = vec4(col, clamp(energy,0.0,1.0));
}`
// lõi L.U.C.Y: plasma cuộn chảy RÕ (domain warp), KHÔNG cháy trắng, không pulse chói
const CORE_FRAG = SNOISE + FBM + `
uniform vec3 uColor; uniform float uTime;
varying vec3 vN; varying vec3 vView; varying vec3 vPos;
void main(){
  vec3 d = normalize(vPos);
  vec3 q = d*2.2;
  // domain warp -> dòng plasma cuộn, thấy rõ chuyển động
  vec3 w = vec3(
    fbm(q + vec3(0.0, uTime*0.28, 0.0)),
    fbm(q + vec3(5.2, uTime*0.22, 1.3)),
    fbm(q + vec3(1.7, uTime*0.25, 8.3)));
  float n   = fbm(q*1.5 + w*1.9 + vec3(0.0, uTime*0.32, 0.0)); n = n*0.5 + 0.5;
  float fil = fbm(d*6.0 + w*2.2 - vec3(uTime*0.45));            // sợi sáng chạy ngang
  float ndv = max(dot(normalize(vN), normalize(vView)), 0.0);
  float rim = pow(1.0 - ndv, 2.0);
  vec3 deep = uColor*0.30;
  vec3 col  = mix(deep, uColor, smoothstep(0.22, 0.82, n));     // tối-sáng theo noise -> có chiều sâu
  col += uColor * smoothstep(0.62, 0.95, fil) * 0.7;            // tia plasma chạy
  col += vec3(0.65,0.92,1.0) * rim * 0.8;                       // rim năng lượng mảnh
  col *= (0.42 + 0.58*n);                                       // KHÔNG đồng đều -> hết "khối cứng cheap"
  float a = clamp(0.5 + n*0.42 + rim*0.5, 0.0, 1.0);
  gl_FragColor = vec4(col, a);
}`

// Fibonacci sphere — rải đều điểm trên mặt cầu
function fibSphere(i: number, n: number): THREE.Vector3 {
  const ga = Math.PI * (3 - Math.sqrt(5))
  const y = 1 - (i / Math.max(1, n - 1)) * 2
  const rr = Math.sqrt(Math.max(0, 1 - y * y))
  const phi = i * ga
  return new THREE.Vector3(Math.cos(phi) * rr, y, Math.sin(phi) * rr)
}

type Hover = { label: string; group: string; status: string; active: boolean; load: number; x: number; y: number } | null

export default function BrainViz({ visible }: { visible: boolean }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const [running, setRunning] = useState<Tele['running']>([])
  const [hover, setHover] = useState<Hover>(null)
  const [mock, setMock] = useState(false)
  const [info, setInfo] = useState<Info>({ nodes: [], zones: [], active: 0, live: 0, planned: 0, total: 0 })
  const R = useRef<any>({})

  // ---- init three (1 lần) ----
  useEffect(() => {
    const mount = mountRef.current
    if (!mount) return
    const scene = new THREE.Scene()
    scene.fog = new THREE.FogExp2(0x05070e, 0.0014)
    const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 4000)
    camera.position.set(0, 0, CAM_Z)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    renderer.domElement.style.display = 'block'
    const iw0 = mount.clientWidth || 800, ih0 = mount.clientHeight || 600
    renderer.setSize(iw0, ih0); camera.aspect = iw0 / ih0; camera.updateProjectionMatrix()
    mount.appendChild(renderer.domElement)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true; controls.autoRotate = false
    controls.enablePan = false; controls.minDistance = 165; controls.maxDistance = 300; controls.zoomSpeed = 0.7

    // ── nền: nhiều sao bay flow (3 lớp parallax, additive glow) ──
    const mkStars = (n: number, spread: number, size: number, op: number, color: number) => {
      const a = new Float32Array(n * 3); for (let i = 0; i < n * 3; i++) a[i] = (Math.random() - 0.5) * spread
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(a, 3))
      const pts = new THREE.Points(g, new THREE.PointsMaterial({ color, size, transparent: true, opacity: op, sizeAttenuation: true, depthWrite: false, blending: THREE.AdditiveBlending }))
      scene.add(pts); return pts
    }
    const stars1 = mkStars(1500, 3000, 1.1, 0.35, 0x6f9fcf)  // xa, mờ
    const stars2 = mkStars(900, 2000, 1.7, 0.5, 0x8fc4ee)    // giữa
    const stars3 = mkStars(420, 1150, 2.5, 0.7, 0xcdecff)    // gần, sáng

    const globe = new THREE.Group()           // khối plexus tự xoay
    scene.add(globe)

    R.current = { scene, camera, renderer, controls, globe, dots: new Map(), tmats: [], topo: '', clock: new THREE.Clock(), hoverId: null, edgeMat: null, stars1, stars2, stars3 }

    // ---- render loop ----
    const tmpW = new THREE.Vector3()
    const tick = () => {
      R.current.raf = requestAnimationFrame(tick)
      const r = R.current
      if (!r.visible) return
      const t = r.clock.getElapsedTime()
      for (const m of r.tmats) m.uniforms.uTime.value = t
      if (r.stars1) { r.stars1.rotation.y = t * 0.006; r.stars1.rotation.x = t * 0.003 }
      if (r.stars2) { r.stars2.rotation.y = -t * 0.012; r.stars2.rotation.x = t * 0.004 }
      if (r.stars3) r.stars3.rotation.y = t * 0.022
      if (r.edgeMat) r.edgeMat.opacity = 0.12 + 0.05 * Math.sin(t * 1.4)
      globe.rotation.y = t * 0.12
      globe.rotation.x = Math.sin(t * 0.18) * 0.18
      // hover: lerp scale chấm + cập nhật vị trí thẻ
      for (const [id, d] of r.dots) {
        const target = id === r.hoverId ? d.hoverScale : 1
        d.mesh.scale.lerp(tmpW.set(target, target, target), 0.18)
      }
      controls.update()
      renderer.render(scene, camera)
    }
    R.current.raf = requestAnimationFrame(tick)

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth, h = mount.clientHeight
      if (!w || !h) return
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix()
    })
    ro.observe(mount)

    // ---- hover (raycast) ----
    const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2()
    const onMove = (e: PointerEvent) => {
      const r = R.current; if (!r.visible || r.dragging || !r.dotPick?.length) return
      const b = renderer.domElement.getBoundingClientRect()
      ndc.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      const hits = ray.intersectObjects(r.dotPick, false)
      const id = hits.length ? r.dots.get(hits[0].object.userData.id) ? hits[0].object.userData.id : null : null
      if (id !== r.hoverId) {
        r.hoverId = id
        const d = id && r.dots.get(id)
        renderer.domElement.style.cursor = id ? 'pointer' : 'grab'
        setHover(d ? { label: d.n.label, group: d.n.group, status: d.n.status || 'live', active: !!d.n.active, load: d.n.load || 0, x: 0, y: 0 } : null)
      }
    }
    const onLeave = () => { R.current.hoverId = null; setHover(null) }
    // kéo/zoom -> tắt hover (đừng pop thẻ khi đang xoay)
    const onDown = () => { R.current.dragging = true; if (R.current.hoverId) { R.current.hoverId = null; setHover(null) } }
    const onUpW = () => { R.current.dragging = false }
    renderer.domElement.addEventListener('pointermove', onMove)
    renderer.domElement.addEventListener('pointerleave', onLeave)
    renderer.domElement.addEventListener('pointerdown', onDown)
    window.addEventListener('pointerup', onUpW)

    return () => {
      cancelAnimationFrame(R.current.raf); ro.disconnect()
      renderer.domElement.removeEventListener('pointermove', onMove)
      renderer.domElement.removeEventListener('pointerleave', onLeave)
      renderer.domElement.removeEventListener('pointerdown', onDown)
      window.removeEventListener('pointerup', onUpW)
      renderer.dispose(); mount.removeChild(renderer.domElement)
    }
  }, [])

  useEffect(() => { if (R.current) R.current.visible = visible }, [visible])

  // ---- poll telemetry (mock fallback nếu fail) ----
  useEffect(() => {
    if (!visible) return
    let alive = true
    const pull = async () => {
      try {
        const res = await fetch('/api/telemetry'); if (!res.ok) throw 0
        const t: Tele = await res.json(); if (!alive) return
        setMock(false); setRunning(t.running || []); setInfo(computeInfo(t)); sync(t)
      } catch {
        if (!alive) return
        setMock(true); setRunning([]); setInfo(computeInfo(SAMPLE)); sync(SAMPLE)
      }
    }
    pull(); const iv = setInterval(pull, 1500)
    return () => { alive = false; clearInterval(iv) }
  }, [visible])

  // ---- dựng/đồng bộ khối plexus ----
  function sync(t: Tele) {
    const r = R.current; if (!r?.globe) return
    const topo = t.nodes.map((n) => n.id + (n.status || '')).sort().join(',')
    if (topo !== r.topo) {
      r.topo = topo
      for (const c of [...r.globe.children]) r.globe.remove(c)
      r.dots = new Map(); r.dotPick = []; r.tmats = []

      const surface = t.nodes.filter((n) => n.group !== 'core')
      const core = t.nodes.find((n) => n.group === 'core')
      const Reff = SPHERE_R * Math.cbrt(Math.max(6, surface.length) / 10)   // não LỚN DẦN theo số node (cron thêm node → to ra)
      const positions: { id: string; p: THREE.Vector3 }[] = []

      // chấm bề mặt — rải Fibonacci, jitter nhẹ theo hash cho tự nhiên
      surface.forEach((n, i) => {
        const dir = fibSphere(i, surface.length)
        const jit = 1 + (hash01(n.id) - 0.5) * 0.12
        const p = dir.multiplyScalar(Reff * jit)
        positions.push({ id: n.id, p })
        const planned = !!n.status && n.status !== 'live'
        const c = planned ? col3(n.group).multiplyScalar(0.7) : col3(n.group)
        const rad = DOT_BASE * (0.8 + Math.cbrt(n.val || 8) * 0.34) * (planned ? 0.85 : 1)
        const mat = new THREE.ShaderMaterial({
          vertexShader: ORB_VERT, fragmentShader: ENERGY_FRAG, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
          uniforms: { uColor: { value: c }, uTime: { value: 0 }, uActive: { value: n.active ? 1 : 0 }, uBoost: { value: 0 }, uSeed: { value: hash01(n.id) } },
        })
        const mesh = new THREE.Mesh(new THREE.SphereGeometry(rad, 18, 18), mat)
        mesh.position.copy(p); mesh.userData.id = n.id
        r.globe.add(mesh); r.tmats.push(mat)
        r.dots.set(n.id, { mesh, mat, n, hoverScale: 2.4 }); r.dotPick.push(mesh)
      })

      // lưới plexus — nối ~KNN hàng xóm gần nhất, lưới tam giác
      const segs: number[] = []; const seen = new Set<string>()
      for (let i = 0; i < positions.length; i++) {
        const near = positions.map((q, j) => ({ j, d: positions[i].p.distanceTo(q.p) })).filter((o) => o.j !== i).sort((a, b) => a.d - b.d)
        for (let k = 0; k < Math.min(KNN, near.length); k++) {
          const j = near[k].j; const key = i < j ? `${i}-${j}` : `${j}-${i}`
          if (seen.has(key)) continue; seen.add(key)
          segs.push(positions[i].p.x, positions[i].p.y, positions[i].p.z, positions[j].p.x, positions[j].p.y, positions[j].p.z)
        }
      }
      const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(segs), 3))
      const edgeMat = new THREE.LineBasicMaterial({ color: 0x3fd3ff, transparent: true, opacity: 0.15, blending: THREE.AdditiveBlending, depthWrite: false })
      r.edgeMat = edgeMat
      r.globe.add(new THREE.LineSegments(eg, edgeMat))

      // lõi L.U.C.Y ở tâm
      if (core) {
        const coreCol = new THREE.Color('#46d8ff')
        const cMat = new THREE.ShaderMaterial({
          vertexShader: ORB_VERT, fragmentShader: CORE_FRAG, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
          uniforms: { uColor: { value: coreCol }, uTime: { value: 0 } },
        })
        const cMesh = new THREE.Mesh(new THREE.SphereGeometry(Reff * 0.26, 64, 64), cMat)
        cMesh.userData.id = core.id
        r.globe.add(cMesh); r.tmats.push(cMat)
        r.dots.set(core.id, { mesh: cMesh, mat: cMat, n: core, hoverScale: 1.2 }); r.dotPick.push(cMesh)
      }
    }
    // cập nhật active (không rebuild)
    for (const n of t.nodes) {
      const d = r.dots.get(n.id)
      if (d?.mat?.uniforms?.uActive && n.group !== 'core') d.mat.uniforms.uActive.value = n.active ? 1 : 0
    }
  }

  // viền HUD — vạch tick sinh động trình
  const ticks = (r: number, count: number, len: number, w = 1) =>
    Array.from({ length: count }, (_, i) => {
      const a = (i / count) * Math.PI * 2
      return <line key={i} x1={500 + Math.cos(a) * r} y1={500 + Math.sin(a) * r} x2={500 + Math.cos(a) * (r - len)} y2={500 + Math.sin(a) * (r - len)} stroke="#3fd3ff" strokeWidth={w} />
    })

  return (
    <div ref={mountRef} className="relative h-full w-full overflow-hidden"
      style={{ background: 'radial-gradient(120% 120% at 50% 46%, #0b1322 0%, #070b14 55%, #05070d 100%)', cursor: 'grab' }}>

      {/* ── VÀNH HUD: vòng MỎNG + thông tin THẬT (không filler) ── */}
      <svg viewBox="-130 -130 1260 1260" preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 w-full h-full pointer-events-none select-none">
        {/* vòng ngoài mảnh — texture xoay chậm, nét nhỏ */}
        <g style={{ transformOrigin: '500px 500px', animation: 'lucy-spin 120s linear infinite' }}>
          <circle cx="500" cy="500" r="478" fill="none" stroke="#3fd3ff" strokeWidth="0.7" opacity="0.22" />
          {ticks(478, 120, 6, 0.7)}
        </g>

        {/* SPIKES chỉa ra ngoài — pulsing lệch pha (vòng quay rất chậm cho có hồn) */}
        <g style={{ transformOrigin: '500px 500px', animation: 'lucy-spin 240s linear infinite' }}>
          {Array.from({ length: 60 }, (_, i) => {
            const a = (i / 60) * Math.PI * 2
            const long = i % 5 === 0
            const [x1, y1] = POL(488, a)
            const [x2, y2] = POL(488 + (long ? 32 : 16), a)
            return <line key={`spk${i}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="#3fd3ff" strokeWidth={long ? 2 : 1} strokeLinecap="round"
              style={{ animation: 'brain-spike 2.6s ease-in-out infinite', animationDelay: `${(i % 12) * 0.12}s` }} />
          })}
        </g>

        {/* INFO — cung sáng = tỉ lệ node ĐANG ACTIVE / tổng */}
        <circle cx="500" cy="500" r="458" fill="none" stroke="#214a5e" strokeWidth="2.5" opacity="0.4" />
        {info.active > 0 && (
          <path d={ARC(458, TOP, TOP + Math.min(0.999, info.active / Math.max(1, info.total)) * Math.PI * 2)}
            fill="none" stroke="#5fe6ff" strokeWidth="3" strokeLinecap="round" strokeDasharray="3 13"
            style={{ filter: 'drop-shadow(0 0 5px #3fd3ff)', animation: 'brain-flow 0.9s linear infinite' }} />
        )}

        {/* INFO — mỗi VẠCH = 1 node thật (màu theo loại, dài+sáng = active) */}
        {info.nodes.map((n, i) => {
          const a = TOP + (i / Math.max(1, info.nodes.length)) * Math.PI * 2
          const planned = !!n.status && n.status !== 'live'
          const len = n.active ? 20 : 11
          const [x1, y1] = POL(432, a); const [x2, y2] = POL(432 - len, a)
          return <line key={n.id} x1={x1} y1={y1} x2={x2} y2={y2} stroke={COLORS[n.group] || '#3fd3ff'}
            strokeWidth={n.active ? 2.4 : 1.1} opacity={n.active ? 1 : planned ? 0.3 : 0.6} />
        })}
        <circle cx="500" cy="500" r="432" fill="none" stroke="#3fd3ff" strokeWidth="0.6" opacity="0.2" />
        <circle cx="500" cy="500" r="408" fill="none" stroke="#3fd3ff" strokeWidth="0.5" opacity="0.14" />

        {/* vành mịn trong — texture xoay nhẹ, nét nhỏ */}
        <g style={{ transformOrigin: '500px 500px', animation: 'lucy-spin 52s linear infinite reverse' }}>
          <circle cx="500" cy="500" r="330" fill="none" stroke="#3fd3ff" strokeWidth="0.7" opacity="0.2" />
          {ticks(328, 80, 12, 0.8)}
        </g>

        {/* INFO — readout SỐ thật (đếm theo zone, live/planned) */}
        {info.zones.map((z) => {
          const a = (ZONE_ANGLE[z.id] ?? 0) * Math.PI / 180
          const [x, y] = POL(462, a)
          return (
            <g key={z.id} style={{ fontFamily: '"Share Tech Mono", monospace' }}>
              <text x={x} y={y} textAnchor="middle" fontSize="20" fill={COLORS[z.group] || '#9fe9ff'} opacity="0.92">{z.label}</text>
              <text x={x} y={y + 19} textAnchor="middle" fontSize="15" fill="#9fb4c9">{z.active > 0 ? `${z.active}/${z.n} ⚡` : `${z.n}`}</text>
            </g>
          )
        })}
        <text x="500" y="966" textAnchor="middle" fontSize="15" fill="#5e748b" style={{ fontFamily: '"Share Tech Mono", monospace' }}>
          LIVE {info.live} · PLANNED {info.planned}{mock ? ' · preview' : ''}
        </text>
      </svg>

      {/* ── VÙNG INFO top-center: default = tổng quan, hover = chi tiết node ── */}
      <div className="absolute left-1/2 -translate-x-1/2 top-5 z-20 pointer-events-none select-none text-center">
        {hover ? (
          <div key={hover.label}>
            <div className="text-[15px] font-semibold tracking-wide" style={{ color: COLORS[hover.group] || '#cfe6f5', fontFamily: '"Space Grotesk", sans-serif', textShadow: `0 0 12px ${(COLORS[hover.group] || '#3fd3ff')}88` }}>{hover.label}</div>
            <div className="text-[11px] mt-1 flex items-center justify-center gap-2" style={{ color: '#9fb4c9' }}>
              <span>{hover.group}</span>
              <span style={{ color: hover.active ? '#5fe39a' : hover.status === 'planned' ? '#5e748b' : '#7fb0d0' }}>{hover.active ? '⚡ active' : hover.status === 'planned' ? '○ planned' : '· live'}</span>
              {hover.load > 0 && <span style={{ color: '#62e89a' }}>load {hover.load}</span>}
            </div>
          </div>
        ) : (
          <div>
            <div className="text-cyan tracking-[0.3em] text-sm" style={{ fontFamily: '"Space Grotesk", sans-serif', textShadow: '0 0 12px rgba(56,208,255,.6)' }}>NEURAL CORE</div>
            <div className="text-[11px] mt-1" style={{ color: running.length ? '#7fe6b0' : '#5b7287' }}>
              {info.total} nodes · {info.active} active · {running.length} running{mock ? ' · preview' : ''}
            </div>
          </div>
        )}
      </div>
      <div className="absolute bottom-3 left-4 right-4 flex flex-col gap-1 pointer-events-none">
        {running.slice(0, 4).map((j, i) => (
          <div key={i} className="text-[11px] px-2 py-1 border border-cyan/25 bg-black/40 backdrop-blur-sm self-start max-w-[90%] truncate"
            style={{ color: j.model === 'opus' ? '#62e89a' : '#36d4d0' }}>
            ⚡ {j.model.toUpperCase()} · {j.elapsed}s — {j.prompt}
          </div>
        ))}
      </div>
      <div className="absolute top-3 right-4 flex flex-col gap-1 text-[10px] pointer-events-none">
        {Object.entries(COLORS).map(([g, c]) => (
          <div key={g} className="flex items-center gap-1" style={{ color: c }}>
            <span style={{ width: 8, height: 8, borderRadius: 9, background: c, boxShadow: `0 0 6px ${c}` }} /> {g}
          </div>
        ))}
      </div>
    </div>
  )
}
