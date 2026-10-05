/**
 * hero-character-scene.ts — 首页全屏 3D 角色场景引擎（电影级）
 *
 * 由 WallpaperSection 的客户端脚本动态 import（代码分割，three 不进普通页面包）。
 * mountHero3D(layer) 返回控制器：
 *   - destroy()        严格 dispose 全部 GPU 资源 + forceContextLoss（离开首页时调用）
 *   - castSkill(key)   触发 蒼/赫/茈 粒子爆发 + 冲击波 + 补光
 *   - switchCharacter(i) 切换角色（五条悟 / 伏黑惠 / 钉崎野蔷薇）
 *   - setAutoRotate(on)
 *
 * 视觉：ACES 色调映射 + RoomEnvironment IBL + UnrealBloom 后处理 + 电影感冷暖补光。
 * 交互：拖拽旋转、闲置浮空/呼吸/发丝摇曳、点击角色弹出经典口头禅 + 咒力火花。
 */
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { CHARACTERS, SKILLS, type CharacterConfig } from "./hero-content";

export interface QualityTier {
	pixelRatio: number;
	bloom: number;
	particles: number;
	antialias: boolean;
}

export interface Hero3DController {
	destroy(): void;
	castSkill(key: string): void;
	switchCharacter(index: number): void;
	setAutoRotate(on: boolean): void;
}

interface BuiltCharacter {
	group: THREE.Group;
	hairGroup: THREE.Group;
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
		return { pixelRatio: 1.5, bloom: 0.55, particles: 300, antialias: false };
	}
	return { pixelRatio: 2, bloom: 0.85, particles: 620, antialias: true };
}

function makeSpikyHair(mat: THREE.Material): THREE.Group {
	const g = new THREE.Group();
	const up = new THREE.Vector3(0, 1, 0);
	const N = 74;
	for (let i = 0; i < N; i++) {
		const u = Math.random();
		const v = Math.random();
		const theta = u * Math.PI * 2;
		const phi = Math.acos(1 - v * 0.96); // 偏上半球
		const dir = new THREE.Vector3(
			Math.sin(phi) * Math.cos(theta),
			Math.cos(phi),
			Math.sin(phi) * Math.sin(theta),
		);
		const len = 0.2 + Math.random() * 0.36;
		const cone = new THREE.Mesh(new THREE.ConeGeometry(0.045 + Math.random() * 0.03, len, 6), mat);
		cone.position.copy(dir.clone().multiplyScalar(0.4));
		cone.quaternion.setFromUnitVectors(up, dir);
		g.add(cone);
	}
	return g;
}

function buildCharacter(cfg: CharacterConfig): BuiltCharacter {
	const group = new THREE.Group();

	const skin = new THREE.MeshPhysicalMaterial({
		color: cfg.skinColor,
		roughness: 0.62,
		clearcoat: 0.25,
		clearcoatRoughness: 0.5,
	});
	const hairMat = new THREE.MeshStandardMaterial({
		color: cfg.hairColor,
		roughness: 0.4,
		metalness: 0.0,
		emissive: cfg.hairEmissive,
		emissiveIntensity: cfg.hairEmissive ? 0.22 : 0,
	});
	const uniformMat = new THREE.MeshPhysicalMaterial({
		color: cfg.uniformColor,
		roughness: 0.5,
		clearcoat: 0.35,
		clearcoatRoughness: 0.45,
		sheen: 0.5,
		sheenColor: new THREE.Color(cfg.accentColor),
	});
	const clothMat = new THREE.MeshStandardMaterial({ color: cfg.uniformColor, roughness: 0.78 });

	const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh => {
		const m = new THREE.Mesh(geo, mat);
		m.position.set(x, y, z);
		group.add(m);
		return m;
	};

	// 头 / 头皮帽 / 颈
	const head = add(new THREE.SphereGeometry(0.42, 40, 32), skin, 0, 2.55, 0);
	const scalp = new THREE.Mesh(
		new THREE.SphereGeometry(0.44, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.6),
		hairMat,
	);
	scalp.position.set(0, 2.52, 0);
	group.add(scalp);
	add(new THREE.CylinderGeometry(0.16, 0.2, 0.3, 20), skin, 0, 2.18, 0);

	// 眼罩 / 六眼
	if (cfg.blindfold) {
		const band = new THREE.Mesh(
			new THREE.TorusGeometry(0.42, 0.09, 14, 32),
			new THREE.MeshStandardMaterial({ color: 0x14151b, roughness: 0.85 }),
		);
		band.rotation.x = Math.PI / 2;
		band.position.set(0, 2.5, 0);
		group.add(band);
	} else if (cfg.sixEyes) {
		const eyeMat = new THREE.MeshStandardMaterial({
			color: 0x9fd0ff,
			emissive: 0x4f9dff,
			emissiveIntensity: 1.4,
			roughness: 0.2,
		});
		add(new THREE.SphereGeometry(0.08, 16, 12), eyeMat, -0.17, 2.55, 0.38);
		add(new THREE.SphereGeometry(0.08, 16, 12), eyeMat, 0.17, 2.55, 0.38);
	}

	// 高领 + 躯干 + 胯
	add(new THREE.CylinderGeometry(0.34, 0.42, 0.42, 24, 1, true), uniformMat, 0, 2.0, 0);
	add(new THREE.CapsuleGeometry(0.52, 0.95, 10, 24), uniformMat, 0, 1.35, 0);
	const hips = add(new THREE.SphereGeometry(0.5, 24, 18), clothMat, 0, 0.55, 0);
	hips.scale.set(1, 0.72, 0.82);

	// 肩
	add(new THREE.SphereGeometry(0.24, 20, 16), uniformMat, -0.56, 1.95, 0);
	add(new THREE.SphereGeometry(0.24, 20, 16), uniformMat, 0.56, 1.95, 0);

	// 手臂（分组以便摆姿势）
	const buildArm = (side: number): THREE.Group => {
		const arm = new THREE.Group();
		arm.position.set(side * 0.56, 1.9, 0);
		const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.5, 6, 16), uniformMat);
		upper.position.y = -0.35;
		arm.add(upper);
		const fore = new THREE.Group();
		fore.position.y = -0.62;
		arm.add(fore);
		const foreMesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.14, 0.45, 6, 16), skin);
		foreMesh.position.y = -0.3;
		fore.add(foreMesh);
		const hand = new THREE.Mesh(new THREE.SphereGeometry(0.16, 16, 12), skin);
		hand.position.y = -0.6;
		fore.add(hand);
		group.add(arm);
		return fore;
	};
	const foreL = buildArm(-1);
	const foreR = buildArm(1);

	// 腿
	const buildLeg = (side: number): void => {
		const leg = new THREE.Group();
		leg.position.set(side * 0.22, -0.05, 0);
		const thigh = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.6, 6, 16), clothMat);
		thigh.position.y = -0.4;
		leg.add(thigh);
		const shin = new THREE.Mesh(new THREE.CapsuleGeometry(0.17, 0.6, 6, 16), clothMat);
		shin.position.y = -1.05;
		leg.add(shin);
		const foot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.14, 0.42), clothMat);
		foot.position.set(0, -1.45, 0.12);
		leg.add(foot);
		group.add(leg);
	};
	buildLeg(-1);
	buildLeg(1);

	// 姿势
	if (cfg.pose === "signature") {
		// 左手抬至脸侧（五条悟标志性）
		const armL = group.children.find((c) => c instanceof THREE.Group && c.position.x === -0.56) as THREE.Group;
		if (armL) {
			armL.rotation.z = 0.95;
			foreL.rotation.z = -1.55;
			foreL.rotation.x = 0.2;
		}
		const armR = group.children.find((c) => c instanceof THREE.Group && c.position.x === 0.56) as THREE.Group;
		if (armR) armR.rotation.z = -0.18;
	} else if (cfg.pose === "ready") {
		const armL = group.children.find((c) => c instanceof THREE.Group && c.position.x === -0.56) as THREE.Group;
		const armR = group.children.find((c) => c instanceof THREE.Group && c.position.x === 0.56) as THREE.Group;
		if (armL) {
			armL.rotation.z = 0.5;
			foreL.rotation.x = 0.5;
		}
		if (armR) {
			armR.rotation.z = -0.5;
			foreR.rotation.x = 0.5;
		}
	} else {
		const armL = group.children.find((c) => c instanceof THREE.Group && c.position.x === -0.56) as THREE.Group;
		const armR = group.children.find((c) => c instanceof THREE.Group && c.position.x === 0.56) as THREE.Group;
		if (armL) armL.rotation.z = 0.16;
		if (armR) armR.rotation.z = -0.16;
	}

	// 发（放在头上方）
	const hairGroup = makeSpikyHair(hairMat);
	hairGroup.position.set(0, 2.6, 0);
	group.add(hairGroup);

	// 脚下咒力光环
	const ring = new THREE.Mesh(
		new THREE.TorusGeometry(1.05, 0.035, 12, 64),
		new THREE.MeshBasicMaterial({ color: cfg.auraColor, transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }),
	);
	ring.name = "auraRing";
	ring.rotation.x = Math.PI / 2;
	ring.position.y = -1.55;
	group.add(ring);

	return { group, hairGroup };
}

class SkillFX {
	private geo: THREE.BufferGeometry;
	private pos: Float32Array;
	private col: Float32Array;
	private base: Float32Array;
	private vel: Float32Array;
	private life: Float32Array;
	private maxLife: Float32Array;
	private count: number;
	private cursor = 0;
	private points: THREE.Points;
	private rings: THREE.Mesh[] = [];
	private ringColor: THREE.Color[] = [];
	private ringLife: number[] = [];
	private ringMax: number[] = [];
	private ringCursor = 0;

	constructor(private scene: THREE.Scene, maxParticles: number, maxRings: number) {
		this.count = maxParticles;
		this.pos = new Float32Array(maxParticles * 3);
		this.col = new Float32Array(maxParticles * 3);
		this.base = new Float32Array(maxParticles * 3);
		this.vel = new Float32Array(maxParticles * 3);
		this.life = new Float32Array(maxParticles);
		this.maxLife = new Float32Array(maxParticles);
		this.geo = new THREE.BufferGeometry();
		this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3));
		this.geo.setAttribute("color", new THREE.BufferAttribute(this.col, 3));
		const mat = new THREE.PointsMaterial({
			size: 0.14,
			vertexColors: true,
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			sizeAttenuation: true,
		});
		this.points = new THREE.Points(this.geo, mat);
		this.points.frustumCulled = false;
		this.scene.add(this.points);

		for (let i = 0; i < maxRings; i++) {
			const m = new THREE.Mesh(
				new THREE.RingGeometry(0.9, 1.0, 48),
				new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }),
			);
			m.visible = false;
			this.scene.add(m);
			this.rings.push(m);
			this.ringColor.push(new THREE.Color(0xffffff));
			this.ringLife.push(0);
			this.ringMax.push(1);
		}
	}

	burst(origin: THREE.Vector3, color: number, n: number): void {
		const c = new THREE.Color(color);
		for (let k = 0; k < n; k++) {
			const i = this.cursor;
			this.cursor = (this.cursor + 1) % this.count;
			const dir = new THREE.Vector3(Math.random() * 2 - 1, Math.random() * 2 - 1, Math.random() * 2 - 1).normalize();
			const speed = 1.6 + Math.random() * 2.4;
			this.pos[i * 3] = origin.x;
			this.pos[i * 3 + 1] = origin.y;
			this.pos[i * 3 + 2] = origin.z;
			this.vel[i * 3] = dir.x * speed;
			this.vel[i * 3 + 1] = dir.y * speed + 0.6;
			this.vel[i * 3 + 2] = dir.z * speed;
			this.base[i * 3] = c.r;
			this.base[i * 3 + 1] = c.g;
			this.base[i * 3 + 2] = c.b;
			this.life[i] = this.maxLife[i] = 0.6 + Math.random() * 0.7;
		}
	}

	ring(origin: THREE.Vector3, color: number): void {
		const i = this.ringCursor;
		this.ringCursor = (this.ringCursor + 1) % this.rings.length;
		const m = this.rings[i];
		m.position.copy(origin);
		m.scale.setScalar(0.25);
		m.visible = true;
		(this.ringColor[i] as THREE.Color).setHex(color);
		(m.material as THREE.MeshBasicMaterial).color.setHex(color);
		this.ringLife[i] = this.ringMax[i] = 1.0;
	}

	update(dt: number, camera: THREE.Camera): void {
		for (let i = 0; i < this.count; i++) {
			if (this.life[i] <= 0) {
				this.col[i * 3] = this.col[i * 3 + 1] = this.col[i * 3 + 2] = 0;
				continue;
			}
			this.life[i] -= dt;
			this.vel[i * 3] *= 0.95;
			this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * 0.95 - dt * 1.2;
			this.vel[i * 3 + 2] *= 0.95;
			this.pos[i * 3] += this.vel[i * 3] * dt;
			this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
			this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
			const a = Math.max(this.life[i] / this.maxLife[i], 0);
			this.col[i * 3] = this.base[i * 3] * a;
			this.col[i * 3 + 1] = this.base[i * 3 + 1] * a;
			this.col[i * 3 + 2] = this.base[i * 3 + 2] * a;
		}
		this.geo.attributes.position.needsUpdate = true;
		this.geo.attributes.color.needsUpdate = true;

		for (let i = 0; i < this.rings.length; i++) {
			if (this.ringLife[i] <= 0) continue;
			this.ringLife[i] -= dt * 1.5;
			const a = Math.max(this.ringLife[i] / this.ringMax[i], 0);
			this.rings[i].scale.setScalar(0.25 + (1 - a) * 3.2);
			(this.rings[i].material as THREE.MeshBasicMaterial).opacity = a * 0.9;
			this.rings[i].lookAt(camera.position);
			if (this.ringLife[i] <= 0) this.rings[i].visible = false;
		}
	}

	dispose(): void {
		this.scene.remove(this.points);
		this.geo.dispose();
		(this.points.material as THREE.Material).dispose();
		for (const m of this.rings) {
			this.scene.remove(m);
			m.geometry.dispose();
			(m.material as THREE.Material).dispose();
		}
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
	renderer.toneMappingExposure = 1.1;
	renderer.outputColorSpace = THREE.SRGBColorSpace;

	const scene = new THREE.Scene();
	const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 100);
	camera.position.set(0, 0.55, 6.2);
	camera.lookAt(0, 0.55, 0);

	const pmrem = new THREE.PMREMGenerator(renderer);
	const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
	scene.environment = envRT.texture;

	const key = new THREE.DirectionalLight(0xffffff, 2.0);
	key.position.set(3, 6, 5);
	scene.add(key);
	const rimA = new THREE.PointLight(0x4f7bff, 24, 40);
	rimA.position.set(-6, 2, -4);
	scene.add(rimA);
	const rimB = new THREE.PointLight(0xff6fae, 16, 40);
	rimB.position.set(5, -2, -3);
	scene.add(rimB);
	const skillLight = new THREE.PointLight(0x5b9dff, 0, 30);
	skillLight.position.set(0, 1.2, 3);
	scene.add(skillLight);
	scene.add(new THREE.AmbientLight(0xffffff, 0.35));

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
		scene.add(current.group);
		rimA.color.setHex(CHARACTERS[i].auraColor);
		updateLabel();
	}

	buildAndAdd(0);

	const fx = new SkillFX(scene, quality.particles, 6);

	const composer = new EffectComposer(renderer);
	composer.addPass(new RenderPass(scene, camera));
	const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), quality.bloom, 0.6, 0.7);
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
		userPitch = Math.max(-0.6, Math.min(0.6, userPitch + dy * 0.004));
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
				fx.burst(new THREE.Vector3(0, 1.4, 0.6), CHARACTERS[currentIndex].accentColor, 40);
			}
		}
	}
	canvas.addEventListener("pointerdown", onDown);
	canvas.addEventListener("pointermove", onMove);
	window.addEventListener("pointerup", onUp);

	let skillLightBoost = 0;
	function castSkill(key: string): void {
		const s = SKILLS.find((k) => k.key === key);
		if (!s) return;
		skillLight.color.setHex(s.color);
		skillLightBoost = 6;
		fx.burst(new THREE.Vector3(0, 1.4, 0.8), s.color, 90);
		fx.ring(new THREE.Vector3(0, 1.1, 0.4), s.color);
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
			current.group.position.y = Math.sin(t * 1.2) * 0.04;
			current.group.rotation.y = autoYaw + userYaw;
			current.group.rotation.x = userPitch;
			current.hairGroup.rotation.z = Math.sin(t * 0.8) * 0.05;
			current.hairGroup.rotation.x = Math.sin(t * 0.6) * 0.03;
			const ring = current.group.getObjectByName("auraRing") as THREE.Mesh | null;
			if (ring) ring.rotation.z = t * 0.4;
		}
		if (autoRotate && !dragging) autoYaw += dt * 0.25;
		if (skillLightBoost > 0) {
			skillLight.intensity = skillLightBoost;
			skillLightBoost = Math.max(0, skillLightBoost - dt * 10);
		} else {
			skillLight.intensity = 0;
		}
		fx.update(dt, camera);
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
	};
}
