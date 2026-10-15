/*
 * 城池帝国 · 热血加载画面（IntroLoading）
 *
 * 全部画在一块 Canvas 上（便于竖屏时整体旋转为横屏）：
 *   血色残阳 + 光芒 → 远山 → 燃烧的城池剪影与浓烟 → 火箭齐射 → 军阵长枪与战旗
 *   标题「城池帝国」重锤砸入（冲击波 + 震屏 + 火星爆散）→ 宝剑进度条（熔金灌注 + 火花）
 *
 * 用法：IntroLoading.start({ mount, tasks:[{label, weight, run}], minDuration, onDone })
 * 调试：URL 带 ?loading=hold 时加载画面循环播放，不进入游戏
 */
(function () {
  'use strict';
  const DW = 1280, DH = 720, TAU = Math.PI * 2;
  const FONT_TITLE = '"STXingkai","华文行楷","STLiti","华文隶书","STKaiti","KaiTi","楷体",serif';
  const FONT_UI = '"STKaiti","KaiTi","楷体","Microsoft YaHei",serif';
  const rnd = (a, b) => a + Math.random() * (b - a);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const easeOut = t => 1 - Math.pow(1 - t, 3);
  const easeIn = t => t * t * t;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // 固定种子噪声：山脊、城垛每次都一样
  function seeded(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  function canvas(w, h) { const c = document.createElement('canvas'); c.width = Math.max(1, Math.ceil(w)); c.height = Math.max(1, Math.ceil(h)); return c; }
  /** 发光圆点贴图（火星 / 火光） */
  function glowSprite(size, stops) {
    const c = canvas(size, size), g = c.getContext('2d'), r = size / 2;
    const gr = g.createRadialGradient(r, r, 0, r, r, r);
    stops.forEach(([o, col]) => gr.addColorStop(o, col));
    g.fillStyle = gr; g.fillRect(0, 0, size, size);
    return c;
  }

  const TIPS = [
    '烽火已燃，诸侯并起，唯强者可守其城',
    '城墙每升一级，敌军攻城代价便重一分',
    '粮草先行：农场等级决定你能养多少兵马',
    '金库充盈，方能招募精锐、铸造攻城器械',
    '择地建城：不同区域可招募不同兵种',
    '保护期内敌军无法攻城，抓紧时间发展'
  ];

  const Intro = {
    root: null, cvs: null, ctx: null, opts: null,
    vw: 0, vh: 0, dpr: 1, rot: false, scale: 1, ox: 0, oy: 0, k: 1, view: null,
    t0: 0, last: 0, raf: 0, progress: 0, shown: 0, label: '准备中', tipIdx: 0, tipT: 0,
    shake: 0, slammed: false, outT: -1, hold: false,
    L: null, embers: [], smokes: [], flames: [], arrows: [], sparks: [], rings: [], volleyT: 0,

    /** 启动：返回 Promise，所有任务完成且动画播完后 resolve */
    start(opts = {}) {
      this.opts = opts;
      this.hold = /[?&]loading=hold/.test(location.search);
      const root = this.root = document.createElement('div');
      root.id = 'intro-loading';
      root.setAttribute('role', 'progressbar');
      root.setAttribute('aria-label', '城池帝国 正在加载');
      root.setAttribute('aria-valuemin', '0'); root.setAttribute('aria-valuemax', '100');
      root.style.cssText = 'position:fixed;inset:0;z-index:10000;background:#120405;overflow:hidden;touch-action:pan-y';
      const c = this.cvs = canvas(1, 1);
      c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block';
      root.appendChild(c);
      (opts.mount || document.body).appendChild(root);
      this.ctx = c.getContext('2d');
      this._onResize = () => this.resize();
      this._onOrient = () => setTimeout(this._onResize, 120);
      window.addEventListener('resize', this._onResize);
      window.addEventListener('orientationchange', this._onOrient);
      this.resize();
      this.initParticles();
      this.t0 = this.last = performance.now();
      this.raf = requestAnimationFrame(n => this.frame(n));
      return this.runTasks(opts.tasks || [], opts.minDuration || 4500)
        .then(async () => {
          // 加载完成后可接一段停留在同一背景上的交互（登录界面）
          if (opts.afterLoad) {
            this.mode = 'after';
            try { await opts.afterLoad(this); } catch (e) { console.error('[IntroLoading] afterLoad 出错', e); }
          }
        })
        .then(() => this.finish());
    },
    /** 在画布上方叠一层 DOM（与画布同一套横屏旋转与缩放，尺寸为可见区域，单位为设计像素） */
    overlay() {
      if (!this.ui) {
        const el = this.ui = document.createElement('div');
        el.className = 'intro-ui';
        el.style.cssText = 'position:absolute;left:0;top:0;transform-origin:0 0;pointer-events:none';
        this.root.appendChild(el);
        this.layoutOverlay();
      }
      return this.ui;
    },
    layoutOverlay() {
      if (!this.ui) return;
      const v = this.view, s = this.scale;
      this.ui.style.width = v.w + 'px'; this.ui.style.height = v.h + 'px';
      this.ui.style.transform = (this.rot ? `translate(${this.vw}px,0) rotate(90deg) ` : '') + `scale(${s})`;
      // 供 DOM 对齐画布上的标题位置
      this.ui.style.setProperty('--title-y', (this.titleY() - v.y) + 'px');
    },
    titleY() { return Math.max(190, this.view.y + 150); },

    /** 画布按物理像素铺满；竖屏时整体旋转 90° 呈现横屏；内容按 cover 缩放 */
    resize() {
      if (!this.cvs) return;
      const vw = this.vw = window.innerWidth, vh = this.vh = window.innerHeight;
      const dpr = this.dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.cvs.width = Math.round(vw * dpr); this.cvs.height = Math.round(vh * dpr);
      this.rot = vh > vw;
      const lw = this.rot ? vh : vw, lh = this.rot ? vw : vh;
      const s = this.scale = Math.max(lw / DW, lh / DH);
      this.ox = (lw - DW * s) / 2; this.oy = (lh - DH * s) / 2;
      // 可见区域（设计坐标）：UI 依此贴边，保证超宽屏/竖屏都不被裁掉
      this.view = { x: -this.ox / s, y: -this.oy / s, w: lw / s, h: lh / s };
      const k = clamp(s * dpr, 1, 1.6);
      if (!this.L || Math.abs(k - this.k) > .15) { this.k = k; this.buildLayers(); }
      this.layoutOverlay();
    },
    applyTransform(shx = 0, shy = 0) {
      const g = this.ctx;
      g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      if (this.rot) { g.translate(this.vw, 0); g.rotate(Math.PI / 2); }
      g.translate(this.ox + shx * this.scale, this.oy + shy * this.scale);
      g.scale(this.scale, this.scale);
    },
    /* ---------- 静态图层预渲染（只在尺寸变化时重建） ---------- */
    layer(w, h, draw) {
      const c = canvas(w * this.k, h * this.k), g = c.getContext('2d');
      g.scale(this.k, this.k); draw(g); return c;
    },
    /** 剪影受光：在已画剪影上叠一层以落日为中心的暖光，形成轮廓边光 */
    rimLight(g, cx, cy, r, a) {
      g.save(); g.globalCompositeOperation = 'source-atop';
      const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
      gr.addColorStop(0, `rgba(255,140,50,${a})`); gr.addColorStop(.5, `rgba(200,50,20,${a * .45})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(-100, -100, DW + 200, DH + 200); g.restore();
    },
    buildLayers() {
      const W = DW + 80;   // 左右多留 40，用于视差漂移
      const L = this.L = {};
      L.sky = this.layer(DW, DH, g => {
        const gr = g.createLinearGradient(0, 0, 0, DH);
        gr.addColorStop(0, '#0d0207'); gr.addColorStop(.28, '#3a0a0c'); gr.addColorStop(.5, '#8c1e10');
        gr.addColorStop(.62, '#d4501a'); gr.addColorStop(.7, '#f08a2c'); gr.addColorStop(.78, '#6a1a0e'); gr.addColorStop(1, '#1a0505');
        g.fillStyle = gr; g.fillRect(0, 0, DW, DH);
        // 云层：横向暗红条带
        const R = seeded(7);
        for (let i = 0; i < 26; i++) {
          const y = 120 + R() * 300, w = 200 + R() * 520, x = R() * DW - 100, h = 6 + R() * 22;
          const cg = g.createLinearGradient(x, 0, x + w, 0);
          const a = .18 + R() * .3, warm = y > 300;
          const col = warm ? `rgba(255,120,60,${a * .7})` : `rgba(20,4,8,${a + .2})`;
          cg.addColorStop(0, 'rgba(0,0,0,0)'); cg.addColorStop(.5, col); cg.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = cg; g.beginPath(); g.ellipse(x + w / 2, y, w / 2, h, 0, 0, TAU); g.fill();
        }
      });
      const ridge = (g, seed, base, amp, rough, color, rim) => {
        const R = seeded(seed), pts = [];
        const n = 64; let y = 0;
        for (let i = 0; i <= n; i++) { y = y * .55 + (R() - .5) * rough; pts.push(base - Math.abs(Math.sin(i / n * Math.PI * (2 + seed % 3)) * amp) + y * amp * .35); }
        g.fillStyle = color; g.beginPath(); g.moveTo(0, DH);
        pts.forEach((p, i) => g.lineTo(i / n * W, p)); g.lineTo(W, DH); g.closePath(); g.fill();
        if (rim) this.rimLight(g, W / 2, 420, 700, rim);
      };
      L.far = this.layer(W, DH, g => ridge(g, 3, 470, 70, 1.6, '#4a1214', .5));
      L.mid = this.layer(W, DH, g => ridge(g, 11, 520, 46, 1.2, '#2a0a0c', .35));
      L.city = this.layer(DW, DH, g => this.drawCity(g));
      L.army = this.layer(W, DH, g => this.drawArmy(g, W));
      L.vignette = this.layer(DW, DH, g => {
        const gr = g.createRadialGradient(DW / 2, DH * .48, DH * .3, DW / 2, DH * .5, DW * .72);
        gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(8,0,2,.85)');
        g.fillStyle = gr; g.fillRect(0, 0, DW, DH);
        const top = g.createLinearGradient(0, 0, 0, 260);
        top.addColorStop(0, 'rgba(6,0,2,.75)'); top.addColorStop(1, 'rgba(6,0,2,0)');
        g.fillStyle = top; g.fillRect(0, 0, DW, 260);
      });
      L.title = this.buildTitle();
      L.ember = glowSprite(32, [[0, 'rgba(255,240,200,1)'], [.25, 'rgba(255,170,60,.9)'], [.6, 'rgba(255,70,20,.25)'], [1, 'rgba(255,40,0,0)']]);
      L.fire = glowSprite(128, [[0, 'rgba(255,230,160,.95)'], [.3, 'rgba(255,130,40,.6)'], [.7, 'rgba(200,40,10,.18)'], [1, 'rgba(120,10,0,0)']]);
      L.smoke = glowSprite(128, [[0, 'rgba(30,14,14,.55)'], [.6, 'rgba(30,12,12,.25)'], [1, 'rgba(20,8,8,0)']]);
      this.sweep = canvas(L.title.width, L.title.height);
    },
    /** 中式屋顶剪影：凹曲屋面 + 起翘檐角。y 为檐口高度 */
    roof(g, cx, y, w, h) {
      const hw = w / 2, rh = hw * .28;
      g.beginPath();
      g.moveTo(cx - hw - 6, y - 7);                                     // 左檐角起翘
      g.quadraticCurveTo(cx - hw * .55, y + 2, cx - rh, y - h);         // 凹曲屋面
      g.lineTo(cx + rh, y - h);
      g.quadraticCurveTo(cx + hw * .55, y + 2, cx + hw + 6, y - 7);
      g.lineTo(cx + hw - 4, y + 3); g.lineTo(cx - hw + 4, y + 3); g.closePath(); g.fill();
      g.fillRect(cx - rh - 3, y - h - 3, rh * 2 + 6, 4);                // 正脊
      for (const s of [-1, 1]) g.fillRect(cx + s * (rh + 1) - 2, y - h - 9, 4, 7);   // 鸱吻
    },
    /** 楼阁：墙身 + 若干重檐 */
    tower(g, cx, base, w, storeys, sh) {
      let y = base;
      for (let i = 0; i < storeys; i++) {
        const bw = w * (1 - i * .16);
        g.fillRect(cx - bw * .36, y - sh, bw * .72, sh);
        y -= sh;
        this.roof(g, cx, y + 2, bw, sh * .55);
        y -= sh * .35;
      }
      return y;
    },
    drawCity(g) {
      const C = '#14050a', baseY = 545;
      this.firePts = []; this.windows = [];
      g.fillStyle = C;
      // 城下土坡
      g.beginPath(); g.moveTo(250, DH); g.quadraticCurveTo(330, baseY - 10, 460, baseY - 4);
      g.lineTo(830, baseY - 4); g.quadraticCurveTo(960, baseY - 10, 1040, DH); g.fill();
      // 主城墙 + 垛口
      const wallTop = baseY - 70;
      g.fillRect(360, wallTop, 560, 72);
      for (let x = 360; x < 920; x += 16) g.fillRect(x, wallTop - 10, 10, 11);
      // 两翼低墙
      g.fillRect(290, wallTop + 26, 80, 48); g.fillRect(910, wallTop + 26, 80, 48);
      for (let x = 290; x < 370; x += 16) g.fillRect(x, wallTop + 17, 10, 10);
      for (let x = 910; x < 990; x += 16) g.fillRect(x, wallTop + 17, 10, 10);
      // 角楼
      for (const x of [372, 908]) {
        g.fillRect(x - 26, wallTop - 30, 52, 32);
        this.tower(g, x, wallTop - 30, 64, 1, 26);
        this.windows.push([x - 8, wallTop - 52, 16, 12]);
      }
      // 城门楼（三重檐）
      g.fillRect(560, wallTop - 46, 160, 50);
      const topY = this.tower(g, 640, wallTop - 46, 176, 3, 34);
      this.windows.push([606, wallTop - 74, 18, 16], [656, wallTop - 74, 18, 16], [626, wallTop - 128, 28, 14]);
      // 城门洞（火光从门里透出）
      this.gate = [640, baseY - 4, 30, 50];
      // 城内远景：宝塔与殿顶
      this.tower(g, 470, wallTop, 70, 1, 22);
      this.tower(g, 800, wallTop, 80, 1, 26);
      const pag = this.tower(g, 520, wallTop - 4, 42, 6, 20);
      g.fillRect(518, pag - 26, 4, 26);
      this.tower(g, 760, wallTop - 2, 50, 2, 22);
      // 城头旗杆
      for (const x of [420, 500, 780, 860]) g.fillRect(x, wallTop - 46, 3, 46);
      this.flagPts = [[421, wallTop - 46], [501, wallTop - 46], [781, wallTop - 46], [861, wallTop - 46], [640, topY - 30]];
      g.fillRect(639, topY - 30, 3, 32);
      this.rimLight(g, 640, 380, 520, .55);
      // 起火点：城头、角楼、城内
      this.firePts = [[450, wallTop - 8, 1], [372, wallTop - 58, 1.2], [830, wallTop - 10, 1.1], [908, wallTop - 52, .9], [700, wallTop - 4, .8], [560, wallTop - 4, .7], [520, wallTop - 60, .6]];
      this.smokePts = [[372, wallTop - 70], [830, wallTop - 30], [520, wallTop - 90], [700, wallTop - 20]];
    },
    /** 前景军阵：两排兵士剪影 + 长枪林 + 大旗杆（旗面在 frame 中动态飘动） */
    drawArmy(g, W) {
      const R = seeded(29), C = '#070103';
      this.armyFlags = [];
      g.fillStyle = C; g.strokeStyle = C; g.lineCap = 'round';
      // 底部土丘
      g.beginPath(); g.moveTo(0, DH); g.lineTo(0, 640);
      for (let x = 0; x <= W; x += 40) g.lineTo(x, 640 - Math.sin(x / 210) * 14 - R() * 6);
      g.lineTo(W, DH); g.closePath(); g.fill();
      for (const [row, y0, sz] of [[0, 640, .8], [1, 676, 1.05]]) {
        for (let x = -10; x < W + 10; x += 15 * sz + R() * 8) {
          if (row === 0 && x > 470 && x < 820 && R() < .7) continue;   // 中间留出视野看城门
          const y = y0 + R() * 6, h = 34 * sz;
          // 身体 + 头盔（盔缨）
          g.beginPath(); g.ellipse(x, y - h * .45, 6 * sz, h * .5, 0, 0, TAU); g.fill();
          g.beginPath(); g.arc(x, y - h, 5 * sz, 0, TAU); g.fill();
          g.fillRect(x - .8, y - h - 11 * sz, 1.6, 7 * sz);
          // 长枪：略向城池倾斜
          if (R() < .62) {
            const lean = (640 + 40 - x) / 2400 + (R() - .5) * .08, len = 95 * sz + R() * 40;
            const tx = x + 7 + Math.sin(lean) * len, ty = y - h * .6 - Math.cos(lean) * len;
            g.lineWidth = 1.8 * sz; g.beginPath(); g.moveTo(x + 7, y - h * .3); g.lineTo(tx, ty); g.stroke();
            g.beginPath(); g.moveTo(tx, ty - 9 * sz); g.lineTo(tx - 2.6 * sz, ty + 2); g.lineTo(tx + 2.6 * sz, ty + 2); g.fill();
          }
          // 盾牌
          if (row === 1 && R() < .3) { g.beginPath(); g.ellipse(x - 6, y - h * .4, 7, 12, 0, 0, TAU); g.fill(); }
        }
      }
      // 大旗杆（旗面动态绘制）
      for (const [x, hgt] of [[150, 300], [330, 240], [960, 250], [1150, 310]]) {
        g.lineWidth = 4; g.beginPath(); g.moveTo(x, 690); g.lineTo(x, 690 - hgt); g.stroke();
        g.beginPath(); g.arc(x, 690 - hgt - 4, 5, 0, TAU); g.fill();
        this.armyFlags.push([x, 690 - hgt + 6]);
      }
      this.rimLight(g, W / 2, 470, 760, .28);
    },
    /** 标题：「城池帝国」金边红底书法字 + 副标题，预渲染为一张贴图 */
    buildTitle() {
      const w = 760, h = 260, k = this.k;
      const c = canvas(w * k, h * k), g = c.getContext('2d');
      g.scale(k, k);
      const txt = '城池帝国', cx = w / 2, cy = 128;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.font = `bold 136px ${FONT_TITLE}`;
      g.lineJoin = 'round';
      // 外发光 + 深色描边
      g.shadowColor = 'rgba(255,90,20,.85)'; g.shadowBlur = 34;
      g.lineWidth = 16; g.strokeStyle = '#2a0604'; g.strokeText(txt, cx, cy);
      g.shadowBlur = 0;
      g.lineWidth = 7; g.strokeStyle = '#7a1a0c'; g.strokeText(txt, cx, cy);
      // 金色渐变字面
      const gr = g.createLinearGradient(0, cy - 70, 0, cy + 70);
      gr.addColorStop(0, '#fff6cf'); gr.addColorStop(.35, '#ffd36a'); gr.addColorStop(.55, '#e08a1e');
      gr.addColorStop(.75, '#b8520f'); gr.addColorStop(1, '#ffcc66');
      g.fillStyle = gr; g.fillText(txt, cx, cy);
      // 高光细描
      g.lineWidth = 1.4; g.strokeStyle = 'rgba(255,250,220,.75)'; g.strokeText(txt, cx, cy - 1);
      this.titleMask = { w, h };
      return c;
    },
    /** 书法字体加载完成后重绘标题（首帧可能用的是后备字体） */
    refreshTitle() {
      if (!this.L) return;
      this.L.title = this.buildTitle();
      this.sweep = canvas(this.L.title.width, this.L.title.height);
    },
    /* ---------- 粒子 ---------- */
    initParticles() {
      this.embers = []; this.smokes = []; this.arrows = []; this.sparks = []; this.rings = [];
      for (let i = 0; i < 90; i++) this.embers.push(this.newEmber(true));
      for (let i = 0; i < 26; i++) this.smokes.push(this.newSmoke(true));
      this.volleyT = 1.6;
    },
    newEmber(init) {
      const v = this.view || { x: 0, y: 0, w: DW, h: DH };
      return { x: rnd(v.x, v.x + v.w), y: init ? rnd(v.y, v.y + v.h) : v.y + v.h + 10, vx: rnd(-8, 26), vy: rnd(-70, -25),
        s: rnd(2, 7), life: rnd(3, 7), age: init ? rnd(0, 4) : 0, ph: rnd(0, TAU) };
    },
    newSmoke(init) {
      const p = this.smokePts ? this.smokePts[(Math.random() * this.smokePts.length) | 0] : [640, 420];
      return { x: p[0] + rnd(-10, 10), y: p[1], vx: rnd(8, 22), vy: rnd(-26, -14), s: rnd(40, 70), age: init ? rnd(0, 7) : 0, life: rnd(6, 9), rot: rnd(0, TAU) };
    },
    volley() {
      const n = 10 + (Math.random() * 8 | 0);
      for (let i = 0; i < n; i++) {
        const sx = rnd(80, 330), sy = rnd(640, 690), tx = rnd(420, 900), ty = rnd(440, 500);
        this.arrows.push({ sx, sy, tx, ty, peak: rnd(150, 260), t: -i * .05 - Math.random() * .2, dur: rnd(1.3, 1.7), trail: [] });
      }
    },
    burst(x, y, n, speed, hot) {
      for (let i = 0; i < n; i++) {
        const a = rnd(0, TAU), v = rnd(speed * .3, speed);
        this.sparks.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - speed * .2, age: 0, life: rnd(.5, 1.3), s: rnd(1.5, hot ? 5 : 3) });
      }
    },
    /* ---------- 加载任务 ---------- */
    async runTasks(tasks, minDuration) {
      const total = tasks.reduce((s, t) => s + (t.weight || 1), 0) || 1;
      let done = 0;
      const begin = this.begin = performance.now();
      this.minDur = minDuration;
      for (const t of tasks) {
        this.label = t.label || '加载中';
        await sleep(30);                         // 让出一帧，保证文字先刷新
        try { await t.run(); } catch (e) { console.warn('[IntroLoading] 任务失败：', t.label, e); }
        done += t.weight || 1;
        this.progress = done / total;
      }
      this.progress = 1;
      this.label = '城门已开';
      const rest = minDuration - (performance.now() - begin);
      if (rest > 0) await sleep(rest);
      while (this.shown < .995) await sleep(50);   // 等进度条动画追上
      await sleep(350);
      while (this.hold) await sleep(1000);
    },
    finish() {
      return new Promise(resolve => {
        this.outT = 0; this._resolveOut = resolve;
      }).then(() => {
        cancelAnimationFrame(this.raf);
        window.removeEventListener('resize', this._onResize);
        window.removeEventListener('orientationchange', this._onOrient);
        this.root && this.root.remove();
        this.root = this.cvs = this.ctx = this.ui = null; this.L = null; this.mode = null;
        if (this.opts && this.opts.onDone) this.opts.onDone();
      });
    },
    /* ---------- 每帧绘制 ---------- */
    frame(now) {
      if (!this.ctx) return;
      this.raf = requestAnimationFrame(n => this.frame(n));
      const dt = Math.min(.05, (now - this.last) / 1000); this.last = now;
      const t = (now - this.t0) / 1000, g = this.ctx, L = this.L;
      // 进度条既跟随真实任务，也按最短时长匀速推进，避免一开始就冲到 100% 再干等
      const timeCap = this.begin ? clamp((now - this.begin) / (this.minDur || 1), 0, 1) : 0;
      const target = Math.min(this.progress, timeCap * .97 + (this.progress >= 1 && timeCap >= 1 ? .03 : 0));
      this.shown += (target - this.shown) * Math.min(1, dt * 3.2);
      this.shake *= Math.pow(.02, dt);
      if (this.reduced === undefined) this.reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
      const reduced = this.reduced;
      const sk = reduced ? 0 : this.shake;
      g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
      g.fillStyle = '#120405'; g.fillRect(0, 0, this.cvs.width, this.cvs.height);
      this.applyTransform(rnd(-1, 1) * sk, rnd(-1, 1) * sk);
      const px = Math.sin(t * .18) * 22;                  // 缓慢镜头漂移 → 视差
      g.drawImage(L.sky, 0, 0, DW, DH);
      this.drawSun(g, t);
      g.drawImage(L.far, -40 + px * .25, 0, DW + 80, DH);
      g.drawImage(L.mid, -40 + px * .5, 0, DW + 80, DH);
      this.drawSmoke(g, dt, px * .7);
      g.save(); g.translate(px * .7, 0);
      g.drawImage(L.city, 0, 0, DW, DH);
      this.drawCityFx(g, t);
      this.drawArrows(g, dt);
      g.restore();
      g.save(); g.translate(-40 + px, 0);
      g.drawImage(L.army, 0, 0, DW + 80, DH);
      for (const [x, y] of this.armyFlags) this.flag(g, x, y, 92, 54, t * 3.2 + x, '#8c1610', '#e2b04a');
      g.restore();
      this.drawEmbers(g, dt);
      g.drawImage(L.vignette, 0, 0, DW, DH);
      this.drawTitle(g, t);
      this.drawSparks(g, dt);
      // 进入登录阶段后进度条淡出，背景动画继续
      this.barA = clamp((this.barA ?? 1) + (this.mode === 'after' ? -dt * 2.5 : dt * 4), 0, 1);
      if (this.barA > 0) { g.save(); g.globalAlpha = this.barA; this.drawBar(g, t, dt); g.restore(); }
      // 火箭齐射节奏
      this.volleyT -= dt; if (this.volleyT <= 0) { this.volley(); this.volleyT = rnd(2.4, 3.6); }
      if (this.outT >= 0) this.drawExit(g, dt);
      if (this.root && this.mode !== 'after') this.root.setAttribute('aria-valuenow', String(Math.round(this.shown * 100)));
    },
    drawSun(g, t) {
      const cx = 640, cy = 452, pulse = 1 + Math.sin(t * 1.7) * .04;
      g.save(); g.globalCompositeOperation = 'lighter';
      // 光芒：缓慢旋转的放射光束
      g.translate(cx, cy); g.rotate(t * .025);
      for (let i = 0; i < 14; i++) {
        g.rotate(TAU / 14);
        const a = .05 + .035 * Math.sin(t * .9 + i * 1.7);
        const gr = g.createLinearGradient(0, 0, 0, -760);
        gr.addColorStop(0, `rgba(255,170,80,${a})`); gr.addColorStop(1, 'rgba(255,90,30,0)');
        g.fillStyle = gr; g.beginPath(); g.moveTo(-6, 0); g.lineTo(-60, -760); g.lineTo(60, -760); g.lineTo(6, 0); g.fill();
      }
      g.restore();                                  // restore 同时复位旋转
      g.save(); g.globalCompositeOperation = 'lighter';
      const r = 330 * pulse;
      g.drawImage(this.L.fire, cx - r, cy - r, r * 2, r * 2);
      const d = g.createRadialGradient(cx, cy, 0, cx, cy, 70);
      d.addColorStop(0, 'rgba(255,248,220,1)'); d.addColorStop(.55, 'rgba(255,200,110,.9)'); d.addColorStop(1, 'rgba(255,120,40,0)');
      g.fillStyle = d; g.beginPath(); g.arc(cx, cy, 70, 0, TAU); g.fill();
      g.restore();
    },
    /** 飘动的旗：上下沿是行进的正弦波 */
    flag(g, x, y, w, h, ph, col, edge) {
      const n = 12, top = [], bot = [];
      for (let i = 0; i <= n; i++) {
        const u = i / n, wv = Math.sin(ph - u * 4.2) * h * .16 * u;
        top.push([x + u * w, y + wv + u * h * .05]); bot.push([x + u * w, y + h - u * h * .12 + wv]);
      }
      g.fillStyle = col; g.beginPath(); g.moveTo(x, y);
      top.forEach(p => g.lineTo(p[0], p[1])); for (let i = n; i >= 0; i--) g.lineTo(bot[i][0], bot[i][1]);
      g.closePath(); g.fill();
      g.strokeStyle = edge; g.lineWidth = Math.max(1, h * .05); g.stroke();
    },
    drawSmoke(g, dt, off) {
      g.save(); g.translate(off, 0);
      for (let i = 0; i < this.smokes.length; i++) {
        let p = this.smokes[i];
        p.age += dt; if (p.age > p.life) { p = this.smokes[i] = this.newSmoke(false); }
        p.x += p.vx * dt; p.y += p.vy * dt;
        const u = p.age / p.life, s = p.s * (1 + u * 2.6);
        g.globalAlpha = Math.sin(u * Math.PI) * .9;
        g.drawImage(this.L.smoke, p.x - s, p.y - s, s * 2, s * 2);
      }
      g.restore(); g.globalAlpha = 1;
    },
    drawCityFx(g, t) {
      const L = this.L;
      g.save(); g.globalCompositeOperation = 'lighter';
      // 门洞与窗口的火光
      const [gx, gy, gw, gh] = this.gate, fl = .75 + .25 * Math.sin(t * 9) * Math.sin(t * 5.3);
      const gg = g.createRadialGradient(gx, gy - gh * .4, 4, gx, gy - gh * .4, 90);
      gg.addColorStop(0, `rgba(255,190,90,${.75 * fl})`); gg.addColorStop(1, 'rgba(255,60,10,0)');
      g.fillStyle = gg; g.fillRect(gx - 90, gy - gh - 60, 180, gh + 70);
      g.fillStyle = `rgba(255,170,70,${.85 * fl})`;
      g.beginPath(); g.moveTo(gx - gw / 2, gy); g.lineTo(gx - gw / 2, gy - gh + gw / 2);
      g.arc(gx, gy - gh + gw / 2, gw / 2, Math.PI, 0); g.lineTo(gx + gw / 2, gy); g.fill();
      this.windows.forEach(([x, y, w, h], i) => {
        g.fillStyle = `rgba(255,150,50,${.45 + .35 * Math.sin(t * 6 + i * 2.1)})`; g.fillRect(x, y, w, h);
      });
      // 城头大火：多层火光贴图抖动
      for (const [x, y, s] of this.firePts) {
        for (let j = 0; j < 4; j++) {
          const f = Math.sin(t * (7 + j * 2.3) + x) * .5 + .5, sz = (34 + j * 16) * s * (.8 + f * .35);
          g.globalAlpha = .55 - j * .1;
          g.drawImage(L.fire, x - sz / 2 + Math.sin(t * 3 + j) * 3, y - sz * (.9 + j * .12), sz, sz * 1.25);
        }
        if (Math.random() < .12 * s && this.embers.length < 170) {
          const e = this.newEmber(false); e.x = x; e.y = y - 10; e.vy = rnd(-90, -50); e.life = rnd(1.5, 3); e.s = rnd(2, 4); e.fx = 1;
          this.embers.push(e);
        }
      }
      g.restore(); g.globalAlpha = 1;
      // 城头小旗
      for (const [x, y] of this.flagPts) this.flag(g, x + 2, y, 30, 17, t * 4 + x * .1, '#5a0c08', '#b8862e');
    },
    drawArrows(g, dt) {
      const L = this.L, off = Math.sin(((this.last - this.t0) / 1000) * .18) * 22 * .7;
      g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
      for (let i = this.arrows.length - 1; i >= 0; i--) {
        const a = this.arrows[i]; a.t += dt;
        if (a.t < 0) continue;
        const u = Math.min(1, a.t / a.dur);
        const x = a.sx + (a.tx - a.sx) * u, y = a.sy + (a.ty - a.sy) * u - a.peak * 4 * u * (1 - u);
        a.trail.push([x, y]); if (a.trail.length > 10) a.trail.shift();
        for (let j = 1; j < a.trail.length; j++) {
          g.strokeStyle = `rgba(255,${120 + j * 10},50,${j / a.trail.length * .7})`; g.lineWidth = j / a.trail.length * 2.4;
          g.beginPath(); g.moveTo(a.trail[j - 1][0], a.trail[j - 1][1]); g.lineTo(a.trail[j][0], a.trail[j][1]); g.stroke();
        }
        g.drawImage(L.ember, x - 7, y - 7, 14, 14);
        if (u >= 1) { this.burst(x + off, y, 7, 90, false); this.arrows.splice(i, 1); }
      }
      g.restore();
    },
    drawEmbers(g, dt) {
      const v = this.view, spr = this.L.ember;
      g.save(); g.globalCompositeOperation = 'lighter';
      for (let i = this.embers.length - 1; i >= 0; i--) {
        const e = this.embers[i];
        e.age += dt; e.ph += dt * 3;
        e.x += (e.vx + Math.sin(e.ph) * 14) * dt; e.y += e.vy * dt;
        if (e.age > e.life || e.y < v.y - 20) {
          if (e.fx || this.embers.length > 90) this.embers.splice(i, 1); else this.embers[i] = this.newEmber(false);
          continue;
        }
        const u = e.age / e.life;
        g.globalAlpha = Math.min(1, u * 6) * (1 - u) * (.6 + .4 * Math.sin(e.ph * 2.3));
        g.drawImage(spr, e.x - e.s, e.y - e.s, e.s * 2, e.s * 2);
      }
      g.restore(); g.globalAlpha = 1;
    },
    drawSparks(g, dt) {
      const spr = this.L.ember;
      g.save(); g.globalCompositeOperation = 'lighter';
      for (let i = this.sparks.length - 1; i >= 0; i--) {
        const p = this.sparks[i]; p.age += dt;
        if (p.age > p.life) { this.sparks.splice(i, 1); continue; }
        p.vy += 160 * dt; p.vx *= Math.pow(.4, dt); p.x += p.vx * dt; p.y += p.vy * dt;
        g.globalAlpha = 1 - p.age / p.life;
        g.drawImage(spr, p.x - p.s, p.y - p.s, p.s * 2, p.s * 2);
      }
      // 冲击波
      for (let i = this.rings.length - 1; i >= 0; i--) {
        const r = this.rings[i]; r.age += dt;
        const u = r.age / r.life; if (u >= 1) { this.rings.splice(i, 1); continue; }
        // A ring can start slightly before its timestamp for a smoother impact;
        // clamp the interpolated radius so Canvas never receives a negative axis.
        const rad = Math.max(0, r.r0 + (r.r1 - r.r0) * easeOut(Math.max(0, u)));
        g.globalAlpha = (1 - u) * .8; g.strokeStyle = '#ffc26a'; g.lineWidth = 10 * (1 - u) + 1;
        g.beginPath(); g.ellipse(r.x, r.y, rad, rad * .36, 0, 0, TAU); g.stroke();
      }
      g.restore(); g.globalAlpha = 1;
    },
    /** 标题：0.6s 起从 3 倍大重锤砸下，落地冲击；之后周期性金光扫过 */
    drawTitle(g, t) {
      // 超宽屏会裁掉上下边，标题随可见区域下移，保证不被切
      const T = this.L.title, { w, h } = this.titleMask, cx = 640, cy = this.titleY();
      const t1 = t - .6, dur = .42;
      if (t1 < 0) return;
      let s = 1, a = 1;
      if (t1 < dur) { const u = t1 / dur; s = 3 - 2 * easeIn(u); a = Math.min(1, u * 2.2); }
      else if (!this.slammed) {
        this.slammed = true; this.shake = 14;
        this.rings.push({ x: cx, y: cy + 50, r0: 80, r1: 620, age: 0, life: .9 });
        this.rings.push({ x: cx, y: cy + 50, r0: 40, r1: 380, age: -.08, life: .7 });
        for (let i = 0; i < 6; i++) this.burst(cx + rnd(-280, 280), cy + rnd(-30, 50), 10, 260, true);
      }
      const bounce = t1 >= dur ? 1 + Math.sin(Math.min(1, (t1 - dur) / .3) * Math.PI) * .045 : 1;
      const breath = 1 + Math.sin(t * 1.3) * .008;
      g.save(); g.globalAlpha = a;
      g.translate(cx, cy); g.scale(s * bounce * breath, s * bounce * breath);
      // 砸入瞬间的白色闪光
      if (t1 >= dur && t1 < dur + .25) {
        g.save(); g.globalCompositeOperation = 'lighter'; g.globalAlpha = 1 - (t1 - dur) / .25;
        g.drawImage(this.L.fire, -w * .6, -h * .8, w * 1.2, h * 1.6); g.restore();
      }
      g.drawImage(T, -w / 2, -h / 2, w, h);
      // 金光扫过：在离屏画布上用标题做遮罩
      const sp = ((t - 2) % 4.5) / 1.1;
      if (t > 2 && sp < 1) {
        const sc = this.sweep, sg = sc.getContext('2d'), k = this.k;
        sg.setTransform(1, 0, 0, 1, 0, 0); sg.globalCompositeOperation = 'source-over';
        sg.clearRect(0, 0, sc.width, sc.height); sg.drawImage(T, 0, 0);
        sg.globalCompositeOperation = 'source-in';
        const x = (-.2 + sp * 1.4) * sc.width, gr = sg.createLinearGradient(x - 90 * k, 0, x + 90 * k, 0);
        gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.5, 'rgba(255,250,225,.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
        sg.fillStyle = gr; sg.fillRect(0, 0, sc.width, sc.height);
        g.globalCompositeOperation = 'lighter'; g.drawImage(sc, -w / 2, -h / 2, w, h);
      }
      g.restore();
      // 副标题：砸入后淡入
      const st = clamp((t1 - dur - .2) / .8, 0, 1);
      if (st > 0) {
        g.save(); g.globalAlpha = st; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.font = `600 22px ${FONT_UI}`; g.fillStyle = '#f3d9a4';
        g.shadowColor = 'rgba(0,0,0,.9)'; g.shadowBlur = 8;
        const sub = '· 烽 火 连 城   群 雄 逐 鹿 ·';
        g.fillText(sub, cx, cy + 108 + (1 - st) * 12);
        g.restore();
      }
    },
    /** 宝剑进度条：剑身为槽，熔金从剑柄灌向剑尖 */
    drawBar(g, t, dt) {
      const v = this.view, cx = 640;
      const bottom = Math.min(DH, v.y + v.h), y = bottom - 92;
      const bw = Math.min(720, v.w - 120), x0 = cx - bw / 2 + 50, x1 = cx + bw / 2;   // 剑身起止
      const p = clamp(this.shown, 0, 1), xf = x0 + (x1 - 26 - x0) * p;
      g.save();
      // 剑柄 + 护手
      g.fillStyle = '#2a1408'; g.fillRect(x0 - 50, y - 4, 38, 8);
      g.fillStyle = '#c99a3c'; g.beginPath(); g.arc(x0 - 54, y, 7, 0, TAU); g.fill();
      for (let i = 0; i < 5; i++) { g.fillStyle = i % 2 ? '#8a5a22' : '#d4a548'; g.fillRect(x0 - 46 + i * 7, y - 4, 3, 8); }
      g.beginPath(); g.moveTo(x0 - 12, y - 16); g.quadraticCurveTo(x0 - 4, y, x0 - 12, y + 16);
      g.lineTo(x0, y + 7); g.lineTo(x0, y - 7); g.closePath();
      const hg = g.createLinearGradient(0, y - 16, 0, y + 16); hg.addColorStop(0, '#ffe39a'); hg.addColorStop(1, '#8a5a1c');
      g.fillStyle = hg; g.fill();
      // 剑身槽
      const blade = () => { g.beginPath(); g.moveTo(x0, y - 6); g.lineTo(x1 - 26, y - 6); g.lineTo(x1, y); g.lineTo(x1 - 26, y + 6); g.lineTo(x0, y + 6); g.closePath(); };
      blade(); g.fillStyle = 'rgba(20,6,6,.82)'; g.fill();
      g.strokeStyle = 'rgba(220,170,90,.7)'; g.lineWidth = 1.2; g.stroke();
      // 熔金
      g.save(); blade(); g.clip();
      const mg = g.createLinearGradient(0, y - 6, 0, y + 6);
      mg.addColorStop(0, '#fff3c4'); mg.addColorStop(.45, '#ffb440'); mg.addColorStop(1, '#c2410c');
      g.fillStyle = mg; g.fillRect(x0, y - 7, xf - x0 + (p >= .999 ? 30 : 0), 14);
      // 熔流纹理
      g.globalCompositeOperation = 'lighter'; g.fillStyle = 'rgba(255,240,190,.35)';
      for (let xx = x0 - 40 + (t * 90) % 40; xx < xf; xx += 40) g.fillRect(xx, y - 2, 16, 2);
      g.restore();
      // 熔金前端光点 + 火花
      if (p < .999 || this.outT < 0) {
        g.save(); g.globalCompositeOperation = 'lighter';
        const r = 26 + Math.sin(t * 14) * 4;
        g.drawImage(this.L.fire, xf - r, y - r, r * 2, r * 2);
        g.restore();
        if (Math.random() < dt * 30 && p < .999) this.sparks.push({ x: xf, y, vx: rnd(-40, 60), vy: rnd(-140, -40), age: 0, life: rnd(.3, .7), s: rnd(1.2, 2.6) });
      }
      // 文字：百分比 / 当前资源 / 提示
      g.textBaseline = 'middle'; g.shadowColor = 'rgba(0,0,0,.95)'; g.shadowBlur = 6;
      g.font = `bold 20px ${FONT_UI}`; g.fillStyle = '#ffd77a'; g.textAlign = 'right';
      g.fillText(Math.round(p * 100) + '%', x1, y - 24);
      g.font = `15px ${FONT_UI}`; g.fillStyle = '#e8cfa2'; g.textAlign = 'left';
      g.fillText(this.label + '……', x0, y - 24);
      this.tipT += dt;
      if (this.tipT > 3.6) { this.tipT = 0; this.tipIdx = (this.tipIdx + 1) % TIPS.length; }
      const ta = Math.min(1, this.tipT / .4, (3.6 - this.tipT) / .4);
      g.globalAlpha = clamp(ta, 0, 1); g.textAlign = 'center'; g.font = `14px ${FONT_UI}`; g.fillStyle = '#c9b089';
      g.fillText('【 战 报 】 ' + TIPS[this.tipIdx], cx, y + 34);
      g.restore();
    },
    /** 退场：白金闪光后整体淡出（约 0.9s） */
    drawExit(g, dt) {
      this.outT += dt;
      const u = this.outT;
      g.save(); g.setTransform(1, 0, 0, 1, 0, 0);
      if (u < .18) { g.globalAlpha = u / .18 * .85; g.fillStyle = '#fff1cf'; }
      else { g.globalAlpha = clamp(.85 + (u - .18) / .3, 0, 1); g.fillStyle = '#0a0204'; }
      g.fillRect(0, 0, this.cvs.width, this.cvs.height);
      g.restore();
      if (this.root) this.root.style.opacity = String(clamp(1 - (u - .5) / .4, 0, 1));
      if (u >= .9 && this._resolveOut) { const r = this._resolveOut; this._resolveOut = null; r(); }
    }
  };

  window.IntroLoading = Intro;
  // 加载画面期间再构建三维城池，避免开场动画卡顿
  window.__deferCityInit = true;
})();
