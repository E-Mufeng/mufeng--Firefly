/**
 * hero-character-scene.ts — 首页全屏 3D 角色场景引擎（卡通渲染 + 咒力 VFX）
 *
 * 由 WallpaperSection 的客户端脚本动态 import（代码分割，three 不进普通页面包）。
 * mountHero3D(layer) 返回控制器：
 *   - destroy()        严格 dispose 全部 GPU 资源 + forceContextLoss（离开首页时调用）
 *   - castSkill(key)   触发 蒼（收敛）/ 赫（发散）/ 茈（融合）+ 扭曲/色差/震屏/Bloom 脉冲
 *   - switchCharacter(i) 切换角色（五条悟 / 伏黑惠 / 钉崎野蔷薇）
 *   - setAutoRotate(on)
 *
 * 视觉：MeshToonMaterial 赛璐璐 + 反向外壳描边 + 六眼自发光 + UnrealBloom。
 * 交互：拖拽旋转、闲置浮空/发丝摇曳、点击角色弹出经典口头禅 + 咒力火花。
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { CHARACTERS, SKILLS, type CharacterConfig } from "./hero-content";
import { attachOutline, sharedToonGradient, toonMat } from "./toon-material";
import { makeSkillFXPass } from "./skill-fx-pass";

export interface QualityTier {
	pixelRatio: number;
	bloom: number;
	particles: number;
	antialias: boolean;
	distortion: boolean;
}

export interface Hero3DController {
	destroy(): void;
	castSkill(key: string): void;
	switchCharacter(index: number): void;
	setAutoRotate(on: boolean): void;
	_debug?: unknown;
}

interface BuiltCharacter {
	group: THREE.Group;
	hairGroup: THREE.Group;
	headGroup: THREE.Group;
	arms: {
		left: { arm: THREE.Group; fore: THREE.Group; hand: HandParts };
		right: { arm: THREE.Group; fore: THREE.Group; hand: HandParts };
		pose: (t: number) => void;
	};
}

function disposeObj(obj: THREE.Object3D | null): void {
	if (!obj) return;
	obj.traverse((child) => {
		const mesh = child as THREE.Mesh;
		if (mesh.geometry) mesh.geometry.dispose();
		const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
		if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
		else if (mat) mat.dispose();
	});
}

function detectQuality(): QualityTier {
	const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8;
	const cores = navigator.hardwareConcurrency ?? 8;
	const mobile = window.innerWidth < 820;
	if (mobile || mem <= 4 || cores <= 4) {
		return { pixelRatio: 1.5, bloom: 0.2, particles: 1200, antialias: false, distortion: false };
	}
	return { pixelRatio: 2, bloom: 0.28, particles: 3200, antialias: true, distortion: true };
}

/**
 * 动漫头型变形：把球面上的点映射成「左右窄、颅顶饱满、下颌内收、下巴尖」的头形。
 * 头几何、发量帽、五官定位全部共用这一个函数，保证三者严丝合缝。
 */
function headShape(x: number, y: number, z: number, R: number, out: THREE.Vector3): THREE.Vector3 {
	const ry = y / R;
	let fx = 0.79; // 基础：左右收窄（动漫头型比真人窄）
	let fz = z > 0 ? 0.93 : 1.0; // 面部略平，后脑保留深度
	if (ry < 0.16) {
		// 下颌 → 下巴：收得更狠，下巴才尖
		const t = Math.min(1, (0.16 - ry) / 1.16);
		const f = 1 - 0.72 * Math.pow(t, 0.8);
		fx *= f;
		fz *= f;
	}
	if (ry > 0.05) {
		// 颅顶略饱满
		const t = Math.min(1, (ry - 0.05) / 0.95);
		fx *= 1 + 0.04 * t;
		if (z < 0) fz *= 1 + 0.12 * t; // 后脑略拉长
	}
	return addFaceStructure(out.set(x * fx, y, z * fz), R);
}

/**
 * 面部结构（叠在 headShape 之后）：鼻梁微凸 + 眉弓 + 颧骨。
 * 没有这三处，脸就是一块平板 —— 这是「像贴了张面具」的根因之一。
 * 头几何 / 五官贴附都走 headShape，所以结构会自动带动五官定位。
 */
function addFaceStructure(out: THREE.Vector3, R: number): THREE.Vector3 {
	if (out.z <= 0) return out;
	const w = out.z / R;
	const ax = Math.abs(out.x);
	const y = out.y;
	const bridge = Math.exp(-(ax * ax) / 0.005) * Math.exp(-((y - 0.015) * (y - 0.015)) / 0.045);
	const brow = Math.exp(-((ax - 0.13) * (ax - 0.13)) / 0.02) * Math.exp(-((y - 0.125) * (y - 0.125)) / 0.0032);
	const cheek = Math.exp(-((ax - 0.2) * (ax - 0.2)) / 0.0098) * Math.exp(-((y + 0.07) * (y + 0.07)) / 0.0128);
	out.z += (bridge * 0.016 + brow * 0.009 + cheek * 0.011) * w;
	return out;
}

/** 头表面在 (x, y) 处的前方 z 值——用来把五官精确贴在脸上。 */
function faceSurfaceZ(x: number, y: number, R = 0.42): number {
	const r2 = R * R - x * x - y * y;
	if (r2 <= 0) return 0;
	const v = headShape(x, y, Math.sqrt(r2), R, _tmpV);
	return v.z;
}
const _tmpV = new THREE.Vector3();
const _tmpShell = new THREE.Vector3();
const _tmpDir = new THREE.Vector3();

/**
 * 取「变形后头壳」表面上、朝向 dir 的点，再沿 dir 外推 extra。
 * 发片 / 发量帽的所有控制点都经过这里 —— 永远贴着同一套头形，不会飘。
 */
function shellPoint(dir: THREE.Vector3, extra: number, R: number, out: THREE.Vector3): THREE.Vector3 {
	const d = _tmpDir.copy(dir).normalize();
	headShape(d.x * R, d.y * R, d.z * R, R, _tmpShell);
	return out.copy(_tmpShell).addScaledVector(d, extra);
}

function makeAnimeHeadGeometry(radius: number): THREE.BufferGeometry {
	let geo: THREE.BufferGeometry = new THREE.SphereGeometry(radius, 64, 48);
	const pos = geo.attributes.position;
	const v = new THREE.Vector3();
	for (let i = 0; i < pos.count; i++) {
		headShape(pos.getX(i), pos.getY(i), pos.getZ(i), radius, v);
		pos.setXYZ(i, v.x, v.y, v.z);
	}
	pos.needsUpdate = true;
	// 关键：SphereGeometry 在经度接缝处有**重复顶点**（UV 不同）。
	// 直接 computeVertexNormals 会给接缝两侧算出不同法线 → 脸上留下一条硬棱竖线。
	// 皮肤材质不用 UV，所以先删掉 uv/normal 再焊接，最后统一算法线。
	geo.deleteAttribute("uv");
	geo.deleteAttribute("normal");
	geo = mergeVertices(geo, 1e-4);
	geo.computeVertexNormals();
	return geo;
}

/**
 * 单束头发：沿 CatmullRom 路径扫掠出「扁平锥形发片」。
 * 动漫头发的发束是**扁平、带尖**的片状，不是圆锥 —— 这是与上一版刺猬头的最大区别。
 * flatDir 指定「薄」的方向，保证发片朝向可控，不会随机扭转。
 */
function makeLockGeometry(
	points: THREE.Vector3[],
	width: number,
	flat: number,
	flatDir: THREE.Vector3,
	radial = 7,
	steps = 24,
): THREE.BufferGeometry {
	const curve = new THREE.CatmullRomCurve3(points, false, "catmullrom", 0.5);
	const positions: number[] = [];
	const indices: number[] = [];
	const T = new THREE.Vector3();
	const N = new THREE.Vector3();
	const B = new THREE.Vector3();
	const up = new THREE.Vector3(0, 1, 0);
	const alt = new THREE.Vector3(1, 0, 0);

	for (let i = 0; i <= steps; i++) {
		const t = i / steps;
		const P = curve.getPoint(t);
		curve.getTangent(t, T).normalize();
		const ref = Math.abs(T.dot(up)) > 0.94 ? alt : flatDir;
		N.crossVectors(ref, T);
		if (N.lengthSq() < 1e-8) N.crossVectors(alt, T);
		N.normalize();
		B.crossVectors(T, N).normalize();
		// 根部饱满，尖端急收成一点
		const w = width * Math.max(0.05, Math.pow(1 - Math.pow(t, 2.6), 0.55));
		for (let j = 0; j < radial; j++) {
			const a = (j / radial) * Math.PI * 2;
			const c = Math.cos(a) * w;
			const s = Math.sin(a) * w * flat;
			positions.push(P.x + N.x * c + B.x * s, P.y + N.y * c + B.y * s, P.z + N.z * c + B.z * s);
		}
	}
	for (let i = 0; i < steps; i++) {
		for (let j = 0; j < radial; j++) {
			const a = i * radial + j;
			const b = i * radial + ((j + 1) % radial);
			const c = (i + 1) * radial + j;
			const d = (i + 1) * radial + ((j + 1) % radial);
			indices.push(a, b, c, b, d, c);
		}
	}
	// 尖端封口
	const last = points[points.length - 1];
	const tipIdx = positions.length / 3;
	positions.push(last.x, last.y, last.z);
	const ring = steps * radial;
	for (let j = 0; j < radial; j++) {
		indices.push(ring + j, tipIdx, ring + ((j + 1) % radial));
	}

	const g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	g.setIndex(indices);
	g.computeVertexNormals();
	return g;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
}

/**
 * 虹膜贴图：canvas 现画 —— 径向渐变（亮心 → 深边）+ 放射肌理 + 瞳孔 + 双高光。
 * 这是「像眼睛」与「白灯泡」的分水岭：上一版是纯色球 + additive halo，
 * 必然糊成两颗发光车灯。
 */
function makeIrisTexture(colorHex: number): THREE.CanvasTexture {
	const S = 256;
	const cv = document.createElement("canvas");
	cv.width = S;
	cv.height = S;
	const g = cv.getContext("2d");
	const base = new THREE.Color(colorHex);
	const deep = base.clone().multiplyScalar(0.26);
	const bright = base.clone().lerp(new THREE.Color(0xffffff), 0.62);
	if (g) {
		const c = S / 2;
		const grad = g.createRadialGradient(c, c, S * 0.04, c, c, S * 0.5);
		grad.addColorStop(0, "#" + bright.getHexString());
		grad.addColorStop(0.45, "#" + base.getHexString());
		grad.addColorStop(1, "#" + deep.getHexString());
		g.fillStyle = grad;
		g.beginPath();
		g.arc(c, c, S * 0.5, 0, Math.PI * 2);
		g.fill();
		// 放射状肌理
		g.globalAlpha = 0.22;
		g.strokeStyle = "#" + deep.getHexString();
		g.lineWidth = 2;
		for (let i = 0; i < 56; i++) {
			const a = (i / 56) * Math.PI * 2;
			g.beginPath();
			g.moveTo(c + Math.cos(a) * S * 0.17, c + Math.sin(a) * S * 0.17);
			g.lineTo(c + Math.cos(a) * S * 0.5, c + Math.sin(a) * S * 0.5);
			g.stroke();
		}
		g.globalAlpha = 1;
		// 瞳孔
		g.fillStyle = "#04060f";
		g.beginPath();
		g.arc(c, c, S * 0.17, 0, Math.PI * 2);
		g.fill();
		// 双高光
		g.fillStyle = "rgba(255,255,255,0.96)";
		g.beginPath();
		g.arc(c - S * 0.14, c - S * 0.16, S * 0.095, 0, Math.PI * 2);
		g.fill();
		g.fillStyle = "rgba(255,255,255,0.6)";
		g.beginPath();
		g.arc(c + S * 0.13, c + S * 0.15, S * 0.045, 0, Math.PI * 2);
		g.fill();
	}
	const tex = new THREE.CanvasTexture(cv);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.anisotropy = 4;
	return tex;
}

/** 冲击环贴图：中心透明、边缘一圈亮环 —— 用来做术式释放的冲击波。 */
function makeRingTexture(): THREE.CanvasTexture {
	const S = 256;
	const cv = document.createElement("canvas");
	cv.width = S;
	cv.height = S;
	const g = cv.getContext("2d");
	if (g) {
		const c = S / 2;
		const grad = g.createRadialGradient(c, c, S * 0.2, c, c, S * 0.5);
		grad.addColorStop(0, "rgba(255,255,255,0)");
		grad.addColorStop(0.52, "rgba(255,255,255,0.16)");
		grad.addColorStop(0.78, "rgba(255,255,255,0.95)");
		grad.addColorStop(0.9, "rgba(255,255,255,0.5)");
		grad.addColorStop(1, "rgba(255,255,255,0)");
		g.fillStyle = grad;
		g.fillRect(0, 0, S, S);
	}
	const tex = new THREE.CanvasTexture(cv);
	tex.colorSpace = THREE.SRGBColorSpace;
	return tex;
}

/**
 * 头发体积帽：发际线随方位角变化 —— 前额高（露出额头）、两侧到耳、后颈低。
 * 下缘半径收进头颅内部，避免露出缝。
 */
function makeHairCapGeometry(R: number, nTheta = 96, nV = 32): THREE.BufferGeometry {
	const positions: number[] = [];
	const indices: number[] = [];
	const DEG = Math.PI / 180;
	const v3 = new THREE.Vector3();
	const RIDGES = 11;
	for (let i = 0; i <= nV; i++) {
		const v = i / nV;
		for (let j = 0; j <= nTheta; j++) {
			const theta = (j / nTheta) * Math.PI * 2;
			// 发簇脊：沿方位角分布的纵向棱（头顶收敛、发际处最明显）→ 让整块发量读成「一簇一簇」
			const ridgePhase = 0.5 + 0.5 * Math.cos(RIDGES * theta + 0.6);
			// 发际线：前 54°（露额头）/ 两侧 96°（及耳下）/ 后颈 138°，再叠「扇贝形」缺口
			const baseEdge = (96 - 42 * Math.cos(theta - Math.PI / 2)) * DEG;
			const phiEdge = baseEdge + 5.5 * Math.pow(ridgePhase, 1.4) * DEG;
			const phi = v * phiEdge;
			const sp = Math.sin(phi);
			const cp = Math.cos(phi);
			// 与头几何完全同一套形状，再整体外扩（发量帽始终贴在头皮外侧）
			headShape(sp * Math.cos(theta) * R, cp * R, sp * Math.sin(theta) * R, R, v3);
			// 体积 + 发簇脊起伏（不是光滑头盔）；下缘收进头颅内避免露缝
			const ridge = 0.012 * Math.pow(ridgePhase, 1.7) * smoothstep(0.06, 0.9, v);
			const grow = 1.009 + 0.014 * Math.sin(v * Math.PI) + ridge - 0.05 * smoothstep(0.82, 1, v);
			positions.push(v3.x * grow, v3.y * grow + 0.014, v3.z * grow);
		}
	}
	for (let i = 0; i < nV; i++) {
		for (let j = 0; j < nTheta; j++) {
			const a = i * (nTheta + 1) + j;
			const b = a + 1;
			const c = a + (nTheta + 1);
			const d = c + 1;
			indices.push(a, b, c, b, d, c);
		}
	}
	const g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
	g.setIndex(indices);
	g.computeVertexNormals();
	return g;
}

/**
 * 五条悟发型：手工编排的发束表（不是随机撒圆锥）。
 *   头顶  → 整体上冲、略后掠的厚发（标志性）
 *   前额  → 数缕垂落至眉眼之间的刘海
 *   两侧  → 贴脸垂到下颌的鬓发
 *   后脑  → 盖住发际的短发
 * 全部 merge 成一个 geometry（1 个 draw call，方便统一描边）。
 */
/**
 * 五条悟发型：分层「流动发片」。
 *
 * 与上一版的根本区别（上一版被判为「水晶碎片 / 松果」的原因）：
 *   1. 发片先贴着头皮「走」一段，中后段才抬离，发梢再甩出（flowLock）。
 *      上一版是从头皮直接向外直插 —— 那必然长成刺猬。
 *   2. 截面 10 段、20 步，表面平滑，不会出现硬棱面。
 *   3. 不再逐片描边：几十片叠在一起时，逐片描边会在内部织成黑线网（碎玻璃感）。
 *   4. 分层重叠（上冲簇 → 中段覆盖 → 刘海帘 → 鬓发 → 后颈），层与层互相压住，
 *      缝里露出来的是白色基底发量帽，不是皮肤。
 */
/**
 * 五条悟发型：分层「发簇」。
 *
 * 与上一版的根本区别：
 *   1. 发簇先贴着头皮「走」一段，中后段才抬离，发梢沿 liftDir 甩出**并向后弯**（curl）。
 *      弯，是「头发」和「刀片」的分界线；上一版是直的，所以像冰锥。
 *   2. 抬离方向里 outward 分量很小：只有头顶才向上冲，两侧/后脑贴着头皮铺。
 *      上一版所有发束都径向外炸 → 必然长成刺猬 / 松果。
 *   3. 少而大：约 70 束「宽发簇」而不是 110 束细发片，每束都读得出来。
 *   4. 不逐片描边：几十束叠在一起时，逐片描边会在内部织成黑线网（碎玻璃感）。
 */
/**
 * 五条悟发型 = 「连通的发量壳」+「短而克制的发梢」。
 *
 * 上一版失败的根因（第一性原理）：发梢长度 0.30~0.46，而头半径只有 0.42 ——
 * 发梢比头还长，且每个方位角都在外炸，70 束加起来必然是一个「荆棘球」。
 * 这一版：
 *   1. 体积交给「发量壳」（自带发簇脊 + 扇贝形发际线），它是一整块连通的头发；
 *   2. 发梢只负责打碎轮廓线，长度压到 0.05~0.20，且只在头顶/发际/刘海三处出现；
 *   3. 两侧与后脑几乎不外炸 —— 贴着头皮铺。
 */
/**
 * 五条悟发型 = 「连通的发量壳」+「朝同一目标收拢的大发簇」。
 *
 * 前三版失败的根因（第一性原理）：
 *   v1/v2 每束发梢各自沿「自身径向外法线」甩出 → 70 束放射 = 荆棘球；
 *   v3 把发梢压短了，但方向仍是各自向外 → 44 个小凸起 = 花椰菜。
 *
 * 这一版的关键：**所有头顶发簇的梢都指向同一个汇聚点**（头顶后上方），
 * 两侧发簇指向耳后下方 —— 这才是「向后梳拢的高耸发型」。
 * 再配合「少而大」的发簇（约 45 束，而不是 110 束细片），每一束都读得出来。
 */
/**
 * 五条悟发型 = 「连通的发量壳」+「朝同一目标收拢的大发簇」。
 *
 * 前三版失败的根因（第一性原理）：
 *   v1/v2 每束发梢各自沿「自身径向外法线」甩出 → 70 束放射 = 荆棘球；
 *   v3 把发梢压短了，但方向仍是各自向外 → 44 个小凸起 = 花椰菜。
 *
 * 这一版的关键：**所有头顶发簇的梢都指向同一个汇聚点**（头顶后上方），
 * 两侧发簇指向耳后下方 —— 这才是「向后梳拢的高耸发型」。
 * 再配合「少而大」的发簇（约 45 束，而不是 110 束细片），每一束都读得出来。
 */
/**
 * 五条悟发型 = 「连通的发量壳」+「朝同一目标收拢的大发簇」。
 *
 * 前三版失败的根因（第一性原理）：
 *   v1/v2 每束发梢各自沿「自身径向外法线」甩出 → 70 束放射 = 荆棘球；
 *   v3 把发梢压短了，但方向仍是各自向外 → 44 个小凸起 = 花椰菜。
 *
 * 这一版的关键：**所有头顶发簇的梢都指向同一个汇聚点**（头顶后上方），
 * 两侧发簇指向耳后下方 —— 这才是「向后梳拢的高耸发型」。
 * 再配合「少而大」的发簇（约 45 束，而不是 110 束细片），每一束都读得出来。
 */
/**
 * 五条悟发型 = 「连通的发量壳」+「朝同一目标收拢的大发簇」。
 *
 * 前三版失败的根因（第一性原理）：
 *   v1/v2 每束发梢各自沿「自身径向外法线」甩出 → 70 束放射 = 荆棘球；
 *   v3 把发梢压短了，但方向仍是各自向外 → 44 个小凸起 = 花椰菜。
 *
 * 这一版的关键：**所有头顶发簇的梢都指向同一个汇聚点**（头顶后上方），
 * 两侧发簇指向耳后下方 —— 这才是「向后梳拢的高耸发型」。
 * 再配合「少而大」的发簇（约 45 束，而不是 110 束细片），每一束都读得出来。
 */
/**
 * 五条悟发型 = 「连通的发量壳」+「朝同一目标收拢的大发簇」。
 *
 * 前三版失败的根因（第一性原理）：
 *   v1/v2 每束发梢各自沿「自身径向外法线」甩出 → 70 束放射 = 荆棘球；
 *   v3 把发梢压短了，但方向仍是各自向外 → 44 个小凸起 = 花椰菜。
 *
 * 这一版的关键：**所有头顶发簇的梢都指向同一个汇聚点**（头顶后上方），
 * 两侧发簇指向耳后下方 —— 这才是「向后梳拢的高耸发型」。
 * 再配合「少而大」的发簇（约 45 束，而不是 110 束细片），每一束都读得出来。
 */
/**
 * 五条悟发型 = 「连通的发量壳」+「朝同一目标收拢的大发簇」。
 *
 * 前三版失败的根因（第一性原理）：
 *   v1/v2 每束发梢各自沿「自身径向外法线」甩出 → 70 束放射 = 荆棘球；
 *   v3 把发梢压短了，但方向仍是各自向外 → 44 个小凸起 = 花椰菜。
 *
 * 这一版的关键：**所有头顶发簇的梢都指向同一个汇聚点**（头顶后上方），
 * 两侧发簇指向耳后下方 —— 这才是「向后梳拢的高耸发型」。
 * 再配合「少而大」的发簇（约 45 束，而不是 110 束细片），每一束都读得出来。
 */
/**
 * 五条悟发型 = 「连通的发量壳」+「朝同一目标收拢的大发簇」。
 *
 * 前三版失败的根因（第一性原理）：
 *   v1/v2 每束发梢各自沿「自身径向外法线」甩出 → 70 束放射 = 荆棘球；
 *   v3 把发梢压短了，但方向仍是各自向外 → 44 个小凸起 = 花椰菜。
 *
 * 这一版的关键：**所有头顶发簇的梢都指向同一个汇聚点**（头顶后上方），
 * 两侧发簇指向耳后下方 —— 这才是「向后梳拢的高耸发型」。
 * 再配合「少而大」的发簇（约 45 束，而不是 110 束细片），每一束都读得出来。
 */
/**
 * 五条悟发型 = 「连通的发量壳」+「朝同一目标收拢的大发簇」。
 *
 * 前三版失败的根因（第一性原理）：
 *   v1/v2 每束发梢各自沿「自身径向外法线」甩出 → 70 束放射 = 荆棘球；
 *   v3 把发梢压短了，但方向仍是各自向外 → 44 个小凸起 = 花椰菜。
 *
 * 这一版的关键：**所有头顶发簇的梢都指向同一个汇聚点**（头顶后上方），
 * 两侧发簇指向耳后下方 —— 这才是「向后梳拢的高耸发型」。
 * 再配合「少而大」的发簇（约 45 束，而不是 110 束细片），每一束都读得出来。
 */
function makeGojoHair(material: THREE.Material, headR: number): THREE.Group {
	const group = new THREE.Group();
	group.name = "hair";
	const R = headR;
	const DEG = Math.PI / 180;
	const geos: THREE.BufferGeometry[] = [];

	// 确定性伪随机：每次构建发型一致，刷新不乱跳
	let seed = 20250101;
	const rnd = (): number => {
		seed = (seed * 1664525 + 1013904223) % 4294967296;
		return seed / 4294967296;
	};
	const jitter = (amp: number): number => (rnd() - 0.5) * 2 * amp;

	/** 球面方向：th=90° 正前(+Z)，th=270° 后脑(-Z)；ph=0 头顶，ph=180 下巴 */
	const dirOf = (thDeg: number, phDeg: number): THREE.Vector3 => {
		const th = thDeg * DEG;
		const ph = phDeg * DEG;
		return new THREE.Vector3(Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th));
	};
	/** 该方位角处的发际线极角（与发量壳同一公式 → 发根永远长在头皮上） */
	const hairline = (thDeg: number): number => 96 - 42 * Math.cos(thDeg * DEG - Math.PI / 2);
	/** 发簇「薄」的方向 = 径向朝外 → 正面看是宽扁发簇，侧面看变薄 */
	const radialFlat = (thDeg: number): THREE.Vector3 =>
		new THREE.Vector3(Math.cos(thDeg * DEG), 0, Math.sin(thDeg * DEG)).normalize();
	/** 头皮上一点（含头形变形 + 外推） */
	const onScalpDir = (d: THREE.Vector3, extra = 0.006): THREE.Vector3 => shellPoint(d, extra, R, new THREE.Vector3());

	const BACK = new THREE.Vector3(0, 0, -1);
	const UP = new THREE.Vector3(0, 1, 0);
	const DOWN = new THREE.Vector3(0, -1, 0);

	// 发梢汇聚点：头顶后上方。所有头顶发簇朝这里收拢 → 高耸、向后掠。
	const CROWN_TARGET = new THREE.Vector3(0, R * 1.6, -R * 0.55);
	// 两侧发簇汇聚点：耳后下方 → 贴脸、向后收
	const sideTarget = (s: number): THREE.Vector3 => new THREE.Vector3(s * R * 1.0, -R * 0.85, -R * 0.7);

	/**
	 * 一束发簇：根部贴着头皮走 → 中段抬离 → 发梢朝 tipDir 甩出并向 curl 偏转。
	 * 控制点全部由 shellPoint 生成，所以永远贴着同一套变形头壳。
	 */
	const clump = (
		th0: number,
		ph0: number,
		phFlow: number,
		rise: number,
		tipLen: number,
		tipDir: THREE.Vector3,
		curl: THREE.Vector3,
		width: number,
		flat: number,
		flatDir: THREE.Vector3,
	): void => {
		const rootDir = dirOf(th0, ph0);
		const flowDir = dirOf(th0 + jitter(5), ph0 + phFlow);
		const N = 5;
		const pts: THREE.Vector3[] = [];
		for (let k = 0; k < N; k++) {
			const t = k / (N - 1);
			const d = rootDir.clone().addScaledVector(flowDir, t).normalize();
			pts.push(shellPoint(d, 0.012 + Math.pow(t, 1.9) * rise, R, new THREE.Vector3()));
		}
		const base = pts[N - 1].clone();
		const td = tipDir.clone().normalize();
		const c = curl.clone().normalize();
		pts.push(base.clone().addScaledVector(td, tipLen * 0.45).addScaledVector(c, tipLen * 0.08));
		pts.push(base.clone().addScaledVector(td, tipLen * 0.8).addScaledVector(c, tipLen * 0.22));
		pts.push(base.clone().addScaledVector(td, tipLen).addScaledVector(c, tipLen * 0.4));
		geos.push(makeLockGeometry(pts, width, flat, flatDir, 12, 22));
	};

	// ── 1) 头顶主簇：6 束大发簇，全部朝 CROWN_TARGET 收拢 ──
	for (let i = 0; i < 6; i++) {
		const th = 30 + (i / 5) * 300 + jitter(16);
		const ph = 7 + rnd() * 15;
		const outward = dirOf(th, ph);
		const root = shellPoint(outward, 0.03, R, new THREE.Vector3());
		const tipTarget = CROWN_TARGET.clone().add(new THREE.Vector3(jitter(0.2), jitter(0.1), jitter(0.14)));
		const tipDir = tipTarget.sub(root).normalize();
		const curl = outward.clone().multiplyScalar(0.2).addScaledVector(BACK, 0.9).addScaledVector(UP, 0.25).normalize();
		clump(th, ph, 14 + jitter(8), 0.032 + rnd() * 0.02, 0.11 + rnd() * 0.06, tipDir, curl, 0.15 + jitter(0.025), 0.44, radialFlat(th));
	}

	// ── 2) 颅顶外圈：7 束，同样朝 CROWN_TARGET 收拢，长度递减 ──
	for (let i = 0; i < 7; i++) {
		const th = (i / 7) * 360 + 18 + jitter(14);
		const ph = 24 + rnd() * 16;
		const outward = dirOf(th, ph);
		const root = shellPoint(outward, 0.025, R, new THREE.Vector3());
		const tipTarget = CROWN_TARGET.clone().add(new THREE.Vector3(jitter(0.26), jitter(0.12), jitter(0.18)));
		const tipDir = tipTarget.sub(root).normalize();
		const curl = outward.clone().multiplyScalar(0.3).addScaledVector(BACK, 0.75).addScaledVector(DOWN, 0.3).normalize();
		clump(th, ph, 16 + jitter(8), 0.02 + rnd() * 0.015, 0.08 + rnd() * 0.05, tipDir, curl, 0.14 + jitter(0.02), 0.46, radialFlat(th));
	}

	// ── 3) 两侧 + 后脑：贴着头皮铺，发梢朝耳后收（几乎不外炸）──
	for (const s of [1, -1]) {
		for (let i = 0; i < 5; i++) {
			const th = s > 0 ? 4 + i * 19 : 176 - i * 19;
			const hl = hairline(th);
			const ph = 40 + (i / 4) * Math.max(20, hl - 62);
			const outward = dirOf(th, ph);
			const root = shellPoint(outward, 0.02, R, new THREE.Vector3());
			const tipDir = sideTarget(s).clone().sub(root).normalize();
			const curl = outward.clone().multiplyScalar(0.4).addScaledVector(DOWN, 0.75).normalize();
			clump(th, ph, 18 + jitter(8), 0.014, 0.055 + rnd() * 0.04, tipDir, curl, 0.13 + jitter(0.018), 0.5, radialFlat(th));
		}
	}
	// 后脑
	for (let i = 0; i < 5; i++) {
		const th = 214 + (i / 4) * 132 + jitter(9);
		const hl = hairline(th);
		const ph = 46 + rnd() * Math.max(16, hl - 62);
		const outward = dirOf(th, ph);
		const root = shellPoint(outward, 0.02, R, new THREE.Vector3());
		const tipDir = root.clone().setY(root.y - 0.35).sub(root).normalize();
		clump(th, ph, 16 + jitter(8), 0.012, 0.05 + rnd() * 0.04, tipDir, DOWN, 0.125 + jitter(0.018), 0.52, radialFlat(th));
	}

	// ── 4) 刘海：从发际线垂落成「帘」，发尖收在眉眼之间 ──
	const bangCount = 8;
	for (const pass of [0, 1]) {
		const n = pass === 0 ? bangCount : bangCount - 1;
		const lo = pass === 0 ? 44 : 52;
		const hi = pass === 0 ? 136 : 128;
		for (let i = 0; i < n; i++) {
			const th = lo + (i / (n - 1)) * (hi - lo) + jitter(3);
			const phRoot = hairline(th) - 4 + jitter(3);
			const rootDir = dirOf(th, phRoot);
			const flowDir = dirOf(th + jitter(4), phRoot + 20);
			const N = 5;
			const pts: THREE.Vector3[] = [];
			for (let k = 0; k < N; k++) {
				const t = k / (N - 1);
				const d = rootDir.clone().addScaledVector(flowDir, t).normalize();
				pts.push(shellPoint(d, 0.016 + Math.pow(t, 1.6) * 0.02, R, new THREE.Vector3()));
			}
			const last = pts[N - 1];
			const tipX = last.x * (pass === 0 ? 0.95 : 0.88);
			const tipY = (pass === 0 ? 0.08 : 0.185) + jitter(0.05);
			const tipZ = faceSurfaceZ(tipX, tipY, R) + 0.05;
			pts.push(new THREE.Vector3(tipX * 1.02, tipY + 0.09, tipZ - 0.016));
			pts.push(new THREE.Vector3(tipX, tipY + 0.03, tipZ - 0.004));
			pts.push(new THREE.Vector3(tipX, tipY, tipZ));
			geos.push(makeLockGeometry(pts, (pass === 0 ? 0.078 : 0.062) + jitter(0.012), 0.3, new THREE.Vector3(0, 0, 1), 12, 22));
		}
	}

	// ── 5) 鬓发：贴脸垂到下颌角，框住脸型 ──
	for (const s of [1, -1]) {
		const baseTh = s > 0 ? 8 : 172;
		for (let k = 0; k < 2; k++) {
			const th = baseTh + s * k * 12 + jitter(3);
			const P0 = onScalpDir(dirOf(th, 72 + k * 7), 0.014);
			const xEnd = s * (0.28 + k * 0.014);
			const pts = [
				P0,
				new THREE.Vector3(xEnd * 0.8, 0.02, 0.235),
				new THREE.Vector3(xEnd, -0.11 - k * 0.03, 0.2),
				new THREE.Vector3(xEnd * 1.02, -0.2 - k * 0.04, 0.17 + jitter(0.02)),
			];
			geos.push(makeLockGeometry(pts, 0.058, 0.4, new THREE.Vector3(1, 0, 0), 12, 22));
		}
	}

	// ── 6) 后颈：盖住发际的短发 ──
	for (let i = 0; i < 7; i++) {
		const th = 208 + (i / 6) * 144 + jitter(6);
		const hl = hairline(th);
		const P0 = onScalpDir(dirOf(th, Math.min(hl - 4, 122) + jitter(6)), 0.014);
		const outward = P0.clone().normalize();
		const dir = outward.clone().multiplyScalar(0.45).addScaledVector(DOWN, 0.65).normalize();
		const L = 0.12 + jitter(0.04);
		const pts = [P0, P0.clone().addScaledVector(dir, L * 0.4), P0.clone().addScaledVector(dir, L * 0.75), P0.clone().addScaledVector(dir, L)];
		geos.push(makeLockGeometry(pts, 0.082, 0.5, radialFlat(th), 12, 22));
	}

	const merged = mergeGeometries(geos, false);
	geos.forEach((g) => g.dispose());
	if (merged) {
		const locks = new THREE.Mesh(merged, material);
		locks.name = "hairLocks";
		group.add(locks);
		// 刻意不加描边：几十束叠在一起时，逐片描边会在内部织成黑线网（碎玻璃感）
	}

	// 发量壳：一整块连通的头发（自带发簇脊 + 扇贝形发际线），缝里露出来的是头发不是皮肤
	const cap = new THREE.Mesh(makeHairCapGeometry(R), material);
	cap.name = "hairCap";
	group.add(cap);

	return group;
}

interface HandParts {
	group: THREE.Group;
	fingers: THREE.Group[];
	thumb: THREE.Group;
}

/** 手掌 + 4 指 + 拇指；手指为 knuckle 分组，便于从指根弯曲做结印手势。 */
function makeHand(mat: THREE.Material, side: number): HandParts {
	const group = new THREE.Group();
	const palm = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.18, 0.065), mat);
	group.add(palm);
	const fingers: THREE.Group[] = [];
	for (let i = 0; i < 4; i++) {
		const knuckle = new THREE.Group();
		knuckle.position.set((i - 1.5) * 0.04, 0.088, 0);
		const f = new THREE.Mesh(new THREE.CapsuleGeometry(0.027, 0.072, 4, 8), mat);
		f.position.y = 0.062;
		knuckle.add(f);
		group.add(knuckle);
		fingers.push(knuckle);
	}
	const thumbPivot = new THREE.Group();
	thumbPivot.position.set(side * -0.074, -0.012, 0.016);
	const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, 0.065, 4, 8), mat);
	thumb.position.set(side * -0.028, 0.04, 0);
	thumbPivot.add(thumb);
	thumbPivot.rotation.z = side * 0.75;
	group.add(thumbPivot);
	return { group, fingers, thumb: thumbPivot };
}

function buildCharacter(cfg: CharacterConfig): BuiltCharacter {
	const group = new THREE.Group();
	group.name = "character";
	const gradient = sharedToonGradient();

	const skinMat = toonMat({ color: cfg.skinColor, gradient });
	const hairMat = toonMat({ color: cfg.hairColor, gradient });
	const uniformMat = toonMat({ color: cfg.uniformColor, gradient });
	const clothMat = toonMat({ color: cfg.uniformColor, gradient });
	// 眼白：受光材质。上一版是 toneMapped:false 的纯白 → 必然糊成发光灯泡
	const eyeWhiteMat = new THREE.MeshBasicMaterial({ color: 0xdbe5f4 });
	// 虹膜：canvas 径向渐变贴图（亮心 → 深边 + 放射肌理 + 瞳孔 + 双高光）
	const irisMat = new THREE.MeshBasicMaterial({ map: makeIrisTexture(cfg.eyeColor), transparent: true });
	// 上/下眼睑线
	const lashMat = new THREE.MeshBasicMaterial({ color: 0x161c2c });
	const browMat = new THREE.MeshBasicMaterial({ color: 0x9aa6bd });
	const mouthMat = new THREE.MeshBasicMaterial({ color: 0x8f6a66 });
	const noseShadowMat = new THREE.MeshBasicMaterial({ color: 0xd9b79b, transparent: true, opacity: 0.5 });

	const HEAD_R = 0.42;
	const HEAD_Y = 2.52;

	// ── 头部（含五官、头发），整体可微转出 3/4 侧 ──
	const headGroup = new THREE.Group();
	headGroup.position.set(0, HEAD_Y, 0);
	headGroup.rotation.y = -0.22;
	headGroup.rotation.x = 0.04;
	group.add(headGroup);

	const head = new THREE.Mesh(makeAnimeHeadGeometry(HEAD_R), skinMat);
	head.name = "head";
	headGroup.add(head);
	attachOutline(head, 0.014, 0x0b0d16);

	// 耳
	for (const s of [-1, 1]) {
		const ear = new THREE.Mesh(new THREE.SphereGeometry(0.068, 14, 12), skinMat);
		ear.position.set(s * 0.30, -0.02, -0.02);
		ear.scale.set(0.45, 1.15, 0.7);
		headGroup.add(ear);
	}

	// ── 六眼：动漫式杏仁眼 ──
	//    眼白受光（不是纯白灯泡）、虹膜用渐变贴图、上眼睑线压住眼白上缘。
	const EYE_X = 0.128;
	const EYE_Y = 0.0;
	const eyeZ = faceSurfaceZ(EYE_X, EYE_Y, HEAD_R) + 0.008;
	for (const s of [-1, 1]) {
		const eye = new THREE.Group();
		eye.position.set(s * EYE_X, EYE_Y, eyeZ);
		eye.rotation.y = s * 0.3; // 顺着颧骨曲面外旋，避免像贴纸

		// 眼白：浅蓝白，靠 ACES 压住高光
		const white = new THREE.Mesh(new THREE.SphereGeometry(0.074, 26, 18), eyeWhiteMat);
		white.scale.set(1, 0.72, 0.3);
		eye.add(white);

		// 虹膜：贴片（动漫眼睛本来就是平的），贴图自带瞳孔与双高光
		const iris = new THREE.Mesh(new THREE.CircleGeometry(0.046, 32), irisMat);
		iris.position.z = 0.021;
		iris.scale.set(1, 1.06, 1);
		eye.add(iris);

		// 上眼睑线：粗深弧，压住眼白上缘 —— 这一笔决定「像不像眼睛」
		const lash = new THREE.Mesh(new THREE.TorusGeometry(0.074, 0.0115, 8, 30, Math.PI), lashMat);
		lash.position.set(0, 0.001, 0.013);
		lash.rotation.z = Math.PI / 2;
		lash.scale.set(1, 0.74, 1);
		eye.add(lash);

		// 下眼睑线：细、浅，只占下半一小段
		const lashLow = new THREE.Mesh(new THREE.TorusGeometry(0.069, 0.0048, 6, 20, Math.PI * 0.66), lashMat);
		lashLow.position.set(0, 0.001, 0.013);
		lashLow.rotation.z = -Math.PI * 0.83;
		lashLow.scale.set(1, 0.74, 1);
		eye.add(lashLow);

		headGroup.add(eye);
	}

	// 眉（细、微挑，同样顺曲面外旋）
	for (const s of [-1, 1]) {
		const bx = 0.132;
		const by = 0.105;
		const brow = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.012, 0.011), browMat);
		brow.position.set(s * bx, by, faceSurfaceZ(bx, by, HEAD_R) + 0.005);
		brow.rotation.y = s * 0.3;
		brow.rotation.z = s * -0.18;
		headGroup.add(brow);
	}

	// 鼻（动漫式：只用一小片柔和阴影，不做实体凸起）
	const noseY = -0.055;
	const nose = new THREE.Mesh(new THREE.SphereGeometry(0.015, 10, 8), noseShadowMat);
	nose.position.set(0, noseY, faceSurfaceZ(0, noseY, HEAD_R) + 0.001);
	nose.scale.set(1, 1.5, 0.3);
	headGroup.add(nose);

	// 嘴（微抿上翘的细弧，不是小方块）
	const mouthY = -0.15;
	const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.032, 0.0055, 6, 22, Math.PI * 0.62), mouthMat);
	mouth.position.set(0, mouthY + 0.014, faceSurfaceZ(0, mouthY, HEAD_R) + 0.004);
	mouth.rotation.z = -Math.PI * 0.81;
	headGroup.add(mouth);

	// 眼罩（可选：缠上）
	if (cfg.blindfold) {
		const band = new THREE.Mesh(
			new THREE.TorusGeometry(HEAD_R * 0.99, 0.085, 12, 32),
			new THREE.MeshBasicMaterial({ color: 0x10121a }),
		);
		band.rotation.x = Math.PI / 2;
		band.position.y = 0.045;
		headGroup.add(band);
	}

	// 头发
	const hairGroup = makeGojoHair(hairMat, HEAD_R);
	headGroup.add(hairGroup);

	// ── 颈 / 高领（五条悟标志立领）──
	const neck = new THREE.Mesh(new THREE.CylinderGeometry(0.125, 0.155, 0.26, 18), skinMat);
	neck.position.set(0, HEAD_Y - 0.46, 0);
	group.add(neck);
	// 立领必须是 DoubleSide：openEnded 圆柱从上方会看到被剔除的内壁 → 一个黑洞
	const collarMat = toonMat({ color: cfg.uniformColor, gradient });
	collarMat.side = THREE.DoubleSide;
	const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.235, 0.2, 0.34, 24, 1, true), collarMat);
	collar.position.set(0, HEAD_Y - 0.52, 0);
	group.add(collar);
	attachOutline(collar, 0.014, 0x080a12);

	// ── 躯干：胯 → 收腰 → 胸 → 斜方肌（车削剖面）。
	//    上一版半径给到 0.6（胸口 1.2 宽）→ 躯干成了花瓶。
	//    正确做法：躯干收窄到 ~0.44，宽度交给肩膀去撑。
	const torsoProfile: THREE.Vector2[] = [
		new THREE.Vector2(0.001, 0),
		new THREE.Vector2(0.29, 0.03),
		new THREE.Vector2(0.32, 0.16),
		new THREE.Vector2(0.3, 0.34),
		new THREE.Vector2(0.285, 0.5),
		new THREE.Vector2(0.33, 0.68),
		new THREE.Vector2(0.4, 0.86),
		new THREE.Vector2(0.44, 1.0),
		new THREE.Vector2(0.44, 1.08),
		new THREE.Vector2(0.4, 1.14),
		new THREE.Vector2(0.3, 1.19),
		new THREE.Vector2(0.16, 1.21),
		new THREE.Vector2(0.001, 1.22),
	];
	const torsoGeo = new THREE.LatheGeometry(torsoProfile, 32);
	const torso = new THREE.Mesh(torsoGeo, uniformMat);
	torso.position.set(0, 0.72, 0);
	torso.scale.set(1, 1, 0.7);
	group.add(torso);
	attachOutline(torso, 0.018, 0x080a12);

	// V 形衣襟 + 扣
	for (const s of [-1, 1]) {
		const lapel = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.52, 0.03), clothMat);
		lapel.position.set(s * 0.1, 1.46, 0.245);
		lapel.rotation.z = s * 0.24;
		group.add(lapel);
	}
	for (let i = 0; i < 3; i++) {
		const btn = new THREE.Mesh(
			new THREE.SphereGeometry(0.022, 10, 8),
			new THREE.MeshBasicMaterial({ color: 0xc9a24a }),
		);
		btn.position.set(0, 1.2 - i * 0.2, 0.215);
		group.add(btn);
	}

	// ── 肩：扁球，与躯干顶部自然衔接（不是两颗球）──
	for (const s of [-1, 1]) {
		const sh = new THREE.Mesh(new THREE.SphereGeometry(0.21, 20, 16), uniformMat);
		sh.position.set(s * 0.44, 1.72, 0);
		sh.scale.set(1, 0.8, 0.82);
		group.add(sh);
	}

	// ── 手臂（锥形收细）──
	const buildArm = (side: number): { arm: THREE.Group; fore: THREE.Group; hand: HandParts } => {
		const arm = new THREE.Group();
		arm.position.set(side * 0.44, 1.72, 0);
		const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.155, 0.12, 0.48, 14), uniformMat);
		upper.position.y = -0.25;
		arm.add(upper);
		const fore = new THREE.Group();
		fore.position.y = -0.49;
		arm.add(fore);
		const foreMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.088, 0.44, 14), uniformMat);
		foreMesh.position.y = -0.22;
		fore.add(foreMesh);
		const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.098, 0.098, 0.07, 14), clothMat);
		cuff.position.y = -0.42;
		fore.add(cuff);
		const hand = makeHand(skinMat, side);
		hand.group.position.y = -0.52;
		fore.add(hand.group);
		group.add(arm);
		return { arm, fore, hand };
	};
	const left = buildArm(-1);
	const right = buildArm(1);

	// ── 腿（锥形收细）──
	const buildLeg = (side: number): void => {
		const leg = new THREE.Group();
		leg.position.set(side * 0.19, 0.74, 0);
		const thigh = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.15, 0.56, 14), clothMat);
		thigh.position.y = -0.28;
		leg.add(thigh);
		const shin = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.105, 0.58, 14), clothMat);
		shin.position.y = -0.85;
		leg.add(shin);
		const shoe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.11, 0.38), clothMat);
		shoe.position.set(0, -1.19, 0.09);
		leg.add(shoe);
		group.add(leg);
	};
	buildLeg(-1);
	buildLeg(1);

	// ── 姿势：默认站姿双臂自然微外展（绝不挡脸），施法时才抬右手结印 ──
	const BASE = { lArmZ: 0.3, lArmX: 0.05, lForeZ: 0.14, lForeX: 0.34, rArmZ: -0.36, rArmX: 0.04, rForeZ: -0.16, rForeX: 0.46 };
	// 结印：手抬到脸侧偏外，掌心朝前 —— 手在脸旁边而不是脸前面
	const SIGN = { rArmZ: -2.92, rArmX: -0.18, rForeZ: 0.34, rForeX: 0.3 };
	const pose = (t: number): void => {
		left.arm.rotation.z = BASE.lArmZ;
		left.arm.rotation.x = BASE.lArmX;
		left.fore.rotation.z = BASE.lForeZ;
		left.fore.rotation.x = BASE.lForeX;
		right.arm.rotation.z = BASE.rArmZ + (SIGN.rArmZ - BASE.rArmZ) * t;
		right.arm.rotation.x = BASE.rArmX + (SIGN.rArmX - BASE.rArmX) * t;
		right.fore.rotation.z = BASE.rForeZ + (SIGN.rForeZ - BASE.rForeZ) * t;
		right.fore.rotation.x = BASE.rForeX + (SIGN.rForeX - BASE.rForeX) * t;
	};
	pose(0);
	// 左手放松；右手食指+中指并拢（五条悟标志手型）
left.hand.fingers.forEach((f) => {
		f.rotation.x = 0.42;
	});
	left.hand.thumb.rotation.x = 0.4;
	right.hand.fingers[0].rotation.x = 0.05;
	right.hand.fingers[1].rotation.x = 0.02;
	right.hand.fingers[2].rotation.x = 1.5;
	right.hand.fingers[3].rotation.x = 1.65;
	right.hand.thumb.rotation.x = 0.95;
	right.hand.group.rotation.z = -0.35;

	// 重心偏移：胯微倾、肩反向微倾
	group.rotation.z = 0.018;

	return { group, hairGroup, headGroup, arms: { left, right, pose } };
}

// ─────────────────────────────────────────────────────────────
// GPU 着色器粒子：位置全在 vertex shader 算，CPU 每帧零循环
// ─────────────────────────────────────────────────────────────
const PARTICLE_VERT = /* glsl */ `
	attribute vec3 aOrigin;
	attribute vec3 aVel;
	attribute vec3 aColor;
	attribute float aBirth;
	attribute float aMode;
	attribute float aSeed;
	uniform float uTime;
	uniform float uSize;
	varying float vAlpha;
	varying vec3 vColor;

	void main() {
		float life = 1.5;
		float age = uTime - aBirth;
		float t = age / life;

		vColor = aColor;
		vAlpha = 0.0;

		if (aBirth < 0.0 || t < 0.0 || t > 1.0) {
			gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
			gl_PointSize = 0.0;
			return;
		}

		vec3 dir = normalize(aVel);
		vec3 p;

		if (aMode < 0.5) {
			// 蒼：收敛 —— 由外向内坍缩并旋进
			float r = 1.5 * pow(1.0 - t, 1.35);
			float ang = t * 4.2 + aSeed * 6.2831;
			float cs = cos(ang), sn = sin(ang);
			vec3 d = vec3(dir.x * cs - dir.z * sn, dir.y, dir.x * sn + dir.z * cs);
			p = aOrigin + d * r;
		} else if (aMode < 1.5) {
			// 赫：发散 —— 向外爆开 + 扰动
			float speed = 1.7 + aSeed * 1.5;
			p = aOrigin + dir * age * speed;
			p.y += sin(aSeed * 6.2831 + t * 7.0) * 0.12 * t;
			p.x += cos(aSeed * 12.0 + t * 5.0) * 0.07 * t;
		} else {
			// 茈：融合 —— 先收敛再爆散
			if (t < 0.38) {
				float tt = t / 0.38;
				float r = 1.8 * pow(1.0 - tt, 1.25);
				float ang = tt * 5.6 + aSeed * 6.2831;
				float cs = cos(ang), sn = sin(ang);
				vec3 d = vec3(dir.x * cs - dir.z * sn, dir.y, dir.x * sn + dir.z * cs);
				p = aOrigin + d * r;
			} else {
				float tt = (t - 0.38) / 0.62;
				p = aOrigin + dir * tt * 2.6;
				p.y += sin(aSeed * 6.2831) * tt * 0.35;
			}
		}

		vec4 mv = modelViewMatrix * vec4(p, 1.0);
		gl_Position = projectionMatrix * mv;
		gl_PointSize = uSize * (330.0 / max(-mv.z, 0.001)) * (1.0 - t * 0.3);
		vAlpha = sin(t * 3.14159);
	}
`;

const PARTICLE_FRAG = /* glsl */ `
	precision highp float;
	varying float vAlpha;
	varying vec3 vColor;

	void main() {
		vec2 c = gl_PointCoord - vec2(0.5);
		float d = length(c);
		if (d > 0.5) discard;
		float soft = 1.0 - smoothstep(0.0, 0.5, d);
		float glow = pow(soft, 1.5);
		vec3 col = vColor * (0.55 + glow * 1.9);
		gl_FragColor = vec4(col, vAlpha * glow * 0.95);
	}
`;

// ─────────────────────────────────────────────────────────────
// 术式特效：核心光球（蓄力→闪爆）+ 冲击波球壳 + GPU 粒子
//   蒼 = 由外向内坍缩；赫 = 向外爆开；茈 = 先坍缩后爆散
// ─────────────────────────────────────────────────────────────
const ORB_VERT = /* glsl */ `
	varying vec3 vN;
	varying vec3 vP;
	void main() {
		vN = normalize(normalMatrix * normal);
		vec4 mv = modelViewMatrix * vec4(position, 1.0);
		vP = mv.xyz;
		gl_Position = projectionMatrix * mv;
	}
`;

const ORB_FRAG = /* glsl */ `
	precision highp float;
	uniform vec3 uColor;
	uniform float uPower;
	varying vec3 vN;
	varying vec3 vP;
	void main() {
		float f = 1.0 - abs(dot(normalize(vN), normalize(-vP)));
		f = pow(clamp(f, 0.0, 1.0), 2.0);
		vec3 col = uColor * (0.4 + f * 1.5);
		gl_FragColor = vec4(col * uPower, (0.1 + f * 0.6) * uPower);
	}
`;

class SkillFX {
	private geo: THREE.BufferGeometry;
	private points: THREE.Points;
	private mat: THREE.ShaderMaterial;
	private count: number;
	private cursor = 0;
	private aOrigin: Float32Array;
	private aVel: Float32Array;
	private aColor: Float32Array;
	private aBirth: Float32Array;
	private aMode: Float32Array;
	private aSeed: Float32Array;

	// 核心光球 / 冲击波
	private orb: THREE.Mesh;
	private orbMat: THREE.ShaderMaterial;
	private shock: THREE.Mesh;
	private shockMat: THREE.MeshBasicMaterial;
	private anchor: THREE.Object3D | null = null;
	private start = -99;
	private dur = 1.55;
	private tmp = new THREE.Vector3();

	constructor(
		private scene: THREE.Scene,
		private camera: THREE.Camera,
		maxParticles: number,
		size: number,
	) {
		this.count = maxParticles;
		this.aOrigin = new Float32Array(maxParticles * 3);
		this.aVel = new Float32Array(maxParticles * 3);
		this.aColor = new Float32Array(maxParticles * 3);
		this.aBirth = new Float32Array(maxParticles);
		this.aMode = new Float32Array(maxParticles);
		this.aSeed = new Float32Array(maxParticles);
		this.aBirth.fill(-1);

		this.geo = new THREE.BufferGeometry();
		this.geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(maxParticles * 3), 3));
		this.geo.setAttribute("aOrigin", new THREE.BufferAttribute(this.aOrigin, 3));
		this.geo.setAttribute("aVel", new THREE.BufferAttribute(this.aVel, 3));
		this.geo.setAttribute("aColor", new THREE.BufferAttribute(this.aColor, 3));
		this.geo.setAttribute("aBirth", new THREE.BufferAttribute(this.aBirth, 1));
		this.geo.setAttribute("aMode", new THREE.BufferAttribute(this.aMode, 1));
		this.geo.setAttribute("aSeed", new THREE.BufferAttribute(this.aSeed, 1));

		this.mat = new THREE.ShaderMaterial({
			uniforms: { uTime: { value: 0 }, uSize: { value: size } },
			vertexShader: PARTICLE_VERT,
			fragmentShader: PARTICLE_FRAG,
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		});
		this.points = new THREE.Points(this.geo, this.mat);
		this.points.frustumCulled = false;
		this.points.renderOrder = 2;
		this.scene.add(this.points);

		// 核心光球：fresnel 边缘发光 + 加色混合，保证被 Bloom 吃到
		this.orbMat = new THREE.ShaderMaterial({
			uniforms: { uColor: { value: new THREE.Color(0xffffff) }, uPower: { value: 0 } },
			vertexShader: ORB_VERT,
			fragmentShader: ORB_FRAG,
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		});
		this.orb = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 24), this.orbMat);
		this.orb.frustumCulled = false;
		this.orb.renderOrder = 3;
		this.orb.visible = false;
		this.scene.add(this.orb);

		// 冲击环：必须用「面向相机的平面」。
		// 上一版用球壳，半径涨到 3.4 时把相机包在里面 → 全是掠射角 → 整屏糊白。
		this.shockMat = new THREE.MeshBasicMaterial({
			map: makeRingTexture(),
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide,
			opacity: 0,
		});
		this.shock = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.shockMat);
		this.shock.frustumCulled = false;
		this.shock.renderOrder = 3;
		this.shock.visible = false;
		this.scene.add(this.shock);
	}

	/** 术式挂在右手上 → 光球永远跟着手走 */
	setAnchor(o: THREE.Object3D | null): void {
		this.anchor = o;
	}

	/** mode: 0=收敛(蒼) 1=发散(赫) 2=融合(茈) */
	burst(origin: THREE.Vector3, color: number, n: number, mode: number, now: number): void {
		const c = new THREE.Color(color);
		for (let k = 0; k < n; k++) {
			const i = this.cursor;
			this.cursor = (this.cursor + 1) % this.count;
			const dx = Math.random() * 2 - 1;
			const dy = Math.random() * 2 - 1;
			const dz = Math.random() * 2 - 1;
			const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
			this.aOrigin[i * 3] = origin.x;
			this.aOrigin[i * 3 + 1] = origin.y;
			this.aOrigin[i * 3 + 2] = origin.z;
			this.aVel[i * 3] = dx / len;
			this.aVel[i * 3 + 1] = dy / len;
			this.aVel[i * 3 + 2] = dz / len;
			this.aColor[i * 3] = c.r;
			this.aColor[i * 3 + 1] = c.g;
			this.aColor[i * 3 + 2] = c.b;
			this.aBirth[i] = now;
			this.aMode[i] = mode;
			this.aSeed[i] = Math.random();
		}
		this.geo.attributes.aOrigin.needsUpdate = true;
		this.geo.attributes.aVel.needsUpdate = true;
		this.geo.attributes.aColor.needsUpdate = true;
		this.geo.attributes.aBirth.needsUpdate = true;
		this.geo.attributes.aMode.needsUpdate = true;
		this.geo.attributes.aSeed.needsUpdate = true;
	}

	/** 起手：核心球 + 冲击波 + 粒子一起进入时间线 */
	fire(color: number, n: number, mode: number, now: number): void {
		this.start = now;
		const col = new THREE.Color(color);
		this.orbMat.uniforms.uColor.value.copy(col);
		this.shockMat.color.copy(col);
		if (this.anchor) this.anchor.getWorldPosition(this.tmp);
		this.burst(this.tmp, color, n, mode, now);
	}

	update(t: number): void {
		this.mat.uniforms.uTime.value = t;
		const age = t - this.start;
		const k = age / this.dur;
		if (this.anchor) this.anchor.getWorldPosition(this.tmp);
		const p = this.tmp;

		// ── 核心光球：蓄力鼓起 → 闪爆 → 消散 ──
		let orbS = 0;
		let orbP = 0;
		if (age >= 0 && k < 1) {
			if (k < 0.4) {
				const q = k / 0.4;
				orbS = 0.05 + 0.19 * Math.pow(q, 0.65);
				orbP = 0.5 + 0.5 * q;
			} else if (k < 0.55) {
				const q = (k - 0.4) / 0.15;
				orbS = 0.22 + 0.14 * q;
				orbP = 1 + 0.5 * q;
			} else {
				const q = (k - 0.55) / 0.45;
				orbS = 0.36 * (1 - q) + 0.04;
				orbP = 1.5 * Math.pow(1 - q, 1.4);
			}
		}
		this.orb.visible = orbP > 0.02;
		this.orb.position.copy(p);
		this.orb.scale.setScalar(Math.max(0.001, orbS));
		this.orbMat.uniforms.uPower.value = orbP;

		// ── 冲击环：闪爆瞬间向外扩张（面向相机）──
		let shS = 0;
		let shP = 0;
		if (age >= 0 && k > 0.4 && k < 1) {
			const q = (k - 0.4) / 0.6;
			shS = 0.15 + 1.9 * Math.pow(q, 0.5);
			shP = Math.pow(1 - q, 1.6) * 0.85;
		}
		this.shock.visible = shP > 0.02;
		this.shock.position.copy(p);
		this.shock.quaternion.copy(this.camera.quaternion);
		this.shock.scale.set(shS, shS, shS);
		this.shockMat.opacity = shP;
	}

	dispose(): void {
		this.scene.remove(this.points);
		this.scene.remove(this.orb);
		this.scene.remove(this.shock);
		this.geo.dispose();
		this.mat.dispose();
		this.orb.geometry.dispose();
		this.orbMat.dispose();
		this.shock.geometry.dispose();
		this.shockMat.dispose();
	}
}

export function mountHero3D(layer: HTMLElement): Hero3DController {
	const canvas = layer.querySelector("#hero-3d-canvas") as HTMLCanvasElement | null;
	const fallback = layer.querySelector("#hero-3d-fallback") as HTMLImageElement | null;
	const toast = layer.querySelector("#hero-3d-toast") as HTMLElement | null;
	if (!canvas) throw new Error("[hero3d] canvas missing");

	const quality = detectQuality();
	const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	let W = layer.clientWidth || window.innerWidth;
	let H = layer.clientHeight || window.innerHeight;

	const renderer = new THREE.WebGLRenderer({
		canvas,
		antialias: quality.antialias,
		alpha: false,
		powerPreference: "high-performance",
	});
	renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality.pixelRatio));
	renderer.setSize(W, H, false);
	renderer.setClearColor(0x05060b, 1);
	renderer.toneMapping = THREE.ACESFilmicToneMapping;
	renderer.toneMappingExposure = 0.88;
	renderer.outputColorSpace = THREE.SRGBColorSpace;

	const scene = new THREE.Scene();
	// 上本身构图：略低机位 + 略仰视（更有压迫感），角色偏右给左侧标题留空间
	const camera = new THREE.PerspectiveCamera(44, W / H, 0.1, 100);
	const camBase = new THREE.Vector3(0, 1.92, 3.8);
	const camTarget = new THREE.Vector3(0, 2.22, 0);
	camera.position.copy(camBase);
	camera.lookAt(camTarget);

	const pmrem = new THREE.PMREMGenerator(renderer);
	const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
	scene.environment = envRT.texture;
	// 赛璐璐风格：环境光贡献压到很低，明暗交给 toon 渐变贴图 + 平行光
	scene.environmentIntensity = 0.14;

	// 卡通布光：主光 + 冷色轮廓光（toon 材质靠这两档拉开明暗）
	const key = new THREE.DirectionalLight(0xffffff, 1.6);
	key.position.set(1.5, 5.5, 5.2);
	scene.add(key);
	const rim = new THREE.DirectionalLight(0x7fb2ff, 0.8);
	rim.position.set(-4, 2.4, -3.5);
	scene.add(rim);
	const rimB = new THREE.PointLight(0xff7bb0, 6, 26);
	rimB.position.set(3.2, 0.6, -2.2);
	scene.add(rimB);
	scene.add(new THREE.AmbientLight(0xffffff, 0.22));
	const skillLight = new THREE.PointLight(0x5b9dff, 0, 30);
	skillLight.position.set(0, 1.6, 2.2);
	scene.add(skillLight);

	let current: BuiltCharacter | null = null;
	let currentIndex = 0;

	function updateLabel(): void {
		const cfg = CHARACTERS[currentIndex];
		const nameEl = layer.querySelector("#hero-char-name");
		if (nameEl) nameEl.textContent = cfg.name;
		const titleEl = layer.querySelector("#hero-char-title");
		if (titleEl) titleEl.textContent = cfg.title;
		layer.querySelectorAll("[data-char]").forEach((b) => {
			b.classList.toggle("active", b.getAttribute("data-char") === String(currentIndex));
		});
	}

	function buildAndAdd(i: number): void {
		if (current) {
			scene.remove(current.group);
			disposeObj(current.group);
		}
		current = buildCharacter(CHARACTERS[i]);
		currentIndex = i;
		// 三分法：首页标题居中，角色必须整体让到右侧，不能压字
		const mobile = window.innerWidth < 820;
		current.group.position.x = mobile ? 0.1 : 1.34;
		current.group.scale.setScalar(mobile ? 1 : 0.95);
		scene.add(current.group);
		rim.color.setHex(CHARACTERS[i].auraColor);
		updateLabel();
	}

	buildAndAdd(0);

	const fx = new SkillFX(scene, camera, quality.particles, 0.12);

	// ── 后处理链：RenderPass → 扭曲/色差 → Bloom → Output ──
	const composer = new EffectComposer(renderer);
	composer.addPass(new RenderPass(scene, camera));
	const fxPass = makeSkillFXPass();
	fxPass.enabled = quality.distortion;
	composer.addPass(fxPass);
	const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), quality.bloom, 0.45, 0.92);
	composer.addPass(bloom);
	composer.addPass(new OutputPass());
	composer.setSize(W, H);
	composer.setPixelRatio(renderer.getPixelRatio());

	// 交互：拖拽旋转 + 点击弹台词
	const ray = new THREE.Raycaster();
	const ndc = new THREE.Vector2();
	let userYaw = 0;
	let userPitch = 0;
	let autoYaw = 0;
	let dragging = false;
	let lastX = 0;
	let lastY = 0;
	let moved = 0;
	let autoRotate = !reduced;
	const clickOrigin = new THREE.Vector3();

	function onDown(e: PointerEvent): void {
		dragging = true;
		moved = 0;
		lastX = e.clientX;
		lastY = e.clientY;
	}
	function onMove(e: PointerEvent): void {
		if (!dragging) return;
		const dx = e.clientX - lastX;
		const dy = e.clientY - lastY;
		lastX = e.clientX;
		lastY = e.clientY;
		moved += Math.abs(dx) + Math.abs(dy);
		userYaw += dx * 0.006;
		userPitch = Math.max(-0.5, Math.min(0.5, userPitch + dy * 0.004));
	}
	function onUp(e: PointerEvent): void {
		if (!dragging) return;
		dragging = false;
		if (moved < 6 && current) {
			const rect = canvas!.getBoundingClientRect();
			ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
			ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
			ray.setFromCamera(ndc, camera);
			const hit = ray.intersectObject(current.group, true);
			if (hit.length > 0) {
				sayLine();
				current.arms.right.hand.group.getWorldPosition(clickOrigin);
				fx.burst(clickOrigin, CHARACTERS[currentIndex].accentColor, 90, 1, clock.elapsedTime);
			}
		}
	}
	canvas.addEventListener("pointerdown", onDown);
	canvas.addEventListener("pointermove", onMove);
	window.addEventListener("pointerup", onUp);

	// 施放：uWave / Bloom 脉冲 / 震屏
	let wave = 0;
	let shake = 0;
	let skillLightBoost = 0;
	let signT = 0; // 结印姿势混合权重（0=站姿，1=抬手结印）
	function castSkill(key: string): void {
		const s = SKILLS.find((k) => k.key === key);
		if (!s) return;
		const mode = key === "blue" ? 0 : key === "red" ? 1 : 2;
		const n = key === "purple" ? Math.floor(quality.particles * 0.6) : Math.floor(quality.particles * 0.4);
		// 光球挂在右手上 → 抬臂结印时特效跟着手走
		fx.setAnchor(current ? current.arms.right.hand.group : null);
		fx.fire(s.color, n, mode, clock.elapsedTime);
		skillLight.color.setHex(s.color);
		skillLight.position.set(1.9, 2.0, 0.5);
		skillLightBoost = key === "purple" ? 7 : 5;
		wave = key === "purple" ? 1 : key === "red" ? 0.85 : 0.68;
		shake = key === "purple" ? 1 : key === "red" ? 0.75 : 0.5;
		signT = 1;
		fxPass.uniforms.uWave.value = wave;
	}

	let toastTimer = 0;
	function sayLine(): void {
		if (!toast || !current) return;
		const lines = CHARACTERS[currentIndex].lines;
		const ln = lines[Math.floor(Math.random() * lines.length)];
		toast.innerHTML =
			'<div class="hero-toast-main">' + ln.main + "</div>" + (ln.sub ? '<div class="hero-toast-sub">' + ln.sub + "</div>" : "");
		toast.classList.add("show");
		clearTimeout(toastTimer);
		toastTimer = window.setTimeout(() => toast.classList.remove("show"), 2600);
	}

	const clock = new THREE.Clock();
	let raf = 0;
	let disposed = false;

	function animate(): void {
		if (disposed) return;
		raf = requestAnimationFrame(animate);
		const dt = Math.min(clock.getDelta(), 0.05);
		const t = clock.elapsedTime;

		if (current) {
			current.group.position.y = Math.sin(t * 1.15) * 0.035;
			current.group.rotation.y = autoYaw + userYaw;
			current.group.rotation.x = userPitch;
			current.headGroup.rotation.y = -0.22 + Math.sin(t * 0.55) * 0.06;
			current.hairGroup.rotation.z = Math.sin(t * 0.85) * 0.035;
			current.hairGroup.rotation.x = Math.sin(t * 0.65) * 0.022;
		}
		// 自动「摆动」而不是整圈自转：整圈会长时间只看到后脑，体验很差
		if (autoRotate && !dragging) autoYaw = Math.sin(t * 0.32) * 0.55;

		// 特效衰减
		if (skillLightBoost > 0) {
			skillLight.intensity = skillLightBoost;
			skillLightBoost = Math.max(0, skillLightBoost - dt * 16);
		} else {
			skillLight.intensity = 0;
		}
		if (wave > 0) {
			wave = Math.max(0, wave - dt * 1.5);
			fxPass.uniforms.uWave.value = wave;
		}
		fxPass.uniforms.uTime.value = t;
		// Bloom 脉冲
		bloom.strength = quality.bloom + wave * 0.5;
		// 结印：抬臂（缓出）→ 保持 → 落臂，总时长 1.6s
		if (signT > 0) {
			signT = Math.max(0, signT - dt / 1.6);
			const p = 1 - signT; // 0 → 1
			let st: number;
			if (p < 0.22) {
				const k = p / 0.22;
				st = 1 - Math.pow(1 - k, 3); // easeOutCubic 抬起
			} else if (p < 0.62) {
				st = 1;
			} else {
				const k = (p - 0.62) / 0.38;
				st = 1 - k * k; // 落下
			}
			current?.arms.pose(Math.max(0, Math.min(1, st)));
		}
		// 震屏
		if (shake > 0) {
			shake = Math.max(0, shake - dt * 2.4);
			const s = shake * shake * 0.09;
			camera.position.set(
				camBase.x + (Math.random() - 0.5) * s,
				camBase.y + (Math.random() - 0.5) * s,
				camBase.z + (Math.random() - 0.5) * s * 0.5,
			);
			camera.lookAt(camTarget);
		} else if (camera.position.distanceToSquared(camBase) > 1e-8) {
			camera.position.copy(camBase);
			camera.lookAt(camTarget);
		}

		fx.update(t);
		composer.render();
	}
	animate();

	const ro = new ResizeObserver(() => {
		W = layer.clientWidth || window.innerWidth;
		H = layer.clientHeight || window.innerHeight;
		renderer.setSize(W, H, false);
		composer.setSize(W, H);
		camera.aspect = W / H;
		camera.updateProjectionMatrix();
		if (current) {
			const mobile = window.innerWidth < 820;
			current.group.position.x = mobile ? 0.1 : 1.34;
			current.group.scale.setScalar(mobile ? 1 : 0.95);
		}
	});
	ro.observe(layer);

	if (fallback) fallback.style.display = "none";

	function destroy(): void {
		if (disposed) return;
		disposed = true;
		cancelAnimationFrame(raf);
		ro.disconnect();
		canvas!.removeEventListener("pointerdown", onDown);
		canvas!.removeEventListener("pointermove", onMove);
		window.removeEventListener("pointerup", onUp);
		if (current) {
			scene.remove(current.group);
			disposeObj(current.group);
			current = null;
		}
		fx.dispose();
		scene.traverse((o) => {
			const m = o as THREE.Mesh;
			if (m.geometry) m.geometry.dispose();
		});
		envRT.texture.dispose();
		pmrem.dispose();
		composer.dispose();
		renderer.dispose();
		renderer.forceContextLoss();
		if (fallback) fallback.style.display = "block";
	}

	return {
		destroy,
		castSkill,
		switchCharacter(i: number) {
			if (i < 0 || i >= CHARACTERS.length) return;
			buildAndAdd(i);
		},
		setAutoRotate(on: boolean) {
			autoRotate = on;
		},
		// 仅调试用：?heroDebug=1 时挂到 window，方便旋转/缩放/查看各部位
		_debug: (() => {
			if (typeof window === "undefined") return null;
			if (new URLSearchParams(location.search).get("heroDebug") !== "1") return null;
			const w = window as unknown as Record<string, unknown>;
			w.__hero = {
				scene,
				camera,
				renderer,
				composer,
				setCamBase: (x: number, y: number, z: number) => {
					camBase.set(x, y, z);
					camera.position.copy(camBase);
				},
				setLookAt: (x: number, y: number, z: number) => {
					camTarget.set(x, y, z);
					camera.lookAt(camTarget);
				},
				setCharRotation: (y: number) => {
					if (current) current.group.rotation.y = y;
				},
				get current() {
					return current;
				},
			};
			return w.__hero;
		})(),
	};
}
