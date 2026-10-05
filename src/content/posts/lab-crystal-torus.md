---
title: 水晶环结：参数化几何与顶点色的电影感渲染
published: 2025-11-02
pinned: false
draft: false
description: 用 Three.js 的 TorusKnotGeometry 配合逐顶点 HSL 着色，生成一个自带彩虹光泽的水晶环结模型，并在实验室中实时旋转观赏。
tags: [3D, Three.js, 可视化, WebGL]
category: 3D 可视化
image: /gallery/lab-3d/poster-1.svg
slug: lab-crystal-torus
---

「水晶环结」是实验室里最像珠宝的一件作品。它没有任何贴图，全靠几何与颜色本身撑起质感。

## 几何从一条曲线开始

`TorusKnotGeometry` 把一条在环面上打结的曲线扫描成管状曲面。我们用较大的分段数（`tubularSegments = 260`、`radialSegments = 36`）让表面足够光滑，避免低模的棱角破坏「水晶」的通透感。

```ts
const geo = new THREE.TorusKnotGeometry(0.85, 0.3, 260, 36);
```

## 逐顶点着色

不贴图也能有彩色，关键是给几何体写 `color` 属性，并在材质上开 `vertexColors: true`。颜色由顶点在环上的角度决定，映射到 HSL 色环，于是整条结自然呈现一圈渐变彩虹。

```ts
colorize(geo, (x, y, z) => {
  const h = (Math.atan2(z, x) / (Math.PI * 2) + 0.5 + y * 0.15) % 1;
  const c = new THREE.Color().setHSL((h + 1) % 1, 0.85, 0.6);
  return [c.r, c.g, c.b];
});
```

再叠加一点自发光（`emissiveIntensity: 0.25`），即使没有强光照，环结也像在体内发光。

## 在实验室里看

打开 [3D 实验室](/lab/)，点选「水晶环结」，用鼠标拖拽旋转、滚轮缩放。自动旋转开启时，彩虹光泽会随角度流动——这正是顶点色 + 金属度 + 环境反射共同作用的电影感来源。

> 提示：右侧工具台的「音效」开启后，切页与点击都会有程序化合成的音效反馈。
