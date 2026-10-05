/**
 * skill-fx-pass.ts — 自定义 ShaderPass：径向扭曲 + 色差
 *
 * EffectComposer 链中放在 RenderPass 之后、Bloom 之前。
 * 平时 uWave≈0 直接透传（无开销）；施放技能时由控制器把 uWave 推高后衰减，
 * 实现"咒力撕裂空间 + 色差"的效果。
 *
 * ShaderPass 接口签名：constructor(shader, options?)，需要 .uniforms（带 tDiffuse）
 * + .vertexShader + .fragmentShader。
 */
import * as THREE from "three";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";

const SkillFXShader = {
	uniforms: {
		tDiffuse: { value: null as THREE.Texture | null },
		uWave: { value: 0 }, // 0..1，冲击强度
		uCenter: { value: new THREE.Vector2(0.5, 0.55) }, // 冲击中心（屏幕 UV）
		uAberration: { value: 0.012 }, // 色差强度
		uDistortion: { value: 0.05 }, // 径向扭曲强度
		uTime: { value: 0 },
	},
	vertexShader: /* glsl */ `
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
		}
	`,
	fragmentShader: /* glsl */ `
		precision highp float;
		uniform sampler2D tDiffuse;
		uniform float uWave;
		uniform vec2 uCenter;
		uniform float uAberration;
		uniform float uDistortion;
		uniform float uTime;
		varying vec2 vUv;

		void main() {
			vec2 uv = vUv;
			float wave = uWave;

			// 径向扭曲：从 uCenter 向外推/拉 UV，模拟空间被撕扯
			vec2 toCenter = uv - uCenter;
			float dist = length(toCenter);
			float falloff = smoothstep(0.0, 0.55, 1.0 - dist);
			vec2 dir = normalize(toCenter + vec2(1e-5));
			float ring = sin(dist * 24.0 - uTime * 6.0) * 0.5 + 0.5;
			float warp = (ring - 0.5) * uDistortion * wave * falloff;
			uv += dir * warp;

			// 色差：RGB 三通道按径向方向偏移采样
			float aberr = uAberration * wave * falloff;
			vec2 offR = dir * aberr;
			vec2 offB = -dir * aberr;
			float r = texture2D(tDiffuse, uv + offR).r;
			float g = texture2D(tDiffuse, uv).g;
			float b = texture2D(tDiffuse, uv + offB).b;

			// 边缘轻微提亮（冲击波热感）
			float heat = wave * falloff * 0.18;
			vec3 col = vec3(r, g, b) + vec3(heat * 0.6, heat * 0.7, heat);

			gl_FragColor = vec4(col, 1.0);
		}
	`,
};

export function makeSkillFXPass(): ShaderPass {
	const pass = new ShaderPass(SkillFXShader as unknown as { uniforms: Record<string, { value: unknown }> });
	pass.uniforms.uWave.value = 0;
	pass.uniforms.uCenter.value = new THREE.Vector2(0.5, 0.55);
	return pass as unknown as ShaderPass;
}
