/*
 * 城池帝国 · 玩家资料面板（头像 / 昵称 / 游客引继码 / 升级为正式账号）
 *
 * 依赖：Auth（账号接口）、GameAvatars（内置武将头像）
 * 用法：Profile.open() 打开面板；Profile.close() 关闭。
 *
 * 说明：
 *  - 头像只接受内置预设（preset:<key>），与 server.js 的白名单校验一致；
 *  - 游客账号额外展示「引继码」（可复制）与「升级为正式账号」表单，
 *    升级沿用同一 user_id，因此存档 / 社交快照 / 身份绑定全部保留；
 *  - 面板为独立浮层，不依赖 Game 内部模态框，避免加载顺序问题。
 */
(function () {
  'use strict';

  if (!window.Auth) { console.warn('[Profile] 需要先加载 auth.js'); return; }

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const USERNAME_RE = /^[A-Za-z0-9_\u4e00-\u9fa5]{3,20}$/;
  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const P = {
    panel: null,
    draft: { avatar: '', nickname: '' },

    /** 打开资料面板 */
    open() {
      const u = Auth.user;
      if (!u) { alert('请先登录后再编辑资料'); return; }
      this.draft.nickname = u.nickname || '';
      this.draft.avatar = u.avatar || (window.GameAvatars ? 'preset:' + GameAvatars.DEFAULT_KEY : '');
      this.build();
    },

    close() { if (this.panel) { this.panel.classList.remove('show'); const p = this.panel; this.panel = null; setTimeout(() => p.remove(), 220); } },

    msg(text, ok) {
      const m = this.panel && this.panel.querySelector('.profile-msg');
      if (m) { m.textContent = text || ''; m.classList.toggle('ok', !!ok); }
    },

    build() {
      if (this.panel) this.panel.remove();
      const u = Auth.user;
      const isGuest = Auth.isGuest;
      const panel = document.createElement('div');
      panel.className = 'profile-root';
      panel.innerHTML = `
        <div class="profile-layer" data-close="1"></div>
        <section class="profile-panel" role="dialog" aria-modal="true" aria-label="我的资料">
          <header class="profile-head">
            <h2>我的资料</h2>
            <button type="button" class="profile-x" data-close="1" aria-label="关闭">×</button>
          </header>
          <div class="profile-body">
            <div class="profile-top">
              <div class="profile-avatar-preview" id="profileAvatarPreview" aria-hidden="true"></div>
              <div class="profile-top-info">
                <b id="profileNicknameView">${esc(u.nickname || '无名主公')}</b>
                <small>${isGuest ? '游客账号 · 进度已云同步' : '正式账号 · ' + esc(u.username || '')}</small>
                ${u.email ? `<small class="profile-email">${esc(u.email)}</small>` : ''}
              </div>
            </div>

            <label class="profile-field">
              <span>昵称</span>
              <input type="text" id="profileNickname" maxlength="20" value="${esc(this.draft.nickname)}" placeholder="给自己起个名字">
            </label>

            <div class="profile-label">选择头像</div>
            <div class="profile-avatar-grid" id="profileAvatarGrid"></div>

            ${isGuest ? this.guestBlock(u) : ''}
          </div>
          <footer class="profile-foot">
            <button type="button" class="profile-btn ghost" data-close="1">取消</button>
            <button type="button" class="profile-btn" id="profileSave">保存资料</button>
          </footer>
          <div class="profile-msg" role="status" aria-live="polite"></div>
        </section>`;
      document.body.appendChild(panel);
      this.panel = panel;

      this.renderAvatarGrid();
      this.renderPreview();
      panel.addEventListener('click', e => { if (e.target.closest('[data-close]')) this.close(); });
      panel.querySelector('#profileNickname').addEventListener('input', e => { this.draft.nickname = e.target.value; });
      panel.querySelector('#profileSave').addEventListener('click', () => this.save());
      if (isGuest) this.bindGuest(panel);
      requestAnimationFrame(() => panel.classList.add('show'));
    },

    /** 游客专属区块：引继码 + 升级表单 */
    guestBlock(u) {
      const code = (Auth.session && Auth.session.recoveryCode) || u.recoveryCode || '';
      return `
        <div class="profile-guest">
          <div class="profile-label">我的引继码</div>
          <div class="profile-recovery">
            <code id="profileRecovery">${esc(code || '（未下发，请重新登录获取）')}</code>
            <button type="button" class="profile-copy" id="profileCopyRecovery"${code ? '' : ' disabled'}>复制</button>
          </div>
          <p class="profile-hint">引继码 + 密码可在其它设备登录并找回游客进度，请妥善保存。</p>

          <button type="button" class="profile-upgrade-toggle" id="profileUpgradeToggle">升级为正式账号</button>
          <form class="profile-upgrade-form" id="profileUpgradeForm" hidden>
            <label class="profile-field"><span>用户名</span>
              <input name="username" autocomplete="username" maxlength="20" placeholder="3-20 位字母、数字、下划线或中文"></label>
            <label class="profile-field"><span>邮箱</span>
              <input name="email" type="email" autocomplete="email" placeholder="用于后续找回登录信息"></label>
            <label class="profile-field"><span>密码</span>
              <input name="password" type="password" autocomplete="new-password" placeholder="至少 6 位"></label>
            <button type="submit" class="profile-btn" id="profileUpgradeSubmit">确认升级</button>
            <p class="profile-hint">升级后原有城池与存档完整保留，并可用用户名 / 邮箱登录。</p>
          </form>
        </div>`;
    },

    renderAvatarGrid() {
      const grid = this.panel.querySelector('#profileAvatarGrid');
      if (!grid) return;
      const list = (window.GameAvatars && GameAvatars.list) || [];
      if (!list.length) { grid.innerHTML = '<p class="profile-hint">头像资源未加载</p>'; return; }
      grid.innerHTML = list.map(a => `
        <button type="button" class="profile-avatar-opt" data-avatar="${esc(a.key)}" title="${esc(a.name)}" aria-pressed="false">
          <span class="profile-avatar-img" data-key="${esc(a.key)}"></span>
          <em>${esc(a.name)}</em>
        </button>`).join('');
      list.forEach(a => {
        const el = grid.querySelector(`.profile-avatar-img[data-key="${a.key}"]`);
        if (el && window.GameAvatars) GameAvatars.render(el, a.key);
      });
      grid.querySelectorAll('[data-avatar]').forEach(btn => btn.addEventListener('click', () => {
        this.draft.avatar = 'preset:' + btn.dataset.avatar;
        this.markSelected();
        this.renderPreview();
      }));
      this.markSelected();
    },

    markSelected() {
      const key = String(this.draft.avatar || '').replace(/^preset:/i, '');
      this.panel.querySelectorAll('[data-avatar]').forEach(btn => {
        btn.setAttribute('aria-pressed', String(btn.dataset.avatar === key));
      });
    },

    renderPreview() {
      const el = this.panel.querySelector('#profileAvatarPreview');
      if (el && window.GameAvatars) GameAvatars.apply(el, this.draft.avatar);
    },

    bindGuest(panel) {
      const copyBtn = panel.querySelector('#profileCopyRecovery');
      copyBtn?.addEventListener('click', async () => {
        const code = panel.querySelector('#profileRecovery').textContent.trim();
        if (!code || code.startsWith('（')) return;
        try {
          await navigator.clipboard.writeText(code);
          this.msg('引继码已复制到剪贴板', true);
        } catch {
          // 剪贴板不可用时退回手动选择
          const r = document.createRange(); r.selectNodeContents(panel.querySelector('#profileRecovery'));
          const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
          this.msg('请手动复制已选中的引继码');
        }
      });
      const toggle = panel.querySelector('#profileUpgradeToggle');
      const form = panel.querySelector('#profileUpgradeForm');
      toggle?.addEventListener('click', () => {
        form.hidden = !form.hidden;
        toggle.textContent = form.hidden ? '升级为正式账号' : '收起升级表单';
      });
      form?.addEventListener('submit', e => { e.preventDefault(); this.upgrade(form); });
    },

    /** 保存昵称 + 头像 */
    async save() {
      const btn = this.panel.querySelector('#profileSave');
      const nickname = (this.panel.querySelector('#profileNickname').value || '').trim();
      if (!nickname) { this.msg('昵称不能为空'); return; }
      btn.disabled = true;
      try {
        await Auth.updateProfile({ nickname, avatar: this.draft.avatar });
        this.refreshViews();
        this.msg('资料已保存', true);
        setTimeout(() => this.close(), 650);
      } catch (e) {
        this.msg(e.message || '保存失败');
      } finally { if (btn) btn.disabled = false; }
    },

    /** 游客升级为正式账号 */
    async upgrade(form) {
      const btn = form.querySelector('#profileUpgradeSubmit');
      const f = new FormData(form);
      const username = String(f.get('username') || '').trim();
      const email = String(f.get('email') || '').trim();
      const password = String(f.get('password') || '');
      if (!USERNAME_RE.test(username)) { this.msg('用户名需为 3-20 位字母、数字、下划线或中文'); return; }
      if (!EMAIL_RE.test(email)) { this.msg('请输入有效的邮箱地址'); return; }
      if (password.length < 6) { this.msg('密码至少 6 位'); return; }
      btn.disabled = true;
      try {
        await Auth.upgradeGuest({
          username, email, password,
          nickname: (this.panel.querySelector('#profileNickname').value || '').trim() || undefined,
          avatar: this.draft.avatar
        });
        this.refreshViews();
        this.msg('升级成功！已绑定用户名与邮箱，可重新登录', true);
        setTimeout(() => { this.close(); if (window.Profile.onUpgraded) window.Profile.onUpgraded(); }, 900);
      } catch (e) {
        this.msg(e.message || '升级失败');
      } finally { if (btn) btn.disabled = false; }
    },

    /** 资料变更后刷新页面上引用头像 / 昵称的位置 */
    refreshViews() {
      document.querySelectorAll('[data-profile-avatar]').forEach(el => {
        if (window.GameAvatars) GameAvatars.apply(el, Auth.user && Auth.user.avatar);
      });
      document.querySelectorAll('[data-profile-nickname]').forEach(el => {
        el.textContent = (Auth.user && Auth.user.nickname) || '';
      });
      document.dispatchEvent(new CustomEvent('profile:updated', { detail: Auth.user }));
    }
  };

  window.Profile = P;
})();
