// 통합 Supabase 프로젝트 (별동산·이야기책 접수 등과 같은 프로젝트). 이미 채워져 있어요.
window.BK_CONFIG = {
  url: 'https://snaldhxucwsaifqrccih.supabase.co',           // Project URL
  key: 'sb_publishable_Jw04C4E_pWJFd7-IT3gyqw_onzKKmrq',       // publishable 키 (공개용). 혹시 401 오류가 나면 Legacy anon 키(eyJ…)로 바꿔 보세요. secret 키는 절대 넣지 마세요
  title: '마을작가 책 만들기',                    // 앱 이름
  bucket: 'bk-book',                            // 사진 저장소 이름 (schema.sql과 같아야 함)
  proofUrl: '/api/proof',                       // AI 교정 서버 함수 주소 (Vercel에 함께 배포되면 그대로 두기)
  // (선택) 첫 로그인 안내문을 바꾸려면 아래 // 를 지우고 고치세요. version을 바꾸면 모든 참여자에게 다시 안내·동의를 받아요.
  // consent: { version: '1', photo: '사진 안내 글', ai: 'AI 교정 안내 글', guardian: '어린이는 보호자와 함께 읽고 체크해 주세요.' }
};
