-- =====================================================================
-- KaraokêLive — Schema do Supabase
-- Cole este arquivo inteiro no SQL Editor do seu projeto Supabase
-- (Dashboard → SQL Editor → New query) e clique em "Run".
-- =====================================================================

-- Extensão necessária para gerar UUIDs
create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------
-- TABELA: songs (músicas — substitui o que ficava em localStorage)
-- ---------------------------------------------------------------------
create table if not exists public.songs (
  id              uuid primary key default gen_random_uuid(),
  titulo          text not null,
  artista         text not null,
  categoria       text,
  thumbnail_url   text,
  video_playback  text,
  letra           text,
  mp3_url         text,                         -- URL pública do MP3 no bucket 'mp3s'
  favorita        boolean not null default false,
  plays           integer not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- TABELA: playlists
-- ---------------------------------------------------------------------
create table if not exists public.playlists (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz not null default now()
);

-- TABELA: playlist_songs (junção — quais músicas estão em cada playlist, e em que ordem)
create table if not exists public.playlist_songs (
  playlist_id  uuid not null references public.playlists(id) on delete cascade,
  song_id      uuid not null references public.songs(id)     on delete cascade,
  position     integer not null default 0,
  primary key (playlist_id, song_id)
);

-- ---------------------------------------------------------------------
-- TABELA: history (histórico de reproduções — para a página de Estatísticas)
-- ---------------------------------------------------------------------
create table if not exists public.history (
  id          bigint generated always as identity primary key,
  song_id     uuid references public.songs(id) on delete cascade,
  played_at   timestamptz not null default now()
);

-- Índices úteis
create index if not exists idx_songs_categoria        on public.songs(categoria);
create index if not exists idx_playlist_songs_playlist on public.playlist_songs(playlist_id);
create index if not exists idx_history_played_at       on public.history(played_at desc);


-- =====================================================================
-- SEGURANÇA (Row Level Security)
-- Regra escolhida: QUALQUER visitante pode VER e tocar as músicas.
-- Só o admin logado (você) pode ADICIONAR / EDITAR / EXCLUIR.
-- =====================================================================

alter table public.songs          enable row level security;
alter table public.playlists      enable row level security;
alter table public.playlist_songs enable row level security;
alter table public.history        enable row level security;

-- Leitura: liberada para todo mundo (inclusive visitantes não logados)
create policy "songs_select_all"          on public.songs          for select using (true);
create policy "playlists_select_all"      on public.playlists      for select using (true);
create policy "playlist_songs_select_all" on public.playlist_songs for select using (true);
create policy "history_select_all"        on public.history        for select using (true);

-- Escrita: só usuários autenticados (ou seja, só você, logado como admin)
create policy "songs_insert_admin" on public.songs for insert with check (auth.role() = 'authenticated');
create policy "songs_update_admin" on public.songs for update using     (auth.role() = 'authenticated');
create policy "songs_delete_admin" on public.songs for delete using     (auth.role() = 'authenticated');

create policy "playlists_insert_admin" on public.playlists for insert with check (auth.role() = 'authenticated');
create policy "playlists_update_admin" on public.playlists for update using     (auth.role() = 'authenticated');
create policy "playlists_delete_admin" on public.playlists for delete using     (auth.role() = 'authenticated');

create policy "playlist_songs_insert_admin" on public.playlist_songs for insert with check (auth.role() = 'authenticated');
create policy "playlist_songs_update_admin" on public.playlist_songs for update using     (auth.role() = 'authenticated');
create policy "playlist_songs_delete_admin" on public.playlist_songs for delete using     (auth.role() = 'authenticated');

create policy "history_delete_admin" on public.history for delete using (auth.role() = 'authenticated');


-- =====================================================================
-- FUNÇÃO: registrar_reproducao
-- Qualquer visitante pode "tocar" uma música (isso não é considerado
-- edição da biblioteca) — essa função soma +1 em plays e grava no
-- histórico, contornando com segurança a regra de "só admin escreve".
-- =====================================================================
create or replace function public.registrar_reproducao(p_song_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.songs set plays = plays + 1, updated_at = now() where id = p_song_id;
  insert into public.history (song_id) values (p_song_id);
end;
$$;

grant execute on function public.registrar_reproducao(uuid) to anon, authenticated;


-- =====================================================================
-- STORAGE — buckets para os arquivos (MP3s e capas)
-- Buckets públicos para leitura (qualquer um ouve/vê),
-- mas só admin autenticado pode subir/editar/apagar arquivos.
-- =====================================================================

insert into storage.buckets (id, name, public)
  values ('mp3s', 'mp3s', true)
  on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
  values ('thumbnails', 'thumbnails', true)
  on conflict (id) do nothing;

create policy "mp3s_select_all"   on storage.objects for select using (bucket_id = 'mp3s');
create policy "mp3s_insert_admin" on storage.objects for insert with check (bucket_id = 'mp3s' and auth.role() = 'authenticated');
create policy "mp3s_update_admin" on storage.objects for update using     (bucket_id = 'mp3s' and auth.role() = 'authenticated');
create policy "mp3s_delete_admin" on storage.objects for delete using     (bucket_id = 'mp3s' and auth.role() = 'authenticated');

create policy "thumbs_select_all"   on storage.objects for select using (bucket_id = 'thumbnails');
create policy "thumbs_insert_admin" on storage.objects for insert with check (bucket_id = 'thumbnails' and auth.role() = 'authenticated');
create policy "thumbs_update_admin" on storage.objects for update using     (bucket_id = 'thumbnails' and auth.role() = 'authenticated');
create policy "thumbs_delete_admin" on storage.objects for delete using     (bucket_id = 'thumbnails' and auth.role() = 'authenticated');

-- =====================================================================
-- FIM. Depois de rodar este script:
--  1) Vá em Authentication → Users → Add user e crie o SEU login de admin
--     (e-mail + senha) — é com ele que você vai entrar no site.
--  2) Vá em Authentication → Settings → desative "Allow new users to sign up"
--     (assim ninguém além de você consegue criar uma conta de admin).
-- =====================================================================
