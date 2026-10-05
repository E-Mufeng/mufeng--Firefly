---
title: 螺旋星系：曲线管几何与色彩渐变
published: 2025-11-30
pinned: false
draft: false
description: 用一条三维螺旋曲线扫出 TubeGeometry，生成一条自内向外盘旋、颜色随角度渐变的星系悬臂，是实验室里最有"宇宙感"的一件。
tags: [3D, Three.js, 曲线, 可视化]
category: 3D 可视化
image: /gallery/lab-3d/poster-5.svg
slug: lab-spiral-galaxy
---

「螺旋星系」把前面几件的思路合在了一起：参数化曲线 + 顶点色 + 程序化生成。

## 先画一条螺旋

我们沿角度 `θ` 推进，半径 `r` 从中心向外线性增长，同时让 Y 做轻微起伏，得到一条有体积感的螺旋：

```ts
for (let i = 0; i <= N; i++) {
  const t = i / N;
  const ang = t * Math.PI * 2 * 3.2;   // 3.2 圈
  const r = 0.15 + t * 1.25;
  pts.push(new THREE.Vector3(
    Math.cos(ang) * r,
    Math.sin(t * Math.PI * 4) * 0.18 * (1 - t),
    Math.sin(ang) * r,
  ));
}
const curve = new THREE.CatmullRomCurve3(pts);
const geo = new THREE.TubeGeometry(curve, 400, 0.05, 10, false);
```

`TubeGeometry` 沿曲线扫出一根管子，400 段让它足够顺滑。

## 颜色沿悬臂流动

顶点色由顶点在 XZ 平面上的角度决定，于是整条悬臂从内到外走完一整圈色环——像星系核心偏暖、外缘偏冷。

```ts
colorize(geo, (x, y, z) => {
  const h = (Math.atan2(z, x) / (Math.PI * 2) + 0.5) % 1;
  const c = new THREE.Color().setHSL(h, 0.9, 0.62);
  return [c.r, c.g, c.b];
});
```

## 为什么是管而不是点

星系常用"粒子"表现，但粒子导出 `.glb` 兼容性差、且依赖着色器才好看。用 `TubeGeometry` 把同一条曲线变成连续实体，既保证在任意 glTF 查看器里都能正确显示，又保留了流动的光带质感。

在 [3D 实验室](/lab/) 里开自动旋转盯着它看一会儿，你会发现它比静态图"活"得多。
