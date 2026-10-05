---
title: 六棱矩阵：程序化实例阵列与材质复用
published: 2025-11-16
pinned: false
draft: false
description: 三个六棱柱沿轴向错位排布，各自拥有独立色相与金属度，演示了如何用同一套材质逻辑批量生成风格统一的几何体群。
tags: [3D, Three.js, 阵列, 可视化]
category: 3D 可视化
image: /gallery/lab-3d/poster-3.svg
slug: lab-hex-prism
---

「六棱矩阵」是实验室里最"工程化"的一件：它讲的是**复用**——用一段循环生成三个风格一致、细节各异的棱柱。

## 同一个工厂，三种性格

`CylinderGeometry(0.55, 0.55, 1.7, 6)` 是个正六边形截面的柱体。我们把它放进一个循环，给每个实例分配不同色相，并沿 X 轴错位排开：

```ts
const hues = [0.0, 0.33, 0.66];
hues.forEach((h, idx) => {
  const geo = new THREE.CylinderGeometry(0.55, 0.55, 1.7, 6, 1);
  colorize(geo, () => {
    const c = new THREE.Color().setHSL(h, 0.85, 0.6);
    return [c.r, c.g, c.b];
  });
  const m = new THREE.Mesh(geo, stdMat([h, 0.2, 1 - h], 0.22));
  m.position.set((idx - 1) * 1.0, 0, 0);
  m.rotation.z = (idx * Math.PI) / 6;
  grp.add(m);
});
```

色相 `0 / 0.33 / 0.66` 刚好在色环上相隔 120°，于是红、绿、蓝三棱柱并列时形成稳定的对比，不会互相"抢色"。

## 复用带来的好处

材质函数 `stdMat()` 被三次调用，但每个实例拿到的是独立材质——既能分别调金属度，又不增加构建复杂度。这种"一个生成器 + 参数数组"的写法，正是后面「螺旋星系」「宝石簇」的共通思路。

去 [实验室](/lab/) 看六个模型轮播时，留意六棱矩阵是怎么用最少代码撑起一块版面的。
