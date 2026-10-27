/* 마을작가 책 만들기 — 작은BOOK·큰BOOK·동네BOOK 글 마무리 · AI 교정 · 신국판 합본 */
(() => {
  'use strict';
  const C = window.BK_CONFIG, CUR = window.CURRIC;
  const TOK = {
    get: () => localStorage.getItem('bk_token') || sessionStorage.getItem('bk_token') || '',
    shared: () => !localStorage.getItem('bk_token') && !!sessionStorage.getItem('bk_token'),
    set(t, shared) { this.clear(); (shared ? sessionStorage : localStorage).setItem('bk_token', t); },
    clear() { localStorage.removeItem('bk_token'); sessionStorage.removeItem('bk_token'); }
  };
  const S = { token: TOK.get(), me: null, tab: '', flush: null, cleanup: null };
  const IDLE_MIN = 20; // 공용 기기에서 이 시간(분) 동안 안 쓰면 자동 로그아웃
  const app = document.getElementById('app');
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const isStaff = () => !!S.me && S.me.role !== 'member';
  const ROLE = { member: '참여자', teacher: '강사', admin: '운영자' };
  const TRACKS = ['small', 'big', 'town'];
  const hhmm = d => { const t = d ? new Date(d) : new Date(); return `${String(t.getHours()).padStart(2, '0')}:${String(t.getMinutes()).padStart(2, '0')}`; };
  const fmtTime = d => { if (!d) return ''; const t = new Date(d); return `${t.getMonth() + 1}/${t.getDate()} ${hhmm(t)}`; };
  const PX = 152 * 96 / 25.4; // 신국판 가로 폭(px, 확대 1배)
  // 첫 로그인 안내·동의. config.js에 consent를 넣으면 그 글로 바뀌고, version을 올리면 모두 다시 동의를 받음
  const CONSENT = Object.assign({
    version: '1',
    photo: '수업 사진(회차 사진)은 같은 과정 참여자 모두가 볼 수 있고, 과정 구분 없이 올린 "전체 공용" 사진은 모든 과정 참여자가 볼 수 있어요. 앱에 올린 사진은 주소(링크)를 아는 사람이면 로그인 없이도 볼 수 있는 방식으로 저장돼요. 내가 나온 사진을 내리고 싶으면 언제든 선생님께 말씀해 주세요.',
    ai: '"AI 교정 받기"를 누르면 그 쪽의 글이 맞춤법과 문장을 고치기 위해 미국 회사 Anthropic의 AI(Claude) 서버로 보내져요. 동의하지 않아도 글쓰기와 책 만들기는 모두 할 수 있고, AI 교정만 쓸 수 없어요. 나중에 오른쪽 위 내 이름을 눌러 바꿀 수 있어요.',
    guardian: '어린이는 보호자와 함께 읽고 체크해 주세요.'
  }, C.consent || {});
  const needConsent = () => S.me && S.me.role === 'member' && !(S.me.consent && S.me.consent.ver === CONSENT.version);
  const aiOk = () => !S.me || S.me.role !== 'member' || !!(S.me.consent && S.me.consent.ai);
  const enter = () => { startIdle(); return needConsent() ? consentView() : shell(); };

  // ---------- 알림 ----------
  let toastT;
  function toast(msg, bad) {
    const t = $('#toast');
    t.textContent = msg; t.className = 'show' + (bad ? ' bad' : '');
    clearTimeout(toastT); toastT = setTimeout(() => { t.className = ''; }, 3400);
  }

  // ---------- 서버 ----------
  function headers(extra) {
    const h = { apikey: C.key, ...extra };
    if (C.key.startsWith('eyJ')) h.Authorization = 'Bearer ' + C.key;
    return h;
  }
  async function rpc(fn, body) {
    let r;
    try {
      r = await fetch(`${C.url}/rest/v1/rpc/${fn}`, { method: 'POST', headers: headers({ 'Content-Type': 'application/json' }), body: JSON.stringify(body) });
    } catch { throw new Error('인터넷 연결을 확인해 주세요.'); }
    if (!r.ok) throw new Error(`서버 오류가 났어요 (${r.status}). 잠시 뒤 다시 해 주세요.`);
    return r.json();
  }
  async function api(action, data = {}) {
    const res = await rpc('bk_api', { p_token: S.token, p_action: action, p_data: data });
    if (res && res.error === 'auth') { signOutLocal(); throw new Error('다시 로그인해 주세요.'); }
    if (res && res.error) { const e = new Error(res.error); e.data = res; throw e; }
    return res;
  }
  function signOutLocal() { stopIdle(); S.token = ''; S.me = null; S.dirty = false; TOK.clear(); loginView(); }
  // 공용 기기 자동 로그아웃
  let idleT = null, lastAct = Date.now();
  const IDLE_EV = ['pointerdown', 'keydown', 'input', 'scroll', 'touchstart'];
  const bump = () => { lastAct = Date.now(); };
  function stopIdle() { clearInterval(idleT); idleT = null; IDLE_EV.forEach(ev => window.removeEventListener(ev, bump, true)); }
  function startIdle() {
    stopIdle();
    if (!TOK.shared()) return;
    lastAct = Date.now();
    IDLE_EV.forEach(ev => window.addEventListener(ev, bump, { capture: true, passive: true }));
    idleT = setInterval(async () => {
      if (Date.now() - lastAct < IDLE_MIN * 60000) return;
      stopIdle();
      if (S.flush) { try { await S.flush(); } catch { /* 저장 실패해도 로그아웃 */ } }
      try { await api('logout'); } catch { /* 무시 */ }
      document.querySelectorAll('dialog').forEach(d => d.close());
      signOutLocal(); toast(`${IDLE_MIN}분 동안 쓰지 않아서 로그아웃했어요.`);
    }, 20000);
  }

  // ---------- 사진 ----------
  function pickFiles(multiple) {
    return new Promise(res => {
      const i = document.createElement('input');
      i.type = 'file'; i.accept = 'image/*'; i.multiple = !!multiple;
      i.onchange = () => res([...i.files]);
      i.click();
    });
  }
  const pickFile = async () => (await pickFiles(false))[0] || null;
  // 큰 그림(인쇄용, 긴 변 3200px)과 작은 그림(목록용, 480px)을 만듦. turn: 시계 방향 90도 단위
  async function encode(src, turn = 0) {
    let bmp;
    try { bmp = await createImageBitmap(src); } catch { throw new Error('이 사진 형식은 열 수 없어요. JPG나 PNG로 올려 주세요.'); }
    const draw = max => {
      const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const w0 = Math.round(bmp.width * k), h0 = Math.round(bmp.height * k), rot = turn % 2 === 1;
      const cv = document.createElement('canvas'); cv.width = rot ? h0 : w0; cv.height = rot ? w0 : h0;
      const cx = cv.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, cv.width, cv.height);
      cx.translate(cv.width / 2, cv.height / 2); cx.rotate(turn * Math.PI / 2); cx.drawImage(bmp, -w0 / 2, -h0 / 2, w0, h0);
      return new Promise(r => cv.toBlob(b => r({ b, w: cv.width, h: cv.height }), 'image/jpeg', max > 1000 ? 0.9 : 0.8));
    };
    return [await draw(3200), await draw(480)];
  }
  async function store([big, small]) {
    const { ticket } = await api('ticket');
    const put = async (b, suf) => {
      const path = `t/${ticket}/${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}${suf}.jpg`;
      const r = await fetch(`${C.url}/storage/v1/object/${C.bucket}/${path}`, { method: 'POST', headers: headers({ 'Content-Type': 'image/jpeg', 'x-upsert': 'false' }), body: b });
      if (!r.ok) throw new Error(`사진을 올리지 못했어요 (${r.status}).`);
      return `${C.url}/storage/v1/object/public/${C.bucket}/${path}`;
    };
    return { url: await put(big.b, ''), thumb: await put(small.b, '_s'), w: big.w, h: big.h };
  }
  const uploadImage = async file => ({ ...(await store(await encode(file))), fit: 'cover' });
  // 사진 자체를 돌려 새로 저장 (PDF에도 돌린 방향 그대로)
  async function rotateImage(im, turn) {
    let r = null;
    try { r = await fetch(im.url); } catch { /* 아래에서 처리 */ }
    if (!r || !r.ok) throw new Error('사진을 불러오지 못해서 돌리지 못했어요.');
    return { ...im, ...(await store(await encode(await r.blob(), turn))) };
  }
  const src = im => esc(im.thumb || im.url);
  const viewPhoto = url => modal(`<img class="big-photo" src="${esc(url)}" alt=""><div class="row end"><button class="btn" data-close>닫기</button></div>`, 'm-photo');
  const rotBtns = key => `<span class="rot"><button class="icon-btn" data-rot="${key}:3" aria-label="왼쪽으로 돌리기" title="왼쪽으로 돌리기">↺</button><button class="icon-btn" data-rot="${key}:1" aria-label="오른쪽으로 돌리기" title="오른쪽으로 돌리기">↻</button></span>`;
  // 돌리는 동안 버튼 막기
  async function busy(btn, label, fn) {
    const box = btn.closest('.tile, .slot') || btn.parentElement;
    const bs = [...box.querySelectorAll('button')]; bs.forEach(b => { b.disabled = true; });
    const old = btn.textContent; if (label) btn.textContent = label;
    try { return await fn(); } catch (err) { toast(err.message, true); return null; }
    finally { bs.forEach(b => { b.disabled = false; }); btn.textContent = old; }
  }

  // 쪽에 올린 사진을 사진첩에도 담기. 사진첩이 가득 차도 쪽에는 그대로 넣음
  async function toAlbum(im, owner) {
    try { await api('album_add', { url: im.url, thumb: im.thumb, w: im.w, h: im.h, id: owner }); }
    catch (err) { toast('쪽에는 넣었지만 사진첩에는 담지 못했어요: ' + err.message, true); }
  }

  // 회차 사진 묶음: 1~4회차 → 구분 안 함 → 전체 공용 (track 'all'이면 전체 공용만)
  const ALL = 'all';
  function photoGroups(tr, photos) {
    const g = [];
    if (tr !== ALL) {
      CUR[tr].sessions.forEach(se => g.push({ track: tr, no: se.no, title: `${se.no}회차 ${se.title}`, sub: se.day, list: photos.filter(p => p.track === tr && p.no === se.no) }));
      g.push({ track: tr, no: 0, title: '구분 안 함', sub: `${CUR[tr].name} 사진인데 몇 회차인지 모르는 것`, list: photos.filter(p => p.track === tr && p.no === 0) });
    }
    g.push({ track: ALL, no: 0, title: '전체 공용', sub: '과정 구분 없이 올린 사진 — 모든 과정 참여자가 봐요', list: photos.filter(p => p.track === ALL) });
    return g;
  }
  const allSpine = on => `<button class="spine s-all" data-tr="${ALL}" aria-pressed="${on ? 'true' : 'false'}"><b>전체 공용</b><small>과정 구분 없음</small></button>`;
  const moveSelect = p => `<select class="mv" data-move="${p.id}" aria-label="다른 곳으로 옮기기"><option value="">옮기기…</option>
      <option value="${ALL}:0" ${p.track === ALL ? 'disabled' : ''}>전체 공용</option>
      ${TRACKS.map(t => `<optgroup label="${esc(CUR[t].name)}"><option value="${t}:0" ${p.track === t && p.no === 0 ? 'disabled' : ''}>구분 안 함</option>${CUR[t].sessions.map(se => `<option value="${t}:${se.no}" ${p.track === t && p.no === se.no ? 'disabled' : ''}>${se.no}회차 ${esc(se.title)}</option>`).join('')}</optgroup>`).join('')}</select>`;

  // 사진첩·회차 사진에서 고르기 (owner: 강사가 대신 고칠 때 그 사람 id)
  async function photoPicker({ owner, track }) {
    const [al, ph] = await Promise.all([api('album', { id: owner || '' }), api('photos', { track, id: owner || '' })]);
    const album = al.album, photos = ph.photos;
    return new Promise(resolve => {
      let done = false;
      const fin = v => { if (!done) { done = true; resolve(v); d.close(); } };
      const sess = photoGroups(track, photos).map(gr => gr.list.length ? `<details class="pk-sess"><summary>${esc(gr.title)} <small>${gr.list.length}장</small></summary>
          <div class="grid-ph">${gr.list.map(p => `<button class="pk" data-p="${p.id}"><img src="${src(p)}" alt="" loading="lazy"></button>`).join('')}</div></details>` : '').join('');
      const d = modal(`<h2>사진 고르기</h2>
        <button class="btn btn-main btn-wide" data-new>새 사진 올리기</button>
        <h3 class="pk-h">내 사진첩</h3>
        ${album.length ? `<div class="grid-ph">${album.map((a, i) => `<button class="pk" data-a="${i}"><img src="${src(a)}" alt="" loading="lazy"></button>`).join('')}</div>` : '<p class="muted">아직 사진첩이 비어 있어요. 아래 회차 사진에서 고르거나 새로 올리면 사진첩에도 담겨요.</p>'}
        <h3 class="pk-h">회차 사진</h3>${sess || '<p class="muted">아직 올라온 회차 사진이 없어요.</p>'}
        <div class="row end"><button class="btn btn-ghost" data-close>닫기</button></div>`, 'm-pick');
      d.addEventListener('close', () => { if (!done) { done = true; resolve(null); } });
      d.onclick = async e => {
        const a = e.target.closest('[data-a]');
        if (a) { const it = album[+a.dataset.a]; fin({ url: it.url, thumb: it.thumb, w: it.w, h: it.h, fit: 'cover' }); return; }
        const p = e.target.closest('[data-p]');
        if (p) {
          const r = await busy(p, '', () => api('album_add', { src: p.dataset.p, id: owner || '' }));
          if (r) fin({ url: r.item.url, thumb: r.item.thumb, w: r.item.w, h: r.item.h, fit: 'cover' });
          return;
        }
        const n = e.target.closest('[data-new]');
        if (n) {
          const f = await pickFile(); if (!f) return;
          const im = await busy(n, '올리는 중…', async () => { const x = await uploadImage(f); await toAlbum(x, owner || ''); return x; });
          if (im) fin(im);
        }
      };
    });
  }

  // ---------- 창 ----------
  function modal(html, cls = '') {
    const d = document.createElement('dialog');
    d.className = 'modal ' + cls; d.innerHTML = `<div class="modal-in">${html}</div>`;
    document.body.append(d);
    d.addEventListener('close', () => d.remove());
    d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
    d.showModal();
    return d;
  }
  const ask = (title, msg, yes = '네') => new Promise(res => {
    const d = modal(`<h2>${esc(title)}</h2>${msg ? `<p>${esc(msg)}</p>` : ''}<div class="row end"><button class="btn btn-ghost" data-close>아니요</button><button class="btn btn-main" id="yes">${esc(yes)}</button></div>`);
    $('#yes', d).onclick = () => { res(true); d.close(); };
    d.addEventListener('close', () => res(false));
  });

  // 과정 표시 (책등 모양)
  const spine = (tr, on, attr = 'data-tr') => `<button class="spine s-${tr}" ${attr}="${tr}" aria-pressed="${on ? 'true' : 'false'}"><b>${esc(CUR[tr].name)}</b><small>${esc(CUR[tr].who)}</small></button>`;

  // ---------- 로그인 ----------
  function loginView() {
    app.innerHTML = `<div class="login">
      <div class="shelf-mark" aria-hidden="true">${TRACKS.map(tr => `<span class="s-${tr}">${esc(CUR[tr].name)}</span>`).join('')}</div>
      <h1 class="login-t">${esc(C.title)}</h1>
      <p class="login-sub">수업에서 쓴 이야기를 마무리해서, 한 권의 책에 싣는 곳이에요.</p>
      <form id="lf" class="login-form">
        <label class="f">이름<input id="lname" autocomplete="username" required></label>
        <label class="f">PIN 네 자리<input id="lpin" type="password" inputmode="numeric" pattern="[0-9]{4}" maxlength="4" autocomplete="current-password" required></label>
        <label class="check shared"><input type="checkbox" id="lshared"> 여러 사람이 같이 쓰는 기기예요 <small>창을 닫거나 ${IDLE_MIN}분 동안 안 쓰면 자동으로 로그아웃돼요</small></label>
        <button class="btn btn-main btn-wide" type="submit">들어가기</button>
        <p class="err" id="lerr" role="alert"></p>
      </form>
      <p class="muted">PIN을 잊었으면 선생님께 말씀해 주세요.</p></div>`;
    $('#lf').onsubmit = async e => {
      e.preventDefault();
      const btn = $('#lf button'); btn.disabled = true; $('#lerr').textContent = '';
      try {
        const shared = $('#lshared').checked;
        const r = await rpc('bk_login', { p_name: $('#lname').value, p_pin: $('#lpin').value, p_shared: shared });
        if (r.error) throw new Error(r.error);
        S.token = r.token; S.me = r.me; TOK.set(r.token, shared);
        S.tab = ''; enter();
      } catch (err) { $('#lerr').textContent = err.message; btn.disabled = false; }
    };
  }

  // ---------- 틀 ----------
  function tabsFor() {
    const t = [];
    if (!isStaff() || (S.me.tracks || []).length) t.push(['write', '내 책 쓰기'], ['album', '사진첩']);
    if (isStaff()) t.push(['board', '현황판'], ['photos', '회차 사진'], ['book', '책 만들기']);
    if (S.me.role === 'admin') t.push(['people', '참여자']);
    return t;
  }
  function shell() {
    const tabs = tabsFor();
    const want = S.tab || location.hash.slice(1);
    S.tab = tabs.some(t => t[0] === want) ? want : tabs[0][0];
    app.innerHTML = `
      <header class="top"><div class="top-in">
        <span class="brand">${esc(C.title)}</span>
        <button class="me" id="meBtn">${esc(S.me.name)}님<span class="role">${ROLE[S.me.role]}</span>${TOK.shared() ? '<span class="role shared-b">공용 기기</span>' : ''}</button>
      </div>
      ${tabs.length > 1 ? `<nav class="tabs" aria-label="메뉴">${tabs.map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join('')}</nav>` : ''}</header>
      <main id="view" class="view"></main>`;
    const nav = $('.tabs'); if (nav) nav.onclick = e => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); };
    $('#meBtn').onclick = meMenu;
    go(S.tab);
  }
  async function go(tab, arg) {
    if (S.flush) { try { await S.flush(); } catch { /* 저장 실패는 화면에 표시됨 */ } }
    S.flush = null;
    if (S.cleanup) { S.cleanup(); S.cleanup = null; }
    S.tab = tab;
    $$('.tabs [data-tab]').forEach(b => b.setAttribute('aria-current', b.dataset.tab === tab ? 'page' : 'false'));
    const v = $('#view');
    v.className = 'view view-' + tab;
    v.onclick = v.oninput = v.onchange = v.onsubmit = null;
    v.innerHTML = '<p class="loading">불러오는 중…</p>';
    if (tabsFor().some(t => t[0] === tab)) history.replaceState(null, '', '#' + tab);
    window.scrollTo(0, 0);
    try { await VIEWS[tab](v, arg || {}); }
    catch (e) {
      v.innerHTML = `<div class="empty"><p>${esc(e.message)}</p><button class="btn" id="retry">다시 불러오기</button></div>`;
      $('#retry', v).onclick = () => go(tab, arg);
    }
  }
  window.addEventListener('beforeunload', e => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } });
  // ---------- 첫 로그인 안내·동의 ----------
  function consentView() {
    app.innerHTML = `<div class="consent">
      <h1 class="login-t">${esc(S.me.name)}님, 시작하기 전에 읽어 주세요</h1>
      ${CONSENT.guardian ? `<p class="guardian">${esc(CONSENT.guardian)}</p>` : ''}
      <section class="c-box"><h2>사진에 대해</h2><p>${esc(CONSENT.photo)}</p>
        <label class="check"><input type="checkbox" id="cPhoto"> 읽고 확인했어요 <small>(꼭 체크)</small></label></section>
      <section class="c-box"><h2>AI 교정에 대해</h2><p>${esc(CONSENT.ai)}</p>
        <label class="check"><input type="checkbox" id="cAi"> AI 교정을 쓰는 데 동의해요 <small>(선택)</small></label></section>
      <button class="btn btn-main btn-wide" id="cGo" disabled>시작하기</button>
      <p class="err" id="cErr" role="alert"></p>
      <p class="muted center"><button class="linkbtn" id="cOut">다른 사람으로 들어가기</button></p></div>`;
    $('#cPhoto').onchange = e => { $('#cGo').disabled = !e.target.checked; };
    $('#cOut').onclick = async () => { try { await api('logout'); } catch { /* 무시 */ } signOutLocal(); };
    $('#cGo').onclick = async () => {
      $('#cGo').disabled = true;
      try { S.me.consent = (await api('consent', { ver: CONSENT.version, ai: $('#cAi').checked })).consent; S.tab = ''; shell(); }
      catch (err) { $('#cErr').textContent = err.message; $('#cGo').disabled = false; }
    };
  }
  // AI 교정 동의를 나중에 받거나 바꾸기
  async function setAi(on) {
    S.me.consent = (await api('consent', { ver: CONSENT.version, ai: on })).consent;
    toast(on ? 'AI 교정에 동의했어요.' : 'AI 교정 동의를 거둬들였어요. 이제 AI 교정을 쓸 수 없어요.');
  }
  function askAi() {
    return new Promise(res => {
      const d = modal(`<h2>AI 교정을 쓰려면 동의가 필요해요</h2><p>${esc(CONSENT.ai)}</p>${CONSENT.guardian ? `<p class="guardian">${esc(CONSENT.guardian)}</p>` : ''}
        <div class="row end"><button class="btn btn-ghost" data-close>안 쓸래요</button><button class="btn btn-main" id="aiYes">동의하고 교정 받기</button></div>`);
      $('#aiYes', d).onclick = async () => { try { await setAi(true); res(true); } catch (err) { toast(err.message, true); res(false); } d.close(); };
      d.addEventListener('close', () => res(false));
    });
  }

  function meMenu() {
    const member = S.me.role === 'member';
    const d = modal(`<h2>${esc(S.me.name)}님</h2><p class="muted">${ROLE[S.me.role]}</p>
      ${member ? `<p class="ai-state">AI 교정 동의: <b>${aiOk() ? '동의함' : '동의 안 함'}</b></p>` : ''}
      <div class="stack">${member ? `<button class="btn" id="mAi">${aiOk() ? 'AI 교정 동의 거둬들이기' : 'AI 교정에 동의하기'}</button>` : ''}<button class="btn" id="mPin">PIN 바꾸기</button><button class="btn" id="mOut">로그아웃</button><button class="btn btn-ghost" data-close>닫기</button></div>`);
    $('#mOut', d).onclick = async () => { if (S.flush) { try { await S.flush(); } catch { /* 무시 */ } } try { await api('logout'); } catch { /* 무시 */ } d.close(); signOutLocal(); };
    $('#mPin', d).onclick = () => { d.close(); pinDialog(); };
    const ai = $('#mAi', d);
    if (ai) ai.onclick = async () => { d.close(); if (aiOk()) { if (await ask('AI 교정 동의를 거둬들일까요?', '거둬들이면 AI 교정을 쓸 수 없어요. 이미 고친 글은 그대로예요.', '거둬들이기')) { try { await setAi(false); } catch (err) { toast(err.message, true); } } } else await askAi(); };
  }
  function pinDialog() {
    const d = modal(`<h2>PIN 바꾸기</h2><form id="pf" class="stack">
      <label class="f">지금 PIN<input id="p0" type="password" inputmode="numeric" maxlength="4" required></label>
      <label class="f">새 PIN (숫자 4자리)<input id="p1" type="password" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" required></label>
      <label class="f">새 PIN 한 번 더<input id="p2" type="password" inputmode="numeric" maxlength="4" required></label>
      <p class="err" id="perr" role="alert"></p>
      <div class="row end"><button type="button" class="btn btn-ghost" data-close>취소</button><button class="btn btn-main">PIN 바꾸기</button></div></form>`);
    $('#pf', d).onsubmit = async e => {
      e.preventDefault();
      if ($('#p1', d).value !== $('#p2', d).value) { $('#perr', d).textContent = '새 PIN 두 칸이 서로 달라요.'; return; }
      try { await api('pin_change', { old: $('#p0', d).value, new: $('#p1', d).value }); d.close(); toast('PIN을 바꿨어요.'); }
      catch (err) { $('#perr', d).textContent = err.message; }
    };
  }

  const VIEWS = {};

  // ---------- 쪽 틀 그림 (틀 고르기 버튼용) ----------
  function tplIcon(id) {
    const L = (y0, y1, x = 5, w = 20, dark) => { let s = ''; for (let y = y0; y <= y1; y += 3.4) s += `<rect x="${x}" y="${y}" width="${w}" height="1.5" rx=".7" class="${dark ? 'ld' : 'l'}"/>`; return s; };
    const I = (x, y, w, h) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="1" class="i"/>`;
    const map = {
      text: L(5, 38), title: `<rect x="6" y="11" width="18" height="3.4" rx="1" class="ld"/>${L(22, 32, 7, 16)}`,
      imgTop: I(4, 4, 22, 16) + L(24, 38), imgBottom: L(4, 18) + I(4, 24, 22, 16), imgSmall: I(9, 4, 12, 10) + L(18, 38),
      twoSide: I(4, 4, 10.5, 14) + I(15.5, 4, 10.5, 14) + L(22, 38), two: I(4, 3, 22, 17) + I(4, 21.5, 22, 17) + L(40, 40, 8, 14),
      grid4: I(4, 4, 10.5, 15) + I(15.5, 4, 10.5, 15) + I(4, 20.5, 10.5, 15) + I(15.5, 20.5, 10.5, 15) + L(39, 39, 8, 14),
      full: I(0, 0, 30, 44), fullText: I(0, 0, 30, 44) + '<rect x="3.5" y="27" width="23" height="13" rx="1" class="b"/>' + L(30, 37, 6, 18, true),
      poem: [8, 11.4, 14.8, 21.6, 25, 28.4].map((y, i) => `<rect x="${9 + (i % 3)}" y="${y}" width="${[12, 9, 11, 10, 12, 7][i]}" height="1.5" rx=".7" class="l"/>`).join(''),
      diary: '<rect x="4" y="5" width="22" height="15" rx="1" class="i o"/>' + [25, 29.5, 34, 38.5].map(y => `<rect x="4" y="${y}" width="22" height=".6" class="l"/>`).join(''),
      quote: '<text x="6" y="17" class="q">“</text>' + L(19, 26, 7, 16),
      free: '<rect x="3" y="3" width="24" height="38" rx="1" class="i o" style="fill:none;stroke-dasharray:1.2 1"/>' + I(5, 6, 13, 11) + L(20, 26, 6, 18) + I(14, 29, 11, 9)
    };
    return `<svg viewBox="0 0 30 44" aria-hidden="true">${map[id] || ''}</svg>`;
  }

  // ---------- AI 교정 ----------
  async function proofCall(body) {
    let r;
    try {
      r = await fetch(C.proofUrl || '/api/proof', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: S.token, ...body }) });
    } catch { throw new Error('인터넷 연결을 확인해 주세요.'); }
    let j = {};
    try { j = await r.json(); } catch { throw new Error(`교정 서버가 답하지 않아요 (${r.status}). 운영자에게 알려 주세요.`); }
    if (j.error === 'auth') { signOutLocal(); throw new Error('다시 로그인해 주세요.'); }
    if (!r.ok || j.error) throw new Error(j.error || `교정 중 오류가 났어요 (${r.status}).`);
    return j;
  }
  // text를 교정하고, 고른 것을 반영한 새 글을 돌려줌 (취소하면 null)
  function proofDialog({ text, kind, track, owner }) {
    return new Promise(resolve => {
      let done = false;
      const fin = v => { if (!done) { done = true; resolve(v); } };
      const d = modal(`<h2>AI 교정</h2>
        <p class="muted">고칠 곳을 알려 줘요. 마음에 드는 것만 골라서 반영하면 돼요. 내 말투는 그대로 둬요.</p>
        <div class="stack"><button class="btn btn-main" data-m="spell">맞춤법·띄어쓰기만 보기</button>
        <button class="btn" data-m="style">어색한 문장까지 보기</button>
        <button class="btn btn-ghost" data-close>닫기</button></div>`, 'm-proof');
      d.addEventListener('close', () => fin(null));
      d.onclick = async e => {
        const b = e.target.closest('[data-m]'); if (!b) return;
        const mi = $('.modal-in', d);
        mi.innerHTML = '<h2>AI 교정</h2><p class="loading">글을 꼼꼼히 읽는 중이에요… (10초쯤 걸려요)</p>';
        let res;
        try { res = await proofCall({ text, mode: b.dataset.m, kind, track, owner: owner || '' }); }
        catch (err) { mi.innerHTML = `<h2>AI 교정</h2><p class="err">${esc(err.message)}</p><div class="row end"><button class="btn" data-close>닫기</button></div>`; return; }
        const items = (res.items || []).filter(it => it && it.from && it.from !== it.to && text.includes(it.from));
        const one = t => t.replace(/\s+/g, ' ');
        const ctx = it => {
          const k = text.indexOf(it.from), e = k + it.from.length;
          return `${k > 16 ? '…' : ''}${esc(one(text.slice(Math.max(0, k - 16), k)))}<del>${esc(it.from)}</del><ins>${esc(it.to)}</ins>${esc(one(text.slice(e, e + 16)))}${e + 16 < text.length ? '…' : ''}`;
        };
        mi.innerHTML = `<h2>AI 교정</h2>
          ${res.comment ? `<p class="pf-comment">${esc(res.comment)}</p>` : ''}
          ${items.length ? `<p class="muted">${items.length}곳을 찾았어요. 반영하지 않을 것은 체크를 빼세요.</p>
            <ol class="pf-list">${items.map((it, i) => `<li><label class="check"><input type="checkbox" data-i="${i}" checked>
              <span><span class="pf-ctx">${ctx(it)}</span>${it.why ? `<small>${esc(it.why)}</small>` : ''}</span></label></li>`).join('')}</ol>
            <div class="row end"><button class="btn btn-ghost" data-close>그대로 두기</button><button class="btn btn-main" id="pfApply">고른 것 반영하기</button></div>`
            : '<p class="ok-msg">고칠 곳을 찾지 못했어요. 그대로 실어도 좋아요.</p><div class="row end"><button class="btn" data-close>닫기</button></div>'}`;
        const ap = $('#pfApply', mi);
        if (ap) ap.onclick = () => {
          let t = text, n = 0;
          $$('[data-i]', mi).filter(c => c.checked).forEach(c => {
            const it = items[+c.dataset.i], k = t.indexOf(it.from);
            if (k >= 0) { t = t.slice(0, k) + it.to + t.slice(k + it.from.length); n++; }
          });
          fin(n ? { text: t, n } : null); d.close();
        };
      };
    });
  }

  // 글꼴 고르기 (group별로 묶음). cur가 비면 "기본"
  function fontSelect(id, cur, label = '글꼴') {
    const groups = [...new Set(FONTS.map(f => f.group))];
    return `<label class="f">${label}<select id="${id}">
      <option value="" ${!cur ? 'selected' : ''}>기본 (${esc(FONT.def.name)})</option>
      ${groups.map(g => `<optgroup label="${esc(g)}">${FONTS.filter(f => f.group === g).map(f => `<option value="${f.id}" ${cur === f.id ? 'selected' : ''}>${esc(f.name)}${f.bold ? '' : ' (굵게 없음)'}</option>`).join('')}</optgroup>`).join('')}</select></label>`;
  }
  // 글꼴·크기·굵게 묶음 컨트롤. pre: 입력 id 앞글자, s: {font,size,bold}, sizeHint: 기본 크기 안내
  function fontControls(pre, s, sizeHint) {
    s = s || {};
    const canB = !s.font || FONT.canBold(s.font);
    const f = s.font ? FONT.get(s.font) : null;
    return `<div class="fontc">
      ${fontSelect(pre + 'Font', s.font)}
      <label class="f">크기 pt <small>${esc(sizeHint || '')}</small><input id="${pre}Size" type="number" inputmode="decimal" min="6" max="60" step="0.5" value="${s.size || ''}" placeholder="기본"></label>
      <label class="check small ${canB ? '' : 'off'}"><input type="checkbox" id="${pre}Bold" ${s.bold && canB ? 'checked' : ''} ${canB ? '' : 'disabled'}> 굵게${canB ? '' : ` <small>${esc(f ? f.name : '')}${f && f.heavy ? '은 원래 굵은 글꼴이에요' : '에는 굵은 글씨가 없어서 켤 수 없어요'}</small>`}</label>
      <p class="fsample" style="font-family:${esc(FONT.fam(s.font))};font-weight:${s.bold && canB ? 700 : 400}">가곡동 골목에 저녁이 온다 Abc 123</p></div>`;
  }
  const readFontControls = (root, pre, s) => {
    s = s || {};
    const fo = $('#' + pre + 'Font', root), si = $('#' + pre + 'Size', root), bo = $('#' + pre + 'Bold', root);
    if (fo) s.font = fo.value || undefined;
    if (si) s.size = +si.value > 0 ? +si.value : undefined;
    if (bo) s.bold = bo.checked && (!s.font || FONT.canBold(s.font)) ? true : undefined;
    return s;
  };
  // 쓰는 칸 아래 줄바꿈 요령
  const TIP = {
    prose: '엔터 한 번은 새 문단(첫 칸 들여쓰기), 엔터 두 번은 한 줄 띄우기예요. 줄 앞에 "- "나 "1. "을 붙이면 목록처럼 가지런히 맞춰져요. 책에서는 낱말 중간이 잘리지 않게 띄어쓰기 자리에서 줄이 바뀌어요.',
    lead: '엔터 한 번은 새 문단, 두 번은 한 줄 띄우기예요.',
    box: '그림 위에 얹히는 글이라 두세 문장이 가장 보기 좋아요. 엔터 두 번은 한 줄 띄우기예요.',
    cap: '그림 설명은 한두 줄이 좋아요. 엔터로 줄을 나눌 수 있어요.',
    poem: '엔터 한 번은 행 바꾸기, 두 번은 연 나누기예요. 한 행이 길면 책에서 다음 줄로 넘어가며 살짝 들여 써져요.',
    diary: '쓰는 대로 공책 줄에 들어가요. 엔터로 줄을 바꿀 수 있어요.',
    quote: '한두 줄이 가장 보기 좋아요. 엔터로 줄을 나눌 수 있어요.',
    free: '상자를 손가락이나 마우스로 끌어 옮기고, 오른쪽 아래 모서리를 끌어 크기를 바꿔요. 점선(안전영역) 안에 글을 두어야 재단할 때 잘리지 않아요.'
  };

  // ---------- 내 책 쓰기 ----------
  VIEWS.write = async (v, arg) => {
    const other = isStaff() && arg.id && arg.id !== S.me.id;
    const tracks = other ? [arg.track] : (S.me.tracks || []).filter(t => CUR[t]);
    if (!tracks.length) {
      v.innerHTML = '<div class="empty"><p>아직 참여한 과정이 등록되지 않았어요. 운영자에게 작은BOOK·큰BOOK·동네BOOK 중 어느 과정에 참여했는지 말씀해 주세요.</p></div>';
      return;
    }
    const track = tracks.includes(arg.track) ? arg.track : tracks.includes(S.lastTrack) ? S.lastTrack : tracks[0];
    S.lastTrack = track;
    const cur = CUR[track];
    const res = await api('work_get', { track, id: other ? arg.id : '' });
    const W = res.work; W.pages = Array.isArray(W.pages) ? W.pages : [];
    let sel = Math.min(arg.sel || 0, Math.max(0, W.pages.length - 1));
    let saveT = null, saving = null, undo = null;
    const ownerName = res.name;

    // 저장
    let force = false, conflictOpen = false;
    const onConflict = () => {
      if (conflictOpen) return; conflictOpen = true;
      const d = modal(`<h2>다른 곳에서 먼저 고쳤어요</h2>
        <p>이 작품을 다른 기기${other ? '나 참여자 본인' : '나 선생님'}이 방금 고쳐서 저장을 멈췄어요. 어떻게 할까요?</p>
        <div class="stack"><button class="btn btn-main" id="cfReload">새로 불러오기 <small>(여기서 방금 고친 것은 사라져요)</small></button>
        <button class="btn" id="cfForce">여기 것으로 덮어쓰기 <small>(다른 곳에서 고친 것이 사라져요)</small></button></div>`);
      d.addEventListener('close', () => { conflictOpen = false; });
      // 창의 close 이벤트는 늦게 오므로 여기서 바로 풀어 줌
      $('#cfReload', d).onclick = () => { conflictOpen = false; S.dirty = false; d.close(); go('write', { ...arg, track, sel }); };
      $('#cfForce', d).onclick = () => { conflictOpen = false; force = true; S.dirty = true; d.close(); saveNow().catch(() => {}); };
    };
    const saveNow = async () => {
      clearTimeout(saveT); saveT = null;
      if (saving) { try { await saving; } catch { /* 앞 저장 실패는 아래에서 다시 시도 */ } }
      if (!S.dirty || conflictOpen) return;
      S.dirty = false;
      setState('저장 중…');
      const body = { track, title: W.title, pen_name: W.pen_name, intro: W.intro, pages: W.pages, base: W.updated_at || '' };
      if (force) body.force = true;
      if (other) body.id = arg.id;
      try {
        saving = api('work_save', body);
        const r = await saving;
        force = false;
        W.updated_at = r.updated_at;
        const wasOk = !!W.confirmed_at;
        W.confirmed_at = r.confirmed_at;
        setState(`저장했어요 ${hhmm()}`);
        if (wasOk && !r.confirmed_at) { toast('고쳐서 "책에 실어도 좋아요"가 풀렸어요. 다 고치면 다시 눌러 주세요.'); drawFoot(); }
      } catch (err) {
        S.dirty = true;
        if (err.message === 'conflict') { setState('다른 곳에서 고쳐서 저장을 멈췄어요', true); onConflict(); }
        else setState('저장하지 못했어요 — ' + err.message, true);
        throw err;
      }
      finally { saving = null; }
    };
    const changed = () => { S.dirty = true; setState('고치는 중…'); clearTimeout(saveT); saveT = setTimeout(() => saveNow().catch(() => {}), 1000); };
    S.flush = saveNow;
    const setState = (t, bad) => { const el = $('#saveState', v); if (el) { el.textContent = t; el.classList.toggle('bad', !!bad); } };

    const page = () => W.pages[sel];
    let selEl = -1, noteMode = false, guides = localStorage.getItem('bk_guides') !== 'off';
    const openNotes = pg => (pg.notes || []).filter(n => !n.done).length;
    const ZT = 84 / PX; // 쪽 모음 작은 그림 배율
    const thumb = (pg, i) => `<li><button class="thumb ${i === sel ? 'on' : ''}" data-sel="${i}" aria-label="${i + 1}번째 쪽${i === sel ? ' (고르는 중)' : ''}${openNotes(pg) ? `, 요청 ${openNotes(pg)}건` : ''}">
        <span class="mini" style="zoom:${ZT}">${Book.pageHTML(pg, { track, n: i + 1, color: cur.color, folio: false, lite: true })}</span><span class="tn">${i + 1}</span>${openNotes(pg) ? `<span class="tn-note" aria-hidden="true">${openNotes(pg)}</span>` : ''}</button></li>`;
    await FONT.load(Book.fontsOf([W]));

    v.innerHTML = `
      <div class="w-head">
        ${other ? `<div class="row between"><p class="who">${esc(ownerName)}님의 ${esc(cur.name)}</p><button class="btn btn-small" id="back">현황판으로</button></div>`
          : tracks.length > 1 ? `<div class="spines" role="group" aria-label="과정 고르기">${tracks.map(t => spine(t, t === track)).join('')}</div>` : ''}
        <div class="meta">
          <label class="f f-title">작품 제목<input id="wTitle" class="serif big" value="${esc(W.title)}" placeholder="내 이야기의 제목"></label>
          <label class="f">책에 실릴 이름 <small>비우면 ${esc(ownerName)}</small><input id="wPen" value="${esc(W.pen_name)}" placeholder="${esc(ownerName)}"></label>
          <label class="f f-intro">나를 소개하는 한마디 <small>작품 첫 쪽에 들어가요</small><input id="wIntro" value="${esc(W.intro)}" placeholder="예) 가곡동 골목을 좋아하는 열한 살"></label>
        </div>
      </div>
      <div class="w-main" style="--tc:${cur.color}">
        <aside class="strip" aria-label="쪽 모음"><ol id="thumbs"></ol>
          <div class="strip-btns"><button class="btn btn-small" id="addPage">쪽 더하기</button><button class="btn btn-small btn-soft" id="recall">수업 되짚기</button></div></aside>
        <section class="stage" aria-label="쪽 미리보기">
          <div class="stage-bar" id="stageBar"></div>
          <div id="stage"></div><div id="overBar" class="over-bar" hidden></div></section>
        <section class="edit" id="edit" aria-label="쪽 고치기"></section>
      </div>
      <div class="w-foot" id="foot"></div>`;

    // ----- 그리기 -----
    const drawThumbs = () => { $('#thumbs', v).innerHTML = W.pages.map(thumb).join(''); };
    const redrawThumb = () => { const li = $$('#thumbs > li', v)[sel]; if (li) li.outerHTML = thumb(page(), sel); };
    let fitZ = 1;
    const stageZoom = () => { const box = $('.stage', v); fitZ = Math.min(1, (box.clientWidth - 4) / PX); const s = $('#stage > .pg', v); if (s) s.style.zoom = fitZ; };
    let overT;
    const mmOf = (ev, trim) => { const r = trim.getBoundingClientRect(); return [(ev.clientX - r.left) / r.width * Book.W, (ev.clientY - r.top) / r.height * Book.H]; };
    const r1 = n => Math.round(n * 10) / 10;
    const drawBar = () => {
      const pg = page(); const bar = $('#stageBar', v); if (!bar) return;
      if (!pg) { bar.innerHTML = ''; return; }
      const n = openNotes(pg), all = (pg.notes || []).length;
      bar.innerHTML = `<button class="btn btn-small ${guides ? '' : 'btn-ghost'}" data-act="guides" aria-pressed="${guides}">안전영역 ${guides ? '켬' : '끔'}</button>
        <button class="btn btn-small ${noteMode ? 'btn-main' : 'btn-soft'}" data-act="noteMode">${noteMode ? '쪽에서 자리를 찍어 주세요 (취소)' : other ? '메모 남기기' : '선생님께 요청'}</button>
        ${all ? `<span class="muted small">요청 ${n ? `<b>${n}건</b> 남음` : '모두 처리됨'}</span>` : ''}`;
    };
    const drawStage = () => {
      const st = $('#stage', v);
      drawBar();
      if (!page()) { st.innerHTML = ''; $('#overBar', v).hidden = true; return; }
      const pg = page(), t = Book.tpl(pg.tpl);
      st.innerHTML = Book.pageHTML(pg, { track, n: sel + 1, color: cur.color });
      const trim = $('.trim', st);
      // 안전영역 안내선 (인쇄에는 안 나옴)
      if (guides) trim.insertAdjacentHTML('beforeend', `<div class="guide g-trim" aria-hidden="true"></div><div class="guide g-safe" style="inset:${Book.SAFE}mm" aria-hidden="true"></div>`);
      // 고른 상자 표시와 크기 손잡이
      if (t.free && selEl >= 0) { const fe = $(`.fe[data-el="${selEl}"]`, st); if (fe) { fe.classList.add('sel'); fe.insertAdjacentHTML('beforeend', '<i class="fe-hd" data-hd aria-hidden="true"></i>'); } }
      // 요청 핀
      (pg.notes || []).forEach((nt, i) => trim.insertAdjacentHTML('beforeend', `<button class="pin-mark ${nt.done ? 'done' : nt.reply ? 'replied' : ''}" data-note="${i}" style="left:${nt.x}mm;top:${nt.y}mm" aria-label="요청 ${i + 1}">${i + 1}</button>`));
      st.classList.toggle('noting', noteMode);
      stageZoom();
      clearTimeout(overT);
      overT = setTimeout(checkOver, 60);
      // 끌어서 옮기기·크기 바꾸기 (내 마음대로 쪽)
      st.onpointerdown = ev => {
        if (ev.target.closest('[data-note]')) return;
        const trimEl = $('.trim', st); if (!trimEl) return;
        if (noteMode) { const [x, y] = mmOf(ev, trimEl); noteMode = false; addNote(r1(Math.min(Math.max(x, 2), Book.W - 2)), r1(Math.min(Math.max(y, 2), Book.H - 2))); return; }
        if (!t.free) return;
        const fe = ev.target.closest('.fe'); if (!fe) { if (selEl >= 0) { selEl = -1; drawStage(); drawEdit(); } return; }
        const i = +fe.dataset.el, el = pg.els[i]; if (!el) return;
        const resize = !!ev.target.closest('[data-hd]');
        if (selEl !== i) { selEl = i; drawStage(); drawEdit(); }
        const live = $(`.fe[data-el="${i}"]`, st); if (!live) return;
        const [sx, sy] = mmOf(ev, trimEl), o = { x: +el.x || 0, y: +el.y || 0, w: +el.w || 40, h: +el.h || 20 };
        let moved = false;
        live.setPointerCapture(ev.pointerId); ev.preventDefault();
        live.onpointermove = mv => {
          const [cx, cy] = mmOf(mv, trimEl), dx = cx - sx, dy = cy - sy;
          if (Math.abs(dx) + Math.abs(dy) > 0.5) moved = true;
          if (resize) { el.w = r1(Math.min(Math.max(o.w + dx, 10), Book.W - o.x)); el.h = r1(Math.min(Math.max(o.h + dy, 8), Book.H - o.y)); }
          else { el.x = r1(Math.min(Math.max(o.x + dx, 0), Book.W - o.w)); el.y = r1(Math.min(Math.max(o.y + dy, 0), Book.H - o.h)); }
          live.style.left = el.x + 'mm'; live.style.top = el.y + 'mm'; live.style.width = el.w + 'mm'; live.style.height = el.h + 'mm';
        };
        live.onpointerup = live.onpointercancel = () => {
          live.onpointermove = live.onpointerup = live.onpointercancel = null;
          if (moved) { changed(); drawStage(); redrawThumb(); ['X', 'Y', 'W', 'H'].forEach(k => { const inp = $('#e' + k, v); if (inp) inp.value = el[k.toLowerCase()]; }); }
        };
      };
    };
    // 요청 핀
    const addNote = (x, y) => {
      const pg = page();
      const d = modal(`<h2>${other ? '메모 남기기' : '선생님께 요청'}</h2><p class="muted">이 자리에 대해 ${other ? '참여자에게' : '선생님께'} 할 말을 적어 주세요. 책에는 인쇄되지 않아요.</p>
        <label class="f">내용<textarea id="ntText" rows="4" placeholder="예) 이 사진을 더 크게 해 주세요"></textarea></label>
        <div class="row end"><button class="btn btn-ghost" data-close>취소</button><button class="btn btn-main" id="ntSave">남기기</button></div>`);
      $('#ntText', d).focus();
      $('#ntSave', d).onclick = () => {
        const text = $('#ntText', d).value.trim(); if (!text) { toast('내용을 적어 주세요.', true); return; }
        pg.notes = pg.notes || []; pg.notes.push({ id: Date.now().toString(36), x, y, text, by: S.me.name, at: new Date().toISOString() });
        d.close(); changed(); drawStage(); redrawThumb(); toast(other ? '메모를 남겼어요.' : '요청을 남겼어요. 선생님이 보고 답해 줄 거예요.');
      };
      d.addEventListener('close', () => { noteMode = false; drawBar(); $('#stage', v).classList.remove('noting'); });
    };
    const openNote = i => {
      const pg = page(), nt = pg.notes[i]; if (!nt) return;
      const staff = isStaff();
      const d = modal(`<h2>요청 ${i + 1} ${nt.done ? '<span class="chip chip-ok">처리됨</span>' : nt.reply ? '<span class="chip">답글 있음</span>' : '<span class="chip chip-wait">기다리는 중</span>'}</h2>
        <div class="note-box"><small>${esc(nt.by)} · ${fmtTime(nt.at)}</small><p>${esc(nt.text)}</p></div>
        ${nt.reply ? `<div class="note-box reply"><small>선생님 답글 · ${fmtTime(nt.replied_at)}</small><p>${esc(nt.reply)}</p></div>` : ''}
        ${staff ? `<label class="f">답글<textarea id="ntReply" rows="3">${esc(nt.reply || '')}</textarea></label>
          <label class="check"><input type="checkbox" id="ntDone" ${nt.done ? 'checked' : ''}> 처리했어요</label>` : ''}
        <div class="row end">${!nt.done && (staff || nt.by === S.me.name) ? '<button class="btn btn-ghost btn-danger" id="ntDel">지우기</button>' : ''}<button class="btn btn-ghost" data-close>닫기</button>${staff ? '<button class="btn btn-main" id="ntOk">저장</button>' : ''}</div>`);
      const del = $('#ntDel', d); if (del) del.onclick = () => { pg.notes.splice(i, 1); d.close(); changed(); drawStage(); redrawThumb(); };
      const ok = $('#ntOk', d); if (ok) ok.onclick = () => {
        const rep = $('#ntReply', d).value.trim();
        if (rep !== (nt.reply || '')) { nt.reply = rep || undefined; nt.replied_at = rep ? new Date().toISOString() : undefined; }
        nt.done = $('#ntDone', d).checked || undefined;
        d.close(); changed(); drawStage(); redrawThumb(); toast('저장했어요.');
      };
    };
    const checkOver = async () => {
      await document.fonts.ready;
      const st = $('#stage', v); if (!st) return;
      const over = Book.markOver(st);
      const bar = $('#overBar', v);
      bar.hidden = !over;
      if (over) bar.innerHTML = `<span>글이 칸을 넘쳐서 책에서 잘려요.</span><button class="btn btn-small btn-main" data-act="split">넘친 글을 새 쪽으로</button>`;
    };

    const empty = () => `<div class="start">
        <h2>어디서부터 써 볼까요?</h2>
        <p class="muted">${esc(cur.name)} 수업에서 한 일을 떠올려 보세요. 질문 하나를 누르면 그 질문이 적힌 새 쪽이 생겨요.</p>
        ${recallHTML()}
        <p class="muted">질문 없이 시작하려면 <button class="linkbtn" data-act="blank">빈 쪽 하나 만들기</button></p></div>`;
    const recallHTML = () => `<ol class="sessions">${cur.sessions.map(s => `<li class="sess">
        <p class="s-when">${s.no}회차, ${esc(s.day)}</p><h3>${esc(s.title)}</h3><p class="s-did">${esc(s.did)}</p>
        <ul class="prompts">${s.prompts.map((q, qi) => `<li><button class="prompt" data-q="${s.no}:${qi}">${esc(q)}</button></li>`).join('')}</ul></li>`).join('')}</ol>`;

    const drawEdit = () => {
      const ed = $('#edit', v);
      const pg = page();
      if (!pg) { ed.innerHTML = empty(); return; }
      const t = Book.tpl(pg.tpl);
      if (t.free) { ed.innerHTML = freeEdit(pg); return; }
      const imgs = pg.imgs || [];
      const hidden = imgs.slice(t.fr.length).filter(x => x && x.url).length;
      const textLabel = { cap: '그림 설명 (없어도 돼요)', lead: '제목 아래 짧은 글 (없어도 돼요)', box: '글 상자에 들어갈 글 (짧게)', poem: '시 (줄 바꿈이 그대로 들어가요)', diary: '그림일기 글', quote: '한마디', prose: '글' }[t.text];
      ed.innerHTML = `
        <div class="e-sec"><div class="row between"><h2 class="e-h">${sel + 1}번째 쪽</h2>
          <div class="row"><button class="icon-btn" data-act="up" ${sel === 0 ? 'disabled' : ''} aria-label="앞으로 옮기기">◀</button><button class="icon-btn" data-act="down" ${sel === W.pages.length - 1 ? 'disabled' : ''} aria-label="뒤로 옮기기">▶</button>
          <button class="btn btn-small btn-ghost" data-act="dup">복사</button><button class="btn btn-small btn-ghost btn-danger" data-act="del">지우기</button></div></div></div>
        <div class="e-sec"><p class="f-l">쪽 틀</p>
          <div class="tpls" role="radiogroup" aria-label="쪽 틀">${Book.TPL.map(x => `<button class="tplb ${x.id === t.id ? 'on' : ''}" role="radio" aria-checked="${x.id === t.id}" data-tpl="${x.id}">${tplIcon(x.id)}<span>${esc(x.name)}</span></button>`).join('')}</div></div>
        ${pg.hint ? `<div class="hintcard"><small>수업 질문</small><p>${esc(pg.hint)}</p><button class="linkbtn" data-act="hintoff">질문 지우기</button></div>` : ''}
        ${t.head ? `<label class="f">${esc(t.head)}<input id="pHead" value="${esc(pg.head || '')}"></label>` : ''}
        <label class="f">${textLabel}<textarea id="pText" rows="${t.text === 'cap' ? 3 : 9}" class="${t.text === 'poem' ? 'poemta' : ''}" placeholder="${esc(pg.hint || '여기에 써요')}">${esc(pg.text || '')}</textarea></label>
        <p class="tip">${TIP[t.text] || ''}</p>
        ${t.text === 'prose' || t.text === 'lead' ? `<label class="check small"><input type="checkbox" id="pIndent" ${pg.indent === false ? '' : 'checked'}> 문단 첫 칸 들여쓰기 <small>목록이나 짧은 줄로 쓴 글은 끄면 더 가지런해요</small></label>` : ''}
        <div class="row between tx-tools"><span class="muted" id="cnt">${(pg.text || '').replace(/\s/g, '').length}자</span>
          <div class="row">${undo && undo.pg === pg ? '<button class="btn btn-small btn-ghost" data-act="undo">교정 되돌리기</button>' : ''}<button class="btn btn-small btn-ai" data-act="proof">AI 교정 받기</button></div></div>
        <details class="e-sec fdet" ${pg.style && (pg.style.font || pg.style.size || pg.style.bold) ? 'open' : ''}><summary>이 쪽의 글꼴·크기·굵게 <small>${pg.style && pg.style.font ? esc(FONT.get(pg.style.font).name) : '기본'}${pg.style && pg.style.size ? ` ${pg.style.size}pt` : ''}${pg.style && pg.style.bold ? ' 굵게' : ''}</small></summary>
          ${fontControls('p', pg.style, `비우면 틀 기본 크기 (${{ prose: track === 'small' ? '12.5' : '10.8', lead: '10.5', cap: '9', box: '10.5', poem: track === 'small' ? '13' : '11.5', diary: '15.5', quote: '17' }[t.text] || '10.8'}pt)`)}
          <p class="tip">글 칸 전체에 적용돼요. 굵게는 진짜 굵은 글씨가 있는 글꼴에서만 켤 수 있고, 억지로 굵게 만들지 않아요.</p></details>
        ${t.fr.length ? `<div class="e-sec"><p class="f-l">그림·사진 ${t.optional ? '<small>(없어도 돼요)</small>' : ''}</p><div class="slots">${t.fr.map((fr, i) => {
          const im = imgs[i];
          if (!im || !im.url) return `<div class="slot empty"><b>${t.fr.length > 1 ? `${i + 1}번 ` : ''}사진·그림</b>
            <button class="btn btn-small btn-main" data-pick="${i}">사진첩에서 고르기</button><button class="btn btn-small" data-up="${i}">새로 올리기</button></div>`;
          const lv = Book.level(Book.dpi(im, fr));
          return `<div class="slot"><img src="${src(im)}" alt="">
            <span class="q q-${lv}">${{ ok: '인쇄하기 좋아요', warn: '조금 작아요', bad: '너무 작아요' }[lv] || ''}</span>
            <div class="slot-btns"><button class="btn btn-small" data-pick="${i}">바꾸기</button>${rotBtns(i)}
            <button class="btn btn-small" data-fit="${i}">${im.fit === 'contain' ? '칸 채우기' : '전체 보이기'}</button>
            <button class="btn btn-small btn-ghost" data-rm="${i}">빼기</button></div></div>`;
        }).join('')}</div>${hidden ? `<p class="muted">이 틀에서는 그림 ${hidden}장이 안 보여요. 다른 틀로 바꾸면 다시 보여요.</p>` : ''}</div>` : ''}`;
    };

    // "내 마음대로" 쪽 편집기
    const freeEdit = pg => {
      const els = pg.els || [];
      const el = els[selEl];
      const im = el && el.t === 'img' ? el.img : null;
      const lv = im && im.url ? Book.level(Book.dpi(im, [+el.w || 1, +el.h || 1])) : '';
      return `
        <div class="e-sec"><div class="row between"><h2 class="e-h">${sel + 1}번째 쪽</h2>
          <div class="row"><button class="icon-btn" data-act="up" ${sel === 0 ? 'disabled' : ''} aria-label="앞으로 옮기기">◀</button><button class="icon-btn" data-act="down" ${sel === W.pages.length - 1 ? 'disabled' : ''} aria-label="뒤로 옮기기">▶</button>
          <button class="btn btn-small btn-ghost" data-act="dup">복사</button><button class="btn btn-small btn-ghost btn-danger" data-act="del">지우기</button></div></div></div>
        <div class="e-sec"><p class="f-l">쪽 틀</p>
          <div class="tpls" role="radiogroup" aria-label="쪽 틀">${Book.TPL.map(x => `<button class="tplb ${x.id === 'free' ? 'on' : ''}" role="radio" aria-checked="${x.id === 'free'}" data-tpl="${x.id}">${tplIcon(x.id)}<span>${esc(x.name)}</span></button>`).join('')}</div></div>
        ${pg.hint ? `<div class="hintcard"><small>수업 질문</small><p>${esc(pg.hint)}</p><button class="linkbtn" data-act="hintoff">질문 지우기</button></div>` : ''}
        <p class="tip">${TIP.free}</p>
        <div class="e-sec"><div class="row between wrap"><p class="f-l">상자 ${els.length}개</p><div class="row"><button class="btn btn-small btn-main" data-act="addText">글 상자 더하기</button><button class="btn btn-small btn-main" data-act="addImg">그림 상자 더하기</button></div></div>
          ${els.length ? `<ol class="ellist">${els.map((x, i) => `<li><button class="elbtn ${i === selEl ? 'on' : ''}" data-elsel="${i}">${x.t === 'img' ? '그림' : '글'} ${i + 1} <small>${x.t === 'img' ? (x.img && x.img.url ? '사진 있음' : '비어 있음') : esc(String(x.text || '').trim().slice(0, 18) || '(빈 글 상자)')}</small></button></li>`).join('')}</ol>` : '<p class="muted">상자를 더해서 시작해요. 다른 틀로 쓴 쪽을 이 틀로 바꾸면 글과 그림이 상자로 옮겨져요.</p>'}</div>
        ${el ? `<div class="e-sec elsec"><div class="row between wrap"><h3 class="e-h3">${el.t === 'img' ? '그림' : '글'} 상자 ${selEl + 1}</h3>
            <div class="row"><button class="icon-btn" data-act="elBack" ${selEl === 0 ? 'disabled' : ''} title="뒤로 보내기" aria-label="뒤로 보내기">▽</button><button class="icon-btn" data-act="elFront" ${selEl === els.length - 1 ? 'disabled' : ''} title="앞으로 가져오기" aria-label="앞으로 가져오기">△</button><button class="btn btn-small btn-ghost btn-danger" data-act="elDel">상자 지우기</button></div></div>
          <div class="xywh"><label class="f">왼쪽 mm<input id="eX" type="number" step="0.5" min="0" max="${Book.W}" value="${el.x}"></label><label class="f">위 mm<input id="eY" type="number" step="0.5" min="0" max="${Book.H}" value="${el.y}"></label><label class="f">너비 mm<input id="eW" type="number" step="0.5" min="10" max="${Book.W}" value="${el.w}"></label><label class="f">높이 mm<input id="eH" type="number" step="0.5" min="8" max="${Book.H}" value="${el.h}"></label></div>
          ${el.t === 'text' && Book.outsideSafe(el) ? '<p class="warn-line">안전영역(가장자리 10mm) 밖으로 나가 있어요. 재단할 때 잘릴 수 있어요.</p>' : ''}
          ${el.t === 'img' ? (im && im.url ? `<div class="slot"><img src="${src(im)}" alt=""><span class="q q-${lv}">${{ ok: '인쇄하기 좋아요', warn: '조금 작아요', bad: '너무 작아요' }[lv] || ''}</span>
              <div class="slot-btns"><button class="btn btn-small" data-act="ePick">바꾸기</button><span class="rot"><button class="icon-btn" data-act="eRot:3" aria-label="왼쪽으로 돌리기">↺</button><button class="icon-btn" data-act="eRot:1" aria-label="오른쪽으로 돌리기">↻</button></span>
              <button class="btn btn-small" data-act="eFit">${im.fit === 'contain' ? '칸 채우기' : '전체 보이기'}</button><button class="btn btn-small btn-ghost" data-act="eRm">빼기</button></div></div>`
            : `<div class="slot empty"><b>사진·그림</b><button class="btn btn-small btn-main" data-act="ePick">사진첩에서 고르기</button><button class="btn btn-small" data-act="eUp">새로 올리기</button></div>`)
          : `<label class="f">글<textarea id="eText" rows="6" class="serif">${esc(el.text || '')}</textarea></label>
            <div class="row between tx-tools"><span class="muted" id="cnt">${String(el.text || '').replace(/\s/g, '').length}자</span>
              <div class="row">${undo && undo.el === el ? '<button class="btn btn-small btn-ghost" data-act="eUndo">교정 되돌리기</button>' : ''}<button class="btn btn-small btn-ai" data-act="eProof">AI 교정 받기</button></div></div>
            <div class="row wrap"><span class="f-l" style="margin:0">정렬</span>${[['', '왼쪽'], ['center', '가운데'], ['right', '오른쪽']].map(([k, l]) => `<button class="btn btn-small ${(el.align || '') === k ? 'on' : 'btn-ghost'}" data-act="eAlign:${k}" aria-pressed="${(el.align || '') === k}">${l}</button>`).join('')}</div>
            ${fontControls('e', el, '비우면 쪽 기본 (10.8pt)')}`}
        </div>` : els.length ? '<p class="muted">상자를 누르면 고칠 수 있어요. 미리보기에서 바로 끌어도 돼요.</p>' : ''}`;
    };

    const drawFoot = () => {
      $('#foot', v).innerHTML = `<span id="saveState" class="save-state">${S.dirty ? '고치는 중…' : W.updated_at ? `저장됨 ${fmtTime(W.updated_at)}` : ''}</span>
        <div class="row wrap end">
          <button class="btn" data-act="preview" ${W.pages.length ? '' : 'disabled'}>책에 실릴 모양 보기</button>
          <label class="check confirm"><input type="checkbox" id="okBook" ${W.confirmed_at ? 'checked' : ''} ${W.pages.length ? '' : 'disabled'}> 다 썼어요. 책에 실어도 좋아요</label>
        </div>`;
    };
    const syncFoot = () => { const n = !W.pages.length; const pv = $('[data-act=preview]', v), ok = $('#okBook', v); if (pv) pv.disabled = n; if (ok) ok.disabled = n; };
    const drawAll = () => { $('.w-main', v).classList.toggle('no-pages', !W.pages.length); drawThumbs(); drawStage(); drawEdit(); syncFoot(); };
    drawAll(); drawFoot();
    await document.fonts.ready; stageZoom(); checkOver();
    const onResize = () => stageZoom();
    window.addEventListener('resize', onResize);
    S.cleanup = () => { window.removeEventListener('resize', onResize); clearTimeout(saveT); };

    // ----- 쪽 추가 -----
    const addPage = (pg, at = sel + 1) => {
      W.pages.splice(at, 0, Object.assign({ tpl: 'text', head: '', text: '', imgs: [] }, pg));
      sel = at; selEl = -1; noteMode = false; changed(); drawAll();
      const ed = $('#edit', v); if (ed && window.innerWidth < 900) ed.scrollIntoView({ behavior: 'smooth', block: 'start' });
    };
    const fromPrompt = key => {
      const [no, qi] = key.split(':').map(Number);
      const s = cur.sessions.find(x => x.no === no);
      addPage({ tpl: s.tpl, hint: s.prompts[qi] }, W.pages.length ? sel + 1 : 0);
    };
    const recall = () => {
      const d = modal(`<h2>수업 되짚기 — ${esc(cur.name)}</h2><p class="muted">${esc(cur.motto)}. 질문을 누르면 그 질문이 적힌 새 쪽이 생겨요.</p>${recallHTML()}
        <div class="row end"><button class="btn" data-close>닫기</button></div>`, 'm-recall');
      d.onclick = e => { const b = e.target.closest('[data-q]'); if (b) { d.close(); fromPrompt(b.dataset.q); } };
    };

    // ----- 입력 -----
    let inT;
    v.oninput = e => {
      const id = e.target.id;
      if (id === 'wTitle') { W.title = e.target.value; changed(); return; }
      if (id === 'wPen') { W.pen_name = e.target.value; changed(); return; }
      if (id === 'wIntro') { W.intro = e.target.value; changed(); return; }
      const pg = page(); if (!pg) return;
      const el = (pg.els || [])[selEl];
      if (id === 'pHead') pg.head = e.target.value;
      else if (id === 'pText') { pg.text = e.target.value; $('#cnt', v).textContent = `${pg.text.replace(/\s/g, '').length}자`; }
      else if (id === 'pSize') { pg.style = readFontControls(v, 'p', pg.style); }
      else if (el && id === 'eText') { el.text = e.target.value; $('#cnt', v).textContent = `${el.text.replace(/\s/g, '').length}자`; }
      else if (el && id === 'eSize') { readFontControls(v, 'e', el); }
      else if (el && ['eX', 'eY', 'eW', 'eH'].includes(id)) {
        const n = +e.target.value; if (!(n >= 0)) return;
        const k = id[1].toLowerCase(); el[k] = r1(n);
        if (k === 'x') el.x = Math.min(el.x, Book.W - el.w); if (k === 'y') el.y = Math.min(el.y, Book.H - el.h);
        if (k === 'w') el.w = Math.min(Math.max(el.w, 10), Book.W - el.x); if (k === 'h') el.h = Math.min(Math.max(el.h, 8), Book.H - el.y);
        const wl = $('.warn-line', v), need = el.t === 'text' && Book.outsideSafe(el);
        if (need && !wl) $('.xywh', v).insertAdjacentHTML('afterend', '<p class="warn-line">안전영역(가장자리 10mm) 밖으로 나가 있어요. 재단할 때 잘릴 수 있어요.</p>');
        if (!need && wl) wl.remove();
      }
      else return;
      changed();
      clearTimeout(inT); inT = setTimeout(() => { drawStage(); redrawThumb(); }, 250);
    };
    // 글꼴·굵게는 change로 (고르는 순간 글꼴을 불러와야 해서)
    const fontChanged = async (pre, target) => {
      readFontControls(v, pre, target);
      if (target.font) await FONT.load(target.font);
      changed(); drawStage(); redrawThumb(); drawEdit();
    };
    v.onchange = async e => {
      const id = e.target.id, pg = page();
      if (id === 'pIndent') { pg.indent = e.target.checked; changed(); drawStage(); redrawThumb(); return; }
      if (id === 'pFont' || id === 'pBold') { pg.style = pg.style || {}; await fontChanged('p', pg.style); return; }
      if (id === 'eFont' || id === 'eBold') { const el = (pg.els || [])[selEl]; if (el) await fontChanged('e', el); return; }
      if (e.target.id !== 'okBook') return;
      const on = e.target.checked;
      try {
        await saveNow();
        const r = await api('confirm', { track, on, id: other ? arg.id : '' });
        W.confirmed_at = r.confirmed_at;
        toast(on ? '고마워요! 책에 싣도록 표시했어요.' : '아직 고치는 중으로 바꿨어요.');
      } catch (err) { e.target.checked = !on; if (err.message !== 'conflict') toast(err.message, true); }  // 충돌이면 충돌 창이 이미 떠 있음
    };

    // ----- 버튼 -----
    v.onclick = async e => {
      const tr = e.target.closest('[data-tr]');
      if (tr) { if (tr.dataset.tr !== track) { await saveNow().catch(() => {}); go('write', { track: tr.dataset.tr }); } return; }
      if (e.target.closest('#back')) { go('board', { track }); return; }
      const th = e.target.closest('[data-sel]');
      if (th) { sel = +th.dataset.sel; selEl = -1; noteMode = false; drawAll(); return; }
      if (e.target.closest('#addPage')) { addPage({ tpl: page() ? 'text' : (cur.sessions[0].tpl) }); return; }
      if (e.target.closest('#recall')) { recall(); return; }
      const q = e.target.closest('[data-q]');
      if (q) { fromPrompt(q.dataset.q); return; }
      const tb = e.target.closest('[data-tpl]');
      if (tb) {
        const pg0 = page(); pg0.tpl = tb.dataset.tpl;
        if (tb.dataset.tpl === 'free' && !(pg0.els || []).length) { // 다른 틀의 글·그림을 상자로 옮겨 줌
          pg0.els = [];
          const im0 = (pg0.imgs || [])[0];
          if (im0 && im0.url) pg0.els.push({ t: 'img', x: 18, y: 20, w: 116, h: 80, img: im0 });
          if (String(pg0.text || '').trim() || String(pg0.head || '').trim()) pg0.els.push({ t: 'text', x: 18, y: im0 && im0.url ? 108 : 20, w: 116, h: im0 && im0.url ? 95 : 180, text: [pg0.head, pg0.text].filter(x => String(x || '').trim()).join('\n\n') });
          selEl = pg0.els.length ? 0 : -1;
        }
        changed(); drawAll(); return;
      }
      const nb = e.target.closest('[data-note]');
      if (nb) { openNote(+nb.dataset.note); return; }
      const es = e.target.closest('[data-elsel]');
      if (es) { selEl = +es.dataset.elsel; drawStage(); drawEdit(); return; }
      const pg = page();
      const el = pg && (pg.els || [])[selEl];
      const setImg = (i, im) => { pg.imgs = pg.imgs || []; pg.imgs[i] = im; changed(); drawAll(); };
      const pk = e.target.closest('[data-pick]');
      if (pk) { const im = await photoPicker({ owner: other ? arg.id : '', track }); if (im) setImg(+pk.dataset.pick, im); return; }
      const up = e.target.closest('[data-up]');
      if (up) {
        const f = await pickFile(); if (!f) return;
        const im = await busy(up, '올리는 중…', async () => { const x = await uploadImage(f); await toAlbum(x, other ? arg.id : ''); return x; });
        if (im) setImg(+up.dataset.up, im);
        return;
      }
      const rt = e.target.closest('[data-rot]');
      if (rt) {
        const [i, turn] = rt.dataset.rot.split(':').map(Number);
        const im = await busy(rt, '', () => rotateImage(pg.imgs[i], turn));
        if (im) setImg(i, im);
        return;
      }
      const fit = e.target.closest('[data-fit]');
      if (fit) { const im = pg.imgs[+fit.dataset.fit]; im.fit = im.fit === 'contain' ? 'cover' : 'contain'; changed(); drawAll(); return; }
      const rm = e.target.closest('[data-rm]');
      if (rm) { pg.imgs[+rm.dataset.rm] = null; changed(); drawAll(); return; }
      const b = e.target.closest('[data-act]'); if (!b) return;
      const act = b.dataset.act;
      if (act === 'guides') { guides = !guides; localStorage.setItem('bk_guides', guides ? 'on' : 'off'); drawStage(); return; }
      if (act === 'noteMode') { noteMode = !noteMode; drawBar(); $('#stage', v).classList.toggle('noting', noteMode); if (noteMode) toast('쪽에서 요청할 자리를 찍어 주세요.'); return; }
      if (act === 'addText' || act === 'addImg') {
        pg.els = pg.els || [];
        const n = pg.els.length;
        pg.els.push(act === 'addText' ? { t: 'text', x: 18 + (n % 3) * 4, y: 20 + (n % 5) * 6, w: 116, h: 60, text: '' } : { t: 'img', x: 18 + (n % 3) * 4, y: 20 + (n % 5) * 6, w: 80, h: 60, img: null });
        selEl = n; changed(); drawStage(); redrawThumb(); drawEdit();
        const ta = $('#eText', v); if (ta) ta.focus();
        return;
      }
      if (el) {
        if (act === 'elDel') { pg.els.splice(selEl, 1); selEl = -1; changed(); drawAll(); return; }
        if (act === 'elBack' || act === 'elFront') { const j = selEl + (act === 'elBack' ? -1 : 1); [pg.els[selEl], pg.els[j]] = [pg.els[j], pg.els[selEl]]; selEl = j; changed(); drawStage(); redrawThumb(); drawEdit(); return; }
        if (act.startsWith('eAlign:')) { el.align = act.slice(7) || undefined; changed(); drawStage(); redrawThumb(); drawEdit(); return; }
        if (act === 'ePick') { const im = await photoPicker({ owner: other ? arg.id : '', track }); if (im) { el.img = im; changed(); drawAll(); } return; }
        if (act === 'eUp') {
          const f = await pickFile(); if (!f) return;
          const im = await busy(b, '올리는 중…', async () => { const x = await uploadImage(f); await toAlbum(x, other ? arg.id : ''); return x; });
          if (im) { el.img = im; changed(); drawAll(); } return;
        }
        if (act.startsWith('eRot:')) { const im = await busy(b, '', () => rotateImage(el.img, +act.slice(5))); if (im) { el.img = im; changed(); drawAll(); } return; }
        if (act === 'eFit') { el.img.fit = el.img.fit === 'contain' ? 'cover' : 'contain'; changed(); drawAll(); return; }
        if (act === 'eRm') { el.img = null; changed(); drawAll(); return; }
        if (act === 'eProof') {
          const text = String(el.text || '');
          if (text.replace(/\s/g, '').length < 5) { toast('교정할 글을 조금 더 써 주세요.', true); return; }
          if (!aiOk() && !(await askAi())) return;
          const r = await proofDialog({ text, kind: 'prose', track, owner: other ? arg.id : '' });
          if (r) { undo = { el, text }; el.text = r.text; changed(); drawStage(); redrawThumb(); drawEdit(); toast(`${r.n}곳을 고쳤어요.`); }
          return;
        }
        if (act === 'eUndo' && undo && undo.el === el) { el.text = undo.text; undo = null; changed(); drawStage(); redrawThumb(); drawEdit(); toast('교정 전으로 되돌렸어요.'); return; }
      }
      if (act === 'blank') addPage({ tpl: 'text' }, 0);
      if (act === 'hintoff') { delete pg.hint; changed(); drawEdit(); }
      if (act === 'up' || act === 'down') {
        const j = sel + (act === 'up' ? -1 : 1);
        [W.pages[sel], W.pages[j]] = [W.pages[j], W.pages[sel]]; sel = j; changed(); drawAll();
      }
      if (act === 'dup') addPage(JSON.parse(JSON.stringify(pg)));
      if (act === 'del') {
        if (!(await ask(`${sel + 1}번째 쪽을 지울까요?`, '지운 쪽은 되살릴 수 없어요.', '지우기'))) return;
        W.pages.splice(sel, 1); sel = Math.max(0, sel - 1); changed(); drawAll();
      }
      if (act === 'split') {
        const cut = await Book.fitLength(pg, track);
        const text = String(pg.text || '');
        const rest = text.slice(cut).replace(/^\s+/, '');
        if (!rest) return;
        pg.text = text.slice(0, cut).replace(/\s+$/, '');
        const kind = Book.tpl(pg.tpl).text;
        addPage({ tpl: kind === 'poem' ? 'poem' : kind === 'diary' ? 'diary' : 'text', text: rest });
        toast('넘친 글을 다음 쪽으로 옮겼어요.');
      }
      if (act === 'proof') {
        const text = String(pg.text || '');
        if (text.replace(/\s/g, '').length < 5) { toast('교정할 글을 조금 더 써 주세요.', true); return; }
        const kind = Book.tpl(pg.tpl).text;
        if (!aiOk() && !(await askAi())) return;
        const r = await proofDialog({ text, kind, track, owner: other ? arg.id : '' });
        if (r) { undo = { pg, text }; pg.text = r.text; changed(); drawStage(); redrawThumb(); drawEdit(); toast(`${r.n}곳을 고쳤어요.`); }
      }
      if (act === 'undo' && undo && undo.pg === pg) { pg.text = undo.text; undo = null; changed(); drawStage(); redrawThumb(); drawEdit(); toast('교정 전으로 되돌렸어요.'); }
      if (act === 'preview') {
        await saveNow().catch(() => {});
        Book.open({ settings: { color: cur.color }, works: [{ ...W, name: ownerName }], track, single: true });
      }
    };
  };

  // ---------- 현황판 ----------
  VIEWS.board = async (v, arg) => {
    const { rows } = await api('board');
    let tr = arg.track || S.boardTrack || 'small';
    const draw = () => {
      S.boardTrack = tr;
      const list = rows.filter(r => r.track === tr);
      const done = list.filter(r => r.confirmed).length;
      v.innerHTML = `<h1 class="h">현황판</h1>
        <div class="spines" role="group" aria-label="과정 고르기">${TRACKS.map(t => spine(t, t === tr)).join('')}</div>
        <p class="lead">${esc(CUR[tr].name)} ${list.length}명 중 ${done}명이 "책에 실어도 좋아요"를 눌렀어요. 이름을 누르면 그분의 책을 함께 고칠 수 있어요.</p>
        ${list.length ? `<div class="tbl-wrap"><table><thead><tr><th>이름</th><th>작품 제목</th><th>쪽</th><th>글자</th><th>그림</th><th>요청</th><th>책에 싣기</th><th>마지막 저장</th></tr></thead>
        <tbody>${list.map(r => `<tr><td><button class="linkbtn" data-open="${r.id}">${esc(r.name)}</button></td><td class="t-title">${esc(r.title || '')}</td>
          <td class="num">${r.npages || 0}</td><td class="num">${(r.chars || 0).toLocaleString()}</td><td class="num">${r.imgs || 0}</td><td>${r.open_notes ? `<span class="chip chip-wait">${r.open_notes}건</span>` : ''}</td>
          <td>${r.confirmed ? '<span class="chip chip-ok">좋아요</span>' : r.npages ? '<span class="chip">쓰는 중</span>' : '<span class="chip chip-wait">시작 전</span>'}</td>
          <td>${fmtTime(r.updated_at)}</td></tr>`).join('')}</tbody></table></div>`
          : '<div class="empty"><p>이 과정에 등록된 참여자가 없어요. 참여자 탭에서 과정을 체크해 주세요.</p></div>'}`;
    };
    draw();
    v.onclick = e => {
      const s = e.target.closest('[data-tr]'); if (s) { tr = s.dataset.tr; draw(); return; }
      const o = e.target.closest('[data-open]'); if (o) go('write', { id: o.dataset.open, track: tr });
    };
  };

  // ---------- 책 만들기 (과정별 합본) ----------
  VIEWS.book = async (v, arg) => {
    const track = arg.track || S.bookTrack || 'small';
    S.bookTrack = track;
    const res = await api('book', { track });
    const st = Object.assign({ title: CUR[track].name, subtitle: '', publisher: '', date: '', isbn: '', greeting: '', credits: '', ai_notice: '', color: CUR[track].color, cover: null, bleed: false, back_text: '', right_start: true, paper_mm: '', spine_mm: '', flap_mm: '' }, res.settings);
    if (st.pad == null) st.pad = st.pad4 === false ? '0' : '4';
    const works = res.works;
    const byId = Object.fromEntries(works.map(w => [w.person_id, w]));
    let order = (Array.isArray(st.order) ? st.order : []).filter(id => byId[id]);
    works.forEach(w => { if (!order.includes(w.person_id)) order.push(w.person_id); });
    const exclude = new Set(Array.isArray(st.exclude) ? st.exclude : []);
    let dirty = false;
    const draw = () => {
      v.innerHTML = `<h1 class="h">책 만들기</h1>
        <div class="spines" role="group" aria-label="과정 고르기">${TRACKS.map(t => spine(t, t === track)).join('')}</div>
        <p class="lead">${esc(CUR[track].name)} 합본 한 권. 신국판(152×225mm) 내지와 펼침 표지를 따로 만들어요. 인쇄소에는 두 PDF를 함께 넘기면 돼요.</p>
        <div class="row wrap"><button class="btn btn-main" data-act="preview">내지 미리보기·PDF</button><button class="btn btn-main" data-act="cover">펼침 표지 미리보기·PDF</button><button class="btn" data-act="save">저장</button>
          <span class="save-state ${dirty ? 'bad' : ''}">${dirty ? '저장 안 한 변경이 있어요' : ''}</span></div>
        <h2 class="h2">싣는 순서</h2>
        ${order.length ? `<ol class="order">${order.map((id, i) => { const w = byId[id]; return `<li class="${exclude.has(id) ? 'off' : ''}">
          <span class="ord-btns"><button data-mv="-1" data-i="${i}" ${i === 0 ? 'disabled' : ''} aria-label="위로">▲</button><button data-mv="1" data-i="${i}" ${i === order.length - 1 ? 'disabled' : ''} aria-label="아래로">▼</button></span>
          <label class="check"><input type="checkbox" data-inc="${id}" ${exclude.has(id) ? '' : 'checked'}> <b>${esc(w.pen_name || w.name)}</b>「${esc(w.title || '제목 없음')}」</label>
          <span class="ord-st">${w.npages}쪽, ${Number(w.chars).toLocaleString()}자, 그림 ${w.imgs}장 · ${w.confirmed_at ? '실어도 좋아요' : '아직 확인 전'}</span></li>`; }).join('')}</ol>`
          : '<p class="muted">아직 한 쪽이라도 쓴 참여자가 없어요.</p>'}
        <h2 class="h2">책 정보</h2>
        <form class="form stack" id="bf">
          <label class="f">책 제목<input data-k="title" value="${esc(st.title)}"></label>
          <label class="f">부제<input data-k="subtitle" value="${esc(st.subtitle)}"></label>
          <div class="grid2"><label class="f">펴낸 곳<input data-k="publisher" value="${esc(st.publisher)}"></label>
          <label class="f">펴낸 날<input data-k="date" value="${esc(st.date)}" placeholder="2026년 10월"></label></div>
          <label class="f">ISBN (없으면 비워 두기)<input data-k="isbn" value="${esc(st.isbn)}"></label>
          <label class="f">책을 펴내며 (인사말, 비우면 빠져요)<textarea data-k="greeting" rows="6">${esc(st.greeting)}</textarea></label>
          <label class="f">함께 만든 사람들 (강사, 기획, 운영 등 한 줄에 하나)<textarea data-k="credits" rows="4">${esc(st.credits)}</textarea></label>
          <label class="f">AI 사용 표기<input data-k="ai_notice" value="${esc(st.ai_notice)}"></label>
          <label class="f inline">표지 색<input type="color" data-k="color" value="${esc(st.color)}"></label>
          <div class="f"><span>표지 그림</span>${st.cover && st.cover.url ? `<div class="row"><img class="cover-th" src="${esc(st.cover.url)}" alt=""><button type="button" class="btn btn-small" data-img="cover">바꾸기</button><button type="button" class="btn btn-small btn-ghost" data-imgdel="cover">빼기</button></div>` : '<button type="button" class="btn drop" data-img="cover">표지 그림 올리기</button>'}</div>
          <label class="f">뒤표지 글 (책 소개, 비우면 색만)<textarea data-k="back_text" rows="4">${esc(st.back_text)}</textarea></label>
          <h2 class="h2">인쇄 설정</h2>
          <p class="spine-info" id="spineInfo"></p>
          <div class="grid2"><label class="f">내지 쪽수 맞추기<select data-k="pad">${[['4', '4의 배수 (보통)'], ['8', '8의 배수'], ['16', '16의 배수 (옵셋 인쇄)'], ['2', '2의 배수'], ['0', '맞추지 않음']].map(([v, l]) => `<option value="${v}" ${String(st.pad) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
          <label class="f">표지 날개 폭 mm <small>(날개 없으면 비우기)</small><input data-k="flap_mm" inputmode="decimal" value="${esc(st.flap_mm)}" placeholder="0"></label></div>
          <div class="grid2"><label class="f">내지 종이 한 장 두께 mm <small>(모르면 비우기, 0.1로 계산)</small><input data-k="paper_mm" inputmode="decimal" value="${esc(st.paper_mm)}" placeholder="0.1"></label>
          <label class="f">인쇄소가 알려 준 책등 폭 mm <small>(있으면 이 값을 씀)</small><input data-k="spine_mm" inputmode="decimal" value="${esc(st.spine_mm)}" placeholder="자동 계산"></label></div>
          <label class="check"><input type="checkbox" data-k="right_start" ${st.right_start !== false ? 'checked' : ''}> 작가마다 첫 쪽을 오른쪽에서 시작 (빈 쪽이 생길 수 있어요)</label>
          <label class="check"><input type="checkbox" data-k="bleed" ${st.bleed ? 'checked' : ''}> 내지에 도련 3mm 넣기 (그림 가득 쪽이 있으면 켜기. 표지는 항상 도련 포함)</label>
        </form>`;
      updSpine();
    };
    const chosen = () => order.filter(id => !exclude.has(id)).map(id => byId[id]);
    // 내지 쪽수와 책등 폭 미리 계산
    function updSpine() {
      const el = $('#spineInfo', v); if (!el) return;
      const list = chosen();
      if (!list.length) { el.textContent = '실을 작품이 생기면 내지 쪽수와 책등 폭을 계산해 보여 드려요.'; return; }
      const sp = Book.spine(st, list, track);
      el.innerHTML = `지금 설정으로 내지 <b>${sp.pages}쪽</b>, 책등 <b>${sp.mm}mm</b>${sp.given ? ' (인쇄소 값)' : ' (자동 계산, 인쇄소 확인 권장)'}`;
    }
    const save = async () => { st.order = order; st.exclude = [...exclude]; await api('book_save', { track, data: st }); dirty = false; draw(); };
    draw();
    const mark = () => { dirty = true; const s = $('.save-state', v); if (s) { s.textContent = '저장 안 한 변경이 있어요'; s.classList.add('bad'); } };
    S.flush = async () => { if (dirty) await save(); };
    v.onsubmit = e => e.preventDefault();
    v.oninput = e => { const k = e.target.dataset.k; if (!k) return; st[k] = e.target.type === 'checkbox' ? e.target.checked : e.target.value; mark(); if (['pad', 'right_start', 'paper_mm', 'spine_mm', 'greeting'].includes(k)) updSpine(); };
    v.onchange = e => { const id = e.target.dataset.inc; if (id) { if (e.target.checked) exclude.delete(id); else exclude.add(id); dirty = true; draw(); } };
    v.onclick = async e => {
      const s = e.target.closest('[data-tr]');
      if (s) { if (s.dataset.tr !== track) { if (dirty) await save().catch(() => {}); go('book', { track: s.dataset.tr }); } return; }
      const mv = e.target.closest('[data-mv]');
      if (mv) { const i = +mv.dataset.i, j = i + +mv.dataset.mv; [order[i], order[j]] = [order[j], order[i]]; dirty = true; draw(); return; }
      const up = e.target.closest('[data-img]');
      if (up) { const f = await pickFile(); if (!f) return; up.disabled = true; up.textContent = '올리는 중…'; try { st.cover = await uploadImage(f); dirty = true; } catch (err) { toast(err.message, true); } draw(); return; }
      if (e.target.closest('[data-imgdel]')) { st.cover = null; dirty = true; draw(); return; }
      const b = e.target.closest('[data-act]'); if (!b) return;
      try {
        if (dirty) await save();
        if (b.dataset.act === 'save') toast('저장했어요.');
        if (b.dataset.act === 'preview' || b.dataset.act === 'cover') {
          const list = chosen();
          if (!list.length) { toast('실을 작품이 아직 없어요.', true); return; }
          if (b.dataset.act === 'preview') Book.open({ settings: st, works: list, track });
          else Book.openCover({ settings: st, works: list, track });
        }
      } catch (err) { toast(err.message, true); }
    };
  };

  // ---------- 사진첩 (참여자) ----------
  VIEWS.album = async (v, arg) => {
    const tracks = (S.me.tracks || []).filter(t => CUR[t]);
    if (!tracks.length) { v.innerHTML = '<div class="empty"><p>참여한 과정이 등록되면 사진첩을 쓸 수 있어요.</p></div>'; return; }
    let tr = tracks.includes(arg.track) ? arg.track : tracks.includes(S.lastTrack) ? S.lastTrack : tracks[0];
    let album = (await api('album')).album, photos = [], taken = new Set();
    const load = async () => { const r = await api('photos', { track: tr }); photos = r.photos; taken = new Set(r.taken); };
    await load();
    let mode = arg.mode || (album.length ? 'mine' : 'class');
    const draw = () => {
      v.innerHTML = `<h1 class="h">사진첩</h1>
        <div class="seg-btns" role="group"><button data-mode="class" aria-pressed="${mode === 'class'}">회차 사진</button><button data-mode="mine" aria-pressed="${mode === 'mine'}">내 사진첩 ${album.length}장</button></div>
        ${mode === 'class' ? `
          ${tracks.length > 1 ? `<div class="spines" role="group" aria-label="과정 고르기">${tracks.map(t => spine(t, t === tr)).join('')}</div>` : ''}
          <p class="lead">선생님이 올린 ${esc(CUR[tr].name)} 수업 사진이에요. 회차를 모르는 사진은 "구분 안 함"과 "전체 공용"에 있으니 거기서도 찾아보세요. 내가 나온 사진, 쓰고 싶은 사진을 "담기"로 내 사진첩에 가져가세요.</p>
          ${photoGroups(tr, photos).map(gr => { const list = gr.list; return `<section class="sess-ph">
            <h2 class="h2">${esc(gr.title)} <small>${esc(gr.sub)}</small></h2>
            ${list.length ? `<div class="grid-ph">${list.map(p => `<figure class="tile"><button class="tile-img" data-view="${esc(p.url)}" aria-label="크게 보기"><img src="${src(p)}" alt="" loading="lazy"></button>
              ${taken.has(p.id) ? '<span class="taken">담았어요</span>' : `<button class="btn btn-small btn-main" data-take="${p.id}">담기</button>`}</figure>`).join('')}</div>` : '<p class="muted">아직 올라온 사진이 없어요.</p>'}</section>`; }).join('')}`
        : `<p class="lead">사진첩의 사진은 "내 책 쓰기"에서 사진 칸에 넣을 수 있어요. 방향이 틀린 사진은 ↺ ↻로 돌려 주세요.</p>
          <button class="btn btn-main" id="addMine">내 사진 올리기 (여러 장)</button>
          ${album.length ? `<div class="grid-ph mine">${album.map((a, i) => `<figure class="tile"><button class="tile-img" data-view="${esc(a.url)}" aria-label="크게 보기"><img src="${src(a)}" alt="" loading="lazy"></button>
            <div class="tile-btns">${rotBtns(i)}<button class="btn btn-small btn-ghost" data-del="${i}">빼기</button></div></figure>`).join('')}</div>`
            : '<div class="empty"><p>아직 비어 있어요. 회차 사진에서 담아 오거나 내 사진을 올려 보세요.</p></div>'}`}`;
    };
    draw();
    v.onclick = async e => {
      const m = e.target.closest('[data-mode]'); if (m) { mode = m.dataset.mode; draw(); return; }
      const s = e.target.closest('[data-tr]'); if (s) { tr = s.dataset.tr; S.lastTrack = tr; await load(); draw(); return; }
      const vw = e.target.closest('[data-view]'); if (vw) { viewPhoto(vw.dataset.view); return; }
      const tk = e.target.closest('[data-take]');
      if (tk) { const r = await busy(tk, '담는 중…', () => api('album_add', { src: tk.dataset.take })); if (r) { album.unshift(r.item); taken.add(tk.dataset.take); toast('내 사진첩에 담았어요.'); draw(); } return; }
      if (e.target.closest('#addMine')) {
        const fs = await pickFiles(true); if (!fs.length) return;
        const b = $('#addMine', v); b.disabled = true;
        let n = 0;
        for (const f of fs) {
          b.textContent = `올리는 중… ${n + 1}/${fs.length}`;
          try { const x = await uploadImage(f); const r = await api('album_add', x); album.unshift(r.item); n++; } catch (err) { toast(err.message, true); }
        }
        toast(`${n}장을 올렸어요.`); draw(); return;
      }
      const rt = e.target.closest('[data-rot]');
      if (rt) {
        const [i, turn] = rt.dataset.rot.split(':').map(Number);
        const im = await busy(rt, '', () => rotateImage(album[i], turn));
        if (im) { try { await api('album_set', { aid: im.id, url: im.url, thumb: im.thumb, w: im.w, h: im.h }); album[i] = im; } catch (err) { toast(err.message, true); } draw(); }
        return;
      }
      const dl = e.target.closest('[data-del]');
      if (dl) {
        if (!(await ask('이 사진을 사진첩에서 뺄까요?', '이미 책 쪽에 넣은 사진은 그대로 남아요.', '빼기'))) return;
        try { await api('album_del', { aid: album[+dl.dataset.del].id }); album.splice(+dl.dataset.del, 1); draw(); } catch (err) { toast(err.message, true); }
      }
    };
  };

  // ---------- 회차 사진 올리기 (강사·운영자) ----------
  VIEWS.photos = async (v, arg) => {
    let tr = arg.track || S.photoTrack || 'small', photos = [];
    const load = async () => { S.photoTrack = tr; photos = (await api('photos', { track: tr })).photos; };
    await load();
    const draw = () => {
      v.innerHTML = `<h1 class="h">회차 사진</h1>
        <div class="spines" role="group" aria-label="과정 고르기">${TRACKS.map(t => spine(t, t === tr)).join('')}${allSpine(tr === ALL)}</div>
        <p class="lead">회차를 아는 사진은 회차에, 모르는 사진은 "구분 안 함"(그 과정 참여자만 봄)이나 "전체 공용"(모든 참여자가 봄)에 올려 주세요. 참여자가 자기 사진을 찾아 사진첩으로 담아 가요. ↺ ↻는 원본을 돌리고, "옮기기…"로 나중에 회차를 정해 줄 수 있어요.</p>
        ${photoGroups(tr, photos).map(gr => { const list = gr.list; return `<section class="sess-ph">
          <div class="row between"><h2 class="h2">${esc(gr.title)} <small>${esc(gr.sub)}, ${list.length}장</small></h2>
          <button class="btn btn-main btn-small" data-add="${gr.track}:${gr.no}">사진 올리기 (여러 장)</button></div>
          ${list.length ? `<div class="grid-ph">${list.map(p => `<figure class="tile"><button class="tile-img" data-view="${esc(p.url)}" aria-label="크게 보기"><img src="${src(p)}" alt="" loading="lazy"></button>
            <div class="tile-btns">${rotBtns(p.id)}${moveSelect(p)}<button class="btn btn-small btn-ghost btn-danger" data-del="${p.id}">지우기</button></div></figure>`).join('')}</div>` : '<p class="muted">아직 사진이 없어요.</p>'}</section>`; }).join('')}`;
    };
    draw();
    v.onchange = async e => {
      const mv = e.target.closest('[data-move]'); if (!mv || !mv.value) return;
      const [toTr, toNo] = mv.value.split(':');
      mv.disabled = true;
      try { await api('photo_move', { pid: mv.dataset.move, track: toTr, no: +toNo }); toast('옮겼어요.'); await load(); draw(); }
      catch (err) { toast(err.message, true); mv.disabled = false; mv.value = ''; }
    };
    v.onclick = async e => {
      const s = e.target.closest('[data-tr]'); if (s) { tr = s.dataset.tr; await load(); draw(); return; }
      const vw = e.target.closest('[data-view]'); if (vw) { viewPhoto(vw.dataset.view); return; }
      const ad = e.target.closest('[data-add]');
      if (ad) {
        const fs = await pickFiles(true); if (!fs.length) return;
        ad.disabled = true; let n = 0;
        const [toTr, toNo] = ad.dataset.add.split(':');
        for (const f of fs) {
          ad.textContent = `올리는 중… ${n + 1}/${fs.length}`;
          try { const x = await uploadImage(f); await api('photo_add', { track: toTr, no: +toNo, url: x.url, thumb: x.thumb, w: x.w, h: x.h }); n++; } catch (err) { toast(err.message, true); }
        }
        toast(`${n}장을 올렸어요.`); await load(); draw(); return;
      }
      const rt = e.target.closest('[data-rot]');
      if (rt) {
        const [id, turn] = rt.dataset.rot.split(':');
        const p = photos.find(x => x.id === id);
        const im = await busy(rt, '', () => rotateImage(p, +turn));
        if (im) { try { await api('photo_set', { pid: id, url: im.url, thumb: im.thumb, w: im.w, h: im.h }); Object.assign(p, im); } catch (err) { toast(err.message, true); } draw(); }
        return;
      }
      const dl = e.target.closest('[data-del]');
      if (dl) {
        if (!(await ask('이 사진을 지울까요?', '참여자가 이미 사진첩에 담아 간 사진은 그대로 남아요.', '지우기'))) return;
        try { await api('photo_del', { pid: dl.dataset.del }); await load(); draw(); } catch (err) { toast(err.message, true); }
      }
    };
  };

  // ---------- 참여자 관리 ----------
  const trackChecks = (pre, on = []) => `<div class="trk">${TRACKS.map(t => `<label class="check t-${t}"><input type="checkbox" name="${pre}" value="${t}" ${on.includes(t) ? 'checked' : ''}> ${CUR[t].name}</label>`).join('')}</div>`;
  const checked = (root, name) => $$(`input[name="${name}"]`, root).filter(c => c.checked).map(c => c.value);
  const randPin = () => String(Math.floor(1000 + Math.random() * 9000));

  VIEWS.people = async v => {
    const { people } = await api('people');
    v.innerHTML = `<h1 class="h">참여자</h1>
      <p class="lead">이름과 PIN 네 자리로 들어와요. 참여한 과정을 체크해야 그 과정의 책을 쓸 수 있어요. 두 과정에 참여했다면 둘 다 체크하세요.</p>
      <div class="backup"><button class="btn btn-small" id="backup">전체 백업 내려받기</button><span class="muted">참여자·작품·책 정보·사진 목록을 파일 하나(JSON)로 저장해요. 사진 파일 자체는 저장소에 그대로 있어요.</span></div>
      <details class="bulk" ${people.length < 3 ? 'open' : ''}><summary>여러 명 한꺼번에 등록하기</summary>
        <form id="bulk" class="stack">
          <label class="f">이름 (한 줄에 한 명)<textarea id="b_names" rows="6" placeholder="김하람&#10;박경순&#10;이서우"></textarea></label>
          <div class="f"><span>참여한 과정</span>${trackChecks('b_tr')}</div>
          <div class="row end"><button class="btn btn-main">등록하고 PIN 받기</button></div>
        </form></details>
      <form class="addp" id="af">
        <label class="f">이름<input id="a_name" required></label>
        <label class="f">역할<select id="a_role"><option value="member">참여자</option><option value="teacher">강사</option><option value="admin">운영자</option></select></label>
        <label class="f">PIN<input id="a_pin" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" required></label>
        <div class="f"><span>과정</span>${trackChecks('a_tr')}</div>
        <button class="btn btn-main">등록</button>
      </form>
      <div class="tbl-wrap"><table class="plist"><thead><tr><th>이름</th><th>역할</th><th>과정</th><th>안내·동의</th><th>상태</th><th></th></tr></thead>
      <tbody>${people.map(p => `<tr class="${p.active ? '' : 'off'}"><td>${esc(p.name)}</td><td>${ROLE[p.role]}</td>
        <td>${(p.tracks || []).map(t => `<span class="chip c-${t}">${CUR[t] ? CUR[t].name : t}</span>`).join(' ')}</td>
        <td>${p.role !== 'member' ? '<span class="muted">해당 없음</span>' : !p.consent ? '<span class="chip chip-wait">아직</span>'
          : `<span class="chip ${p.consent.ver === CONSENT.version ? 'chip-ok' : 'chip-wait'}">${p.consent.ver === CONSENT.version ? '확인' : '다시 받아야 함'}</span> AI ${p.consent.ai ? '동의' : '안 함'} <small class="muted">${fmtTime(p.consent.at)}</small>`}</td>
        <td>${!p.active ? '사용 중지' : p.locked ? '잠김 (PIN 5번 틀림)' : '사용 중'}</td>
        <td><button class="btn btn-small" data-edit="${p.id}">고치기</button></td></tr>`).join('')}</tbody></table></div>`;
    $('#a_pin', v).value = randPin();
    $('#backup', v).onclick = async e => {
      const b = e.target; b.disabled = true;
      try {
        const data = await api('backup');
        const a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
        a.download = `maeul-book-backup-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
        toast(`백업을 내려받았어요 (작품 ${data.works.length}편).`);
      } catch (err) { toast(err.message, true); }
      b.disabled = false;
    };
    $('#af', v).onsubmit = async e => {
      e.preventDefault();
      const name = $('#a_name', v).value.trim(), pin = $('#a_pin', v).value;
      try { await api('person_save', { name, role: $('#a_role', v).value, pin, tracks: checked(v, 'a_tr') }); toast(`${name}님을 등록했어요. PIN ${pin}를 알려 주세요.`); go('people'); }
      catch (err) { toast(err.message, true); }
    };
    $('#bulk', v).onsubmit = async e => {
      e.preventDefault();
      const names = $('#b_names', v).value.split('\n').map(s => s.trim()).filter(Boolean);
      const tracks = checked(v, 'b_tr');
      if (!names.length) { toast('이름을 한 줄에 한 명씩 적어 주세요.', true); return; }
      if (!tracks.length) { toast('참여한 과정을 하나 이상 체크해 주세요.', true); return; }
      const out = [];
      for (const name of names) {
        const pin = randPin();
        try { await api('person_save', { name, pin, role: 'member', tracks }); out.push([name, pin, '']); }
        catch (err) { out.push([name, '', err.message]); }
      }
      const d = modal(`<h2>등록 결과</h2><p class="muted">이 창을 닫으면 PIN을 다시 볼 수 없어요. 인쇄하거나 옮겨 적어 두세요.</p>
        <div class="tbl-wrap"><table class="pins"><thead><tr><th>이름</th><th>PIN</th></tr></thead><tbody>${out.map(([n, p, er]) => `<tr><td>${esc(n)}</td><td>${p ? `<b>${p}</b>` : `<span class="err">${esc(er)}</span>`}</td></tr>`).join('')}</tbody></table></div>
        <div class="row end"><button class="btn" id="pinCopy">글자로 복사</button><button class="btn btn-main" data-close>닫기</button></div>`);
      $('#pinCopy', d).onclick = async () => { try { await navigator.clipboard.writeText(out.filter(x => x[1]).map(x => `${x[0]}\t${x[1]}`).join('\n')); toast('복사했어요.'); } catch { toast('복사하지 못했어요. 표를 직접 옮겨 적어 주세요.', true); } };
      d.addEventListener('close', () => go('people'));
    };
    v.onclick = e => {
      const b = e.target.closest('[data-edit]'); if (!b) return;
      const p = people.find(x => x.id === b.dataset.edit);
      const d = modal(`<h2>${esc(p.name)}님 정보 고치기</h2><form id="ef" class="stack">
        <label class="f">이름<input id="e_name" value="${esc(p.name)}"></label>
        <label class="f">역할<select id="e_role">${Object.entries(ROLE).map(([k, l]) => `<option value="${k}" ${p.role === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <div class="f"><span>참여한 과정</span>${trackChecks('e_tr', p.tracks || [])}</div>
        <label class="f">새 PIN (바꿀 때만)<input id="e_pin" inputmode="numeric" maxlength="4" pattern="[0-9]{4}"></label>
        <label class="check"><input type="checkbox" id="e_act" ${p.active ? 'checked' : ''}> 사용 중 (끄면 로그인할 수 없어요)</label>
        <p class="muted">저장하면 PIN 잠김도 함께 풀려요.</p>
        <div class="row end"><button type="button" class="btn btn-ghost" data-close>취소</button><button class="btn btn-main">저장</button></div></form>`);
      $('#ef', d).onsubmit = async ev => {
        ev.preventDefault();
        try {
          await api('person_save', { id: p.id, name: $('#e_name', d).value, role: $('#e_role', d).value, tracks: checked(d, 'e_tr'), pin: $('#e_pin', d).value, active: $('#e_act', d).checked });
          d.close(); toast('저장했어요.'); go('people');
        } catch (err) { toast(err.message, true); }
      };
    };
  };

  // ---------- 시작 ----------
  async function start() {
    if (!C || !C.url || C.url.includes('YOUR-PROJECT')) {
      app.innerHTML = '<div class="empty"><p>config.js에 Supabase 주소와 키를 먼저 넣어 주세요.</p></div>';
      return;
    }
    if (!S.token) return loginView();
    try { S.me = (await api('me')).me; enter(); } catch { if (!S.me) loginView(); }
  }
  start();
})();
