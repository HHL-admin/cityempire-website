/*
 * 城池帝国 · 大型城池拍卖行（客户端）
 *
 * 功能：
 *  - 浏览在售挂单（按"周边"半径过滤，系统寄售单对所有人大开），出价即托管金币；
 *  - 上架自己的秘籍（仅大型城池可卖），撤单回收托管道具；
 *  - 接收 social.js 转来的 SSE auction 事件（被超越/成交/流拍）后自动刷新。
 *
 * 数值与准入条件全部来自 balance-config.js；成交、手续费、结算由服务端权威处理。
 * 挂载：window.Auction，由 cities.html 的 HUD「拍卖」按钮调用。
 */
(function () {
  'use strict';
  if (!window.Auth) { console.warn('[Auction] 需要先加载 auth.js'); return; }
  const B = window.GameBalance;
  if (!B) { console.warn('[Auction] 需要先加载 balance-config.js'); return; }

  const api = window.Auth.api;
  const TOKEN = () => (window.Auth.session && window.Auth.session.token) || '';
  const isReady = () => !!TOKEN() && !window.Auth.isGuest;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cityOf = () => (window.Game && Game.state && Game.state.city) || null;

  const S = { open: false, tab: 'browse', listings: [], mine: [], items: {}, timer: 0 };

  /* ---------------- 样式 ---------------- */
  function injectStyles() {
    if (document.getElementById('ceAuctionStyles')) return;
    const style = document.createElement('style');
    style.id = 'ceAuctionStyles';
    style.textContent = `
      .auction-card { padding:10px 12px; margin:8px 0; background:#00000033; border:1px solid var(--gold-soft); border-radius:4px; }
      .auction-card-head { display:flex; justify-content:space-between; align-items:baseline; gap:10px; }
      .auction-card-head b { color:#f6dfa6; font-size:14px; }
      .auction-card-head span { font-size:11px; color:#cdb893; }
      .auction-meta { font-size:11px; color:#cdb893; margin-top:4px; }
      .auction-price { font-size:12px; color:#f3d79a; margin-top:6px; }
      .auction-ops { display:flex; gap:8px; margin-top:8px; }
      .auction-ops input { flex:1; min-width:0; padding:6px 8px; font-size:12px; color:#f6dfa6;
        background:#00000055; border:1px solid var(--gold-soft); border-radius:4px; }
      .auction-empty { padding:24px 10px; text-align:center; font-size:13px; color:#cdb893; }
      .auction-form { padding:10px 12px; margin-bottom:10px; background:#00000040; border:1px dashed var(--gold-soft); border-radius:4px; }
      .auction-form label { display:block; font-size:11px; color:#cdb893; margin:6px 0 3px; }
      .auction-form input, .auction-form select { width:100%; padding:6px 8px; font-size:12px; color:#f6dfa6;
        background:#00000055; border:1px solid var(--gold-soft); border-radius:4px; }
      .auction-form .auction-ops { margin-top:10px; }
    `;
    document.head.appendChild(style);
  }

  /* ---------------- DOM ---------------- */
  function buildDom() {
    if (document.getElementById('auctionPanel')) return;
    injectStyles();
    const root = document.createElement('div');
    root.id = 'auctionRoot';
    root.innerHTML = `
      <div class="social-layer" data-auction-close hidden></div>
      <div class="social-panel social-panel-wide" id="auctionPanel" hidden>
        <div class="social-panel-head">
          <h2>大型城池拍卖行</h2>
          <div class="social-head-actions">
            <button type="button" class="social-btn-sm" data-auction-tab="browse">在售</button>
            <button type="button" class="social-btn-sm ghost" data-auction-tab="mine">我的</button>
            <button type="button" class="social-x" data-auction-close>×</button>
          </div>
        </div>
        <div class="social-scroll" id="auctionBody"></div>
      </div>`;
    document.body.appendChild(root);
    root.querySelectorAll('[data-auction-close]').forEach(el => el.addEventListener('click', close));
    root.querySelectorAll('[data-auction-tab]').forEach(el => el.addEventListener('click', () => switchTab(el.dataset.auctionTab)));
  }

  const body = () => document.getElementById('auctionBody');
  function setTabs() {
    document.querySelectorAll('[data-auction-tab]').forEach(el => {
      el.classList.toggle('ghost', el.dataset.auctionTab !== S.tab);
    });
  }
  function showLayer(on) {
    document.querySelectorAll('#auctionRoot [data-auction-close]').forEach(el => { el.hidden = !on; });
  }

  /* ---------------- 渲染 ---------------- */
  const fmtMoney = v => (Math.round((Number(v) || 0) * 100) / 100).toLocaleString('zh-CN');
  function remainText(endsAt) {
    const left = Math.max(0, endsAt - Date.now());
    if (left <= 0) return '已结束';
    const h = Math.floor(left / 3600e3), m = Math.floor((left % 3600e3) / 60e3), s = Math.floor((left % 60e3) / 1000);
    return h > 0 ? `剩余 ${h}时${m}分` : (m > 0 ? `剩余 ${m}分${s}秒` : `剩余 ${s}秒`);
  }

  function renderBrowse() {
    const list = S.listings;
    if (!list.length) return `<div class="auction-empty">拍卖行暂无在售挂单</div>`;
    return list.map(l => {
      const mine = l.sellerId === (window.Auth.user && Auth.user.id);
      const soldOut = l.endsAt <= Date.now();
      const dist = l.distance == null ? '' : ` · 距你 ${l.distance} km`;
      return `<div class="auction-card">
        <div class="auction-card-head">
          <b>${esc(l.itemName)} ×${l.qty}</b>
          <span>${esc(remainText(l.endsAt))}</span>
        </div>
        <div class="auction-meta">卖家 ${esc(l.sellerName)}（${esc(l.sellerCity || '—')} · ${esc(l.sellerCityType || '—')}）${esc(dist)}</div>
        <div class="auction-price">当前价 ${fmtMoney(l.curPrice)} 金 · 最低出价 ${fmtMoney(l.minNextBid)} 金${l.highBidder ? '' : '（尚无出价）'}</div>
        ${mine ? '<div class="auction-meta">这是你自己的挂单，可在「我的」中撤销</div>' : `
        <div class="auction-ops">
          <input type="number" class="auction-bid-input" data-bid-input="${l.id}" min="${l.minNextBid}" step="1" value="${l.minNextBid}" ${soldOut ? 'disabled' : ''}>
          <button type="button" class="social-btn-sm" data-bid="${l.id}" ${soldOut ? 'disabled' : ''}>出价</button>
        </div>`}
      </div>`;
    }).join('');
  }

  function renderMine() {
    const canSell = S.canSell;
    const items = Object.keys(B.buffs).filter(k => B.auction.tradeable.includes(k));
    const form = canSell ? `
      <div class="auction-form">
        <div style="font-size:12px; color:#f3d79a;">上架秘籍（仅大型城池可卖，成交收取 ${(B.auction.feeRate * 100).toFixed(0)}% 手续费）</div>
        <label>选择秘籍</label>
        <select id="auctionSellItem">
          ${items.map(k => `<option value="${k}">${esc(B.buffs[k].name)}（持有 ${(S.items[k] || 0)}）</option>`).join('')}
        </select>
        <label>数量</label>
        <input type="number" id="auctionSellQty" min="1" max="99" step="1" value="1">
        <label>起拍价（金币，最低 ${B.auction.minPrice}）</label>
        <input type="number" id="auctionSellPrice" min="${B.auction.minPrice}" step="1" value="${B.auction.seedPrices[items[0]] || B.auction.minPrice}">
        <div class="auction-ops"><button type="button" class="social-btn-sm" id="auctionSellBtn">上架拍卖</button></div>
      </div>` : `<div class="auction-empty">你的城池不是大型城池（${B.auction.largeCityTypes.join('/')}），无法上架，但可以竞拍。</div>`;

    const myList = S.mine.length ? S.mine.map(l => {
      const statusText = { open: remainText(l.endsAt), sold: '已成交', cancelled: '已撤销', expired: '流拍退回' }[l.status] || l.status;
      return `<div class="auction-card">
        <div class="auction-card-head"><b>${esc(l.itemName)} ×${l.qty}</b><span>${esc(statusText)}</span></div>
        <div class="auction-price">${l.highBidder ? `当前价 ${fmtMoney(l.curPrice)} 金` : `起拍价 ${fmtMoney(l.startPrice)} 金`}</div>
        ${(l.status === 'open' && !l.highBidder) ? `<div class="auction-ops"><button type="button" class="social-btn-sm danger" data-cancel="${l.id}">撤单</button></div>` : ''}
      </div>`;
    }).join('') : '<div class="auction-empty">你还没有挂单</div>';

    return form + myList;
  }

  function render() {
    const el = body(); if (!el) return;
    setTabs();
    el.innerHTML = S.tab === 'mine' ? renderMine() : renderBrowse();
    if (S.tab === 'mine') bindMine();
    else bindBrowse();
  }

  function bindBrowse() {
    document.querySelectorAll('#auctionBody [data-bid]').forEach(btn => btn.addEventListener('click', () => {
      const id = Number(btn.dataset.bid);
      const input = document.querySelector(`#auctionBody [data-bid-input="${id}"]`);
      submitBid(id, Number(input && input.value));
    }));
  }
  function bindMine() {
    const sellBtn = document.getElementById('auctionSellBtn');
    if (sellBtn) sellBtn.addEventListener('click', submitSell);
    document.querySelectorAll('#auctionBody [data-cancel]').forEach(btn => btn.addEventListener('click', () => submitCancel(Number(btn.dataset.cancel))));
  }

  /* ---------------- 数据 ---------------- */
  async function loadBrowse() {
    try {
      const data = await api('GET', '/api/auction/list', null, TOKEN());
      S.listings = data.listings || [];
      S.canSell = !!data.canSell;
    } catch (e) { S.listings = []; Game.showStatus('拍卖行加载失败：' + e.message, 'error'); }
    render();
  }
  async function loadMine() {
    try {
      const data = await api('GET', '/api/auction/mine', null, TOKEN());
      S.mine = data.listings || [];
      S.items = data.items || {};
    } catch (e) { S.mine = []; Game.showStatus('挂单加载失败：' + e.message, 'error'); }
    render();
  }

  async function submitBid(id, amount) {
    if (!Number.isFinite(amount) || amount <= 0) { Game.showStatus('请输入有效的出价', 'error'); return; }
    try {
      await api('POST', '/api/auction/bid', { id, amount }, TOKEN());
      Game.showStatus('出价成功，金币已托管', 'success');
      Game.saveState();
      await loadBrowse();
    } catch (e) { Game.showStatus('出价失败：' + e.message, 'error'); }
  }

  async function submitSell() {
    const key = document.getElementById('auctionSellItem').value;
    const qty = Math.floor(Number(document.getElementById('auctionSellQty').value) || 0);
    const startPrice = Number(document.getElementById('auctionSellPrice').value);
    try {
      await api('POST', '/api/auction/create', { itemKey: key, qty, startPrice }, TOKEN());
      Game.showStatus('已上架，等待其他城池竞拍', 'success');
      await loadMine();
    } catch (e) { Game.showStatus('上架失败：' + e.message, 'error'); }
  }

  async function submitCancel(id) {
    try {
      await api('POST', '/api/auction/cancel', { id }, TOKEN());
      Game.showStatus('已撤单，道具已退回背包', 'success');
      await loadMine();
    } catch (e) { Game.showStatus('撤单失败：' + e.message, 'error'); }
  }

  /* ---------------- 交互 ---------------- */
  function switchTab(tab) {
    S.tab = tab === 'mine' ? 'mine' : 'browse';
    render();
    if (S.tab === 'mine') loadMine(); else loadBrowse();
  }

  function open() {
    if (!isReady()) { Game.showStatus('请先登录后再使用拍卖行', 'warn'); return; }
    if (window.Progression && !Progression.isLargeCity()) {
      Game.showStatus(`只有大型城池（${B.auction.largeCityTypes.join('/')}）才能开设拍卖行`, 'warn');
      return;
    }
    buildDom();
    S.open = true;
    showLayer(true);
    document.getElementById('auctionPanel').hidden = false;
    switchTab('browse');
    clearInterval(S.timer);
    S.timer = setInterval(() => { if (S.open && S.tab === 'browse') render(); }, 1000); // 倒计时刷新
  }

  function close() {
    S.open = false;
    showLayer(false);
    const panel = document.getElementById('auctionPanel');
    if (panel) panel.hidden = true;
    clearInterval(S.timer);
    S.timer = 0;
  }

  /** social.js 把 SSE auction 事件转过来：面板开着就刷新对应页 */
  function onEvent(d) {
    if (!S.open) return;
    if (d.kind === 'settled' || d.kind === 'expired' || d.kind === 'created' || d.kind === 'cancelled') {
      if (S.tab === 'mine') loadMine(); else loadBrowse();
    } else if (d.kind === 'bid' || d.kind === 'outbid') {
      loadBrowse();
    }
  }

  window.Auction = { open, close, onEvent };
})();
