/**
 * generate-models.ts — 程序化生成 6 个真实 .glb 3D 模型到 public/models/
 *
 * 纯几何 + 顶点色 + 自发光材质（无外部贴图），用 three 的 GLTFExporter
 * 以 binary:true 导出 ArrayBuffer 直写文件。
 *
 * 运行：npx tsx scripts/generate-models.ts   （已接入 pnpm build 链）
 */
import { Blob as NodeBlob } from "node:buffer";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";

/* ------------------------------------------------------------------ *
 * Node 端 shim：GLTFExporter 的二进制路径依赖全局 Blob / FileReader
 * （仅在缺失时注入，避免污染浏览器环境）
 * ------------------------------------------------------------------ */
const g = globalThis as unknown as {
	Blob?: unknown;
	FileReader?: unknown;
};
if (typeof g.Blob === "undefined") g.Blob = NodeBlob;
if (typeof g.FileReader === "undefined") {
	class FileReaderShim {
		result: ArrayBuffer | null = null;
		onloadend: (() => void) | null = null;
		private handlers: Record<string, Array<() => void>> = {};
		addEventListener(type: string, cb: () => void): void {
			(this.handlers[type] ||= []).push(cb);
		}
		readAsArrayBuffer(blob: { arrayBuffer: () => Promise<ArrayBuffer> }): void {
			Promise.resolve(blob.arrayBuffer()).then((buf) => {
				this.result = buf;
				this.onloadend?.();
				(this.handlers["loadend"] || []).forEach((h) => h());
			});
		}
	}
	g.FileReader = FileReaderShim;
}

/* ------------------------------ 工具 ------------------------------ */

type RGB = [number, number, number];

/** 给几何体写入逐顶点颜色 */
function colorize(
	geo: THREE.BufferGeometry,
	fn: (x: number, y: number, z: number, i: number) => RGB,
): void {
	const pos = geo.attributes.position as THREE.BufferAttribute;
	const colors = new Float32Array(pos.count * 3);
	for (let i = 0; i < pos.count; i++) {
		const [r, gC, b] = fn(pos.getX(i), pos.getY(i), pos.getZ(i), i);
		colors[i * 3] = r;
		colors[i * 3 + 1] = gC;
		colors[i * 3 + 2] = b;
	}
	geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
}

function stdMat(emissive: RGB, intensity: number): THREE.MeshStandardMaterial {
	return new THREE.MeshStandardMaterial({
		vertexColors: true,
		metalness: 0.35,
		roughness: 0.3,
		emissive: new THREE.Color(emissive[0], emissive[1], emissive[2]),
		emissiveIntensity: intensity,
		flatShading: false,
	});
}

/** 把任意对象包成 Group 并居中归一化到 ~[-1.6,1.6] */
function finalize(obj: THREE.Object3D, name: string): THREE.Group {
	const grp = new THREE.Group();
	grp.name = name;
	grp.add(obj);
	const box = new THREE.Box3().setFromObject(grp);
	const center = box.getCenter(new THREE.Vector3());
	const size = box.getSize(new THREE.Vector3());
	const maxDim = Math.max(size.x, size.y, size.z) || 1;
	const scale = 3.0 / maxDim;
	grp.position.sub(center);
	grp.scale.setScalar(scale);
	grp.name = name;
	return grp;
}

/* ----------------------------- 模型 ----------------------------- */

function buildCrystalTorus(): THREE.Group {
	const geo = new THREE.TorusKnotGeometry(0.85, 0.3, 260, 36);
	colorize(geo, (x, y, z) => {
		const h = (Math.atan2(z, x) / (Math.PI * 2) + 0.5 + y * 0.15) % 1;
		const c = new THREE.Color().setHSL((h + 1) % 1, 0.85, 0.6);
		return [c.r, c.g, c.b];
	});
	const mesh = new THREE.Mesh(geo, stdMat([0.6, 0.1, 0.8], 0.25));
	return finalize(mesh, "crystal-torus");
}

function buildNebulaSphere(): THREE.Group {
	const geo = new THREE.IcosahedronGeometry(1.1, 6);
	colorize(geo, (x, y, z) => {
		const n =
			Math.sin(x * 4) * 0.5 +
			Math.cos(y * 5) * 0.3 +
			Math.sin(z * 6 + 1.7) * 0.2;
		const h = (n * 0.5 + 0.5) * 0.8 + 0.05;
		const c = new THREE.Color().setHSL(h % 1, 0.9, 0.58);
		return [c.r, c.g, c.b];
	});
	const mesh = new THREE.Mesh(geo, stdMat([0.1, 0.4, 0.9], 0.3));
	return finalize(mesh, "nebula-sphere");
}

function buildHexPrism(): THREE.Group {
	const grp = new THREE.Group();
	const hues = [0.0, 0.33, 0.66];
	hues.forEach((h, idx) => {
		const geo = new THREE.CylinderGeometry(0.55, 0.55, 1.7, 6, 1);
		colorize(geo, () => {
			const c = new THREE.Color().setHSL(h, 0.85, 0.6);
			return [c.r, c.g, c.b];
		});
		const m = new THREE.Mesh(geo, stdMat([h, 0.2, 1 - h].map((v) => Math.min(1, v)) as RGB, 0.22));
		m.position.set((idx - 1) * 1.0, 0, 0);
		m.rotation.z = (idx * Math.PI) / 6;
		grp.add(m);
	});
	return finalize(grp, "hex-prism");
}

function buildWaveGrid(): THREE.Group {
	const geo = new THREE.PlaneGeometry(2.6, 2.6, 90, 90);
	const pos = geo.attributes.position as THREE.BufferAttribute;
	for (let i = 0; i < pos.count; i++) {
		const x = pos.getX(i);
		const y = pos.getY(i);
		const z =
			Math.sin(x * 3) * 0.28 +
			Math.cos(y * 3.5) * 0.28 +
			Math.sin((x + y) * 2.2) * 0.15;
		pos.setZ(i, z);
	}
	geo.computeVertexNormals();
	colorize(geo, (_x, _y, z) => {
		const t = Math.min(1, Math.max(0, (z + 0.7) / 1.4));
		const c = new THREE.Color().setHSL(0.58 - t * 0.5, 0.85, 0.4 + t * 0.3);
		return [c.r, c.g, c.b];
	});
	const mesh = new THREE.Mesh(geo, stdMat([0.1, 0.6, 0.8], 0.2));
	mesh.rotation.x = -Math.PI / 2;
	return finalize(mesh, "wave-grid");
}

function buildSpiralGalaxy(): THREE.Group {
	const pts: THREE.Vector3[] = [];
	const turns = 3.2;
	const N = 220;
	for (let i = 0; i <= N; i++) {
		const t = i / N;
		const ang = t * Math.PI * 2 * turns;
		const r = 0.15 + t * 1.25;
		pts.push(
			new THREE.Vector3(
				Math.cos(ang) * r,
				Math.sin(t * Math.PI * 4) * 0.18 * (1 - t),
				Math.sin(ang) * r,
			),
		);
	}
	const curve = new THREE.CatmullRomCurve3(pts);
	const geo = new THREE.TubeGeometry(curve, 400, 0.05, 10, false);
	colorize(geo, (x, y, z) => {
		const h = (Math.atan2(z, x) / (Math.PI * 2) + 0.5) % 1;
		const c = new THREE.Color().setHSL(h, 0.9, 0.62);
		return [c.r, c.g, c.b];
	});
	const mesh = new THREE.Mesh(geo, stdMat([0.7, 0.2, 0.9], 0.3));
	return finalize(mesh, "spiral-galaxy");
}

function buildGemCluster(): THREE.Group {
	const grp = new THREE.Group();
	const specs: Array<[number, RGB, number, [number, number, number]]> = [
		[0.7, [1, 0.2, 0.4], 0.0, [0, 0.2, 0]],
		[0.5, [0.2, 1, 0.5], 0.33, [0.8, -0.3, 0.2]],
		[0.45, [0.3, 0.6, 1], 0.66, [-0.7, -0.25, -0.3]],
		[0.35, [1, 0.85, 0.2], 0.12, [0.2, 0.7, 0.5]],
	];
	specs.forEach(([s, hue, hOff, pos]) => {
		const geo = new THREE.OctahedronGeometry(s, 0);
		colorize(geo, () => {
			const c = new THREE.Color().setHSL((hOff + (s % 0.3)) % 1, 0.85, 0.62);
			return [c.r, c.g, c.b];
		});
		const m = new THREE.Mesh(geo, stdMat(hue, 0.35));
		m.position.set(pos[0], pos[1], pos[2]);
		m.rotation.set(s, s * 1.3, s * 0.7);
		grp.add(m);
	});
	return finalize(grp, "gem-cluster");
}

const BUILDERS: Array<[string, () => THREE.Group]> = [
	["crystal-torus", buildCrystalTorus],
	["nebula-sphere", buildNebulaSphere],
	["hex-prism", buildHexPrism],
	["wave-grid", buildWaveGrid],
	["spiral-galaxy", buildSpiralGalaxy],
	["gem-cluster", buildGemCluster],
];

/* ----------------------------- 导出 ----------------------------- */

function exportGLB(scene: THREE.Scene, name: string): Promise<number> {
	return new Promise((resolvePromise, reject) => {
		const exporter = new GLTFExporter();
		exporter.parse(
			scene,
			(result) => {
				if (!(result instanceof ArrayBuffer)) {
					reject(new Error(`${name}: 期望 ArrayBuffer，得到 ${typeof result}`));
					return;
				}
				const outDir = resolve(process.cwd(), "public/models");
				mkdirSync(outDir, { recursive: true });
				writeFileSync(resolve(outDir, `${name}.glb`), Buffer.from(result));
				resolvePromise(result.byteLength);
			},
			(err) => reject(err),
			{ binary: true, onlyVisible: false },
		);
	});
}

async function main(): Promise<void> {
	console.log("[generate-models] 开始生成 6 个 .glb 模型...");
	for (const [name, builder] of BUILDERS) {
		const scene = new THREE.Scene();
		scene.add(builder());
		const bytes = await exportGLB(scene, name);
		console.log(`  ✓ ${name}.glb  (${(bytes / 1024).toFixed(1)} KiB)`);
	}
	console.log("[generate-models] 完成：public/models/*.glb");
}

main().catch((e) => {
	console.error("[generate-models] 失败:", e);
	process.exit(1);
});
