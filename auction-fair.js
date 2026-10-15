/*
 * 城池帝国 · 大型城市拍卖会（活动体系 · 客户端）
 *
 * 与 auction.js（拍卖行）相互独立：本模块对接 /api/fair/*，实现「固定开放日 + 限时场次」的活动化拍卖。
 *  - 预展示：任意时间可浏览已上拍拍品；非开放日仅开放预展示与预约
 *  - 竞价：仅开放日场次进行中开放，严格执行价高者得；出价即托管金币，被超越原路退还
 *  - 预约：预约竞拍 / 预约线下看样（大型城市可选）
 *  - 我的拍品：提交拍品（需实名认证 + 大型城市 + 道具白名单）、查看状态、撤回
 *  - 订单：场次结束自动生成成交订单，买家确认交割（可选「当面交割」）、卖家完成交割、违约申报
 *  - 实名认证：提交姓名 + 证件号（服务端仅存哈希与掩码，明文不落库）
 *
 * 全部数值取自 balance-config.js 的 fair 段；成交、结算、违约由服务端权威处理。
 * 挂载：window.AuctionFair，由 cities.html 的 HUD「拍卖会」按钮调用。
 */
(function () {
  'use strict';
  if (!window.Auth) { console.warn('[AuctionFair] 需要先加载 auth.js'); return; }
  const B = window.GameBalance;
  if (!B || !B.fair) { console.warn('[AuctionFair] 需要先加载 balance-config.js（含 fair 段）'); return; }
  const F = B.fair;

  const api = window.Auth.api;
  const TOKEN = () => (window.Auth.session && window.Auth.session.token) || '';
  const isReady = () => !!TOKEN() && !window.Auth.isGuest;
  const myId = () => (window.Auth.user && window.Auth.user.id) || '';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtMoney = v => (Math.round((Number(v) || 0) * 100) / 100).toLocaleString('zh-CN');
  const pad2 = n => String(n).padStart(2, '0');
  const fmtTime = ts => { const d = new Date(Number(ts) || 0); return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  const fmtDateTime = ts => { const d = new Date(Number(ts) || 0); return `${d.getMonth() + 1}月${d.getDate()}日 ${pad2(d.getHours())}:${pad2(d.getMinutes())}`; };
  const WEEK_CN = ['日', '一', '二', '三', '四', '五', '六'];
  const FAIR_CITY = '洛阳'; // 活动展示名（对应现实中「洛阳」这类大型城市）

  const S = { open: false, tab: 'preview', status: null, lots: [], mine: [], orders: [], items: {}, timer: 0 };

  /* ---------------- 样式（复用 social-* 类，另加 fair-* 局部样式） ---------------- */
  function injectStyles() {
    if (document.getElementById('ceFairStyles')) return;
    const style = document.createElement('style');
    style.id = 'ceFairStyles';
    style.textContent = `
      .fair-statusbar { padding:10px 12px; margin:0 0 10px; background:linear-gradient(180deg,#2a1d0e,#1d1409);
        border:1px solid var(--gold-soft); border-radius:5px; }
      .fair-status-main { font-size:14px; color:#f6dfa6; font-weight:bold; }
      .fair-status-sub { font-size:11px; color:#cdb893; margin-top:4px; line-height:1.6; }
      .fair-tabs { display:flex; gap:6px; margin-bottom:10px; flex-wrap:wrap; }
      .fair-tab { padding:6px 10px; font-size:12px; color:#cdb893; background:#00000040;
        border:1px solid var(--gold-soft); border-radius:4px; cursor:pointer; }
      .fair-tab.is-active { color:#1a1208; background:var(--gold); border-color:var(--gold); font-weight:bold; }
      .fair-card { padding:10px 12px; margin:8px 0; background:#00000033; border:1px solid var(--gold-soft); border-radius:4px; }
      .fair-card-head { display:flex; justify-content:space-between; align-items:baseline; gap:10px; }
      .fair-card-head b { color:#f6dfa6; font-size:14px; }
      .fair-card-head span { font-size:11px; color:#cdb893; }
      .fair-meta { font-size:11px; color:#cdb893; margin-top:4px; line-height:1.6; }
      .fair-price { font-size:12px; color:#f3d79a; margin-top:6px; }
      .fair-ops { display:flex; gap:8px; margin-top:8px; }
      .fair-ops input { flex:1; min-width:0; padding:6px 8px; font-size:12px; color:#f6dfa6;
        background:#00000055; border:1px solid var(--gold-soft); border-radius:4px; }
      .fair-tag { display:inline-block; font-size:10px; color:#f3d79a; border:1px solid var(--gold-soft);
        border-radius:3px; padding:0 5px; margin-right:6px; }
      .fair-empty { padding:24px 10px; text-align:center; font-size:13px; color:#cdb893; }
      .fair-form { padding:10px 12px; margin-bottom:10px; background:#00000040; border:1px dashed var(--gold-soft); border-radius:4px; }
      .fair-form label { display:block; font-size:11px; color:#cdb893; margin:6px 0 3px; }
      .fair-form input, .fair-form select, .fair-form textarea { width:100%; box-sizing:border-box; padding:6px 8px; font-size:12px;
        color:#f6dfa6; background:#00000055; border:1px solid var(--gold-soft); border-radius:4px; font-family:inherit; }
      .fair-hash { font-size:10px; color:#8f7c5c; word-break:break-all; }
    `;
    document.head.appendChild(style);
  }

  /* ---------------- DOM ---------------- */
  function buildDom() {
    if (document.getElementById('fairPanel')) return;
    injectStyles();
    const root = document.createElement('div');
    root.id = 'fairRoot';
    root.innerHTML = `
      <div class="social-layer" data-fair-close hidden></div>
      <div class="social-panel social-panel-wide" id="fairPanel" hidden>
        <div class="social-panel-head">
          <h2>${FAIR_CITY}拍卖会</h2>
          <div class="social-head-actions">
            <button type="button" class="social-btn-sm" id="fairRealnameBtn">实名认证</button>
            <button type="button" class="social-x" data-fair-close>×</button>
          </div>
        </div>
        <div class="social-scroll" id="fairBody"></div>
      </div>`;
    document.body.appendChild(root);
    root.querySelectorAll('[data-fair-close]').forEach(el => el.addEventListener('click', close));
    document.getElementById('fairRealnameBtn').addEventListener('click', openRealname);
  }

  const body = () => document.getElementById('fairBody');
  function showLayer(on) { document.querySelectorAll('#fairRoot [data-fair-close]').forEach(el => { el.hidden = !on; }); }

  const remainText = endsAt => {
    const left = Math.max(0, endsAt - Date.now());
    if (left <= 0) return '已结束';
    const h = Math.floor(left / 3600e3), m = Math.floor((left % 3600e3) / 60e3), s = Math.floor((left % 60e3) / 1000);
    return h > 0 ? `剩余 ${h}时${m}分` : (m > 0 ? `剩余 ${m}分${s}秒` : `剩余 ${s}秒`);
  };

  /* ---------------- 渲染 ---------------- */
  const TABS = [['preview', '预展示'], ['bid', '竞价'], ['reserve', '预约'], ['mine', '我的拍品'], ['orders', '订单']];

  function statusBar() {
    const st = S.status || {};
    let head, sub;
    if (st.sessionLive && st.session) {
      head = `本场进行中 · ${fmtTime(st.session.endsAt)} 结束`;
      sub = '开放日竞价已开启：价高者得，场次结束时最高出价者即为最终得主';
    } else if (st.isOpenDay && st.session) {
      head = `开放日 · 本场 ${fmtTime(st.session.startsAt)} 开场`;
      sub = '开场前可提交拍品与预约看样，开场后开放竞价';
    } else if (st.nextSession) {
      head = `非开放日 · 下一场 ${fmtDateTime(st.nextSession.startsAt)}`;
      sub = '非开放日仅开放商品预展示与预约功能，竞价于开放日开场后开启';
    } else {
      head = '暂无拍卖场次';
      sub = '大型城市拍卖会固定于每周三、周六开放';
    }
    const rn = st.realName || {};
    const rnText = rn.status === 'verified' ? `已实名 ${esc(rn.realName)}（${esc(rn.idMask)}）`
      : (rn.status === 'pending' ? '实名审核中' : '未实名');
    const days = (st.openWeekdays || F.openWeekdays).map(w => '周' + WEEK_CN[w]).join('、');
    return `<div class="fair-statusbar">
      <div class="fair-status-main">${esc(head)}</div>
      <div class="fair-status-sub">${esc(sub)}</div>
      <div class="fair-status-sub">信用分 <b>${Number(st.credit) || 0}</b> · ${rnText} · 开放日：${esc(days)} · 手续费 ${((st.config && st.config.feeRate) || F.feeRate) * 100 | 0}%</div>
      <div class="fair-status-sub" id="fairCountdown"></div>
    </div>`;
  }

  function content() {
    if (S.tab === 'bid') return renderBid();
    if (S.tab === 'reserve') return renderReserve();
    if (S.tab === 'mine') return renderMine();
    if (S.tab === 'orders') return renderOrders();
    return renderPreview();
  }

  const statusText = s => ({ pending_review: '待审核', listed: '上拍中', rejected: '已驳回', sold: '已成交', unsold: '流拍', cancelled: '已撤回' }[s] || s);

  function lotsEmpty(msg) { return `<div class="fair-empty">${esc(msg)}</div>`; }

  function lotCard(l, kind) {
    const mine = l.sellerId === myId();
    const live = !!(S.status && S.status.sessionLive);
    const ended = l.endsAt <= Date.now();
    const head = `<div class="fair-card-head"><b>${esc(l.title)}</b><span>${esc(remainText(l.endsAt))}</span></div>`;
    const tags = `${l.offlineView ? '<span class="fair-tag">支持线下看样</span>' : ''}${l.offlineDeal ? '<span class="fair-tag">支持当面交割</span>' : ''}`;
    const meta = `<div class="fair-meta">${esc(l.itemName)} ×${l.qty} · 卖家 ${esc(l.sellerName)}（${esc(l.sellerCity)}） · 状态 ${esc(statusText(l.status))}</div>`
      + (l.description ? `<div class="fair-meta">${esc(l.description)}</div>` : '')
      + (tags ? `<div class="fair-meta">${tags}</div>` : '');
    const price = `<div class="fair-price">${l.highBidder ? `当前价 <b>${fmtMoney(l.curPrice)}</b> 金 · 最低加价 ${fmtMoney(l.minNextBid)} 金` : `起拍价 ${fmtMoney(l.startPrice)} 金（尚无出价）`}</div>`;

    if (kind === 'bid') {
      if (mine) return `<div class="fair-card">${head}${meta}${price}<div class="fair-meta">这是你自己的拍品，不能自拍</div></div>`;
      const dis = (!live || ended) ? 'disabled' : '';
      return `<div class="fair-card">${head}${meta}${price}
        <div class="fair-ops">
          <input type="number" data-fair-bid-input="${l.id}" min="${l.minNextBid}" step="1" value="${l.minNextBid}" ${dis}>
          <button type="button" class="social-btn-sm" data-fair-bid="${l.id}" ${dis}>出价</button>
          <button type="button" class="social-btn-sm ghost" data-fair-bids="${l.id}">存证</button>
        </div></div>`;
    }
    // 预展示：只读 + 预约看样
    return `<div class="fair-card">${head}${meta}${price}
      <div class="fair-ops">
        <button type="button" class="social-btn-sm ghost" data-fair-view="${l.id}">预约看样</button>
        <button type="button" class="social-btn-sm ghost" data-fair-bids="${l.id}">存证</button>
      </div></div>`;
  }

  function renderPreview() {
    const list = S.lots.slice().sort((a, b) => (a.status === 'listed' ? 0 : 1) - (b.status === 'listed' ? 0 : 1));
    if (!list.length) return lotsEmpty('暂无可预展示的拍品。大型城市城主可在「我的拍品」提交拍品。');
    return `<div class="fair-meta" style="margin-bottom:6px;">共 ${list.length} 件拍品（含往期成交/流拍记录）</div>` + list.map(l => lotCard(l, 'preview')).join('');
  }

  function renderBid() {
    const live = !!(S.status && S.status.sessionLive);
    const notice = live ? '' : `<div class="fair-statusbar"><div class="fair-status-main">竞价未开放</div>
      <div class="fair-status-sub">竞价仅在开放日（周三/周六）${F.sessionStartHour}:00 开场的场次进行中开放${S.status && S.status.nextSession ? `，下一场 ${fmtDateTime(S.status.nextSession.startsAt)}` : ''}。</div></div>`;
    const list = S.lots.filter(l => l.status === 'listed');
    if (!list.length) return notice + lotsEmpty('本场暂无上拍中的拍品');
    return notice + list.map(l => lotCard(l, 'bid')).join('');
  }

  function renderReserve() {
    const st = S.status || {};
    const sess = st.session || st.nextSession;
    if (!sess) return lotsEmpty('暂无可预约的拍卖场次');
    const saved = sess.openDate;
    return `<div class="fair-card">
      <div class="fair-card-head"><b>预约 ${esc(saved)} 场次</b><span>${esc(st.sessionLive ? '进行中' : '未开场')}</span></div>
      <div class="fair-meta">开场时间：${esc(fmtDateTime(sess.startsAt))} · 结束：${esc(fmtTime(sess.endsAt))}</div>
      <div class="fair-meta">预约后，场次开场时会收到军报与实时提醒。线下看样为大型城市可选服务。</div>
      <div class="fair-ops">
        <button type="button" class="social-btn-sm" id="fairReserveBtn">预约竞拍</button>
      </div>
    </div>
    <div class="fair-meta" style="margin-top:8px;">提示：可在「预展示」中对支持线下看样的拍品单独「预约看样」。</div>`;
  }

  function renderMine() {
    const st = S.status || {};
    const conf = st.config || F;
    const tradeable = conf.tradeable || F.tradeable;
    const canSubmit = !!st.canSubmit;
    const items = Object.keys(B.buffs).filter(k => tradeable.includes(k));
    const form = canSubmit ? `
      <div class="fair-form">
        <div style="font-size:12px; color:#f3d79a;">提交拍品（成交收取 ${(conf.feeRate * 100).toFixed(0)}% 手续费；上架即托管道具）</div>
        <label>选择道具</label>
        <select id="fairSellItem">${items.map(k => `<option value="${k}">${esc(B.buffs[k].name)}（持有 ${(S.items[k] || 0)}）</option>`).join('')}</select>
        <label>数量</label>
        <input type="number" id="fairSellQty" min="1" max="99" step="1" value="1">
        <label>拍品名称（2~40 字）</label>
        <input type="text" id="fairSellTitle" maxlength="40" placeholder="如：三国志·农业发展秘籍（孤本）">
        <label>物品描述（选填，≤300 字）</label>
        <textarea id="fairSellDesc" rows="2" maxlength="300" placeholder="品相、来历、增益说明等"></textarea>
        <label>起拍价（金币，最低 ${conf.minPrice}）</label>
        <input type="number" id="fairSellPrice" min="${conf.minPrice}" step="1" value="${(B.auction.seedPrices[items[0]] || conf.minPrice)}">
        <label>物品详情图链接（选填，可填图片 URL）</label>
        <input type="text" id="fairSellImage" maxlength="300" placeholder="https://…">
        <label style="display:flex; align-items:center; gap:6px; margin-top:8px;">
          <input type="checkbox" id="fairSellOfflineView" style="width:auto;" checked> 支持线下看样（${esc(FAIR_CITY)}本地可选）
        </label>
        <label style="display:flex; align-items:center; gap:6px;">
          <input type="checkbox" id="fairSellOfflineDeal" style="width:auto;" checked> 支持当面交割（手续费优惠）
        </label>
        <div class="fair-ops"><button type="button" class="social-btn-sm" id="fairSellBtn">提交拍品</button></div>
      </div>` : `<div class="fair-empty">${esc(!st.canHost ? '仅大型城市（都城/府城/郡城）城主可提交拍品' : (!st.isRealNamed ? '请先完成实名认证后再提交拍品' : '暂无可绑定的拍卖场次'))}</div>`;

    const mine = S.mine.length ? S.mine.map(l => `<div class="fair-card">
        <div class="fair-card-head"><b>${esc(l.title)}</b><span>${esc(statusText(l.status))}</span></div>
        <div class="fair-meta">${esc(l.itemName)} ×${l.qty} · 场次 ${esc(l.sessionDate)} · ${esc(remainText(l.endsAt))}</div>
        <div class="fair-price">${l.highBidder ? `当前价 ${fmtMoney(l.curPrice)} 金` : `起拍价 ${fmtMoney(l.startPrice)} 金`}</div>
        ${(l.status === 'listed' && !l.highBidder) || l.status === 'pending_review'
          ? `<div class="fair-ops"><button type="button" class="social-btn-sm danger" data-fair-cancel="${l.id}">撤回</button></div>` : ''}
      </div>`).join('') : lotsEmpty('你还没有提交过拍品');

    return form + mine;
  }

  function orderCard(o) {
    const me = myId();
    const isBuyer = o.buyerId === me, isSeller = o.sellerId === me;
    const sText = { created: '待确认交割', confirmed: '待卖家交割', completed: '已完成', breached: '已违约' }[o.status] || o.status;
    const dText = o.delivery === 'offline' ? '当面交割' : '线上交割';
    let ops = '';
    if (o.status === 'created' && isBuyer) {
      ops = `<div class="fair-ops">
        <button type="button" class="social-btn-sm" data-fair-confirm="${o.id}" data-fair-delivery="online">确认线上交割</button>
        ${o.offlineAvailable ? `<button type="button" class="social-btn-sm" data-fair-confirm="${o.id}" data-fair-delivery="offline">当面交割</button>` : ''}
      </div>`;
    } else if (o.status === 'confirmed' && isSeller) {
      ops = `<div class="fair-ops"><button type="button" class="social-btn-sm" data-fair-deliver="${o.id}">完成交割</button></div>`;
    }
    if (o.status === 'created' || o.status === 'confirmed') {
      ops += `<div class="fair-ops"><button type="button" class="social-btn-sm ghost" data-fair-breach="${o.id}">申报对方违约</button></div>`;
    }
    const deadline = (o.status === 'created' || o.status === 'confirmed') ? `<div class="fair-meta">交割截止：${esc(fmtDateTime(o.deadlineAt))}（${esc(remainText(o.deadlineAt))}）</div>` : '';
    return `<div class="fair-card">
      <div class="fair-card-head"><b>订单 #${o.id} · ${esc(o.title)}</b><span>${esc(sText)}</span></div>
      <div class="fair-meta">${esc(o.itemName)} ×${o.qty} · 成交价 ${fmtMoney(o.amount)} 金 · 手续费 ${fmtMoney(o.fee)} 金 · ${esc(dText)}</div>
      <div class="fair-meta">买家 ${esc(o.buyerName)} · 卖家 ${esc(o.sellerName)}${o.sellerCity ? `（${esc(o.sellerCity)}）` : ''}</div>
      ${deadline}${ops}
    </div>`;
  }

  function renderOrders() {
    if (!S.orders.length) return lotsEmpty('暂无成交订单');
    return S.orders.map(orderCard).join('');
  }

  function render() {
    const el = body(); if (!el) return;
    const tabs = TABS.map(([k, t]) => `<button type="button" class="fair-tab${S.tab === k ? ' is-active' : ''}" data-fair-tab="${k}">${t}</button>`).join('');
    el.innerHTML = statusBar() + `<div class="fair-tabs">${tabs}</div>` + content();
    el.querySelectorAll('[data-fair-tab]').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.fairTab)));
    bindContent();
    tickCountdown();
  }

  function bindContent() {
    document.querySelectorAll('#fairBody [data-fair-bid]').forEach(btn => btn.addEventListener('click', () => {
      const id = Number(btn.dataset.fairBid);
      const input = document.querySelector(`#fairBody [data-fair-bid-input="${id}"]`);
      submitBid(id, Number(input && input.value));
    }));
    document.querySelectorAll('#fairBody [data-fair-bids]').forEach(btn => btn.addEventListener('click', () => showBids(Number(btn.dataset.fairBids))));
    document.querySelectorAll('#fairBody [data-fair-view]').forEach(btn => btn.addEventListener('click', () => submitReserve('view', Number(btn.dataset.fairView))));
    document.querySelectorAll('#fairBody [data-fair-cancel]').forEach(btn => btn.addEventListener('click', () => submitCancel(Number(btn.dataset.fairCancel))));
    document.querySelectorAll('#fairBody [data-fair-confirm]').forEach(btn => btn.addEventListener('click', () => submitConfirm(Number(btn.dataset.fairConfirm), btn.dataset.fairDelivery)));
    document.querySelectorAll('#fairBody [data-fair-deliver]').forEach(btn => btn.addEventListener('click', () => submitDeliver(Number(btn.dataset.fairDeliver))));
    document.querySelectorAll('#fairBody [data-fair-breach]').forEach(btn => btn.addEventListener('click', () => submitBreach(Number(btn.dataset.fairBreach))));
    const reserveBtn = document.getElementById('fairReserveBtn');
    if (reserveBtn) reserveBtn.addEventListener('click', () => submitReserve('reserve', 0));
    const sellBtn = document.getElementById('fairSellBtn');
    if (sellBtn) sellBtn.addEventListener('click', submitSell);
  }

  /** 倒计时只更新局部节点，避免整表重绘打断表单输入 */
  function tickCountdown() {
    const el = document.getElementById('fairCountdown');
    if (!el || !S.status) return;
    const st = S.status;
    const target = st.sessionLive && st.session ? st.session.endsAt : (st.nextSession ? st.nextSession.startsAt : 0);
    el.textContent = target ? `${st.sessionLive ? '本场剩余' : '距下一场'} ${remainText(target)}` : '';
  }

  /* ---------------- 数据 ---------------- */
  async function loadStatus() {
    try { S.status = await api('GET', '/api/fair/status', null, TOKEN()); }
    catch (e) { S.status = null; Game.showStatus('拍卖会状态加载失败：' + e.message, 'error'); }
  }
  async function loadLots() {
    try { const d = await api('GET', '/api/fair/lots', null, TOKEN()); S.lots = d.lots || []; }
    catch (e) { S.lots = []; Game.showStatus('拍品加载失败：' + e.message, 'error'); }
  }
  async function loadMine() {
    try {
      const d = await api('GET', '/api/fair/lots?mine=1', null, TOKEN());
      S.mine = d.lots || [];
      const it = await api('GET', '/api/items', null, TOKEN());
      S.items = (it && it.byKey) || {};
    } catch (e) { S.mine = []; Game.showStatus('我的拍品加载失败：' + e.message, 'error'); }
  }
  async function loadOrders() {
    try { const d = await api('GET', '/api/fair/orders', null, TOKEN()); S.orders = d.orders || []; }
    catch (e) { S.orders = []; Game.showStatus('订单加载失败：' + e.message, 'error'); }
  }

  async function refresh() {
    await loadStatus();
    if (S.tab === 'mine') await loadMine();
    else if (S.tab === 'orders') await loadOrders();
    else await loadLots();
    render();
  }

  /* ---------------- 操作 ---------------- */
  function openRealname() {
    const st = S.status || {};
    const rn = st.realName || {};
    if (rn.status === 'verified') {
      Game.Modal.show('实名认证', `<div style="padding:2px; font-size:13px; color:var(--text-dim); line-height:1.8;">
        已完成实名认证：<b style="color:var(--accent);">${esc(rn.realName)}</b><br>
        证件号：${esc(rn.idMask)}<br>
        <span style="font-size:11px;">认证后方可提交拍品与参与竞价。服务端仅保存证件号哈希与掩码，明文不落库。</span>
      </div>`, [{ text: '关闭', action: () => Game.Modal.close() }]);
      return;
    }
    if (rn.status === 'pending') {
      Game.Modal.show('实名认证', `<div style="padding:2px; font-size:13px; color:var(--text-dim);">实名资料已提交，正在审核中，请耐心等待。</div>`,
        [{ text: '关闭', action: () => Game.Modal.close() }]);
      return;
    }
    Game.Modal.show('实名认证', `<div style="padding:2px;">
      <p style="font-size:12px; color:var(--text-dim); line-height:1.7; margin:0 0 8px;">完成实名认证后方可提交拍品与参与竞价。证件号仅以哈希与掩码形式保存，明文不落库。</p>
      <label style="display:block; font-size:11px; color:var(--text-dim); margin-bottom:3px;">真实姓名</label>
      <input id="fairRnName" type="text" maxlength="16" placeholder="请输入中文姓名" style="width:100%; box-sizing:border-box; padding:7px 8px; font-size:13px; color:var(--text); background:rgba(0,0,0,0.25); border:1px solid var(--panel-line); border-radius:4px;">
      <label style="display:block; font-size:11px; color:var(--text-dim); margin:8px 0 3px;">证件号</label>
      <input id="fairRnId" type="text" maxlength="24" placeholder="6~24 位数字或字母" style="width:100%; box-sizing:border-box; padding:7px 8px; font-size:13px; color:var(--text); background:rgba(0,0,0,0.25); border:1px solid var(--panel-line); border-radius:4px;">
    </div>`, [
      { text: '提交认证', action: submitRealname },
      { text: '取消', action: () => Game.Modal.close() }
    ]);
  }

  async function submitRealname() {
    const realName = (document.getElementById('fairRnName') || {}).value || '';
    const idNumber = (document.getElementById('fairRnId') || {}).value || '';
    try {
      const d = await api('POST', '/api/fair/realname', { realName, idNumber }, TOKEN());
      Game.Modal.close();
      Game.showStatus(d.realName && d.realName.status === 'verified' ? '实名认证成功' : '实名资料已提交，等待审核', 'success');
      await refresh();
    } catch (e) { Game.showStatus('实名认证失败：' + e.message, 'error'); }
  }

  async function submitBid(id, amount) {
    if (!Number.isFinite(amount) || amount <= 0) { Game.showStatus('请输入有效的出价', 'error'); return; }
    try {
      await api('POST', '/api/fair/bid', { id, amount }, TOKEN());
      Game.showStatus('出价成功，金币已托管（被超越将原路退还）', 'success');
      Game.saveState();
      await refresh();
    } catch (e) { Game.showStatus('出价失败：' + e.message, 'error'); }
  }

  async function submitSell() {
    const g = id => document.getElementById(id);
    const payload = {
      itemKey: g('fairSellItem').value,
      qty: Math.floor(Number(g('fairSellQty').value) || 0),
      title: (g('fairSellTitle').value || '').trim(),
      description: (g('fairSellDesc').value || '').trim(),
      imageUrl: (g('fairSellImage').value || '').trim(),
      startPrice: Number(g('fairSellPrice').value),
      offlineView: g('fairSellOfflineView').checked,
      offlineDeal: g('fairSellOfflineDeal').checked
    };
    try {
      const d = await api('POST', '/api/fair/lots', payload, TOKEN());
      Game.showStatus(d.autoReviewed ? '拍品已提交并过审，将在本场拍卖会上拍' : '拍品已提交，等待审核', 'success');
      await refresh();
    } catch (e) { Game.showStatus('提交拍品失败：' + e.message, 'error'); }
  }

  async function submitCancel(id) {
    try {
      await api('POST', '/api/fair/lots/cancel', { id }, TOKEN());
      Game.showStatus('已撤回拍品，道具退回背包', 'success');
      await refresh();
    } catch (e) { Game.showStatus('撤回失败：' + e.message, 'error'); }
  }

  async function submitReserve(kind, lotId) {
    try {
      const d = await api('POST', '/api/fair/reserve', { kind, lotId }, TOKEN());
      Game.showStatus(d.duplicated ? '你已预约过该场次' : `预约成功（${d.sessionDate} 场次）`, 'success');
    } catch (e) { Game.showStatus('预约失败：' + e.message, 'error'); }
  }

  async function submitConfirm(id, delivery) {
    try {
      await api('POST', '/api/fair/orders/confirm', { id, delivery }, TOKEN());
      Game.showStatus(delivery === 'offline' ? '已确认当面交割' : '已确认线上交割', 'success');
      await refresh();
    } catch (e) { Game.showStatus('确认失败：' + e.message, 'error'); }
  }

  async function submitDeliver(id) {
    try {
      await api('POST', '/api/fair/orders/deliver', { id }, TOKEN());
      Game.showStatus('交割完成', 'success');
      await refresh();
    } catch (e) { Game.showStatus('操作失败：' + e.message, 'error'); }
  }

  async function submitBreach(id) {
    try {
      await api('POST', '/api/fair/orders/breach', { id, reason: '对方未按期完成交割' }, TOKEN());
      Game.showStatus('已申报违约，系统已按规则处理', 'warn');
      await refresh();
    } catch (e) { Game.showStatus('申报失败：' + e.message, 'error'); }
  }

  async function showBids(lotId) {
    try {
      const d = await api('GET', '/api/fair/bids?lotId=' + lotId, null, TOKEN());
      const rows = (d.bids || []).length ? d.bids.map(b =>
        `<div class="fair-meta">#${b.id} ${esc(b.bidderName)} 出价 <b>${fmtMoney(b.amount)}</b> 金 · ${esc(fmtDateTime(b.createdAt))}<br><span class="fair-hash">${esc(b.hash)}</span></div>`
      ).join('') : '<div class="fair-empty">暂无出价记录</div>';
      Game.Modal.show('竞价记录存证', `<div style="padding:2px;">
        ${rows}
        <p class="fair-meta" style="margin-top:8px;">哈希链校验：${d.intact ? '完整可信 ✔' : '校验异常 ✘'}</p>
        <p class="fair-meta" style="font-size:10px;">每条记录 hash = sha256(上一条 hash | 拍品 | 出价人 | 金额 | 时间)，任何篡改都会破坏链条。</p>
      </div>`, [{ text: '关闭', action: () => Game.Modal.close() }]);
    } catch (e) { Game.showStatus('存证读取失败：' + e.message, 'error'); }
  }

  /* ---------------- 生命周期 ---------------- */
  function switchTab(tab) {
    const ok = ['preview', 'bid', 'reserve', 'mine', 'orders'];
    S.tab = ok.includes(tab) ? tab : 'preview';
    refresh();
  }

  async function open() {
    if (!isReady()) { Game.showStatus('请先登录后再参与拍卖会', 'warn'); return; }
    buildDom();
    S.open = true;
    showLayer(true);
    document.getElementById('fairPanel').hidden = false;
    await refresh();
    clearInterval(S.timer);
    S.timer = setInterval(() => { if (S.open) tickCountdown(); }, 1000);
  }

  function close() {
    S.open = false;
    showLayer(false);
    const panel = document.getElementById('fairPanel');
    if (panel) panel.hidden = true;
    clearInterval(S.timer);
    S.timer = 0;
  }

  /** social.js 把 SSE fair 事件转过来：面板开着就刷新；涉及背包/银两的再同步一次 */
  function onEvent(d) {
    if (window.Progression && Progression.syncItems) Progression.syncItems();
    if (!S.open) return;
    if (d.kind === 'order_created' || d.kind === 'order_breached' || d.kind === 'order_completed' || d.kind === 'order_confirmed') {
      if (S.tab === 'orders') refresh(); else loadStatus().then(render);
    } else {
      refresh();
    }
  }

  window.AuctionFair = { open, close, onEvent };
})();
