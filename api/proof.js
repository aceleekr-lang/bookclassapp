// AI 교정 서버 함수 (Vercel) — 로그인 확인과 하루 횟수는 Supabase bk_api('proof_use')가 맡음
// 필요한 환경변수: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY  (선택: PROOF_MODEL)

const SYSTEM = `당신은 동네 책 만들기 수업의 교정 선생님입니다. 참여자는 초등학생부터 어르신까지이고, 자기 동네와 기억을 글로 씁니다.
할 일: 받은 글에서 고칠 곳을 찾아 JSON으로만 답합니다.

원칙
- 글쓴이의 말투, 낱말 선택, 사투리(경상도·밀양 말), 아이다운 표현은 살립니다. 멋을 부리거나 내용을 보태지 않습니다.
- 사람 이름, 장소, 날짜, 사실은 바꾸지 않습니다.
- mode가 "spell"이면 맞춤법, 띄어쓰기, 문장부호, 명백한 오타만 고칩니다.
- mode가 "style"이면 거기에 더해 뜻이 헷갈리는 문장, 주어와 서술어가 안 맞는 문장, 같은 말이 지나치게 반복되는 곳까지 고칩니다. 그래도 최소한으로 고칩니다.
- kind가 "poem"이면 줄 바꿈, 반복, 시적 표현을 그대로 둡니다. 명백한 맞춤법 오류만 고칩니다.
- kind가 "diary"이거나 track이 "small"이면 어린이 글입니다. 설명은 초등학생이 알아듣는 쉬운 존댓말로 씁니다.

형식
- items: 고칠 곳 목록, 최대 30개. 글 앞쪽부터 순서대로.
  - from: 원문에 있는 그대로 복사한 부분. 고칠 곳을 포함하는 가장 짧은 어절이나 구절이며, 원문에서 한 번만 나오도록 앞뒤 낱말을 조금 붙여도 됩니다. 줄 바꿈은 넣지 않습니다.
  - to: from을 바꿀 말.
  - why: 왜 고치는지 한 문장, 20자 안팎.
- comment: 이 글에서 좋은 점 하나를 구체적으로 짚는 한두 문장. 칭찬을 부풀리지 않습니다.
- 고칠 곳이 없으면 items는 빈 배열입니다.
- 다른 말 없이 {"items":[...],"comment":"..."} JSON 하나만 출력합니다.`;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'POST로만 부를 수 있어요.' }); return; }
  const { ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, PROOF_MODEL } = process.env;
  if (!ANTHROPIC_API_KEY || !SUPABASE_URL || !SUPABASE_ANON_KEY) {
    res.status(500).json({ error: '교정 서버 설정(환경변수)이 비어 있어요. 운영자에게 알려 주세요.' }); return;
  }
  let body = req.body || {};
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch { body = {}; } }
  const text = String(body.text || '');
  const mode = body.mode === 'style' ? 'style' : 'spell';
  const kind = ['poem', 'diary', 'prose', 'cap', 'box', 'lead', 'quote'].includes(body.kind) ? body.kind : 'prose';
  const track = ['small', 'big', 'town'].includes(body.track) ? body.track : 'town';
  if (text.replace(/\s/g, '').length < 2) { res.status(400).json({ error: '교정할 글이 없어요.' }); return; }
  if (text.length > 3000) { res.status(400).json({ error: '한 번에 3,000자까지 교정할 수 있어요. 쪽을 나눠서 해 주세요.' }); return; }

  // 1) 로그인 확인 + 오늘 남은 횟수 확인 (여기서는 차감하지 않음)
  const h = { apikey: SUPABASE_ANON_KEY, 'Content-Type': 'application/json' };
  if (SUPABASE_ANON_KEY.startsWith('eyJ')) h.Authorization = 'Bearer ' + SUPABASE_ANON_KEY;
  const rpc = async (action, data = {}) => {
    const r = await fetch(`${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/rpc/bk_api`, {
      method: 'POST', headers: h, body: JSON.stringify({ p_token: String(body.token || ''), p_action: action, p_data: data })
    });
    return r.json();
  };
  let q;
  try { q = await rpc('proof_check', { id: String(body.owner || '') }); }  // owner: 강사가 대신 교정할 때 글 주인
  catch { res.status(502).json({ error: '로그인 확인을 하지 못했어요. 잠시 뒤 다시 해 주세요.' }); return; }
  if (!q || q.error) { res.status(q && q.error === 'auth' ? 401 : 403).json({ error: (q && q.error) || '로그인 확인 실패' }); return; }

  // 2) Claude에게 교정 요청
  let out;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: PROOF_MODEL || 'claude-sonnet-5-5',
        max_tokens: 3000,
        system: SYSTEM,
        messages: [{ role: 'user', content: `mode: ${mode}\nkind: ${kind}\ntrack: ${track}\n\n<글>\n${text}\n</글>` }]
      })
    });
    const j = await r.json();
    if (!r.ok) throw new Error((j && j.error && j.error.message) || `status ${r.status}`);
    const raw = (j.content || []).filter(c => c.type === 'text').map(c => c.text).join('');
    const a = raw.indexOf('{'), b = raw.lastIndexOf('}');
    out = JSON.parse(raw.slice(a, b + 1));
  } catch (e) {
    console.error('proof error', e && e.message);
    res.status(502).json({ error: 'AI 교정이 잠깐 안 돼요. 조금 뒤 다시 눌러 주세요.' }); return;
  }

  // 3) 원문에 실제로 있는 것만 돌려줌
  const items = (Array.isArray(out.items) ? out.items : [])
    .filter(it => it && typeof it.from === 'string' && typeof it.to === 'string' && it.from && it.from !== it.to && text.includes(it.from))
    .slice(0, 30)
    .map(it => ({ from: it.from, to: it.to, why: String(it.why || '').slice(0, 80) }));
  // 4) 성공했을 때만 오늘 횟수 1 차감
  let used = null;
  try { used = (await rpc('proof_use')).used; } catch { /* 셈 실패는 교정 결과에 영향 없음 */ }
  res.status(200).json({ items, comment: String(out.comment || '').slice(0, 300), used });
};
