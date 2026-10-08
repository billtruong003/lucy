import { useEffect, useRef, useState } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import SpriteText from 'three-spritetext'
import { ORB_VERT, PLANET_FRAG, CORE_FRAG, EDGE_VERT, EDGE_FRAG, sampleArc, ZONE_COLOR, zoneCol, hash01, makeStars, forceLayout3D, sphereLayout3D, volumeLayout3D, galaxyLayout3D, type FNode, type FLink, type LayoutInfo } from './viz3d'
import { brainGraph, brainRecall, brainFile, type GraphNode, type GraphLink } from '../api'
import Markdown from './Markdown'
import Galaxy2D from './Galaxy2D'

// S5/E4.2: phát hiện WebGL — máy không có (GPU yếu/headless/policy) → rơi về tinh hà 2D.
function hasWebGL(): boolean {
  try {
    const c = document.createElement('canvas')
    return !!(window.WebGLRenderingContext && (c.getContext('webgl') || c.getContext('experimental-webgl')))
  } catch { return false }
}
// S5/E4.1+E4.3: giảm chuyển động (OS prefers-reduced-motion HOẶC toggle reduce-fx) → render-on-demand.
function reduceMotionOn(): boolean {
  try { return document.documentElement.classList.contains('reduce-fx') || matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false }
}

// ════════ TINH HÀ TRI THỨC (NEURAL_GALAXY.md) ════════
// Hành tinh = note THẬT · đường sao = wikilink [[...]] THẬT · độ sáng = confidence/độ-mới.
// Force-layout 3D (cấu trúc thật) + styling galaxy. Recall trúng → hành tinh bừng sáng (neuron bắn xung).
// Càng dùng (thêm note/preference) → càng nhiều hành tinh: tinh hà NỞ.

const ZONE_LABEL: Record<string, string> = {
  context: 'Bối cảnh', projects: 'Dự án', learned: 'Đã học', entities: 'Thực thể',
  skills: 'Kỹ năng', timeline: 'Nhật ký', decisions: 'Quyết định', memory: 'Ký ức', agents: 'Não agent', ghost: 'Chưa viết',
}

type Hover = { label: string; zone: string; kind: string; obs: number; extra?: string } | null

// layout: 'galaxy' = thiên hà cầu MẶC ĐỊNH (cụm có cấu trúc + dây nội cụm ngắn + edge cung cong).
// revert qua URL: ?galaxy=volume (cầu đặc cũ) · ?galaxy=shell (vỏ-cầu) · ?galaxy=disk (đĩa).
const GALAXY_MODE = (typeof location !== 'undefined' ? new URLSearchParams(location.search).get('galaxy') : null) || 'galaxy'
const LOD_FAR = 300  // camera xa hơn → ẩn label node thường (chỉ giữ lõi)
const EDGE_REAL = new THREE.Color('#5fd0ff'), EDGE_DERIV = new THREE.Color('#3a6f7a')
const R_GALAXY = 130  // bán kính quả cầu lớn (bounded)

// ── núm vặn live (chủ nhân tự chỉnh gu — em không thấy màn). Lưu localStorage, có nút copy config. ──
type Cfg = { clusterDist: number; density: number; edgeOpacity: number; edgeShow: boolean; glow: number; fog: number; nodeSize: number; rotate: number }
const DEFAULT_CFG: Cfg = { clusterDist: 1, density: 1, edgeOpacity: 0.18, edgeShow: true, glow: 1, fog: 0.0016, nodeSize: 1, rotate: 0.35 }
const CFG_KEY = 'lucy.galaxy.cfg'
function loadCfg(): Cfg {
  try { const s = localStorage.getItem(CFG_KEY); if (s) return { ...DEFAULT_CFG, ...JSON.parse(s) } } catch { /* */ }
  return { ...DEFAULT_CFG }
}

export default function Galaxy({ visible }: { visible: boolean }) {
  const mountRef = useRef<HTMLDivElement>(null)
  const R = useRef<any>({})
  const [hover, setHover] = useState<Hover>(null)
  const [meta, setMeta] = useState({ nodes: 0, links: 0, learned: 0, configured: true, offline: false })
  const [sel, setSel] = useState<{ node: GraphNode; doc: string } | null>(null)
  const [q, setQ] = useState('')
  const [found, setFound] = useState<number | null>(null)
  const [ttBounds, setTtBounds] = useState<{ min: number; max: number } | null>(null)  // tua thời gian
  const [asOf, setAsOf] = useState<number | null>(null)  // null = GIỜ (live); số = mốc quá khứ
  const ttRaf = useRef<number | null>(null)  // throttle slider qua requestAnimationFrame
  const [cfg, setCfg] = useState<Cfg>(loadCfg)  // núm vặn live (localStorage)
  const [showCfg, setShowCfg] = useState(false)
  const [copied, setCopied] = useState(false)
  const [webgl] = useState(hasWebGL)  // S5/E4.2: 1 lần — false → fallback 2D bên dưới

  // S5/E4.1: render-on-demand khi giảm chuyển động — "đánh thức" vài trăm ms để lerp/pulse kịp settle rồi tự nghỉ.
  function wake(ms = 420) { R.current.renderUntil = performance.now() + ms }

  // kéo slider → đổi asOf; CHỈ chạy applyFilter (visibility) tối đa 1 lần/frame, không re-layout
  function scrub(at: number | null) {
    setAsOf(at); R.current.asOf = at
    if (ttRaf.current != null) return
    ttRaf.current = requestAnimationFrame(() => { ttRaf.current = null; applyFilter() })
  }
  // tạm dừng auto-rotate khi đang kéo slider (mượt hơn), bật lại khi thả
  function setSliding(on: boolean) { const r = R.current; r.sliding = on; if (r.controls) r.controls.autoRotate = on ? false : (!!r.visible && !r.reduceMotion); wake() }

  // ---- init three (1 lần) ----
  useEffect(() => {
    if (!webgl) return  // S5/E4.2: không có WebGL → bỏ qua three, render Galaxy2D
    const mount = mountRef.current; if (!mount) return
    const scene = new THREE.Scene()
    const c0 = loadCfg()
    scene.fog = new THREE.FogExp2(0x05070e, c0.fog)
    const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 5000)
    camera.position.set(0, 60, 170)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
    const w0 = mount.clientWidth || 800, h0 = mount.clientHeight || 600
    renderer.setSize(w0, h0); camera.aspect = w0 / h0; camera.updateProjectionMatrix()
    mount.appendChild(renderer.domElement)
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true; controls.enablePan = false
    controls.minDistance = 60; controls.maxDistance = 460; controls.zoomSpeed = 0.8
    // S5/E4.1: giảm chuyển động → tắt auto-rotate, chuyển sang render-on-demand
    const mqReduce = matchMedia('(prefers-reduced-motion: reduce)')
    const calcReduce = () => mqReduce.matches || document.documentElement.classList.contains('reduce-fx')
    R.current.reduceMotion = calcReduce()
    controls.autoRotate = !R.current.reduceMotion; controls.autoRotateSpeed = c0.rotate

    const stars1 = makeStars(scene, 1400, 3200, 1.1, 0.32, 0x6f9fcf)
    const stars2 = makeStars(scene, 800, 2000, 1.7, 0.48, 0x8fc4ee)
    const stars3 = makeStars(scene, 360, 1100, 2.4, 0.66, 0xcdecff)
    const galaxy = new THREE.Group(); scene.add(galaxy)

    R.current = { scene, camera, renderer, controls, galaxy, planets: new Map(), pick: [], mats: [], pos: new Map(), info: null, adj: new Map(), edges: null, edgeGeo: null, edgeMat: null, zoneMap: new Map(), visSet: null, hoverSet: null, topo: '', clock: new THREE.Clock(), hoverId: null, stars1, stars2, stars3, visible: false, cfg: c0, glow: c0.glow, nodeSize: c0.nodeSize, reduceMotion: calcReduce(), renderUntil: 0 }

    const tmp = new THREE.Vector3()
    const tick = () => {
      R.current.raf = requestAnimationFrame(tick)
      const r = R.current; if (!r.visible) return
      controls.update()  // damping luôn cập nhật; phát 'change' khi camera còn động → wake()
      const reduce = r.reduceMotion as boolean
      const now = performance.now()
      // render-on-demand: giảm chuyển động + không còn animation/tương tác → bỏ vẽ frame (0 draw-call)
      if (reduce && now > (r.renderUntil || 0)) return
      const t = r.clock.getElapsedTime()
      if (!reduce) {  // chỉ cuộn shader/sao khi cho phép chuyển động
        for (const m of r.mats) m.uniforms.uTime.value = t
        r.stars1.rotation.y = t * 0.005; r.stars2.rotation.y = -t * 0.009; r.stars3.rotation.y = t * 0.016
      }
      // progressive disclosure: hover-set (node + láng giềng) ưu tiên hơn recall focusSet
      const fset = (r.hoverSet || r.focusSet) as Set<string> | null
      const glow = r.glow ?? 1, nodeSize = r.nodeSize ?? 1
      const far = camera.position.length() > LOD_FAR   // LOD: camera xa → ẩn label node thường
      for (const [id, p] of r.planets) {
        // time-travel: node ngoài mốc thời gian → ẩn hẳn (KHÔNG re-layout, chỉ visibility)
        if (p.visible === false) { if (p.mesh.visible) p.mesh.visible = false; if (p.label && p.label.visible) p.label.visible = false; continue }
        if (!p.mesh.visible) p.mesh.visible = true
        if (p.label && !p.label.visible) p.label.visible = true
        // born: scale 0→1 trong ~1.4s; hover: phóng to; pulse recall: uActive giảm dần
        const age = (now - p.bornAt) / 1400
        const grow = age < 1 ? easeOut(age) : 1
        const hov = id === r.hoverId ? 1.7 : 1
        const sc = grow * hov * nodeSize
        p.mesh.scale.lerp(tmp.set(sc, sc, sc), 0.16)
        // focus mode: cụm liên quan SÁNG, phần còn lại MỜ đi (progressive disclosure)
        const inFocus = !fset || fset.has(id)
        if (p.mat.uniforms.uBright) {
          const tgt = (p.baseBright ?? p.n.brightness) * glow * (fset ? (inFocus ? 1.35 : 0.06) : 1)
          p.mat.uniforms.uBright.value = THREE.MathUtils.lerp(p.mat.uniforms.uBright.value, tgt, 0.12)
        }
        const lodHide = far && !p.isCore && id !== r.hoverId   // LOD label
        const labTarget = id === r.hoverId ? 1 : (lodHide || (fset && !inFocus) ? 0 : p.baseLabelOp)
        if (p.label) p.label.material.opacity = THREE.MathUtils.lerp(p.label.material.opacity, labTarget, 0.1)
        const pulse = Math.max(0, (p.pulseUntil - now) / 2600)
        if (p.mat.uniforms.uActive) p.mat.uniforms.uActive.value = pulse
      }
      renderer.render(scene, camera)
    }
    R.current.raf = requestAnimationFrame(tick)

    // render-on-demand: camera đổi (kéo/zoom/damping) → vẽ tiếp cho tới khi settle
    const onChange = () => { R.current.renderUntil = performance.now() + 220 }
    controls.addEventListener('change', onChange)
    // OS đổi reduced-motion HOẶC toggle reduce-fx ở Settings → cập nhật + vẽ lại
    const onReduce = () => { const r = R.current; r.reduceMotion = calcReduce(); controls.autoRotate = !!r.visible && !r.reduceMotion && !r.sliding; r.renderUntil = performance.now() + 600 }
    mqReduce.addEventListener('change', onReduce)
    const clsObs = new MutationObserver(onReduce)
    clsObs.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })

    const ro = new ResizeObserver(() => { const w = mount.clientWidth, h = mount.clientHeight; if (w && h) { renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); R.current.renderUntil = performance.now() + 300 } })
    ro.observe(mount)

    const ray = new THREE.Raycaster(); const ndc = new THREE.Vector2()
    const pickAt = (e: PointerEvent) => {
      const r = R.current; const b = renderer.domElement.getBoundingClientRect()
      ndc.set(((e.clientX - b.left) / b.width) * 2 - 1, -((e.clientY - b.top) / b.height) * 2 + 1)
      ray.setFromCamera(ndc, camera)
      const hits = ray.intersectObjects(r.pick, false)
      return hits.length ? hits[0].object.userData.id as string : null
    }
    const onMove = (e: PointerEvent) => {
      const r = R.current; if (!r.visible || r.dragging) return
      const id = pickAt(e)
      if (id !== r.hoverId) {
        r.hoverId = id; renderer.domElement.style.cursor = id ? 'pointer' : 'grab'
        const p = id && r.planets.get(id)
        setHover(p ? hoverOf(p.n) : null)
        // progressive disclosure: hover node → sáng node + láng giềng + cạnh chạm; phần còn lại mờ đi
        if (id) { const nb = (r.adj as Map<string, Set<string>>).get(id); const s = new Set<string>([id]); if (nb) for (const x of nb) s.add(x); r.hoverSet = s }
        else r.hoverSet = null
        recolorEdges(); wake()
      }
    }
    const onDown = () => { R.current.dragging = false; R.current.downAt = performance.now() }
    const onUp = (e: PointerEvent) => {
      const r = R.current
      if (performance.now() - (r.downAt || 0) < 250 && !r.dragging) { // click (không phải kéo)
        const id = pickAt(e); const p = id && r.planets.get(id)
        if (p && !p.n.ghost) openNote(p.n)
      }
    }
    const onDrag = () => { const r = R.current; r.dragging = true; controls.autoRotate = false; if (r.hoverId) { r.hoverId = null; r.hoverSet = null; setHover(null); recolorEdges() } wake() }
    const onDragEnd = () => { const r = R.current; if (r.visible && !r.sliding && !r.reduceMotion) controls.autoRotate = true; wake() }  // resume auto-rotate sau tương tác (trừ khi giảm chuyển động)
    renderer.domElement.addEventListener('pointermove', onMove)
    renderer.domElement.addEventListener('pointerdown', onDown)
    renderer.domElement.addEventListener('pointerup', onUp)
    controls.addEventListener('start', onDrag)
    controls.addEventListener('end', onDragEnd)

    return () => {
      cancelAnimationFrame(R.current.raf); ro.disconnect(); clsObs.disconnect()
      mqReduce.removeEventListener('change', onReduce)
      renderer.domElement.removeEventListener('pointermove', onMove)
      renderer.domElement.removeEventListener('pointerdown', onDown)
      renderer.domElement.removeEventListener('pointerup', onUp)
      controls.removeEventListener('start', onDrag)
      controls.removeEventListener('end', onDragEnd)
      controls.removeEventListener('change', onChange)
      renderer.dispose(); try { mount.removeChild(renderer.domElement) } catch { /* */ }
    }
  }, [webgl])

  useEffect(() => {
    const r = R.current; if (!r) return
    r.visible = visible
    if (r.controls) r.controls.autoRotate = visible && !r.reduceMotion && !r.sliding
    if (visible) r.renderUntil = performance.now() + 600  // S5/E4.1: vẽ ít nhất 1 nhịp khi mở lại tab
  }, [visible])

  // núm vặn live → áp vào scene + lưu localStorage. clusterDist/density → rescale vị trí (không re-sim).
  useEffect(() => {
    const r = R.current; if (!r || !r.scene) return
    r.cfg = cfg; r.glow = cfg.glow; r.nodeSize = cfg.nodeSize
    if (r.edgeMat) r.edgeMat.uniforms.uOpacity.value = cfg.edgeShow ? cfg.edgeOpacity : 0
    if (r.scene.fog) (r.scene.fog as THREE.FogExp2).density = cfg.fog
    if (r.controls && !r.sliding) r.controls.autoRotateSpeed = cfg.rotate
    try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)) } catch { /* */ }
    if (r.info && (r.appliedDist !== cfg.clusterDist || r.appliedDensity !== cfg.density)) {
      r.appliedDist = cfg.clusterDist; r.appliedDensity = cfg.density; recomputePositions()
    }
    wake()  // S5/E4.1: glow/fog/size/edge vừa chỉnh → vẽ lại (render-on-demand)
  }, [cfg])

  // ---- poll graph ----
  useEffect(() => {
    if (!visible || !webgl) return  // !webgl → Galaxy2D tự poll
    let alive = true
    const pull = async () => {
      try {
        const g = await brainGraph(); if (!alive) return
        if (g.configured === false) { setMeta((m) => ({ ...m, configured: false, offline: !!g.offline })); return }
        const nodes = g.nodes || [], links = g.links || []
        R.current.full = { nodes, links }
        // bounds cho thanh tua thời gian (mtime nhỏ nhất của note thật → giờ)
        const ms = nodes.map((n) => n.mtime).filter((m) => m > 0)
        if (ms.length) setTtBounds({ min: Math.min(...ms), max: g.ts || Date.now() })
        build()       // dựng layout 1 lần từ graph ĐẦY ĐỦ (chỉ rebuild khi topo đổi)
        applyFilter() // time-travel: chỉ đổi visibility theo mtime, KHÔNG re-layout
      } catch { if (alive) setMeta((m) => ({ ...m, offline: true })) }
    }
    pull(); const iv = setInterval(pull, 4000)
    return () => { alive = false; clearInterval(iv) }
  }, [visible])

  // ---- DỰNG tinh hà từ graph ĐẦY ĐỦ (chỉ rebuild khi topo đổi). Layout chạy 1 lần rồi FREEZE. ----
  function build() {
    const r = R.current; if (!r?.galaxy) return
    const full = r.full as { nodes: GraphNode[]; links: GraphLink[] } | undefined
    if (!full) return
    const nodes = full.nodes, links = full.links
    const topo = nodes.map((n) => n.id).sort().join(',') + '|' + links.length
    if (topo === r.topo) { // chỉ cập nhật brightness gốc (không rebuild) — tick lerp uBright theo focus
      for (const n of nodes) { const p = r.planets.get(n.id); if (p) p.baseBright = n.brightness }
      return
    }
    const prevIds = new Set(r.planets.keys())
    r.topo = topo
    for (const c of [...r.galaxy.children]) r.galaxy.remove(c)
    r.planets = new Map(); r.pick = []; r.mats = []

    // degree → hành tinh trung tâm (lõi tinh hà) = node nhiều liên kết nhất
    const deg = new Map<string, number>()
    for (const l of links) { deg.set(l.source, (deg.get(l.source) || 0) + 1); deg.set(l.target, (deg.get(l.target) || 0) + 1) }
    let coreId = ''; let best = -1
    for (const n of nodes) { const d = deg.get(n.id) || 0; if (!n.ghost && d > best) { best = d; coreId = n.id } }

    const fn: FNode[] = nodes.map((n) => ({ id: n.id, mass: n.mass }))
    const fl: FLink[] = links.map((l) => ({ source: l.source, target: l.target, weight: l.weight }))
    const zoneMap = new Map(nodes.map((n) => [n.id, n.zone]))
    const zoneOf = (id: string) => zoneMap.get(id) || 'memory'
    r.zoneMap = zoneMap
    // adjacency (láng giềng trực tiếp) cho progressive disclosure khi hover
    const adj = new Map<string, Set<string>>()
    for (const l of links) {
      if (!adj.has(l.source)) adj.set(l.source, new Set()); adj.get(l.source)!.add(l.target)
      if (!adj.has(l.target)) adj.set(l.target, new Set()); adj.get(l.target)!.add(l.source)
    }
    r.adj = adj
    let pos: Map<string, THREE.Vector3>
    if (GALAXY_MODE === 'disk') { pos = forceLayout3D(fn, fl, r.pos); r.info = null }          // đĩa cũ
    else if (GALAXY_MODE === 'shell') { pos = sphereLayout3D(fn, fl, zoneOf, deg, coreId); r.info = null }  // vỏ-cầu cũ
    else if (GALAXY_MODE === 'volume') { pos = volumeLayout3D(fn, zoneOf, deg, coreId); r.info = null }      // cầu đặc cũ
    else { const g = galaxyLayout3D(fn, fl, zoneOf, deg, coreId, R_GALAXY); pos = g.pos; r.info = g.info }   // THIÊN HÀ CẦU (mặc định)
    r.pos = pos
    // áp khoảng-cách-cụm + density từ cfg (nếu có info → rescale, KHÔNG re-sim)
    r.appliedDist = r.cfg.clusterDist; r.appliedDensity = r.cfg.density
    if (r.info && (r.cfg.clusterDist !== 1 || r.cfg.density !== 1)) {
      for (const [id, inf] of r.info as LayoutInfo) {
        const p = inf.center.clone().multiplyScalar(r.cfg.clusterDist).add(inf.local.clone().multiplyScalar(r.cfg.density))
        if (p.length() > R_GALAXY * 0.97) p.setLength(R_GALAXY * 0.97); pos.set(id, p)
      }
    }

    const now = performance.now()
    for (const n of nodes) {
      const p = pos.get(n.id)!; const isCore = n.id === coreId
      const rad = (isCore ? 5.2 : 1.4 + Math.cbrt(n.mass) * 0.7) * (n.ghost ? 0.6 : 1)
      const mat = new THREE.ShaderMaterial({
        vertexShader: ORB_VERT, fragmentShader: isCore ? CORE_FRAG : PLANET_FRAG, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
        uniforms: isCore
          ? { uColor: { value: zoneCol(n.zone) }, uTime: { value: 0 } }
          : { uColor: { value: n.ghost ? new THREE.Color('#46566a') : zoneCol(n.zone) }, uTime: { value: 0 }, uActive: { value: 0 }, uBright: { value: n.brightness }, uSeed: { value: hash01(n.id) } },
      })
      const mesh = new THREE.Mesh(new THREE.SphereGeometry(rad, isCore ? 48 : 20, isCore ? 48 : 20), mat)
      mesh.position.copy(p); mesh.userData.id = n.id
      r.galaxy.add(mesh); r.mats.push(mat)

      let label: any = null // SpriteText — three untyped trong project → any (như BrainViz)
      const baseLabelOp = isCore ? 0.95 : 0.42
      if (!n.ghost) {
        label = new SpriteText(n.label.length > 22 ? n.label.slice(0, 21) + '…' : n.label)
        label.color = ZONE_COLOR[n.zone] || '#cfe6f5'
        label.textHeight = isCore ? 5 : 2.6 + Math.cbrt(n.mass) * 0.3
        label.fontFace = 'Space Grotesk, sans-serif'
        label.material.depthWrite = false; label.material.transparent = true
        label.material.opacity = 0
        label.position.copy(p).add(new THREE.Vector3(0, rad + 3, 0))
        r.galaxy.add(label)
      }
      const bornAt = prevIds.size && !prevIds.has(n.id) ? now : now - 2000 // node mới → animate ló sáng
      r.planets.set(n.id, { mesh, mat, n, label, baseLabelOp, isCore, bornAt, pulseUntil: 0, baseBright: n.brightness, visible: true, rad })
      r.pick.push(mesh)
    }

    // đường sao = wikilink, vẽ CUNG CONG (buildEdges). Shader per-vertex alpha → progressive disclosure.
    const eg = new THREE.BufferGeometry()
    const edgeMat = new THREE.ShaderMaterial({
      vertexShader: EDGE_VERT, fragmentShader: EDGE_FRAG,
      uniforms: { uOpacity: { value: r.cfg.edgeShow ? r.cfg.edgeOpacity : 0 } },
      transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
    })
    r.edgeGeo = eg; r.edgeMat = edgeMat; r.galaxy.add(new THREE.LineSegments(eg, edgeMat))
    buildEdges()
    wake(1700)  // S5/E4.1: hành tinh mới ló sáng (~1.4s) → giữ vẽ qua animation born
  }

  // DỰNG GEOMETRY CẠNH (cung cong) 1 lần sau layout. Vị trí FREEZE → chỉ dựng lại khi recompute knob.
  // intra-cụm = dây ngắn (lift nhẹ); inter-cụm = chỉ vài CẦU NỐI chính (primary) mờ, còn lại ẩn tới khi hover.
  function buildEdges() {
    const r = R.current
    const full = r.full as { nodes: GraphNode[]; links: GraphLink[] } | undefined
    if (!full || !r.edgeGeo || !r.pos) return
    const SEG = 12
    const links = full.links
    const zoneOf = (id: string) => (r.zoneMap as Map<string, string>).get(id) || 'memory'
    // primary inter-cụm: mỗi cặp zone giữ tối đa 2 cạnh mạnh nhất (vài cầu nối chính), còn lại ẩn mặc định
    const pairBest = new Map<string, { idx: number; w: number }[]>()
    links.forEach((l, i) => {
      const za = zoneOf(l.source), zb = zoneOf(l.target)
      if (za === zb) return
      const key = [za, zb].sort().join('|'); let a = pairBest.get(key); if (!a) { a = []; pairBest.set(key, a) } a.push({ idx: i, w: l.weight })
    })
    const primary = new Set<number>()
    for (const a of pairBest.values()) { a.sort((x, y) => y.w - x.w); a.slice(0, 2).forEach((x) => primary.add(x.idx)) }

    const positions: number[] = [], colors: number[] = [], alphas: number[] = []
    const edges: { aId: string; bId: string; vStart: number; vCount: number; base: number }[] = []
    links.forEach((l, i) => {
      const a = r.pos.get(l.source), b = r.pos.get(l.target); if (!a || !b) return
      const intra = zoneOf(l.source) === zoneOf(l.target)
      const base = intra ? 0.5 : (primary.has(i) ? 0.32 : 0)       // inter không-chính: ẩn (chỉ sáng khi hover)
      const liftK = intra ? 0.13 : 0.34                            // inter cong nhiều hơn → vòng qua, không cắt ngang
      const pts = sampleArc(a, b, SEG, liftK)
      const c = l.real ? EDGE_REAL : EDGE_DERIV
      const vStart = positions.length / 3
      for (let s = 0; s < SEG; s++) {
        const p0 = pts[s], p1 = pts[s + 1]
        positions.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z)
        colors.push(c.r, c.g, c.b, c.r, c.g, c.b); alphas.push(base, base)
      }
      edges.push({ aId: l.source, bId: l.target, vStart, vCount: SEG * 2, base })
    })
    const eg = r.edgeGeo as THREE.BufferGeometry
    eg.setAttribute('position', new THREE.BufferAttribute(new Float32Array(positions), 3))
    eg.setAttribute('aColor', new THREE.BufferAttribute(new Float32Array(colors), 3))
    eg.setAttribute('aAlpha', new THREE.BufferAttribute(new Float32Array(alphas), 1))
    r.edges = edges
    recolorEdges()
  }

  // CẬP NHẬT alpha từng cạnh (rẻ — chỉ ghi attribute, không re-layout). Kết hợp time-travel + hover + recall.
  function recolorEdges() {
    const r = R.current
    const eg = r.edgeGeo as THREE.BufferGeometry | null
    if (!eg || !r.edges) return
    const attr = eg.getAttribute('aAlpha') as THREE.BufferAttribute | undefined; if (!attr) return
    const arr = attr.array as Float32Array
    const vis = r.visSet as Set<string> | null, fs = r.focusSet as Set<string> | null, hov = r.hoverSet as Set<string> | null, hid = r.hoverId as string | null
    for (const e of r.edges as { aId: string; bId: string; vStart: number; vCount: number; base: number }[]) {
      let a: number
      if (vis && (!vis.has(e.aId) || !vis.has(e.bId))) a = 0                          // time-travel: 1 đầu ẩn → cạnh ẩn
      else if (hov) a = (e.aId === hid || e.bId === hid) ? 1 : e.base * 0.04           // hover: cạnh chạm node → sáng, còn lại mờ hẳn
      else if (fs) a = (fs.has(e.aId) && fs.has(e.bId)) ? Math.max(e.base, 0.85) : e.base * 0.06  // recall focus
      else a = e.base                                                                 // mặc định: mờ/ẩn theo base
      for (let k = 0; k < e.vCount; k++) arr[e.vStart + k] = a
    }
    attr.needsUpdate = true
    wake()  // S5/E4.1: alpha/brightness vừa đổi → vẽ tiếp tới khi lerp settle (chế độ render-on-demand)
  }

  // núm khoảng-cách-cụm + density: rescale vị trí từ info (O(n)) rồi dựng lại cung — KHÔNG re-sim force.
  function recomputePositions() {
    const r = R.current
    if (!r.info || !r.planets) return
    const ds = r.cfg.clusterDist, de = r.cfg.density
    for (const [id, inf] of r.info as LayoutInfo) {
      const p = inf.center.clone().multiplyScalar(ds).add(inf.local.clone().multiplyScalar(de))
      if (p.length() > R_GALAXY * 0.97) p.setLength(R_GALAXY * 0.97)
      r.pos.set(id, p)
      const pl = r.planets.get(id); if (pl) { pl.mesh.position.copy(p); if (pl.label) pl.label.position.copy(p).add(new THREE.Vector3(0, pl.rad + 3, 0)) }
    }
    buildEdges()
  }

  // TUA THỜI GIAN: chỉ đổi visibility node + alpha cạnh. KHÔNG re-layout/re-sim/re-build geometry (nguồn lag).
  function applyFilter() {
    const r = R.current
    const full = r.full as { nodes: GraphNode[]; links: GraphLink[] } | undefined
    if (!full || !r.planets || !r.edgeGeo) return
    const at = r.asOf as number | null
    const vis = new Set<string>()
    if (at == null) { for (const n of full.nodes) vis.add(n.id) }
    else {
      for (const n of full.nodes) if (n.mtime > 0 && n.mtime <= at) vis.add(n.id)
      // ghost (note chưa viết, mtime=0) giữ nếu có node-đang-hiện trỏ tới
      for (const l of full.links) if (vis.has(l.source) || vis.has(l.target)) {
        const other = vis.has(l.source) ? l.target : l.source
        const o = full.nodes.find((n) => n.id === other)
        if (o?.ghost) vis.add(o.id)
      }
    }
    for (const [id, p] of r.planets) p.visible = vis.has(id)
    r.visSet = at == null ? null : vis     // null = hiện hết (khỏi check trong recolorEdges)
    recolorEdges()                         // chỉ ghi alpha attribute — rẻ; geometry cung giữ NGUYÊN
    let le = 0
    for (const l of full.links) if (vis.has(l.source) && vis.has(l.target)) le++
    setMeta({ nodes: vis.size, links: le, learned: full.nodes.filter((n) => vis.has(n.id) && n.kind === 'preference').length, configured: true, offline: false })
  }

  async function openNote(n: GraphNode) {
    setSel({ node: n, doc: '…' })
    if (!n.path) { setSel({ node: n, doc: '_(không có file)_' }); return }
    const d = await brainFile(n.path)
    setSel({ node: n, doc: d.content || '_(không đọc được)_' })
  }

  // recall → hành tinh trúng bắn xung + ngắm camera vào cái đầu
  function clearFocus() { setQ(''); setFound(null); R.current.focusSet = null; recolorEdges() }

  async function doSearch() {
    const term = q.trim(); if (!term) { clearFocus(); return }
    const d = await brainRecall(term); const hits = d.hits || []
    const r = R.current; const now = performance.now()
    // map file_path → node id (permalink). Pulse mọi node có path khớp.
    const ids = new Set<string>()
    for (const h of hits) for (const [id, p] of r.planets) if (p.n.path === h.file_path) ids.add(id)
    for (const id of ids) { const p = r.planets.get(id); if (p) p.pulseUntil = now + 2600 }
    // A7 graph-walk: note nối hit (1 bước wikilink) → pulse NGẮN hơn (lan truyền mờ dần như xung neuron)
    const focus = new Set<string>(ids)
    for (const rel of d.related || []) for (const [id, p] of r.planets) {
      if (p.n.path === rel.file_path && !ids.has(id)) { p.pulseUntil = Math.max(p.pulseUntil, now + 1300); focus.add(id) }
    }
    // focus mode: cụm khớp (hit + liên quan 1 bước) SÁNG, còn lại MỜ → "Lucy biết gì về X"
    r.focusSet = focus.size ? focus : null
    recolorEdges(); wake(2700)  // pulse recall ~2.6s → giữ vẽ qua xung
    setFound(ids.size)
    // ngắm camera tới hành tinh đầu
    const first = [...ids][0]; const fp = first && r.pos.get(first)
    if (fp && r.controls) { r.controls.target.lerp(fp, 0.8) }
  }

  if (!webgl) return <Galaxy2D visible={visible} />  // S5/E4.2: máy không có WebGL → tinh hà 2D

  if (!meta.configured) return (
    <div className="h-full grid place-items-center px-6">
      <div className="card max-w-md p-6 text-center">
        <div className="text-3xl mb-2">🌌</div>
        <div className="display text-cyan tracking-wide mb-2">TINH HÀ CHƯA BẬT</div>
        <p className="text-[13px] text-inkdim leading-relaxed">Đặt <code className="text-cyan">LUCY_VAULT</code> cho coordinator rồi restart.{meta.offline && <span className="block mt-2 text-pink">· coordinator offline.</span>}</p>
      </div>
    </div>
  )

  return (
    <div className="relative h-full w-full overflow-hidden" style={{ background: 'radial-gradient(130% 130% at 50% 42%, #0a1120 0%, #070b14 55%, #04060c 100%)', cursor: 'grab' }}>
      <div ref={mountRef} className="absolute inset-0" />

      {/* search recall — gõ → hành tinh trúng bắn xung */}
      <div className="absolute top-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-1.5 w-[min(420px,80%)]">
        <input className="input !py-1.5 text-[13px] flex-1 bg-black/40 backdrop-blur" placeholder="recall — Lucy biết gì về…"
          value={q} onChange={(e) => { setQ(e.target.value); if (!e.target.value.trim()) clearFocus() }} onKeyDown={(e) => { if (e.key === 'Enter') doSearch() }} />
        <button className="btn btn-primary !py-1.5 !text-[12px] shrink-0" aria-label="Tìm recall" onClick={doSearch}>🔎</button>
        {found !== null && <span className="chip shrink-0 bg-black/40">{found} ⚡</span>}
        {found !== null && <button className="btn btn-icon !w-8 !h-8 shrink-0" title="bỏ focus" aria-label="Bỏ focus recall" onClick={clearFocus}>✕</button>}
      </div>

      {/* tua thời gian — não lớn lên theo thời gian (kéo về quá khứ → tinh hà nhỏ lại) */}
      {ttBounds && ttBounds.max > ttBounds.min && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 w-[min(540px,88%)] bg-black/45 backdrop-blur rounded-full px-3.5 py-1.5">
          <span className="text-[10px] text-inkfaint shrink-0 w-[72px]">{asOf == null ? '⏳ GIỜ' : '⏳ ' + fmtDay(asOf)}</span>
          <input type="range" className="flex-1 accent-cyan cursor-pointer" min={ttBounds.min} max={ttBounds.max}
            aria-label="Tua thời gian tinh hà" aria-valuetext={asOf == null ? 'hiện tại' : fmtDay(asOf)}
            step={Math.max(1, Math.floor((ttBounds.max - ttBounds.min) / 240))} value={asOf ?? ttBounds.max}
            onPointerDown={() => setSliding(true)} onPointerUp={() => setSliding(false)} onPointerCancel={() => setSliding(false)}
            onChange={(e) => { const v = Number(e.target.value); scrub(v >= ttBounds.max ? null : v) }} />
          {asOf != null && <button className="btn btn-icon !w-7 !h-7 shrink-0" title="về GIỜ" aria-label="Về thời điểm hiện tại" onClick={() => scrub(null)}>⏵</button>}
        </div>
      )}

      {/* hover info */}
      <div className="absolute left-1/2 -translate-x-1/2 bottom-24 z-20 pointer-events-none text-center">
        {hover ? (
          <div key={hover.label}>
            <div className="text-[15px] font-semibold tracking-wide" style={{ color: ZONE_COLOR[hover.zone] || '#cfe6f5', textShadow: `0 0 12px ${(ZONE_COLOR[hover.zone] || '#3fd3ff')}88` }}>{hover.label}</div>
            <div className="text-[11px] mt-0.5 text-inkdim">{ZONE_LABEL[hover.zone] || hover.zone} · {hover.kind}{hover.obs ? ` · ${hover.obs} quan sát` : ''}{hover.extra ? ` · ${hover.extra}` : ''}</div>
            <div className="text-[10px] text-inkfaint mt-0.5">click để mở</div>
          </div>
        ) : (
          <div className="text-[11px] text-inkfaint">{meta.nodes} hành tinh · {meta.links} đường sao · {meta.learned} đã học{meta.offline ? ' · offline' : ''}</div>
        )}
      </div>

      {/* legend zone */}
      <div className="absolute top-3 right-4 flex flex-col gap-1 text-[10px] pointer-events-none z-20">
        {Object.entries(ZONE_LABEL).filter(([z]) => z !== 'ghost').map(([z, lb]) => (
          <div key={z} className="flex items-center gap-1.5" style={{ color: ZONE_COLOR[z] }}>
            <span style={{ width: 8, height: 8, borderRadius: 9, background: ZONE_COLOR[z], boxShadow: `0 0 6px ${ZONE_COLOR[z]}` }} /> {lb}
          </div>
        ))}
      </div>

      {/* núm vặn live (góc phải dưới) — chủ nhân chỉnh gu rồi 'copy config' gửi lại em chốt mặc định */}
      <button className="btn btn-icon !w-9 !h-9 absolute bottom-3 right-4 z-20 bg-black/45 backdrop-blur" title="núm vặn galaxy" aria-label="Mở núm vặn galaxy" aria-expanded={showCfg} onClick={() => setShowCfg((v) => !v)}>⚙️</button>
      {showCfg && (
        <div className="absolute bottom-14 right-4 z-30 w-[230px] bg-panel/95 backdrop-blur border border-line rounded-xl p-3 shadow-2xl text-[11px]">
          <div className="flex items-center justify-between mb-2">
            <span className="text-cyan font-medium">⚙️ Galaxy tinh chỉnh</span>
            <button className="text-inkfaint hover:text-ink" onClick={() => setShowCfg(false)}>✕</button>
          </div>
          {GALAXY_MODE === 'galaxy' && <>
            <Knob label="khoảng cách cụm" v={cfg.clusterDist} min={0.4} max={2} step={0.05} set={(v) => setCfg((c) => ({ ...c, clusterDist: v }))} />
            <Knob label="độ đặc (density)" v={cfg.density} min={0.4} max={2} step={0.05} set={(v) => setCfg((c) => ({ ...c, density: v }))} />
          </>}
          <div className="flex items-center justify-between mt-1.5 mb-0.5">
            <span className="text-inkdim">hiện đường nối</span>
            <input type="checkbox" className="accent-cyan" checked={cfg.edgeShow} onChange={(e) => setCfg((c) => ({ ...c, edgeShow: e.target.checked }))} />
          </div>
          <Knob label="opacity đường" v={cfg.edgeOpacity} min={0} max={1} step={0.02} set={(v) => setCfg((c) => ({ ...c, edgeOpacity: v }))} />
          <Knob label="glow node" v={cfg.glow} min={0.3} max={2.5} step={0.05} set={(v) => setCfg((c) => ({ ...c, glow: v }))} />
          <Knob label="fog (chiều sâu)" v={cfg.fog} min={0} max={0.005} step={0.0002} set={(v) => setCfg((c) => ({ ...c, fog: v }))} fmt={(x) => x.toFixed(4)} />
          <Knob label="size node" v={cfg.nodeSize} min={0.4} max={2.5} step={0.05} set={(v) => setCfg((c) => ({ ...c, nodeSize: v }))} />
          <Knob label="tốc độ xoay" v={cfg.rotate} min={0} max={1.5} step={0.05} set={(v) => setCfg((c) => ({ ...c, rotate: v }))} />
          <div className="flex gap-1.5 mt-2.5">
            <button className="btn btn-primary !py-1 !text-[11px] flex-1" onClick={() => { navigator.clipboard?.writeText(JSON.stringify(cfg)); setCopied(true); setTimeout(() => setCopied(false), 1400) }}>{copied ? '✓ đã copy' : '📋 copy config'}</button>
            <button className="btn !py-1 !text-[11px]" title="về mặc định" onClick={() => setCfg({ ...DEFAULT_CFG })}>↺</button>
          </div>
        </div>
      )}

      {/* note panel (click hành tinh) */}
      {sel && (
        <div className="absolute top-0 right-0 h-full w-[min(440px,92%)] z-30 bg-panel/95 backdrop-blur border-l border-line flex flex-col shadow-2xl">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-line shrink-0">
            <span style={{ color: ZONE_COLOR[sel.node.zone] }}>●</span>
            <span className="text-[13px] text-cyan font-medium truncate flex-1">{sel.node.label}</span>
            <span className="text-[10px] text-inkfaint mono truncate max-w-[40%]">{sel.node.path}</span>
            <button className="btn btn-icon !w-8 !h-8 shrink-0" aria-label="Đóng ghi chú" onClick={() => setSel(null)}>✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-4"><div className="card p-4"><Markdown>{stripFm(sel.doc)}</Markdown></div></div>
        </div>
      )}
    </div>
  )
}

function easeOut(t: number) { return 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3) }
function fmtDay(ms: number): string { const d = new Date(ms); return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}` }
function agoOf(ms: number): string {
  const days = Math.floor((Date.now() - ms) / 86400000)
  if (days <= 0) return 'học hôm nay'
  if (days === 1) return 'học hôm qua'
  if (days < 30) return `học ${days} ngày trước`
  return `học ${Math.floor(days / 30)} tháng trước`
}
function hoverOf(n: GraphNode): Hover {
  const extra = n.kind === 'preference' ? `${n.status} ${n.confidence ?? 0} (${n.band})` : n.ghost ? 'chưa viết' : (n.mtime ? agoOf(n.mtime) : undefined)
  return { label: n.label, zone: n.zone, kind: n.kind, obs: n.obs, extra }
}
function stripFm(md: string): string { return md.replace(/^---[\s\S]*?\n---\n/, '').trim() }

// slider 1 dòng cho panel núm vặn
function Knob({ label, v, min, max, step, set, fmt }: { label: string; v: number; min: number; max: number; step: number; set: (v: number) => void; fmt?: (x: number) => string }) {
  return (
    <div className="mt-1.5">
      <div className="flex items-center justify-between text-inkdim">
        <span>{label}</span>
        <span className="mono text-inkfaint">{fmt ? fmt(v) : v.toFixed(2)}</span>
      </div>
      <input type="range" className="w-full accent-cyan cursor-pointer h-1" min={min} max={max} step={step} value={v} onChange={(e) => set(Number(e.target.value))} />
    </div>
  )
}
