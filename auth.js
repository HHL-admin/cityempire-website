/*
 * 城池帝国 · 账号登录（微信 / QQ）
 *
 * 流程：原生 SDK 授权 → 拿到 code（微信）或 access_token+openid（QQ）
 *      → 发给 server/ 账号服务校验 → 返回会话令牌 → 按账号隔离本地存档 + 云存档
 *
 * 原生桥协议（Android / iOS 壳需实现，示例见 native/）：
 *   JS → 原生：Android  window.AndroidBridge.postMessage(JSON 字符串)
 *              iOS      window.webkit.messageHandlers.nativeBridge.postMessage(对象)
 *              消息体   { id, method, params }
 *   原生 → JS：window.NativeBridge.resolve(id, result) / window.NativeBridge.reject(id, {code, message})
 *   方法：     auth.capabilities → { wechat: bool(已安装微信), qq: bool(已安装QQ) }
 *              wechat.login      → { code }
 *              qq.login          → { accessToken, openid }
 *
 * 服务器地址：window.GAME_CONFIG.apiBase（默认同源；file:// 打开时为 http://localhost:3000）
 */
(function () {
  'use strict';
  const CONF = window.GAME_CONFIG || {};
  const API = (CONF.apiBase || (/^https?:/.test(location.protocol) ? location.origin : 'http://localhost:3000')).replace(/\/$/, '');
  const SESSION_KEY = 'ce_session';
  const LEGACY_SAVE = 'gameState';
  const OAUTH_STATE_KEY = 'ce_oauth_state';
  const CASDOOR_STATE_KEY = 'ce_casdoor_state';

  /* ---------------- 原生桥 ---------------- */
  const NativeBridge = {
    seq: 0, pending: new Map(),
    get transport() {
      if (window.AndroidBridge && typeof window.AndroidBridge.postMessage === 'function') return m => window.AndroidBridge.postMessage(JSON.stringify(m));
      const ios = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.nativeBridge;
      if (ios) return m => ios.postMessage(m);
      return null;
    },
    available() { return !!this.transport; },
    call(method, params = {}, timeout = 120000) {
      const send = this.transport;
      if (!send) return Promise.reject(Object.assign(new Error('请在《城池帝国》App 中使用该登录方式'), { code: 'no_native' }));
      const id = ++this.seq;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { this.pending.delete(id); reject(Object.assign(new Error('授权超时，请重试'), { code: 'timeout' })); }, timeout);
        this.pending.set(id, { resolve, reject, timer });
        try { send({ id, method, params }); } catch (e) { clearTimeout(timer); this.pending.delete(id); reject(e); }
      });
    },
    resolve(id, result) { const p = this.pending.get(Number(id)); if (!p) return; clearTimeout(p.timer); this.pending.delete(Number(id)); p.resolve(typeof result === 'string' ? JSON.parse(result) : result); },
    reject(id, err) {
      const p = this.pending.get(Number(id)); if (!p) return; clearTimeout(p.timer); this.pending.delete(Number(id));
      const e = typeof err === 'string' ? JSON.parse(err) : (err || {});
      p.reject(Object.assign(new Error(e.message || '授权失败'), { code: e.code || 'native_error' }));
    }
  };
  window.NativeBridge = NativeBridge;

  /* ---------------- 接口请求 ---------------- */
  async function api(method, url, body, token) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    let r;
    try { r = await fetch(API + url, { method, headers, body: body ? JSON.stringify(body) : undefined }); }
    catch { throw Object.assign(new Error('无法连接服务器，请检查网络'), { code: 'network' }); }
    let data = {}; try { data = await r.json(); } catch {}
    if (!r.ok) throw Object.assign(new Error(data.message || ('请求失败 ' + r.status)), { code: data.error || 'http_' + r.status, status: r.status, data });
    return data;
  }
  /* ---------------- 账号会话 ---------------- */
  const Auth = {
    session: null,          // { token, expiresAt, user:{id,nickname,avatar,providers} } 或 { guest:true, user:{id:'guest'} }
    serverConfig: null,
    cloudVersion: 0, _saveTimer: 0, _saving: false,

    restore() {
      try {
        const s = JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
        if (s && (s.guest || (s.token && s.expiresAt > Date.now()))) this.session = s;
      } catch {}
      return this.session;
    },
    persist() { if (this.session) localStorage.setItem(SESSION_KEY, JSON.stringify(this.session)); else localStorage.removeItem(SESSION_KEY); },
    get user() { return this.session && this.session.user; },
    /** 是否持有效会话令牌（游客账号同样持有令牌，因此也能云存档与联机） */
    get hasToken() { return !!(this.session && this.session.token); },
    /** 是否游客账号：新体系看 accountType，兼容旧版纯本地游客会话 */
    get isGuest() {
      return !!(this.session && (this.session.guest ||
        (this.session.user && this.session.user.accountType === 'guest')));
    },
    /** 本地存档按账号隔离 */
    saveKey() { return this.user ? LEGACY_SAVE + ':' + this.user.id : LEGACY_SAVE; },

    async fetchConfig() {
      try { this.serverConfig = await api('GET', '/api/config'); } catch { this.serverConfig = null; }
      return this.serverConfig;
    },
    async capabilities() {
      if (!NativeBridge.available()) return { native: false, wechat: false, qq: false };
      try { return Object.assign({ native: true }, await NativeBridge.call('auth.capabilities', {}, 3000)); }
      catch { return { native: true, wechat: true, qq: true }; }
    },
    /** 自动登录：本地有会话则向服务器确认仍有效（离线时先信任本地会话） */
    async resume() {
      if (!this.restore()) return null;
      if (!this.hasToken) return this.session; // 旧版纯本地游客会话，无令牌无需校验
      try {
        const r = await api('GET', '/api/me', null, this.session.token);
        if (!r.user) throw Object.assign(new Error('账号不存在'), { status: 401 });
        this.session.user = r.user; this.persist();
      } catch (e) { if (e.status === 401) { this.session = null; this.persist(); return null; } }
      return this.session;
    },
    async loginWechat() {
      const { code } = await NativeBridge.call('wechat.login', { scope: 'snsapi_userinfo', state: crypto.getRandomValues(new Uint32Array(1))[0].toString(36) });
      return this._done(await api('POST', '/api/auth/wechat', { code }));
    },
    async loginQQ() {
      const { accessToken, openid } = await NativeBridge.call('qq.login', { scope: 'get_user_info' });
      return this._done(await api('POST', '/api/auth/qq', { accessToken, openid }));
    },
    async loginDev(name) { return this._done(await api('POST', '/api/auth/dev', { name })); },
    /* ---------- 网页端跳转式 OAuth（真实渠道 / 内置模拟授权） ---------- */
    /** 回调页地址：真实渠道与内置模拟授权都回到这里 */
    oauthRedirect() { return location.origin + location.pathname.replace(/[^/]*$/, '') + 'oauth-callback.html'; },
    /** 发起网页授权：带 state 防伪，向服务端要授权地址后整页跳转 */
    async startWebOAuth(provider) {
      const state = provider + ':' + Math.random().toString(36).slice(2) + Date.now().toString(36);
      sessionStorage.setItem(OAUTH_STATE_KEY, state);
      const d = await api('GET', '/api/oauth/authorize?provider=' + encodeURIComponent(provider) +
        '&redirect=' + encodeURIComponent(this.oauthRedirect()) + '&state=' + encodeURIComponent(state));
      if (!d || !d.url) throw Object.assign(new Error('无法获取授权地址'), { code: 'no_auth_url' });
      location.href = d.url;
      return d;
    },
    /** 回调页使用：校验 state 后用一次性 code 换取会话，成功即写入本地缓存 */
    async loginWithCode(provider, code, state) {
      const expect = sessionStorage.getItem(OAUTH_STATE_KEY) || '';
      const [p] = expect.split(':');
      if (!expect || !state || state !== expect || p !== provider)
        throw Object.assign(new Error('授权状态校验失败，请重新登录'), { code: 'bad_state' });
      if (!code) throw Object.assign(new Error('授权未返回凭据'), { code: 'no_code' });
      sessionStorage.removeItem(OAUTH_STATE_KEY);
      const r = await api('POST', provider === 'qq' ? '/api/auth/qq' : '/api/auth/wechat', { code, redirect: this.oauthRedirect() });
      return this._done(r);
    },
    /* ---------- Casdoor 统一认证（OAuth 2.0 授权码 + PKCE + 一次性 state） ---------- */
    /** 回调页地址：Casdoor 应用后台需把该地址登记进 Redirect URIs */
    casdoorRedirect() { return location.origin + location.pathname.replace(/[^/]*$/, '') + 'casdoor-callback.html'; },
    /**
     * 发起统一登录：服务端签发一次性 state 与 PKCE，客户端只负责整页跳转。
     * 账号密码 / 手机验证码 / 微信 / GitHub / Google 等均在 Casdoor 页面内选择，
     * 后台启停某个渠道即刻生效，无需前端改动。
     */
    async startCasdoorLogin(provider) {
      let url = '/api/auth/casdoor/authorize?redirect_uri=' + encodeURIComponent(this.casdoorRedirect());
      if (provider) url += '&provider=' + encodeURIComponent(provider);
      const d = await api('GET', url);
      if (!d || !d.url) throw Object.assign(new Error('无法获取授权地址'), { code: 'no_auth_url' });
      // 本地留一份 state 做二次核对（真正的防伪造/防重放由服务端一次性 state 保证）
      if (d.state) sessionStorage.setItem(CASDOOR_STATE_KEY, d.state);
      location.href = d.url;
      return d;
    },
    /** 回调页使用：用一次性 code + state 换取游戏会话，成功后写入本地缓存 */
    async completeCasdoorLogin(code, state) {
      if (!code) throw Object.assign(new Error('授权未返回凭据'), { code: 'no_code' });
      const expect = sessionStorage.getItem(CASDOOR_STATE_KEY) || '';
      if (expect && state && expect !== state)
        throw Object.assign(new Error('授权状态校验失败，请重新登录'), { code: 'bad_state' });
      sessionStorage.removeItem(CASDOOR_STATE_KEY);
      return this._done(await api('POST', '/api/auth/casdoor/exchange', { code, state }));
    },
    /* ---------- 自建账号体系：用户名+密码 / 游客引继码 / 找回密码 ---------- */
    /** 注册正式账号（用户名 + 密码 + 邮箱，邮箱用于后续找回） */
    async register({ username, password, email, nickname, avatar }) {
      return this._done(await api('POST', '/api/auth/register', { username, password, email, nickname, avatar }));
    },
    /** 用户名/邮箱 + 密码 登录 */
    async loginPassword(account, password) {
      return this._done(await api('POST', '/api/auth/login', { account, password }));
    },
    /** 开新游客账号：服务端签发引继码，返回附带 recoveryCode 的会话 */
    async loginGuest(password, avatar) {
      return this._done(await api('POST', '/api/auth/guest', { password, avatar }));
    },
    /** 游客二次登录：引继码 + 密码（跨设备找回游客进度） */
    async loginGuestByCode(recoveryCode, password) {
      return this._done(await api('POST', '/api/auth/guest/login', { recoveryCode, password }));
    },
    /** 游客升级为正式账号：服务端原地升级，存档/快照/身份全部保留 */
    async upgradeGuest({ username, password, email, nickname, avatar }) {
      return this._done(await api('POST', '/api/auth/upgrade', { username, password, email, nickname, avatar }, this.hasToken ? this.session.token : ''));
    },
    /** 找回密码：请求一次性验证码（开发模式服务端回显 devCode） */
    forgotPassword(email) { return api('POST', '/api/auth/password/forgot', { email }); },
    /** 重置密码：{email, code, newPassword} 或 {token, newPassword} */
    resetPassword(payload) { return api('POST', '/api/auth/password/reset', payload); },
    /** 修改资料：昵称 / 预设头像，成功后同步本地会话 */
    async updateProfile({ nickname, avatar }) {
      const r = await api('POST', '/api/me/profile', { nickname, avatar }, this.hasToken ? this.session.token : '');
      if (r.user && this.session) { this.session.user = r.user; this.persist(); }
      return r.user;
    },
    _done(r) {
      this.session = { token: r.token, expiresAt: r.expiresAt, user: r.user };
      if (r.recoveryCode) this.session.recoveryCode = r.recoveryCode; // 仅创建游客时下发一次
      this.persist(); return this.session;
    },
    async logout() {
      const s = this.session;
      clearTimeout(this._saveTimer); this._pending = null;
      this.session = null; this.persist();
      if (s && s.token) { try { await api('POST', '/api/auth/logout', null, s.token); } catch {} }
    },

    /* ---------- 存档：本地按账号隔离 + 云端同步 ---------- */
    /** 登录后调用：取云存档；云端没有则把本机旧存档迁移上去。返回应载入的存档对象（或 null） */
    async pullSave() {
      const key = this.saveKey();
      let local = null; try { local = JSON.parse(localStorage.getItem(key) || 'null'); } catch {}
      // 首次登录：继承未登录时代的旧存档
      if (!local && localStorage.getItem(LEGACY_SAVE)) {
        try { local = JSON.parse(localStorage.getItem(LEGACY_SAVE)); localStorage.setItem(key, JSON.stringify(local)); localStorage.removeItem(LEGACY_SAVE); } catch {}
      }
      if (!this.hasToken) return local; // 旧版纯本地游客：仅用本机存档
      try {
        const r = await api('GET', '/api/save', null, this.session.token);
        this.cloudVersion = r.version || 0;
        if (r.data) { localStorage.setItem(key, JSON.stringify(r.data)); return r.data; }
        if (local) this.queueCloudSave(local, 0);
      } catch (e) { console.warn('[Auth] 云存档读取失败，使用本机存档', e.message); }
      return local;
    },
    /** 存档变化时调用：防抖 3 秒后上传 */
    queueCloudSave(state, delay = 3000) {
      if (!this.hasToken) return; // 游客账号同样持令牌，可正常云存档
      this._pending = state;
      clearTimeout(this._saveTimer);
      this._saveTimer = setTimeout(() => this._flush(), delay);
    },
    async _flush() {
      if (!this.session || !this.session.token) { this._pending = null; return; }
      if (this._saving || !this._pending) return;
      const data = this._pending; this._pending = null; this._saving = true;
      try {
        const r = await api('PUT', '/api/save', { data, baseVersion: this.cloudVersion }, this.session.token);
        this.cloudVersion = r.version;
      } catch (e) {
        if (e.status === 409 && e.data && e.data.server) {
          // 别的设备更新过：以本机当前进度为准覆盖（单人游戏，最近游玩的设备优先）
          this.cloudVersion = e.data.server.version; this._pending = this._pending || data;
        } else if (e.status === 401) { console.warn('[Auth] 登录过期，云存档暂停'); }
        else { this._pending = this._pending || data; }
      } finally {
        this._saving = false;
        if (this._pending) this._saveTimer = setTimeout(() => this._flush(), 5000);
      }
    }
  };
  window.Auth = Auth;
  // 供社交等其它模块复用同一套请求出口与服务器地址
  Auth.api = api;
  Auth.apiBase = API;
  // 切到后台 / 关闭页面前尽量把未上传的存档送出去
  document.addEventListener('visibilitychange', () => { if (document.hidden && Auth._pending) Auth._flush(); });
})();
