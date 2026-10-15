/*
 * 城池帝国 · 联机地图模块 V2
 *
 * 功能：
 * 1. 在世界地图上显示所有在线玩家的城池位置（红色标记点）
 * 2. 点击标记点，从右侧滑入显示玩家信息面板
 * 3. 点击"私聊"按钮，打开与该玩家的聊天界面
 * 4. 点击"发起挑战"按钮，检查在线状态并发送挑战请求
 * 5. 点击"×"按钮，面板滑出隐藏
 */
(function() {
  'use strict';

  if (!window.Auth) { console.warn('[OnlineMap] 需要先加载 auth.js'); return; }

  const API = (window.Auth.apiBase || '').replace(/\/$/, '');
  const api = window.Auth.api;
  const TOKEN = () => (window.Auth.session && window.Auth.session.token) || '';
  const isReady = () => !!TOKEN() && !window.Auth.isGuest;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  const OnlineMap = {
    markers: [],          // 已绘制的玩家城池标记
    players: [],          // 在线玩家数据
    refreshTimer: 0,      // 自动刷新定时器
    infoPanel: null,      // 玩家信息面板
    chatPanel: null,      // 聊天面板
    currentPeer: null,    // 当前查看的玩家
    visible: true,        // 其他玩家标记是否显示（图例筛选）
    chatMessages: {},     // 聊天消息缓存 {userId: [{from, text, time}]}
    _eventsBound: false,  // 事件只绑定一次（每次进入世界地图都会 init）
    _hideToken: 0,        // 信息面板隐藏令牌，避免延迟隐藏打断新打开的面板

    /** 初始化：在 WorldMap 初始化后调用 */
    init() {
      if (!window.WorldMap || !window.WorldMap.map) {
        console.warn('[OnlineMap] WorldMap 未初始化');
        return;
      }
      this.buildPanels();
      this.bindEvents();
      if (isReady()) {
        this.fetchOnlinePlayers();
        this.startAutoRefresh();
      }
    },

    /** 构建所有面板 DOM */
    buildPanels() {
      this.buildInfoPanel();
      this.buildChatPanel();
    },

    /** 构建玩家信息面板 */
    buildInfoPanel() {
      let panel = document.getElementById('playerInfoPanel');
      if (panel) {
        // 已存在时也要保存引用，否则后续 bindEvents 拿到 null，所有按钮点击都无响应
        this.infoPanel = panel;
        return;
      }

      panel = document.createElement('div');
      panel.id = 'playerInfoPanel';
      panel.className = 'player-info-panel';
      panel.innerHTML = `
        <header class="player-info-head">
          <h3 id="playerInfoTitle">玩家城池</h3>
          <button type="button" class="player-info-close" aria-label="关闭">×</button>
        </header>
        <div class="player-info-body" id="playerInfoBody">
          <p class="loading">加载中…</p>
        </div>
        <footer class="player-info-foot">
          <button type="button" class="btn-visit" data-act="visit">进入参观</button>
          <button type="button" class="btn-chat" data-act="chat">私聊</button>
          <button type="button" class="btn-challenge" data-act="challenge">发起挑战</button>
        </footer>
      `;
      document.body.appendChild(panel);
      this.infoPanel = panel;
    },

    /** 构建聊天面板 */
    buildChatPanel() {
      let chatPanel = document.getElementById('playerChatPanel');
      if (chatPanel) {
        this.chatPanel = chatPanel;
        return;
      }

      chatPanel = document.createElement('div');
      chatPanel.id = 'playerChatPanel';
      chatPanel.className = 'player-chat-panel';
      chatPanel.innerHTML = `
        <header class="player-chat-head">
          <button type="button" class="chat-back" aria-label="返回">←</button>
          <div class="chat-peer-info">
            <h3 id="chatPeerName">聊天</h3>
            <span id="chatPeerStatus" class="peer-status"></span>
          </div>
          <button type="button" class="chat-close" aria-label="关闭">×</button>
        </header>
        <div class="player-chat-body" id="chatMessages">
          <p class="chat-empty">开始聊天...</p>
        </div>
        <footer class="player-chat-foot">
          <input type="text" id="chatInput" placeholder="输入消息..." maxlength="200">
          <button type="button" id="chatSendBtn">发送</button>
        </footer>
      `;
      document.body.appendChild(chatPanel);
      this.chatPanel = chatPanel;
    },

    /** 绑定所有事件 */
    bindEvents() {
      // WorldMap.show() 每次进入世界地图都会调用 init()，
      // 这里必须去重，否则监听器会成倍叠加（一次点击触发多次、消息重复发送）
      if (this._eventsBound) return;
      this._eventsBound = true;

      // 信息面板事件
      const infoPanel = this.infoPanel;
      if (infoPanel) {
        // 关闭按钮 - 滑出隐藏
        infoPanel.querySelector('.player-info-close').addEventListener('click', () => {
          this.hidePlayerInfo();
        });

        // 操作按钮
        infoPanel.querySelector('.player-info-foot').addEventListener('click', e => {
          const btn = e.target.closest('[data-act]');
          if (!btn) return;

          // currentPeer 可能因面板动画/刷新丢失，这里做一次兜底解析，避免"点了没反应"
          const peer = this.currentPeer || this.players.find(p => p.userId === infoPanel.dataset.peerId);
          if (!peer) { this.showGameToast('玩家信息已失效，请重新点击地图上的红点', 'warn'); return; }
          this.currentPeer = peer;

          const act = btn.dataset.act;
          // 兜底：mock-api.js 的占位玩家（player_001…）是不存在的假账号，
          // 对其发起联机操作必然失败。这里提前拦截并给出明确提示，
          // 避免出现"点了没反应 / 发送失败"这类难以定位的问题。
          if (/^player_\d+$/i.test(String(peer.userId || ''))) {
            this.showGameToast('当前显示的是离线演示假数据，无法联机。请关闭 mock 模式（去掉地址栏 ?mock=1）后重试', 'warn');
            return;
          }
          switch (act) {
            case 'visit':
              this.visitPlayerCity(peer.userId);
              break;
            case 'chat':
              this.openChat(peer);
              break;
            case 'challenge':
              this.sendChallenge(peer);
              break;
          }
        });
      }

      // 聊天面板事件
      const chatPanel = this.chatPanel;
      if (chatPanel) {
        // 返回按钮
        chatPanel.querySelector('.chat-back').addEventListener('click', () => {
          this.closeChat();
        });

        // 关闭按钮
        chatPanel.querySelector('.chat-close').addEventListener('click', () => {
          this.closeChat(true);
        });

        // 发送消息
        const sendMsg = () => {
          const input = chatPanel.querySelector('#chatInput');
          const text = input.value.trim();
          if (!text) return;
          if (!this.currentPeer) { this.showGameToast('聊天对象已失效，请重新打开面板', 'warn'); return; }
          this.sendMessage(this.currentPeer.userId, text);
          input.value = '';
        };

        chatPanel.querySelector('#chatSendBtn').addEventListener('click', sendMsg);
        chatPanel.querySelector('#chatInput').addEventListener('keypress', e => {
          if (e.key === 'Enter') sendMsg();
        });
      }

      // 实时消息：复用 social.js 已建立的 SSE 转发通道，避免重复开长连接
      window.addEventListener('game:stream', e => {
        const d = e.detail;
        if (d && d.event === 'chat' && d.data) this.onIncomingMessage(d.data.message);
      });
    },

    /** 从服务器获取在线玩家列表 */
    async fetchOnlinePlayers() {
      if (!isReady()) return;

      try {
        const r = await api('GET', '/api/players/map', null, TOKEN());
        this.players = r.players || [];
        this.renderPlayerMarkers();
      } catch (e) {
        console.warn('[OnlineMap] 获取玩家列表失败:', e.message);
      }
    },

    /**
     * 兼容解析玩家坐标。
     * 真实接口 /api/players/map 返回顶层 lat/lng，旧版与 mock-api.js 使用 mapPosition，
     * 这里两种形状都支持，否则真实数据下所有标记都会被过滤掉、地图上点不到任何玩家。
     * @returns {{lat:number,lng:number}|null}
     */
    playerLatLng(p) {
      const pos = (p && p.lat != null && p.lng != null) ? p : ((p && p.mapPosition) || {});
      const lat = Number(pos.lat), lng = Number(pos.lng);
      return (Number.isFinite(lat) && Number.isFinite(lng)) ? { lat, lng } : null;
    },

    /** 在地图上绘制玩家城池标记 */
    renderPlayerMarkers() {
      if (!window.WorldMap || !window.WorldMap.map) return;
      const map = window.WorldMap.map;

      // 清除旧标记
      this.markers.forEach(m => map.removeLayer(m));
      this.markers = [];

      // 过滤掉当前玩家自己的城池，以及坐标缺失/非法的记录
      const myUserId = window.Auth.user ? window.Auth.user.id : null;
      const otherPlayers = this.players.filter(p => {
        if (p.userId === myUserId) return false;
        const pos = this.playerLatLng(p);
        if (!pos) return false;
        // 过滤海洋区域：排除海里的玩家
        if (!this.isOnLand(pos.lat, pos.lng)) return false;
        return true;
      });

      // 绘制每个玩家的城池标记
      otherPlayers.forEach(player => {
        const pos = this.playerLatLng(player);
        if (!pos) return;

        const lat = pos.lat;
        const lng = pos.lng;

        // 在线玩家用红色脉冲点，离线玩家用灰色点
        const isOnline = player.online;
        
        // 使用 circleMarker：矢量圆形，随地图缩放
        const marker = L.circleMarker([lat, lng], {
          radius: 3.5,  // 半径（会随地图缩放）
          fillColor: isOnline ? '#ff4757' : '#95a5a6',
          fillOpacity: isOnline ? 1 : 0.7,
          color: isOnline ? '#ff4757' : '#95a5a6',
          weight: isOnline ? 1 : 0,
          className: isOnline ? 'online-player-circle' : 'offline-player-circle'
        });

        // 鼠标悬停提示
        marker.bindTooltip(
          `<b>${esc(player.cityName || '未命名城池')}</b><br><small>${esc(player.nickname || '玩家')} · ${isOnline ? '在线' : '离线'}</small>`,
          { direction: 'top', offset: [0, -8], opacity: 0.95 }
        );

        // 点击显示详细信息
        marker.on('click', () => {
          this.showPlayerInfo(player);
        });

        if (this.visible !== false) marker.addTo(map);

        this.markers.push(marker);
      });

      // 添加地图点击事件：点击空白处时查找最近的玩家
      if (!this._mapClickBound) {
        this._mapClickBound = true;
        map.on('click', (e) => {
          this.onMapClick(e);
        });
      }
    },

    /**
     * 地图点击事件处理：查找点击位置最近的玩家
     */
    onMapClick(e) {
      const map = window.WorldMap && window.WorldMap.map;
      if (!map) return;

      // 将点击的经纬度转换为屏幕像素坐标
      const clickPoint = map.latLngToContainerPoint(e.latlng);
      
      let nearestPlayer = null;
      let nearestDistance = Infinity;
      const maxDistance = 50; // 最大距离限制：50像素

      // 遍历所有玩家，找到距离点击位置最近的
      this.players.forEach(player => {
        const pos = this.playerLatLng(player);
        if (!pos) return;

        // 将玩家坐标转换为屏幕像素坐标
        const playerPoint = map.latLngToContainerPoint([pos.lat, pos.lng]);
        
        // 计算像素距离
        const dx = clickPoint.x - playerPoint.x;
        const dy = clickPoint.y - playerPoint.y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        // 更新最近的玩家
        if (distance < nearestDistance && distance <= maxDistance) {
          nearestDistance = distance;
          nearestPlayer = player;
        }
      });

      // 如果找到了足够近的玩家，显示其信息
      if (nearestPlayer) {
        this.showPlayerInfo(nearestPlayer);
      }
    },

    /**
     * 判断坐标是否在陆地上（排除海洋区域）
     * 使用简单的经纬度边界检查
     */
    isOnLand(lat, lng) {
      // 主要陆地区域边界（排除四个海域）
      // 苍梧海（西北）、东溟海（东北）、落星海（西南）、南溟海（东南）
      
      // 苍梧海区域：lat > 35.5, lng < 110.5
      if (lat > 35.5 && lng < 110.5) return false;
      
      // 东溟海区域：lat > 34.5, lng > 114.8
      if (lat > 34.5 && lng > 114.8) return false;
      
      // 落星海区域：lat < 32.5, lng < 111.5
      if (lat < 32.5 && lng < 111.5) return false;
      
      // 南溟海区域：lat < 31.8, lng > 113.5
      if (lat < 31.8 && lng > 113.5) return false;
      
      return true;
    },

    /** 图例筛选：显示 / 隐藏其他玩家标记（world-city.js 的图例复选框调用） */
    setVisible(v) {
      this.visible = !!v;
      const map = window.WorldMap && window.WorldMap.map;
      if (!map) return;
      this.markers.forEach(m => {
        if (this.visible) { if (!map.hasLayer(m)) m.addTo(map); }
        else if (map.hasLayer(m)) map.removeLayer(m);
      });
    },

    /**
     * 本地占用判定：给定坐标附近是否已有其他玩家城池（客户端兜底）。
     * 服务端 /api/city/occupancy 为权威判定，此处仅用于即时提示。
     * @returns {{cityName:string,nickname:string,distance:number}|null}
     */
    isOccupied(lat, lng, minDeg) {
      const min = Number(minDeg) > 0 ? Number(minDeg) : 0.16;
      const myId = window.Auth.user ? window.Auth.user.id : null;
      let hit = null;
      this.players.forEach(p => {
        if (p.userId === myId) return;
        const pos = this.playerLatLng(p);
        if (!pos) return;
        const d = Math.hypot(pos.lat - lat, pos.lng - lng);
        if (Number.isFinite(d) && d <= min && (!hit || d < hit.distance))
          hit = { cityName: p.cityName || '未知城', nickname: p.nickname || '其他玩家', distance: d };
      });
      return hit;
    },

    /** 显示玩家信息面板 - 从右侧滑入 */
    async showPlayerInfo(player) {
      const panel = this.infoPanel;
      if (!panel) return;

      this.currentPeer = player;
      panel.dataset.peerId = player.userId;
      // 本次打开的面板令牌：丢弃过期的异步响应，避免快速切换玩家时串数据
      const token = ++this._hideToken;

      // 显示面板并触发滑入动画
      panel.style.display = 'flex';
      panel.classList.remove('slide-out');
      requestAnimationFrame(() => {
        panel.classList.add('slide-in');
      });

      const title = panel.querySelector('#playerInfoTitle');
      const body = panel.querySelector('#playerInfoBody');

      title.textContent = player.cityName || '玩家城池';
      body.innerHTML = '<p class="loading">加载详细信息…</p>';

      try {
        // 获取玩家城池详情。真实服务端只有 /api/players/:id/city/full（含云存档兜底），
        // 个别玩家可能尚未产生云存档而返回 404，此时用地图列表里的概览数据兜底，
        // 保证信息面板始终可用（否则会出现"点开面板就报加载失败"）。
        let city = {};
        try {
          const r = await api('GET', `/api/players/${player.userId}/city/full`, null, TOKEN());
          city = (r && r.city) || {};
        } catch (e) {
          console.warn('[OnlineMap] 城池详情获取失败，使用列表概览兜底:', e.message);
        }
        if (token !== this._hideToken) return; // 已被新的面板/关闭操作取代

        const info = {
          name: city.name || player.cityName || '未命名',
          level: city.level || player.level || 1,
          population: city.population || 0,
          armyPower: city.armyPower || player.troopCount || 0,
          regionName: city.regionName || city.region || player.region || '未知区域',
          buildings: city.buildings || {}
        };

        // 获取玩家头像ID
        const avatarId = player.avatarId || 1;

        // 渲染信息
        body.innerHTML = `
          <div class="player-avatar-section">
            <img src="assets/avatar-${avatarId}.png" class="player-info-avatar" alt="玩家头像">
          </div>
          <div class="player-info-grid">
            <div class="info-row">
              <span class="info-label">城主</span>
              <span class="info-value">${esc(player.nickname || '未知')}</span>
            </div>
            <div class="info-row">
              <span class="info-label">城池名称</span>
              <span class="info-value">${esc(info.name)}</span>
            </div>
            <div class="info-row">
              <span class="info-label">等级</span>
              <span class="info-value">Lv.${info.level}</span>
            </div>
            <div class="info-row">
              <span class="info-label">人口</span>
              <span class="info-value">${this.formatNumber(info.population)}</span>
            </div>
            <div class="info-row">
              <span class="info-label">兵力</span>
              <span class="info-value">${this.formatNumber(info.armyPower)}</span>
            </div>
            <div class="info-row">
              <span class="info-label">位置</span>
              <span class="info-value">${esc(info.regionName)}</span>
            </div>
            <div class="info-row full-width">
              <span class="info-label">建筑</span>
              <span class="info-value">${this.formatBuildings(info.buildings)}</span>
            </div>
          </div>
          ${player.online ? '<div class="online-badge">在线</div>' : '<div class="offline-badge">离线</div>'}
        `;
      } catch (e) {
        body.innerHTML = `<p class="error">加载失败：${esc(e.message)}</p>`;
      }
    },

    /** 隐藏玩家信息面板 - 滑出 */
    hidePlayerInfo() {
      const panel = this.infoPanel;
      if (!panel) return;

      panel.classList.remove('slide-in');
      panel.classList.add('slide-out');

      // 用令牌保证延迟隐藏不会打断期间新打开的面板/聊天
      const token = ++this._hideToken;
      setTimeout(() => {
        if (token !== this._hideToken) return;
        panel.style.display = 'none';
        // 注意：这里不清空 currentPeer。
        // 之前在此清空会导致点"私聊"后 300ms 当前玩家被置空，
        // 聊天面板随即失效（发不出消息、界面无响应）。
      }, 300);
    },

    /** 打开聊天界面 */
    openChat(player) {
      // 隐藏信息面板
      this.hidePlayerInfo();

      const chatPanel = this.chatPanel;
      if (!chatPanel) return;

      this.currentPeer = player;

      // 更新聊天对象信息
      chatPanel.querySelector('#chatPeerName').textContent = `${player.nickname}（${player.cityName}）`;
      chatPanel.querySelector('#chatPeerStatus').textContent = player.online ? '在线' : '离线';
      chatPanel.querySelector('#chatPeerStatus').className = player.online ? 'peer-status online' : 'peer-status offline';

      // 加载历史消息
      this.loadChatHistory(player.userId);

      // 显示聊天面板并触发滑入动画
      chatPanel.style.display = 'flex';
      chatPanel.classList.remove('slide-out');
      requestAnimationFrame(() => {
        chatPanel.classList.add('slide-in');
      });

      // 聚焦输入框
      setTimeout(() => {
        chatPanel.querySelector('#chatInput').focus();
      }, 350);
    },

    /** 关闭聊天界面 */
    closeChat(fullClose = false) {
      const chatPanel = this.chatPanel;
      if (!chatPanel) return;

      chatPanel.classList.remove('slide-in');
      chatPanel.classList.add('slide-out');

      setTimeout(() => {
        chatPanel.style.display = 'none';

        // 如果不是完全关闭，返回显示信息面板
        if (!fullClose && this.currentPeer) {
          this.showPlayerInfo(this.currentPeer);
        } else {
          this.currentPeer = null;
        }
      }, 300);
    },

    /** 加载聊天历史（走服务端，与其他玩家真实互通） */
    async loadChatHistory(userId) {
      const messagesDiv = this.chatPanel && this.chatPanel.querySelector('#chatMessages');
      if (!messagesDiv) return;

      messagesDiv.innerHTML = '<p class="chat-empty">加载中…</p>';
      try {
        const r = await api('GET', `/api/chat/history?with=${encodeURIComponent(userId)}&limit=60`, null, TOKEN());
        const me = (window.Auth.user && window.Auth.user.id) || '';
        this.chatMessages[userId] = (r.messages || []).map(m => ({
          id: m.id,
          from: m.from === me ? 'me' : 'them',
          text: m.body,
          time: this.fmtTime(m.createdAt)
        }));
      } catch (e) {
        // 加载失败时保留本地缓存，避免把已显示的消息清空
        if (!this.chatMessages[userId]) this.chatMessages[userId] = [];
        if (!this.chatMessages[userId].length) {
          messagesDiv.innerHTML = `<p class="chat-empty">历史消息加载失败：${esc(e.message)}</p>`;
          return;
        }
      }
      this.renderChatMessages(userId);
    },

    /** 渲染聊天消息列表 */
    renderChatMessages(userId) {
      const messagesDiv = this.chatPanel && this.chatPanel.querySelector('#chatMessages');
      if (!messagesDiv) return;
      const history = this.chatMessages[userId] || [];
      if (!history.length) {
        messagesDiv.innerHTML = '<p class="chat-empty">开始聊天...</p>';
        return;
      }
      messagesDiv.innerHTML = history.map(msg => {
        const isMine = msg.from === 'me';
        const state = msg.failed ? '<span class="message-state">发送失败</span>'
          : msg.pending ? '<span class="message-state">发送中…</span>' : '';
        return `
          <div class="chat-message ${isMine ? 'mine' : 'theirs'}">
            <div class="message-bubble">${esc(msg.text)}</div>
            <div class="message-time">${msg.time}${state}</div>
          </div>
        `;
      }).join('');
      messagesDiv.scrollTop = messagesDiv.scrollHeight;
    },

    /** 时间戳格式化为 HH:MM */
    fmtTime(ts) {
      const d = new Date(ts || Date.now());
      if (isNaN(d.getTime())) return '';
      return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}`;
    },

    /** 发送消息（真实调用服务端聊天接口） */
    async sendMessage(userId, text) {
      const list = this.chatMessages[userId] = this.chatMessages[userId] || [];
      list.push({ from: 'me', text, time: this.fmtTime(), pending: true });
      this.renderChatMessages(userId);

      try {
        const r = await api('POST', '/api/chat/send', { to: userId, body: text }, TOKEN());
        const last = list[list.length - 1];
        if (last) { delete last.pending; if (r && r.message && r.message.id) last.id = r.message.id; }
      } catch (e) {
        const last = list[list.length - 1];
        if (last) { delete last.pending; last.failed = true; }
        this.showGameToast('消息发送失败：' + e.message, 'danger');
      }
      this.renderChatMessages(userId);
    },

    /** 收到其他玩家的实时消息（由 social.js 的 SSE 转发而来） */
    onIncomingMessage(m) {
      if (!m || !m.from) return;
      const list = this.chatMessages[m.from] = this.chatMessages[m.from] || [];
      if (m.id && list.some(x => x.id === m.id)) return; // 幂等去重
      list.push({ id: m.id, from: 'them', text: m.body, time: this.fmtTime(m.createdAt) });
      // 仅当聊天面板正对着该玩家时刷新
      if (this.currentPeer && this.currentPeer.userId === m.from &&
          this.chatPanel && this.chatPanel.style.display === 'flex') {
        this.renderChatMessages(m.from);
      }
    },

    /** 发起挑战 */
    async sendChallenge(player) {
      // 检查对方是否在线
      if (!player.online) {
        this.showGameToast(`${player.nickname} 当前不在线，无法发起挑战`, 'warn');
        return;
      }

      // 列表接口只提供概览字段（level / troopCount），没有嵌套的 city 对象，
      // 这里按概览组装，避免对话框里等级/兵力全部显示为 0
      const city = {
        level: player.level || 1,
        population: player.population || 0,
        armyPower: player.troopCount || 0
      };

      // 创建游戏风格的确认对话框
      this.showChallengeDialog(player, city);
    },

    /** 显示挑战确认对话框（游戏风格） */
    showChallengeDialog(player, city) {
      // 创建对话框
      const dialog = document.createElement('div');
      dialog.className = 'game-dialog-overlay';
      dialog.innerHTML = `
        <div class="game-dialog challenge-dialog">
          <div class="dialog-header">
            <h3>⚔️ 发起挑战</h3>
          </div>
          <div class="dialog-body">
            <div class="challenge-target">
              <div class="target-avatar">👤</div>
              <div class="target-info">
                <div class="target-name">${this.esc(player.nickname)}</div>
                <div class="target-city">${this.esc(player.cityName)}</div>
              </div>
            </div>
            <div class="challenge-stats">
              <div class="stat-row">
                <span class="stat-label">城池等级</span>
                <span class="stat-value">Lv.${city.level || 1}</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">人口数量</span>
                <span class="stat-value">${this.formatNumber(city.population || 0)}</span>
              </div>
              <div class="stat-row">
                <span class="stat-label">兵力</span>
                <span class="stat-value danger">${this.formatNumber(city.armyPower || 0)}</span>
              </div>
            </div>
            <p class="challenge-warning">⚠️ 挑战失败可能损失兵力和资源</p>
          </div>
          <div class="dialog-footer">
            <button type="button" class="game-btn btn-cancel" data-action="cancel">取消</button>
            <button type="button" class="game-btn btn-confirm" data-action="confirm">确认挑战</button>
          </div>
        </div>
      `;

      document.body.appendChild(dialog);

      // 绑定事件
      dialog.addEventListener('click', (e) => {
        const action = e.target.dataset.action;
        if (action === 'cancel' || e.target === dialog) {
          dialog.remove();
        } else if (action === 'confirm') {
          dialog.remove();
          this.confirmChallenge(player);
        }
      });
    },

    /** 确认发起挑战 */
    async confirmChallenge(player) {
      this.hidePlayerInfo();

      try {
        // 这里应该调用真实的挑战 API
        // const r = await api('POST', '/api/battle/challenge', { targetUserId: player.userId }, TOKEN());

        console.log('[OnlineMap] 发起挑战:', { to: player.userId, player });

        this.showGameToast(`挑战请求已发送给 ${player.nickname}！`, 'success');

        // 模拟对方响应（测试用）
        setTimeout(() => {
          const accept = Math.random() > 0.5;
          if (accept) {
            this.showGameToast(`${player.nickname} 接受了你的挑战！`, 'success');
          } else {
            this.showGameToast(`${player.nickname} 拒绝了挑战`, 'warn');
          }
        }, 3000);
      } catch (e) {
        this.showGameToast('发起挑战失败：' + e.message, 'danger');
      }
    },

    /** 显示游戏风格的提示消息 */
    showGameToast(message, type = 'info') {
      // 尝试使用游戏的 showStatus 方法
      const G = window.Game;
      if (G && G.showStatus) {
        G.showStatus(message, type);
        return;
      }

      // 降级方案：创建自定义 toast
      const toast = document.createElement('div');
      toast.className = `game-toast toast-${type}`;
      toast.textContent = message;
      document.body.appendChild(toast);

      // 触发显示动画
      requestAnimationFrame(() => {
        toast.classList.add('show');
      });

      // 3秒后移除
      setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
      }, 3000);
    },

    /** HTML 转义 */
    esc(str) {
      return String(str == null ? '' : str).replace(/[&<>"']/g, c =>
        ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
      );
    },

    /** 进入参观玩家城池 */
    async visitPlayerCity(userId) {
      const G = window.Game;
      this.hidePlayerInfo();

      if (!G || !G.state) {
        console.warn('[OnlineMap] 游戏主体未就绪，无法参观');
        this.showGameToast('游戏尚未就绪，请稍后再试', 'warn');
        return;
      }

      try {
        // 优先取完整城池（云存档）。部分玩家尚未产生云存档，接口会返回 404，
        // 此时用地图列表里的概览构造只读预览，保证"任意玩家"都能参观并正常返回，
        // 而不是直接报「无法参观该城池」。
        let city = null;
        try {
          const r = await api('GET', `/api/players/${userId}/city/full`, null, TOKEN());
          city = r && r.city;
        } catch (e) {
          const p = this.players.find(x => x.userId === userId) || {};
          city = { name: p.cityName || '未知城池', level: p.level || 1, region: p.region || '' };
          this.showGameToast('该玩家暂无完整城池存档，展示基础预览', 'warn');
        }
        if (!city || typeof city !== 'object') throw new Error('对方城池数据不可用');

        // 通过 Game 统一入口暂存自己的城池（只存内存、不写存档），
        // 入口内部会归一化补齐缺失字段，避免他城数据不完整导致主循环抛错、场景不渲染
        if (typeof G.enterPreviewCity === 'function') {
          if (!G.enterPreviewCity(city)) throw new Error('对方城池数据不可用');
        } else {
          if (!this._originalCity) this._originalCity = G.state.city;
          G.state.city = { ...city, readonly: true, preview: true };
        }
        G.switchScene('city');

        // 添加返回按钮（延迟到场景切换完成后）
        setTimeout(() => {
          const oldBtn = document.querySelector('.preview-return-btn');
          if (oldBtn) oldBtn.remove();

          const returnBtn = document.createElement('button');
          returnBtn.className = 'preview-return-btn';
          returnBtn.textContent = '← 返回我的城池';
          returnBtn.onclick = () => this.exitVisit(G);
          const stage = document.getElementById('stage');
          if (stage) stage.appendChild(returnBtn);
        }, 500);
      } catch (e) {
        // 进入失败时必须还原城池数据，防止半途残留他城数据
        this.releasePreview(G);
        if (G.showStatus) G.showStatus('无法参观该城池：' + e.message, 'danger');
        else console.warn('[OnlineMap] 参观失败:', e.message);
      }
    },

    /** 退出参观：还原自己的城池，并回到自己的城池视图（尚未建城则回世界地图） */
    exitVisit(G) {
      const game = G || window.Game;
      this.releasePreview(game);
      const btn = document.querySelector('.preview-return-btn');
      if (btn) btn.remove();
      if (!game || !game.switchScene) return;
      const ownsCity = !!(game.state && game.state.city && game.state.city.mapPosition);
      game.switchScene(ownsCity ? 'city' : 'world');
    },

    /** 释放参观预览状态（优先走 Game 统一入口，兜底旧字段） */
    releasePreview(G) {
      const game = G || window.Game;
      if (game && typeof game.exitPreviewCity === 'function') {
        game.exitPreviewCity();
      } else if (this._originalCity && game) {
        game.state.city = this._originalCity;
        this._originalCity = null;
      }
      const btn = document.querySelector('.preview-return-btn');
      if (btn) btn.remove();
    },

    /** 启动自动刷新（每 30 秒刷新一次在线玩家） */
    startAutoRefresh() {
      this.stopAutoRefresh();
      this.refreshTimer = setInterval(() => {
        if (isReady()) this.fetchOnlinePlayers();
      }, 30000);
    },

    /** 停止自动刷新 */
    stopAutoRefresh() {
      if (this.refreshTimer) {
        clearInterval(this.refreshTimer);
        this.refreshTimer = 0;
      }
    },

    /** 格式化数字 */
    formatNumber(n) {
      if (n >= 10000) return Math.floor(n / 10000) + '万';
      if (n >= 1000) return (n / 1000).toFixed(1) + '千';
      return n.toString();
    },

    /** 格式化建筑列表 */
    formatBuildings(buildings) {
      // 键名为游戏内真实建筑 key；同时保留旧版/mock 的命名以兼容历史数据
      const names = {
        hall: '城镇中心',
        farm: '农场',
        mine: '矿场',
        lumber: '伐木场',
        bank: '金库',
        barracks: '兵营',
        wall: '城墙',
        townHall: '城镇中心',
        quarry: '采石场',
        lumberMill: '伐木场',
        goldMine: '金矿',
        stable: '马厩',
        archeryRange: '射箭场',
        warehouse: '仓库'
      };
      const list = Object.entries(buildings)
        .filter(([k, v]) => v && v.level > 0)
        .map(([k, v]) => `${names[k] || k} Lv.${v.level}`)
        .slice(0, 6);
      return list.length ? list.join('、') : '暂无';
    },

    /** 销毁（登出时调用） */
    destroy() {
      this.stopAutoRefresh();
      this.hidePlayerInfo();
      if (this.chatPanel) {
        this.chatPanel.style.display = 'none';
      }

      // 清除地图标记
      if (window.WorldMap && window.WorldMap.map) {
        this.markers.forEach(m => window.WorldMap.map.removeLayer(m));
      }
      this.markers = [];
      this.players = [];
      this.currentPeer = null;
      this.chatMessages = {};
      // 退出登录时若还在参观预览中，必须还原自己的城池数据
      this.releasePreview();
    }
  };

  // cities.html 的场景切换等逻辑按 window.OnlineMap 访问本模块，这里补上别名
  window.OnlineMap = OnlineMap;
  window.OnlineMapV2 = OnlineMap;
})();
