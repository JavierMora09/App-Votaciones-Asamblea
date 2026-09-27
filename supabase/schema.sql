create extension if not exists pgcrypto;

create table if not exists public.parcels (
  id uuid primary key default gen_random_uuid(),
  parcel_code text not null unique,
  document_type text,
  document_number text not null,
  first_name text not null,
  last_name text not null,
  phone text,
  email text,
  coefficient numeric(14, 8) not null default 1,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.questions (
  id uuid primary key default gen_random_uuid(),
  question text not null,
  options jsonb not null check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) >= 2),
  status text not null default 'draft' check (status in ('draft', 'open', 'closed')),
  opened_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now()
);

create unique index if not exists one_open_question on public.questions (status) where status = 'open';

create table if not exists public.votes (
  question_id uuid not null references public.questions(id) on delete cascade,
  parcel_id uuid not null references public.parcels(id),
  selected_option text not null,
  cast_at timestamptz not null default now(),
  primary key (question_id, parcel_id)
);

create table if not exists public.voter_sessions (
  token uuid primary key default gen_random_uuid(),
  document_number text not null,
  verified_parcel_id uuid not null references public.parcels(id),
  expires_at timestamptz not null default now() + interval '12 hours',
  created_at timestamptz not null default now()
);

create table if not exists public.admin_users (
  email text primary key
);

alter table public.parcels enable row level security;
alter table public.questions enable row level security;
alter table public.votes enable row level security;
alter table public.voter_sessions enable row level security;
alter table public.admin_users enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.admin_users
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

create policy "admins manage parcels" on public.parcels
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "visitors see open questions" on public.questions
  for select to anon, authenticated using (status = 'open');

create policy "admins manage questions" on public.questions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "admins see votes" on public.votes
  for select to authenticated using (public.is_admin());

create policy "admins manage sessions" on public.voter_sessions
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "admins manage administrators" on public.admin_users
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create or replace function public.start_voter_session(p_document text, p_parcel_code text)
returns table (session_token uuid, owner_name text, parcels jsonb)
language plpgsql
security definer
set search_path = public
as $$
declare
  verified_parcel public.parcels%rowtype;
  new_token uuid;
  owner_parcels jsonb;
begin
  select * into verified_parcel
  from public.parcels
  where active
    and lower(trim(document_number)) = lower(trim(p_document))
    and lower(trim(parcel_code)) = lower(trim(p_parcel_code));

  if verified_parcel.id is null then
    raise exception 'No encontramos una parcela activa con esos datos.';
  end if;

  insert into public.voter_sessions (document_number, verified_parcel_id)
  values (verified_parcel.document_number, verified_parcel.id)
  returning token into new_token;

  select jsonb_agg(jsonb_build_object(
    'id', id,
    'code', parcel_code,
    'coefficient', coefficient
  ) order by parcel_code)
  into owner_parcels
  from public.parcels
  where active and lower(trim(document_number)) = lower(trim(verified_parcel.document_number));

  return query select
    new_token,
    trim(concat_ws(' ', verified_parcel.first_name, verified_parcel.last_name)),
    coalesce(owner_parcels, '[]'::jsonb);
end;
$$;

create or replace function public.cast_vote(p_session_token uuid, p_question_id uuid, p_option text)
returns table (inserted_count integer, existing_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  session_document text;
  active_question public.questions%rowtype;
  eligible_count integer;
  new_vote_count integer;
begin
  select document_number into session_document
  from public.voter_sessions
  where token = p_session_token and expires_at > now();

  if session_document is null then
    raise exception 'La sesion ya no es valida. Ingresa nuevamente.';
  end if;

  select * into active_question
  from public.questions
  where id = p_question_id and status = 'open';

  if active_question.id is null or not (active_question.options ? p_option) then
    raise exception 'Esta votacion no esta disponible.';
  end if;

  select count(*)::integer into eligible_count
  from public.parcels
  where active and lower(trim(document_number)) = lower(trim(session_document));

  with eligible_parcels as (
    select id
    from public.parcels
    where active and lower(trim(document_number)) = lower(trim(session_document))
  ), inserted_votes as (
    insert into public.votes (question_id, parcel_id, selected_option)
    select p_question_id, id, p_option
    from eligible_parcels
    on conflict (question_id, parcel_id) do nothing
    returning parcel_id
  )
  select count(*)::integer into new_vote_count from inserted_votes;

  return query select new_vote_count, eligible_count - new_vote_count;
end;
$$;

revoke all on function public.start_voter_session(text, text) from public;
revoke all on function public.cast_vote(uuid, uuid, text) from public;
grant execute on function public.start_voter_session(text, text) to anon, authenticated;
grant execute on function public.cast_vote(uuid, uuid, text) to anon, authenticated;
