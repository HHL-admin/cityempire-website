/**
 * 好友系统 - 前端逻辑
 */

class FriendsManager {
  constructor() {
    this.friends = [];
    this.pendingRequests = [];
    this.currentTab = 'friends';
    this.searchResults = [];
    this.init();
  }

  init() {
    this.createUI();
    this.bindEvents();
    // 监听好友相关的推送事件
    if (window.EventStream) {
      window.EventStream.on('friend', (data) => this.handleFriendEvent(data));
    }
  }

  createUI() {
    // 创建遮罩层
    const overlay = document.createElement('div');
    overlay.className = 'friends-overlay';
    overlay.id = 'friends-overlay';
    document.body.appendChild(overlay);

    // 创建好友面板
    const panel = document.createElement('div');
    panel.className = 'friends-panel';
    panel.id = 'friends-panel';
    panel.innerHTML = `
      <div class="friends-header">
        <h2 class="friends-title">好友</h2>
        <button class="friends-close" id="friends-close">×</button>
      </div>
      <div class="friends-tabs">
        <button class="friends-tab active" data-tab="friends">
          我的好友
        </button>
        <button class="friends-tab" data-tab="requests">
          好友请求 <span class="badge" id="requests-badge" style="display:none;">0</span>
        </button>
        <button class="friends-tab" data-tab="search">
          搜索好友
        </button>
      </div>
      <div class="friends-search" id="friends-search">
        <input type="text" class="friends-search-input" id="friends-search-input" placeholder="搜索用户名或昵称...">
      </div>
      <div class="friends-content" id="friends-content"></div>
    `;
    document.body.appendChild(panel);
  }

  bindEvents() {
    // 关闭按钮
    document.getElementById('friends-close').addEventListener('click', () => this.hide());
    document.getElementById('friends-overlay').addEventListener('click', () => this.hide());

    // 标签页切换
    document.querySelectorAll('.friends-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;
        this.switchTab(tabName);
      });
    });

    // 搜索输入
    const searchInput = document.getElementById('friends-search-input');
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      const keyword = e.target.value.trim();
      if (keyword.length >= 1) {
        searchTimeout = setTimeout(() => this.searchUsers(keyword), 500);
      } else {
        this.searchResults = [];
        this.renderSearch();
      }
    });
  }

  show() {
    document.getElementById('friends-overlay').classList.add('visible');
    document.getElementById('friends-panel').classList.add('visible');
    this.loadFriends();
  }

  hide() {
    document.getElementById('friends-overlay').classList.remove('visible');
    document.getElementById('friends-panel').classList.remove('visible');
  }

  switchTab(tabName) {
    this.currentTab = tabName;
    
    // 更新标签页样式
    document.querySelectorAll('.friends-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // 显示/隐藏搜索框
    const searchBox = document.getElementById('friends-search');
    if (tabName === 'search') {
      searchBox.classList.add('visible');
      document.getElementById('friends-search-input').focus();
    } else {
      searchBox.classList.remove('visible');
    }

    // 渲染对应内容
    if (tabName === 'friends') {
      this.renderFriends();
    } else if (tabName === 'requests') {
      this.renderRequests();
    } else if (tabName === 'search') {
      this.renderSearch();
    }
  }

  // 获取token的辅助函数
  getToken() {
    // 从ce_session中获取token
    try {
      const session = JSON.parse(localStorage.getItem('ce_session'));
      return session?.token || null;
    } catch {
      return null;
    }
  }

  async loadFriends() {
    try {
      const token = this.getToken();
      if (!token) {
        console.warn('[Friends] 未登录');
        return;
      }
      
      const res = await fetch('/api/friends/list', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!res.ok) throw new Error('加载好友列表失败');
      
      const data = await res.json();
      this.friends = data.friends || [];
      this.pendingRequests = data.pendingRequests || [];
      
      // 更新待处理请求徽章
      const badge = document.getElementById('requests-badge');
      if (this.pendingRequests.length > 0) {
        badge.textContent = this.pendingRequests.length;
        badge.style.display = 'inline-block';
      } else {
        badge.style.display = 'none';
      }
      
      this.switchTab(this.currentTab);
    } catch (err) {
      console.error('[Friends] 加载好友列表失败:', err);
      this.showError('加载好友列表失败');
    }
  }

  renderFriends() {
    const content = document.getElementById('friends-content');
    
    if (this.friends.length === 0) {
      content.innerHTML = `
        <div class="friends-empty">
          <div class="friends-empty-icon">👥</div>
          <div class="friends-empty-text">还没有好友</div>
          <div class="friends-empty-hint">点击"搜索好友"添加你的第一个好友</div>
        </div>
      `;
      return;
    }

    content.innerHTML = this.friends.map(friend => `
      <div class="friend-item">
        <img src="${friend.avatar || 'assets/default-avatar.png'}" class="friend-avatar" alt="${friend.nickname}">
        <div class="friend-info">
          <div class="friend-name">
            ${friend.nickname}
            <span class="friend-status-dot ${friend.online ? 'online' : ''}"></span>
          </div>
          <div class="friend-details">
            ${friend.cityName || '未建城'} · Lv.${friend.level}
          </div>
        </div>
        <div class="friend-actions">
          <button class="friend-btn" onclick="FriendsManager.instance.chatWith('${friend.userId}')">私聊</button>
          <button class="friend-btn danger" onclick="FriendsManager.instance.removeFriend('${friend.userId}')">删除</button>
        </div>
      </div>
    `).join('');
  }

  renderRequests() {
    const content = document.getElementById('friends-content');
    
    if (this.pendingRequests.length === 0) {
      content.innerHTML = `
        <div class="friends-empty">
          <div class="friends-empty-icon">✉️</div>
          <div class="friends-empty-text">没有待处理的好友请求</div>
        </div>
      `;
      return;
    }

    content.innerHTML = this.pendingRequests.map(req => `
      <div class="friend-item">
        <img src="${req.avatar || 'assets/default-avatar.png'}" class="friend-avatar" alt="${req.nickname}">
        <div class="friend-info">
          <div class="friend-name">${req.nickname}</div>
          <div class="friend-details">
            ${req.cityName || '未建城'} · Lv.${req.level}
          </div>
        </div>
        <div class="friend-actions">
          <button class="friend-btn primary" onclick="FriendsManager.instance.acceptFriend('${req.userId}')">接受</button>
          <button class="friend-btn danger" onclick="FriendsManager.instance.rejectFriend('${req.userId}')">拒绝</button>
        </div>
      </div>
    `).join('');
  }

  renderSearch() {
    const content = document.getElementById('friends-content');
    
    if (this.searchResults.length === 0) {
      content.innerHTML = `
        <div class="friends-empty">
          <div class="friends-empty-icon">🔍</div>
          <div class="friends-empty-text">输入用户名或昵称搜索</div>
          <div class="friends-empty-hint">至少输入2个字符</div>
        </div>
      `;
      return;
    }

    content.innerHTML = this.searchResults.map(user => {
      let actionButton = '';
      if (user.friendStatus === 'accepted') {
        actionButton = '<span class="friend-btn" style="opacity: 0.5; cursor: default;">已是好友</span>';
      } else if (user.friendStatus === 'pending') {
        actionButton = '<span class="friend-btn" style="opacity: 0.5; cursor: default;">已发送请求</span>';
      } else {
        actionButton = `<button class="friend-btn primary" onclick="FriendsManager.instance.addFriend('${user.userId}')">添加好友</button>`;
      }
      
      return `
        <div class="friend-item">
          <img src="${user.avatar || 'assets/default-avatar.png'}" class="friend-avatar" alt="${user.nickname}">
          <div class="friend-info">
            <div class="friend-name">
              ${user.nickname}
              <span class="friend-status-dot ${user.online ? 'online' : ''}"></span>
            </div>
            <div class="friend-details">
              ${user.cityName || '未建城'} · Lv.${user.level}
            </div>
          </div>
          <div class="friend-actions">
            ${actionButton}
          </div>
        </div>
      `;
    }).join('');
  }

  async searchUsers(keyword) {
    try {
      const token = this.getToken();
      if (!token) {
        this.showError('未登录，请刷新页面重新登录');
        return;
      }
      
      const res = await fetch(`/api/friends/search?q=${encodeURIComponent(keyword)}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        const errorMsg = errorData.message || '搜索失败';
        if (res.status === 401) {
          this.showError('登录已过期，请刷新页面重新登录');
        } else {
          this.showError(errorMsg);
        }
        console.error('[Friends] 搜索失败:', res.status, errorData);
        return;
      }
      
      const data = await res.json();
      this.searchResults = data.users || [];
      this.renderSearch();
    } catch (err) {
      console.error('[Friends] 搜索失败:', err);
      this.showError('搜索失败，请检查网络连接');
    }
  }

  async addFriend(userId) {
    try {
      const token = this.getToken();
      const res = await fetch('/api/friends/add', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ targetId: userId })
      });
      
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || '添加好友失败');
      }
      
      const data = await res.json();
      this.showSuccess(data.message || '好友请求已发送');
      
      // 如果直接成为好友（对方也发了请求），刷新列表
      if (data.status === 'accepted') {
        this.loadFriends();
      } else {
        // 更新搜索结果中的状态
        const user = this.searchResults.find(u => u.userId === userId);
        if (user) user.friendStatus = 'pending';
        this.renderSearch();
      }
    } catch (err) {
      console.error('[Friends] 添加好友失败:', err);
      this.showError(err.message);
    }
  }

  async acceptFriend(userId) {
    try {
      const token = this.getToken();
      const res = await fetch('/api/friends/accept', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ targetId: userId })
      });
      
      if (!res.ok) throw new Error('接受好友失败');
      
      this.showSuccess('已成为好友');
      this.loadFriends();
    } catch (err) {
      console.error('[Friends] 接受好友失败:', err);
      this.showError('接受好友失败');
    }
  }

  async rejectFriend(userId) {
    try {
      const token = this.getToken();
      const res = await fetch('/api/friends/reject', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ targetId: userId })
      });
      
      if (!res.ok) throw new Error('拒绝好友失败');
      
      this.showSuccess('已拒绝好友请求');
      this.loadFriends();
    } catch (err) {
      console.error('[Friends] 拒绝好友失败:', err);
      this.showError('拒绝好友失败');
    }
  }

  async removeFriend(userId) {
    if (!confirm('确定要删除这个好友吗？')) return;
    
    try {
      const token = localStorage.getItem('auth-token');
      const res = await fetch('/api/friends/remove', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ targetId: userId })
      });
      
      if (!res.ok) throw new Error('删除好友失败');
      
      this.showSuccess('已删除好友');
      this.loadFriends();
    } catch (err) {
      console.error('[Friends] 删除好友失败:', err);
      this.showError('删除好友失败');
    }
  }

  chatWith(userId) {
    // 查找好友信息
    const friend = this.friends.find(f => f.userId === userId);
    if (!friend) {
      this.showError('找不到该好友');
      return;
    }
    
    console.log('[Friends] 打开聊天窗口，userId:', userId, 'friend:', friend);
    console.log('[Friends] window.Social:', window.Social);
    console.log('[Friends] Social.openPanel:', typeof window.Social?.openPanel);
    console.log('[Friends] Social.openChat:', typeof window.Social?.openChat);
    
    // 关闭好友面板
    this.hide();
    
    // 打开社交面板的聊天标签
    if (window.Social && typeof window.Social.openPanel === 'function') {
      console.log('[Friends] 调用 Social.openPanel("chat")');
      window.Social.openPanel('chat');
      
      // 延迟一下确保面板已打开，再打开指定用户的对话，并传入好友信息
      setTimeout(() => {
        console.log('[Friends] 延迟后，准备调用 openChat');
        if (typeof window.Social.openChat === 'function') {
          console.log('[Friends] 调用 Social.openChat，userId:', userId);
          window.Social.openChat(userId, {
            nickname: friend.nickname,
            online: friend.online
          });
        } else {
          console.error('[Friends] Social.openChat 不是函数！');
        }
      }, 100);
    } else {
      console.error('[Friends] Social 模块未加载');
      this.showError('聊天系统未加载，请刷新页面重试');
    }
  }

  handleFriendEvent(data) {
    console.log('[Friends] 收到好友事件:', data);
    
    if (data.action === 'request') {
      // 收到好友请求
      this.showSuccess(`${data.nickname} 向你发送了好友请求`);
      this.loadFriends();
    } else if (data.action === 'accepted') {
      // 好友请求被接受
      this.showSuccess(`${data.nickname} 接受了你的好友请求`);
      this.loadFriends();
    } else if (data.action === 'rejected') {
      // 好友请求被拒绝
      this.loadFriends();
    } else if (data.action === 'removed') {
      // 被删除好友
      this.showSuccess('好友关系已解除');
      this.loadFriends();
    }
  }

  showSuccess(message) {
    // 简单的提示消息（可以用更好的UI组件替代）
    if (window.showMessage) {
      window.showMessage(message, 'success');
    } else {
      alert(message);
    }
  }

  showError(message) {
    if (window.showMessage) {
      window.showMessage(message, 'error');
    } else {
      alert(message);
    }
  }
}

// 创建全局实例
FriendsManager.instance = null;

// 初始化
document.addEventListener('DOMContentLoaded', () => {
  FriendsManager.instance = new FriendsManager();
});

// 全局函数：打开好友面板
function openFriendsPanel() {
  if (FriendsManager.instance) {
    FriendsManager.instance.show();
  }
}
