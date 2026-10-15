/*
 * 城池帝国 · 社交模块（军报 / 实时私聊 / 周边征伐）
 *
 * 设计要点：
 *  - 复用 Auth 的请求出口（Auth.api / Auth.apiBase）与会话令牌，不重复实现网络层；
 *  - 实时推送走 SSE 长连接（EventSource），服务端 /api/stream 支持 query 传令牌；
 *  - 所有"按钮"都对应真实接口调用，结果以服务端返回为准，避免假交互；
 *  - 战斗结算由服务端裁定，客户端只负责把结算包落到本地城池存档。
 *
 * 挂载：window.Social，由 cities.html 在登录完成后调用 Social.init()。
 */
(function () {
  'use strict';
  if (!window.Auth) { console.warn('[Social] 需要先加载 auth.js'); return; }

  const API = (window.Auth.apiBase || '').replace(/\/$/, '');
  const api = window.Auth.api;
  const TOKEN = () => (window.Auth.session && window.Auth.session.token) || '';
  const USER_ID = () => (window.Auth.user && window.Auth.user.id) || '';
  const isReady = () => !!TOKEN();

  const RES_NAME = { grain: '粮', stone: '石', wood: '木', gold: '金' };
  const LEVEL_TEXT = { success: '大捷', danger: '告急', warn: '提醒', info: '讯息' };
  const CAT_TEXT = { all: '全部', civic: '内政', intel: '军情', battle: '战报' };
  const TROOP_NAME = { infantry: '步兵', cavalry: '骑兵', wizard: '冰法师', archer: '弓手' };
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtTime = ts => {
    if (!ts) return '';
    const d = new Date(ts), now = Date.now(), diff = now - ts;
    if (diff < 60e3) return '刚刚';
    if (diff < 3600e3) return Math.floor(diff / 60e3) + ' 分钟前';
    if (diff < 864e5) return Math.floor(diff / 3600e3) + ' 小时前';
    return `${d.getMonth() + 1}-${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };

  const S = {
    inited: false, connected: false, es: null, retry: 0, retryTimer: 0, syncTimer: 0, beatTimer: 0,
    unread: { reports: 0, messages: 0, challenges: 0 },
    reports: { category: 'all', items: [], hasMore: false, loading: false },
    convs: [], peer: null, messages: [], online: new Set(),
    nearby: [], challenges: [], dialog: null
  };

  /* ---------------- DOM ---------------- */
  function buildDom() {
    if (document.getElementById('socialRoot')) return;
    const root = document.createElement('div');
    root.id = 'socialRoot';
    root.className = 'social-root';
    root.innerHTML = `
      <div class="social-layer" data-close="1" hidden></div>

      <!-- 军报 -->
      <section class="social-panel" id="panelReports" hidden>
        <header class="social-panel-head">
          <h2>军报</h2>
          <div class="social-head-actions">
            <button type="button" class="social-btn-ghost" data-act="report-readall">全部已读</button>
            <button type="button" class="social-x" data-act="close">×</button>
          </div>
        </header>
        <nav class="social-tabs" id="reportTabs">
          ${['all', 'civic', 'intel', 'battle'].map(k => `<button type="button" data-cat="${k}"${k === 'all' ? ' class="active"' : ''}>${CAT_TEXT[k]}</button>`).join('')}
        </nav>
        <div class="social-scroll" id="reportList"></div>
        <footer class="social-foot"><button type="button" class="social-btn" id="reportMore">加载更多</button></footer>
      </section>

      <!-- 私聊 -->
      <section class="social-panel social-panel-wide" id="panelChat" hidden>
        <header class="social-panel-head">
          <h2>社交 · 私聊</h2>
          <div class="social-head-actions">
            <button type="button" class="social-btn-ghost" data-act="chat-new">发起私聊</button>
            <button type="button" class="social-x" data-act="close">×</button>
          </div>
        </header>
        <div class="chat-wrap">
          <aside class="chat-convs" id="convList"></aside>
          <div class="chat-main">
            <header class="chat-peer" id="chatPeerHead"><span class="chat-peer-empty">选择左侧会话开始聊天</span></header>
            <div class="chat-msgs" id="chatMsgs"></div>
            <form class="chat-form" id="chatForm" autocomplete="off">
              <input type="text" id="socialChatInput" maxlength="500" placeholder="说点什么…" disabled>
              <button type="submit" id="socialChatSend" disabled>发送</button>
            </form>
          </div>
        </div>
      </section>

      <!-- 征伐 -->
      <section class="social-panel social-panel-wide" id="panelWar" hidden>
        <header class="social-panel-head">
          <h2>征伐 · 周边玩家</h2>
          <div class="social-head-actions">
            <button type="button" class="social-btn-ghost" data-act="war-refresh">刷新</button>
            <button type="button" class="social-x" data-act="close">×</button>
          </div>
        </header>
        <div class="war-cols">
          <div class="war-col">
            <h3>可交互玩家 <small id="nearbyCount"></small></h3>
            <div class="social-scroll" id="nearbyList"></div>
          </div>
          <div class="war-col">
            <h3>我的挑战 <small id="challengeCount"></small></h3>
            <div class="social-scroll" id="challengeList"></div>
          </div>
        </div>
      </section>

      <!-- 通用对话（配置人马等） -->
      <div class="social-dialog" id="socialDialog" hidden></div>
      <div class="social-toasts" id="socialToasts"></div>`;
    document.body.appendChild(root);

    root.querySelector('.social-layer').addEventListener('click', () => closeAll());
    root.querySelectorAll('[data-act="close"]').forEach(b => b.addEventListener('click', () => closeAll()));
    root.querySelector('[data-act="report-readall"]').addEventListener('click', markAllReportsRead);
    root.querySelector('[data-act="chat-new"]').addEventListener('click', openNewChatPicker);
    root.querySelector('[data-act="war-refresh"]').addEventListener('click', () => { refreshNearby(); refreshChallenges(); });
    document.getElementById('reportMore').addEventListener('click', () => loadReports(true));
    document.getElementById('reportTabs').addEventListener('click', e => {
      const b = e.target.closest('[data-cat]'); if (!b) return;
      S.reports.category = b.dataset.cat;
      document.querySelectorAll('#reportTabs button').forEach(x => x.classList.toggle('active', x === b));
      loadReports(false);
    });
    document.getElementById('convList').addEventListener('click', e => {
      const row = e.target.closest('[data-peer]'); if (row) openConversation(row.dataset.peer);
    });
    document.getElementById('chatForm').addEventListener('submit', e => { e.preventDefault(); sendChat(); });
    document.getElementById('nearbyList').addEventListener('click', onNearbyClick);
    document.getElementById('challengeList').addEventListener('click', onChallengeClick);
  }

  /* ---------------- 面板开关 ---------------- */
  function showPanel(name) {
    buildDom();
    const map = { reports: 'panelReports', chat: 'panelChat', war: 'panelWar' };
    document.getElementById('socialRoot').classList.add('open');
    document.querySelector('.social-layer').hidden = false;
    Object.values(map).forEach(id => { document.getElementById(id).hidden = true; });
    document.getElementById(map[name]).hidden = false;
    document.querySelector('.social-layer').classList.remove('hidden');
  }
  function closeAll() {
    const root = document.getElementById('socialRoot');
    if (!root) return;
    root.classList.remove('open');
    ['panelReports', 'panelChat', 'panelWar'].forEach(id => { const el = document.getElementById(id); if (el) el.hidden = true; });
    const layer = root.querySelector('.social-layer'); if (layer) layer.hidden = true;
    closeDialog();
  }
  function openPanel(name) {
    showPanel(name);
    if (name === 'reports' && !S.reports.items.length) loadReports(false);
    if (name === 'chat') { renderConvs(); loadConversations(); }
    if (name === 'war') { refreshNearby(); refreshChallenges(); }
  }

  /* ---------------- 角标 ---------------- */
  function badge(key, n) {
    S.unread[key] = n || 0;
    const el = document.querySelector(`[data-badge="${key}"]`);
    if (!el) return;
    if (n > 0) { el.hidden = false; el.textContent = n > 99 ? '99+' : String(n); }
    else el.hidden = true;
  }
  function bindBadges() {
    const wrap = document.createElement('div');
    wrap.className = 'hud-social';
    wrap.innerHTML = `
      <button type="button" class="hud-social-btn" id="socialReportsBtn" title="军报">报<i class="social-badge" data-badge="reports" hidden></i></button>
      <button type="button" class="hud-social-btn" id="socialChatBtn" title="私聊">聊<i class="social-badge" data-badge="messages" hidden></i></button>
      <button type="button" class="hud-social-btn" id="socialWarBtn" title="征伐">征<i class="social-badge" data-badge="challenges" hidden></i></button>`;
    // 挂在 #stage 内：与城池 HUD 共用同一套设计坐标，随舞台缩放/居中，避免与左上牌匾等元素错位重叠
    (document.getElementById('stage') || document.body).appendChild(wrap);
    document.getElementById('socialReportsBtn').addEventListener('click', () => openPanel('reports'));
    document.getElementById('socialChatBtn').addEventListener('click', () => openPanel('chat'));
    document.getElementById('socialWarBtn').addEventListener('click', () => openPanel('war'));
  }

  /* ---------------- 轻提示 ---------------- */
  function toast(msg, kind) {
    const box = document.getElementById('socialToasts');
    if (!box) return;
    const el = document.createElement('div');
    el.className = 'social-toast ' + (kind || '');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(() => el.classList.add('show'), 10);
    setTimeout(() => { el.classList.remove('show'); setTimeout(() => el.remove(), 300); }, 3200);
  }

  /* ---------------- SSE 实时通道 ---------------- */
  function connect() {
    disconnect();
    if (!isReady()) return;
    const url = API + '/api/stream?token=' + encodeURIComponent(TOKEN());
    let es;
    try { es = new EventSource(url); } catch (e) { console.warn('[Social] SSE 初始化失败', e); return; }
    S.es = es;
    es.addEventListener('open', () => { S.connected = true; S.retry = 0; });
    es.addEventListener('hello', e => onHello(JSON.parse(e.data)));
    es.addEventListener('report', e => onReport(JSON.parse(e.data)));
    es.addEventListener('chat', e => {
      let d = null;
      try { d = JSON.parse(e.data); } catch { /* 脏包丢弃 */ }
      if (!d) return;
      onChat(d);
      // 转发给地图模块的聊天面板复用同一条 SSE
      window.dispatchEvent(new CustomEvent('game:stream', { detail: { event: 'chat', data: d } }));
    });
    es.addEventListener('receipt', e => onReceipt(JSON.parse(e.data)));
    es.addEventListener('challenge', e => onChallengeEvent(JSON.parse(e.data)));
    es.addEventListener('auction', e => onAuctionEvent(JSON.parse(e.data)));
    es.addEventListener('fair', e => onFairEvent(JSON.parse(e.data)));
    // 公共事件转发：地图红点等模块复用同一条 SSE，避免每个模块各开一条长连接
    es.addEventListener('map:player', e => {
      let detail = null;
      try { detail = JSON.parse(e.data); } catch { /* 脏包丢弃 */ }
      window.dispatchEvent(new CustomEvent('game:stream', { detail: { event: 'map:player', data: detail } }));
    });
    es.addEventListener('error', () => {
      S.connected = false;
      if (es.readyState === 2) { // CLOSED：不自动重连，由我们退避重试
        clearTimeout(S.retryTimer);
        const wait = Math.min(30000, 1500 * Math.pow(2, Math.min(S.retry++, 4)));
        S.retryTimer = setTimeout(connect, wait);
      }
    });
  }
  function disconnect() { if (S.es) { try { S.es.close(); } catch {} S.es = null; } S.connected = false; }

  function onHello(d) {
    badge('reports', d.unreadReports || 0);
    badge('messages', d.unreadMessages || 0);
    S.online = new Set(d.online || []);
    refreshChallenges();
    if (!document.getElementById('panelChat').hidden) loadConversations();
  }
  function onReport(d) {
    badge('reports', d.unread || S.unread.reports + 1);
    const r = d.report || {};
    if (r.title) toast(`【军报】${r.title}`, r.level === 'danger' ? 'danger' : r.level === 'success' ? 'success' : '');
    if (!document.getElementById('panelReports').hidden) loadReports(false);
  }
  function onChat(d) {
    console.log('[Social] 收到 chat 事件:', d);
    const m = d.message; if (!m) return;
    console.log('[Social] 消息内容:', m);
    console.log('[Social] 当前对话peer:', S.peer, '消息来自:', m.from);
    
    if (S.peer === m.from) { 
      console.log('[Social] 是当前对话，追加到消息列表');
      S.messages.push(m); 
      renderMessages(); 
      scrollMsgs(); 
      markConversationRead(m.from); 
    } else {
      console.log('[Social] 不是当前对话，增加未读角标');
      badge('messages', S.unread.messages + 1);
    }
    loadConversations();
  }
  function onReceipt(d) {
    if (d.messageIds && d.deliveredAt) {
      S.messages.forEach(m => { if (d.messageIds.includes(m.id) && !m.deliveredAt) m.deliveredAt = d.deliveredAt; });
      renderMessages();
    }
    if (d.readAt) {
      S.messages.forEach(m => { if (m.to === d.by && !m.readAt) m.readAt = d.readAt; });
      renderMessages();
    }
    loadConversations();
  }
  function onChallengeEvent(d) {
    if (d.kind === 'invite') {
      badge('challenges', S.unread.challenges + 1);
      toast(`【战书】${d.fromName || '对手'} 向你发起挑战`, 'danger');
    } else if (d.kind === 'steal') {
      toast(d.success ? '有玩家偷袭得手，查看军报' : '有玩家偷袭被击退', d.success ? 'danger' : '');
    } else if (d.kind === 'declined') {
      toast('对方拒绝了你的挑战');
    } else if (d.kind === 'settled') {
      applySettlement(d);
    } else if (d.status === 'expired') {
      toast('有挑战已超时失效');
    }
    refreshChallenges();
    if (!document.getElementById('panelWar').hidden) refreshChallenges();
  }

  /* ---------------- 拍卖行实时事件 ---------------- */
  function onAuctionEvent(d) {
    const label = { created: '拍卖行有新挂单', bid: '拍卖行有人出价', outbid: '你的出价被超越',
      settled: '拍品已成交', expired: '拍品流拍', cancelled: '挂单已撤销' };
    toast(`【拍卖】${label[d.kind] || '挂单变动'}`, d.kind === 'outbid' ? 'danger' : '');
    // 成交/流拍会改变背包与挂单状态，拉一次最新数据
    if (window.Progression && Progression.syncItems) Progression.syncItems();
    if (window.Auction && Auction.onEvent) Auction.onEvent(d);
  }

  /* ---------------- 拍卖会实时事件 ---------------- */
  function onFairEvent(d) {
    const label = { session_open: '拍卖会已开场', lot_created: '拍品已提交', lot_reviewed: '拍品审核结果',
      lot_cancelled: '拍品已撤回', lot_unsold: '拍品流拍', bid: '有人出价', outbid: '你的出价被超越',
      order_created: '成交订单已生成', order_confirmed: '买家已确认交割', order_completed: '交割已完成', order_breached: '订单违约处理' };
    toast(`【拍卖会】${label[d.kind] || '状态更新'}`, d.kind === 'outbid' || d.kind === 'order_breached' ? 'danger' : '');
    if (window.AuctionFair && AuctionFair.onEvent) AuctionFair.onEvent(d);
  }

  /* ---------------- 军报 ---------------- */
  async function loadReports(more) {
    if (!isReady() || S.reports.loading) return;
    S.reports.loading = true;
    try {
      const before = more && S.reports.items.length ? S.reports.items[S.reports.items.length - 1].id : 0;
      const q = `/api/reports?limit=20&category=${encodeURIComponent(S.reports.category)}${before ? '&beforeId=' + before : ''}`;
      const r = await api('GET', q, null, TOKEN());
      S.reports.items = more ? S.reports.items.concat(r.reports) : r.reports;
      S.reports.hasMore = !!r.hasMore;
      badge('reports', r.unreadCount || 0);
      renderReports();
    } catch (e) { toast('军报加载失败：' + e.message, 'danger'); }
    finally { S.reports.loading = false; }
  }
  function renderReports() {
    const box = document.getElementById('reportList');
    if (!S.reports.items.length) { box.innerHTML = '<p class="social-empty">暂无军报</p>'; document.getElementById('reportMore').hidden = true; return; }
    box.innerHTML = S.reports.items.map(r => `
      <article class="report-item ${r.read ? '' : 'unread'} lv-${esc(r.level)}" data-id="${r.id}">
        <div class="report-dot"></div>
        <div class="report-main">
          <div class="report-title"><b>${esc(r.title)}</b><span class="report-tag">${esc(CAT_TEXT[r.category] || r.category)}·${esc(LEVEL_TEXT[r.level] || r.level)}</span></div>
          <p>${esc(r.body)}</p>
          <time>${fmtTime(r.createdAt)}</time>
        </div>
      </article>`).join('');
    document.getElementById('reportMore').hidden = !S.reports.hasMore;
  }
  async function markAllReportsRead() {
    if (!isReady()) return;
    try {
      const r = await api('POST', '/api/reports/read', { all: true }, TOKEN());
      badge('reports', r.unreadCount || 0);
      S.reports.items.forEach(x => x.read = true);
      renderReports();
      toast('军报已全部标记为已读');
    } catch (e) { toast('操作失败：' + e.message, 'danger'); }
  }

  /* ---------------- 私聊 ---------------- */
  async function loadConversations() {
    if (!isReady()) return;
    try {
      const r = await api('GET', '/api/chat/conversations', null, TOKEN());
      const conversations = r.conversations || [];
      
      // 去重：同一个用户只保留最新的会话
      const userMap = new Map();
      conversations.forEach(conv => {
        const existing = userMap.get(conv.userId);
        if (!existing || (conv.last && (!existing.last || conv.last.createdAt > existing.last.createdAt))) {
          userMap.set(conv.userId, conv);
        }
      });
      
      S.convs = Array.from(userMap.values());
      badge('messages', r.unreadTotal || 0);
      renderConvs();
    } catch (e) { /* 静默 */ }
  }
  function renderConvs() {
    const box = document.getElementById('convList');
    if (!S.convs.length) { box.innerHTML = '<p class="social-empty">暂无会话<br><small>点右上「发起私聊」找玩家</small></p>'; return; }
    box.innerHTML = S.convs.map(c => `
      <button type="button" class="conv-item${c.userId === S.peer ? ' active' : ''}" data-peer="${esc(c.userId)}">
        <span class="conv-avatar">${esc((c.nickname || '?').slice(0, 1))}</span>
        <span class="conv-body">
          <span class="conv-top"><b>${esc(c.nickname || '玩家')}</b><time>${c.last ? fmtTime(c.last.createdAt) : ''}</time></span>
          <span class="conv-last">${esc(c.last ? c.last.body : '（暂无消息）')}</span>
        </span>
        ${c.unread > 0 ? `<i class="conv-badge">${c.unread > 99 ? '99+' : c.unread}</i>` : ''}
        <i class="conv-on${c.online ? ' on' : ''}"></i>
      </button>`).join('');
  }
  async function openConversation(peerId, userInfo) {
    console.log('[Social] ========== openConversation 开始 ==========');
    console.log('[Social] peerId:', peerId, 'type:', typeof peerId);
    console.log('[Social] userInfo:', userInfo);
    console.log('[Social] 设置前 S.peer:', S.peer);
    
    // userInfo 可选参数：{ nickname, online }，用于没有会话记录时显示用户信息
    S.peer = peerId;
    console.log('[Social] 设置后 S.peer:', S.peer);
    
    const c = S.convs.find(x => x.userId === peerId);
    console.log('[Social] 找到的会话:', c);
    console.log('[Social] 当前所有会话:', S.convs);
    
    // 优先使用会话中的信息，其次使用传入的userInfo
    const nickname = (c && c.nickname) || (userInfo && userInfo.nickname) || '玩家';
    const online = c ? c.online : (userInfo && userInfo.online);
    
    console.log('[Social] nickname:', nickname, 'online:', online);
    
    const head = document.getElementById('chatPeerHead');
    head.innerHTML = `<b>${esc(nickname)}</b><span class="conv-on${online ? ' on' : ''}"></span><small>${online ? '在线' : '离线'}</small>`;
    
    const inputEl = document.getElementById('socialChatInput');
    const sendEl = document.getElementById('socialChatSend');
    
    console.log('[Social] 启用输入框前，disabled:', inputEl.disabled);
    inputEl.disabled = false;
    sendEl.disabled = false;
    console.log('[Social] 启用输入框后，disabled:', inputEl.disabled);
    
    document.getElementById('chatMsgs').innerHTML = '<p class="social-empty">加载中…</p>';
    renderConvs();
    try {
      const r = await api('GET', `/api/chat/history?with=${encodeURIComponent(peerId)}&limit=60`, null, TOKEN());
      S.messages = r.messages || [];
      renderMessages(); 
      scrollMsgs();
      
      // 再次确保输入框启用（防止被其他代码禁用）
      inputEl.disabled = false;
      sendEl.disabled = false;
      console.log('[Social] 加载完成后，再次确保输入框启用，disabled:', inputEl.disabled);
      
      markConversationRead(peerId);
      // 刷新会话列表以包含新会话
      loadConversations();
    } catch (e) { document.getElementById('chatMsgs').innerHTML = `<p class="social-empty">加载失败：${esc(e.message)}</p>`; }
  }
  async function markConversationRead(peerId) {
    if (!isReady()) return;
    try { const r = await api('POST', '/api/chat/read', { with: peerId }, TOKEN()); badge('messages', r.unreadTotal || 0); loadConversations(); }
    catch (e) { /* 静默 */ }
  }
  function renderMessages() {
    const box = document.getElementById('chatMsgs');
    if (!S.messages.length) { box.innerHTML = '<p class="social-empty">还没有消息，先打个招呼吧</p>'; return; }
    const me = USER_ID();
    box.innerHTML = S.messages.map(m => {
      const mine = m.from === me;
      const tick = !mine ? '' : (m.readAt ? '<i class="tick read">已读</i>' : m.deliveredAt ? '<i class="tick">已送达</i>' : '<i class="tick pending">发送中</i>');
      return `<div class="msg ${mine ? 'mine' : 'theirs'}"><div class="bubble">${esc(m.body)}<span class="meta">${fmtTime(m.createdAt)}${tick}</span></div></div>`;
    }).join('');
  }
  function scrollMsgs() { const box = document.getElementById('chatMsgs'); if (box) box.scrollTop = box.scrollHeight; }
  async function sendChat() {
    const input = document.getElementById('socialChatInput');
    const text = input.value.trim();
    if (!text || !S.peer || !isReady()) return;
    input.value = '';
    const temp = { id: 'tmp-' + Date.now(), from: USER_ID(), to: S.peer, body: text, createdAt: Date.now(), deliveredAt: null, readAt: null };
    S.messages.push(temp); renderMessages(); scrollMsgs();
    try {
      const r = await api('POST', '/api/chat/send', { to: S.peer, body: text }, TOKEN());
      const i = S.messages.indexOf(temp);
      if (i >= 0) S.messages[i] = r.message;
      renderMessages(); scrollMsgs(); loadConversations();
    } catch (e) {
      const i = S.messages.indexOf(temp);
      if (i >= 0) S.messages.splice(i, 1);
      renderMessages();
      toast('发送失败：' + e.message, 'danger');
    }
  }
  async function openNewChatPicker() {
    if (!isReady()) { toast('请先登录后再使用社交功能', 'danger'); return; }
    showDialog('选择聊天对象', '<p class="social-empty">加载周边玩家…</p>', []);
    try {
      const r = await api('GET', '/api/players/nearby?radius=500', null, TOKEN());
      S.nearby = r.players || [];
      const html = S.nearby.length
        ? S.nearby.map(p => `<button type="button" class="pick-row" data-pick="${esc(p.userId)}"><span class="conv-avatar">${esc((p.nickname || '?').slice(0, 1))}</span><b>${esc(p.nickname || '玩家')}</b><small>《${esc(p.cityName || '未知城')}》 ${p.online ? '在线' : '离线'}</small></button>`).join('')
        : '<p class="social-empty">附近暂时没有其他玩家</p>';
      showDialog('选择聊天对象', html, []);
      document.getElementById('socialDialog').addEventListener('click', e => {
        const b = e.target.closest('[data-pick]'); if (!b) return;
        closeDialog(); openPanel('chat'); openConversation(b.dataset.pick);
      }, { once: true });
    } catch (e) { showDialog('选择聊天对象', `<p class="social-empty">加载失败：${esc(e.message)}</p>`, []); }
  }

  /* ---------------- 征伐：周边玩家 ---------------- */
  async function refreshNearby() {
    if (!isReady()) return;
    try {
      const r = await api('GET', '/api/players/nearby?radius=500', null, TOKEN());
      S.nearby = r.players || [];
      renderNearby();
    } catch (e) { toast('周边玩家加载失败：' + e.message, 'danger'); }
  }
  function renderNearby() {
    const box = document.getElementById('nearbyList');
    if (!box) return;
    document.getElementById('nearbyCount').textContent = S.nearby.length ? `(${S.nearby.length})` : '';
    if (!S.nearby.length) { box.innerHTML = '<p class="social-empty">方圆 500 公里内暂无其他玩家</p>'; return; }
    box.innerHTML = S.nearby.map(p => `
      <article class="near-item">
        <div class="near-top">
          <b>${esc(p.nickname || '玩家')}</b>
          <span class="conv-on${p.online ? ' on' : ''}"></span>
          <small>${p.online ? '在线' : '离线'}</small>
          ${p.protected ? '<em class="tag-protect">保护中</em>' : ''}
        </div>
        <div class="near-meta">
          <span>《${esc(p.cityName || '未知城')}》Lv.${p.level || 1}</span>
          <span>兵力 ${p.troopCount || 0}</span>
          <span>${p.distance != null ? Math.round(p.distance) + ' km' : ''}</span>
        </div>
        <div class="near-actions">
          <button type="button" class="social-btn-sm" data-steal="${esc(p.userId)}"${p.protected ? ' disabled' : ''}>偷取资源</button>
          <button type="button" class="social-btn-sm danger" data-challenge="${esc(p.userId)}"${p.protected ? ' disabled' : ''}>发起挑战</button>
          <button type="button" class="social-btn-sm ghost" data-chat="${esc(p.userId)}">私聊</button>
        </div>
      </article>`).join('');
  }
  function onNearbyClick(e) {
    const stealBtn = e.target.closest('[data-steal]');
    const chalBtn = e.target.closest('[data-challenge]');
    const chatBtn = e.target.closest('[data-chat]');
    if (stealBtn) doSteal(stealBtn.dataset.steal);
    else if (chalBtn) openTroopDialog('create', chalBtn.dataset.challenge);
    else if (chatBtn) { closeAll(); openPanel('chat'); openConversation(chatBtn.dataset.chat); }
  }
  async function doSteal(targetId) {
    if (!isReady()) return;
    try {
      const r = await api('POST', '/api/challenge/steal', { targetId }, TOKEN());
      if (r.success) {
        const gains = Object.entries(r.delta || {}).filter(([, v]) => v > 0).map(([k, v]) => RES_NAME[k] + v).join('、');
        applyResourceDelta(r.delta);
        toast('偷袭得手！掠得 ' + (gains || '少量物资'), 'success');
      } else {
        toast('偷袭失败，被守军击退', 'danger');
      }
      refreshNearby();
    } catch (e) { toast('偷取失败：' + e.message, 'danger'); }
  }

  /* ---------------- 征伐：挑战 ---------------- */
  async function refreshChallenges() {
    if (!isReady()) return;
    try {
      const r = await api('GET', '/api/challenge/list', null, TOKEN());
      S.challenges = r.challenges || [];
      const pending = S.challenges.filter(c => c.role === 'defender' && c.status === 'pending').length;
      badge('challenges', pending);
      renderChallenges();
    } catch (e) { /* 静默 */ }
  }
  function renderChallenges() {
    const box = document.getElementById('challengeList');
    if (!box) return;
    document.getElementById('challengeCount').textContent = S.challenges.length ? `(${S.challenges.length})` : '';
    if (!S.challenges.length) { box.innerHTML = '<p class="social-empty">暂无挑战记录</p>'; return; }
    const st = { pending: '待应战', ready: '已备齐', settled: '已结算', declined: '已拒绝', expired: '已超时' };
    box.innerHTML = S.challenges.map(c => {
      const atkTotal = Object.values(c.atkTroops || {}).reduce((a, b) => a + (b || 0), 0);
      const defTotal = Object.values(c.defTroops || {}).reduce((a, b) => a + (b || 0), 0);
      const mine = c.role === 'attacker' ? '我方进攻' : '我方应战';
      let extra = '';
      if (c.status === 'settled' && c.result && c.result.winner) {
        const win = c.result.winner === USER_ID();
        extra = `<p class="chal-result ${win ? 'win' : 'lose'}">${win ? '我方获胜' : '我方失利'} · 战力 ${c.result.atkPower} : ${c.result.defPower}</p>`;
      }
      const canRespond = c.role === 'defender' && c.status === 'pending';
      return `<article class="chal-item">
        <div class="chal-top"><b>${esc(c.opponent.nickname || '对手')}</b><span class="chal-role">${mine}</span><span class="chal-st st-${esc(c.status)}">${st[c.status] || c.status}</span></div>
        <div class="chal-meta"><span>攻方 ${atkTotal} 众</span><span>守方 ${defTotal} 众</span><time>${fmtTime(c.createdAt)}</time></div>
        ${extra}
        ${canRespond ? `<div class="chal-actions"><button type="button" class="social-btn-sm danger" data-respond="${c.id}">配置应战</button><button type="button" class="social-btn-sm ghost" data-decline="${c.id}">拒绝</button></div>` : ''}
      </article>`;
    }).join('');
  }
  function onChallengeClick(e) {
    const r = e.target.closest('[data-respond]');
    const d = e.target.closest('[data-decline]');
    if (r) openTroopDialog('respond', null, Number(r.dataset.respond));
    else if (d) declineChallenge(Number(d.dataset.decline));
  }
  async function declineChallenge(id) {
    try { await api('POST', '/api/challenge/decline', { id }, TOKEN()); toast('已拒绝该挑战'); refreshChallenges(); }
    catch (e) { toast('操作失败：' + e.message, 'danger'); }
  }

  /**
   * 配置人马对话框
   * @param {'create'|'respond'} mode create=发起挑战（附带目标）；respond=应战（附带挑战 id）
   */
  function openTroopDialog(mode, targetId, challengeId) {
    const owned = (window.Game && Game.state && Game.state.city && Game.state.city.troops) || {};
    const kinds = Object.keys(TROOP_NAME).filter(k => (owned[k] || 0) > 0);
    if (!kinds.length) { toast('城中没有可用兵力，请先练兵', 'danger'); return; }
    const title = mode === 'create' ? '配置出战人马' : '配置应战人马';
    const rows = kinds.map(k => `
      <div class="troop-row" data-troop="${k}">
        <span class="troop-name">${TROOP_NAME[k]}</span>
        <button type="button" class="step" data-step="-1">−</button>
        <input type="number" min="0" max="${owned[k] || 0}" value="0" inputmode="numeric">
        <button type="button" class="step" data-step="1">＋</button>
        <small>/ ${owned[k] || 0}</small>
      </div>`).join('');
    showDialog(title, `<div class="troop-form">${rows}<p class="troop-total">合计出战：<b id="troopTotal">0</b> 众</p></div>`, [
      { text: '取消', ghost: true, action: closeDialog },
      { text: mode === 'create' ? '下战书' : '应战', action: () => submitTroopDialog(mode, targetId, challengeId) }
    ]);
    const dlg = document.getElementById('socialDialog');
    const recalc = () => {
      let t = 0;
      dlg.querySelectorAll('.troop-row').forEach(r => { t += Math.max(0, Number(r.querySelector('input').value) || 0); });
      document.getElementById('troopTotal').textContent = t;
      S.dialog = { mode, targetId, challengeId, troops: readTroops(dlg) };
    };
    dlg.querySelectorAll('.step').forEach(b => b.addEventListener('click', () => {
      const row = b.closest('.troop-row'), input = row.querySelector('input');
      const max = Number(input.max) || 0;
      input.value = Math.max(0, Math.min(max, (Number(input.value) || 0) + Number(b.dataset.step)));
      recalc();
    }));
    dlg.querySelectorAll('.troop-row input').forEach(i => i.addEventListener('input', () => {
      i.value = Math.max(0, Math.min(Number(i.max) || 0, Math.floor(Number(i.value) || 0)));
      recalc();
    }));
    recalc();
  }
  function readTroops(dlg) {
    const out = {};
    dlg.querySelectorAll('.troop-row').forEach(r => {
      const n = Math.floor(Number(r.querySelector('input').value) || 0);
      if (n > 0) out[r.dataset.troop] = n;
    });
    return out;
  }
  async function submitTroopDialog(mode, targetId, challengeId) {
    const dlg = document.getElementById('socialDialog');
    const troops = readTroops(dlg);
    const total = Object.values(troops).reduce((a, b) => a + b, 0);
    if (!total) { toast('请至少配置 1 名士兵', 'danger'); return; }
    closeDialog();
    try {
      if (mode === 'create') {
        await api('POST', '/api/challenge/create', { targetId, troops }, TOKEN());
        toast('战书已送达，等待对方配置应战人马', 'success');
      } else {
        const r = await api('POST', '/api/challenge/respond', { id: challengeId, troops }, TOKEN());
        toast('应战人马已提交，结算完成', 'success');
        if (r.mine) applySettlement(r.mine);
      }
      refreshChallenges();
    } catch (e) { toast('提交失败：' + e.message, 'danger'); }
  }

  /* ---------------- 结算落地 ---------------- */
  // 同一场结算会同时经「应战接口的 HTTP 返回」与「SSE settled 推送」到达，
  // 用 challengeId 去重，保证资源增减与伤亡只落地一次。
  const appliedChallenges = new Set();
  function applyResourceDelta(delta) {
    if (!delta || !window.Game) return;
    // 兜底：城池数据缺失时不抛错（该函数在结算/推送链路里被调用，抛错会中断后续刷新）
    const res = (Game.state.city && Game.state.city.resources) || {};
    Object.keys(delta).forEach(k => {
      if (k in res) res[k] = Math.max(0, Math.round((Number(res[k]) || 0) + delta[k]));
    });
    if (Game.UI && Game.UI.updateResources) Game.UI.updateResources();
    if (Game.saveState) Game.saveState();
  }
  /** 服务端结算包 → 本地城池：扣资源、扣兵力，并刷新界面 */
  function applySettlement(pkg) {
    if (!pkg || !window.Game) return;
    const cid = pkg.challengeId;
    if (cid && appliedChallenges.has(cid)) return;
    if (cid) appliedChallenges.add(cid);
    try {
      if (pkg.delta) applyResourceDelta(pkg.delta);
      if (pkg.troopLoss) {
        const t = (Game.state.city && Game.state.city.troops) || {};
        Object.keys(pkg.troopLoss).forEach(k => { t[k] = Math.max(0, (Number(t[k]) || 0) - pkg.troopLoss[k]); if (!t[k]) delete t[k]; });
      }
      if (Game.UI) { Game.UI.updateResources(); if (Game.UI.updateBuildings) Game.UI.updateBuildings(); }
      if (Game.saveState) Game.saveState();
      const res = pkg.result || {};
      const win = res.winner === USER_ID();
      const won = pkg.role === 'defender' ? !res.attackerWin : res.attackerWin;
      if (Object.keys(pkg.troopLoss || {}).length || Object.keys(pkg.delta || {}).length || res.winner) {
        toast(won ? '征伐获胜！' : '征伐失利…', won ? 'success' : 'danger');
      }
      syncPlayerState();
    } catch (e) { console.warn('[Social] 结算应用失败', e); }
  }

  /* ---------------- 对话（通用） ---------------- */
  function showDialog(title, html, buttons) {
    buildDom();
    const dlg = document.getElementById('socialDialog');
    dlg.innerHTML = `
      <div class="social-dialog-box">
        <header><h3>${esc(title)}</h3><button type="button" class="social-x" data-dlg-close>×</button></header>
        <div class="social-dialog-body">${html}</div>
        <footer>${(buttons || []).map((b, i) => `<button type="button" class="social-btn ${b.ghost ? 'ghost' : ''}" data-dlg-btn="${i}">${esc(b.text)}</button>`).join('')}</footer>
      </div>`;
    dlg.hidden = false;
    dlg.querySelector('[data-dlg-close]').addEventListener('click', closeDialog);
    dlg.querySelectorAll('[data-dlg-btn]').forEach(btn => btn.addEventListener('click', () => buttons[Number(btn.dataset.dlgBtn)].action()));
  }
  function closeDialog() { const d = document.getElementById('socialDialog'); if (d) { d.hidden = true; d.innerHTML = ''; } S.dialog = null; }

  /* ---------------- 玩家快照同步 ---------------- */
  let _lastSync = 0;
  async function syncPlayerState() {
    if (!isReady() || !window.Game) return;
    // 参观他人城池预览期间，state.city 是对方的城池，
    // 不能拿它当自己上报，否则自己的城池坐标/名称会被错误覆盖
    if (Game.previewBackup) return;
    const now = Date.now();
    if (now - _lastSync < 4000) return; // 存档可能在一次操作里被连续写入，节流一下
    _lastSync = now;
    const c = Game.state.city;
    const pos = c.mapPosition || {};
    try {
      await api('POST', '/api/player/state', {
        cityName: c.name, region: pos.region || '', lat: pos.lat, lng: pos.lng,
        level: c.level, resources: c.resources, troops: c.troops,
        protectedUntil: c.protectionEndTime || 0,
        // 建城地点类型决定拍卖行准入；战力倍率来自生效中的秘籍增益（服务端会再钳制）
        cityType: pos.placeType || c.cityType || '',
        powerMult: window.Game.powerMult ? Game.powerMult() : 1
      }, TOKEN());
    } catch (e) { /* 网络抖动忽略，下次再同步 */ }
  }

  /* ---------------- 生命周期 ---------------- */
  function init() {
    if (!isReady()) {
      // 游客/未登录：隐藏入口，给出提示
      const wrap = document.getElementById('socialRoot');
      if (wrap) wrap.remove();
      document.querySelectorAll('.hud-social').forEach(el => el.remove());
      S.inited = false;
      return;
    }
    if (S.inited) { connect(); return; }
    S.inited = true;
    buildDom();
    bindBadges();
    connect();
    syncPlayerState();
    loadConversations();
    refreshChallenges();
    clearInterval(S.syncTimer);
    S.syncTimer = setInterval(() => { syncPlayerState(); if (!document.getElementById('panelWar').hidden) refreshNearby(); }, 30000);
  }
  function destroy() {
    disconnect();
    clearInterval(S.syncTimer);
    const root = document.getElementById('socialRoot');
    if (root) root.remove();
    document.querySelectorAll('.hud-social').forEach(el => el.remove());
    S.inited = false; S.peer = null; S.messages = []; S.convs = []; S.challenges = []; S.nearby = [];
    S.unread = { reports: 0, messages: 0, challenges: 0 };
  }

  window.Social = {
    init, destroy, syncPlayerState,
    openPanel,
    openChat: openConversation,  // 暴露打开指定用户聊天的方法
    get connected() { return S.connected; },
    _state: S
  };
  // 暴露内部状态对象供调试
  window.SocialState = S;
})();
