/**
 * generate-posters.ts — 程序化生成 5 张 3D 文章封面 SVG 到 public/gallery/lab-3d/
 * 作为 3D 可视化文章的卡片封面（公开路径 /gallery/lab-3d/poster-N.svg）
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type Poster = {
	idx: number;
	title: string;
	sub: string;
	c1: string;
	c2: string;
};

const POSTERS: Poster[] = [
	{ idx: 1, title: "水晶环结", sub: "参数化几何与顶点色渲染", c1: "#7c3aed", c2: "#ec4899" },
	{ idx: 2, title: "星云晶球", sub: "噪声着色塑造体积光感", c1: "#2563eb", c2: "#06b6d4" },
	{ idx: 3, title: "六棱矩阵", sub: "实例阵列与材质复用", c1: "#059669", c2: "#10b981" },
	{ idx: 4, title: "波动网格", sub: "顶点位移艺术", c1: "#ea580c", c2: "#ef4444" },
	{ idx: 5, title: "螺旋星系", sub: "曲线管几何与色彩渐变", c1: "#4f46e5", c2: "#a855f7" },
];

const W = 828;
const H = 466;

function svg(p: Poster): string {
	return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="g${p.idx}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${p.c1}"/>
      <stop offset="1" stop-color="${p.c2}"/>
    </linearGradient>
    <radialGradient id="r${p.idx}" cx="0.72" cy="0.28" r="0.85">
      <stop offset="0" stop-color="#ffffff" stop-opacity="0.38"/>
      <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g${p.idx})"/>
  <rect width="${W}" height="${H}" fill="url(#r${p.idx})"/>
  <circle cx="640" cy="120" r="96" fill="#ffffff" opacity="0.12"/>
  <circle cx="710" cy="372" r="58" fill="#000000" opacity="0.14"/>
  <circle cx="120" cy="400" r="40" fill="#ffffff" opacity="0.10"/>
  <text x="48" y="218" font-family="'PingFang SC','Microsoft YaHei',sans-serif" font-size="44" font-weight="700" fill="#ffffff">${p.title}</text>
  <text x="48" y="258" font-family="'PingFang SC','Microsoft YaHei',sans-serif" font-size="20" fill="#ffffff" opacity="0.88">${p.sub}</text>
  <text x="48" y="424" font-family="'PingFang SC','Microsoft YaHei',sans-serif" font-size="15" letter-spacing="2" fill="#ffffff" opacity="0.7">3D 可视化 · 实验室</text>
</svg>
`;
}

const outDir = resolve(process.cwd(), "public/gallery/lab-3d");
mkdirSync(outDir, { recursive: true });
for (const p of POSTERS) {
	writeFileSync(resolve(outDir, `poster-${p.idx}.svg`), svg(p), "utf8");
	console.log(`  ✓ poster-${p.idx}.svg (${p.title})`);
}
console.log("[generate-posters] 完成：public/gallery/lab-3d/poster-*.svg");
