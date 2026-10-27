/* 쓸 수 있는 글꼴 — 모두 Google Fonts(OFL)라 책으로 인쇄·배포해도 됩니다.
   줄을 지우거나 더하면 앱에 바로 반영돼요. bold: true 인 글꼴만 "굵게"를 켤 수 있어요(진짜 굵은 글씨가 있는 글꼴).
   id: 저장에 쓰는 이름(바꾸지 마세요) / name: 화면 이름 / fam: CSS 글꼴 이름 / g: Google Fonts 이름 / w: 불러올 굵기 */
window.FONTS = [
  // 본문 명조
  { id: 'gowun-batang', name: '고운바탕', fam: "'Gowun Batang', serif", g: 'Gowun+Batang', w: '400;700', bold: true, group: '본문 명조', def: true },
  { id: 'nanum-myeongjo', name: '나눔명조', fam: "'Nanum Myeongjo', serif", g: 'Nanum+Myeongjo', w: '400;700', bold: true, group: '본문 명조' },
  { id: 'noto-serif', name: '노토 세리프', fam: "'Noto Serif KR', serif", g: 'Noto+Serif+KR', w: '400;700', bold: true, group: '본문 명조' },
  { id: 'hahmlet', name: '함렛', fam: "'Hahmlet', serif", g: 'Hahmlet', w: '400;700', bold: true, group: '본문 명조' },
  { id: 'song-myung', name: '송명', fam: "'Song Myung', serif", g: 'Song+Myung', w: '400', bold: false, group: '본문 명조' },
  // 본문 고딕
  { id: 'gowun-dodum', name: '고운돋움', fam: "'Gowun Dodum', sans-serif", g: 'Gowun+Dodum', w: '400', bold: false, group: '본문 고딕' },
  { id: 'nanum-gothic', name: '나눔고딕', fam: "'Nanum Gothic', sans-serif", g: 'Nanum+Gothic', w: '400;700', bold: true, group: '본문 고딕' },
  { id: 'noto-sans', name: '노토 산스', fam: "'Noto Sans KR', sans-serif", g: 'Noto+Sans+KR', w: '400;700', bold: true, group: '본문 고딕' },
  { id: 'gothic-a1', name: '고딕 A1', fam: "'Gothic A1', sans-serif", g: 'Gothic+A1', w: '400;700', bold: true, group: '본문 고딕' },
  { id: 'pretendard', name: '프리텐다드', fam: "'Pretendard Variable', Pretendard, sans-serif", g: null, w: '', bold: true, group: '본문 고딕' },
  // 손글씨·아이들 글
  { id: 'gaegu', name: '개구', fam: "'Gaegu', cursive", g: 'Gaegu', w: '400;700', bold: true, group: '손글씨' },
  { id: 'nanum-pen', name: '나눔손글씨 펜', fam: "'Nanum Pen Script', cursive", g: 'Nanum+Pen+Script', w: '400', bold: false, group: '손글씨' },
  { id: 'hi-melody', name: '하이멜로디', fam: "'Hi Melody', cursive", g: 'Hi+Melody', w: '400', bold: false, group: '손글씨' },
  { id: 'poor-story', name: '푸어스토리', fam: "'Poor Story', cursive", g: 'Poor+Story', w: '400', bold: false, group: '손글씨' },
  { id: 'gamja-flower', name: '감자꽃', fam: "'Gamja Flower', cursive", g: 'Gamja+Flower', w: '400', bold: false, group: '손글씨' },
  { id: 'dongle', name: '동글', fam: "'Dongle', sans-serif", g: 'Dongle', w: '400;700', bold: true, group: '손글씨' },
  // 둥글둥글·귀여운
  { id: 'jua', name: '주아', fam: "'Jua', sans-serif", g: 'Jua', w: '400', bold: false, group: '둥근 글씨' },
  { id: 'do-hyeon', name: '도현', fam: "'Do Hyeon', sans-serif", g: 'Do+Hyeon', w: '400', bold: false, group: '둥근 글씨' },
  { id: 'cute-font', name: '귀여운', fam: "'Cute Font', cursive", g: 'Cute+Font', w: '400', bold: false, group: '둥근 글씨' },
  { id: 'yeon-sung', name: '연성', fam: "'Yeon Sung', cursive", g: 'Yeon+Sung', w: '400', bold: false, group: '둥근 글씨' },
  { id: 'single-day', name: '싱글데이', fam: "'Single Day', cursive", g: 'Single+Day', w: '400', bold: false, group: '둥근 글씨' },
  // 굵은 제목용 (원래 굵은 글꼴)
  { id: 'black-han', name: '검은고딕', fam: "'Black Han Sans', sans-serif", g: 'Black+Han+Sans', w: '400', bold: false, group: '굵은 제목', heavy: true },
  { id: 'bagel-fat', name: '바겔팻원', fam: "'Bagel Fat One', cursive", g: 'Bagel+Fat+One', w: '400', bold: false, group: '굵은 제목', heavy: true },
  { id: 'gasoek', name: '가속원', fam: "'Gasoek One', sans-serif", g: 'Gasoek+One', w: '400', bold: false, group: '굵은 제목', heavy: true }
];

// 글꼴 불러오기: 고른 글꼴만 그때그때 불러와요 (전부 미리 불러오면 느려서)
(() => {
  const loaded = new Set();
  const byId = Object.fromEntries(window.FONTS.map(f => [f.id, f]));
  window.FONT = {
    byId,
    def: window.FONTS.find(f => f.def) || window.FONTS[0],
    get: id => byId[id] || null,
    fam: id => (byId[id] || window.FONT.def).fam,
    canBold: id => !!(byId[id] && byId[id].bold),
    // id 목록(또는 하나)을 불러오고 글꼴 준비가 끝날 때까지 기다림
    async load(ids) {
      const list = (Array.isArray(ids) ? ids : [ids]).map(id => byId[id]).filter(f => f && f.g && !loaded.has(f.id));
      list.forEach(f => {
        loaded.add(f.id);
        const l = document.createElement('link');
        l.rel = 'stylesheet';
        l.href = `https://fonts.googleapis.com/css2?family=${f.g}${f.w ? ':wght@' + f.w : ''}&display=swap`;
        document.head.append(l);
      });
      if (list.length) {
        // 글꼴 파일은 처음 글자를 그릴 때 받아오므로 한 번 그려 보고 기다림
        const probe = document.createElement('div');
        probe.style.cssText = 'position:fixed;left:-9999px;top:0;visibility:hidden';
        probe.innerHTML = list.map(f => `<span style="font-family:${f.fam}">가나다</span><b style="font-family:${f.fam}">가</b>`).join('');
        document.body.append(probe);
        try { await Promise.race([document.fonts.ready.then(() => new Promise(r => setTimeout(r, 300))), new Promise(r => setTimeout(r, 4000))]); }
        finally { probe.remove(); }
      }
      await document.fonts.ready;
    }
  };
})();
