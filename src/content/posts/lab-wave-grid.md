---
title: 波动网格：GPU 之外的顶点位移艺术
published: 2025-11-23
pinned: false
draft: false
description: 在一张细分平面网格上，用 CPU 端的正弦叠加直接改写每个顶点的 Z 坐标，生成起伏的波动地表，并用高度映射顶点颜色。
tags: [3D, Three.js, 顶点位移, 可视化]
category: 3D 可视化
image: /gallery/lab-3d/poster-4.svg
slug: lab-wave-grid
---

「波动网格」回到最朴素也最迷人的一种 3D 手法：**直接搬动顶点**。

## 细分平面

`PlaneGeometry(2.6, 2.6, 90, 90)` 是一张 91×91 的顶点网格。我们遍历每个顶点，按它在 XY 上的位置，用三组正弦波叠加算出目标高度，写回 Z：

```ts
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
```

改完别忘了 `computeVertexNormals()`——法线不重算，光照会是错的，网格会显得"平"。

## 高度即颜色

颜色同样由高度驱动：波峰偏暖、波谷偏冷。于是即便只有一份几何、零贴图，你也能一眼读出地形的起伏。

```ts
colorize(geo, (_x, _y, z) => {
  const t = Math.min(1, Math.max(0, (z + 0.7) / 1.4));
  const c = new THREE.Color().setHSL(0.58 - t * 0.5, 0.85, 0.4 + t * 0.3);
  return [c.r, c.g, c.b];
});
```

## 一点延伸

在浏览器里，这种位移通常会放到顶点着色器（Shader）里跑，让 GPU 每帧实时波动。本例放在构建期算好并烘进 `.glb`，好处是**任何设备打开都零成本**——这也是为什么实验室能流畅轮播六个模型。

[去实验室转一圈 →](/lab/)
