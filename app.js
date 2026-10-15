// 智能客服功能
const chatBtn = document.getElementById('ai-chat-btn');
const chatModal = document.getElementById('ai-chat-modal');
const closeBtn = document.getElementById('close-chat');
const chatMessages = document.getElementById('chat-messages');
const chatInput = document.getElementById('chat-input');
const sendBtn = document.getElementById('send-btn');

// API配置
const API_URL = 'http://150.158.119.206:3000/api/chat';

// 打开/关闭聊天窗口
chatBtn.addEventListener('click', () => {
  chatModal.classList.toggle('active');
  if (chatModal.classList.contains('active')) {
    chatInput.focus();
    // 首次打开显示欢迎消息
    if (chatMessages.children.length === 0) {
      addMessage('ai', '你好！我是城池帝国的智能客服，有什么可以帮助你的吗？');
    }
  }
});

closeBtn.addEventListener('click', () => {
  chatModal.classList.remove('active');
});

// 添加消息到聊天框
function addMessage(type, content) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${type}`;
  messageDiv.textContent = content;
  chatMessages.appendChild(messageDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 显示加载动画
function showLoading() {
  const loadingDiv = document.createElement('div');
  loadingDiv.className = 'message loading';
  loadingDiv.id = 'loading-msg';
  loadingDiv.textContent = '思考中...';
  chatMessages.appendChild(loadingDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// 移除加载动画
function hideLoading() {
  const loadingMsg = document.getElementById('loading-msg');
  if (loadingMsg) loadingMsg.remove();
}

// 发送消息
async function sendMessage() {
  const message = chatInput.value.trim();
  if (!message) return;

  // 添加用户消息
  addMessage('user', message);
  chatInput.value = '';
  sendBtn.disabled = true;

  // 显示加载
  showLoading();

  try {
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message })
    });

    hideLoading();

    if (!response.ok) {
      throw new Error(`服务器错误 (${response.status})`);
    }

    const data = await response.json();
    if (data.reply) {
      addMessage('ai', data.reply);
    } else {
      addMessage('ai', '抱歉，我暂时无法回答这个问题。');
    }
  } catch (error) {
    hideLoading();
    console.error('AI请求失败:', error);
    addMessage('ai', '抱歉，服务暂时不可用，请稍后再试。');
  } finally {
    sendBtn.disabled = false;
    chatInput.focus();
  }
}

// 发送按钮点击
sendBtn.addEventListener('click', sendMessage);

// 回车发送
chatInput.addEventListener('keypress', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// 平滑滚动
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
  anchor.addEventListener('click', function(e) {
    e.preventDefault();
    const target = document.querySelector(this.getAttribute('href'));
    if (target) {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  });
});
