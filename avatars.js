/*
 * 城池帝国 · 武将头像（内置 SVG）
 *
 * 纯内联 SVG 手绘头像，零外部依赖、离线可用、体积小，适合移动端横屏。
 * 用法：
 *   GameAvatars.list                 // [{ key, name, svg }]
 *   GameAvatars.get(key)             // 取单款定义
 *   GameAvatars.svg(key)             // 取 SVG 字符串（未知 key 返回默认款）
 *   GameAvatars.dataUri(key)         // data:image/svg+xml,... 供 background-image 使用
 *   GameAvatars.render(el, key)      // 把 SVG 渲染进元素（清空原内容）
 *   GameAvatars.apply(el, avatar)    // 兼容 preset:<key> 与外部图片 URL 的统一渲染
 *   GameAvatars.random()             // 随机 key（注册默认头像）
 *
 * 头像存储格式：preset:<key>（服务端有白名单校验）；第三方登录遗留的图片 URL 仍按 URL 渲染。
 */
(function () {
  'use strict';

  /** 通用武将头像构造器：统一五官结构，仅头盔/胡须/配色随人物变化，保证风格一致 */
  function build(o) {
    const id = 'av-' + o.key;
    return `<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${o.name}">` +
      `<defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="${o.bg1}"/><stop offset="1" stop-color="${o.bg2}"/></linearGradient></defs>` +
      `<rect width="100" height="100" rx="16" fill="url(#${id})"/>` +
      // 肩甲 / 战袍
      `<path d="M12 100 Q13 73 50 73 Q87 73 88 100 Z" fill="${o.armor}" stroke="${o.armorDark}" stroke-width="2"/>` +
      `<path d="M50 75 L50 100" stroke="${o.armorDark}" stroke-width="2" opacity=".8"/>` +
      `<path d="M30 82 Q50 76 70 82" stroke="${o.accent}" stroke-width="2.4" fill="none" opacity=".85"/>` +
      // 脖颈 / 双耳 / 头
      `<rect x="43" y="58" width="14" height="18" rx="7" fill="${o.skinShade}"/>` +
      `<ellipse cx="28.5" cy="47" rx="4.2" ry="6" fill="${o.skin}"/>` +
      `<ellipse cx="71.5" cy="47" rx="4.2" ry="6" fill="${o.skin}"/>` +
      `<ellipse cx="50" cy="45" rx="21" ry="23" fill="${o.skin}"/>` +
      // 眉 / 眼 / 鼻 / 口
      `<path d="M35 39 Q41 34.5 47 38" stroke="${o.hair}" stroke-width="3.2" fill="none" stroke-linecap="round"/>` +
      `<path d="M53 38 Q59 34.5 65 39" stroke="${o.hair}" stroke-width="3.2" fill="none" stroke-linecap="round"/>` +
      `<ellipse cx="41" cy="46" rx="3.3" ry="2.5" fill="#221710"/>` +
      `<ellipse cx="59" cy="46" rx="3.3" ry="2.5" fill="#221710"/>` +
      `<path d="M50 47 L47.6 54.5 L52.6 54.5" stroke="${o.skinShade}" stroke-width="1.6" fill="none" stroke-linejoin="round"/>` +
      `<path d="M44 61 Q50 64.5 56 61" stroke="#7c2b22" stroke-width="2.1" fill="none" stroke-linecap="round"/>` +
      (o.beard || '') + (o.helm || '') +
      `</svg>`;
  }

  // 常用头盔 / 冠帽片段
  const crown = a => `<path d="M28 31 Q50 9 72 31 L72 35 Q50 27 28 35 Z" fill="${a}" stroke="#3a2a18" stroke-width="2" stroke-linejoin="round"/>` +
    `<circle cx="50" cy="20" r="4" fill="#f4e2a6" stroke="#3a2a18" stroke-width="1.6"/>`;
  const warHelm = a => `<path d="M26 35 A25 25 0 0 1 74 35 L74 30 Q50 5 26 30 Z" fill="${a}" stroke="#2c2118" stroke-width="2" stroke-linejoin="round"/>` +
    `<path d="M50 6 L50 20" stroke="#f0d68e" stroke-width="3" stroke-linecap="round"/>` +
    `<path d="M30 34 Q50 26 70 34" stroke="#e8c976" stroke-width="2.4" fill="none"/>`;
  const scarf = a => `<path d="M29 33 Q50 13 71 33 Q60 27 50 27 Q40 27 29 33 Z" fill="${a}" stroke="#33281a" stroke-width="2"/>` +
    `<path d="M66 30 L86 40 L84 46 L64 38 Z" fill="${a}" stroke="#33281a" stroke-width="1.8" stroke-linejoin="round"/>`;
  const hornHelm = a => warHelm(a) +
    `<path d="M27 30 Q14 16 8 24 Q16 26 20 36 Z" fill="${a}" stroke="#2c2118" stroke-width="1.8"/>` +
    `<path d="M73 30 Q86 16 92 24 Q84 26 80 36 Z" fill="${a}" stroke="#2c2118" stroke-width="1.8"/>`;

  const longBeard = c => `<path d="M50 60 Q56 86 46 88 Q40 74 46 60 Z" fill="${c}" opacity=".95"/>`;
  const fullBeard = c => `<path d="M34 56 Q50 74 66 56 Q64 84 50 86 Q36 84 34 56 Z" fill="${c}"/>` +
    `<path d="M40 58 Q50 66 60 58" stroke="#00000022" stroke-width="1.4" fill="none"/>`;
  const mustache = c => `<path d="M38 58 Q45 61 50 59 Q55 61 62 58" stroke="${c}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  const sideHair = c => `<path d="M27 40 Q26 62 33 66 Q29 52 32 42 Z" fill="${c}"/>` +
    `<path d="M73 40 Q74 62 67 66 Q71 52 68 42 Z" fill="${c}"/>`;

  const defs = [
    { key: 'guanyu', name: '关羽', bg1: '#3f6f47', bg2: '#1f3a27', skin: '#b9755a', skinShade: '#96543c',
      armor: '#2f6b3a', armorDark: '#1c3f24', accent: '#e2c477', hair: '#2a1c12',
      helm: crown('#1f3f28'), beard: longBeard('#2a1c12') },
    { key: 'zhangfei', name: '张飞', bg1: '#4a4038', bg2: '#211a15', skin: '#9c6a4c', skinShade: '#7a4c33',
      armor: '#3b3630', armorDark: '#1d1915', accent: '#c9a24a', hair: '#171310',
      helm: warHelm('#2f2b26'), beard: fullBeard('#171310') },
    { key: 'zhaoyun', name: '赵云', bg1: '#7d90a8', bg2: '#3b4a63', skin: '#e2b48f', skinShade: '#c08f6b',
      armor: '#c6d2e0', armorDark: '#7f8ea2', accent: '#e7eef7', hair: '#2b2a33',
      helm: warHelm('#cfd9e6'), beard: '' },
    { key: 'zhugeliang', name: '诸葛亮', bg1: '#8a9a86', bg2: '#41513f', skin: '#e7c39c', skinShade: '#c8a077',
      armor: '#efe6cd', armorDark: '#b6a888', accent: '#8fb0c8', hair: '#33302a',
      helm: scarf('#eae0c4'), beard: longBeard('#3a352c') },
    { key: 'caocao', name: '曹操', bg1: '#4b3a5e', bg2: '#241a30', skin: '#dcb08a', skinShade: '#b98a63',
      armor: '#3d2f52', armorDark: '#211731', accent: '#d8b45c', hair: '#1d1712',
      helm: crown('#2c2140'), beard: fullBeard('#1d1712') },
    { key: 'lvbu', name: '吕布', bg1: '#8a5a2a', bg2: '#3d240f', skin: '#d9a679', skinShade: '#b57f55',
      armor: '#7a4a1f', armorDark: '#4a2b11', accent: '#f0cf7c', hair: '#231710',
      helm: hornHelm('#c98f2f'), beard: mustache('#231710') },
    { key: 'huangzhong', name: '黄忠', bg1: '#8a7a48', bg2: '#413617', skin: '#d7ab81', skinShade: '#b3855c',
      armor: '#9a7c34', armorDark: '#5f4a1a', accent: '#e6d089', hair: '#cfc6b4',
      helm: warHelm('#8a7433'), beard: fullBeard('#ded6c4') },
    { key: 'machao', name: '马超', bg1: '#6f8398', bg2: '#33424f', skin: '#e3b58e', skinShade: '#c28c63',
      armor: '#dfe7ef', armorDark: '#93a2b1', accent: '#cfe0f0', hair: '#26242b',
      helm: crown('#e6edf4'), beard: '' },
    { key: 'zhouyu', name: '周瑜', bg1: '#9a4a44', bg2: '#4a1f1d', skin: '#e7bb95', skinShade: '#c6936c',
      armor: '#c0392b', armorDark: '#7d241b', accent: '#f0cf7c', hair: '#241b16',
      helm: scarf('#8f2b24'), beard: '' },
    { key: 'diaochan', name: '貂蝉', bg1: '#c07a9a', bg2: '#6b3350', skin: '#f0cbb0', skinShade: '#d4a488',
      armor: '#d98cb0', armorDark: '#9a5578', accent: '#f6e0a8', hair: '#2a1b20',
      helm: `<path d="M27 34 Q50 10 73 34 Q50 24 27 34 Z" fill="#2a1b20" stroke="#1c1216" stroke-width="2"/>` +
        `<circle cx="50" cy="18" r="4.5" fill="#f6e0a8" stroke="#9a5578" stroke-width="1.6"/>` +
        `<circle cx="50" cy="42" r="2.4" fill="#c0392b"/>`,
      beard: '' }
  ];

  const list = defs.map(d => ({ key: d.key, name: d.name, svg: build(d) }));
  const byKey = new Map(list.map(a => [a.key, a]));
  const DEFAULT_KEY = 'zhaoyun';

  const GameAvatars = {
    list,
    get(key) { return byKey.get(String(key || '').replace(/^preset:/i, '')) || null; },
    svg(key) { const a = this.get(key) || byKey.get(DEFAULT_KEY); return a ? a.svg : ''; },
    name(key) { const a = this.get(key); return a ? a.name : ''; },
    /** data URI：供 background-image / <img src> 使用 */
    dataUri(key) { return 'data:image/svg+xml,' + encodeURIComponent(this.svg(key)); },
    /** 把预设头像渲染进元素（清空原内容，插入 SVG 节点） */
    render(el, key) {
      if (!el) return;
      el.innerHTML = this.svg(key);
      const svg = el.firstElementChild;
      if (svg) { svg.setAttribute('width', '100%'); svg.setAttribute('height', '100%'); }
    },
    /** 通用渲染：avatar 可能是 preset:<key> 或外部图片 URL */
    apply(el, avatar) {
      if (!el) return;
      const s = String(avatar || '');
      if (/^preset:/i.test(s)) { this.render(el, s); return; }
      if (/^(https?:|data:image\/)/i.test(s)) {
        el.textContent = '';
        el.style.backgroundImage = 'url(' + JSON.stringify(s) + ')';
        el.style.backgroundSize = 'cover';
        return;
      }
      this.render(el, DEFAULT_KEY);
    },
    random() { return list[Math.floor(Math.random() * list.length)].key; },
    DEFAULT_KEY
  };

  window.GameAvatars = GameAvatars;
})();
