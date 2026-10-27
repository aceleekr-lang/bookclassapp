/* 신국판(152×225mm) 조판 — 쪽 틀 14가지, 트랙별 합본, 브라우저 인쇄로 PDF 저장 */
(() => {
  'use strict';
  const W = 152, H = 225;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const paras = t => String(t || '').split(/\n+/).filter(s => s.trim()).map(s => `<p>${esc(s)}</p>`).join('');

  // 쪽 틀. fr = 그림 칸 크기(mm, 해상도 계산용), text = 글 칸 모양, head = 머리글 칸 안내
  const TPL = [
    { id: 'text',      name: '글만',               fr: [],                                   text: 'prose', head: '소제목 (없어도 돼요)' },
    { id: 'title',     name: '제목 쪽',             fr: [],                                   text: 'lead',  head: '큰 제목' },
    { id: 'imgTop',    name: '위 그림 + 글',         fr: [[116, 92]],                          text: 'prose', head: '소제목 (없어도 돼요)' },
    { id: 'imgBottom', name: '글 + 아래 그림',       fr: [[116, 92]],                          text: 'prose', head: '소제목 (없어도 돼요)' },
    { id: 'imgSmall',  name: '작은 그림 + 글',       fr: [[64, 50]],                           text: 'prose', head: '소제목 (없어도 돼요)' },
    { id: 'twoSide',   name: '그림 둘 나란히 + 글',   fr: [[56, 72], [56, 72]],                 text: 'prose', head: '소제목 (없어도 돼요)' },
    { id: 'two',       name: '그림 둘 위아래',        fr: [[116, 80], [116, 80]],               text: 'cap' },
    { id: 'grid4',     name: '사진 넷 모음',          fr: [[56, 74], [56, 74], [56, 74], [56, 74]], text: 'cap' },
    { id: 'full',      name: '그림 가득',            fr: [[W, H]],                             text: 'cap', bleed: true },
    { id: 'fullText',  name: '그림 가득 + 글 상자',   fr: [[W, H]],                             text: 'box', head: '소제목 (없어도 돼요)', bleed: true },
    { id: 'poem',      name: '시',                  fr: [[50, 40]],                           text: 'poem',  head: '시 제목', optional: true },
    { id: 'diary',     name: '그림일기',             fr: [[116, 82]],                          text: 'diary', head: '날짜와 날씨' },
    { id: 'quote',     name: '한마디',              fr: [],                                   text: 'quote', head: '누가 한 말 (없어도 돼요)' },
    { id: 'free',      name: '내 마음대로',           fr: [],                                   text: 'free',  free: true }
  ];
  const SAFE = 10; // 안전영역: 쪽 가장자리에서 안쪽 10mm
  const tpl = id => TPL.find(t => t.id === id) || TPL[0];
  const TRACK = { small: '작은BOOK', big: '큰BOOK', town: '동네BOOK' };

  // 그림이 칸에 들어갔을 때의 실제 해상도(dpi)
  function dpi(im, fr) {
    if (!im || !im.w || !im.h) return null;
    const r = im.w / im.h;
    const wmm = im.fit === 'contain' ? Math.min(fr[0], fr[1] * r) : Math.max(fr[0], fr[1] * r);
    return Math.round(im.w / (wmm / 25.4));
  }
  const level = d => d == null ? '' : d >= 220 ? 'ok' : d >= 150 ? 'warn' : 'bad';

  // lite: 쪽 모음처럼 작게 보일 때는 작은 사진(thumb)을 씀
  const frame = (im, fr, cls = '', lite = false) => im && im.url
    ? `<div class="fr ${cls}" style="width:${fr[0]}mm;height:${fr[1]}mm"><img src="${esc(lite && im.thumb ? im.thumb : im.url)}" alt="" style="object-fit:${im.fit === 'contain' ? 'contain' : 'cover'}"></div>`
    : `<div class="fr empty ${cls}" style="width:${fr[0]}mm;height:${fr[1]}mm"><span>그림 자리</span></div>`;

  // 엔터 한 번 = 새 문단(첫 칸 들여쓰기), 빈 줄 = 그만큼 띄우기(최대 두 줄), - · 1. 로 시작하는 줄 = 목록(내어쓰기)
  const LIST = /^\s*([-–•·*▪◦]|\d{1,2}[.)]|[①-⑳])\s+/;
  function lines(t) {
    let out = '', blank = 0;
    String(t || '').replace(/\r/g, '').replace(/\s+$/, '').split('\n').forEach(ln => {
      if (!ln.trim()) { blank++; return; }
      const cls = [out && blank ? 'g' + Math.min(blank, 2) : '', LIST.test(ln) ? 'li' : ''].filter(Boolean).join(' ');
      out += `<p${cls ? ` class="${cls}"` : ''}>${esc(ln.trim())}</p>`; blank = 0;
    });
    return out;
  }
  // 글 칸 안쪽 HTML (넘침 측정·나누기에도 같은 함수 사용)
  function flowInner(kind, text) {
    const t = String(text || '').replace(/\r/g, '');
    if (kind === 'poem') return `<div class="pin">${t.replace(/\s+$/, '').split('\n').map(l => l.trim() ? `<span class="pl">${esc(l.replace(/\s+$/, ''))}</span>` : '<span class="pb"></span>').join('')}</div>`;
    if (kind === 'diary') return esc(t.replace(/\s+$/, ''));
    if (kind === 'quote') return t.trim() ? `<p>${esc(t.trim())}</p>` : '';
    return lines(t);
  }
  const flow = (kind, text, pg) => `<div class="flow f-${kind}${pg && pg.indent === false ? ' noind' : ''}">${flowInner(kind, text)}</div>`;

  // 글꼴·크기·굵게 → CSS 변수 (굵게는 진짜 굵은 글씨가 있는 글꼴에서만)
  const F = () => window.FONT;
  function styleVars(s) {
    if (!s || !F()) return '';
    let out = '';
    if (s.font && F().get(s.font)) out += `--pf:${F().fam(s.font)};`;
    if (+s.size > 0) out += `--ps:${+s.size}pt;`;
    if (s.bold && (!s.font || F().canBold(s.font))) out += '--pfw:700;';
    return out;
  }
  // "내 마음대로" 쪽의 상자 하나 (mm 단위 절대 위치)
  function freeEl(el, i, lite) {
    const box = `left:${+el.x || 0}mm;top:${+el.y || 0}mm;width:${+el.w || 40}mm;height:${+el.h || 20}mm`;
    if (el.t === 'img') {
      const im = el.img;
      return `<div class="fe fe-img" data-el="${i}" style="${box}">${im && im.url
        ? `<img src="${esc(lite && im.thumb ? im.thumb : im.url)}" alt="" style="object-fit:${im.fit === 'contain' ? 'contain' : 'cover'}">`
        : '<span class="fe-ph">그림 상자</span>'}</div>`;
    }
    const st = styleVars(el);
    return `<div class="fe fe-text ${el.align ? 'al-' + el.align : ''}" data-el="${i}" style="${box};${st}"><div class="flow f-free">${lines(el.text) || '<p class="ph">글 상자</p>'}</div></div>`;
  }

  // 한 쪽의 안쪽 HTML (.trim 안에 들어감)
  function inner(pg, lite) {
    const t = tpl(pg.tpl), im = pg.imgs || [], h = String(pg.head || '').trim();
    const sub = h ? `<h3 class="sub">${esc(h)}</h3>` : '';
    const f = i => frame(im[i], t.fr[i], '', lite);
    switch (t.id) {
      case 'free': return `<div class="free">${(pg.els || []).map((el, i) => freeEl(el, i, lite)).join('')}</div>`;
      case 'title': return `<div class="ct col tt"><h2 class="tt-h">${esc(h) || '<span class="ph">큰 제목</span>'}</h2><div class="tt-rule"></div>${flow('lead', pg.text, pg)}</div>`;
      case 'imgTop': return `<div class="ct col">${f(0)}${sub}${flow('prose', pg.text, pg)}</div>`;
      case 'imgBottom': return `<div class="ct col">${sub}${flow('prose', pg.text, pg)}${f(0)}</div>`;
      case 'imgSmall': return `<div class="ct col">${f(0)}${sub}${flow('prose', pg.text, pg)}</div>`;
      case 'twoSide': return `<div class="ct col"><div class="frow">${f(0)}${f(1)}</div>${sub}${flow('prose', pg.text, pg)}</div>`;
      case 'two': return `<div class="ct col">${f(0)}${f(1)}${flow('cap', pg.text)}</div>`;
      case 'grid4': return `<div class="ct col"><div class="grid4">${f(0)}${f(1)}${f(2)}${f(3)}</div>${flow('cap', pg.text)}</div>`;
      case 'full': return `<div class="full">${frame(im[0], t.fr[0], '', lite)}</div>${String(pg.text || '').trim() ? `<div class="fcap">${flow('cap', pg.text)}</div>` : ''}`;
      case 'fullText': return `<div class="full">${frame(im[0], t.fr[0], '', lite)}</div><div class="fbox">${sub}${flow('prose', pg.text, pg)}</div>`;
      case 'poem': return `<div class="ct col poem">${h ? `<h3 class="poem-t">${esc(h)}</h3>` : ''}${flow('poem', pg.text)}${im[0] && im[0].url ? f(0) : ''}</div>`;
      case 'diary': return `<div class="ct col diary"><div class="d-head">${esc(h) || '<span class="ph">○월 ○일 ○요일 · 날씨</span>'}</div>${f(0)}${flow('diary', pg.text)}</div>`;
      case 'quote': return `<div class="ct col quote">${flow('quote', pg.text)}${h ? `<p class="q-by">${esc(h)}</p>` : ''}</div>`;
      default: return `<div class="ct col">${sub}${flow('prose', pg.text, pg)}</div>`;
    }
  }

  // 한 쪽 전체. n = 쪽 번호(홀수 오른쪽), folio=false면 쪽 번호 숨김
  function pageHTML(pg, { track = 'town', n = 1, folio = true, color = '#0F6E56', extra = '', lite = false } = {}) {
    const t = tpl(pg.tpl);
    const showFolio = folio && !t.bleed;
    return `<section class="pg pg-${t.id} t-${track} ${n % 2 ? 'r' : 'l'} ${extra}" style="--c:${esc(color)};${styleVars(pg.style)}">
      <div class="trim">${inner(pg, lite)}${showFolio ? `<span class="folio">${n}</span>` : ''}</div></section>`;
  }

  // 작품들에 쓰인 글꼴 id 전부
  function fontsOf(works) {
    const ids = new Set();
    works.forEach(w => (w.pages || []).forEach(pg => {
      if (pg.style && pg.style.font) ids.add(pg.style.font);
      (pg.els || []).forEach(el => { if (el.font) ids.add(el.font); });
    }));
    return [...ids];
  }
  // 안전영역 밖으로 나간 상자 (글 상자만; 그림은 가장자리까지 나가도 됨)
  const outsideSafe = el => (+el.x || 0) < SAFE || (+el.y || 0) < SAFE || (+el.x || 0) + (+el.w || 0) > W - SAFE || (+el.y || 0) + (+el.h || 0) > H - SAFE;

  // ---------- 넘침 측정 ----------
  const overflows = el => el.scrollHeight > el.clientHeight + 2;
  function markOver(root) {
    let n = 0;
    root.querySelectorAll('.flow').forEach(el => { const o = overflows(el); el.classList.toggle('over', o); if (o) n++; });
    return n;
  }

  // 이 쪽에 들어가는 글자 수(끝 위치). 전부 들어가면 text.length
  async function fitLength(pg, track) {
    await document.fonts.ready;
    const host = document.createElement('div');
    host.className = 'measure-host';
    host.innerHTML = pageHTML(pg, { track, folio: true });
    document.body.append(host);
    try {
      const el = host.querySelector('.flow');
      const text = String(pg.text || '');
      if (!el) return text.length;
      const kind = [...el.classList].find(c => c.startsWith('f-')).slice(2);
      const set = len => { el.innerHTML = flowInner(kind, text.slice(0, len)); return !overflows(el); };
      if (set(text.length)) return text.length;
      let lo = 0, hi = text.length;
      while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (set(mid)) lo = mid; else hi = mid - 1; }
      // 낱말이나 줄 경계에서 자르기
      const nl = text.lastIndexOf('\n', lo), sp = text.lastIndexOf(' ', lo);
      const cut = nl > lo - 60 && nl > 0 ? nl : sp > lo - 20 && sp > 0 ? sp : lo;
      return cut;
    } finally { host.remove(); }
  }

  // ---------- 합본 내지 (표지는 따로) ----------
  // 쪽수 맞춤 단위: 0(안 맞춤)·2·4·8·16. 예전 설정 pad4=false는 0
  const padUnit = st => (st.pad != null && st.pad !== '' ? +st.pad : st.pad4 === false ? 0 : 4);
  function buildBook(st, works, track, single) {
    const list = [];
    const color = st.color || '#0F6E56';
    if (!single) {
      // 속표지 → 빈 쪽 → 차례 → (책을 펴내며)
      list.push({ special: 'title', folio: false, html: `<div class="tpage">
          <p class="tpage-s">${esc(TRACK[track] || '')}</p>
          <h1 class="tpage-t">${esc(st.title || '')}</h1>
          ${st.subtitle ? `<p class="tpage-sub">${esc(st.subtitle)}</p>` : ''}
          <p class="tpage-pub">${esc(st.publisher || '')}</p></div>` });
      list.push({ special: 'blank', folio: false, html: '' });
      list.push({ special: 'toc', html: '' }); // 차례는 쪽 번호가 정해진 뒤 채움
      if (String(st.greeting || '').trim()) list.push({ special: 'greet', html: `<div class="ct"><h2 class="bk-h">책을 펴내며</h2><div class="greet">${paras(st.greeting)}</div></div>` });
    }
    works.forEach((w, wi) => {
      const by = w.pen_name || w.name || '';
      // 작가 여는 쪽을 오른쪽(홀수)에서 시작 (끌 수 있음)
      if (!single && st.right_start !== false && (list.length + 1) % 2 === 0) list.push({ special: 'blank', folio: false, html: '' });
      w._start = list.length + 1;
      list.push({ special: 'opener', folio: false, html: `<div class="op">
          <div class="op-bar"></div>
          <h2 class="op-t">${esc(w.title || '제목 없음')}</h2>
          <p class="op-by">글·그림 ${esc(by)}</p>
          ${String(w.intro || '').trim() ? `<p class="op-intro">${esc(w.intro)}</p>` : ''}</div>` });
      (w.pages || []).forEach((pg, pi) => list.push({ pg, wi, pi }));
    });
    if (!single) {
      list.push({ special: 'credits', html: `<div class="ct"><h2 class="bk-h">함께 만든 사람들</h2>
        <ul class="authors">${works.map(w => `<li>${esc(w.pen_name || w.name)}</li>`).join('')}</ul>
        <div class="credits">${paras(st.credits)}</div></div>` });
      const u = padUnit(st);
      if (u > 1) { const pads = (u - ((list.length + 1) % u)) % u; for (let i = 0; i < pads; i++) list.push({ special: 'blank', folio: false, html: '' }); }
      list.push({ special: 'colo', folio: false, html: `<div class="colo">
          <p class="colo-t">${esc(st.title)}</p>
          <dl>${st.date ? `<dt>펴낸 날</dt><dd>${esc(st.date)}</dd>` : ''}${st.publisher ? `<dt>펴낸 곳</dt><dd>${esc(st.publisher)}</dd>` : ''}${st.isbn ? `<dt>ISBN</dt><dd>${esc(st.isbn)}</dd>` : ''}</dl>
          ${st.ai_notice ? `<p>${esc(st.ai_notice)}</p>` : ''}
          <p>이 책에 실린 글과 그림의 저작권은 각 저자에게 있습니다. 저자의 허락 없이 옮겨 쓸 수 없습니다.</p><p>비매품</p></div>` });
    }
    const toc = list.find(x => x.special === 'toc');
    if (toc) toc.html = `<div class="ct"><h2 class="bk-h">차례</h2><ol class="toc ${works.length > 16 ? 'dense' : ''}">${works.map(w =>
      `<li><span class="tt">${esc(w.title || '제목 없음')}</span><span class="ta">${esc(w.pen_name || w.name)}</span><span class="tp">${w._start}</span></li>`).join('')}</ol></div>`;
    return list.map((x, i) => {
      const n = i + 1;
      if (x.pg) return pageHTML(x.pg, { track, n, color, extra: `w${x.wi}` }).replace('<section ', `<section data-w="${x.wi}" data-p="${x.pi}" `);
      return `<section class="pg pg-${x.special} t-${track} ${n % 2 ? 'r' : 'l'}" style="--c:${esc(color)}">
        <div class="trim">${x.html}${x.folio !== false ? `<span class="folio">${n}</span>` : ''}</div></section>`;
    });
  }
  // 내지 쪽수와 책등 폭(mm). 인쇄소가 준 책등 폭(spine_mm)이 있으면 그 값
  function spine(settings, works, track) {
    const st = settings || {};
    const pages = buildBook(st, works.map(w => ({ ...w })), track, false).length;
    const paper = +st.paper_mm > 0 ? +st.paper_mm : 0.1;
    const auto = Math.round((Math.ceil(pages / 2) * paper + 0.5) * 10) / 10; // 표지 접힘 여유 0.5mm
    return { pages, auto, mm: +st.spine_mm > 0 ? +st.spine_mm : auto, given: +st.spine_mm > 0 };
  }

  // ---------- 미리보기 창 (내지·표지 공용) ----------
  const hooks = [];
  function close() {
    while (hooks.length) hooks.pop()();
    const old = document.getElementById('bookView');
    if (old) old.remove();
    document.body.classList.remove('bk-open');
  }
  async function mount({ title, info, pagesHTML, PW, PH, bl, one, check, onClose, works = [] }) {
    close();
    document.getElementById('pageSize').textContent = `@page { size: ${PW}mm ${PH}mm; margin: 0; }`;
    const root = document.createElement('div');
    root.id = 'bookView';
    root.innerHTML = `
      <div class="bk-bar">
        <div class="bk-bar-l"><b>${esc(title)}</b><span>${esc(info)}</span></div>
        <div class="bk-bar-r">
          <button class="btn btn-main btn-small" data-bk="print">PDF로 저장하기</button>
          <button class="btn btn-small" data-bk="close">닫기</button>
        </div>
      </div>
      <div class="bk-warn" id="bkWarn"><p>쪽을 맞추는 중…</p></div>
      <div class="bk-pages ${bl ? 'bleed' : ''} ${one ? 'one fixed' : ''}" style="--pw:${PW}mm;--ph:${PH}mm;--bl:${bl}mm">${pagesHTML}</div>`;
    document.body.append(root);
    document.body.classList.add('bk-open');
    root.addEventListener('click', async e => {
      const b = e.target.closest('[data-bk]');
      if (!b) return;
      if (b.dataset.bk === 'close') { close(); onClose && onClose(); }
      if (b.dataset.bk === 'print') {
        const imgs = [...root.querySelectorAll('img')];
        await Promise.all(imgs.map(im => im.complete ? 0 : new Promise(r => { im.onload = im.onerror = r; })));
        window.print();
      }
    });
    const pagesEl = root.querySelector('.bk-pages');
    if (F()) await F().load(fontsOf(works));
    await document.fonts.ready;
    const warn = check(pagesEl);
    root.querySelector('#bkWarn').innerHTML = warn.length
      ? `<details ${warn.some(x => x[0] === 'bad') ? 'open' : ''}><summary>확인할 것 ${warn.length}가지</summary><ul>${warn.map(([lv, t]) => `<li class="${lv}">${esc(t)}</li>`).join('')}</ul></details>`
      : '<p class="ok">문제없이 조판됐어요. 인쇄 전에 오탈자만 한 번 더 확인하세요.</p>';
    const fit = () => {
      const pw = PW * 96 / 25.4;
      const cols = one || window.innerWidth < 720 ? 1 : 2;
      pagesEl.classList.toggle('one', cols === 1);
      pagesEl.style.zoom = Math.min(1, (window.innerWidth - 32) / (pw * cols + 24));
    };
    fit();
    window.addEventListener('resize', fit);
    hooks.push(() => window.removeEventListener('resize', fit));
    return warn;
  }

  // 내지 미리보기 (single: 한 사람 작품만)
  async function open({ settings, works, track, single = false, onClose }) {
    const st = Object.assign({ title: '', color: '#0F6E56', bleed: false }, settings || {});
    const bl = st.bleed ? 3 : 0;
    works = works.map(w => ({ ...w }));
    const pages = buildBook(st, works, track, single);
    const u = padUnit(st);
    const info = `신국판 152×225mm 내지, ${pages.length}쪽${!single && u > 1 && pages.length % u === 0 ? `(${u}의 배수)` : ''}${bl ? ', 도련 3mm 포함' : ''}`;
    const warn = await mount({ title: single ? '내 쪽 미리보기' : `${st.title || '책'} 내지`, info, pagesHTML: pages.join(''), PW: W + bl * 2, PH: H + bl * 2, bl, onClose, works,
      check: pagesEl => {
        const warn = [];
        works.forEach((w, wi) => {
          const who = `${w.pen_name || w.name}「${w.title || '제목 없음'}」`;
          if (!String(w.title || '').trim()) warn.push(['bad', `${w.pen_name || w.name}: 작품 제목이 없어요.`]);
          (w.pages || []).forEach((pg, pi) => {
            const t = tpl(pg.tpl), el = pagesEl.querySelector(`section[data-w="${wi}"][data-p="${pi}"]`);
            const where = `${who} ${pi + 1}번째 쪽`;
            if (el && markOver(el)) warn.push(['bad', `${where}: 글이 칸을 넘쳐서 잘려요. 줄이거나 다음 쪽으로 나눠 주세요.`]);
            t.fr.forEach((fr, i) => {
              const im = (pg.imgs || [])[i];
              if (!im || !im.url) { if (!t.optional) warn.push(['warn', `${where}: 그림 칸 ${t.fr.length > 1 ? i + 1 + '번이' : '이'} 비어 있어요.`]); return; }
              const d = dpi(im, fr), lv = level(d);
              if (lv === 'bad') warn.push(['bad', `${where}: 그림 해상도가 낮아요(약 ${d}dpi). 흐리게 인쇄돼요.`]);
              else if (lv === 'warn') warn.push(['warn', `${where}: 그림 해상도가 조금 낮아요(약 ${d}dpi).`]);
            });
            if (t.free) {
              const els = pg.els || [];
              if (!els.length) warn.push(['warn', `${where}: 아무것도 넣지 않은 빈 쪽이에요.`]);
              els.forEach((el, i) => {
                const nm = `${el.t === 'img' ? '그림' : '글'} 상자 ${i + 1}`;
                if (el.t === 'img') {
                  if (!el.img || !el.img.url) { warn.push(['warn', `${where}: ${nm}이 비어 있어요.`]); return; }
                  const d = dpi(el.img, [+el.w || 1, +el.h || 1]), lv = level(d);
                  if (lv === 'bad') warn.push(['bad', `${where}: ${nm} 해상도가 낮아요(약 ${d}dpi).`]);
                  else if (lv === 'warn') warn.push(['warn', `${where}: ${nm} 해상도가 조금 낮아요(약 ${d}dpi).`]);
                } else if (outsideSafe(el)) warn.push(['warn', `${where}: ${nm}가 안전영역(가장자리 10mm) 밖으로 나가 있어요. 재단할 때 잘릴 수 있어요.`]);
              });
            } else if (t.text !== 'cap' && t.id !== 'title' && !String(pg.text || '').trim()) warn.push(['warn', `${where}: 글이 비어 있어요.`]);
          });
          if (!single && !w.confirmed_at) warn.push(['warn', `${who}: 아직 "책에 실어도 좋아요"를 누르지 않았어요.`]);
        });
        if (!single && !st.bleed) {
          const nFull = works.reduce((a, w) => a + (w.pages || []).filter(pg => tpl(pg.tpl).bleed).length, 0);
          if (nFull) warn.unshift(['warn', `"그림 가득" 쪽이 ${nFull}쪽 있어요. 인쇄소에 넘길 PDF는 "도련 3mm 넣기"를 켜고 저장해야 재단할 때 흰 테두리가 생기지 않아요.`]);
        }
        return warn;
      } });
    return { pages: pages.length, warnings: warn };
  }

  // 펼침 표지: [날개] 뒤표지 | 책등 | 앞표지 [날개], 도련 3mm 항상 포함
  async function openCover({ settings, works, track, onClose }) {
    const st = Object.assign({ title: '', color: '#0F6E56' }, settings || {});
    const sp = spine(st, works, track), fl = Math.max(0, +st.flap_mm || 0), bl = 3;
    const CW = fl * 2 + W * 2 + sp.mm, PW = CW + bl * 2, PH = H + bl * 2;
    const x = { back: fl, spine: fl + W, front: fl + W + sp.mm, flap2: fl + W * 2 + sp.mm };
    const fs = Math.min(11, (sp.mm - 1.5) * 2.83 * 0.85); // 책등 글자 크기(pt)
    const guides = [fl && x.back, x.spine, x.front, fl && x.flap2].filter(v => v).map(v => `<i class="sp-guide" style="left:${v}mm"></i>`).join('');
    const html = `<section class="pg spread t-${track}" style="--c:${esc(st.color)};background:${esc(st.color)}">
      <div class="sp-in" style="left:${bl}mm;top:${bl}mm;width:${CW}mm;height:${H}mm">
        ${fl ? `<div class="sp-flap" style="left:0;width:${fl}mm"></div>` : ''}
        <div class="sp-back" style="left:${x.back}mm;width:${W}mm">
          <div class="sp-back-in">${paras(st.back_text)}</div>
          <p class="sp-back-pub">${esc(st.publisher || '')}</p>
          ${st.isbn ? '<div class="sp-barcode">바코드 자리</div>' : ''}</div>
        <div class="sp-spine" style="left:${x.spine}mm;width:${sp.mm}mm">${sp.mm >= 4 ? `<span class="sp-st" style="font-size:${fs.toFixed(1)}pt">${esc(st.title || '')}</span><span class="sp-sp" style="font-size:${Math.max(5, fs * 0.75).toFixed(1)}pt">${esc(st.publisher || '')}</span>` : ''}</div>
        <div class="sp-front" style="left:${x.front}mm;width:${W}mm"><div class="cv">
          <p class="cv-series">${esc(TRACK[track] || '')}</p>
          <h1 class="cv-t">${esc(st.title || '')}</h1>
          ${st.subtitle ? `<p class="cv-sub">${esc(st.subtitle)}</p>` : ''}
          <div class="cv-img">${st.cover && st.cover.url ? `<img src="${esc(st.cover.url)}" alt="">` : ''}</div>
          <p class="cv-pub">${esc(st.publisher || '')}</p></div></div>
        ${fl ? `<div class="sp-flap" style="left:${x.flap2}mm;width:${fl}mm"></div>` : ''}
        ${guides}
      </div></section>`;
    const info = `펼침 표지 ${PW.toFixed(1)}×${PH}mm (도련 3mm 포함), 책등 ${sp.mm}mm${sp.given ? '(인쇄소 값)' : `(내지 ${sp.pages}쪽 기준 자동 계산)`}${fl ? `, 날개 ${fl}mm` : ''}`;
    return mount({ title: `${st.title || '책'} 표지`, info, pagesHTML: html, PW, PH, bl, one: true, onClose,
      check: () => {
        const w = [];
        if (!sp.given) w.push(['warn', `책등 폭 ${sp.mm}mm는 내지 ${sp.pages}쪽, 종이 한 장 ${+st.paper_mm > 0 ? st.paper_mm : 0.1}mm로 어림한 값이에요. 인쇄소가 알려 준 책등 폭을 넣으면 그 값으로 만들어요.`]);
        if (sp.mm < 4) w.push(['warn', '책등이 4mm보다 얇아서 책등에 글자를 넣지 않았어요.']);
        if (!(st.cover && st.cover.url)) w.push(['warn', '앞표지 그림이 없어요.']);
        else { const d = dpi(st.cover, [120, 120]); if (level(d) === 'bad') w.push(['bad', `앞표지 그림 해상도가 낮아요(약 ${d}dpi).`]); }
        if (st.isbn) w.push(['warn', 'ISBN 바코드는 인쇄소나 발행처에서 받은 바코드로 "바코드 자리"를 채워야 해요.']);
        w.push(['warn', '화면의 점선은 접는 자리 안내예요. PDF에는 나오지 않아요.']);
        return w;
      } });
  }

  window.Book = { TPL, tpl, TRACK, W, H, SAFE, pageHTML, markOver, fitLength, dpi, level, open, openCover, spine, close, fontsOf, outsideSafe, freeEl };
})();
