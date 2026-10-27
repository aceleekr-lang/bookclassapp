-- =====================================================================
--  마을작가 책 만들기 (작은BOOK·큰BOOK·동네BOOK) — Supabase 스키마
--  통합 프로젝트용, 모든 테이블 접두어 bk_ (다른 앱 테이블은 건드리지 않음)
--  사용법: SQL Editor → 이 파일 전체 붙여넣기 → 맨 아래 운영자 이름·PIN 바꾸기 → Run
--  여러 번 실행해도 기존 데이터는 지워지지 않습니다.
-- =====================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- ---------- 테이블 ----------
-- tracks: 'small'(작은BOOK) 'big'(큰BOOK) 'town'(동네BOOK) 중 참여한 것들
create table if not exists public.bk_people (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  pin_hash text not null,
  role text not null default 'member' check (role in ('member','teacher','admin')),
  tracks text[] not null default '{}',
  active boolean not null default true,
  fails int not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);

-- 첫 로그인 안내·동의 기록 {ver, at, ai}
alter table public.bk_people add column if not exists consent jsonb;

create table if not exists public.bk_tokens (
  token_hash text primary key,
  person_id uuid not null references public.bk_people(id) on delete cascade,
  expires_at timestamptz not null
);

-- 한 사람이 트랙마다 작품 하나. pages = [{tpl, head, text, imgs:[{url,w,h,fit}], hint}]
create table if not exists public.bk_works (
  person_id uuid not null references public.bk_people(id) on delete cascade,
  track text not null check (track in ('small','big','town')),
  title text not null default '',
  pen_name text not null default '',
  intro text not null default '',
  pages jsonb not null default '[]',
  confirmed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (person_id, track)
);

create table if not exists public.bk_books (
  track text primary key check (track in ('small','big','town')),
  data jsonb not null default '{}'
);

create table if not exists public.bk_tickets (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.bk_people(id) on delete cascade,
  expires_at timestamptz not null default now() + interval '10 minutes'
);

-- 회차 사진 (운영자·강사가 올림)
create table if not exists public.bk_photos (
  id uuid primary key default gen_random_uuid(),
  track text not null check (track in ('small','big','town')),
  session_no int not null,
  url text not null,
  thumb text,
  w int, h int,
  created_at timestamptz not null default now()
);
create index if not exists bk_photos_track_idx on public.bk_photos(track, session_no);
-- track 'all' = 과정 구분 없이 올린 전체 공용 사진, session_no 0 = 회차 구분 안 함
alter table public.bk_photos drop constraint if exists bk_photos_track_check;
alter table public.bk_photos add constraint bk_photos_track_check check (track in ('small','big','town','all'));

-- 내 사진첩 (회차 사진에서 담아 온 것 + 직접 올린 것)
create table if not exists public.bk_album (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references public.bk_people(id) on delete cascade,
  url text not null,
  thumb text,
  w int, h int,
  src_photo uuid references public.bk_photos(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists bk_album_person_idx on public.bk_album(person_id);

-- AI 교정 하루 사용 횟수
create table if not exists public.bk_proof (
  person_id uuid not null references public.bk_people(id) on delete cascade,
  day date not null,
  n int not null default 0,
  primary key (person_id, day)
);

-- 테이블 직접 접근 차단 (모든 읽기·쓰기는 아래 함수로만)
do $$ declare t text; begin
  foreach t in array array['bk_people','bk_tokens','bk_works','bk_books','bk_tickets','bk_proof','bk_photos','bk_album'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated', t);
  end loop;
end $$;

-- ---------- 공통 함수 ----------
create or replace function public.bk_hash(t text) returns text
language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(t, 'sha256'), 'hex')
$$;

-- p_shared: 여러 사람이 쓰는 기기면 로그인을 12시간만 유지 (예전 2칸짜리 함수는 지우고 새로 만듦)
drop function if exists public.bk_login(text, text);
create or replace function public.bk_login(p_name text, p_pin text, p_shared boolean default false)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare p public.bk_people; t text;
begin
  select * into p from bk_people
   where replace(name, ' ', '') = replace(coalesce(p_name, ''), ' ', '') and active
   limit 1;
  if not found then
    perform pg_sleep(0.3);
    return jsonb_build_object('error', '이름 또는 PIN이 맞지 않아요.');
  end if;
  if p.locked_until is not null and p.locked_until > now() then
    return jsonb_build_object('error', 'PIN을 5번 틀려서 10분 동안 잠겼어요. 잠시 뒤 다시 해 주세요.');
  end if;
  if p.pin_hash <> extensions.crypt(coalesce(p_pin, ''), p.pin_hash) then
    update bk_people
       set fails = case when fails + 1 >= 5 then 0 else fails + 1 end,
           locked_until = case when fails + 1 >= 5 then now() + interval '10 minutes' else null end
     where id = p.id;
    return jsonb_build_object('error', '이름 또는 PIN이 맞지 않아요.');
  end if;
  update bk_people set fails = 0, locked_until = null where id = p.id;
  delete from bk_tokens where expires_at < now();
  t := encode(extensions.gen_random_bytes(24), 'hex');
  insert into bk_tokens values (bk_hash(t), p.id, now() + case when coalesce(p_shared, false) then interval '12 hours' else interval '60 days' end);
  return jsonb_build_object('token', t,
    'me', jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role, 'tracks', to_jsonb(p.tracks), 'consent', p.consent));
end $$;

-- 업로드 허가표 검사 (Storage 정책에서 사용)
create or replace function public.bk_ticket_ok(p_name text) returns boolean
language sql stable security definer set search_path = public as $$
  select split_part(p_name, '/', 1) = 't' and exists (
    select 1 from bk_tickets t
     where t.id::text = split_part(p_name, '/', 2) and t.expires_at > now())
$$;

-- 작품 요약 (현황판·책 만들기용)
create or replace function public.bk_sum(w public.bk_works) returns jsonb
language sql stable strict set search_path = public as $$
  select jsonb_build_object(
    'npages', jsonb_array_length(w.pages),
    'open_notes', coalesce((select count(*) from jsonb_array_elements(w.pages) p,
                            jsonb_array_elements(coalesce(p->'notes', '[]'::jsonb)) n
                            where coalesce((n->>'done')::boolean, false) = false), 0),
    'chars', coalesce((select sum(length(coalesce(p->>'text', ''))) from jsonb_array_elements(w.pages) p), 0),
    'imgs',  coalesce((select count(*) from jsonb_array_elements(w.pages) p,
                       jsonb_array_elements(coalesce(p->'imgs', '[]'::jsonb)) i where i->>'url' is not null), 0))
$$;

-- ---------- 메인 API ----------
create or replace function public.bk_api(p_token text, p_action text, p_data jsonb default '{}')
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare
  me public.bk_people;
  staff boolean;
  d jsonb := coalesce(p_data, '{}'::jsonb);
  v_id uuid;
  v_tr text := coalesce(d->>'track', '');
  v_n int;
  w public.bk_works;
  ph public.bk_photos;
  v_aid uuid;
  v_owner uuid;
begin
  select pp.* into me from bk_tokens t join bk_people pp on pp.id = t.person_id
   where t.token_hash = bk_hash(coalesce(p_token, '')) and t.expires_at > now() and pp.active;
  if not found then return jsonb_build_object('error', 'auth'); end if;
  staff := me.role in ('teacher', 'admin');
  -- 강사·운영자는 다른 사람 대신 작업할 수 있음 (d.id)
  v_owner := case when staff and coalesce(d->>'id', '') <> '' then (d->>'id')::uuid else me.id end;

  case p_action

  when 'me' then
    return jsonb_build_object('me', jsonb_build_object('id', me.id, 'name', me.name, 'role', me.role, 'tracks', to_jsonb(me.tracks), 'consent', me.consent));

  -- 안내 확인·AI 교정 동의 (ai는 나중에 바꿀 수 있음)
  when 'consent' then
    update bk_people set consent = jsonb_build_object('ver', coalesce(d->>'ver', ''), 'at', now(),
                                                      'ai', coalesce((d->>'ai')::boolean, false))
     where id = me.id;
    return jsonb_build_object('ok', true, 'consent', (select consent from bk_people where id = me.id));

  when 'logout' then
    delete from bk_tokens where token_hash = bk_hash(p_token);
    return jsonb_build_object('ok', true);

  when 'pin_change' then
    if coalesce(d->>'new', '') !~ '^[0-9]{4}$' then
      return jsonb_build_object('error', '새 PIN은 숫자 4자리로 정해 주세요.'); end if;
    if me.pin_hash <> extensions.crypt(coalesce(d->>'old', ''), me.pin_hash) then
      return jsonb_build_object('error', '지금 PIN이 맞지 않아요.'); end if;
    update bk_people set pin_hash = extensions.crypt(d->>'new', extensions.gen_salt('bf')) where id = me.id;
    return jsonb_build_object('ok', true);

  -- ===== 작품 =====
  when 'work_get' then
    v_id := coalesce(nullif(d->>'id', '')::uuid, me.id);
    if v_id <> me.id and not staff then return jsonb_build_object('error', '다른 분의 작품은 열 수 없어요.'); end if;
    if v_tr not in ('small','big','town') then return jsonb_build_object('error', '과정을 골라 주세요.'); end if;
    return jsonb_build_object(
      'name', (select name from bk_people where id = v_id),
      'work', coalesce((select to_jsonb(x) from bk_works x where x.person_id = v_id and x.track = v_tr),
                jsonb_build_object('person_id', v_id, 'track', v_tr, 'title', '', 'pen_name', '',
                  'intro', '', 'pages', '[]'::jsonb, 'confirmed_at', null)));

  when 'work_save' then
    v_id := case when staff and coalesce(d->>'id', '') <> '' then (d->>'id')::uuid else me.id end;
    if v_tr not in ('small','big','town') then return jsonb_build_object('error', '과정을 골라 주세요.'); end if;
    if not staff and not (v_tr = any(me.tracks)) then
      return jsonb_build_object('error', '참여한 과정이 아니에요. 운영자에게 말씀해 주세요.'); end if;
    if d ? 'pages' and (jsonb_typeof(d->'pages') <> 'array' or jsonb_array_length(d->'pages') > 60
                        or length((d->'pages')::text) > 300000) then
      return jsonb_build_object('error', '쪽이 너무 많아요. 60쪽까지 만들 수 있어요.'); end if;
    -- 동시 편집 막기: 불러온 뒤(base)에 다른 곳에서 저장했으면 덮어쓰지 않음 (force면 덮어씀)
    select * into w from bk_works x where x.person_id = v_id and x.track = v_tr;
    if found and d ? 'base' and not coalesce((d->>'force')::boolean, false)
       and w.updated_at is distinct from nullif(d->>'base', '')::timestamptz then
      return jsonb_build_object('error', 'conflict', 'updated_at', w.updated_at);
    end if;
    insert into bk_works (person_id, track) values (v_id, v_tr) on conflict do nothing;
    update bk_works x set
      title    = coalesce(d->>'title', x.title),
      pen_name = coalesce(d->>'pen_name', x.pen_name),
      intro    = coalesce(d->>'intro', x.intro),
      pages    = coalesce(d->'pages', x.pages),
      -- 동의한 뒤 글·그림을 고치면 동의가 풀림
      confirmed_at = case when (d ? 'pages' and d->'pages' is distinct from x.pages)
                            or (d ? 'title' and d->>'title' is distinct from x.title)
                          then null else x.confirmed_at end,
      updated_at = now()
    where x.person_id = v_id and x.track = v_tr
    returning * into w;
    return jsonb_build_object('ok', true, 'confirmed_at', w.confirmed_at, 'updated_at', w.updated_at);

  when 'confirm' then
    v_id := case when staff and coalesce(d->>'id', '') <> '' then (d->>'id')::uuid else me.id end;
    update bk_works set confirmed_at = case when (d->>'on')::boolean then now() else null end
     where person_id = v_id and track = v_tr
    returning * into w;
    if not found then return jsonb_build_object('error', '먼저 한 쪽이라도 써 주세요.'); end if;
    return jsonb_build_object('ok', true, 'confirmed_at', w.confirmed_at);

  -- ===== 현황판 (강사·운영자) =====
  when 'board' then
    if not staff then return jsonb_build_object('error', '권한이 없어요.'); end if;
    return jsonb_build_object('rows', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'track', tr,
               'title', w2.title, 'confirmed', w2.confirmed_at is not null, 'updated_at', w2.updated_at)
               || coalesce(bk_sum(w2), jsonb_build_object('npages', 0, 'chars', 0, 'imgs', 0, 'open_notes', 0))
             order by tr, p.name)
        from bk_people p cross join unnest(p.tracks) tr
        left join bk_works w2 on w2.person_id = p.id and w2.track = tr
       where p.active), '[]'::jsonb));

  -- ===== 참여자 관리 (운영자) =====
  -- 운영자 백업: 사람(PIN 제외)·작품·책 정보·회차 사진·사진첩 목록 전체
  when 'backup' then
    if me.role <> 'admin' then return jsonb_build_object('error', '운영자만 할 수 있어요.'); end if;
    return jsonb_build_object('app', 'maeul-book', 'made_at', now(),
      'people', (select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name, 'role', x.role, 'tracks', to_jsonb(x.tracks),
                   'active', x.active, 'consent', x.consent, 'created_at', x.created_at) order by x.name), '[]'::jsonb) from bk_people x),
      'works',  (select coalesce(jsonb_agg(to_jsonb(x) order by x.track, x.person_id), '[]'::jsonb) from bk_works x),
      'books',  (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from bk_books x),
      'photos', (select coalesce(jsonb_agg(to_jsonb(x) order by x.track, x.session_no, x.created_at), '[]'::jsonb) from bk_photos x),
      'album',  (select coalesce(jsonb_agg(to_jsonb(x) order by x.person_id, x.created_at), '[]'::jsonb) from bk_album x));

  when 'people' then
    if me.role <> 'admin' then return jsonb_build_object('error', '운영자만 볼 수 있어요.'); end if;
    return jsonb_build_object('people', coalesce((
      select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'role', p.role, 'tracks', to_jsonb(p.tracks),
               'active', p.active, 'locked', p.locked_until > now(), 'consent', p.consent) order by p.role desc, p.name)
        from bk_people p), '[]'::jsonb));

  when 'person_save' then
    if me.role <> 'admin' then return jsonb_build_object('error', '운영자만 할 수 있어요.'); end if;
    if coalesce(d->>'pin', '') <> '' and d->>'pin' !~ '^[0-9]{4}$' then
      return jsonb_build_object('error', 'PIN은 숫자 4자리예요.'); end if;
    -- 로그인은 띄어쓰기를 무시하므로 띄어쓰기만 다른 이름도 같은 이름으로 봄
    if coalesce(trim(d->>'name'), '') <> '' and exists (
         select 1 from bk_people x
          where replace(x.name, ' ', '') = replace(trim(d->>'name'), ' ', '')
            and x.id::text <> coalesce(d->>'id', '')) then
      return jsonb_build_object('error', '같은 이름(띄어쓰기만 다른 이름 포함)이 이미 있어요. 뒤에 숫자나 구분할 말을 붙여 주세요.');
    end if;
    begin
      if coalesce(d->>'id', '') = '' then
        if coalesce(d->>'pin', '') = '' then return jsonb_build_object('error', 'PIN을 정해 주세요.'); end if;
        insert into bk_people (name, pin_hash, role, tracks)
        values (trim(d->>'name'), extensions.crypt(d->>'pin', extensions.gen_salt('bf')),
                coalesce(nullif(d->>'role', ''), 'member'),
                coalesce((select array_agg(x) from jsonb_array_elements_text(d->'tracks') x
                           where x in ('small','big','town')), '{}'));
      else
        update bk_people set
          name   = coalesce(nullif(trim(d->>'name'), ''), name),
          role   = coalesce(nullif(d->>'role', ''), role),
          tracks = case when d ? 'tracks' then coalesce((select array_agg(x) from jsonb_array_elements_text(d->'tracks') x
                          where x in ('small','big','town')), '{}') else tracks end,
          active = coalesce((d->>'active')::boolean, active),
          pin_hash = case when coalesce(d->>'pin', '') <> ''
                          then extensions.crypt(d->>'pin', extensions.gen_salt('bf')) else pin_hash end,
          fails = 0, locked_until = null
        where id = (d->>'id')::uuid;
      end if;
    exception when unique_violation then
      return jsonb_build_object('error', '같은 이름이 이미 있어요. 뒤에 숫자나 구분할 말을 붙여 주세요.');
    end;
    return jsonb_build_object('ok', true);

  -- ===== 책 만들기 (트랙별 합본) =====
  when 'book' then
    if not staff then return jsonb_build_object('error', '권한이 없어요.'); end if;
    return jsonb_build_object(
      'settings', coalesce((select data from bk_books where track = v_tr), '{}'::jsonb),
      'works', coalesce((
        select jsonb_agg(to_jsonb(w2) || jsonb_build_object('name', p.name) || bk_sum(w2) order by p.name)
          from bk_works w2 join bk_people p on p.id = w2.person_id
         where w2.track = v_tr and p.active and jsonb_array_length(w2.pages) > 0), '[]'::jsonb));

  when 'book_save' then
    if not staff then return jsonb_build_object('error', '권한이 없어요.'); end if;
    if v_tr not in ('small','big','town') then return jsonb_build_object('error', '과정을 골라 주세요.'); end if;
    insert into bk_books (track, data) values (v_tr, coalesce(d->'data', '{}'::jsonb))
    on conflict (track) do update set data = excluded.data;
    return jsonb_build_object('ok', true);

  -- ===== 사진 업로드 허가 =====
  when 'ticket' then
    delete from bk_tickets where expires_at < now();
    if (select count(*) from bk_tickets where person_id = me.id) >= (case when staff then 400 else 40 end) then
      return jsonb_build_object('error', '사진을 너무 많이 올렸어요. 10분 뒤 다시 해 주세요.'); end if;
    insert into bk_tickets (person_id) values (me.id) returning id into v_id;
    return jsonb_build_object('ticket', v_id);

  -- ===== 회차 사진 =====
  -- 그 과정의 회차별·구분 안 함 사진 + 전체 공용 사진을 함께 돌려줌 (track 'all'이면 전체 공용만)
  when 'photos' then
    if v_tr not in ('small','big','town','all') then return jsonb_build_object('error', '과정을 골라 주세요.'); end if;
    if not staff and v_tr <> 'all' and not (v_tr = any(me.tracks)) then
      return jsonb_build_object('error', '참여한 과정의 사진만 볼 수 있어요.'); end if;
    return jsonb_build_object(
      'photos', coalesce((select jsonb_agg(jsonb_build_object('id', x.id, 'track', x.track, 'no', x.session_no, 'url', x.url, 'thumb', x.thumb, 'w', x.w, 'h', x.h)
                 order by x.track, x.session_no, x.created_at) from bk_photos x where x.track = v_tr or x.track = 'all'), '[]'::jsonb),
      'taken', coalesce((select jsonb_agg(a.src_photo) from bk_album a where a.person_id = v_owner and a.src_photo is not null), '[]'::jsonb));

  when 'photo_add' then
    if not staff then return jsonb_build_object('error', '권한이 없어요.'); end if;
    if v_tr not in ('small','big','town','all') then return jsonb_build_object('error', '과정을 골라 주세요.'); end if;
    insert into bk_photos (track, session_no, url, thumb, w, h)
    values (v_tr, case when v_tr = 'all' then 0 else coalesce((d->>'no')::int, 0) end, d->>'url', d->>'thumb', (d->>'w')::int, (d->>'h')::int) returning id into v_id;
    return jsonb_build_object('ok', true, 'id', v_id);

  when 'photo_move' then  -- 다른 과정·회차(또는 구분 안 함·전체 공용)로 옮기기
    if not staff then return jsonb_build_object('error', '권한이 없어요.'); end if;
    if v_tr not in ('small','big','town','all') then return jsonb_build_object('error', '옮길 곳을 골라 주세요.'); end if;
    update bk_photos set track = v_tr, session_no = case when v_tr = 'all' then 0 else coalesce((d->>'no')::int, 0) end
     where id = (d->>'pid')::uuid;
    return jsonb_build_object('ok', true);

  when 'photo_set' then  -- 돌린 사진으로 바꾸기
    if not staff then return jsonb_build_object('error', '권한이 없어요.'); end if;
    update bk_photos set url = d->>'url', thumb = d->>'thumb', w = (d->>'w')::int, h = (d->>'h')::int
     where id = (d->>'pid')::uuid;
    return jsonb_build_object('ok', true);

  when 'photo_del' then
    if not staff then return jsonb_build_object('error', '권한이 없어요.'); end if;
    delete from bk_photos where id = (d->>'pid')::uuid;
    return jsonb_build_object('ok', true);

  -- ===== 내 사진첩 =====
  when 'album' then
    return jsonb_build_object('album', coalesce((
      select jsonb_agg(jsonb_build_object('id', a.id, 'url', a.url, 'thumb', a.thumb, 'w', a.w, 'h', a.h, 'src', a.src_photo)
             order by a.created_at desc) from bk_album a where a.person_id = v_owner), '[]'::jsonb));

  when 'album_add' then
    if coalesce(d->>'src', '') <> '' then
      select * into ph from bk_photos where id = (d->>'src')::uuid;
      if not found then return jsonb_build_object('error', '그 사진은 지워졌어요.'); end if;
      if not staff and ph.track <> 'all' and not (ph.track = any(me.tracks)) then return jsonb_build_object('error', '참여한 과정의 사진만 담을 수 있어요.'); end if;
      select id into v_aid from bk_album where person_id = v_owner and src_photo = ph.id limit 1;
      if v_aid is null then
        insert into bk_album (person_id, url, thumb, w, h, src_photo)
        values (v_owner, ph.url, ph.thumb, ph.w, ph.h, ph.id) returning id into v_aid;
      end if;
    else
      if coalesce(d->>'url', '') = '' then return jsonb_build_object('error', '사진이 없어요.'); end if;
      if (select count(*) from bk_album where person_id = v_owner) >= 300 then
        return jsonb_build_object('error', '사진첩이 가득 찼어요 (300장). 안 쓰는 사진을 빼 주세요.'); end if;
      insert into bk_album (person_id, url, thumb, w, h)
      values (v_owner, d->>'url', d->>'thumb', (d->>'w')::int, (d->>'h')::int) returning id into v_aid;
    end if;
    return jsonb_build_object('ok', true, 'item', (select jsonb_build_object('id', a.id, 'url', a.url, 'thumb', a.thumb, 'w', a.w, 'h', a.h, 'src', a.src_photo)
                                                  from bk_album a where a.id = v_aid));

  when 'album_set' then  -- 돌린 사진으로 바꾸기 (내 사본만)
    update bk_album set url = d->>'url', thumb = d->>'thumb', w = (d->>'w')::int, h = (d->>'h')::int
     where id = (d->>'aid')::uuid and (person_id = me.id or staff);
    return jsonb_build_object('ok', true);

  when 'album_del' then
    delete from bk_album where id = (d->>'aid')::uuid and (person_id = me.id or staff);
    return jsonb_build_object('ok', true);

  -- ===== AI 교정 (api/proof.js 서버 함수가 부름) =====
  -- 교정 전: 로그인과 오늘 남은 횟수만 확인 (횟수는 줄이지 않음)
  when 'proof_check' then
    -- 글 주인(참여자)이 AI 교정에 동의했는지 (강사가 대신 교정할 때도 참여자 기준)
    if exists (select 1 from bk_people x where x.id = v_owner and x.role = 'member'
                and coalesce((x.consent->>'ai')::boolean, false) = false) then
      return jsonb_build_object('error', case when v_owner = me.id
        then 'AI 교정을 쓰려면 먼저 동의가 필요해요.'
        else '이 분은 AI 교정에 동의하지 않았어요. 동의를 받은 뒤에 써 주세요.' end);
    end if;
    if not staff and coalesce((select n from bk_proof where person_id = me.id
                                and day = (now() at time zone 'Asia/Seoul')::date), 0) >= 20 then
      return jsonb_build_object('error', '오늘 AI 교정은 20번까지 쓸 수 있어요. 내일 다시 해 주세요.'); end if;
    return jsonb_build_object('ok', true);

  -- 교정이 성공했을 때만 1번 셈
  when 'proof_use' then
    insert into bk_proof (person_id, day, n) values (me.id, (now() at time zone 'Asia/Seoul')::date, 1)
    on conflict (person_id, day) do update set n = bk_proof.n + 1
    returning n into v_n;
    return jsonb_build_object('ok', true, 'used', v_n);

  else
    return jsonb_build_object('error', '알 수 없는 요청이에요: ' || coalesce(p_action, ''));
  end case;
end $$;

revoke all on function public.bk_api(text, text, jsonb) from public;
revoke all on function public.bk_login(text, text, boolean) from public;
revoke all on function public.bk_ticket_ok(text) from public;
revoke all on function public.bk_sum(public.bk_works) from public;
grant execute on function public.bk_api(text, text, jsonb) to anon, authenticated;
grant execute on function public.bk_login(text, text, boolean) to anon, authenticated;
grant execute on function public.bk_ticket_ok(text) to anon, authenticated;

-- ---------- 사진 저장소 (공개 읽기, 업로드는 허가표가 있을 때만) ----------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('bk-book', 'bk-book', true, 8388608, array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;

drop policy if exists "bk_book_upload" on storage.objects;
create policy "bk_book_upload" on storage.objects
  for insert to anon, authenticated
  with check (bucket_id = 'bk-book' and public.bk_ticket_ok(name));

-- ---------- 기본 책 정보 (책 만들기에서 고칠 수 있음) ----------
insert into public.bk_books (track, data) values
  ('small', jsonb_build_object('title', '작은 BOOK', 'subtitle', '그림과 글로 발견한 나의 이야기', 'color', '#D85A30')),
  ('big',   jsonb_build_object('title', '큰 BOOK', 'subtitle', '우리 동네에서 자란 이야기', 'color', '#BA7517')),
  ('town',  jsonb_build_object('title', '동네 BOOK', 'subtitle', '마을작가들이 기억하는 동네', 'color', '#0F6E56'))
on conflict (track) do nothing;

update public.bk_books set data = jsonb_build_object(
    'publisher', '밀양시 도시재생지원센터 가곡재생팀', 'date', '2026년 10월',
    'greeting', '', 'credits', '', 'isbn', '',
    'ai_notice', '이 책의 그림 일부는 생성형 AI로 만들었습니다.',
    'bleed', false, 'pad4', true, 'order', '[]'::jsonb, 'exclude', '[]'::jsonb) || data
 where not (data ? 'publisher');

-- ▼ 운영자 계정: 이름과 PIN(숫자 4자리)을 바꾼 뒤 실행하세요. 로그인 후 PIN 변경도 가능합니다.
insert into public.bk_people (name, pin_hash, role, tracks)
values ('운영자', extensions.crypt('0000', extensions.gen_salt('bf')), 'admin', '{}')
on conflict (name) do nothing;
