/**
 * toon-material.ts — 卡通（赛璐璐）渲染管线
 *
 * - makeToonGradient(steps)：DataTexture 渐变贴图，给 MeshToonMaterial 用
 *   NearestFilter → 硬边明暗台阶（赛璐璐效果）。
 * - toonMat(opts)：配好 gradientMap 的 MeshToonMaterial 工厂。
 * - attachOutline(mesh, thickness)：反向外壳描边（克隆几何 → 顶点沿法线外扩
 *   → BackSide MeshBasicMaterial），作为子对象挂回原 mesh。给动漫线稿感。
 */
import * as THREE from "three";

export function makeToonGradient(steps = 3): THREE.DataTexture {
	const data = new Uint8Array(steps * 4);
	for (let i = 0; i < steps; i++) {
		const v = Math.floor(((i + 1) / steps) * 255);
		data[i * 4] = v;
		data[i * 4 + 1] = v;
		data[i * 4 + 2] = v;
		data[i * 4 + 3] = 255;
	}
	const tex = new THREE.DataTexture(data, steps, 1, THREE.RGBAFormat);
	tex.magFilter = THREE.NearestFilter;
	tex.minFilter = THREE.NearestFilter;
	tex.generateMipmaps = false;
	tex.needsUpdate = true;
	return tex;
}

export interface ToonMatOpts {
	color: number;
	emissive?: number;
	emissiveIntensity?: number;
	gradient?: THREE.DataTexture;
}

export function toonMat(opts: ToonMatOpts): THREE.MeshToonMaterial {
	const mat = new THREE.MeshToonMaterial({
		color: opts.color,
		gradientMap: opts.gradient,
	});
	if (opts.emissive !== undefined) {
		mat.emissive.setHex(opts.emissive);
		mat.emissiveIntensity = opts.emissiveIntensity ?? 0.4;
	}
	return mat;
}

/** 克隆几何并沿法线外扩顶点，构造反向外壳 mesh。 */
export function makeOutlineGeometry(src: THREE.BufferGeometry, thickness: number): THREE.BufferGeometry {
	const geo = src.clone();
	const pos = geo.attributes.position;
	const norm = geo.attributes.normal;
	for (let i = 0; i < pos.count; i++) {
		pos.setXYZ(
			i,
			pos.getX(i) + norm.getX(i) * thickness,
			pos.getY(i) + norm.getY(i) * thickness,
			pos.getZ(i) + norm.getZ(i) * thickness,
		);
	}
	pos.needsUpdate = true;
	geo.computeBoundingSphere();
	return geo;
}

/** 给 mesh 附加反向外壳描边（子 mesh，继承父级变换）。返回描边 mesh。 */
export function attachOutline(mesh: THREE.Mesh, thickness = 0.018, color = 0x08080f): THREE.Mesh {
	const outlineGeo = makeOutlineGeometry(mesh.geometry, thickness);
	const outlineMat = new THREE.MeshBasicMaterial({ color, side: THREE.BackSide, fog: false });
	const outline = new THREE.Mesh(outlineGeo, outlineMat);
	outline.renderOrder = (mesh.renderOrder ?? 0) - 1;
	outline.userData.isOutline = true;
	mesh.add(outline);
	return outline;
}

/** 全局共享的 toon 渐变（每个材质共享一份即可）。 */
let sharedGradient: THREE.DataTexture | null = null;
export function sharedToonGradient(): THREE.DataTexture {
	if (!sharedGradient) sharedGradient = makeToonGradient(7);
	return sharedGradient;
}
