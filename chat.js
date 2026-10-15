/**
 * 聊天系统管理器
 */
class ChatManager {
  constructor() {
    this.currentChatUser = null;
    this.friends = [];
    this.messages = [];
    this.isOpen = false;
    this.init();
  }

  // 获取token的辅助函数
  getToken() {
    try {
      const session = JSON.parse(localStorage.getItem('ce_session'));
      return session?.token || null;
    } catch {
      return null;
    }
  }

  init() {
    this.createUI();
    this.bindEvents();
    
    // 监听聊天消息推送
    if (window.EventStream) {
      window.EventStream.on('chat', (data) => this.handleChatEvent(data));
    }
  }

  createUI() {
    const html = `
      <div class="chat-window" id="chatWindow">
        <!-- 左侧好友列表 -->
        <div class="chat-sidebar">
          <div class="chat-sidebar-header">
            <div class="chat-sidebar-title">好友列表</div>
          </div>
          <div class="chat-friends-list" id="chatFriendsList">
            <div class="chat-friends-empty">
              <div class="chat-friends-empty-icon">👥</div>
              <div class="chat-friends-empty-text">加载中...</div>
            </div>
          </div>
        </div>
        
        <!-- 右侧聊天内容 -->
        <div class="chat-content">
          <div class="chat-header">
            <div class="chat-header-left">
              <img class="chat-user-avatar" id="chatUserAvatar" src="" alt="">
              <div class="chat-user-info">
                <div class="chat-user-name" id="chatUserName">选择好友开始聊天</div>
                <div class="chat-user-status">
                  <span class="chat-status-dot" id="chatStatusDot"></span>
                  <span id="chatStatusText">离线</span>
                </div>
              </div>
            </div>
            <button class="chat-close-btn" id="chatCloseBtn" type="button">×</button>
          </div>
          
          <div class="chat-messages" id="chatMessages">
            <div class="chat-empty">
              <div class="chat-empty-icon">💬</div>
              <div class="chat-empty-text">选择一个好友<br>开始你的对话吧</div>
            </div>
          </div>
          
          <div class="chat-input-area">
            <textarea 
              class="chat-input" 
              id="chatInput" 
              placeholder="输入消息..."
              rows="1"
            ></textarea>
            <button class="chat-send-btn" id="chatSendBtn" type="button">发送</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', html);
  }

  bindEvents() {
    const chatWindow = document.getElementById('chatWindow');
    const closeBtn = document.getElementById('chatCloseBtn');
    const sendBtn = document.getElementById('chatSendBtn');
    const input = document.getElementById('chatInput');

    // 点击关闭按钮
    closeBtn.addEventListener('click', () => this.close());

    // 发送按钮
    sendBtn.addEventListener('click', () => this.sendMessage());

    // 输入框回车发送
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });

    // 自动调整输入框高度
    input.addEventListener('input', () => {
      input.style.height = 'auto';
      input.style.height = Math.min(input.scrollHeight, 100) + 'px';
    });
  }

  async open(userId, userInfo) {
    console.log('[Chat] open() 被调用，userId:', userId, 'userInfo:', userInfo);
    
    // 显示窗口
    const chatWindow = document.getElementById('chatWindow');
    console.log('[Chat] chatWindow 元素:', chatWindow);
    
    if (!chatWindow) {
      console.error('[Chat] chatWindow 元素不存在！');
      alert('聊天窗口加载失败，请刷新页面重试');
      return;
    }
    
    chatWindow.classList.add('visible');
    console.log('[Chat] 已添加 visible 类');
    this.isOpen = true;

    // 加载好友列表
    console.log('[Chat] 开始加载好友列表...');
    await this.loadFriends();

    // 如果指定了用户，打开聊天
    if (userId && userInfo) {
      console.log('[Chat] 切换到指定用户的聊天');
      this.switchChat(userId, userInfo);
    }
  }

  close() {
    this.isOpen = false;
    this.currentChatUser = null;
    document.getElementById('chatWindow').classList.remove('visible');
    document.getElementById('chatInput').value = '';
  }

  async loadFriends() {
    const friendsListContainer = document.getElementById('chatFriendsList');
    friendsListContainer.innerHTML = '<div class="chat-loading">加载好友列表...</div>';
    
    try {
      const token = this.getToken();
      const res = await fetch('/api/friends/list', {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) {
        throw new Error('加载好友列表失败');
      }

      const data = await res.json();
      this.friends = data.friends || [];
      this.renderFriends();
    } catch (err) {
      console.error('加载好友列表失败:', err);
      friendsListContainer.innerHTML = `
        <div class="chat-friends-empty">
          <div class="chat-friends-empty-icon">⚠️</div>
          <div class="chat-friends-empty-text">加载失败<br>${err.message}</div>
        </div>
      `;
    }
  }

  renderFriends() {
    const friendsListContainer = document.getElementById('chatFriendsList');
    
    if (this.friends.length === 0) {
      friendsListContainer.innerHTML = `
        <div class="chat-friends-empty">
          <div class="chat-friends-empty-icon">👥</div>
          <div class="chat-friends-empty-text">暂无好友<br>快去添加好友吧</div>
        </div>
      `;
      return;
    }

    const html = this.friends.map(friend => {
      const isActive = this.currentChatUser && this.currentChatUser.userId === friend.userId;
      const statusText = friend.online ? '在线' : '离线';
      const cityInfo = friend.cityName ? `${friend.cityName} Lv${friend.level}` : `Lv${friend.level}`;
      
      return `
        <div class="chat-friend-item ${isActive ? 'active' : ''}" data-user-id="${friend.userId}">
          <div class="chat-friend-avatar-wrapper">
            <img class="chat-friend-avatar" src="${friend.avatar || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>'}" alt="">
            <div class="chat-friend-online-dot ${friend.online ? 'online' : ''}"></div>
          </div>
          <div class="chat-friend-info">
            <div class="chat-friend-name">${this.escapeHtml(friend.nickname)}</div>
            <div class="chat-friend-status">${cityInfo} · ${statusText}</div>
          </div>
        </div>
      `;
    }).join('');

    friendsListContainer.innerHTML = html;

    // 绑定点击事件
    friendsListContainer.querySelectorAll('.chat-friend-item').forEach(item => {
      item.addEventListener('click', () => {
        const userId = item.dataset.userId;
        const friend = this.friends.find(f => f.userId === userId);
        if (friend) {
          this.switchChat(userId, friend);
        }
      });
    });
  }

  async switchChat(userId, userInfo) {
    this.currentChatUser = { userId, ...userInfo };
    this.messages = [];

    // 更新头部信息
    document.getElementById('chatUserAvatar').src = userInfo.avatar || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
    document.getElementById('chatUserName').textContent = userInfo.nickname || '未知';
    
    const statusDot = document.getElementById('chatStatusDot');
    const statusText = document.getElementById('chatStatusText');
    if (userInfo.online) {
      statusDot.classList.add('online');
      statusText.textContent = '在线';
    } else {
      statusDot.classList.remove('online');
      statusText.textContent = '离线';
    }

    // 更新好友列表高亮
    this.renderFriends();

    // 加载聊天记录
    await this.loadHistory();

    // 聚焦输入框
    document.getElementById('chatInput').focus();
  }

  async loadHistory() {
    if (!this.currentChatUser) return;

    const messagesContainer = document.getElementById('chatMessages');
    messagesContainer.innerHTML = '<div class="chat-loading">加载中...</div>';

    try {
      const token = this.getToken();
      const res = await fetch(`/api/chat/history?with=${this.currentChatUser.userId}&limit=50`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });

      if (!res.ok) {
        throw new Error('加载聊天记录失败');
      }

      const data = await res.json();
      console.log('[Chat] 后端返回的原始消息数据:', data.messages);
      this.messages = (data.messages || []).map(msg => {
        console.log('[Chat] 处理消息:', msg);
        // 后端实际返回的字段是 from 和 to，不是 from_user/to_user
        const fromUserId = Number(msg.from);
        const toUserId = Number(msg.to);
        console.log('[Chat] 提取的ID - from:', msg.from, '→', fromUserId, ', to:', msg.to, '→', toUserId);
        return {
          id: msg.id,
          fromUserId: fromUserId,
          toUserId: toUserId,
          content: msg.body,
          createdAt: msg.createdAt,
          isRead: msg.readAt != null
        };
      });

      this.renderMessages();

      // 标记为已读
      await this.markAsRead();
    } catch (err) {
      console.error('加载聊天记录失败:', err);
      messagesContainer.innerHTML = `
        <div class="chat-empty">
          <div class="chat-empty-icon">⚠️</div>
          <div class="chat-empty-text">加载失败<br>${err.message}</div>
        </div>
      `;
    }
  }

  renderMessages() {
    const messagesContainer = document.getElementById('chatMessages');
    
    if (this.messages.length === 0) {
      messagesContainer.innerHTML = `
        <div class="chat-empty">
          <div class="chat-empty-icon">💬</div>
          <div class="chat-empty-text">暂无消息<br>开始你的第一条对话吧</div>
        </div>
      `;
      return;
    }

    const currentUserId = this.getCurrentUserId();
    console.log('[Chat] renderMessages - currentUserId:', currentUserId, 'type:', typeof currentUserId);
    console.log('[Chat] renderMessages - messages:', this.messages);
    
    const html = this.messages.map(msg => {
      // 关键修复：统一转换为数字类型进行比较
      const msgFromUserId = Number(msg.fromUserId);
      const currentUserIdNum = Number(currentUserId);
      const isSent = msgFromUserId === currentUserIdNum;
      
      console.log('[Chat] 消息:', msg.content);
      console.log('  - fromUserId:', msg.fromUserId, '(转换后:', msgFromUserId, ')');
      console.log('  - currentUserId:', currentUserId, '(转换后:', currentUserIdNum, ')');
      console.log('  - isSent:', isSent, '(我发送的消息应该在右边)');
      
      const time = new Date(msg.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
      const avatar = isSent 
        ? (this.getCurrentUserAvatar() || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>') 
        : (this.currentChatUser.avatar || 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>');

      return `
        <div class="chat-message ${isSent ? 'sent' : 'received'}">
          <img class="chat-message-avatar" src="${avatar}" alt="">
          <div class="chat-message-bubble">
            <div class="chat-message-content">${this.escapeHtml(msg.content)}</div>
            <div class="chat-message-time">${time}</div>
          </div>
        </div>
      `;
    }).join('');

    messagesContainer.innerHTML = html;
    
    // 滚动到底部
    this.scrollToBottom();
  }

  scrollToBottom() {
    const messagesContainer = document.getElementById('chatMessages');
    setTimeout(() => {
      messagesContainer.scrollTop = messagesContainer.scrollHeight;
    }, 100);
  }

  async sendMessage() {
    if (!this.currentChatUser) {
      this.showError('请先选择聊天对象');
      return;
    }

    const input = document.getElementById('chatInput');
    const content = input.value.trim();

    if (!content) return;

    if (content.length > 500) {
      this.showError('消息内容不能超过500字符');
      return;
    }

    const sendBtn = document.getElementById('chatSendBtn');
    sendBtn.disabled = true;

    try {
      const token = this.getToken();
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          to: this.currentChatUser.userId,
          body: content
        })
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || '发送失败');
      }

      const data = await res.json();
      
      // 添加到消息列表
      const newMessage = {
        id: data.message?.id || Date.now(),
        fromUserId: this.getCurrentUserId(),
        toUserId: Number(this.currentChatUser.userId),
        content,
        createdAt: Date.now(),
        isRead: false
      };

      this.messages.push(newMessage);
      this.renderMessages();

      // 清空输入框
      input.value = '';
      input.style.height = 'auto';
      input.focus();

    } catch (err) {
      console.error('发送消息失败:', err);
      this.showError(err.message || '发送失败');
    } finally {
      sendBtn.disabled = false;
    }
  }

  async markAsRead() {
    if (!this.currentChatUser) return;

    try {
      const token = this.getToken();
      await fetch('/api/chat/read', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          with: this.currentChatUser.userId
        })
      });
    } catch (err) {
      console.error('标记已读失败:', err);
    }
  }

  handleChatEvent(data) {
    if (!data) return;

    // 兼容旧的消息推送格式
    if (data.action === 'new_message') {
      const fromUserId = Number(data.fromUserId || data.from);
      
      // 如果正在和发送者聊天，添加消息
      if (this.isOpen && this.currentChatUser && Number(this.currentChatUser.userId) === fromUserId) {
        const newMessage = {
          id: data.id || Date.now(),
          fromUserId: fromUserId,
          toUserId: this.getCurrentUserId(),
          content: data.content || data.body,
          createdAt: data.createdAt || data.created_at || Date.now(),
          isRead: false
        };

        this.messages.push(newMessage);
        this.renderMessages();

        // 标记为已读
        this.markAsRead();
      } else {
        // 显示通知（可以在这里添加未读消息提示）
        console.log('收到新消息:', data);
      }
    }
  }

  getCurrentUserId() {
    // 从 ce_session 获取当前用户ID
    try {
      const session = JSON.parse(localStorage.getItem('ce_session'));
      console.log('[Chat] getCurrentUserId - 完整session:', session);
      
      // session 的结构是 { user: { id: "..." }, token: "..." }
      const userId = session?.user?.id;
      console.log('[Chat] getCurrentUserId - 提取的userId:', userId, 'type:', typeof userId);
      
      const result = userId ? Number(userId) : null;
      console.log('[Chat] getCurrentUserId - 最终返回:', result, 'type:', typeof result);
      return result;
    } catch (e) {
      console.error('[Chat] getCurrentUserId - 解析失败:', e);
      return null;
    }
  }

  getCurrentUserAvatar() {
    // 尝试从全局状态获取当前用户头像
    if (window.currentUser && window.currentUser.avatar) {
      return window.currentUser.avatar;
    }
    return null;
  }

  escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showError(message) {
    // 简单的错误提示
    alert(message);
  }
}

// 全局实例
ChatManager.instance = null;

document.addEventListener('DOMContentLoaded', () => {
  ChatManager.instance = new ChatManager();
  console.log('[Chat] ChatManager initialized');
});

// 全局函数：打开聊天窗口
window.openChat = function(userId, userInfo) {
  console.log('[Chat] openChat called:', userId, userInfo);
  
  if (!ChatManager.instance) {
    console.warn('[Chat] ChatManager not initialized yet, creating instance...');
    ChatManager.instance = new ChatManager();
  }
  
  if (ChatManager.instance) {
    ChatManager.instance.open(userId, userInfo);
  } else {
    console.error('[Chat] Failed to create ChatManager instance');
    alert('聊天系统加载失败，请刷新页面重试');
  }
};
