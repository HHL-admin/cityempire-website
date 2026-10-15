/*
 * 城池帝国 · 三维城池渲染（CityView）
 *
 * 风格：等距俯视的"沙盘"城池——厚重城墙与城楼、内河水道分隔的街区、
 * 金顶宫殿、青瓦民居、田地 / 矿场 / 林场，外围草地、河流与拱桥。
 * 几何与贴图全部程序化生成（Canvas 贴图 + 法线贴图），离线可用。
 *
 * 依赖：vendor/three.min.js（r15x，全局 THREE）与 cities.html 中的 Game。
 * 对外接口与旧版一致：init / show / setActive / selectBuilding / syncBuildings
 */
(function () {
  'use strict';
  if (!window.THREE) return;
  const T = window.THREE;

  /* ================= 基础工具 ================= */
  function mulberry(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const R = mulberry(20261011);              // 固定种子：每次打开城池长得一样
  const rand = (a, b) => a + (b - a) * R();
  const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;

  function makeCanvas(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    if (draw) draw(c.getContext('2d'), w, h);
    return c;
  }
  function setSRGB(t) {
    if ('colorSpace' in t && T.SRGBColorSpace) t.colorSpace = T.SRGBColorSpace;
    else if (T.sRGBEncoding !== undefined) t.encoding = T.sRGBEncoding;
  }
  function tex(canvas, srgb = true) {
    const t = new T.CanvasTexture(canvas);
    t.wrapS = t.wrapT = T.RepeatWrapping;
    t.anisotropy = 4;
    if (srgb) setSRGB(t);
    return t;
  }
  /* 随机斑点（做旧、颗粒感） */
  function speckle(g, w, h, n, light, dark) {
    for (let i = 0; i < n; i++) {
      g.fillStyle = R() < .5 ? `rgba(255,255,255,${rand(0, light)})` : `rgba(0,0,0,${rand(0, dark)})`;
      const s = rand(1, 2.6);
      g.fillRect(rand(0, w), rand(0, h), s, s);
    }
  }
  /* 在可平铺画布上绘制（越界部分从对侧绘出，保证贴图无缝） */
  function wrapDraw(w, h, x, y, r, fn) {
    for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) {
      const px = x + ox, py = y + oy;
      if (px > -r && px < w + r && py > -r && py < h + r) fn(px, py);
    }
  }
  /* 高度图 → 法线贴图（循环采样，可平铺） */
  function heightToNormal(hc, strength) {
    const w = hc.width, h = hc.height;
    const src = hc.getContext('2d').getImageData(0, 0, w, h).data;
    return makeCanvas(w, h, g => {
      const img = g.createImageData(w, h), d = img.data;
      const at = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let nx = -(at(x + 1, y) - at(x - 1, y)) / 255 * strength;
        let ny = -(at(x, y - 1) - at(x, y + 1)) / 255 * strength;
        const l = Math.hypot(nx, ny, 1); const i = (y * w + x) * 4;
        d[i] = (nx / l * .5 + .5) * 255; d[i + 1] = (ny / l * .5 + .5) * 255; d[i + 2] = (1 / l * .5 + .5) * 255; d[i + 3] = 255;
      }
      g.putImageData(img, 0, 0);
    });
  }
  /* 砌块类贴图通用生成：返回 {map, normal} */
  function blockTexture(size, rows, opts) {
    const col = makeCanvas(size, size), hei = makeCanvas(size, size);
    const g = col.getContext('2d'), gh = hei.getContext('2d');
    g.fillStyle = opts.mortar; g.fillRect(0, 0, size, size);
    gh.fillStyle = '#303030'; gh.fillRect(0, 0, size, size);
    let y = 0;
    rows.forEach((rh, ri) => {
      let x = opts.stagger && ri % 2 ? -opts.bw / 2 : -rand(0, opts.bw);
      while (x < size) {
        const bw = opts.irregular ? rand(opts.bw * .55, opts.bw * 1.45) : opts.bw;
        const gap = opts.gap;
        const c = opts.color();
        const drawBrick = (px) => {
          g.fillStyle = c; g.fillRect(px + gap, y + gap, bw - gap * 2, rh - gap * 2);
          g.fillStyle = 'rgba(255,255,255,.10)'; g.fillRect(px + gap, y + gap, bw - gap * 2, 2);
          g.fillStyle = 'rgba(0,0,0,.16)'; g.fillRect(px + gap, y + rh - gap - 3, bw - gap * 2, 3);
          const v = 150 + rand(0, 70) | 0;
          gh.fillStyle = `rgb(${v},${v},${v})`; gh.fillRect(px + gap, y + gap, bw - gap * 2, rh - gap * 2);
          gh.fillStyle = `rgb(${v + 25},${v + 25},${v + 25})`; gh.fillRect(px + gap + 3, y + gap + 3, bw - gap * 2 - 6, rh - gap * 2 - 6);
        };
        drawBrick(x); if (x < 0) drawBrick(x + size); if (x + bw > size) drawBrick(x - size);
        x += bw;
      }
      y += rh;
    });
    speckle(g, size, size, size * 18, .09, .14);
    speckle(gh, size, size, size * 10, .2, .25);
    // 风化污渍
    for (let i = 0; i < 26; i++) {
      const x = rand(0, size), yy = rand(0, size), r = rand(20, 70);
      wrapDraw(size, size, x, yy, r, (px, py) => {
        const gr = g.createRadialGradient(px, py, 0, px, py, r);
        gr.addColorStop(0, opts.stain); gr.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = gr; g.fillRect(px - r, py - r, r * 2, r * 2);
      });
    }
    return { map: tex(col), normal: tex(heightToNormal(hei, opts.normal || 3), false) };
  }
  const rowsOf = (size, fn) => { const r = []; let s = 0; while (s < size) { let h = fn(); if (size - s - h < 14) h = size - s; r.push(h); s += h; } return r; };
  /* ================= 程序化贴图库 ================= */
  const TX = {};
  function buildTextures() {
    // 城墙：暖灰条石，错缝
    TX.wall = blockTexture(512, rowsOf(512, () => 42), {
      mortar: '#5d564b', bw: 96, gap: 2.5, stagger: true, irregular: true, normal: 4,
      color: () => hsl(rand(30, 42), rand(10, 20), rand(52, 64)), stain: 'rgba(40,46,30,.16)'
    });
    // 台基 / 墙基：深灰大块石
    TX.base = blockTexture(512, rowsOf(512, () => rand(56, 80)), {
      mortar: '#34322e', bw: 130, gap: 3, stagger: true, irregular: true, normal: 5,
      color: () => hsl(rand(28, 40), rand(5, 10), rand(34, 44)), stain: 'rgba(30,50,30,.22)'
    });
    // 地面铺装：米色方砖
    TX.paving = blockTexture(512, rowsOf(512, () => 64), {
      mortar: '#8e8371', bw: 64, gap: 2, stagger: false, irregular: false, normal: 2,
      color: () => hsl(rand(34, 42), rand(14, 22), rand(64, 74)), stain: 'rgba(80,70,50,.14)'
    });
    // 汉白玉
    TX.marble = blockTexture(256, rowsOf(256, () => 64), {
      mortar: '#b9b4a8', bw: 128, gap: 1.5, stagger: true, irregular: false, normal: 1.5,
      color: () => hsl(40, rand(8, 14), rand(84, 90)), stain: 'rgba(120,110,90,.08)'
    });
    // 城墙顶步道：木板 / 砖
    TX.walk = blockTexture(256, rowsOf(256, () => 32), {
      mortar: '#5b4a36', bw: 120, gap: 1.5, stagger: true, irregular: true, normal: 2,
      color: () => hsl(rand(28, 36), rand(22, 32), rand(42, 52)), stain: 'rgba(30,20,10,.18)'
    });
    TX.grass = groundTexture(512, [96, 34, 30], [[78, 40, 26], [70, 45, 34], [88, 30, 38], [52, 30, 30]], 'grass');
    TX.dirt = groundTexture(512, [34, 30, 46], [[30, 28, 38], [38, 26, 54], [28, 22, 34]], 'dirt');
    TX.earth = cliffTexture();
    TX.rock = groundTexture(256, [34, 6, 50], [[30, 6, 40], [40, 8, 60], [30, 4, 34]], 'rock');
    TX.roofGold = roofTexture([42, 88, 56], [34, 80, 36]);
    TX.roofTeal = roofTexture([176, 34, 42], [186, 40, 26]);
    TX.roofGrey = roofTexture([210, 8, 34], [210, 10, 20]);
    TX.roofRed = roofTexture([8, 52, 40], [4, 56, 24]);
    TX.thatch = thatchTexture();
    TX.plank = plankTexture();
    TX.water = waterNormal();
    TX.field = fieldTexture(false);
    TX.wheat = fieldTexture(true);
    TX.hallFacade = facadeTexture('hall');
    TX.houseFacade = facadeTexture('house');
    TX.shopFacade = facadeTexture('shop');
    TX.barrackFacade = facadeTexture('barrack');
    TX.blob = tex(makeCanvas(128, 128, (g) => {
      const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
      gr.addColorStop(0, 'rgba(0,0,0,.62)'); gr.addColorStop(.55, 'rgba(0,0,0,.28)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
    }));
    TX.soft = tex(makeCanvas(64, 64, (g) => {
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(.4, 'rgba(255,255,255,.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    }));
    TX.frame = tex(makeCanvas(256, 256, (g) => {
      for (let i = 0; i < 18; i++) {
        g.strokeStyle = `rgba(255,214,120,${(1 - i / 18) * .5})`; g.lineWidth = 2;
        g.strokeRect(i + 1, i + 1, 254 - i * 2, 254 - i * 2);
      }
      g.strokeStyle = 'rgba(255,246,210,1)'; g.lineWidth = 3; g.strokeRect(2, 2, 252, 252);
    }));
  }
  /* 草地 / 泥土 / 岩石：多层色斑 + 细节笔触 */
  function groundTexture(size, base, blotches, kind) {
    const hei = makeCanvas(size, size, g => { g.fillStyle = '#808080'; g.fillRect(0, 0, size, size); });
    const gh = hei.getContext('2d');
    const col = makeCanvas(size, size, g => {
      g.fillStyle = hsl(base[0], base[1], base[2]); g.fillRect(0, 0, size, size);
      for (let i = 0; i < 160; i++) {
        const b = blotches[i % blotches.length];
        const x = rand(0, size), y = rand(0, size), r = rand(18, 80);
        wrapDraw(size, size, x, y, r, (px, py) => {
          const gr = g.createRadialGradient(px, py, 0, px, py, r);
          gr.addColorStop(0, hsl(b[0], b[1], b[2], .42)); gr.addColorStop(1, hsl(b[0], b[1], b[2], 0));
          g.fillStyle = gr; g.fillRect(px - r, py - r, r * 2, r * 2);
        });
      }
      if (kind === 'grass') {
        for (let i = 0; i < 9000; i++) {
          const x = rand(0, size), y = rand(0, size), l = rand(2, 6);
          g.strokeStyle = hsl(rand(70, 105), rand(30, 50), rand(18, 46), rand(.35, .8));
          g.lineWidth = rand(.6, 1.4);
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + rand(-1.5, 1.5), y - l); g.stroke();
          gh.fillStyle = `rgba(255,255,255,${rand(.05, .25)})`; gh.fillRect(x, y - l, 1, l);
        }
        for (let i = 0; i < 90; i++) {   // 小花
          g.fillStyle = ['#e9e3b0', '#f0c86a', '#d9a0b8', '#ffffff'][i % 4];
          g.globalAlpha = .7; g.fillRect(rand(0, size), rand(0, size), 2, 2); g.globalAlpha = 1;
        }
      } else if (kind === 'dirt') {
        for (let i = 0; i < 700; i++) {
          const x = rand(0, size), y = rand(0, size), r = rand(1, 3.5);
          g.fillStyle = hsl(rand(25, 40), rand(10, 25), rand(30, 62), .7);
          g.beginPath(); g.arc(x, y, r, 0, 7); g.fill();
          gh.fillStyle = 'rgba(255,255,255,.35)'; gh.beginPath(); gh.arc(x, y, r, 0, 7); gh.fill();
        }
      } else {
        for (let i = 0; i < 70; i++) {
          g.strokeStyle = `rgba(20,18,16,${rand(.2, .5)})`; g.lineWidth = rand(.6, 1.6);
          let x = rand(0, size), y = rand(0, size); g.beginPath(); g.moveTo(x, y);
          for (let k = 0; k < 5; k++) { x += rand(-18, 18); y += rand(-18, 18); g.lineTo(x, y); }
          g.stroke();
        }
      }
      speckle(g, size, size, size * 12, .08, .12);
    });
    speckle(gh, size, size, size * 20, .25, .25);
    return { map: tex(col), normal: tex(heightToNormal(hei, kind === 'rock' ? 4 : 2), false) };
  }
  /* 地块侧面：草皮边 + 泥土断层 */
  function cliffTexture() {
    const size = 256;
    const col = makeCanvas(size, size, g => {
      const gr = g.createLinearGradient(0, 0, 0, size);
      gr.addColorStop(0, '#4f5b2a'); gr.addColorStop(.12, '#5f6a30'); gr.addColorStop(.2, '#6a5236');
      gr.addColorStop(.6, '#5a4430'); gr.addColorStop(1, '#3a2c22');
      g.fillStyle = gr; g.fillRect(0, 0, size, size);
      for (let i = 0; i < 40; i++) {
        g.fillStyle = `rgba(${rand(20, 60) | 0},${rand(15, 40) | 0},10,${rand(.1, .3)})`;
        g.fillRect(0, rand(size * .2, size), size, rand(2, 7));
      }
      for (let i = 0; i < 260; i++) {
        g.fillStyle = hsl(rand(20, 36), rand(5, 18), rand(30, 58), .8);
        const r = rand(1.5, 5); g.beginPath(); g.arc(rand(0, size), rand(size * .22, size), r, 0, 7); g.fill();
      }
      for (let i = 0; i < 500; i++) { // 草根垂挂
        g.strokeStyle = hsl(rand(70, 95), 40, rand(22, 40), .8); g.lineWidth = 1;
        const x = rand(0, size); g.beginPath(); g.moveTo(x, rand(0, size * .12)); g.lineTo(x + rand(-2, 2), rand(size * .14, size * .26)); g.stroke();
      }
      speckle(g, size, size, 3000, .08, .15);
    });
    return { map: tex(col), normal: null };
  }
  /* 瓦屋顶：筒瓦垄 + 横向瓦缝。col1 为亮部 hsl、col2 为暗部 hsl */
  function roofTexture(c1, c2) {
    const size = 256;
    const hei = makeCanvas(size, size);
    const gh = hei.getContext('2d');
    const col = makeCanvas(size, size, g => {
      const lanes = 16, lw = size / lanes;
      for (let i = 0; i < lanes; i++) {
        const gr = g.createLinearGradient(i * lw, 0, (i + 1) * lw, 0);
        gr.addColorStop(0, hsl(c2[0], c2[1], c2[2]));
        gr.addColorStop(.5, hsl(c1[0], c1[1], c1[2] + rand(-4, 4)));
        gr.addColorStop(1, hsl(c2[0], c2[1], c2[2] - 4));
        g.fillStyle = gr; g.fillRect(i * lw, 0, lw, size);
        const hg = gh.createLinearGradient(i * lw, 0, (i + 1) * lw, 0);
        hg.addColorStop(0, '#202020'); hg.addColorStop(.5, '#f0f0f0'); hg.addColorStop(1, '#202020');
        gh.fillStyle = hg; gh.fillRect(i * lw, 0, lw, size);
      }
      for (let y = 0; y < size; y += 16) {
        g.fillStyle = 'rgba(0,0,0,.28)'; g.fillRect(0, y, size, 2);
        g.fillStyle = 'rgba(255,255,255,.10)'; g.fillRect(0, y + 2, size, 1);
        gh.fillStyle = 'rgba(0,0,0,.5)'; gh.fillRect(0, y, size, 2);
      }
      speckle(g, size, size, 2400, .08, .16);
    });
    return { map: tex(col), normal: tex(heightToNormal(hei, 3), false) };
  }
  function thatchTexture() {
    const size = 256;
    const col = makeCanvas(size, size, g => {
      g.fillStyle = '#9a7a40'; g.fillRect(0, 0, size, size);
      for (let i = 0; i < 4000; i++) {
        g.strokeStyle = hsl(rand(36, 46), rand(40, 60), rand(28, 62), .7); g.lineWidth = rand(.6, 1.6);
        const x = rand(0, size), y = rand(0, size); g.beginPath(); g.moveTo(x, y); g.lineTo(x + rand(-2, 2), y + rand(6, 16)); g.stroke();
      }
    });
    return { map: tex(col), normal: null };
  }
  function plankTexture() {
    const size = 256;
    const col = makeCanvas(size, size, g => {
      const n = 8, h = size / n;
      for (let i = 0; i < n; i++) {
        g.fillStyle = hsl(rand(22, 30), rand(30, 42), rand(26, 38)); g.fillRect(0, i * h, size, h);
        for (let k = 0; k < 30; k++) { g.fillStyle = `rgba(0,0,0,${rand(.05, .18)})`; g.fillRect(0, i * h + rand(0, h), size, 1); }
        g.fillStyle = 'rgba(0,0,0,.45)'; g.fillRect(0, i * h, size, 2);
      }
      speckle(g, size, size, 1500, .06, .12);
    });
    return { map: tex(col), normal: null };
  }
  function waterNormal() {
    const size = 256;
    const hei = makeCanvas(size, size, g => {
      g.fillStyle = '#808080'; g.fillRect(0, 0, size, size);
      for (let i = 0; i < 220; i++) {
        const x = rand(0, size), y = rand(0, size), r = rand(6, 30), v = R() < .5 ? 255 : 0;
        wrapDraw(size, size, x, y, r, (px, py) => {
          const gr = g.createRadialGradient(px, py, 0, px, py, r);
          gr.addColorStop(0, `rgba(${v},${v},${v},.22)`); gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
          g.fillStyle = gr; g.fillRect(px - r, py - r, r * 2, r * 2);
        });
      }
    });
    return tex(heightToNormal(hei, 2.2), false);
  }
  /* 田地：菜畦 / 麦田（条垄） */
  function fieldTexture(wheat) {
    const size = 256;
    const col = makeCanvas(size, size, g => {
      g.fillStyle = '#6b4e2e'; g.fillRect(0, 0, size, size);
      const rows = 12, rh = size / rows;
      for (let i = 0; i < rows; i++) {
        const y = i * rh;
        g.fillStyle = 'rgba(40,26,14,.6)'; g.fillRect(0, y, size, 3);
        for (let k = 0; k < 90; k++) {
          const x = rand(0, size), yy = y + rand(4, rh - 3);
          if (wheat) { g.strokeStyle = hsl(rand(40, 50), rand(55, 75), rand(50, 68)); g.lineWidth = 1.2; g.beginPath(); g.moveTo(x, yy + 3); g.lineTo(x + rand(-1, 1), yy - 4); g.stroke(); }
          else { g.fillStyle = hsl(rand(85, 120), rand(40, 60), rand(24, 44)); g.beginPath(); g.arc(x, yy, rand(2, 4.5), 0, 7); g.fill(); }
        }
      }
      speckle(g, size, size, 1600, .06, .1);
    });
    return { map: tex(col), normal: null };
  }
  /* 建筑立面：红柱、格窗、白墙、木梁（横向可平铺，一格为一开间） */
  function facadeTexture(kind) {
    const W = 256, H = 256;
    const col = makeCanvas(W, H, g => {
      const wallC = kind === 'hall' ? '#7d1f17' : kind === 'barrack' ? '#6f3a26' : '#ddd3bd';
      g.fillStyle = wallC; g.fillRect(0, 0, W, H);
      if (kind !== 'hall') { // 白墙脏旧
        for (let i = 0; i < 30; i++) { const gr = g.createLinearGradient(0, H * .6, 0, H); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(70,60,40,.22)'); g.fillStyle = gr; g.fillRect(rand(0, W), H * .6, rand(20, 60), H * .4); }
      }
      // 额枋（上部彩画梁）
      g.fillStyle = kind === 'hall' ? '#1f4d4a' : '#4b2f1e'; g.fillRect(0, 0, W, 34);
      if (kind === 'hall') {
        for (let x = 0; x < W; x += 32) { g.fillStyle = '#d9a640'; g.fillRect(x + 4, 8, 24, 4); g.fillStyle = '#2f7a74'; g.fillRect(x + 8, 16, 16, 10); g.fillStyle = '#e2c27a'; g.fillRect(x + 14, 18, 4, 6); }
      }
      g.fillStyle = 'rgba(0,0,0,.35)'; g.fillRect(0, 34, W, 4);
      // 柱
      const pillar = kind === 'house' || kind === 'shop' ? '#5a3522' : '#a3281d';
      for (const x of [0, W - 18]) { g.fillStyle = pillar; g.fillRect(x, 0, 18, H); g.fillStyle = 'rgba(255,255,255,.14)'; g.fillRect(x + 4, 0, 3, H); }
      // 门窗
      const wx = 40, ww = W - 80, wy = kind === 'shop' ? 60 : 64, wh = kind === 'shop' ? 170 : 120;
      g.fillStyle = kind === 'hall' ? '#4a120c' : '#3c2618'; g.fillRect(wx, wy, ww, wh);
      g.strokeStyle = kind === 'hall' ? '#c8933a' : '#8a6040'; g.lineWidth = 3;
      for (let x = wx; x <= wx + ww; x += 22) { g.beginPath(); g.moveTo(x, wy); g.lineTo(x, wy + wh); g.stroke(); }
      for (let y = wy; y <= wy + wh; y += 22) { g.beginPath(); g.moveTo(wx, y); g.lineTo(wx + ww, y); g.stroke(); }
      g.lineWidth = 6; g.strokeRect(wx, wy, ww, wh);
      // 窗内暖光
      const glow = g.createLinearGradient(0, wy, 0, wy + wh);
      glow.addColorStop(0, 'rgba(255,190,90,.20)'); glow.addColorStop(1, 'rgba(255,150,60,.05)');
      g.fillStyle = glow; g.fillRect(wx, wy, ww, wh);
      // 槛墙 / 台座
      g.fillStyle = kind === 'hall' ? '#6b5d4f' : '#7d7466'; g.fillRect(0, H - 26, W, 26);
      g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(0, H - 26, W, 3);
      speckle(g, W, H, 2400, .05, .12);
    });
    // 夜间自发光：只点亮窗格
    const emi = makeCanvas(W, H, g => {
      g.fillStyle = '#000'; g.fillRect(0, 0, W, H);
      const wx = 40, ww = W - 80, wy = kind === 'shop' ? 60 : 64, wh = kind === 'shop' ? 170 : 120;
      g.fillStyle = '#ffb35a'; g.fillRect(wx + 4, wy + 4, ww - 8, wh - 8);
      g.strokeStyle = '#000'; g.lineWidth = 3;
      for (let x = wx; x <= wx + ww; x += 22) { g.beginPath(); g.moveTo(x, wy); g.lineTo(x, wy + wh); g.stroke(); }
      for (let y = wy; y <= wy + wh; y += 22) { g.beginPath(); g.moveTo(wx, y); g.lineTo(wx + ww, y); g.stroke(); }
    });
    return { map: tex(col), emissive: tex(emi) };
  }
  /* ================= 材质库 ================= */
  const M = {};
  function std(o) { return new T.MeshStandardMaterial(Object.assign({ roughness: .85, metalness: 0, envMapIntensity: .45 }, o)); }
  function fromTx(t, o) { return std(Object.assign({ map: t.map, normalMap: t.normal || null }, o)); }
  function buildMaterials() {
    M.wall = fromTx(TX.wall, { roughness: .92 });
    M.base = fromTx(TX.base, { roughness: .95 });
    M.paving = fromTx(TX.paving, { roughness: .9 });
    M.marble = fromTx(TX.marble, { roughness: .55 });
    M.walk = fromTx(TX.walk, { roughness: .9 });
    M.grass = fromTx(TX.grass, { roughness: 1 });
    M.dirt = fromTx(TX.dirt, { roughness: 1 });
    M.rockGround = fromTx(TX.rock, { roughness: .95 });
    M.earth = fromTx(TX.earth, { roughness: 1 });
    const DS = T.DoubleSide;   // 屋面双面：低角度也能看到檐下
    M.roofGold = fromTx(TX.roofGold, { roughness: .38, metalness: .35, envMapIntensity: 1, side: DS });
    M.roofTeal = fromTx(TX.roofTeal, { roughness: .5, metalness: .12, side: DS });
    M.roofGrey = fromTx(TX.roofGrey, { roughness: .75, side: DS });
    M.roofRed = fromTx(TX.roofRed, { roughness: .55, metalness: .1, side: DS });
    M.thatch = fromTx(TX.thatch, { roughness: 1, side: DS });
    M.plank = fromTx(TX.plank, { roughness: .9 });
    M.field = fromTx(TX.field, { roughness: 1 });
    M.wheat = fromTx(TX.wheat, { roughness: 1 });
    const facade = (t) => std({ map: t.map, emissiveMap: t.emissive, emissive: new T.Color(0xffa040), emissiveIntensity: 0, roughness: .8 });
    M.hallFacade = facade(TX.hallFacade); M.houseFacade = facade(TX.houseFacade);
    M.shopFacade = facade(TX.shopFacade); M.barrackFacade = facade(TX.barrackFacade);
    M.facades = [M.hallFacade, M.houseFacade, M.shopFacade, M.barrackFacade];
    M.red = std({ color: 0x9a2418, roughness: .5 });
    M.redWall = std({ color: 0x8d2a1e, roughness: .85 });
    M.darkWood = std({ color: 0x3a281c, roughness: .8 });
    M.wood = std({ color: 0x7a5434, roughness: .85 });
    M.log = std({ color: 0x8a6440, roughness: .9 });
    M.gold = std({ color: 0xe0ae48, roughness: .28, metalness: .9, envMapIntensity: 1.2 });
    M.bracket = std({ color: 0x2c5a52, roughness: .7 });
    M.dark = std({ color: 0x14100c, roughness: 1 });
    M.darkIn = std({ color: 0x1b1611, roughness: 1, side: T.DoubleSide });   // 门洞内壁（需双面）
    M.carpet = std({ color: 0xa8231c, roughness: .9 });
    M.iron = std({ color: 0x3c3f42, roughness: .45, metalness: .8 });
    M.cloth = std({ color: 0xc8b48a, roughness: 1, side: T.DoubleSide });
    M.flagRed = std({ color: 0xb8231b, roughness: .8, side: T.DoubleSide });
    M.flagGold = std({ color: 0xe6b437, roughness: .7, side: T.DoubleSide });
    M.lantern = std({ color: 0xd8341f, emissive: new T.Color(0xff5a22), emissiveIntensity: .25, roughness: .6 });
    M.water = std({ color: 0x2c6460, roughness: .08, metalness: .25, normalMap: TX.water, transparent: true, opacity: .9 });
    M.water.normalScale = new T.Vector2(.55, .55);
    M.riverBed = std({ color: 0x24362c, roughness: 1 });
    M.foliage = std({ color: 0xffffff, roughness: .9 });   // 配合 instanceColor 着色
    M.instWhite = std({ color: 0xffffff, roughness: .85 });
    M.shadowBlob = new T.MeshBasicMaterial({ map: TX.blob, transparent: true, depthWrite: false });
  }
  /* ================= 几何工具 ================= */
  /** 世界尺度 UV 的盒子：贴图按 s 米一个循环平铺，避免拉伸 */
  function boxGeo(w, h, d, s = 3) {
    const g = new T.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    const dims = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
    for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) {
      const k = f * 4 + i; uv.setXY(k, uv.getX(k) * dims[f][0] / s, uv.getY(k) * dims[f][1] / s);
    }
    return g;
  }
  /** 立面盒子：四周按开间重复立面贴图，纵向完整一张 */
  function facadeGeo(w, h, d, bay) {
    const g = new T.BoxGeometry(w, h, d);
    const uv = g.attributes.uv;
    const reps = [Math.max(1, Math.round(d / bay)), Math.max(1, Math.round(d / bay)), 1, 1, Math.max(1, Math.round(w / bay)), Math.max(1, Math.round(w / bay))];
    for (let f = 0; f < 6; f++) for (let i = 0; i < 4; i++) { const k = f * 4 + i; uv.setX(k, uv.getX(k) * reps[f]); }
    return g;
  }
  /** 挤出多边形（pts 为世界 [x,z]），顶面在 y=top，厚度 depth；返回带 [顶面, 侧面] 两组的几何 */
  function slabGeo(pts, top, depth, capScale = 4, sideScale = 3, sideFit = false) {
    const shape = new T.Shape(pts.map(([x, z]) => new T.Vector2(x, -z)));
    const g = new T.ExtrudeGeometry(shape, { depth, bevelEnabled: false, curveSegments: 1 });
    const pos = g.attributes.position, uv = g.attributes.uv;
    const capCount = g.groups[0].count;
    for (let i = 0; i < pos.count; i++) {
      if (i < capCount) uv.setXY(i, pos.getX(i) / capScale, pos.getY(i) / capScale);
      else uv.setXY(i, uv.getX(i) / sideScale, sideFit ? pos.getZ(i) / depth : pos.getZ(i) / sideScale);
    }
    g.rotateX(-Math.PI / 2);
    g.translate(0, top - depth, 0);
    return g;
  }
  /** 中式庑殿 / 攒尖屋顶：凹曲屋面 + 起翘翼角。w、d 为檐口外沿尺寸 */
  function roofGeo(w, d, h, o = {}) {
    const ridgeHalf = (o.ridge !== undefined ? o.ridge : Math.max(0, w - d * .9)) / 2;
    const curl = o.curl !== undefined ? o.curl : h * .32;
    const t1 = o.t1 || 1, NR = o.nr || 9, S = o.s || 10;   // nr / s：远景低模用更少的分段
    const pos = [], uvs = [], idx = [];
    const slant = Math.hypot(h, d / 2);
    const ring = t => [w / 2 + (ridgeHalf - w / 2) * t, d / 2 * (1 - t), h * Math.pow(t, 1.75)];
    for (let s = 0; s < 4; s++) {
      const base = pos.length / 3;
      for (let r = 0; r <= NR; r++) {
        const t = t1 * r / NR; const [ex, ez, y] = ring(t);
        const C = [[-ex, ez], [ex, ez], [ex, -ez], [-ex, -ez]];
        const A = C[s], B = C[(s + 1) % 4];
        const len = s % 2 ? d : w;
        for (let i = 0; i <= S; i++) {
          const a = i / S, cf = Math.pow(Math.abs(2 * a - 1), 3);
          pos.push(A[0] + (B[0] - A[0]) * a, y + curl * Math.pow(1 - t, 2.2) * cf, A[1] + (B[1] - A[1]) * a);
          uvs.push(a * len / 1.4, t * slant / 1.4);
        }
      }
      for (let r = 0; r < NR; r++) for (let i = 0; i < S; i++) {
        const a = base + r * (S + 1) + i, b = a + S + 1;
        idx.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx); g.computeVertexNormals();
    g.userData = { ring, curl, ridgeHalf, t1 };
    return g;
  }
  /** 屋脊线（四条垂脊）沿翼角曲线生成的细管 */
  function hipRidgeGeos(roof, radius) {
    const { ring, curl, t1 } = roof.userData; const out = [];
    for (const [sx, sz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const pts = [];
      for (let k = 0; k <= 8; k++) {
        const t = t1 * k / 8; const [ex, ez, y] = ring(t);
        pts.push(new T.Vector3(ex * sx, y + curl * Math.pow(1 - t, 2.2) + radius * .6, ez * sz));
      }
      out.push(new T.TubeGeometry(new T.CatmullRomCurve3(pts), 10, radius, 5, false));
    }
    return out;
  }
  /** 沿样条的带状面（河流、道路） */
  function ribbonGeo(curve, width, y, n = 80, vScale = 4) {
    const pos = [], uvs = [], idx = [];
    const L = curve.getLength();
    for (let i = 0; i <= n; i++) {
      const t = i / n, p = curve.getPointAt(t), tg = curve.getTangentAt(t);
      const nx = -tg.z, nz = tg.x, l = Math.hypot(nx, nz) || 1;
      pos.push(p.x + nx / l * width / 2, y, p.z + nz / l * width / 2, p.x - nx / l * width / 2, y, p.z - nz / l * width / 2);
      uvs.push(0, t * L / vScale, width / vScale, t * L / vScale);
      if (i < n) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const g = new T.BufferGeometry();
    g.setAttribute('position', new T.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new T.Float32BufferAttribute(uvs, 2));
    g.setIndex(idx); g.computeVertexNormals();
    return g;
  }
  /** 将顶点随机扰动，让树冠 / 岩石更自然 */
  function jitter(g, amt) {
    const p = g.attributes.position, map = new Map();
    for (let i = 0; i < p.count; i++) {
      const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
      if (!map.has(k)) map.set(k, 1 + rand(-amt, amt));
      const s = map.get(k); p.setXYZ(i, p.getX(i) * s, p.getY(i) * s, p.getZ(i) * s);
    }
    g.computeVertexNormals(); return g;
  }
  /* ================= 城池布局（单位：米，x 向东，z 向南） ================= */
  // 外城墙轮廓：仿沙盘的错落十字形城池
  const FORT = [[-16, -3], [-7, -3], [-7, -10], [3, -10], [3, -12], [16, -12], [16, 9], [4, 9], [4, 12], [-12, 12], [-12, 6], [-16, 6]];
  // 城内街区（被内河分隔的台地）
  const DIST = {
    palace: { poly: [[3.8, -11], [15, -11], [15, -1.6], [3.8, -1.6]], top: 1.0, mat: 'paving' },
    lumber: { poly: [[-6, -9], [1.8, -9], [1.8, -4.2], [-6, -4.2]], top: .35, mat: 'dirt' },
    farm: { poly: [[-15, -2], [-6.2, -2], [-6.2, 11], [-11, 11], [-11, 4.8], [-15, 4.8]], top: .35, mat: 'grass' },
    center: { poly: [[-4.8, -2.8], [2.4, -2.8], [2.4, -.3], [6, -.3], [6, 7.8], [3, 7.8], [3, 11], [-4.8, 11]], top: .35, mat: 'paving' },
    mine: { poly: [[7.4, -.3], [15, -.3], [15, 7.8], [7.4, 7.8]], top: .35, mat: 'rockGround' }
  };
  const WATER_Y = -.3;
  const GATES = [{ x: -1, z: 12, rot: 0 }, { x: 16, z: 3.5, rot: Math.PI / 2 }];

  function inPoly(x, z, poly) {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c;
    }
    return c;
  }
  function distToSeg(px, pz, ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, l = dx * dx + dz * dz;
    const t = l ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l)) : 0;
    return Math.hypot(px - ax - dx * t, pz - az - dz * t);
  }
  function distToPoly(px, pz, poly) {
    let d = Infinity;
    for (let i = 0; i < poly.length; i++) { const a = poly[i], b = poly[(i + 1) % poly.length]; d = Math.min(d, distToSeg(px, pz, a[0], a[1], b[0], b[1])); }
    return d;
  }
  function polyArea(p) { let a = 0; for (let i = 0; i < p.length; i++) { const [x1, z1] = p[i], [x2, z2] = p[(i + 1) % p.length]; a += x1 * z2 - x2 * z1; } return a / 2; }

  /* 场景全局句柄（由 CityView.init 赋值） */
  let root = null;
  const anim = { flags: [], walkers: null, walkerPaths: [], waterMats: [], lights: [], sparkles: null };

  function add(geo, mat, x = 0, y = 0, z = 0, parent = root, ry = 0, shadow = true) {
    const m = new T.Mesh(geo, mat);
    m.position.set(x, y, z); m.rotation.y = ry;
    m.castShadow = shadow; m.receiveShadow = true;
    parent.add(m); return m;
  }
  function group(x = 0, y = 0, z = 0, ry = 0, parent = root) {
    const g = new T.Group(); g.position.set(x, y, z); g.rotation.y = ry; parent.add(g); return g;
  }
  /* ================= 建筑构件 ================= */
  /**
   * 中式殿宇：台基 + 立面墙身 + 斗拱带 + 曲面屋顶（可重檐）
   * o: { w,d,h, facade, roof, roofH, overhang, double, base, ridge, finial }
   */
  function pavilion(parent, x, z, o, ry = 0) {
    const g = group(x, o.y || 0, z, ry, parent);
    const w = o.w, d = o.d, h = o.h, ov = o.overhang || .45;
    let y = 0;
    if (o.base !== false) {
      const bh = o.baseH || .25;
      add(boxGeo(w + .5, bh, d + .5, 2), o.baseMat || M.base, 0, bh / 2, 0, g);
      y = bh;
    }
    add(facadeGeo(w, h, d, o.bay || 1.3), o.facade, 0, y + h / 2, 0, g);
    // 斗拱 / 额枋带
    add(boxGeo(w + .16, .14, d + .16, 2), M.bracket, 0, y + h + .02, 0, g);
    y += h + .06;
    const rh = o.roofH || Math.min(w, d) * .42;
    if (o.double) {
      // 下檐（只到屋面中段），上面再立一层墙身 + 上檐
      const low = roofGeo(w + ov * 2, d + ov * 2, rh * .9, { t1: .5, ridge: w - d * .9, nr: o.lo ? 2 : 0, s: o.lo ? 4 : 0 });
      add(low, o.roof, 0, y, 0, g);
      // 上层墙身必须盖住下檐顶部开口
      const [hx, hz, hy] = low.userData.ring(.5);
      const uy = y + hy - .05;
      const w2 = hx * 2 + .12, d2 = hz * 2 + .12, h2 = h * .55;
      add(facadeGeo(w2, h2, d2, o.bay || 1.3), o.facade, 0, uy + h2 / 2, 0, g);
      add(boxGeo(w2 + .14, .12, d2 + .14, 2), M.bracket, 0, uy + h2 + .02, 0, g);
      y = uy + h2 + .06;
      roofTop(g, w2 + ov * 2.1, d2 + ov * 2.1, rh * .95, o, y);
    } else {
      roofTop(g, w + ov * 2, d + ov * 2, rh, o, y);
    }
    return g;
  }
  function roofTop(g, rw, rd, rh, o, y) {
    const ridge = o.ridge !== undefined ? o.ridge : Math.max(0, rw - rd * .9);
    const geo = roofGeo(rw, rd, rh, { ridge, nr: o.lo ? 3 : 0, s: o.lo ? 4 : 0 });
    add(geo, o.roof, 0, y, 0, g);
    const ridgeMat = o.ridgeMat || (o.roof === M.roofGold ? M.gold : M.roofGrey);
    if (o.lo) {   // 低模：只保留正脊和简化宝顶
      if (ridge > .05) add(boxGeo(ridge + .12, rh * .12, rh * .1, 1), ridgeMat, 0, y + rh + rh * .05, 0, g);
      else if (o.finial !== false) add(new T.ConeGeometry(rh * .08, rh * .35, 4), M.gold, 0, y + rh + rh * .15, 0, g);
      return;
    }
    hipRidgeGeos(geo, Math.max(.035, rh * .045)).forEach(t => add(t, ridgeMat, 0, y, 0, g));
    if (ridge > .05) {
      add(boxGeo(ridge + .12, rh * .12, rh * .1, 1), ridgeMat, 0, y + rh + rh * .05, 0, g);
      for (const s of [-1, 1]) {  // 鸱吻
        add(boxGeo(rh * .1, rh * .3, rh * .14, 1), M.gold, s * (ridge / 2 + .04), y + rh + rh * .16, 0, g);
      }
    } else if (o.finial !== false) {   // 攒尖宝顶
      add(new T.SphereGeometry(rh * .1, 10, 8), M.gold, 0, y + rh + rh * .08, 0, g);
      add(new T.ConeGeometry(rh * .05, rh * .3, 8), M.gold, 0, y + rh + rh * .28, 0, g);
    }
  }
  /** 民居：白墙青瓦 */
  function house(parent, x, z, w, d, ry = 0, roof = M.roofTeal, facade = M.houseFacade, h = 1) {
    return pavilion(parent, x, z, { w, d, h, facade, roof, roofH: Math.min(w, d) * .5, overhang: .22, baseH: .12, bay: 1.1 }, ry);
  }
  /** 旗帜（记录用于飘动动画） */
  function flag(parent, x, y, z, mat = M.flagRed, s = 1) {
    add(new T.CylinderGeometry(.025 * s, .03 * s, 1.6 * s, 6), M.darkWood, x, y + .8 * s, z, parent);
    const geo = new T.PlaneGeometry(.7 * s, .42 * s, 8, 2); geo.translate(.35 * s, 0, 0);
    const f = add(geo, mat, x + .02, y + 1.38 * s, z, parent);
    f.userData.base = geo.attributes.position.array.slice();
    f.userData.phase = rand(0, 6);
    anim.flags.push(f);
    return f;
  }
  /** 灯笼（夜景时发光） */
  function lantern(parent, x, y, z, s = 1) {
    const l = add(new T.SphereGeometry(.12 * s, 10, 8), M.lantern, x, y, z, parent, 0, false);
    l.scale.y = 1.25;
    return l;
  }
  /* ================= 地形：沙盘地块、河流、内河 ================= */
  let ISLAND = null, RIVER = null, BRIDGE_Z = 16;
  const GROUND_Y = -.01;   // 外围大地高度：略低于地块顶面（y=0），地块侧壁埋入地下
  function buildTerrain() {
    // 沙盘地块：超椭圆 + 噪声边缘
    ISLAND = [];
    for (let i = 0; i < 72; i++) {
      const a = i / 72 * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
      const k = Math.pow(Math.pow(Math.abs(c), 4) + Math.pow(Math.abs(s), 4), -.25);
      const n = 1 + Math.sin(a * 5 + 1.3) * .035 + Math.sin(a * 11) * .02 + rand(-.015, .015);
      ISLAND.push([c * 27 * k * n, 1 + s * 21 * k * n]);
    }
    const island = new T.Mesh(slabGeo(ISLAND, 0, 3.2, 5, 3.2, true), [M.grass, M.earth]);
    island.receiveShadow = true; root.add(island);
    // 地块底部投影
    const blob = new T.Mesh(new T.PlaneGeometry(80, 64), new T.MeshBasicMaterial({ map: TX.blob, transparent: true, depthWrite: false, opacity: .85 }));
    blob.rotation.x = -Math.PI / 2; blob.position.y = -3.25; root.add(blob);
    anim.blob = blob;   // 接入天下地图后隐藏（地块已嵌入大地）

    // 城内水系：城墙围合范围整体为水面，街区为抬升台地
    const bed = new T.Mesh(slabGeo(FORT, .02, .02, 4), M.riverBed); bed.receiveShadow = true; root.add(bed);
    const water = new T.Mesh(slabGeo(FORT, WATER_Y + .35, .01, 3), M.water); water.receiveShadow = true; root.add(water);
    // 街区台地：石砌驳岸 + 顶面铺装
    Object.entries(DIST).forEach(([k, d]) => {
      const cap = M[d.mat];
      const m = new T.Mesh(slabGeo(d.poly, d.top, d.top + .2, 4, 1.6), [cap, M.base]);
      m.receiveShadow = true; m.castShadow = true; root.add(m);
      // 台地沿边石栏
      const rail = [];
      for (let i = 0; i < d.poly.length; i++) {
        const a = d.poly[i], b = d.poly[(i + 1) % d.poly.length];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        rail.push({ x: (a[0] + b[0]) / 2, z: (a[1] + b[1]) / 2, L, ang });
      }
      rail.forEach(r => add(boxGeo(r.L + .08, .08, .1, 1), M.marble, r.x, d.top + .04, r.z, root, -r.ang));
    });

    // 城外河流（沿南侧流过，按地块边缘裁切）
    // 地块已嵌入延展大地，河流不再按地块边缘裁切，向两端继续延伸
    const ends = [[-70, 10], [-34, 14], [-20, 16.2], [-9, 15.4], [0, 16.6], [10, 15.2], [20, 16.4], [34, 13], [70, 8]];
    const curve = new T.CatmullRomCurve3(ends.map(([x, z]) => new T.Vector3(x, 0, z)));
    RIVER = curve;
    add(ribbonGeo(RIVER, 3.6, .015, 300, 3), M.dirt, 0, 0, 0, root, 0, false);            // 泥岸
    add(ribbonGeo(RIVER, 2.7, .03, 300, 3), M.water, 0, 0, 0, root, 0, false);           // 河面
  }
  /* ================= 城墙、角楼、城门 ================= */
  const WALL_H = 2.1, WALL_T = .95;
  function buildWalls() {
    const wallG = group(); wallG.name = 'wall';
    const merlons = [];          // 垛口实例
    const lanternSpots = [];
    const isGap = (x, z) => GATES.some(gt => Math.hypot(x - gt.x, z - gt.z) < 2.1);
    for (let i = 0; i < FORT.length; i++) {
      const a = FORT[i], b = FORT[(i + 1) % FORT.length];
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
      const cx = (a[0] + b[0]) / 2, cz = (a[1] + b[1]) / 2;
      // 外法线（多边形为顺时针/逆时针都适用：取指向城外的一侧）
      let nx = Math.sin(ang), nz = -Math.cos(ang);
      if (inPoly(cx + nx * .5, cz + nz * .5, FORT)) { nx = -nx; nz = -nz; }
      // 按城门把墙段切开（门洞处留空，由城门墩台填补）
      const cuts = [0];
      GATES.forEach(gt => {
        if (distToSeg(gt.x, gt.z, a[0], a[1], b[0], b[1]) > .05) return;
        const t = Math.hypot(gt.x - a[0], gt.z - a[1]) / L;
        cuts.push(t - .55 / L, t + .55 / L);
      });
      cuts.push(1); cuts.sort((p, q) => p - q);
      for (let c = 0; c < cuts.length; c += 2) {
        const t0 = cuts[c], t1 = cuts[c + 1];
        const ext0 = t0 === 0 ? WALL_T / 2 : 0, ext1 = t1 === 1 ? WALL_T / 2 : 0;
        const sl = (t1 - t0) * L + ext0 + ext1;
        const tm = (t0 + t1) / 2 + (ext1 - ext0) / 2 / L;
        const sx = a[0] + (b[0] - a[0]) * tm, sz = a[1] + (b[1] - a[1]) * tm;
        // 墙基（外放收分）+ 墙身 + 墙顶步道 + 红色压边
        add(boxGeo(sl, .5, WALL_T + .3, 2.5), M.base, sx, .25, sz, wallG, -ang);
        add(boxGeo(sl, WALL_H - .5, WALL_T, 2.5), M.wall, sx, .5 + (WALL_H - .5) / 2, sz, wallG, -ang);
        add(boxGeo(sl - .02, .06, WALL_T - .2, 2), M.walk, sx, WALL_H + .03, sz, wallG, -ang, false);
        add(boxGeo(sl + .02, .07, .07, 1), M.redWall, sx + nx * (WALL_T / 2 + .01), WALL_H - .16, sz + nz * (WALL_T / 2 + .01), wallG, -ang, false);
        add(boxGeo(sl, .16, .1, 1), M.wall, sx - nx * (WALL_T / 2 - .05), WALL_H + .08, sz - nz * (WALL_T / 2 - .05), wallG, -ang, false);
      }
      // 外侧垛口、内侧女墙
      const n = Math.floor(L / .42);
      for (let k = 0; k <= n; k++) {
        const t = k / n, x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
        if (isGap(x, z)) continue;
        merlons.push([x + nx * (WALL_T / 2 - .08), WALL_H + .17, z + nz * (WALL_T / 2 - .08), -ang]);
        if (k % 9 === 4) lanternSpots.push([x - nx * (WALL_T / 2 - .05), z - nz * (WALL_T / 2 - .05)]);
      }
      // 马面（墙外凸台）
      if (L > 9) for (const t of [.33, .67]) {
        const x = a[0] + (b[0] - a[0]) * t, z = a[1] + (b[1] - a[1]) * t;
        if (isGap(x, z)) continue;
        add(boxGeo(1.3, WALL_H + .1, .8, 2), M.wall, x + nx * .7, (WALL_H + .1) / 2, z + nz * .7, wallG, -ang);
        add(boxGeo(1.36, .06, .86, 2), M.walk, x + nx * .7, WALL_H + .13, z + nz * .7, wallG, -ang, false);
      }
    }
    const mg = boxGeo(.24, .3, .14, 1);
    const inst = new T.InstancedMesh(mg, M.wall, merlons.length);
    const o = new T.Object3D();
    merlons.forEach((m, i) => { o.position.set(m[0], m[1], m[2]); o.rotation.set(0, m[3], 0); o.updateMatrix(); inst.setMatrixAt(i, o.matrix); });
    inst.castShadow = inst.receiveShadow = true; wallG.add(inst);
    // 墙顶灯笼
    lanternSpots.forEach(([x, z]) => { add(new T.CylinderGeometry(.02, .02, .5, 4), M.darkWood, x, WALL_H + .3, z, wallG); anim.lights.push(lantern(wallG, x, WALL_H + .5, z, .8)); });
    // 角楼：所有凸角放置
    FORT.forEach(([x, z], i) => {
      const p = FORT[(i + FORT.length - 1) % FORT.length], q = FORT[(i + 1) % FORT.length];
      const cross = (x - p[0]) * (q[1] - z) - (z - p[1]) * (q[0] - x);
      const convex = Math.sign(cross) === Math.sign(polyArea(FORT));
      add(boxGeo(1.7, WALL_H + .35, 1.7, 2), M.wall, x, (WALL_H + .35) / 2, z, wallG);
      add(boxGeo(1.8, .08, 1.8, 2), M.walk, x, WALL_H + .39, z, wallG, 0, false);
      if (convex) {
        pavilion(wallG, x, z, { y: WALL_H + .4, w: 1.05, d: 1.05, h: .62, facade: M.barrackFacade, roof: M.roofRed, roofH: .62, overhang: .26, base: false, bay: 1, ridge: 0 });
        flag(wallG, x + .55, WALL_H + .4, z + .55, M.flagRed, .8);
      }
    });
    GATES.forEach((gt, i) => { const gh = gatehouse(wallG, gt); if (i === 0) wallG.userData.mainGate = gh; });
    return wallG;
  }
  function gatehouse(parent, gt) {
    const g = group(gt.x, 0, gt.z, gt.rot, parent);
    // 门洞墩台（两侧墩 + 拱顶）
    for (const s of [-1, 1]) add(boxGeo(1.4, WALL_H + .2, 1.8, 2), M.wall, s * 1.25, (WALL_H + .2) / 2, 0, g);
    // 券门：直墙段 1.5 高，上接半圆拱券（顶 2.05），拱上补墙至墙顶
    const SH = 1.5, AR = .55;
    const vault = new T.CylinderGeometry(AR, AR, 1.9, 18, 1, true, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2);
    add(vault, M.darkIn, 0, SH, 0, g, 0, false);
    // 拱上填墙：矩形减去半圆，挤出成门洞进深
    const top = WALL_H + .2 - SH;
    const sp = new T.Shape();
    sp.moveTo(-AR, 0); sp.lineTo(-AR, top); sp.lineTo(AR, top); sp.lineTo(AR, 0);
    sp.absarc(0, 0, AR, 0, Math.PI, false);
    const fill = new T.ExtrudeGeometry(sp, { depth: 1.8, bevelEnabled: false, curveSegments: 18 });
    const fuv = fill.attributes.uv; for (let i = 0; i < fuv.count; i++) fuv.setXY(i, fuv.getX(i) / 2.5, fuv.getY(i) / 2.5);
    fill.translate(0, 0, -.9);
    add(fill, M.wall, 0, SH, 0, g);
    // 门洞深处 + 外立面拱券石圈
    add(boxGeo(1.04, SH - .02, 1.55, 1), M.darkIn, 0, SH / 2, -.1, g, 0, false);
    for (const s of [-1, 1]) {
      const ring = new T.RingGeometry(AR, AR + .17, 20, 1, 0, Math.PI);
      const r = add(ring, M.wall, 0, SH, s * .905, g, 0, false);
      if (s < 0) r.rotation.y = Math.PI;
      for (const t of [-1, 1]) add(boxGeo(.17, SH, .04, 1.5), M.wall, t * (AR + .085), SH / 2, s * .905, g, 0, false);
    }
    for (const s of [-1, 1]) {
      const door = add(boxGeo(.52, 1.45, .06, 1), M.red, s * .5, .73, .75, g, 0, false);
      door.rotation.y = s * .55;
    }
    add(boxGeo(3.9, .08, 1.95, 2), M.walk, 0, WALL_H + .24, 0, g, 0, false);
    // 城楼：重檐
    pavilion(g, 0, 0, { y: WALL_H + .28, w: 2.6, d: 1.3, h: .8, facade: M.hallFacade, roof: M.roofRed, roofH: .7, overhang: .3, double: true, baseH: .1, baseMat: M.marble, bay: .9 });
    for (const s of [-1, 1]) { flag(g, s * 1.6, WALL_H + .28, .8, M.flagGold, .9); lantern(g, s * .7, WALL_H - .1, .98, .9); }
    anim.lights.push(...g.children.filter(c => c.material === M.lantern));
    return g;
  }
  /* ================= 各功能建筑 ================= */
  /** 带等级门槛的子组：等级不足时隐藏（升级后城池会"长"出新建筑） */
  function tier(parent, minLevel) { const g = group(0, 0, 0, 0, parent); g.userData.minLevel = minLevel; return g; }

  function buildPalace() {
    const top = DIST.palace.top;
    const g = group(0, top, 0); g.name = 'hall';
    // 宫城红墙
    const cx = 9.4, cz = -6.6, hw = 5.2, hd = 3.8;
    const rw = [[cx, cz - hd, hw * 2, .22], [cx - hw, cz, .22, hd * 2], [cx + hw, cz, .22, hd * 2]];
    rw.forEach(([x, z, w, d]) => { add(boxGeo(w, .7, d, 2), M.redWall, x, .35, z, g); add(boxGeo(w + .14, .1, d + .14, 1), M.roofTeal, x, .75, z, g); });
    for (const s of [-1, 1]) {
      add(boxGeo(hw - 1.4, .7, .22, 2), M.redWall, cx + s * (hw + 1.4) / 2, .35, cz + hd, g);
      add(boxGeo(hw - 1.26, .1, .36, 1), M.roofTeal, cx + s * (hw + 1.4) / 2, .75, cz + hd, g);
    }
    // 宫门
    pavilion(g, cx, cz + hd, { w: 2.4, d: .9, h: .8, facade: M.hallFacade, roof: M.roofGold, roofH: .55, overhang: .25, baseMat: M.marble, bay: .8 });
    // 宫城角亭
    [[-1, -1], [1, -1], [-1, 1], [1, 1]].forEach(([sx, sz]) =>
      pavilion(g, cx + sx * hw, cz + sz * hd, { w: .8, d: .8, h: .7, facade: M.hallFacade, roof: M.roofGold, roofH: .55, overhang: .22, ridge: 0, baseMat: M.marble, bay: .8 }));
    // 三层汉白玉须弥座
    const terr = [[6.4, 4.4, .32], [5.4, 3.6, .32], [4.4, 2.9, .3]];
    let y = 0;
    terr.forEach(([w, d, h]) => {
      add(boxGeo(w, h, d, 1.5), M.marble, cx, y + h / 2, cz - 1, g);
      add(boxGeo(w + .06, .08, d + .06, 1), M.marble, cx, y + h + .04, cz - 1, g, 0, false);
      y += h;
    });
    // 御道红毯台阶
    const steps = 9, zf = cz - 1 + terr[0][1] / 2, run = steps * .22;
    for (let i = 0; i < steps; i++) {
      const sh = y / steps, front = zf + (steps - i) * .22, depth = front - (cz - 1);
      add(boxGeo(1.3, sh * (i + 1), depth, 1), M.marble, cx, sh * (i + 1) / 2, front - depth / 2, g);
    }
    const ramp = add(new T.PlaneGeometry(.7, Math.hypot(run, y)), M.carpet, cx, y / 2 + .07, zf + run / 2, g, 0, false);
    ramp.rotation.x = -Math.PI / 2 + Math.atan2(y, steps * .22);
    // 主殿：重檐庑殿顶 + 金瓦
    const main = pavilion(g, cx, cz - 1, { y, w: 3.9, d: 2.3, h: 1.35, facade: M.hallFacade, roof: M.roofGold, roofH: 1.2, overhang: .5, double: true, baseMat: M.marble, bay: 1, baseH: .14 });
    main.name = 'hall-main';
    // 两侧配殿
    for (const s of [-1, 1]) pavilion(g, cx + s * 3.9, cz + 2.0, { w: 1.6, d: 1.1, h: .9, facade: M.hallFacade, roof: M.roofTeal, roofH: .65, overhang: .28, baseMat: M.marble, bay: 1 });
    // 广场石灯、铜鼎、旗
    for (const s of [-1, 1]) {
      for (const k of [0, 1]) {
        add(new T.CylinderGeometry(.06, .09, .5, 6), M.marble, cx + s * 1.3, .25, cz + 2.2 + k * .9, g);
        anim.lights.push(lantern(g, cx + s * 1.3, .58, cz + 2.2 + k * .9, .7));
      }
      add(new T.CylinderGeometry(.22, .16, .3, 10), M.iron, cx + s * 2.4, .15, cz + 2.0, g);
      flag(g, cx + s * 2.8, 0, cz + 3.2, M.flagGold, 1.2);
    }
    // 宫城外：官署（随主城等级出现）
    const t5 = tier(g, 3);
    house(t5, 5.4, -2.2, 1.6, .6, 0, M.roofTeal, M.shopFacade, .8);
    house(t5, 13.4, -2.2, 1.6, .6, 0, M.roofTeal, M.shopFacade, .8);
    const t10 = tier(g, 6);
    pavilion(t10, 13.4, -9.2, { w: .7, d: .7, h: 1.6, facade: M.hallFacade, roof: M.roofGold, roofH: .6, overhang: .24, ridge: 0, baseMat: M.marble, bay: .9 });
    pavilion(t10, 5.4, -9.2, { w: .7, d: .7, h: 1.6, facade: M.hallFacade, roof: M.roofGold, roofH: .6, overhang: .24, ridge: 0, baseMat: M.marble, bay: .9 });
    return { group: g, anchorObj: main, anchor: new T.Vector3(cx, top + y + 4.2, cz - 1), focus: new T.Vector3(cx, top + 1.5, cz - 1) };
  }
  /** 实例化工具：一次性批量放置同一几何 */
  function instances(geo, mat, list, parent = root, shadow = true) {
    const im = new T.InstancedMesh(geo, mat, list.length);
    const o = new T.Object3D(), c = new T.Color();
    list.forEach((it, i) => {
      o.position.set(it.x, it.y || 0, it.z); o.rotation.set(it.rx || 0, it.ry || 0, it.rz || 0);
      o.scale.set(it.sx || it.s || 1, it.sy || it.s || 1, it.sz || it.s || 1); o.updateMatrix();
      im.setMatrixAt(i, o.matrix);
      if (it.color !== undefined) { c.set(it.color); im.setColorAt(i, c); }
    });
    im.instanceMatrix.needsUpdate = true;
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    im.castShadow = shadow; im.receiveShadow = true;
    parent.add(im);
    return im;
  }
  /** 物体（含实例化子网格）的世界包围盒 —— 用来把标签钉在真正的屋顶上 */
  function worldBox(obj) {
    obj.updateWorldMatrix(true, true);
    const box = new T.Box3(), tmp = new T.Box3(), m = new T.Matrix4();
    obj.traverse(o => {
      if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      if (o.isInstancedMesh) {
        for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); m.premultiply(o.matrixWorld); tmp.copy(o.geometry.boundingBox).applyMatrix4(m); box.union(tmp); }
      } else { tmp.copy(o.geometry.boundingBox).applyMatrix4(o.matrixWorld); box.union(tmp); }
    });
    return box;
  }
  function topAnchor(obj, pad = .25) {
    const b = worldBox(obj);
    if (b.isEmpty()) return obj.getWorldPosition(new T.Vector3());
    const c = b.getCenter(new T.Vector3());
    return new T.Vector3(c.x, b.max.y + pad, c.z);
  }
  /** 拱桥：从 (x1,z1,y1) 到 (x2,z2,y2) */
  function bridge(x1, z1, y1, x2, z2, y2, w = 1.1, parent = root) {
    const L = Math.hypot(x2 - x1, z2 - z1), ang = Math.atan2(z2 - z1, x2 - x1);
    const g = group((x1 + x2) / 2, 0, (z1 + z2) / 2, -ang, parent);
    const N = 10, arc = .22;
    for (let i = 0; i < N; i++) {
      const t = (i + .5) / N, x = -L / 2 + L * t;
      const y = y1 + (y2 - y1) * t + Math.sin(t * Math.PI) * arc;
      add(boxGeo(L / N + .02, .14, w, 1), M.marble, x, y, 0, g);
      for (const s of [-1, 1]) add(boxGeo(L / N + .02, .12, .07, 1), M.marble, x, y + .12, s * (w / 2 - .04), g, 0, false);
    }
    // 桥墩
    add(boxGeo(.3, Math.max(y1, y2) + .4, w, 1), M.base, 0, (Math.max(y1, y2) + .4) / 2 - .4, 0, g);
    return g;
  }
  function road(x1, z1, x2, z2, w, y, parent = root) {
    const L = Math.hypot(x2 - x1, z2 - z1), ang = Math.atan2(z2 - z1, x2 - x1);
    add(boxGeo(L, .02, w, 1.2), M.marble, (x1 + x2) / 2, y + .01, (z1 + z2) / 2, parent, -ang, false);
  }

  function buildCenter() {
    const y = DIST.center.top;
    const town = group(0, y, 0);
    // 主街：南门 → 北桥；东西大街
    road(-1, 11, -1, -2.8, 1.1, 0, town);
    road(-4.8, 3.5, 6, 3.5, 1, 0, town);
    // 民居街坊（城镇氛围）
    const roofs = [M.roofTeal, M.roofGrey, M.roofTeal, M.roofRed];
    const facades = [M.houseFacade, M.shopFacade];
    const spots = [
      [-3.6, -1.6, 1.4, 1, 0], [-3.6, .1, 1.4, 1, 0], [-3.6, 1.8, 1.4, .9, 0], [1.0, -1.7, 1.3, .9, 0], [1.6, .2, 1, 1.2, Math.PI / 2],
      [-3.7, 5.2, 1.3, 1, 0], [-3.7, 6.8, 1.3, 1, 0], [-3.7, 8.6, 1.3, 1, 0], [-2.3, 10.2, 1.2, .8, 0]
    ];
    spots.forEach(([x, z, w, d, r], i) => house(town, x, z, w, d, r, roofs[i % 4], facades[i % 2], .8 + (i % 3) * .1));
    // 集市：遮阳棚 + 货摊
    const market = tier(town, 1);
    [[-2.1, 2.3], [.2, 2.3], [-2.1, 4.7], [.2, 4.7]].forEach(([x, z], i) => {
      add(boxGeo(.6, .3, .4, 1), M.wood, x, .15, z, market);
      const awn = add(new T.PlaneGeometry(.8, .6), i % 2 ? M.flagRed : M.cloth, x, .62, z, market);
      awn.rotation.x = -Math.PI / 2 + .25;
      for (const s of [-1, 1]) add(new T.CylinderGeometry(.02, .02, .6, 4), M.darkWood, x + s * .36, .3, z + .26, market);
      add(new T.SphereGeometry(.1, 6, 5), i % 2 ? M.wheat : M.field, x, .36, z, market);
    });
    // 水井
    add(new T.CylinderGeometry(.32, .36, .35, 14), M.base, -2.4, .18, 7.4, town);
    add(new T.CylinderGeometry(.25, .25, .02, 14), M.water, -2.4, .36, 7.4, town, 0, false);
    return town;
  }
  function buildBank() {
    const y = DIST.center.top, x = 4.3, z = 1.5;
    const g = group(0, y, 0); g.name = 'bank';
    // 院墙
    add(boxGeo(2.9, .45, .14, 1), M.redWall, x, .22, z - 1.25, g);
    add(boxGeo(.14, .45, 2.5, 1), M.redWall, x + 1.42, .22, z, g);
    const bankHall = pavilion(g, x, z - .3, { w: 2.1, d: 1.2, h: 1, facade: M.hallFacade, roof: M.roofTeal, roofH: .75, overhang: .3, double: false, baseMat: M.marble, bay: .9 });
    // 金箱、铜钱堆
    const coins = [];
    for (let i = 0; i < 26; i++) coins.push({ x: x - .7 + rand(-.25, .25), y: .05 + i * .012, z: z + .75 + rand(-.15, .15), s: 1, ry: rand(0, 6) });
    instances(new T.CylinderGeometry(.06, .06, .02, 10), M.gold, coins, g);
    for (const s of [0, 1]) {
      add(boxGeo(.36, .26, .26, 1), M.darkWood, x + s * .42, .13, z + .8, g);
      add(boxGeo(.38, .05, .28, 1), M.gold, x + s * .42, .2, z + .8, g, 0, false);
    }
    const lv = tier(g, 5);
    pavilion(lv, x + 1.2, z + 1.0, { w: .6, d: .6, h: 1.1, facade: M.hallFacade, roof: M.roofGold, roofH: .45, overhang: .18, ridge: 0, baseMat: M.marble, bay: .6 });
    for (const s of [-1, 1]) {
      add(new T.CylinderGeometry(.02, .02, .7, 4), M.darkWood, x + s * .6, .35, z + .45, g);
      anim.lights.push(lantern(g, x + s * .6, .78, z + .45, .7));
    }
    return { group: g, anchorObj: bankHall, anchor: new T.Vector3(x, y + 3, z), focus: new T.Vector3(x, y + .6, z) };
  }

  function buildBarracks() {
    const y = DIST.center.top;
    const g = group(0, y, 0); g.name = 'barracks';
    // 营房（长屋）
    const longhouse = pavilion(g, 4, 6.4, { w: 3.2, d: 1.1, h: .85, facade: M.barrackFacade, roof: M.roofGrey, roofH: .6, overhang: .25, baseH: .12, bay: .8 });
    pavilion(g, 5.3, 5.0, { w: 1.1, d: 1.2, h: .8, facade: M.barrackFacade, roof: M.roofGrey, roofH: .55, overhang: .22, baseH: .12, bay: .8 });
    // 校场：沙土地 + 兵器架 + 箭靶 + 士兵方阵
    add(boxGeo(2.6, .02, 2.6, 2), M.dirt, 1.5, .01, 9.3, g, 0, false);
    for (let i = 0; i < 3; i++) {
      add(boxGeo(.7, .05, .06, 1), M.wood, 2.35, .5, 8.4 + i * .6, g);
      for (let k = 0; k < 5; k++) add(new T.CylinderGeometry(.012, .012, .8, 4), M.iron, 2.08 + k * .14, .42, 8.4 + i * .6, g, 0, false);
    }
    const target = new T.CylinderGeometry(.22, .22, .05, 16); target.rotateX(Math.PI / 2);
    for (const s of [0, 1]) { add(target, M.flagRed, .4 + s * .8, .45, 10.5, g); add(new T.CylinderGeometry(.1, .1, .055, 12).rotateX(Math.PI / 2), M.cloth, .4 + s * .8, .45, 10.5, g, 0, false); }
    // 士兵（实例化：身体 + 头 + 枪）
    const bodies = [], heads = [];
    const formation = (cx, cz, rows, cols) => { for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { bodies.push({ x: cx + c * .28, y: .16, z: cz + r * .3, color: 0x8d2a1e }); heads.push({ x: cx + c * .28, y: .38, z: cz + r * .3, color: 0xd8b48c }); } };
    formation(.4, 8.4, 3, 5);
    const lv = tier(g, 5); const lvBodies = [], lvHeads = [];
    for (let r = 0; r < 2; r++) for (let c = 0; c < 5; c++) { lvBodies.push({ x: .4 + c * .28, y: .16, z: 9.4 + r * .3, color: 0x2c4a5a }); lvHeads.push({ x: .4 + c * .28, y: .38, z: 9.4 + r * .3, color: 0xd8b48c }); }
    const body = new T.CylinderGeometry(.06, .08, .32, 6), head = new T.SphereGeometry(.06, 8, 6);
    instances(body, M.instWhite, bodies, g); instances(head, M.instWhite, heads, g);
    instances(body, M.instWhite, lvBodies, lv); instances(head, M.instWhite, lvHeads, lv);
    // 帅旗、鼓
    flag(g, 2.5, 0, 10.3, M.flagRed, 1.3);
    add(new T.CylinderGeometry(.2, .2, .28, 14).rotateZ(Math.PI / 2), M.red, 2.0, .26, 10.3, g);
    return { group: g, anchorObj: longhouse, anchor: new T.Vector3(4, y + 2.6, 6.4), focus: new T.Vector3(3, y + .5, 7.8) };
  }
  function buildFarm() {
    const y = DIST.farm.top;
    const g = group(0, y, 0); g.name = 'farm';
    // 田块（菜畦 / 麦田交错），田埂
    const plots = [[-13.6, -.6, 2.6, 2.3, 'field'], [-10.2, -.6, 3.4, 2.3, 'wheat'], [-13.6, 2.4, 2.6, 2.3, 'wheat'], [-10.2, 2.4, 3.4, 2.3, 'field'], [-9.3, 6.4, 3, 2.4, 'wheat'], [-9.3, 9.4, 3, 2.6, 'field']];
    plots.forEach(([x, z, w, d, m], i) => {
      add(boxGeo(w, .06, d, 3), M[m], x, .03, z, g, 0, false);
      add(boxGeo(w + .12, .05, .1, 1), M.dirt, x, .04, z - d / 2 - .05, g, 0, false);
      add(boxGeo(.1, .05, d + .12, 1), M.dirt, x - w / 2 - .05, .04, z, g, 0, false);
      if (m === 'wheat') {   // 麦穗起伏的立体感：实例化小簇
        const tufts = [];
        for (let k = 0; k < 70; k++) tufts.push({ x: x + rand(-w / 2 + .1, w / 2 - .1), y: .1, z: z + rand(-d / 2 + .1, d / 2 - .1), s: rand(.7, 1.2), ry: rand(0, 3), color: new T.Color().setHSL(rand(.11, .14), .65, rand(.5, .62)) });
        instances(new T.ConeGeometry(.07, .22, 5), M.foliage, tufts, g, false);
      } else {
        const veg = [];
        for (let k = 0; k < 60; k++) veg.push({ x: x + rand(-w / 2 + .1, w / 2 - .1), y: .1, z: z + rand(-d / 2 + .1, d / 2 - .1), s: rand(.6, 1.1), color: new T.Color().setHSL(rand(.25, .33), .55, rand(.25, .38)) });
        instances(new T.IcosahedronGeometry(.07, 0), M.foliage, veg, g, false);
      }
    });
    // 粮仓（圆形草顶）+ 农舍
    const gx = -7.25, gz = .1;
    const granary = group(gx, 0, gz, 0, g);
    add(new T.CylinderGeometry(.68, .72, .9, 16), M.houseFacade, 0, .45, 0, granary);
    add(jitter(new T.ConeGeometry(.95, .85, 16, 2), .03), M.thatch, 0, 1.32, 0, granary);
    add(new T.CylinderGeometry(.5, .55, .7, 14), M.houseFacade, gx, .35, gz + 2.3, g);
    add(new T.ConeGeometry(.72, .65, 14), M.thatch, gx, 1.02, gz + 2.3, g);
    house(g, -7.0, 10.0, 1.4, .9, Math.PI / 2, M.roofGrey, M.houseFacade, .75);
    // 草垛、风车
    const stacks = [];
    for (let i = 0; i < 6; i++) stacks.push({ x: -7.3 + (i % 2) * .5, y: .22, z: 6.0 + Math.floor(i / 2) * .55, s: rand(.8, 1.1) });
    instances(new T.SphereGeometry(.24, 10, 8), M.thatch, stacks, g);
    const lv = tier(g, 5);
    const mill = group(-13.4, 0, 4.15, 0, lv);
    add(new T.CylinderGeometry(.35, .5, 2, 8), M.houseFacade, 0, 1, 0, mill);
    add(new T.ConeGeometry(.55, .6, 8), M.roofRed, 0, 2.3, 0, mill);
    const blades = group(0, 1.7, .52, 0, mill);
    for (let i = 0; i < 4; i++) { const b = add(boxGeo(.14, 1.4, .02, 1), M.cloth, 0, 0, 0, blades); b.geometry.translate(0, .7, 0); b.rotation.z = i * Math.PI / 2; }
    anim.mill = blades;
    // 稻草人、农夫
    add(new T.CylinderGeometry(.02, .02, .7, 4), M.wood, -10.2, .35, 2.4, g);
    add(boxGeo(.5, .05, .05, 1), M.wood, -10.2, .55, 2.4, g);
    add(new T.SphereGeometry(.08, 8, 6), M.thatch, -10.2, .74, 2.4, g);
    return { group: g, anchorObj: granary, anchor: new T.Vector3(gx, y + 2.6, gz), focus: new T.Vector3(-10.6, y, 3) };
  }
  /* 树：多种形态，实例化 —— 阔叶团簇 / 松柏 / 竹 */
  const treeBatch = { trunks: [], crowns: [], pines: [] };
  function tree(x, z, y = 0, s = 1, kind = R() < .7 ? 'broad' : 'pine') {
    treeBatch.trunks.push({ x, y: y + .35 * s, z, s, sy: s });
    if (kind === 'pine') {
      for (let k = 0; k < 3; k++) treeBatch.pines.push({ x, y: y + (.75 + k * .38) * s, z, s: s * (1 - k * .22), ry: rand(0, 6), color: new T.Color().setHSL(rand(.3, .36), rand(.35, .5), rand(.16, .24)) });
    } else {
      const n = 3 + (R() * 3 | 0);
      for (let k = 0; k < n; k++) treeBatch.crowns.push({
        x: x + rand(-.28, .28) * s, y: y + (.95 + rand(0, .45)) * s, z: z + rand(-.28, .28) * s,
        s: s * rand(.42, .62), ry: rand(0, 6), color: new T.Color().setHSL(rand(.2, .3), rand(.35, .55), rand(.2, .34))
      });
    }
  }
  function flushTrees() {
    instances(new T.CylinderGeometry(.05, .09, .7, 6), M.log, treeBatch.trunks);
    instances(jitter(new T.IcosahedronGeometry(1, 1), .14), M.foliage, treeBatch.crowns);
    instances(new T.ConeGeometry(.42, .7, 7), M.foliage, treeBatch.pines);
  }

  function buildLumber() {
    const y = DIST.lumber.top;
    const g = group(0, y, 0); g.name = 'lumber';
    // 锯木棚 + 工坊
    const shed = pavilion(g, -3.6, -7.8, { w: 2.2, d: 1.2, h: .8, facade: M.barrackFacade, roof: M.thatch, roofH: .6, overhang: .25, baseH: .1, bay: 1, ridgeMat: M.wood });
    // 敞棚
    for (const [px, pz] of [[-.8, -8.4], [1.2, -8.4], [-.8, -7.2], [1.2, -7.2]]) add(new T.CylinderGeometry(.04, .04, .9, 5), M.wood, px, .45, pz, g);
    add(roofGeo(2.5, 1.7, .4, { ridge: 1 }), M.roofGrey, .2, .9, -7.8, g);
    // 原木堆
    const logs = [];
    for (let row = 0; row < 3; row++) for (let i = 0; i < 6 - row; i++) logs.push({ x: -4.6 + i * .2 + row * .1, y: .1 + row * .17, z: -5.4 });
    for (let row = 0; row < 3; row++) for (let i = 0; i < 5 - row; i++) logs.push({ x: .4 + i * .2 + row * .1, y: .1 + row * .17, z: -5.0 });
    // 原木轴向沿 z，按 x 方向并排堆叠
    instances(new T.CylinderGeometry(.09, .09, 1.4, 8).rotateX(Math.PI / 2), M.log, logs.map(l => ({ x: l.x, y: l.y, z: l.z })), g);
    // 木板堆、树桩
    for (let i = 0; i < 4; i++) add(boxGeo(1, .05, .3, 1), M.plank, -2.9, .03 + i * .055, -5.2, g, rand(-.06, .06));
    const stumps = [];
    for (let i = 0; i < 8; i++) stumps.push({ x: rand(-1.5, 1.5), y: .06, z: rand(-6.7, -6.2), s: rand(.8, 1.2) });
    instances(new T.CylinderGeometry(.1, .12, .12, 8), M.log, stumps, g);
    // 林场里的树（西侧一列松林）
    for (let i = 0; i < 10; i++) tree(-5.65 + (i % 2) * .3, -8.6 + (i >> 1) * .9 + rand(-.1, .1), y, rand(.55, .75), 'pine');
    const lv = tier(g, 5);
    pavilion(lv, -1.3, -5.4, { w: 1, d: .8, h: .7, facade: M.houseFacade, roof: M.roofTeal, roofH: .45, overhang: .2, baseH: .1, bay: 1 });
    return { group: g, anchorObj: shed, anchor: new T.Vector3(-3.6, y + 2.2, -7.8), focus: new T.Vector3(-2, y, -6.6) };
  }

  function buildMine() {
    const y = DIST.mine.top;
    const g = group(0, y, 0); g.name = 'mine';
    // 采石山：多块岩石
    const rocks = [];
    for (let i = 0; i < 22; i++) {
      const a = rand(0, 6.28), r = rand(0, 1.6);
      rocks.push({ x: 12.6 + Math.cos(a) * r, y: rand(.1, .6), z: 2.4 + Math.sin(a) * r * .8, s: rand(.35, .8) * (1.7 - r * .4), ry: rand(0, 6), rx: rand(0, .5), color: new T.Color().setHSL(.08, rand(.04, .12), rand(.36, .55)) });
    }
    const rockPile = instances(jitter(new T.DodecahedronGeometry(1, 0), .18), M.foliage, rocks, g);
    // 散落石料、方石
    const blocks = [];
    for (let i = 0; i < 20; i++) blocks.push({ x: rand(9.8, 11.8), y: .08, z: rand(4.8, 6.8), s: rand(.7, 1.2), ry: rand(0, 1.5), color: new T.Color().setHSL(.09, .08, rand(.55, .7)) });
    instances(boxGeo(.3, .16, .2, 1), M.foliage, blocks, g);
    // 矿洞、坑道木架、矿车轨道
    add(new T.CircleGeometry(.4, 16, 0, Math.PI), M.dark, 12.6, .02, 3.75, g, 0, false);
    for (const s of [-1, 1]) add(boxGeo(.08, .7, .08, 1), M.wood, 12.6 + s * .42, .35, 3.85, g);
    add(boxGeo(1, .08, .08, 1), M.wood, 12.6, .72, 3.85, g);
    for (let i = 0; i < 10; i++) add(boxGeo(.4, .03, .06, 1), M.wood, 12.6, .02, 4.1 + i * .22, g, 0, false);
    for (const s of [-1, 1]) add(boxGeo(.03, .03, 2.2, 1), M.iron, 12.6 + s * .14, .05, 5.1, g, 0, false);
    add(boxGeo(.36, .2, .5, 1), M.iron, 12.6, .18, 5.6, g);
    // 工棚、熔炉（带火光）
    house(g, 9, 1, 1.4, 1, 0, M.roofGrey, M.barrackFacade, .8);
    pavilion(g, 14, 6.5, { w: 1.4, d: 1.1, h: .8, facade: M.barrackFacade, roof: M.roofGrey, roofH: .5, overhang: .2, baseH: .1, bay: 1 });
    add(new T.CylinderGeometry(.22, .3, 1.2, 8), M.base, 9.2, .6, 3.2, g);
    const fire = add(new T.SphereGeometry(.13, 8, 6), M.lantern, 9.2, 1.25, 3.2, g, 0, false);
    anim.lights.push(fire); anim.forge = fire;
    const lv = tier(g, 5);
    house(lv, 8.6, 7, 1.2, .8, 0, M.roofGrey, M.barrackFacade, .75);
    return { group: g, anchorObj: rockPile, anchor: new T.Vector3(12.6, y + 2.4, 2.4), focus: new T.Vector3(11.2, y, 3.6) };
  }
  /* ================= 城外风光 ================= */
  function buildOutskirts() {
    // 河上石拱桥（通往南门）、城门前道路
    // 桥位对准南门主街（x=-1），取河心 z
    let bz = 16, best = Infinity;
    for (let i = 0; i <= 160; i++) { const q = RIVER.getPointAt(i / 160); const d = Math.abs(q.x + 1); if (d < best) { best = d; bz = q.z; } }
    BRIDGE_Z = bz;
    bridge(-1, bz - 2.4, .05, -1, bz + 2.4, .05, 1.3);
    road(-1, 12.6, -1, bz - 2.2, 1.1, .02);
    road(16.6, 3.5, 22, 3.5, 1.1, .02);
    road(-1, bz + 2.2, -3.4, 21, 1.1, .02);
    // 城内街区之间的石桥
    const P = DIST.palace.top, C = DIST.center.top;
    bridge(9.4, -1.6, P, 9.4, -.3, C, 1);
    bridge(-1, 11, C, -1, 12.8, .03, 1.1);        // 南门水关
    bridge(15, 3.5, C, 16.8, 3.5, .03, 1.1);      // 东门水关
    bridge(-1, -2.8, C, -1, -4.2, C, 1);
    bridge(-4.8, 3.5, C, -6.2, 3.5, C, 1);
    bridge(6, 3.5, C, 7.4, 3.5, C, 1);
    // 城门外驿站、牌坊
    house(root, -4.2, 13.35, 1.4, .8, 0, M.roofGrey, M.shopFacade, .8);
    house(root, 2.6, 13.35, 1.2, .8, 0, M.roofGrey, M.houseFacade, .8);
    const pf = group(-1, 0, 13.4);
    for (const s of [-1, 1]) add(new T.CylinderGeometry(.06, .07, 1.5, 8), M.red, s * .75, .75, 0, pf);
    add(boxGeo(1.8, .14, .14, 1), M.red, 0, 1.25, 0, pf);
    pavilion(pf, 0, 0, { y: 1.3, w: 1.7, d: .3, h: .1, facade: M.hallFacade, roof: M.roofTeal, roofH: .28, overhang: .15, base: false, bay: .8 });
    // 东门外营寨（帐篷）
    const tents = [];
    for (let i = 0; i < 6; i++) tents.push({ x: 19 + (i % 3) * 1.2, y: .3, z: -1.2 + (i / 3 | 0) * 1.3, ry: Math.PI / 4, s: 1 });
    instances(new T.ConeGeometry(.45, .6, 4), M.cloth, tents);
    flag(root, 21.6, 0, -2, M.flagRed, 1.2);
    // 树林：城外随机分布，避开城墙、河流与道路
    let n = 0, guard = 0;
    while (n < 220 && guard++ < 4000) {
      const x = rand(-28, 28), z = rand(-21, 24);
      if (!inPoly(x, z, ISLAND) || distToPoly(x, z, ISLAND) < .8) continue;
      if (inPoly(x, z, FORT) || distToPoly(x, z, FORT) < 1.8) continue;
      const rp = nearestOnCurve(RIVER, x, z); if (rp < 2.3) continue;
      if (Math.abs(x + 1) < 1.2 && z > 12 && z < 22) continue;
      if (Math.abs(z - 3.5) < 1 && x > 16) continue;
      if (x > 18 && x < 22.6 && z > -2.6 && z < 1.4) continue;
      tree(x, z, 0, rand(.7, 1.15)); n++;
    }
    // 草丛、灌木、石块点缀
    const bush = [], stone = [];
    for (let i = 0; i < 320; i++) {
      const x = rand(-28, 28), z = rand(-21, 24);
      if (!inPoly(x, z, ISLAND) || inPoly(x, z, FORT) || distToPoly(x, z, FORT) < 1.2) continue;
      if (nearestOnCurve(RIVER, x, z) < 1.7) continue;
      (i % 5 ? bush : stone).push({ x, y: .05, z, s: rand(.12, .28), ry: rand(0, 6), color: i % 5 ? new T.Color().setHSL(rand(.2, .3), .45, rand(.2, .32)) : new T.Color().setHSL(.08, .06, rand(.4, .55)) });
    }
    instances(jitter(new T.IcosahedronGeometry(1, 0), .2), M.foliage, bush);
    instances(jitter(new T.DodecahedronGeometry(1, 0), .2), M.foliage, stone);
    // 城内零星树木
    [[-4.4, 10.5], [-4.3, 4.3], [14.6, .2], [7.9, 7.3]].forEach(([x, z]) => tree(x, z, .35, .6, 'broad'));
    // 宫城内松柏
    [[4.7, -6.6], [14.1, -6.6], [4.7, -7.6], [14.1, -7.6]].forEach(([x, z]) => tree(x, z, DIST.palace.top, .55, 'pine'));
  }
  /* ================= 远景：环状山体与延展地面 ================= */
  function buildDistance() {
    if (!root) {
      console.error('[city3d] buildDistance: root 未初始化');
      return;
    }
    
    if (!TX.grass || !TX.grass.map) {
      console.error('[city3d] buildDistance: TX.grass 未初始化');
      return;
    }
    
    try {
      // 延展地面：与地块顶面同高、同材质、同 UV 比例（世界坐标 / 5），使地块与外围无缝衔接
      const groundGeo = new T.CircleGeometry(160, 96);
      const gp = groundGeo.attributes.position, guv = groundGeo.attributes.uv;
      for (let i = 0; i < gp.count; i++) guv.setXY(i, gp.getX(i) / 5, gp.getY(i) / 5);
      const groundMat = M.grass.clone();
      groundMat.polygonOffset = true; groundMat.polygonOffsetFactor = 2; groundMat.polygonOffsetUnits = 2;   // 让位于地块顶面，避免 Z 冲突
      const ground = new T.Mesh(groundGeo, groundMat);
      ground.rotation.x = -Math.PI / 2;
      ground.position.y = GROUND_Y;
      ground.receiveShadow = true;
      root.add(ground);
      if (anim.blob) anim.blob.visible = false;   // 地块已嵌入大地，不再需要悬空投影
      // 外围树林：延续地块上的植被，消除边界
      let n = 0, guard = 0;
      while (n < 420 && guard++ < 6000) {
        const a = rand(0, Math.PI * 2), r = rand(24, 75);
        const x = Math.cos(a) * r, z = 1 + Math.sin(a) * r * .8;
        if (inPoly(x, z, ISLAND) || distToPoly(x, z, ISLAND) < .6) continue;
        if (nearestOnCurve(RIVER, x, z) < 2.3) continue;
        tree(x, z, GROUND_Y, rand(.7, 1.2)); n++;
      }
      console.log('[city3d] buildDistance: 延展地面已添加');
    } catch (err) {
      console.error('[city3d] buildDistance: 延展地面创建失败', err);
      throw err;
    }

    try {
      // 360° 环状远山：沿圆周均匀分布，采用大气透视的蓝灰绿色
      const mountainList = [];
      const mountainCount = 36;
      for (let i = 0; i < mountainCount; i++) {
        const a = (i / mountainCount) * Math.PI * 2 + rand(-0.08, 0.08);
        const r = rand(70, 140);
        const h = rand(8, 25);
        const baseR = rand(4, 9);
        mountainList.push({ x: Math.cos(a) * r, y: GROUND_Y + h / 2, z: Math.sin(a) * r, ry: rand(0, 6.28), sx: baseR, sy: h, sz: baseR });
      }
      const mtGeo = new T.ConeGeometry(1, 1, 8, 1);
      const mtMat = std({ color: 0x8fa890, roughness: 0.95 });
      const mountains = instances(mtGeo, mtMat, mountainList, root, true);
      if (mountains) {
        mountains.receiveShadow = true;
        console.log('[city3d] buildDistance: 远山已添加，实例数量:', mountainList.length);
      } else {
        console.warn('[city3d] buildDistance: instances() 返回 null');
      }
    } catch (err) {
      console.error('[city3d] buildDistance: 远山创建失败', err);
      throw err;
    }
  }
  function nearestOnCurve(curve, x, z) {
    if (!curve._pts) curve._pts = curve.getSpacedPoints(120);
    let d = Infinity; for (const p of curve._pts) d = Math.min(d, Math.hypot(p.x - x, p.z - z)); return d;
  }

  /* 路人：沿路径行走的小人（实例化） */
  function buildWalkers() {
    const top = DIST.center.top;
    const paths = [
      [[-1, 13.5, 0], [-1, 11.6, top], [-1, 3.5, top], [-1, -2.4, top]],
      [[-4.2, 3.5, top], [5.6, 3.5, top]],
      // 过桥：随桥面起拱
      [[-1, BRIDGE_Z + 3.4, 0], [-1, BRIDGE_Z + 2.2, .06], [-1, BRIDGE_Z, .32], [-1, BRIDGE_Z - 2.2, .06], [-1, 13.2, 0]],
      [[22, 3.5, 0], [16.8, 3.5, 0]],
      [[-1, 8, top], [-1, 3.6, top], [4.5, 3.6, top]]
    ].map(pts => new T.CatmullRomCurve3(pts.map(([x, z, y]) => new T.Vector3(x, y, z))));
    const people = [];
    paths.forEach((c, pi) => { for (let k = 0; k < 4; k++) people.push({ curve: c, t: R(), speed: rand(.012, .025) * (pi < 2 ? 1 : 1.4) / c.getLength() * 10, dir: R() < .5 ? 1 : -1, off: rand(-.3, .3) }); });
    const colors = [0x3a5a7a, 0x8a2a20, 0x6a5a3a, 0x2f4f3a, 0xb08a50, 0x5a3a5a];

    // 更像人的模型：头、身体、手臂、腿
    const head = new T.InstancedMesh(new T.SphereGeometry(.038, 8, 6), M.instWhite, people.length);
    const body = new T.InstancedMesh(new T.BoxGeometry(.065, .14, .05), M.instWhite, people.length);
    const armL = new T.InstancedMesh(new T.CylinderGeometry(.012, .012, .11, 5), M.instWhite, people.length);
    const armR = new T.InstancedMesh(new T.CylinderGeometry(.012, .012, .11, 5), M.instWhite, people.length);
    const legL = new T.InstancedMesh(new T.CylinderGeometry(.015, .018, .13, 6), M.instWhite, people.length);
    const legR = new T.InstancedMesh(new T.CylinderGeometry(.015, .018, .13, 6), M.instWhite, people.length);

    const c = new T.Color();
    const skinColor = 0xd8b48c;
    people.forEach((p, i) => {
      const clothColor = colors[i % colors.length];
      head.setColorAt(i, c.set(skinColor));
      body.setColorAt(i, c.set(clothColor));
      armL.setColorAt(i, c.set(clothColor));
      armR.setColorAt(i, c.set(clothColor));
      legL.setColorAt(i, c.set(0x2a1f1a));  // 深色裤子
      legR.setColorAt(i, c.set(0x2a1f1a));
    });

    [head, body, armL, armR, legL, legR].forEach(m => {
      m.castShadow = true;
      m.frustumCulled = false;
    });

    root.add(head, body, armL, armR, legL, legR);
    anim.walkers = { people, head, body, armL, armR, legL, legR, o: new T.Object3D() };
  }
  function updateWalkers(dt) {
    const w = anim.walkers; if (!w) return;
    w.people.forEach((p, i) => {
      p.t += p.speed * dt * p.dir;
      if (p.t > 1) { p.t = 1; p.dir = -1; } else if (p.t < 0) { p.t = 0; p.dir = 1; }
      const pos = p.curve.getPointAt(p.t), tg = p.curve.getTangentAt(p.t);
      const now = performance.now();
      const walkPhase = (now * .008 + i) * p.dir;
      const bob = Math.abs(Math.sin(walkPhase)) * .02;
      const ox = -tg.z * p.off, oz = tg.x * p.off;

      // 朝向行走方向
      const angle = Math.atan2(tg.x * p.dir, tg.z * p.dir);

      // 头部
      w.o.position.set(pos.x + ox, pos.y + .24 + bob, pos.z + oz);
      w.o.rotation.set(0, angle, 0);
      w.o.updateMatrix();
      w.head.setMatrixAt(i, w.o.matrix);

      // 身体
      w.o.position.y = pos.y + .13 + bob;
      w.o.updateMatrix();
      w.body.setMatrixAt(i, w.o.matrix);

      // 腿部摆动
      const legSwing = Math.sin(walkPhase * 2) * .15;
      w.o.position.y = pos.y + .065 + bob * .5;
      w.o.rotation.set(legSwing, angle, 0);
      w.o.updateMatrix();
      w.legL.setMatrixAt(i, w.o.matrix);

      w.o.rotation.x = -legSwing;
      w.o.updateMatrix();
      w.legR.setMatrixAt(i, w.o.matrix);

      // 手臂摆动（与腿相反）
      const armSwing = Math.sin(walkPhase * 2 + Math.PI) * .12;
      w.o.position.set(pos.x + ox - Math.cos(angle) * .04, pos.y + .14 + bob, pos.z + oz - Math.sin(angle) * .04);
      w.o.rotation.set(armSwing, angle, 0);
      w.o.updateMatrix();
      w.armL.setMatrixAt(i, w.o.matrix);

      w.o.position.set(pos.x + ox + Math.cos(angle) * .04, pos.y + .14 + bob, pos.z + oz + Math.sin(angle) * .04);
      w.o.rotation.x = -armSwing;
      w.o.updateMatrix();
      w.armR.setMatrixAt(i, w.o.matrix);
    });
    w.head.instanceMatrix.needsUpdate = true;
    w.body.instanceMatrix.needsUpdate = true;
    w.armL.instanceMatrix.needsUpdate = true;
    w.armR.instanceMatrix.needsUpdate = true;
    w.legL.instanceMatrix.needsUpdate = true;
    w.legR.instanceMatrix.needsUpdate = true;
  }
  /* ================= 天空与环境光 ================= */
  const SKY = {
    day: { top: 0x5f93c8, mid: 0xa9cbe0, bot: 0xe8dcc0, fog: 0xc9d6d2, sun: 0xfff0d2, sunI: 3.4, hemiI: 1.25, hemiSky: 0xdfeaf2, hemiGnd: 0x5a6a3a, exposure: 1.0, lamp: 0 },
    dusk: { top: 0x3a4f86, mid: 0xd98b62, bot: 0xf2c58a, fog: 0xd8a888, sun: 0xffa060, sunI: 2.4, hemiI: .8, hemiSky: 0xf0b890, hemiGnd: 0x4a3a2a, exposure: 1.05, lamp: .6 },
    night: { top: 0x070d1f, mid: 0x18264a, bot: 0x2c3858, fog: 0x1c2640, sun: 0x9fb4ff, sunI: .65, hemiI: .38, hemiSky: 0x6a7fb8, hemiGnd: 0x1a1f2a, exposure: 1.15, lamp: 1 }
  };
  function skyTexture(p) {
    const c = makeCanvas(16, 512, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      const col = n => '#' + new T.Color(n).getHexString();
      gr.addColorStop(0, col(p.top)); gr.addColorStop(.42, col(p.mid)); gr.addColorStop(.5, col(p.bot)); gr.addColorStop(1, col(p.fog));
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    const t = new T.CanvasTexture(c); setSRGB(t); t.mapping = T.EquirectangularReflectionMapping;
    return t;
  }
  function cloudSprites(scene) {
    const tc = makeCanvas(256, 128, g => {
      for (let i = 0; i < 26; i++) {
        const x = rand(50, 206), y = rand(50, 80), r = rand(18, 44);
        const gr = g.createRadialGradient(x, y, 0, x, y, r);
        gr.addColorStop(0, 'rgba(255,255,255,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
      }
    });
    const t = new T.CanvasTexture(tc); setSRGB(t);
    const list = [];
    for (let i = 0; i < 12; i++) {
      const m = new T.SpriteMaterial({ map: t, transparent: true, opacity: .75, depthWrite: false, fog: false });
      const s = new T.Sprite(m);
      s.frustumCulled = false;
      const a = (i / 12) * Math.PI * 2 + rand(-0.22, 0.22), r = rand(35, 65);
      s.position.set(Math.cos(a) * r, rand(9, 16), Math.sin(a) * r);
      s.scale.set(rand(16, 26), rand(6, 9), 1);
      s.userData.speed = rand(.15, .4);
      s.userData.angle = a;
      s.userData.radius = r;
      scene.add(s); list.push(s);
    }
    return list;
  }
  /** 炊烟 / 熔炉烟：少量上升的软粒子 */
  function smoke(scene, origins) {
    const mat = new T.SpriteMaterial({ map: TX.soft, color: 0xd9d4cc, transparent: true, opacity: .35, depthWrite: false });
    const list = [];
    origins.forEach(([x, y, z]) => {
      for (let i = 0; i < 6; i++) {
        const s = new T.Sprite(mat.clone()); s.userData = { x, y, z, t: i / 6 };
        scene.add(s); list.push(s);
      }
    });
    return list;
  }
  /* ================= 控制器：对外接口与旧版 CityView 保持一致 ================= */
  const CityView = {
    renderer: null, scene: null, camera: null, viewport: null, labels: null, status: null,
    objects: new Map(),
    yaw: 0.66, pitch: 0.86, distance: 40, target: null, focusGoal: null,
    dragging: false, lastPointer: null, downPointer: null, pinch: null, pointers: new Map(),
    autoRotate: false, initialized: false, raf: 0, resizeObserver: null, visible: true,
    timeOfDay: 'day', skyMix: null, clock: null, sun: null, hemi: null, clouds: [], smokes: [],
    pickables: [], raycaster: null,

    init() {
      if (this.initialized || !window.THREE) return;
      this.viewport = document.getElementById('city3dViewport');
      this.labels = document.getElementById('city3dLabels');
      this.status = document.getElementById('city3dStatus');
      if (!this.viewport) return;
      this.initialized = true;
      try { this.build(); }
      catch (err) {
        console.error('[city3d] 构建失败', err);
        if (this.status) { this.status.hidden = false; this.status.textContent = '3D 城池加载失败：' + err.message; }
        return;
      }
      this.bindControls();
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(this.viewport);
      if ('IntersectionObserver' in window) {
        new IntersectionObserver(es => { this.visible = es[0].isIntersecting; }).observe(this.viewport);
      }
      this.resize();
      if (this.status) this.status.hidden = true;
      this.applyLevels();
      this.clock = new T.Clock();
      this.animate();
    },

    build() {
      const r = this.renderer = new T.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
      r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      if ('outputColorSpace' in r && T.SRGBColorSpace) r.outputColorSpace = T.SRGBColorSpace; else r.outputEncoding = T.sRGBEncoding;
      r.toneMapping = T.ACESFilmicToneMapping; r.toneMappingExposure = 1;
      if ('useLegacyLights' in r) r.useLegacyLights = false;   // 光照强度按物理单位调校
      r.shadowMap.enabled = true; r.shadowMap.type = T.PCFSoftShadowMap;
      this.viewport.prepend(r.domElement);
      r.domElement.style.touchAction = 'none';

      const scene = this.scene = new T.Scene();
      scene.fog = new T.Fog(0xc9d6d2, 80, 200);
      this.camera = new T.PerspectiveCamera(32, 1, 0.5, 400);
      this.target = new T.Vector3(0, 0.6, 1);
      this.focusGoal = this.target.clone();
      this.raycaster = new T.Raycaster();

      // 光照：天光 + 带阴影的太阳 + 冷色补光
      this.hemi = new T.HemisphereLight(0xdfeaf2, 0x5a6a3a, 1.25); scene.add(this.hemi);
      const sun = this.sun = new T.DirectionalLight(0xfff0d2, 3.4);
      sun.position.set(-22, 34, 18); sun.castShadow = true;
      sun.shadow.mapSize.set(2048, 2048);
      Object.assign(sun.shadow.camera, { left: -30, right: 30, top: 26, bottom: -26, near: 1, far: 100 });
      sun.shadow.camera.updateProjectionMatrix();
      sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
      scene.add(sun, sun.target);
      const fill = new T.DirectionalLight(0xb7d0e8, .55); fill.position.set(20, 12, -16); scene.add(fill);

      try {
        buildTextures(); 
        buildMaterials();
      } catch (err) {
        console.error('[city3d] 纹理/材质初始化失败', err);
        throw err;
      }
      
      root = new T.Group(); 
      scene.add(root);
      
      // 添加天空盒作为远景背景
      const skyGeo = new T.SphereGeometry(300, 32, 16);
      const skyMat = new T.MeshBasicMaterial({ 
        side: T.BackSide, 
        fog: false,
        depthWrite: false
      });
      this.skyBox = new T.Mesh(skyGeo, skyMat);
      scene.add(this.skyBox);
      
      try {
        this.buildWorld();
      } catch (err) {
        console.error('[city3d] 世界构建失败', err);
        throw err;
      }
      
      this.setTimeOfDay('day', true);
    },
    buildWorld() {
      try {
        buildTerrain();
      } catch (err) {
        console.error('[city3d] buildTerrain 失败', err);
        throw err;
      }
      
      try {
        buildDistance();
      } catch (err) {
        console.error('[city3d] buildDistance 失败', err);
        throw err;
      }
      
      const wall = buildWalls();
      const hall = buildPalace();
      buildCenter();
      const bank = buildBank();
      const barracks = buildBarracks();
      const farm = buildFarm();
      const lumber = buildLumber();
      const mine = buildMine();
      buildOutskirts();
      flushTrees();
      buildWalkers();
      const reg = (key, name, b) => { this.addObject(key, name, b.group, b.anchor, b.focus); this.objects.get(key).anchorObj = b.anchorObj; };
      reg('hall', '城镇中心', hall);
      reg('farm', '农场', farm);
      reg('mine', '矿场', mine);
      reg('lumber', '伐木场', lumber);
      reg('bank', '金库', bank);
      reg('barracks', '兵营', barracks);
      reg('wall', '城墙', { group: wall, anchorObj: wall.userData.mainGate, anchor: new T.Vector3(-1, WALL_H + 3.2, 12), focus: new T.Vector3(-1, 1, 10) });
      // 标签锚点 = 建筑主体包围盒的顶面中心：无论从哪个方向看，引线尖端都落在该建筑屋顶上
      this.objects.forEach(item => { if (item.anchorObj) item.anchor = topAnchor(item.anchorObj, .2); });
      this.clouds = cloudSprites(this.scene);
      const C = DIST.center.top;
      this.smokes = smoke(this.scene, [[9.2, C + 1.4, 3.2], [-3.6, C + 1.5, .1], [-3.7, C + 1.5, 6.8], [-4.2, 1.3, 13.35]]);
      // 收集可点选网格，回溯到所属建筑组
      this.objects.forEach(item => item.group.traverse(o => { if (o.isMesh) { o.userData.buildingKey = item.key; this.pickables.push(o); } }));
    },

    addObject(key, name, group, anchor, focus) {
      // 名字从配置读取，保持与界面一致
      const cfg = (typeof Game !== 'undefined' && Game.Config && Game.Config.BUILDINGS) ? Game.Config.BUILDINGS[key] : null;
      this.objects.set(key, { key, name: (cfg && cfg.name) || name, group, anchor, focus: focus || anchor.clone(), label: null, ring: null });
    },

    /* 昼 / 黄昏 / 夜 */
    envCache: {},
    setTimeOfDay(name) {
      const p = SKY[name] || SKY.day;
      this.timeOfDay = name;
      if (!this.envCache[name]) {
        const sky = skyTexture(p);
        const pm = new T.PMREMGenerator(this.renderer);
        this.envCache[name] = { sky, env: pm.fromEquirectangular(sky).texture };
        pm.dispose();
      }
      const cache = this.envCache[name];
      this.scene.background = cache.sky;
      this.scene.environment = cache.env;
      if (this.skyBox) this.skyBox.material.map = cache.sky;
      this.scene.fog.color.set(p.fog);
      this.sun.color.set(p.sun); this.sun.intensity = p.sunI;
      if (name === 'night') this.sun.position.set(18, 30, -14);
      else if (name === 'dusk') this.sun.position.set(-34, 14, 10);
      else this.sun.position.set(-22, 34, 18);
      this.hemi.intensity = p.hemiI; this.hemi.color.set(p.hemiSky); this.hemi.groundColor.set(p.hemiGnd);
      this.renderer.toneMappingExposure = p.exposure;
      M.lantern.emissiveIntensity = .25 + p.lamp * 2.6;
      M.facades.forEach(m => { m.emissiveIntensity = p.lamp * 1.4; });
      M.water.color.set(name === 'night' ? 0x1a3040 : name === 'dusk' ? 0x3a5560 : 0x2c6460);
      this.clouds.forEach(c => { c.material.opacity = name === 'night' ? .18 : .75; c.material.color.set(name === 'dusk' ? 0xffc8a0 : 0xffffff); });
      this.lampPhase = p.lamp;
      const btn = document.getElementById('cityTimeBtn');
      if (btn) { btn.textContent = { day: '昼', dusk: '昏', night: '夜' }[name]; btn.setAttribute('aria-label', '切换时间：当前' + { day: '白天', dusk: '黄昏', night: '夜晚' }[name]); }
    },
    cycleTime() { const order = ['day', 'dusk', 'night']; this.setTimeOfDay(order[(order.indexOf(this.timeOfDay) + 1) % 3]); },
    /* ---------- 交互：拖拽旋转、滚轮/双指缩放、点击选中建筑 ---------- */
    bindControls() {
      const canvas = this.renderer.domElement;
      canvas.addEventListener('pointerdown', e => {
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        canvas.setPointerCapture?.(e.pointerId);
        if (this.pointers.size === 1) { this.dragging = true; this.lastPointer = { x: e.clientX, y: e.clientY }; this.downPointer = { x: e.clientX, y: e.clientY }; }
        else if (this.pointers.size === 2) { this.dragging = false; this.downPointer = null; this.pinch = { d: this.pinchDist(), dist: this.distance }; }
      });
      canvas.addEventListener('pointermove', e => {
        if (!this.pointers.has(e.pointerId)) return;
        this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
        if (this.pinch && this.pointers.size === 2) {
          this.distance = Math.max(18, Math.min(60, this.pinch.dist * this.pinch.d / Math.max(1, this.pinchDist())));
          return;
        }
        if (!this.dragging) return;
        const dx = e.clientX - this.lastPointer.x, dy = e.clientY - this.lastPointer.y;
        this.lastPointer = { x: e.clientX, y: e.clientY };
        this.yaw -= dx * 0.008;
        this.pitch = Math.max(0.42, Math.min(1.42, this.pitch + dy * 0.006));
        if (Math.abs(dx) + Math.abs(dy) > 1) { this.autoRotate = false; this.syncCameraButtons(); }
      });
      const release = e => {
        const down = this.downPointer;
        if (down && this.pointers.size === 1 && Math.hypot(e.clientX - down.x, e.clientY - down.y) < 6 && e.type === 'pointerup') this.pick(e);
        this.pointers.delete(e.pointerId);
        canvas.releasePointerCapture?.(e.pointerId);
        if (this.pointers.size < 2) this.pinch = null;
        if (this.pointers.size === 0) { this.dragging = false; this.downPointer = null; }
      };
      canvas.addEventListener('pointerup', release);
      canvas.addEventListener('pointercancel', release);
      canvas.addEventListener('wheel', e => { e.preventDefault(); this.distance = Math.max(18, Math.min(60, this.distance + e.deltaY * 0.03)); }, { passive: false });
      document.getElementById('cityRotateBtn')?.addEventListener('click', () => { this.autoRotate = !this.autoRotate; this.syncCameraButtons(); });
      document.getElementById('cityTopBtn')?.addEventListener('click', () => { this.pitch = this.pitch > 1.2 ? 0.86 : 1.36; this.autoRotate = false; this.syncCameraButtons(); });
      document.getElementById('cityResetBtn')?.addEventListener('click', () => {
        this.yaw = 0.66; this.pitch = 0.86; this.distance = 40; this.autoRotate = false;
        this.focusGoal.set(0, 0.6, 1); this.syncCameraButtons();
      });
      document.getElementById('cityTimeBtn')?.addEventListener('click', () => this.cycleTime());
    },
    pinchDist() { const p = [...this.pointers.values()]; return p.length < 2 ? 1 : Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y); },
    /** 屏幕坐标 → 画布内的布局坐标。舞台有 scale / 竖屏 rotate(90deg)，不能直接用 getBoundingClientRect */
    localPoint(e) {
      const c = this.renderer.domElement;
      if (typeof e.offsetX === 'number' && e.target === c) return { x: e.offsetX, y: e.offsetY, w: c.clientWidth, h: c.clientHeight };
      const r = c.getBoundingClientRect();
      return { x: (e.clientX - r.left) / r.width * c.clientWidth, y: (e.clientY - r.top) / r.height * c.clientHeight, w: c.clientWidth, h: c.clientHeight };
    },
    pick(e) {
      const lp = this.localPoint(e);
      const ndc = new T.Vector2((lp.x / lp.w) * 2 - 1, -(lp.y / lp.h) * 2 + 1);
      this.raycaster.setFromCamera(ndc, this.camera);
      const shown = o => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
      const hit = this.raycaster.intersectObject(root, true).find(h => h.object.isMesh && shown(h.object));
      const key = hit && hit.object.userData.buildingKey;
      if (!key || typeof Game === 'undefined' || !Game.state) return;
      Game.state.selectedBuilding = key;
      if (Game.UI && Game.UI.updateBuildings) Game.UI.updateBuildings(); else this.selectBuilding(key);
    },
    syncCameraButtons() {
      document.getElementById('cityRotateBtn')?.setAttribute('aria-pressed', String(this.autoRotate));
      document.getElementById('cityTopBtn')?.setAttribute('aria-pressed', String(this.pitch > 1.2));
    },
    setCamera() {
      this.target.lerp(this.focusGoal, 0.06);
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch), t = this.target;
      this.camera.position.set(t.x + Math.sin(this.yaw) * cp * this.distance, t.y + sp * this.distance, t.z + Math.cos(this.yaw) * cp * this.distance);
      this.camera.lookAt(t);
    },
    resize() {
      if (!this.renderer || !this.viewport) return;
      const w = Math.max(1, this.viewport.clientWidth), h = Math.max(1, this.viewport.clientHeight);
      this.camera.aspect = w / h;
      // 竖屏时稍微拉远，保证整座城池入镜
      this.camera.fov = w / h < 1 ? 42 : 32;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(w, h, false);
    },

    /* ---------- 选中高亮：地面金色光环 + 镜头缓移 ---------- */
    selectRing: null,
    selectBuilding(key) {
      this.objects.forEach(item => item.label?.setAttribute('aria-pressed', String(item.key === key)));
      if (typeof Game !== 'undefined' && Game.Config) {
        const cfg = Game.Config.BUILDINGS[key];
        const state = Game.state && Game.state.city && Game.state.city.buildings[key];
        const name = document.getElementById('selectedBuildingName');
        const level = document.getElementById('selectedBuildingLevel');
        const benefit = document.getElementById('selectedBuildingBenefit');
        if (name) name.textContent = cfg?.name || key;
        if (level) level.textContent = `${state?.level || 1} 级`;
        if (benefit) benefit.textContent = cfg?.benefit?.(state?.level || 1) || '';
      }
      const item = this.objects.get(key);
      if (!item || !this.scene) return;
      if (!this.selectRing) {
        const g = new T.RingGeometry(.86, 1, 48); g.rotateX(-Math.PI / 2);
        this.selectRing = new T.Mesh(g, new T.MeshBasicMaterial({ color: 0xffd36a, transparent: true, opacity: .8, depthWrite: false, fog: false }));
        this.selectRing.renderOrder = 5;
        this.scene.add(this.selectRing);
      }
      const big = key === 'wall' ? 2.6 : key === 'hall' ? 4.2 : 2.2;
      this.selectRing.scale.setScalar(big);
      this.selectRing.position.set(item.focus.x, (key === 'wall' ? DIST.center.top : item.group.position.y) + .06, item.focus.z);
      if (this.selectedKey && this.selectedKey !== key) this.focusGoal.set(item.focus.x * .45, .6, item.focus.z * .45 + .5);
      this.selectedKey = key;
    },
    applyLevels() {
      if (typeof Game === 'undefined' || !Game.state || !Game.state.city) return;
      const bs = Game.state.city.buildings || {};
      this.objects.forEach(item => {
        const lv = bs[item.key]?.level || 1;
        item.group.traverse(o => { if (o.userData.minLevel !== undefined) o.visible = lv >= o.userData.minLevel; });
      });
    },
    syncBuildings() { this.applyLevels(); if (typeof Game !== 'undefined' && Game.state) this.selectBuilding(Game.state.selectedBuilding); },
    show() {
      this.init();
      if (typeof Game !== 'undefined' && Game.state) { this.applyLevels(); this.selectBuilding(Game.state.selectedBuilding); }
      requestAnimationFrame(() => this.resize());
    },
    setActive(active) { this.active = active; if (active) this.show(); },
    /* ---------- 动画循环 ---------- */
    animate() {
      this.raf = requestAnimationFrame(() => this.animate());
      if (!this.renderer) return;
      // 视口不可见（切到地图等页面）时暂停渲染，省电
      if (!this.visible || this.viewport.clientWidth === 0) return;
      const dt = Math.min(this.clock.getDelta(), .1), t = this.clock.elapsedTime;
      // 旗帜飘动
      anim.flags.forEach(f => {
        const pos = f.geometry.attributes.position, base = f.userData.base, w = base[base.length - 3] || .7;
        for (let i = 0; i < pos.count; i++) {
          const x = base[i * 3];
          pos.array[i * 3 + 2] = base[i * 3 + 2] + Math.sin(x * 9 - t * 5 + f.userData.phase) * .06 * (x / w);
        }
        pos.needsUpdate = true;
      });
      // 水面流动
      if (TX.water) { TX.water.offset.x = (t * .012) % 1; TX.water.offset.y = (t * .02) % 1; }
      if (anim.mill) anim.mill.rotation.z -= dt * 1.2;
      if (anim.forge) { const k = 1 + Math.sin(t * 13) * .08 + Math.sin(t * 29) * .05; anim.forge.scale.setScalar(k); }
      // 夜晚灯笼轻微闪烁
      if (this.lampPhase > 0) M.lantern.emissiveIntensity = (.25 + this.lampPhase * 2.6) * (1 + Math.sin(t * 7) * .04);
      // 炊烟
      this.smokes.forEach(s => {
        const u = s.userData; u.t = (u.t + dt * .16) % 1;
        s.position.set(u.x + Math.sin(u.t * 4 + u.x) * .3 + u.t * .6, u.y + u.t * 2.6, u.z + u.t * .3);
        s.scale.setScalar(.35 + u.t * 1.3);
        s.material.opacity = Math.sin(u.t * Math.PI) * (this.timeOfDay === 'night' ? .14 : .32);
      });
      // 云
      this.clouds.forEach(c => { 
        c.userData.angle = (c.userData.angle + c.userData.speed * dt * 0.01) % (Math.PI * 2);
        c.position.x = Math.cos(c.userData.angle) * c.userData.radius;
        c.position.z = Math.sin(c.userData.angle) * c.userData.radius;
      });
      updateWalkers(dt);
      if (this.selectRing) { this.selectRing.material.opacity = .55 + Math.sin(t * 3) * .25; this.selectRing.rotation.y += dt * .3; }
      if (this.autoRotate) this.yaw += dt * .15;
      this.setCamera();
      this.renderer.render(this.scene, this.camera);
      this.updateLabels();
    },
    updateLabels() {
      if (!this.labels || !this.camera) return;
      // 标签层与画布同处缩放后的舞台内，用布局尺寸（clientWidth）而不是屏幕尺寸，
      // 否则舞台 scale≠1 时标签会按比例偏离建筑，旋转视角后尤其明显
      const rect = { width: this.renderer.domElement.clientWidth, height: this.renderer.domElement.clientHeight };
      const sel = typeof Game !== 'undefined' && Game.state ? Game.state.selectedBuilding : this.selectedKey;
      this.objects.forEach(item => {
        if (!item.label) {
          item.label = document.createElement('button');
          item.label.type = 'button';
          item.label.className = 'city-building-label';
          item.label.textContent = item.name;
          item.label.addEventListener('click', () => {
            if (typeof Game === 'undefined' || !Game.state) return this.selectBuilding(item.key);
            Game.state.selectedBuilding = item.key;
            if (Game.UI && Game.UI.updateBuildings) Game.UI.updateBuildings(); else this.selectBuilding(item.key);
          });
          this.labels.appendChild(item.label);
        }
        const p = item.anchor.clone().project(this.camera);
        item.label.style.left = `${(p.x * .5 + .5) * rect.width}px`;
        item.label.style.top = `${(-p.y * .5 + .5) * rect.height}px`;
        item.label.style.display = p.z > 1 ? 'none' : 'block';
        item.label.setAttribute('aria-pressed', String(item.key === sel));
      });
    }
  };

  // cities.html 用顶层 const 声明 Game（不在 window 上），这里优先使用该绑定
  const G = (typeof Game !== 'undefined') ? Game : (window.Game = window.Game || {});
  G.CityView = CityView;
  window.CityView3D = CityView;
  // 有加载画面时由加载任务调用 init，避免开场动画卡顿
  if (!window.__deferCityInit) {
    if (document.readyState === 'complete') CityView.init();
    else window.addEventListener('load', () => CityView.init());
  }
})();
