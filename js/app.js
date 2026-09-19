/* =========================================================
   印匠 · 应用逻辑
   - 会话历史 / 知识库文件 / 检索问答 / 页面切换
   ========================================================= */
(function () {
  'use strict';

  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));

  const K_SESSIONS = 'yjiang.sessions.v2';
  const K_FILES = 'yjiang.userfiles.v2';
  const DOT_COLORS = ['#6366F1', '#06B6D4', '#EC4899', '#F59E0B', '#10B981', '#8B5CF6'];
  const ART = '<span class="av-txt">印</span>';

  const state = {
    page: 'agent',
    sessions: [],
    activeId: null,
    userFiles: [],
    kbQuery: '',
    previewFileId: null,
    kbCollapsed: false,
    coverManual: null,
    index: null,
    busy: false,
    composing: false
  };

  /* ---------------- 工具函数 ---------------- */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function uid(p) { return (p || 'id') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 6); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function fmtClock(ts) { const d = new Date(ts); return pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function fmtRel(ts) {
    const d = new Date(ts), now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return fmtClock(ts);
    const y = new Date(now.getTime() - 864e5);
    if (d.toDateString() === y.toDateString()) return '昨天 ' + fmtClock(ts);
    return (d.getMonth() + 1) + '-' + d.getDate();
  }
  function fmtBytes(n) {
    if (n < 1024) return n + ' B';
    if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
    return (n / 1048576).toFixed(2) + ' MB';
  }
  function byteLen(s) { try { return new Blob([s]).size; } catch (e) { return String(s).length; } }

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('is-show'));
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('is-show');
      setTimeout(() => { el.hidden = true; }, 260);
    }, 2400);
  }

  function load(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) { return fallback; }
  }
  function save(key, val) {
    try { localStorage.setItem(key, JSON.stringify(val)); return true; }
    catch (e) { return false; }
  }

  /* ---------------- 知识库 ---------------- */
  function builtinFiles() {
    return (window.KB_FILES || []).map((f) => Object.assign({}, f, { builtin: true, enabled: f.enabled !== false }));
  }
  function allFiles() { return builtinFiles().concat(state.userFiles); }

  function fileSections(fileId) {
    if (!state.index) return [];
    return state.index.chunks.filter((c) => c.fileId === fileId).map((c) => c.section);
  }

  function rebuildIndex() {
    state.index = window.KBEngine.buildIndex(allFiles());
    renderKbMeta();
    renderSessionKBStat();
  }

  function renderKbMeta() {
    const files = allFiles().filter((f) => f.enabled !== false);
    $('#kbMeta').textContent = files.length + ' 份资料 · ' + state.index.chunks.length + ' 个知识小节';
  }
  function renderSessionKBStat() {
    const mine = state.userFiles.length;
    $('#kbStatText').textContent = '知识库已就绪' + (mine ? ' · 含 ' + mine + ' 份我的资料' : '');
  }

  function extOf(name) {
    const m = String(name).toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : 'other';
  }
  function icoClass(ext) { return ['md', 'markdown'].indexOf(ext) > -1 ? 'f-md' : ext === 'txt' ? 'f-txt' : ext === 'csv' ? 'f-csv' : ext === 'json' ? 'f-json' : 'f-other'; }

  function renderKbList() {
    const list = $('#kbList');
    const q = state.kbQuery.trim().toLowerCase();
    const files = allFiles().filter((f) => {
      if (!q) return true;
      if (f.name.toLowerCase().indexOf(q) > -1) return true;
      if (String(f.category || '').toLowerCase().indexOf(q) > -1) return true;
      return fileSections(f.id).some((s) => s.toLowerCase().indexOf(q) > -1);
    });

    if (!files.length) {
      list.innerHTML = '<div class="kb-empty">没找到匹配的资料<br>换个关键词，或把文件拖到这里</div>';
      return;
    }

    list.innerHTML = files.map((f) => {
      const ext = extOf(f.name);
      const secs = fileSections(f.id).length;
      const bytes = byteLen(f.content || '');
      const tags = f.builtin
        ? '<span class="file-tag">' + esc(f.category || '内置') + '</span>'
        : '<span class="file-tag mine">我的资料</span>';
      return '' +
        '<div class="kb-file' + (f.enabled === false ? ' is-off' : '') + '" data-id="' + esc(f.id) + '">' +
          '<div class="file-ico ' + icoClass(ext) + '">' + esc(ext.toUpperCase().slice(0, 4)) + '</div>' +
          '<div class="file-main">' +
            '<div class="file-name" title="' + esc(f.name) + '">' + esc(f.name) + '</div>' +
            '<div class="file-meta">' + tags +
              '<span>' + secs + ' 个小节</span><span>·</span><span>' + fmtBytes(bytes) + '</span>' +
            '</div>' +
          '</div>' +
          '<div class="file-acts">' +
            '<button class="icon-btn sm" data-act="preview" title="查看内容">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12Z"/><circle cx="12" cy="12" r="2.6"/></svg>' +
            '</button>' +
            '<button class="icon-btn sm' + (f.enabled === false ? '' : ' on') + '" data-act="toggle" title="' + (f.enabled === false ? '启用' : '停用') + '">' +
              '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3v9"/><path d="M6.6 6.6a7.5 7.5 0 1 0 10.8 0"/></svg>' +
            '</button>' +
            (f.builtin ? '' :
              '<button class="icon-btn sm danger" data-act="del" title="删除">' +
                '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M9 7V5h6v2M7 7l1 13h8l1-13"/></svg>' +
              '</button>') +
          '</div>' +
        '</div>';
    }).join('');
  }

  function openPreview(fileId) {
    const f = allFiles().filter((x) => x.id === fileId)[0];
    if (!f) return;
    state.previewFileId = fileId;
    $('#kbPreview').hidden = false;
    $('#kbList').hidden = true;
    $('#kbTools').hidden = true;
    $('#previewName').textContent = f.name;
    $('#previewMeta').textContent = (f.category || '知识库') + ' · ' + fileSections(f.id).length + ' 个小节 · ' + fmtBytes(byteLen(f.content || ''));
    $('#previewBody').innerHTML = renderDoc(f.content || '');
    setKbCollapsed(false);
  }
  function closePreview() {
    state.previewFileId = null;
    $('#kbPreview').hidden = true;
    $('#kbList').hidden = false;
    $('#kbTools').hidden = false;
  }

  function renderDoc(text) {
    const lines = String(text).split(/\r?\n/);
    let html = '', inList = false;
    const closeList = () => { if (inList) { html += '</ul>'; inList = false; } };
    lines.forEach((line) => {
      const t = line.trim();
      if (!t) { closeList(); return; }
      if (/^#\s+/.test(t)) { closeList(); html += '<h2>' + esc(t.replace(/^#\s+/, '')) + '</h2>'; return; }
      if (/^#{2,6}\s+/.test(t)) { closeList(); html += '<h3>' + esc(t.replace(/^#{2,6}\s+/, '')) + '</h3>'; return; }
      if (/^[-*·•]\s+/.test(t)) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += '<li>' + esc(t.replace(/^[-*·•]\s+/, '')) + '</li>';
        return;
      }
      closeList();
      html += '<p>' + esc(t) + '</p>';
    });
    closeList();
    return html;
  }

  function setKbCollapsed(v) {
    state.kbCollapsed = !!v;
    $('#kbPanel').classList.toggle('is-collapsed', state.kbCollapsed);
    $('#kbFab').hidden = !(state.kbCollapsed && state.page === 'agent');
  }

  /* ---------------- 会话 ---------------- */
  function persistSessions() {
    const ok = save(K_SESSIONS, state.sessions);
    if (!ok) toast('本地存储已满，建议删除一些历史对话');
  }
  function activeSession() { return state.sessions.filter((s) => s.id === state.activeId)[0] || null; }

  function ensureSession() {
    let s = activeSession();
    if (!s) {
      s = { id: uid('s'), title: '新对话', createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
      state.sessions.unshift(s);
      state.activeId = s.id;
      persistSessions();
      renderSessions();
    }
    return s;
  }

  function newChat() {
    if (state.busy) return;
    const cur = activeSession();
    if (cur && !cur.messages.length) { switchTo(cur.id); return; }
    const s = { id: uid('s'), title: '新对话', createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
    state.sessions.unshift(s);
    state.activeId = s.id;
    persistSessions();
    renderSessions();
    switchTo(s.id);
  }

  function switchTo(id) {
    state.activeId = id;
    state.previewFileId = null;
    closePreview();
    persistSessions();
    renderSessions();
    renderMessages();
  }

  function removeSession(id) {
    const idx = state.sessions.findIndex((s) => s.id === id);
    if (idx < 0) return;
    state.sessions.splice(idx, 1);
    if (state.activeId === id) {
      state.activeId = state.sessions.length ? state.sessions[0].id : null;
      if (!state.sessions.length) {
        const s = { id: uid('s'), title: '新对话', createdAt: Date.now(), updatedAt: Date.now(), messages: [] };
        state.sessions.unshift(s);
        state.activeId = s.id;
      }
      renderMessages();
    }
    persistSessions();
    renderSessions();
    toast('对话已删除');
  }

  function renderSessions() {
    const wrap = $('#sessionList');
    const list = state.sessions.slice().sort((a, b) => b.updatedAt - a.updatedAt);
    if (!list.length) {
      wrap.innerHTML = '<div class="session-empty">还没有对话记录。<br>问一句试试？</div>';
      return;
    }
    wrap.innerHTML = list.map((s, i) => {
      const color = DOT_COLORS[i % DOT_COLORS.length];
      const last = s.messages.length ? s.messages[s.messages.length - 1] : null;
      const sub = last ? fmtRel(last.ts) + ' · ' + (last.role === 'user' ? '我' : '印匠') : '尚未开始';
      return '' +
        '<button class="session-item' + (s.id === state.activeId ? ' is-active' : '') + '" data-id="' + esc(s.id) + '">' +
          '<span class="session-dot" style="background:' + color + '">' + esc((s.title || '新').slice(0, 1)) + '</span>' +
          '<span class="session-main"><b>' + esc(s.title) + '</b><span>' + esc(sub) + '</span></span>' +
          '<span class="session-del" data-del="' + esc(s.id) + '" title="删除">' +
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
          '</span>' +
        '</button>';
    }).join('');
  }

  /* ---------------- 消息渲染 ---------------- */
  function scrollBottom(force) {
    const el = $('#chatScroll');
    if (!el) return;
    if (force) el.scrollTop = el.scrollHeight;
    else {
      const near = el.scrollHeight - el.scrollTop - el.clientHeight < 140;
      if (near) el.scrollTop = el.scrollHeight;
    }
  }

  function kindTag(kind) {
    if (kind === 'nomatch') return '<span class="kind-tag warn">未命中知识库</span>';
    if (kind === 'kb-off') return '<span class="kind-tag warn">未引用知识库</span>';
    if (kind === 'catalog') return '<span class="kind-tag" style="background:#EEF0FF;color:#4F46E5">知识库目录</span>';
    return '';
  }

  function answerHTML(a) {
    let h = '';
    if (a.lead) h += '<div class="bubble-lead">' + esc(a.lead) + '</div>';
    if (a.points && a.points.length) {
      h += '<ul class="points">' + a.points.map((p) => '<li><span class="p-dot"></span><span>' + esc(p.text) + '</span></li>').join('') + '</ul>';
    }
    if (a.tips && a.tips.length) {
      h += a.tips.map((t) => '<div class="tip-box"><span class="tip-ico">💡</span><span>' + esc(t) + '</span></div>').join('');
    }
    if (a.sources && a.sources.length) {
      h += '<div class="src-row"><em>出处</em>' + a.sources.map((s) =>
        '<button class="src-chip" data-file="' + esc(s.fileId) + '">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/></svg>' +
          esc(s.section) + ' <span class="src-file">' + esc(String(s.fileName).replace(/\.[^.]+$/, '')) + '</span>' +
        '</button>').join('') + '</div>';
    }
    if (a.related && a.related.length) {
      h += '<div class="rel-row"><em>接着问</em>' + a.related.map((r) =>
        '<button class="rel-chip" data-q="' + esc(r) + '">' + esc(r) + '</button>').join('') + '</div>';
    }
    return h;
  }

  function buildMsgEl(msg) {
    const el = document.createElement('div');
    if (msg.role === 'user') {
      el.className = 'msg msg-user';
      el.innerHTML = '<div class="bubble"><div class="bubble-body">' + esc(msg.text) + '</div><div class="msg-time">' + fmtClock(msg.ts) + '</div></div>';
    } else {
      const a = msg.answer || {};
      el.className = 'msg msg-ai';
      el.innerHTML = '<div class="avatar">' + ART + '</div>' +
        '<div class="bubble"><div class="bubble-body">' + kindTag(a.kind) + answerHTML(a) + '</div>' +
        '<div class="msg-time">印匠 · ' + fmtClock(msg.ts) + '</div></div>';
    }
    return el;
  }

  function renderMessages() {
    const s = activeSession();
    const scroll = $('#chatScroll');
    const empty = $('#chatEmpty');
    $$('.msg', scroll).forEach((n) => n.remove());
    if (!s || !s.messages.length) {
      empty.hidden = false;
      applyCover();
      return;
    }
    empty.hidden = true;
    const frag = document.createDocumentFragment();
    s.messages.forEach((m) => frag.appendChild(buildMsgEl(m)));
    scroll.appendChild(frag);
    applyCover();
    scrollBottom(true);
  }

  /* ---------------- 封面状态 ---------------- */
  function applyCover() {
    const s = activeSession();
    const has = !!(s && s.messages.length);
    let compact = has;
    if (state.coverManual !== null) compact = state.coverManual;
    $('#cover').classList.toggle('is-compact', compact);
    $('#coverToggle').title = compact ? '展开封面' : '收起封面';
  }

  /* ---------------- 提问流程 ---------------- */
  function composeAnswer(text) {
    if (!$('#kbSwitch').checked) {
      return {
        kind: 'kb-off',
        lead: '你把「引用知识库」关掉了，这一条我没去翻资料，只能凭经验泛泛说，不保证准确。',
        points: [
          { text: '打开输入框左下角的「引用知识库」开关，我会到右边的资料里检索，并把出处标给你。', bullet: true },
          { text: '印刷这行细节多，差一个参数就是一批货的事，有出处你才好核对。', bullet: true }
        ],
        tips: ['把开关打开再问一次，答案会具体很多。'],
        sources: [],
        related: []
      };
    }
    if (!state.index) rebuildIndex();
    return window.KBEngine.answer(text, state.index);
  }

  function appendTyping() {
    const el = document.createElement('div');
    el.className = 'msg msg-ai';
    el.innerHTML = '<div class="avatar">' + ART + '</div>' +
      '<div class="bubble"><div class="bubble-body"><div class="typing"><i></i><i></i><i></i></div></div></div>';
    $('#chatScroll').appendChild(el);
    scrollBottom(true);
    return el;
  }

  function send(text) {
    const value = String(text == null ? $('#input').value : text).trim();
    if (!value || state.busy) return;
    const s = ensureSession();
    const userMsg = { role: 'user', text: value, ts: Date.now() };
    s.messages.push(userMsg);
    if (s.title === '新对话') s.title = value.slice(0, 18);
    s.updatedAt = Date.now();

    $('#chatEmpty').hidden = true;
    $('#chatScroll').appendChild(buildMsgEl(userMsg));
    if (state.coverManual === null) { $('#cover').classList.add('is-compact'); }
    scrollBottom(true);

    $('#input').value = '';
    autoGrow();
    state.busy = true;
    $('#sendBtn').disabled = true;
    const typing = appendTyping();

    const delay = 420 + Math.min(1000, value.length * 26) + Math.random() * 380;
    setTimeout(() => {
      typing.remove();
      const answer = composeAnswer(value);
      const aiMsg = { role: 'ai', answer: answer, ts: Date.now() };
      s.messages.push(aiMsg);
      s.updatedAt = Date.now();
      $('#chatScroll').appendChild(buildMsgEl(aiMsg));
      state.busy = false;
      $('#sendBtn').disabled = false;
      persistSessions();
      renderSessions();
      scrollBottom(true);
      $('#input').focus();
    }, delay);
  }

  /* ---------------- 输入框 ---------------- */
  function autoGrow() {
    const t = $('#input');
    t.style.height = 'auto';
    t.style.height = Math.min(132, Math.max(24, t.scrollHeight)) + 'px';
  }

  /* ---------------- 页面切换 ---------------- */
  function setPage(page) {
    state.page = page;
    $('#pager').setAttribute('data-active', page);
    $$('.pager-btn').forEach((b) => b.classList.toggle('is-active', b.dataset.page === page));
    $('#viewAgent').hidden = page !== 'agent';
    $('#viewTools').hidden = page !== 'tools';
    $('#kbPanel').hidden = page !== 'agent';
    $('#kbFab').hidden = !(state.kbCollapsed && page === 'agent');
  }

  /* ---------------- 事件绑定 ---------------- */
  function bind() {
    /* 页面切换 */
    $$('.pager-btn').forEach((b) => b.addEventListener('click', () => setPage(b.dataset.page)));

    /* 新建 / 删除会话 */
    $('#btnNewChat').addEventListener('click', newChat);
    $('#sessionList').addEventListener('click', (e) => {
      const del = e.target.closest('[data-del]');
      if (del) { e.stopPropagation(); removeSession(del.dataset.del); return; }
      const item = e.target.closest('.session-item');
      if (item) switchTo(item.dataset.id);
    });

    /* 发送 */
    $('#sendBtn').addEventListener('click', () => send());
    const input = $('#input');
    input.addEventListener('input', autoGrow);
    input.addEventListener('compositionstart', () => { state.composing = true; });
    input.addEventListener('compositionend', () => { state.composing = false; });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !state.composing) { e.preventDefault(); send(); }
    });

    /* 封面 */
    $('#coverToggle').addEventListener('click', () => {
      const compact = $('#cover').classList.toggle('is-compact');
      state.coverManual = compact;
      $('#coverToggle').title = compact ? '展开封面' : '收起封面';
    });

    /* 快捷提问 & 空态卡片 & 延伸问题 & 出处 */
    document.addEventListener('click', (e) => {
      const ask = e.target.closest('[data-q]');
      if (ask) { send(ask.dataset.q.replace(/^“|”$/g, '')); return; }
      const src = e.target.closest('[data-file]');
      if (src) {
        setKbCollapsed(false);
        openPreview(src.dataset.file);
        return;
      }
    });

    /* 知识库：收起 / 展开 */
    $('#kbToggleBtn').addEventListener('click', () => setKbCollapsed(!state.kbCollapsed));
    $('#kbFab').addEventListener('click', () => setKbCollapsed(false));

    /* 知识库：搜索 */
    $('#kbSearch').addEventListener('input', (e) => { state.kbQuery = e.target.value; renderKbList(); });

    /* 知识库：文件操作 */
    $('#kbList').addEventListener('click', (e) => {
      const row = e.target.closest('.kb-file');
      if (!row) return;
      const id = row.dataset.id;
      const act = e.target.closest('[data-act]');
      const file = allFiles().filter((f) => f.id === id)[0];
      if (!file) return;
      if (!act) { openPreview(id); return; }
      if (act.dataset.act === 'preview') {
        if (state.previewFileId === id) closePreview(); else openPreview(id);
      } else if (act.dataset.act === 'toggle') {
        if (file.builtin) {
          const b = (window.KB_FILES || []).filter((f) => f.id === id)[0];
          b.enabled = file.enabled === false;
        } else {
          file.enabled = file.enabled === false;
          save(K_FILES, state.userFiles);
        }
        rebuildIndex();
        renderKbList();
        toast((file.enabled === false ? '已停用' : '已启用') + '：' + file.name);
      } else if (act.dataset.act === 'del') {
        const i = state.userFiles.findIndex((f) => f.id === id);
        if (i > -1) {
          state.userFiles.splice(i, 1);
          save(K_FILES, state.userFiles);
          rebuildIndex();
          renderKbList();
          if (state.previewFileId === id) closePreview();
          toast('已删除：' + file.name);
        }
      }
    });

    /* 知识库：预览返回 */
    $('#previewBack').addEventListener('click', closePreview);
    $('#previewAsk').addEventListener('click', () => {
      const f = allFiles().filter((x) => x.id === state.previewFileId)[0];
      if (!f) return;
      setPage('agent');
      send('《' + f.name + '》这份资料主要讲了什么？');
    });

    /* 知识库：重置 */
    $('#btnResetKb').addEventListener('click', () => {
      if (!state.userFiles.length) { toast('当前已经是内置知识库'); return; }
      state.userFiles = [];
      save(K_FILES, state.userFiles);
      (window.KB_FILES || []).forEach((f) => { f.enabled = true; });
      rebuildIndex();
      renderKbList();
      closePreview();
      toast('已恢复内置知识库');
    });

    /* 上传 */
    const dz = $('#dropzone');
    const fi = $('#fileInput');
    dz.addEventListener('click', () => fi.click());
    fi.addEventListener('change', () => { handleFiles(fi.files); fi.value = ''; });
    ['dragenter', 'dragover'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('is-over'); }));
    ['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('is-over'); }));
    dz.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files) handleFiles(e.dataTransfer.files); });

    /* 视图自适应 */
    window.addEventListener('resize', () => {
      if (window.innerWidth <= 1120 && !state.kbCollapsed) setKbCollapsed(true);
    });
  }

  function handleFiles(fileList) {
    const files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return;
    const ok = /\.(md|markdown|txt|csv|json|log|text)$/i;
    let pending = files.filter((f) => ok.test(f.name) || /^text\//.test(f.type)).length;
    let added = 0, chars = 0;

    files.forEach((f) => {
      const good = ok.test(f.name) || /^text\//.test(f.type);
      if (!good) { toast('已跳过不支持的文件：' + f.name); pending--; return; }
      const reader = new FileReader();
      reader.onload = () => {
        const content = String(reader.result || '');
        state.userFiles.push({
          id: uid('u'),
          name: f.name,
          category: '我的资料',
          tags: [],
          date: new Date().toISOString().slice(0, 10),
          content: content,
          enabled: true,
          userUploaded: true
        });
        added++; chars += content.length;
        pending--;
        if (pending <= 0) finish();
      };
      reader.onerror = () => { pending--; if (pending <= 0) finish(); };
      reader.readAsText(f, 'utf-8');
    });

    function finish() {
      const okSave = save(K_FILES, state.userFiles);
      rebuildIndex();
      renderKbList();
      toast('已导入 ' + added + ' 份资料，新增 ' + state.index.chunks.length + ' 个知识小节' + (okSave ? '' : '（存储空间不足，仅本次有效）'));
    }
  }

  /* ---------------- 初始化 ---------------- */
  function init() {
    state.userFiles = load(K_FILES, []);
    state.sessions = load(K_SESSIONS, []);
    if (!state.sessions.length) {
      state.sessions = [{ id: uid('s'), title: '新对话', createdAt: Date.now(), updatedAt: Date.now(), messages: [] }];
      persistSessions();
    }
    state.activeId = state.sessions[0].id;

    rebuildIndex();
    renderSessions();
    renderKbList();
    closePreview();
    setPage('agent');
    if (window.innerWidth <= 1120) setKbCollapsed(true);
    applyCover();
    $('#input').focus();
  }

  bind();
  init();
})();
