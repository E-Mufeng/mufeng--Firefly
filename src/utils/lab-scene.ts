/**
 * lab-scene.ts — 实验室沉浸式 Three.js 查看器
 *
 * 由 LabManager 动态 import（代码分割，three 不进普通页面包）。
 * createLab() 返回 { mount, unmount }：
 *  - mount：在当前 /lab/ 页初始化渲染器/场景/相机/控制器/加载模型
 *  - unmount：严格 dispose 全部 GPU 资源 + forceContextLoss，避免切页泄漏
 *
 * 视觉：ACES 色调映射 + RoomEnvironment 反射 + 电影感彩色补光 + 自动旋转。
 */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

export const LAB_MODELS: Array<{ name: string; file: string; label: string }> = [
	{ name: "crystal-torus", file: "/models/crystal-torus.glb", label: "水晶环结" },
	{ name: "nebula-sphere", file: "/models/nebula-sphere.glb", label: "星云晶球" },
	{ name: "hex-prism", file: "/models/hex-prism.glb", label: "六棱矩阵" },
	{ name: "wave-grid", file: "/models/wave-grid.glb", label: "波动网格" },
	{ name: "spiral-galaxy", file: "/models/spiral-galaxy.glb", label: "螺旋星系" },
	{ name: "gem-cluster", file: "/models/gem-cluster.glb", label: "宝石簇" },
];

export type LabHandle = {
	mount: () => void;
	unmount: () => void;
	switchModel: (index: number) => void;
	setAutoRotate: (on: boolean) => void;
	setWireframe: (on: boolean) => void;
	disposed: () => boolean;
};

function isLabPath(): boolean {
	return window.location.pathname.replace(/\/+$/, "") === "/lab";
}

export function createLab(): LabHandle {
	let renderer: THREE.WebGLRenderer | null = null;
	let scene: THREE.Scene | null = null;
	let camera: THREE.PerspectiveCamera | null = null;
	let controls: OrbitControls | null = null;
	let pmrem: THREE.PMREMGenerator | null = null;
	let raf = 0;
	let current: THREE.Object3D | null = null;
	let currentIndex = 0;
	let wireframe = false;
	let loader: GLTFLoader | null = null;
	let container: HTMLElement | null = null;

	function disposeObject(obj: THREE.Object3D | null): void {
		if (!obj) return;
		obj.traverse((child) => {
			const mesh = child as THREE.Mesh;
			if (mesh.geometry) mesh.geometry.dispose();
			const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
			if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
			else if (mat) mat.dispose();
		});
	}

	function fitObject(obj: THREE.Object3D): void {
		const box = new THREE.Box3().setFromObject(obj);
		const size = box.getSize(new THREE.Vector3());
		const center = box.getCenter(new THREE.Vector3());
		obj.position.sub(center);
		const maxDim = Math.max(size.x, size.y, size.z) || 1;
		const dist = (maxDim / 2 / Math.tan((Math.PI * 50) / 360)) * 1.6;
		if (camera) {
			camera.position.set(0, 0, dist);
			camera.near = dist / 100;
			camera.far = dist * 100;
			camera.updateProjectionMatrix();
		}
		if (controls) controls.target.set(0, 0, 0);
	}

	function loadModel(index: number): void {
		if (!scene || !loader) return;
		currentIndex = index;
		const model = LAB_MODELS[index];
		loader.load(
			model.file,
			(gltf) => {
				if (!scene) return;
				disposeObject(current);
				if (current) scene.remove(current);
				current = gltf.scene;
				current.traverse((c) => {
					const mesh = c as THREE.Mesh;
					if (mesh.isMesh) {
						const m = mesh.material as THREE.MeshStandardMaterial;
						if (m && "wireframe" in m) m.wireframe = wireframe;
					}
				});
				scene.add(current);
				fitObject(current);
			},
			undefined,
			(err) => console.error("[lab] 模型加载失败", model.file, err),
		);
	}

	function buildScene(): void {
		if (!container) return;
		const w = container.clientWidth || window.innerWidth;
		const h = container.clientHeight || window.innerHeight;

		renderer = new THREE.WebGLRenderer({
			antialias: true,
			alpha: true,
			powerPreference: "high-performance",
		});
		renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		renderer.setSize(w, h);
		renderer.toneMapping = THREE.ACESFilmicToneMapping;
		renderer.toneMappingExposure = 1.05;
		renderer.outputColorSpace = THREE.SRGBColorSpace;
		container.appendChild(renderer.domElement);

		scene = new THREE.Scene();

		camera = new THREE.PerspectiveCamera(50, w / h, 0.1, 200);
		camera.position.set(0, 0, 5);

		pmrem = new THREE.PMREMGenerator(renderer);
		const envScene = new RoomEnvironment();
		scene.environment = pmrem.fromScene(envScene, 0.04).texture;

		// 电影感布光：主光 + 冷暖边缘光
		const key = new THREE.DirectionalLight(0xffffff, 2.2);
		key.position.set(4, 6, 5);
		scene.add(key);
		const rimA = new THREE.PointLight(0x4f7bff, 30, 30);
		rimA.position.set(-6, 2, -4);
		scene.add(rimA);
		const rimB = new THREE.PointLight(0xff4fa3, 26, 30);
		rimB.position.set(5, -3, -3);
		scene.add(rimB);
		scene.add(new THREE.AmbientLight(0xffffff, 0.35));

		controls = new OrbitControls(camera, renderer.domElement);
		controls.enableDamping = true;
		controls.dampingFactor = 0.08;
		controls.autoRotate = true;
		controls.autoRotateSpeed = 1.3;
		controls.enablePan = false;
		controls.minDistance = 2;
		controls.maxDistance = 20;

		loader = new GLTFLoader();
		loadModel(0);

		const onResize = (): void => {
			if (!renderer || !camera || !container) return;
			const cw = container.clientWidth || window.innerWidth;
			const ch = container.clientHeight || window.innerHeight;
			renderer.setSize(cw, ch);
			camera.aspect = cw / ch;
			camera.updateProjectionMatrix();
		};
		window.addEventListener("resize", onResize);
		(container as HTMLElement & { __onResize?: () => void }).__onResize = onResize;

		const animate = (): void => {
			raf = requestAnimationFrame(animate);
			controls?.update();
			renderer?.render(scene as THREE.Scene, camera as THREE.PerspectiveCamera);
		};
		animate();
	}

	function teardown(): void {
		if (raf) cancelAnimationFrame(raf);
		raf = 0;
		if (container) {
			const onResize = (container as HTMLElement & { __onResize?: () => void }).__onResize;
			if (onResize) window.removeEventListener("resize", onResize);
		}
		disposeObject(current);
		if (current && scene) scene.remove(current);
		current = null;

		scene?.traverse((obj) => {
			const mesh = obj as THREE.Mesh;
			if (mesh.geometry) mesh.geometry.dispose();
		});

		pmrem?.dispose();
		pmrem = null;

		if (renderer) {
			renderer.dispose();
			renderer.forceContextLoss();
			renderer.domElement?.parentElement?.removeChild(renderer.domElement);
		}
		renderer = null;
		scene = null;
		camera = null;
		controls = null;
		loader = null;
	}

	return {
		mount() {
			if (renderer) return; // 已挂载
			container = document.getElementById("lab-canvas");
			if (!container) return;
			buildScene();
		},
		unmount() {
			teardown();
		},
		switchModel(index: number) {
			if (index < 0 || index >= LAB_MODELS.length) return;
			loadModel(index);
		},
		setAutoRotate(on: boolean) {
			if (controls) controls.autoRotate = on;
		},
		setWireframe(on: boolean) {
			wireframe = on;
			if (!current) return;
			current.traverse((c) => {
				const mesh = c as THREE.Mesh;
				const m = mesh.material as THREE.MeshStandardMaterial | undefined;
				if (m && "wireframe" in m) m.wireframe = on;
			});
		},
		disposed() {
			return renderer === null;
		},
	};
}

export { isLabPath };
