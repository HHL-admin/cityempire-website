/*
 * 城池帝国 · 登录界面（账号密码 / 注册 / 游客引继码 / 找回密码）
 *
 * 账号体系（自建，降低运营开支）：
 *   - 正式账号：用户名 + 密码，注册时必须绑定邮箱（用于找回）；
 *   - 游客账号：创建后签发「引继码」，凭 引继码 + 密码 可跨设备登录；
 *   - 游客可在「我的资料」中升级为正式账号，原有游戏数据完整保留。
 *
 * 用法：LoginScreen.run(IntroLoading) → Promise<session>
 * 依赖：auth.js（账号接口）、avatars.js（可选，注册时选头像）
 */
(function () {
  'use strict';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // 输入框内联图标
  const I_USER = '<svg viewBox="0 0 24 24" fill="none" stroke="#d6a654" stroke-width="1.8"><circle cx="12" cy="8" r="3.6"/><path d="M4.5 20c1.2-3.6 4-5.4 7.5-5.4S18.3 16.4 19.5 20"/></svg>';
  const I_LOCK = '<svg viewBox="0 0 24 24" fill="none" stroke="#d6a654" stroke-width="1.8"><rect x="5" y="10.5" width="14" height="9.5" rx="2"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"/></svg>';
  const I_MAIL = '<svg viewBox="0 0 24 24" fill="none" stroke="#d6a654" stroke-width="1.8"><rect x="3.5" y="5.5" width="17" height="13" rx="2"/><path d="m4.5 7 7.5 5.6L19.5 7"/></svg>';

  const USERNAME_RE = /^[A-Za-z0-9_\u4e00-\u9fa5]{3,20}$/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  const AGREEMENT = `<label class="login-agree"><input type="checkbox" class="login-agree-box">
      <span>我已阅读并同意<a href="user-agreement.html" target="_blank" rel="noopener">《用户协议》</a>与<a href="privacy-policy.html" target="_blank" rel="noopener">《隐私政策》</a></span></label>`;

  const LoginScreen = {
    run(intro) {
      return new Promise(async resolve => {
        this.intro = intro; this.resolve = resolve;
        const root = intro.root;
        root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true');
        root.setAttribute('aria-label', '登录城池帝国'); root.removeAttribute('aria-valuenow');
        const panel = this.panel = document.createElement('div');
        panel.className = 'login-panel';
        intro.overlay().appendChild(panel);
        panel.innerHTML = '<div class="login-heading">正在核验身份</div>';
        requestAnimationFrame(() => panel.classList.add('show'));
        try {
          const [session, cfg] = await Promise.all([Auth.resume(), Auth.fetchConfig()]);
          this.cfg = cfg || {};
          this.tab = 'login';
          if (session && session.user) this.renderWelcome(); else this.renderTabs();
        } catch (e) {
          console.error('[LoginScreen]', e);
          this.cfg = this.cfg || {}; this.tab = 'login';
          this.renderTabs();
        }
      });
    },

    /* ---------- 已登录：进入游戏 ---------- */
    renderWelcome() {
      const u = Auth.user;
      const isGuest = Auth.isGuest;
      const from = isGuest ? '游客模式 · 凭引继码可找回进度'
        : '正式账号' + (u.username ? ' · ' + u.username : '') + (u.email ? ' · ' + u.email : '');
      this.panel.innerHTML = `
        <div class="login-heading">欢迎回城</div>
        <div class="login-user">
          <div class="login-avatar" data-profile-avatar></div>
          <div><b data-profile-nickname>${esc(u.nickname || '无名主公')}</b><small>${esc(from)}</small></div>
        </div>
        <button type="button" class="login-btn enter" data-act="enter">进入游戏</button>
        <div class="login-links">
          ${isGuest ? '<button type="button" class="login-link" data-act="profile">我的资料 / 升级账号</button>' : '<button type="button" class="login-link" data-act="profile">我的资料</button>'}
          <button type="button" class="login-link" data-act="switch">切换账号</button>
        </div>
        <div class="login-msg" role="status" aria-live="polite"></div>`;
      this.avatarEl = this.panel.querySelector('.login-avatar');
      this.paintAvatar(this.avatarEl, u.avatar || (u.nickname || '主')[0]);
      this.bind();
      this.panel.querySelector('[data-act=enter]').focus();
    },

    /* ---------- 未登录：标签页（登录 / 注册 / 游客） ---------- */
    renderTabs() {
      this.panel.innerHTML = `
        <div class="login-heading">进入城池帝国</div>
        <nav class="login-tabs" role="tablist">
          <button type="button" class="login-tab" data-tab="login" role="tab">账号登录</button>
          <button type="button" class="login-tab" data-tab="register" role="tab">注册</button>
          <button type="button" class="login-tab" data-tab="guest" role="tab">游客</button>
        </nav>
        <div id="loginTabBody"></div>
        <div class="login-msg" role="status" aria-live="polite"></div>`;
      this.panel.querySelectorAll('[data-tab]').forEach(b =>
        b.addEventListener('click', () => this.view(b.dataset.tab)));
      this.view(this.tab || 'login');
    },

    /** 切换标签页内容 */
    view(name) {
      this.tab = name;
      this.panel.querySelectorAll('[data-tab]').forEach(b => {
        const on = b.dataset.tab === name;
        b.classList.toggle('active', on);
        b.setAttribute('aria-selected', String(on));
      });
      const body = this.panel.querySelector('#loginTabBody');
      this.msg('');
      if (name === 'login') body.innerHTML = this.loginView();
      else if (name === 'register') body.innerHTML = this.registerView();
      else body.innerHTML = this.guestView();
      this.bindForm(name);
    },

    loginView() {
      return `<form class="login-form" id="loginForm" autocomplete="on">
        <label class="login-field">${I_USER}<input name="account" autocomplete="username" placeholder="用户名或邮箱"></label>
        <label class="login-field">${I_LOCK}<input name="password" type="password" autocomplete="current-password" placeholder="密码"></label>
        <button type="submit" class="login-submit">登 录</button>
        <div class="login-inline-links">
          <button type="button" class="login-link" data-act="forgot">忘记密码？</button>
          <button type="button" class="login-link" data-act="toRegister">注册新账号</button>
        </div>
        ${AGREEMENT}
        <div class="login-links"><button type="button" class="login-link" data-act="guest">以游客身份试玩</button></div>
      </form>`;
    },

    registerView() {
      const list = (window.GameAvatars && GameAvatars.list) || [];
      const pick = list.length ? `
        <div class="login-help" style="background:none;border:0;padding:0;margin-top:2px;">选择头像</div>
        <div class="login-avatar-pick" id="loginAvatarPick">
          ${list.map(a => `<button type="button" data-avatar="${esc(a.key)}" title="${esc(a.name)}" aria-pressed="false"></button>`).join('')}
        </div>` : '';
      return `<form class="login-form" id="registerForm" autocomplete="on">
        <label class="login-field">${I_USER}<input name="username" autocomplete="username" maxlength="20" placeholder="用户名（3-20 位）"></label>
        <label class="login-field">${I_MAIL}<input name="email" type="email" autocomplete="email" placeholder="邮箱（用于找回登录信息）"></label>
        <label class="login-field">${I_LOCK}<input name="password" type="password" autocomplete="new-password" placeholder="密码（至少 6 位）"></label>
        ${pick}
        <button type="submit" class="login-submit">注册并登录</button>
        ${AGREEMENT}
        <p class="login-help">邮箱为必填项，用于日后通过验证码找回登录信息。</p>
        <div class="login-links"><button type="button" class="login-link" data-act="toLogin">已有账号？去登录</button></div>
      </form>`;
    },

    guestView() {
      return `<form class="login-form" id="guestForm" autocomplete="on">
        <label class="login-field">${I_LOCK}<input name="password" type="password" autocomplete="new-password" placeholder="设置游客密码（至少 6 位）"></label>
        <button type="submit" class="login-submit">以新游客身份开始</button>
        ${AGREEMENT}
        <p class="login-help">创建后会生成一串<b>引继码</b>，请连同密码一并保存，换设备时用它找回进度。</p>
        <div class="login-inline-links" style="justify-content:center">
          <button type="button" class="login-link" data-act="guestResume">已有引继码？找回游客进度</button>
        </div>
      </form>`;
    },

    /** 找回游客进度（引继码 + 密码）子视图 */
    guestResumeView() {
      this.panel.querySelector('#loginTabBody').innerHTML = `<form class="login-form" id="guestResumeForm" autocomplete="on">
        <label class="login-field">${I_USER}<input name="recoveryCode" autocomplete="off" placeholder="引继码（如 ABCD-EFGH-IJKL）"></label>
        <label class="login-field">${I_LOCK}<input name="password" type="password" autocomplete="current-password" placeholder="游客密码"></label>
        <button type="submit" class="login-submit">找回并登录</button>
        <div class="login-links"><button type="button" class="login-link" data-act="guest">返回游客创建</button></div>
      </form>`;
      this.bindForm('guestResume');
    },

    /** 找回密码子视图（开发模式回显验证码） */
    forgotView() {
      this.panel.querySelector('#loginTabBody').innerHTML = `<form class="login-form" id="forgotForm" autocomplete="on">
        <label class="login-field">${I_MAIL}<input name="email" type="email" autocomplete="email" placeholder="注册邮箱"></label>
        <button type="button" class="login-submit" id="forgotSendCode" style="letter-spacing:2px">获取验证码</button>
        <div id="forgotCodeBox" hidden>
          <label class="login-field">${I_USER}<input name="code" inputmode="numeric" maxlength="6" placeholder="6 位验证码"></label>
          <label class="login-field">${I_LOCK}<input name="newPassword" type="password" autocomplete="new-password" placeholder="设置新密码（至少 6 位）"></label>
          <button type="submit" class="login-submit">重置密码</button>
        </div>
        <div class="login-links"><button type="button" class="login-link" data-act="toLogin">返回登录</button></div>
      </form>`;
      this.bindForm('forgot');
    },

    /** 绑定表单 / 快捷动作 */
    bindForm(name) {
      const body = this.panel.querySelector('#loginTabBody');
      const form = body.querySelector('form');
      form?.addEventListener('submit', e => { e.preventDefault(); this.submit(name, form); });
      body.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', () => this.link(b.dataset.act, form)));
      if (name === 'forgot') body.querySelector('#forgotSendCode')?.addEventListener('click', () => this.sendResetCode(form));
      if (name === 'register') this.paintAvatarPick(body);
    },

    paintAvatarPick(body) {
      const list = (window.GameAvatars && GameAvatars.list) || [];
      const wrap = body.querySelector('#loginAvatarPick');
      if (!wrap || !list.length) return;
      this.pickedAvatar = this.pickedAvatar || (Auth.user && Auth.user.avatar) || 'preset:' + GameAvatars.DEFAULT_KEY;
      list.forEach(a => {
        const btn = wrap.querySelector(`[data-avatar="${a.key}"]`);
        if (btn && window.GameAvatars) GameAvatars.render(btn, a.key);
      });
      const mark = () => {
        const key = String(this.pickedAvatar || '').replace(/^preset:/i, '');
        wrap.querySelectorAll('[data-avatar]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.avatar === key)));
      };
      wrap.querySelectorAll('[data-avatar]').forEach(b => b.addEventListener('click', () => {
        this.pickedAvatar = 'preset:' + b.dataset.avatar; mark();
      }));
      mark();
    },

    bind() {
      this.panel.onclick = e => {
        const b = e.target.closest('[data-act]');
        if (b && !b.disabled) this.link(b.dataset.act);
      };
    },

    msg(text, ok) { const m = this.panel.querySelector('.login-msg'); if (m) { m.textContent = text || ''; m.classList.toggle('ok', !!ok); } },

    /** 协议勾选：未勾选时抖动提示 */
    agreed(scope) {
      const box = (scope || this.panel).querySelector('.login-agree-box');
      if (!box || box.checked) return true;
      const lab = box.closest('.login-agree');
      if (lab) { lab.classList.remove('shake'); void lab.offsetWidth; lab.classList.add('shake'); }
      this.msg('请先阅读并勾选同意《用户协议》与《隐私政策》');
      box.focus();
      return false;
    },

    /** 表单提交分发 */
    async submit(name, form) {
      if (name === 'forgot') return this.doReset(form);
      if (!this.agreed(form)) return;
      const btn = form.querySelector('.login-submit');
      const f = new FormData(form);
      btn.disabled = true;
      const restore = () => { btn.disabled = false; };
      this.msg('');
      try {
        if (name === 'login') {
          const account = String(f.get('account') || '').trim();
          const password = String(f.get('password') || '');
          if (!account || !password) { this.msg('请输入账号与密码'); return restore(); }
          await Auth.loginPassword(account, password);
          return this.afterAuth();
        }
        if (name === 'register') {
          const username = String(f.get('username') || '').trim();
          const email = String(f.get('email') || '').trim();
          const password = String(f.get('password') || '');
          if (!USERNAME_RE.test(username)) { this.msg('用户名需为 3-20 位字母、数字、下划线或中文'); return restore(); }
          if (!EMAIL_RE.test(email)) { this.msg('请输入有效的邮箱地址'); return restore(); }
          if (password.length < 6) { this.msg('密码至少 6 位'); return restore(); }
          await Auth.register({ username, email, password, avatar: this.pickedAvatar });
          return this.afterAuth();
        }
        if (name === 'guest') {
          const password = String(f.get('password') || '');
          if (password.length < 6) { this.msg('游客密码至少 6 位'); return restore(); }
          const s = await Auth.loginGuest(password);
          return this.showRecovery(s.recoveryCode);
        }
        if (name === 'guestResume') {
          const code = String(f.get('recoveryCode') || '').trim();
          const password = String(f.get('password') || '');
          if (!code || !password) { this.msg('请输入引继码与密码'); return restore(); }
          await Auth.loginGuestByCode(code, password);
          return this.afterAuth();
        }
      } catch (e) {
        this.msg(e.message || '操作失败');
        restore();
      }
    },

    /** 快捷链接动作 */
    link(act) {
      if (act === 'toRegister') return this.view('register');
      if (act === 'toLogin') return this.view('login');
      if (act === 'guest') return this.view('guest');
      if (act === 'guestResume') return this.guestResumeView();
      if (act === 'forgot') return this.forgotView();
      if (act === 'enter') return this.enter();
      if (act === 'switch') return this.switchAccount();
      if (act === 'profile') { if (window.Profile) Profile.open(); return; }
    },

    /** 游客创建成功后：展示引继码，强制保存后进入 */
    showRecovery(code) {
      this.panel.innerHTML = `
        <div class="login-heading">请保存你的引继码</div>
        <div class="login-recovery">
          <small>引继码（连同密码妥善保存，用于找回游客进度）</small>
          <code id="recoveryCodeText">${esc(code || '')}</code>
          <div class="login-recovery-actions">
            <button type="button" class="login-mini-btn" data-act="copyRecovery">复制</button>
          </div>
        </div>
        <button type="button" class="login-btn enter" data-act="enter">我已保存，进入游戏</button>
        <div class="login-msg" role="status" aria-live="polite"></div>`;
      this.bind();
      this.panel.querySelector('[data-act=copyRecovery]').addEventListener('click', async () => {
        try { await navigator.clipboard.writeText(code || ''); this.msg('引继码已复制', true); }
        catch { this.msg('复制失败，请手动记录'); }
      });
      this.panel.querySelector('[data-act=enter]').focus();
    },

    /** 登录成功后的进入状态（正式 / 找回游客） */
    afterAuth() { this.msg('登录成功', true); setTimeout(() => this.renderWelcome(), 300); },

    async switchAccount() { await Auth.logout(); this.tab = 'login'; this.renderTabs(); },

    /* ---------- 找回密码 ---------- */
    async doReset(form) {
      const email = String(form.querySelector('[name=email]').value || '').trim();
      const codeBox = form.querySelector('#forgotCodeBox');
      if (codeBox.hidden) return this.sendResetCode(form);
      const code = String(form.querySelector('[name=code]').value || '').trim();
      const newPassword = String(form.querySelector('[name=newPassword]').value || '');
      if (!EMAIL_RE.test(email)) { this.msg('请输入有效的邮箱地址'); return; }
      if (!/^\d{6}$/.test(code)) { this.msg('请输入 6 位验证码'); return; }
      if (newPassword.length < 6) { this.msg('新密码至少 6 位'); return; }
      const btn = form.querySelector('.login-submit[type=submit]') || form.querySelector('button[type=submit]');
      if (btn) btn.disabled = true;
      try {
        await Auth.resetPassword({ email, code, newPassword });
        this.msg('密码已重置，请使用新密码登录', true);
        setTimeout(() => this.view('login'), 900);
      } catch (e) { this.msg(e.message || '重置失败'); if (btn) btn.disabled = false; }
    },

    async sendResetCode(form) {
      const email = String(form.querySelector('[name=email]').value || '').trim();
      if (!EMAIL_RE.test(email)) { this.msg('请输入有效的邮箱地址'); return; }
      const btn = form.querySelector('#forgotSendCode');
      btn.disabled = true; btn.textContent = '发送中…';
      try {
        const r = await Auth.forgotPassword(email);
        form.querySelector('#forgotCodeBox').hidden = false;
        if (r && r.devCode) {
          form.querySelector('[name=code]').value = r.devCode;
          this.msg('开发模式：验证码已回显并自动填入（' + r.devCode + '）', true);
        } else {
          this.msg(r && r.mailMode === 'dev' ? '若该邮箱已注册，验证码已生成' : '验证码已发送，请查收邮件', true);
        }
      } catch (e) { this.msg(e.message || '发送失败'); }
      finally { btn.disabled = false; btn.textContent = '重新获取验证码'; }
    },

    /** 头像渲染：preset:<key> 用内置 SVG，其余按图片 URL / 首字回退 */
    paintAvatar(el, avatar) {
      if (!el) return;
      const s = String(avatar || '');
      el.textContent = '';
      if (/^preset:/i.test(s) && window.GameAvatars) { GameAvatars.render(el, s); return; }
      if (/^(https?:|data:image\/)/i.test(s)) { el.style.backgroundImage = 'url(' + JSON.stringify(s) + ')'; return; }
      el.style.backgroundImage = '';
      el.textContent = String(avatar || '主').slice(0, 1);
    },

    enter() {
      this.panel.classList.remove('show');
      this.panel.onclick = null;
      setTimeout(() => this.resolve(Auth.session), 300);
    }
  };
  window.LoginScreen = LoginScreen;
})();
