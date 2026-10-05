/**
 * hero-character-scene.ts — 首页全屏 3D 角色场景引擎（真实 VRM 角色 + 咒力 VFX）
 *
 * 角色来源：**真实 VRM 模型**，由 @pixiv/three-vrm（Pixiv 官方，MIT）加载，
 * MToon 赛璐璐材质由 loader 自动装配。
 *
 * 为什么不用程序图元拼角色：
 *   动漫角色的辨识度来自「头发分组轮廓 + 面部拓扑」，那是成千上万个手摆控制点，
 *   球/管/旋转体拼不出这个形状语言。想拿到动漫质感，唯一的路是加载真实模型。
 *
 * 换角色 = 把 .vrm 丢进 public/models/vrm/，改 hero-content.ts 里的 vrm 路径即可。
 *
 * 由 WallpaperSection 的客户端脚本动态 import（代码分割，three 不进普通页面包）。
 * mountHero3D(layer) 返回控制器：
 *   - destroy()          严格 dispose 全部 GPU 资源 + forceContextLoss
 *   - castSkill(key)     蒼（收敛）/ 赫（发散）/ 茈（融合）+ 扭曲/色差/震屏/Bloom 脉冲
 *   - switchCharacter(i) 切换角色
 *   - setAutoRotate(on)
 *
 * 交互：拖拽旋转、闲置呼吸/头部微摆、点击弹台词 + 咒力火花、鼠标视线跟随。
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { VRMLoaderPlugin, VRMUtils, type VRM } from "@pixiv/three-vrm";
import { CHARACTERS, SKILLS } from "./hero-content";
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

/** 归一化骨骼名（从 three-vrm 的签名里取，避免手写联合类型） */
type BoneName = Parameters<VRM["humanoid"]["getNormalizedBoneNode"]>[0];

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

function smoothstep(edge0: number, edge1: number, x: number): number {
	const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
	return t * t * (3 - 2 * t);
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

		// 半径按「近景镜头」标定：相机距角色约 1.7 单位，可见高度约 1 单位。
		// 旧值（1.5/1.8/2.6）是给 z≈3.8 的远景调的，直接搬过来会糊满整屏。
		if (aMode < 0.5) {
			// 蒼：收敛 —— 由外向内坍缩并旋进
			float r = 0.55 * pow(1.0 - t, 1.35);
			float ang = t * 4.2 + aSeed * 6.2831;
			float cs = cos(ang), sn = sin(ang);
			vec3 d = vec3(dir.x * cs - dir.z * sn, dir.y, dir.x * sn + dir.z * cs);
			p = aOrigin + d * r;
		} else if (aMode < 1.5) {
			// 赫：发散 —— 向外爆开 + 扰动
			float speed = 0.62 + aSeed * 0.55;
			p = aOrigin + dir * age * speed;
			p.y += sin(aSeed * 6.2831 + t * 7.0) * 0.05 * t;
			p.x += cos(aSeed * 12.0 + t * 5.0) * 0.03 * t;
		} else {
			// 茈：融合 —— 先收敛再爆散
			if (t < 0.38) {
				float tt = t / 0.38;
				float r = 0.62 * pow(1.0 - tt, 1.25);
				float ang = tt * 5.6 + aSeed * 6.2831;
				float cs = cos(ang), sn = sin(ang);
				vec3 d = vec3(dir.x * cs - dir.z * sn, dir.y, dir.x * sn + dir.z * cs);
				p = aOrigin + d * r;
			} else {
				float tt = (t - 0.38) / 0.62;
				p = aOrigin + dir * tt * 0.9;
				p.y += sin(aSeed * 6.2831) * tt * 0.12;
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
// 术式特效：核心光球（蓄力→闪爆）+ 面向相机的冲击环 + GPU 粒子
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
		// 球壳在半径涨大时会把相机包在里面 → 全是掠射角 → 整屏糊白。
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
				orbS = 0.02 + 0.075 * Math.pow(q, 0.65);
				orbP = 0.5 + 0.5 * q;
			} else if (k < 0.55) {
				const q = (k - 0.4) / 0.15;
				orbS = 0.095 + 0.055 * q;
				orbP = 1 + 0.5 * q;
			} else {
				const q = (k - 0.55) / 0.45;
				orbS = 0.15 * (1 - q) + 0.02;
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
			shS = 0.06 + 0.62 * Math.pow(q, 0.5);
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

// ─────────────────────────────────────────────────────────────
// 环境微粒：常驻的咒力尘埃（苍蓝），给场景加纵深
// ─────────────────────────────────────────────────────────────
const MOTE_VERT = /* glsl */ `
	attribute float aSeed;
	uniform float uTime;
	uniform float uSize;
	varying float vA;
	void main() {
		vec3 p = position;
		p.y += sin(uTime * 0.35 + aSeed * 6.2831) * 0.28;
		p.x += cos(uTime * 0.22 + aSeed * 9.42) * 0.18;
		p.z += sin(uTime * 0.18 + aSeed * 3.14) * 0.14;
		vec4 mv = modelViewMatrix * vec4(p, 1.0);
		gl_Position = projectionMatrix * mv;
		gl_PointSize = uSize * (260.0 / max(-mv.z, 0.001));
		vA = 0.35 + 0.65 * (0.5 + 0.5 * sin(uTime * 1.4 + aSeed * 12.0));
	}
`;

const MOTE_FRAG = /* glsl */ `
	precision highp float;
	uniform vec3 uColor;
	varying float vA;
	void main() {
		vec2 c = gl_PointCoord - vec2(0.5);
		float d = length(c);
		if (d > 0.5) discard;
		float g = pow(1.0 - smoothstep(0.0, 0.5, d), 1.8);
		gl_FragColor = vec4(uColor * (0.6 + g * 1.6), vA * g * 0.55);
	}
`;

class AmbientMotes {
	private points: THREE.Points;
	private mat: THREE.ShaderMaterial;
	constructor(
		private scene: THREE.Scene,
		count: number,
	) {
		const pos = new Float32Array(count * 3);
		const seed = new Float32Array(count);
		for (let i = 0; i < count; i++) {
			pos[i * 3] = (Math.random() - 0.5) * 7;
			pos[i * 3 + 1] = Math.random() * 3.2 - 0.2;
			pos[i * 3 + 2] = (Math.random() - 0.5) * 3 - 0.6;
			seed[i] = Math.random();
		}
		const geo = new THREE.BufferGeometry();
		geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
		geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
		this.mat = new THREE.ShaderMaterial({
			uniforms: {
				uTime: { value: 0 },
				uSize: { value: 0.016 },
				uColor: { value: new THREE.Color(0x8ec5ff) },
			},
			vertexShader: MOTE_VERT,
			fragmentShader: MOTE_FRAG,
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
		});
		this.points = new THREE.Points(geo, this.mat);
		this.points.frustumCulled = false;
		this.points.renderOrder = 1;
		this.scene.add(this.points);
	}
	setColor(hex: number): void {
		this.mat.uniforms.uColor.value.setHex(hex);
	}
	update(t: number): void {
		this.mat.uniforms.uTime.value = t;
	}
	dispose(): void {
		this.scene.remove(this.points);
		this.points.geometry.dispose();
		this.mat.dispose();
	}
}

// ─────────────────────────────────────────────────────────────
// VRM 角色：加载 + 姿态 + 待机动画
// ─────────────────────────────────────────────────────────────
const vrmLoader = new GLTFLoader();
vrmLoader.register((parser) => new VRMLoaderPlugin(parser));

interface VrmRig {
	head: THREE.Object3D | null;
	neck: THREE.Object3D | null;
	chest: THREE.Object3D | null;
	spine: THREE.Object3D | null;
	hips: THREE.Object3D | null;
	armL: THREE.Object3D | null;
	armR: THREE.Object3D | null;
	foreL: THREE.Object3D | null;
	foreR: THREE.Object3D | null;
	handR: THREE.Object3D | null;
}

interface VrmCharacter {
	vrm: VRM;
	root: THREE.Group;
	rig: VrmRig;
	/** 模型自身高度（脚底到头顶），用于构图取景 */
	height: number;
	dispose(): void;
}

async function loadVrmCharacter(url: string): Promise<VrmCharacter> {
	const gltf = await vrmLoader.loadAsync(url);
	const vrm = gltf.userData.vrm as VRM | undefined;
	if (!vrm) throw new Error(`[hero3d] ${url} 不是合法 VRM`);

	// 官方推荐的加载后处理：焊接顶点 / 合并骨骼 / 合并 morph，显著降 draw call
	VRMUtils.removeUnnecessaryVertices(gltf.scene);
	VRMUtils.combineSkeletons(gltf.scene);
	VRMUtils.combineMorphs(vrm);
	// VRM0 模型默认朝 -Z，转 180° 面向 +Z（相机方向）
	VRMUtils.rotateVRM0(vrm);

	vrm.scene.traverse((obj) => {
		obj.frustumCulled = false; // 骨骼驱动 + 大范围 morph，包围盒不可靠
	});

	const box = new THREE.Box3().setFromObject(vrm.scene);
	const height = Math.max(1, box.max.y);

	const root = new THREE.Group();
	root.add(vrm.scene);

	const b = (n: BoneName) => vrm.humanoid.getNormalizedBoneNode(n);
	const rig: VrmRig = {
		head: b("head"),
		neck: b("neck"),
		chest: b("chest"),
		spine: b("spine"),
		hips: b("hips"),
		armL: b("leftUpperArm"),
		armR: b("rightUpperArm"),
		foreL: b("leftLowerArm"),
		foreR: b("rightLowerArm"),
		handR: b("rightHand"),
	};

	// 站姿：把 T-pose 的胳膊放下来（归一化骨骼里，绕 Z 转即为抬/放臂）
	const ARM_DOWN = 1.15;
	if (rig.armL) rig.armL.rotation.z = ARM_DOWN;
	if (rig.armR) rig.armR.rotation.z = -ARM_DOWN;
	// 肘部微曲，避免笔直僵硬
	if (rig.foreL) rig.foreL.rotation.y = -0.18;
	if (rig.foreR) rig.foreR.rotation.y = 0.18;
	console.info("[hero3d] VRM ready", { url, height: height.toFixed(3) });

	return {
		vrm,
		root,
		rig,
		height,
		dispose() {
			disposeObj(vrm.scene);
			VRMUtils.deepDispose(vrm.scene);
		},
	};
}

export function mountHero3D(layer: HTMLElement): Hero3DController {
	const canvas = layer.querySelector("#hero-3d-canvas") as HTMLCanvasElement | null;
	const fallback = layer.querySelector("#hero-3d-fallback") as HTMLImageElement | null;
	const toast = layer.querySelector("#hero-3d-toast") as HTMLElement | null;
	if (!canvas) throw new Error("[hero3d] canvas missing");

	const quality = detectQuality();
	const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
	const mobile = () => window.innerWidth < 820;
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
	renderer.toneMappingExposure = 1.05;
	renderer.outputColorSpace = THREE.SRGBColorSpace;

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(32, W / H, 0.05, 100);
	// 取景：头肩特写（参考图那种近景压迫感）。loadVrmCharacter 之后会按模型高度重算。
	const camBase = new THREE.Vector3(0, 1.5, 1.35);
	const camTarget = new THREE.Vector3(0, 1.46, 0);
	camera.position.copy(camBase);
	camera.lookAt(camTarget);

	const pmrem = new THREE.PMREMGenerator(renderer);
	const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
	scene.environment = envRT.texture;
	// MToon 赛璐璐：环境光贡献压低，明暗交给平行光
	scene.environmentIntensity = 0.18;

	// 布光：主光 + 冷蓝轮廓光 + 侧补光（对齐参考图的高对比暗调）
	const key = new THREE.DirectionalLight(0xffffff, 2.2);
	key.position.set(1.7, 3.0, 2.4);
	scene.add(key);
	// 背面冷蓝轮廓光：把角色从深色背景里「切」出来
	const rim = new THREE.DirectionalLight(0x7fb2ff, 1.6);
	rim.position.set(-2.0, 1.8, -2.6);
	scene.add(rim);
	// 正面偏下的冷光，压住面部阴影不死黑
	const fill = new THREE.DirectionalLight(0xbcd4ff, 0.7);
	fill.position.set(-1.4, 1.0, 2.0);
	scene.add(fill);
	const rimB = new THREE.PointLight(0x6f9dff, 4.5, 20);
	rimB.position.set(1.8, 1.1, -1.4);
	scene.add(rimB);
	scene.add(new THREE.AmbientLight(0x9fb6ff, 0.3));
	const skillLight = new THREE.PointLight(0x5b9dff, 0, 20);
	skillLight.position.set(0.6, 1.5, 1.2);
	scene.add(skillLight);

	const motes = new AmbientMotes(scene, quality.particles > 2000 ? 420 : 200);

	let current: VrmCharacter | null = null;
	let currentIndex = 0;
	let loadToken = 0;
	/** 鼠标视线目标（lookAt 跟随） */
	const gaze = new THREE.Object3D();
	gaze.position.set(0, 1.5, 2);
	scene.add(gaze);

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

	function frameFor(height: number): void {
		// 胸像特写（对齐参考图的近景压迫感）：视线落在锁骨上方，装下「头顶 → 上胸」
		const eyeY = height * 0.86;
		camTarget.set(0, eyeY, 0);
		camBase.set(0, eyeY, height * 0.95);
		camera.position.copy(camBase);
		camera.lookAt(camTarget);
	}

	function placeCharacter(): void {
		if (!current) return;
		current.root.position.x = mobile() ? 0 : 0.34;
		current.root.position.y = 0;
	}

	async function buildAndAdd(i: number): Promise<void> {
		const cfg = CHARACTERS[i];
		const url = cfg.vrm;
		if (!url) {
			console.warn("[hero3d] 角色未配置 vrm 路径:", cfg.id);
			if (fallback) fallback.style.display = "block";
			return;
		}
		const token = ++loadToken;
		const next = await loadVrmCharacter(url);
		if (token !== loadToken) {
			// 加载期间用户又切了角色 → 丢弃这次结果
			next.dispose();
			return;
		}
		if (current) {
			scene.remove(current.root);
			current.dispose();
		}
		current = next;
		currentIndex = i;
		placeCharacter();
		frameFor(next.height);
		scene.add(current.root);
		// 视线跟随
		if (current.vrm.lookAt) current.vrm.lookAt.target = gaze;
		rim.color.setHex(cfg.auraColor);
		motes.setColor(cfg.accentColor);
		if (fallback) fallback.style.display = "none";
		updateLabel();
	}

	void buildAndAdd(0).catch((e) => {
		console.error("[hero3d] VRM 加载失败", e);
		if (fallback) fallback.style.display = "block";
	});

	// 粒子尺寸同样按近景标定（旧值 0.12 是远景参数，近景会变成一大片光斑）
	const fx = new SkillFX(scene, camera, quality.particles, 0.042);

	// ── 后处理链：RenderPass → 扭曲/色差 → Bloom → Output ──
	const composer = new EffectComposer(renderer);
	composer.addPass(new RenderPass(scene, camera));
	const fxPass = makeSkillFXPass();
	fxPass.enabled = quality.distortion;
	composer.addPass(fxPass);
	const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), quality.bloom, 0.5, 0.9);
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
		// 视线跟随鼠标（不做拖拽时）
		const r = canvas!.getBoundingClientRect();
		const nx = ((e.clientX - r.left) / r.width) * 2 - 1;
		const ny = -((e.clientY - r.top) / r.height) * 2 + 1;
		gaze.position.set(nx * 2.4, 1.5 + ny * 0.9, 2.2);
		if (!dragging) return;
		const dx = e.clientX - lastX;
		const dy = e.clientY - lastY;
		lastX = e.clientX;
		lastY = e.clientY;
		moved += Math.abs(dx) + Math.abs(dy);
		userYaw += dx * 0.006;
		userPitch = Math.max(-0.4, Math.min(0.4, userPitch + dy * 0.003));
	}
	function onUp(e: PointerEvent): void {
		if (!dragging) return;
		dragging = false;
		if (moved < 6 && current) {
			const rect = canvas!.getBoundingClientRect();
			ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
			ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
			ray.setFromCamera(ndc, camera);
			const hit = ray.intersectObject(current.root, true);
			if (hit.length > 0) {
				sayLine();
				// 取头顶上方一点作为火花起点（比手更稳，手会被姿态甩动）
				clickOrigin.set(current.root.position.x, current.height * 0.82, 0.35);
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
		// 光球挂在右手骨骼上 → 抬臂结印时特效跟着手走
		fx.setAnchor(current ? current.rig.handR : null);
		fx.fire(s.color, n, mode, clock.elapsedTime);
		skillLight.color.setHex(s.color);
		skillLight.position.set(0.8, 1.5, 1.1);
		skillLightBoost = key === "purple" ? 7 : 5;
		wave = key === "purple" ? 1 : key === "red" ? 0.85 : 0.68;
		shake = key === "purple" ? 1 : key === "red" ? 0.75 : 0.5;
		signT = 1;
		fxPass.uniforms.uWave.value = wave;
	}

	let toastTimer = 0;
	function sayLine(): void {
		if (!toast) return;
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
			const { root, rig, vrm } = current;
			// 整体：浮空 + 自动摆动（整圈自转会长时间只看到后脑，体验差）
			root.position.y = Math.sin(t * 1.05) * 0.012;
			root.rotation.y = autoYaw + userYaw;
			root.rotation.x = userPitch;
			if (autoRotate && !dragging) autoYaw = Math.sin(t * 0.3) * 0.42;

			if (!reduced) {
				// 呼吸：胸腔微起伏
				if (rig.chest) rig.chest.scale.setScalar(1 + Math.sin(t * 1.4) * 0.012);
				// 头部微摆
				if (rig.head) {
					rig.head.rotation.y = Math.sin(t * 0.5) * 0.07;
					rig.head.rotation.x = Math.sin(t * 0.83) * 0.025;
				}
				if (rig.spine) rig.spine.rotation.z = Math.sin(t * 0.42) * 0.012;
			}

			// 结印：抬臂（缓出）→ 保持 → 落臂，总时长 1.6s
			if (signT > 0 && rig.armR && rig.foreR) {
				signT = Math.max(0, signT - dt / 1.6);
				const p = 1 - signT;
				let st: number;
				if (p < 0.22) {
					const k = p / 0.22;
					st = 1 - Math.pow(1 - k, 3);
				} else if (p < 0.62) {
					st = 1;
				} else {
					const k = (p - 0.62) / 0.38;
					st = 1 - k * k;
				}
				const s = Math.max(0, Math.min(1, st));
				// 右臂：放下(-1.15) → 抬到胸前并前伸
				rig.armR.rotation.z = -1.15 + 0.95 * s;
				rig.armR.rotation.x = -0.85 * s;
				rig.foreR.rotation.y = 0.18 + 1.25 * s;
			} else if (rig.armR && rig.foreR && signT <= 0) {
				rig.armR.rotation.z = -1.15;
				rig.armR.rotation.x = 0;
				rig.foreR.rotation.y = 0.18;
			}

			vrm.update(dt); // 弹簧骨骼 / lookAt / 表情
		}

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
		bloom.strength = quality.bloom + wave * 0.5;

		// 震屏
		if (shake > 0) {
			shake = Math.max(0, shake - dt * 2.4);
			const s = shake * shake * 0.06;
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

		motes.update(t);
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
		placeCharacter();
	});
	ro.observe(layer);

	function destroy(): void {
		if (disposed) return;
		disposed = true;
		cancelAnimationFrame(raf);
		ro.disconnect();
		canvas!.removeEventListener("pointerdown", onDown);
		canvas!.removeEventListener("pointermove", onMove);
		window.removeEventListener("pointerup", onUp);
		if (current) {
			scene.remove(current.root);
			current.dispose();
			current = null;
		}
		motes.dispose();
		fx.dispose();
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
			void buildAndAdd(i).catch((e) => console.error("[hero3d] 切换角色失败", e));
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
					if (current) current.root.rotation.y = y;
				},
				get current() {
					return current;
				},
			};
			return w.__hero;
		})(),
	};
}
