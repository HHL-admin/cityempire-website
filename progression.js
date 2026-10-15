/*
 * 城池帝国 · 养成与税收模块（人口 / 税率 / 秘籍道具与时效增益）
 *
 * 设计要点：
 *  - 所有数值取自 balance-config.js（window.GameBalance），本文件不写死任何平衡数字；
 *  - 服务端是道具背包（items 表）的权威来源，本地 city.items 只是缓存，用于展示；
 *  - 使用秘籍 = 调服务端扣减 + 本地写入时效增益（c.buffs），战力倍率再随玩家快照上报；
 *  - 税率面板呈现"人口增速 ↔ 金币收益"的双向制衡曲线，选择即生效。
 *
 * 挂载：window.Progression，由 cities.html 在 HUD 指令区按钮上调用。
 */
(function () {
  'use strict';
  if (!window.Auth) { console.warn('[Progression] 需要先加载 auth.js'); return; }
  const B = window.GameBalance;
  if (!B) { console.warn('[Progression] 需要先加载 balance-config.js'); return; }

  const api = window.Auth.api;
  const TOKEN = () => (window.Auth.session && window.Auth.session.token) || '';
  const isReady = () => !!TOKEN() && !window.Auth.isGuest;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cityOf = () => (window.Game && Game.state && Game.state.city) || null;

  /** 当前城池是否大型城池（按建城地点类型判定，决定拍卖行入口是否可见） */
  function cityType() {
    const c = cityOf();
    if (!c) return '';
    return String((c.mapPosition && c.mapPosition.placeType) || c.cityType || '');
  }
  const isLargeCity = () => B.helpers.isLargeCityType(cityType());

  /* ---------------- 样式（避免改动 cities.html 的内联 CSS） ---------------- */
  function injectStyles() {
    if (document.getElementById('ceProgressionStyles')) return;
    const style = document.createElement('style');
    style.id = 'ceProgressionStyles';
    style.textContent = `
      .ce-tax-list { display:flex; flex-direction:column; gap:6px; margin-top:6px; }
      .ce-tax-row { display:flex; align-items:center; gap:10px; width:100%; padding:9px 12px; cursor:pointer;
        background:rgba(212,165,116,0.06); border:1px solid var(--panel-line); border-radius:4px;
        color:var(--text); font-size:13px; text-align:left; transition:background .15s, border-color .15s; }
      .ce-tax-row:hover { background:rgba(212,165,116,0.14); }
      .ce-tax-row.is-active { border-color:var(--accent); background:rgba(212,165,116,0.18); }
      .ce-tax-lv { flex:0 0 48px; font-weight:bold; color:var(--accent); }
      .ce-tax-col { flex:1; color:var(--text-dim); font-size:12px; }
      .ce-tax-col b { color:var(--text); }
      .ce-tax-tag { font-size:11px; color:var(--accent-dark); border:1px solid var(--accent-dark); border-radius:3px; padding:1px 5px; }
      .ce-bag-item { display:flex; align-items:center; gap:10px; padding:10px 12px; margin:6px 0;
        background:rgba(0,0,0,0.2); border:1px solid var(--panel-line); border-radius:4px; }
      .ce-bag-main { flex:1; min-width:0; }
      .ce-bag-name { font-weight:bold; font-size:13px; }
      .ce-bag-desc { font-size:11px; color:var(--text-dim); margin-top:2px; }
      .ce-bag-qty { font-size:12px; color:var(--accent); margin-right:4px; }
      .ce-bag-btn { padding:6px 12px; font-size:12px; color:#1a1208; background:var(--accent);
        border:none; border-radius:3px; cursor:pointer; }
      .ce-bag-btn:disabled { background:rgba(212,165,116,0.25); color:var(--text-dim); cursor:not-allowed; }
      .ce-buff-row { display:flex; justify-content:space-between; font-size:12px; color:var(--text-dim);
        padding:5px 0; border-bottom:1px dashed var(--panel-line); }
    `;
    document.head.appendChild(style);
  }

  /** 让某道具的展示名（含目标资源） */
  const buffDesc = key => {
    const b = B.buffs[key] || {};
    if (b.kind === 'production') {
      const resName = (window.Game && Game.Config.RESOURCE_NAMES[b.target]) || b.target;
      return `${resName}产出 ×${b.mul}，持续 ${b.hours} 小时`;
    }
    if (b.kind === 'power') return `军队攻防 ×${b.mul}，持续 ${b.hours} 小时（影响真实征战结算）`;
    return `持续 ${b.hours} 小时`;
  };

  /* ---------------- HUD 刷新 ---------------- */
  /**
   * 刷新入口可见性：拍卖行仅在"已登录（非游客）且城池为大型城池"时显示。
   * 建城地点一旦确定类型不再变化，因此登录后/建城后各刷新一次即可。
   */
  function refresh() {
    const btn = document.getElementById('auctionBtn');
    if (!btn) return;
    const visible = isReady() && isLargeCity();
    btn.hidden = !visible;
    if (visible) btn.querySelector('small').textContent = `${cityType()}·拍卖行`;
  }

  /* ---------------- 税率面板（双向制衡） ---------------- */
  function openTaxDialog() {
    injectStyles();
    const c = cityOf();
    if (!c) return;
    const pop = Number(c.population) || 0;

    const rows = B.tax.levels.map(lv => {
      const grow = B.helpers.populationGrowthPerHour(pop, lv);
      const gold = B.helpers.taxGoldPerHour(pop, lv);
      const active = Number(c.taxRate) === lv;
      return `<button type="button" class="ce-tax-row${active ? ' is-active' : ''}" data-tax="${lv}">
        <span class="ce-tax-lv">${lv}%</span>
        <span class="ce-tax-col">人口 <b>+${grow}</b> /时</span>
        <span class="ce-tax-col">税收 <b>+${gold.toFixed(1)}</b> 金/时</span>
        ${active ? '<span class="ce-tax-tag">当前</span>' : ''}
      </button>`;
    }).join('');

    Game.Modal.show('调节税率', `
      <div style="padding:2px 2px 4px;">
        <div style="font-size:12px; color:var(--text-dim); line-height:1.7; margin-bottom:8px;">
          当前人口 <b style="color:var(--accent);">${Math.floor(pop)}</b> · 人口上限 ${B.population.cap}<br>
          税率越高 → 人口自然增长越慢、金币收益越多；税率越低 → 反而更快增殖人口、但税收减少。
        </div>
        <div class="ce-tax-list">${rows}</div>
        <p style="font-size:11px; color:var(--text-dim); margin-top:10px;">
          新税率立即生效，人口与金币按上表逐秒累计。
        </p>
      </div>
    `, [{ text: '关闭', action: () => Game.Modal.close() }]);

    document.querySelectorAll('.ce-tax-row').forEach(btn => btn.addEventListener('click', () => {
      const lv = B.helpers.normalizeTax(btn.dataset.tax);
      if (lv === Number(c.taxRate)) { Game.Modal.close(); return; }
      c.taxRate = lv;
      Game.saveState();
      Game.UI.updateResources();
      Game.showStatus(`税率已调整为 ${lv}%`, 'success');
      openTaxDialog(); // 重绘面板，显示新的增速/收益
    }));
  }

  /* ---------------- 秘籍背包（道具 + 时效增益） ---------------- */
  /** 拉取服务端背包并回写本地缓存 */
  async function syncItems() {
    const c = cityOf();
    if (!c || !isReady()) return null;
    try {
      const data = await api('GET', '/api/items', null, TOKEN());
      const byKey = (data && data.byKey) || {};
      c.items = byKey;
      return data.items || [];
    } catch (e) {
      console.warn('[Progression] 道具同步失败', e);
      return null;
    }
  }

  function activeBuffRows() {
    const c = cityOf();
    const buffs = ((c && c.buffs) || []).filter(b => b && b.until > Date.now());
    if (!buffs.length) return '<div class="ce-buff-row"><span>暂无生效中的增益</span></div>';
    return buffs.map(b => {
      const left = Math.max(0, b.until - Date.now());
      const h = Math.floor(left / 3600e3), m = Math.floor((left % 3600e3) / 60e3);
      return `<div class="ce-buff-row"><span>${esc(b.name || b.key)}（×${b.mul}）</span><span>剩余 ${h}时${m}分</span></div>`;
    }).join('');
  }

  function renderBag(items) {
    const c = cityOf() || {};
    const owned = items && items.length ? items : Object.keys(B.buffs).map(key => ({
      key, name: B.buffs[key].name, qty: (c.items || {})[key] || 0,
      kind: B.buffs[key].kind, mul: B.buffs[key].mul, hours: B.buffs[key].hours, tradeable: true
    }));

    const list = owned.map(it => {
      const qty = Number(it.qty) || 0;
      return `<div class="ce-bag-item">
        <div class="ce-bag-main">
          <div class="ce-bag-name">${esc(it.name)} <span class="ce-bag-qty">×${qty}</span></div>
          <div class="ce-bag-desc">${esc(buffDesc(it.key))}</div>
        </div>
        <button type="button" class="ce-bag-btn" data-use="${esc(it.key)}" ${qty > 0 ? '' : 'disabled'}>使用</button>
      </div>`;
    }).join('');

    Game.Modal.show('秘籍背包', `
      <div style="padding:2px 2px 4px;">
        <div style="font-size:12px; color:var(--text-dim); margin-bottom:6px;">生效中的增益</div>
        <div style="margin-bottom:12px;">${activeBuffRows()}</div>
        <div style="font-size:12px; color:var(--text-dim); margin-bottom:2px;">持有秘籍（可通过大型城池拍卖行竞得）</div>
        ${list}
        <p style="font-size:11px; color:var(--text-dim); margin-top:10px;">
          使用秘籍立即获得限时增益；同种秘籍取最高倍率不叠加，不同秘籍效果相乘。
        </p>
      </div>
    `, [{ text: '关闭', action: () => Game.Modal.close() }]);

    document.querySelectorAll('.ce-bag-btn[data-use]').forEach(btn => btn.addEventListener('click', () => useItem(btn.dataset.use)));
  }

  async function openBagDialog() {
    injectStyles();
    if (!cityOf()) return;
    const items = isReady() ? await syncItems() : null;
    renderBag(items);
  }

  /** 使用一个秘籍：服务端扣减 → 本地写入时效增益 → 刷新界面 */
  async function useItem(key) {
    const c = cityOf();
    if (!c) return;
    const def = B.buffs[key];
    if (!def) { Game.showStatus('未知的秘籍', 'error'); return; }
    if (!isReady()) { Game.showStatus('请先登录后再使用秘籍', 'warn'); return; }

    let items = null;
    try {
      const data = await api('POST', '/api/items/use', { itemKey: key }, TOKEN());
      c.items = (data && data.byKey) || c.items;
      items = data && data.items;
    } catch (e) {
      Game.showStatus('使用失败：' + e.message, 'error');
      return;
    }

    // 写入时效增益：同名覆盖为新的到期时间（取最高倍率），异名并存
    const now = Date.now();
    c.buffs = (c.buffs || []).filter(b => b && b.until > now && b.key !== key);
    c.buffs.push({ key, name: def.name, kind: def.kind, target: def.target || null, mul: def.mul, until: now + def.hours * 3600e3 });

    Game.saveState(); // 触发本地存档 + 云存档 + 玩家快照（含战力倍率）
    Game.UI.updateResources();
    Game.showStatus(`${def.name} 已生效：${buffDesc(key)}`, 'success');
    renderBag(items || (await syncItems()));
  }

  window.Progression = { refresh, openTaxDialog, openBagDialog, syncItems, isLargeCity, cityType };
})();
