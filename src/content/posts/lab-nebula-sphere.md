---
title: 星云晶球：用噪声着色塑造体积光感
published: 2025-11-09
pinned: false
draft: false
description: 以 IcosahedronGeometry 为基底，用多频正弦噪声驱动顶点颜色，生成一个表面泛着星云般冷光的晶球，并在实验室中观察其菲涅尔边缘。
tags: [3D, Three.js, 着色, 可视化]
category: 3D 可视化
image: /gallery/lab-3d/poster-2.svg
slug: lab-nebula-sphere
---

「星云晶球」想模拟的是：一颗悬浮在深空里、表面流动着冷色等离子体的星球。

## 球体基底

`IcosahedronGeometry(1.1, 6)` 在细分 6 次后已有足够多的三角面，既能表现平滑球面，又能承载细腻的色彩过渡，且比等经纬度球更均匀、没有极点畸变。

## 用噪声"画"颜色

我们不用随机噪声贴图，而是用三个不同频率的正弦叠加，构造一个确定性的"伪噪声"场，把它映射到色相上：

```ts
const n =
  Math.sin(x * 4) * 0.5 +
  Math.cos(y * 5) * 0.3 +
  Math.sin(z * 6 + 1.7) * 0.2;
const h = (n * 0.5 + 0.5) * 0.8 + 0.05;
const c = new THREE.Color().setHSL(h % 1, 0.9, 0.58);
```

蓝—青—紫的色带在球面上缓慢起伏，配合 `RoomEnvironment` 提供的环境反射，边缘会出现柔和的菲涅尔高光，像真有一层大气。

## 为什么是程序化

整个晶球只有一个 `.glb` 文件、零外部贴图。构建时由 `scripts/generate-models.ts` 用 GLTFExporter 以二进制导出，体积不到 130 KiB。去 [实验室](/lab/) 拖一拖就知道了。
