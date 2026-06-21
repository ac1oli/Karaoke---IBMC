/* =============================================================
   KaraokêLive — app.js (versão Supabase)
   Organização:
     1.  Estado Global
     2.  Autenticação (Admin)
     3.  Mapeamento Banco -> Objeto JS
     4.  Carregamento de dados (Supabase)
     5.  Navegação + renderPage
     6.  Renderização — Biblioteca
     7.  Renderização — Favoritas
     8.  Renderização — Playlists
     9.  Renderização — Detalhe da Playlist
    10.  Renderização — Histórico
    11.  Renderização — Estatísticas
    12.  Renderização — Importar / Exportar
    13.  Exportar / Importar
    14.  CRUD de Músicas
    15.  Helpers de Vídeo, Thumbnail e Storage
    16.  CRUD de Playlists
    17.  Drag & Drop (Playlist)
    18.  Tela de Karaokê
    19.  Teleprompter
    20.  Sidebar
    21.  Tema (Dark / Light)
    22.  Modais
    23.  Busca, Filtro e Ordenação
    24.  Utilitários
    25.  Toasts
    26.  Atalhos de Teclado
    27.  PWA Manifest
    28.  Inicialização

   IMPORTANTE: este arquivo depende do config.js (carregado antes
   dele no index.html), que define a constante global `sb`
   (cliente do Supabase) com a URL e a chave do seu projeto.
============================================================= */


/* ─────────────────────────────────────────────────────────────
   1. ESTADO GLOBAL
───────────────────────────────────────────────────────────── */
let songs             = [];
let playlists         = [];
let history            = [];
let settings          = { theme: 'dark', fontSize: 1.4, lineHeight: 2 };

let isAdmin            = false;   // true quando logado com a conta de admin no Supabase Auth

let currentPage       = 'library';
let currentSearch     = '';
let currentFilter     = 'all';
let currentSort       = 'name';
let currentPlaylistId = null;

let editingPlaylistId   = null;
let addToPlaylistSongId = null;
let pendingThumbData    = null;  // string (URL colada manualmente) — vai direto pro banco
let pendingThumbFile    = null;  // File — sobe pro bucket 'thumbnails' ao salvar
let pendingMp3File      = null;  // File — sobe pro bucket 'mp3s' ao salvar

// Estado do Karaokê
let karaokeCurrentSong = null;
let tpInterval         = null;
let tpRunning          = false;
let tpSpeed            = 1;
let tpScrollPos        = 0;
let karaokePresMode    = false;


/* ─────────────────────────────────────────────────────────────
   2. AUTENTICAÇÃO (ADMIN)
   Só quem faz login (Supabase Auth, e-mail/senha criados por
   você no dashboard) pode adicionar/editar/excluir conteúdo.
   Todo mundo mais acessa em modo "somente leitura/reprodução".
───────────────────────────────────────────────────────────── */

async function initAuth() {
  const { data: { session } } = await sb.auth.getSession();
  isAdmin = !!session;
  applyAdminUI();

  sb.auth.onAuthStateChange((_event, session) => {
    isAdmin = !!session;
    applyAdminUI();
    if (!isAdmin && currentPage === 'importexport') currentPage = 'library';
    renderPage();
  });
}

function applyAdminUI() {
  const addBtn   = document.getElementById('btn-add-music');
  const newPlBtn = document.getElementById('btn-new-playlist-nav');
  const ieNav    = document.getElementById('nav-importexport');
  if (addBtn)   addBtn.style.display   = isAdmin ? '' : 'none';
  if (newPlBtn) newPlBtn.style.display = isAdmin ? '' : 'none';
  if (ieNav)    ieNav.style.display    = isAdmin ? '' : 'none';

  const icon  = document.getElementById('admin-icon');
  const label = document.getElementById('admin-label');
  if (icon)  icon.textContent  = isAdmin ? '🔓' : '🔒';
  if (label) label.textContent = isAdmin ? 'Sair do modo admin' : 'Entrar como admin';
}

function onAdminButtonClick() {
  if (isAdmin) {
    if (confirm('Sair do modo admin?')) sb.auth.signOut();
  } else {
    document.getElementById('login-email').value    = '';
    document.getElementById('login-password').value = '';
    openModal('modal-login');
  }
}

async function doAdminLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  if (!email || !password) { showToast('Preencha e-mail e senha.', 'error'); return; }
  const { error } = await sb.auth.signInWithPassword({ email, password });
  if (error) { showToast('Login inválido: ' + error.message, 'error'); return; }
  isAdmin = true;
  applyAdminUI();
  closeModal('modal-login');
  renderPage();
  showToast('Login feito! Modo admin ativado.', 'success');
}


/* ─────────────────────────────────────────────────────────────
   3. MAPEAMENTO BANCO -> OBJETO JS
   Converte as colunas (snake_case) do Postgres para os mesmos
   nomes de campo que o app já usava — assim quase toda a
   renderização abaixo continua igual ao app original.
───────────────────────────────────────────────────────────── */

function mapSongRow(row) {
  return {
    id:            row.id,
    titulo:        row.titulo,
    artista:       row.artista,
    categoria:     row.categoria || '',
    thumbnail:     row.thumbnail_url || '',
    videoPlayback: row.video_playback || '',
    letra:         row.letra || '',
    favorita:      !!row.favorita,
    plays:         row.plays || 0,
    dataCriacao:   row.created_at,
    mp3Url:        row.mp3_url || '',
    temMp3:        !!row.mp3_url,
  };
}


/* ─────────────────────────────────────────────────────────────
   4. CARREGAMENTO DE DADOS (Supabase)
   Em vez de localStorage/IndexedDB, tudo vem do Postgres.
   `settings` (tema/fonte) continua local — é preferência do
   aparelho, não da biblioteca compartilhada.
───────────────────────────────────────────────────────────── */

async function load() {
  try {
    const [songsRes, plRes, psRes, hRes] = await Promise.all([
      sb.from('songs').select('*').order('titulo'),
      sb.from('playlists').select('*').order('created_at'),
      sb.from('playlist_songs').select('*').order('position'),
      sb.from('history').select('*').order('played_at', { ascending: false }).limit(200),
    ]);
    if (songsRes.error) throw songsRes.error;
    if (plRes.error)    throw plRes.error;
    if (psRes.error)    throw psRes.error;
    if (hRes.error)     throw hRes.error;

    songs = (songsRes.data || []).map(mapSongRow);

    playlists = (plRes.data || []).map(pl => ({
      id:        pl.id,
      name:      pl.name,
      createdAt: pl.created_at,
      songs: (psRes.data || [])
        .filter(ps => ps.playlist_id === pl.id)
        .sort((a, b) => a.position - b.position)
        .map(ps => ps.song_id),
    }));

    history = (hRes.data || []).map(h => ({ id: h.song_id, at: h.played_at }));
  } catch (err) {
    console.error('Erro ao carregar dados do Supabase:', err);
    showToast('Erro ao carregar a biblioteca. Verifique sua conexão.', 'error');
    songs = []; playlists = []; history = [];
  }

  try {
    settings = Object.assign(
      { theme: 'dark', fontSize: 1.4, lineHeight: 2 },
      JSON.parse(localStorage.getItem('kl_settings') || '{}')
    );
  } catch { settings = { theme: 'dark', fontSize: 1.4, lineHeight: 2 }; }
}

function saveSettings() {
  try { localStorage.setItem('kl_settings', JSON.stringify(settings)); } catch {}
}


/* ─────────────────────────────────────────────────────────────
   5. NAVEGAÇÃO
───────────────────────────────────────────────────────────── */

function navigate(page, extra) {
  if (page === 'importexport' && !isAdmin) {
    showToast('Faça login como admin para acessar Exportar/Importar.', 'error');
    page = 'library';
  }
  currentPage = page;
  if (extra) currentPlaylistId = extra;
  document.querySelectorAll('.nav-item').forEach(el =>
    el.classList.toggle('active', el.dataset.page === page)
  );
  document.getElementById('search-box').style.display =
    ['library', 'favorites'].includes(page) ? '' : 'none';
  renderPage();
  closeSidebar();
}

function renderPage() {
  const c = document.getElementById('content');
  switch (currentPage) {
    case 'library':      c.innerHTML = renderLibrary();      break;
    case 'favorites':    c.innerHTML = renderFavorites();    break;
    case 'playlists':
      c.innerHTML = currentPlaylistId ? renderPlaylistDetail() : renderPlaylists();
      break;
    case 'history':      c.innerHTML = renderHistory();      break;
    case 'stats':        c.innerHTML = renderStats();        break;
    case 'importexport': c.innerHTML = renderImportExport(); break;
  }
  updateBadge();
  renderSidebarPlaylists();
  attachDrag();
}


/* ─────────────────────────────────────────────────────────────
   6. RENDERIZAÇÃO — BIBLIOTECA
───────────────────────────────────────────────────────────── */

function getFilteredSongs(list) {
  let result = list.slice();
  if (currentFilter !== 'all') result = result.filter(s => s.categoria === currentFilter);
  if (currentSearch) {
    const q = currentSearch.toLowerCase();
    result = result.filter(s => (s.titulo + s.artista + s.categoria).toLowerCase().includes(q));
  }
  switch (currentSort) {
    case 'name':   result.sort((a, b) => a.titulo.localeCompare(b.titulo));                break;
    case 'artist': result.sort((a, b) => a.artista.localeCompare(b.artista));              break;
    case 'date':   result.sort((a, b) => new Date(b.dataCriacao)-new Date(a.dataCriacao)); break;
    case 'plays':  result.sort((a, b) => (b.plays||0)-(a.plays||0));                      break;
  }
  return result;
}

function getCategories() {
  return [...new Set(songs.map(s => s.categoria).filter(Boolean))].sort();
}

function renderLibrary() {
  const filtered = getFilteredSongs(songs);
  const cats     = getCategories();
  return `
    <div class="section-header">
      <div>
        <div class="section-title">🎵 Biblioteca</div>
        <div class="section-subtitle">${songs.length} música(s) no total · ${filtered.length} exibida(s)</div>
      </div>
    </div>
    <div class="filters-bar">
      <span class="filter-chip ${currentFilter==='all'?'active':''}" onclick="setFilter('all')">Todas</span>
      ${cats.map(c => `<span class="filter-chip ${currentFilter===c?'active':''}" onclick="setFilter('${escHtml(c)}')">${escHtml(c)}</span>`).join('')}
      <select class="sort-select" onchange="setSort(this.value)">
        <option value="name"   ${currentSort==='name'  ?'selected':''}>Nome</option>
        <option value="artist" ${currentSort==='artist'?'selected':''}>Artista</option>
        <option value="date"   ${currentSort==='date'  ?'selected':''}>Mais recente</option>
        <option value="plays"  ${currentSort==='plays' ?'selected':''}>Mais tocadas</option>
      </select>
    </div>
    ${filtered.length === 0 ? renderEmpty() : `<div id="music-grid">${filtered.map(renderCard).join('')}</div>`}`;
}

function renderCard(s) {
  const thumb       = s.thumbnail ? `<img src="${escHtml(s.thumbnail)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">` : '';
  const placeholder = `<div class="card-thumb-placeholder" ${s.thumbnail?'style="display:none"':''}>🎤</div>`;
  const titleHtml   = currentSearch ? highlightText(s.titulo,  currentSearch) : escHtml(s.titulo);
  const artistHtml  = currentSearch ? highlightText(s.artista, currentSearch) : escHtml(s.artista);
  const mp3Badge    = s.temMp3
    ? `<span style="position:absolute;bottom:8px;left:8px;background:rgba(0,0,0,0.65);
                    backdrop-filter:blur(4px);border-radius:6px;padding:2px 7px;
                    font-size:10px;font-weight:700;color:#4ade80">🎵 MP3</span>` : '';
  const favBtn = isAdmin
    ? `<button class="card-fav ${s.favorita?'active':''}" onclick="toggleFav('${s.id}',event)">${s.favorita?'❤️':'🤍'}</button>`
    : (s.favorita ? `<span class="card-fav active" style="pointer-events:none">❤️</span>` : '');
  const adminActions = isAdmin
    ? `<button onclick="openEditModal('${s.id}')">✏️</button><button onclick="openAddToPlaylist('${s.id}')">📋</button>`
    : '';
  return `
    <div class="music-card" data-id="${s.id}">
      <div class="card-thumb">
        ${thumb}${placeholder}
        <div class="card-play-overlay">
          <div class="play-btn-circle" onclick="openKaraoke('${s.id}')">▶</div>
        </div>
        ${favBtn}
        ${mp3Badge}
      </div>
      <div class="card-info">
        <div class="card-title">${titleHtml}</div>
        <div class="card-artist">${artistHtml}</div>
        ${s.categoria?`<span class="card-cat">${escHtml(s.categoria)}</span>`:''}
      </div>
      <div class="card-actions">
        <button onclick="openKaraoke('${s.id}')">🎤 Cantar</button>
        ${adminActions}
      </div>
    </div>`;
}

function renderEmpty() {
  const hasSearch = currentSearch || currentFilter !== 'all';
  return `
    <div class="empty-state">
      <div class="empty-icon">🎵</div>
      <h3>${hasSearch ? 'Nenhuma música encontrada' : 'Biblioteca vazia'}</h3>
      <p>${hasSearch ? 'Tente outro termo ou filtro.' : (isAdmin ? 'Adicione sua primeira música e comece a cantar!' : 'Ainda não há músicas cadastradas.')}</p>
      ${!hasSearch && isAdmin ? `<button class="btn btn-primary" onclick="openAddModal()">＋ Adicionar primeira música</button>` : ''}
    </div>`;
}


/* ─────────────────────────────────────────────────────────────
   7. RENDERIZAÇÃO — FAVORITAS
───────────────────────────────────────────────────────────── */

function renderFavorites() {
  const favs = getFilteredSongs(songs.filter(s => s.favorita));
  return `
    <div class="section-header">
      <div>
        <div class="section-title">❤️ Favoritas</div>
        <div class="section-subtitle">${favs.length} música(s)</div>
      </div>
    </div>
    ${favs.length === 0
      ? `<div class="empty-state"><div class="empty-icon">🤍</div><h3>Nenhuma favorita ainda</h3><p>${isAdmin ? 'Clique no coração em qualquer música para salvar aqui.' : 'O admin ainda não marcou nenhuma música como favorita.'}</p></div>`
      : `<div id="music-grid">${favs.map(renderCard).join('')}</div>`}`;
}


/* ─────────────────────────────────────────────────────────────
   8. RENDERIZAÇÃO — PLAYLISTS
───────────────────────────────────────────────────────────── */

function renderPlaylists() {
  return `
    <div class="section-header">
      <div>
        <div class="section-title">📋 Playlists</div>
        <div class="section-subtitle">${playlists.length} playlist(s)</div>
      </div>
      ${isAdmin ? `<button class="btn btn-primary btn-sm" onclick="openPlaylistModal()">＋ Nova playlist</button>` : ''}
    </div>
    ${playlists.length === 0
      ? `<div class="empty-state"><div class="empty-icon">📋</div><h3>Nenhuma playlist</h3><p>${isAdmin ? 'Crie playlists para organizar as músicas.' : 'O admin ainda não criou nenhuma playlist.'}</p>${isAdmin ? `<button class="btn btn-primary" onclick="openPlaylistModal()">＋ Criar playlist</button>` : ''}</div>`
      : `<div class="playlist-grid">${playlists.map(renderPlaylistCard).join('')}</div>`}`;
}

function renderPlaylistCard(pl) {
  const thumbs = pl.songs.slice(0, 4).map(id => {
    const s = songs.find(x => x.id === id);
    return s && s.thumbnail
      ? `<img src="${escHtml(s.thumbnail)}" alt="" onerror="this.style.display='none'">`
      : `<div class="mosaic-ph">🎵</div>`;
  });
  while (thumbs.length < 4) thumbs.push(`<div class="mosaic-ph">🎵</div>`);
  const adminActions = isAdmin
    ? `<button class="btn btn-ghost btn-sm"  onclick="openPlaylistModal('${pl.id}')">✏️</button>
       <button class="btn btn-danger btn-sm" onclick="deletePlaylist('${pl.id}')">🗑</button>`
    : '';
  return `
    <div class="playlist-card">
      <div class="playlist-mosaic">${thumbs.join('')}</div>
      <div class="playlist-card-info" onclick="openPlaylistDetail('${pl.id}')">
        <div class="playlist-card-name">${escHtml(pl.name)}</div>
        <div class="playlist-card-count">${pl.songs.length} música(s)</div>
      </div>
      <div class="playlist-card-actions" style="padding:0 14px 14px">
        <button class="btn btn-secondary btn-sm" onclick="openPlaylistDetail('${pl.id}')">🎤 Abrir</button>
        ${adminActions}
      </div>
    </div>`;
}


/* ─────────────────────────────────────────────────────────────
   9. RENDERIZAÇÃO — DETALHE DA PLAYLIST
───────────────────────────────────────────────────────────── */

function renderPlaylistDetail() {
  const pl = playlists.find(p => p.id === currentPlaylistId);
  if (!pl) return '<p>Playlist não encontrada.</p>';
  const plSongs = pl.songs.map(id => songs.find(s => s.id === id)).filter(Boolean);
  const rows    = plSongs.map((s, i) => `
    <div class="playlist-song-row" ${isAdmin ? 'draggable="true"' : ''} data-song-id="${s.id}" data-idx="${i}">
      <span class="drag-handle">⠿</span>
      <span class="row-num">${i + 1}</span>
      ${s.thumbnail
        ? `<img class="row-thumb" src="${escHtml(s.thumbnail)}" alt="" onerror="this.src=''">`
        : `<div class="row-thumb" style="display:flex;align-items:center;justify-content:center;border-radius:8px;background:var(--bg-secondary)">🎤</div>`}
      <div class="row-info" onclick="openKaraoke('${s.id}')">
        <div class="row-title">${escHtml(s.titulo)}</div>
        <div class="row-artist">${escHtml(s.artista)}</div>
      </div>
      <button class="btn btn-ghost btn-sm btn-icon" onclick="openKaraoke('${s.id}')">🎤</button>
      ${isAdmin ? `<button class="btn btn-danger btn-sm btn-icon" onclick="removeSongFromPlaylist('${pl.id}','${s.id}')">🗑</button>` : ''}
    </div>`).join('');
  return `
    <div class="back-btn" onclick="navigate('playlists')">← Voltar para Playlists</div>
    <div class="section-header">
      <div>
        <div class="section-title">📋 ${escHtml(pl.name)}</div>
        <div class="section-subtitle">${pl.songs.length} música(s)${isAdmin ? ' · Arraste para reordenar' : ''}</div>
      </div>
      ${isAdmin ? `<div style="display:flex;gap:8px">
        <button class="btn btn-ghost btn-sm"  onclick="openPlaylistModal('${pl.id}')">✏️ Renomear</button>
        <button class="btn btn-danger btn-sm" onclick="deletePlaylist('${pl.id}')">🗑 Excluir</button>
      </div>` : ''}
    </div>
    ${plSongs.length === 0 ? `<div class="empty-state"><div class="empty-icon">🎵</div><h3>Playlist vazia</h3><p>${isAdmin ? 'Adicione músicas clicando em 📋 nos cards da biblioteca.' : ''}</p></div>` : ''}
    <div id="pl-song-list" style="display:flex;flex-direction:column;gap:4px">${rows}</div>`;
}


/* ─────────────────────────────────────────────────────────────
   10. RENDERIZAÇÃO — HISTÓRICO
───────────────────────────────────────────────────────────── */

function renderHistory() {
  const rows = history.slice(0, 100).map(h => {
    const s = songs.find(x => x.id === h.id);
    if (!s) return '';
    return `
      <div class="history-row">
        <span class="history-time">${fmtDate(h.at)}</span>
        ${s.thumbnail
          ? `<img style="width:40px;height:40px;border-radius:8px;object-fit:cover" src="${escHtml(s.thumbnail)}" alt="">`
          : `<div style="width:40px;height:40px;border-radius:8px;background:var(--bg-card);display:flex;align-items:center;justify-content:center">🎤</div>`}
        <div style="flex:1;overflow:hidden">
          <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(s.titulo)}</div>
          <div style="font-size:12px;color:var(--text-secondary)">${escHtml(s.artista)}</div>
        </div>
        <button class="btn btn-primary btn-sm" onclick="openKaraoke('${s.id}')">🎤</button>
      </div>`;
  }).join('');
  return `
    <div class="section-header"><div class="section-title">🕓 Histórico de Reprodução</div></div>
    ${history.length === 0
      ? `<div class="empty-state"><div class="empty-icon">🕓</div><h3>Sem histórico ainda</h3><p>Cante uma música para começar!</p></div>`
      : ''}
    <div style="display:flex;flex-direction:column">${rows}</div>`;
}


/* ─────────────────────────────────────────────────────────────
   11. RENDERIZAÇÃO — ESTATÍSTICAS
───────────────────────────────────────────────────────────── */

function renderStats() {
  const totalPlays = songs.reduce((acc, s) => acc + (s.plays || 0), 0);
  const topSongs   = songs.slice().sort((a, b) => (b.plays||0)-(a.plays||0)).slice(0, 10);
  const medals     = ['🥇','🥈','🥉'];
  const catCount   = {};
  songs.forEach(s => { if (s.categoria) catCount[s.categoria] = (catCount[s.categoria]||0) + 1; });
  const topCats = Object.entries(catCount).sort((a, b) => b[1]-a[1]).slice(0, 5);

  const statsCards = [
    { num: songs.length,                         label: 'Músicas'     },
    { num: playlists.length,                     label: 'Playlists'   },
    { num: totalPlays,                           label: 'Reproduções' },
    { num: songs.filter(s => s.favorita).length, label: 'Favoritas'   },
    { num: getCategories().length,               label: 'Gêneros'     },
    { num: history.length,                       label: 'Registros'   },
  ].map(i => `<div class="stat-card"><div class="stat-num">${i.num}</div><div class="stat-label">${i.label}</div></div>`).join('');

  const topSongsRows = topSongs.map((s, i) => `
    <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
      <span class="top-song-rank ${['gold','silver','bronze'][i]||''}">${i<3?medals[i]:i+1}</span>
      <div style="flex:1;overflow:hidden">
        <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(s.titulo)}</div>
        <div style="font-size:12px;color:var(--text-secondary)">${escHtml(s.artista)}</div>
      </div>
      <span style="font-size:13px;color:var(--accent);font-weight:700">${s.plays||0}×</span>
    </div>`).join('');

  const catBars = topCats.map(([cat, n]) => `
    <div style="margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
        <span>${escHtml(cat)}</span><span style="color:var(--accent)">${n}</span>
      </div>
      <div style="height:6px;background:var(--bg-card);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${Math.round(n/songs.length*100)}%;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:3px"></div>
      </div>
    </div>`).join('');

  return `
    <div class="section-title" style="margin-bottom:20px">📊 Estatísticas</div>
    <div class="stats-grid">${statsCards}</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
      <div>
        <div style="font-size:16px;font-weight:700;margin-bottom:14px">🏆 Mais tocadas</div>
        ${topSongs.length===0 ? '<p style="color:var(--text-muted);font-size:14px">Nenhuma reprodução ainda.</p>' : topSongsRows}
      </div>
      <div>
        <div style="font-size:16px;font-weight:700;margin-bottom:14px">🎸 Por gênero</div>
        ${topCats.length===0 ? '<p style="color:var(--text-muted);font-size:14px">Adicione categorias nas músicas.</p>' : catBars}
      </div>
    </div>`;
}


/* ─────────────────────────────────────────────────────────────
   12. RENDERIZAÇÃO — IMPORTAR / EXPORTAR  (somente admin)
───────────────────────────────────────────────────────────── */

function renderImportExport() {
  if (!isAdmin) return '<p>Faça login como admin para acessar esta área.</p>';
  const plButtons = playlists.map(pl =>
    `<button class="btn btn-secondary btn-sm" onclick="exportPlaylist('${pl.id}')">⬇️ ${escHtml(pl.name)} (${pl.songs.length})</button>`
  ).join('');
  return `
    <div class="section-title" style="margin-bottom:6px">📦 Exportar / Importar</div>
    <p style="color:var(--text-muted);font-size:14px;margin-bottom:28px">
      O arquivo JSON inclui músicas, playlists, capas, letras, links e MP3s (em base64).
      Exportar/importar a biblioteca toda pode demorar um pouco, pois os MP3s são
      baixados/enviados para a nuvem (Supabase).
    </p>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px">
        <div style="font-size:36px;margin-bottom:10px">📤</div>
        <div style="font-size:16px;font-weight:700;margin-bottom:8px">Exportar Biblioteca</div>
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">
          ${songs.length} música(s) · ${playlists.length} playlist(s). MP3s incluídos no arquivo.
        </p>
        <button class="btn btn-primary" onclick="exportAll()">⬇️ Exportar tudo</button>
      </div>
      <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px">
        <div style="font-size:36px;margin-bottom:10px">📥</div>
        <div style="font-size:16px;font-weight:700;margin-bottom:8px">Importar Biblioteca</div>
        <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">
          Restaura músicas, playlists e MP3s de um arquivo JSON exportado para a nuvem.
        </p>
        <input type="file" id="import-file" accept=".json" style="display:none" onchange="importFile(event)">
        <button class="btn btn-secondary" onclick="document.getElementById('import-file').click()">⬆️ Escolher arquivo</button>
      </div>
    </div>
    <div style="margin-top:20px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px">
      <div style="font-size:16px;font-weight:700;margin-bottom:14px">📋 Exportar Playlist específica</div>
      ${playlists.length===0 ? '<p style="color:var(--text-muted);font-size:14px">Nenhuma playlist criada ainda.</p>' : `<div style="display:flex;flex-wrap:wrap;gap:10px">${plButtons}</div>`}
    </div>
    <div style="margin-top:20px;background:rgba(248,113,113,0.08);border:1px solid rgba(248,113,113,0.2);border-radius:var(--radius-lg);padding:24px">
      <div style="font-size:16px;font-weight:700;margin-bottom:8px;color:var(--danger)">⚠️ Zona de Perigo</div>
      <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px">Apaga todos os metadados e MP3s da nuvem. Não pode ser desfeito.</p>
      <button class="btn btn-danger btn-sm" onclick="clearAll()">🗑 Apagar tudo</button>
    </div>`;
}


/* ─────────────────────────────────────────────────────────────
   13. EXPORTAR / IMPORTAR
───────────────────────────────────────────────────────────── */

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload  = e => resolve(e.target.result);
    r.onerror = e => reject(e);
    r.readAsDataURL(blob);
  });
}

function base64ToBlob(dataUrl) {
  const [header, data] = dataUrl.split(',');
  const mime  = header.match(/:(.*?);/)[1];
  const bytes = atob(data);
  const buf   = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
  return new Blob([buf], { type: mime });
}

function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

async function exportAll() {
  showToast('Preparando exportação, aguarde…', 'info');
  try {
    const songsExport = [];
    for (const s of songs) {
      let arquivoMp3 = '';
      if (s.mp3Url) { const blob = await (await fetch(s.mp3Url)).blob(); arquivoMp3 = await blobToBase64(blob); }
      songsExport.push({ ...s, arquivoMp3 });
    }
    const data = { version: 4, exportedAt: new Date().toISOString(), songs: songsExport, playlists, settings };
    downloadJSON(data, `karaoke-backup-${new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')}.json`);
    showToast('Biblioteca exportada com sucesso!', 'success');
  } catch (err) { console.error(err); showToast('Erro ao exportar.', 'error'); }
}

async function exportPlaylist(plId) {
  const pl = playlists.find(p => p.id === plId);
  if (!pl) return;
  showToast('Preparando exportação…', 'info');
  try {
    const songsExport = [];
    for (const id of pl.songs) {
      const s = songs.find(x => x.id === id);
      if (!s) continue;
      let arquivoMp3 = '';
      if (s.mp3Url) { const blob = await (await fetch(s.mp3Url)).blob(); arquivoMp3 = await blobToBase64(blob); }
      songsExport.push({ ...s, arquivoMp3 });
    }
    downloadJSON(
      { version: 4, exportedAt: new Date().toISOString(), songs: songsExport, playlists: [pl], settings },
      `playlist-${pl.name.replace(/\s+/g,'-')}.json`
    );
    showToast('Playlist exportada!', 'success');
  } catch (err) { console.error(err); showToast('Erro ao exportar playlist.', 'error'); }
}

async function importFile(e) {
  if (!isAdmin) { showToast('Faça login como admin para importar.', 'error'); e.target.value = ''; return; }
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async ev => {
    try {
      const data = JSON.parse(ev.target.result);
      if (!data.songs) throw new Error('Formato inválido');
      const merge = confirm(
        `Arquivo: ${data.songs.length} música(s), ${(data.playlists||[]).length} playlist(s).\n\nOK = MESCLAR | Cancelar = SUBSTITUIR tudo`
      );
      if (!merge && !confirm('Isso vai apagar TUDO que já está na nuvem antes de importar. Continuar?')) return;

      showToast('Importando, aguarde… isso pode demorar um pouco.', 'info');
      if (!merge) await clearAllData();

      for (const s of data.songs) {
        if (merge && songs.find(x => x.titulo === s.titulo && x.artista === s.artista)) continue;
        const { data: row, error } = await sb.from('songs').insert({
          titulo: s.titulo, artista: s.artista, categoria: s.categoria || null,
          video_playback: s.videoPlayback || null, letra: s.letra || null,
          favorita: !!s.favorita,
        }).select().single();
        if (error) { console.error(error); continue; }

        let thumbnail_url = s.thumbnail || null;
        let mp3_url = null;
        if (s.arquivoMp3) {
          try { mp3_url = await uploadMp3(row.id, base64ToBlob(s.arquivoMp3)); }
          catch (err) { console.error('Erro ao importar MP3 de', s.titulo, err); }
        }
        await sb.from('songs').update({ thumbnail_url, mp3_url }).eq('id', row.id);
      }

      for (const pl of (data.playlists || [])) {
        if (merge && playlists.find(p => p.name === pl.name)) continue;
        await sb.from('playlists').insert({ name: pl.name });
      }

      if (data.settings) { settings = Object.assign(settings, data.settings); saveSettings(); }
      await load(); renderPage();
      showToast('Importação concluída!', 'success');
    } catch (err) { console.error(err); showToast('Erro ao importar: arquivo inválido.', 'error'); }
  };
  reader.readAsText(file);
  e.target.value = '';
}

async function clearAllData() {
  for (const s of songs) {
    await removeStorageFolder('mp3s', s.id);
    await removeStorageFolder('thumbnails', s.id);
  }
  await sb.from('songs').delete().neq('id', '00000000-0000-0000-0000-000000000000');
  await sb.from('playlists').delete().neq('id', '00000000-0000-0000-0000-000000000000');
}

async function clearAll() {
  if (!isAdmin) { showToast('Faça login como admin.', 'error'); return; }
  if (!confirm('Apagar TODOS os dados, incluindo MP3s da nuvem? Esta ação não pode ser desfeita.')) return;
  showToast('Apagando, aguarde…', 'info');
  await clearAllData();
  await load(); renderPage();
  showToast('Todos os dados foram apagados.', 'info');
}


/* ─────────────────────────────────────────────────────────────
   14. CRUD DE MÚSICAS
───────────────────────────────────────────────────────────── */

function openAddModal() {
  if (!isAdmin) { showToast('Faça login como admin para adicionar músicas.', 'error'); return; }
  pendingThumbData = null; pendingThumbFile = null; pendingMp3File = null;
  document.getElementById('edit-id').value                 = '';
  document.getElementById('modal-music-title').textContent = 'Adicionar música';
  document.getElementById('edit-title').value               = '';
  document.getElementById('edit-artist').value               = '';
  document.getElementById('edit-category').value            = '';
  document.getElementById('edit-fav').value                 = 'false';
  document.getElementById('edit-video').value                = '';
  document.getElementById('edit-lyrics').value               = '';
  document.getElementById('mp3-filename').textContent       = 'Nenhum arquivo';
  document.getElementById('mp3-status').textContent         = '';
  document.getElementById('thumb-url').value                 = '';
  setThumbPreview(null);
  document.getElementById('btn-duplicate').style.display  = 'none';
  document.getElementById('btn-delete').style.display     = 'none';
  document.getElementById('btn-remove-mp3').style.display = 'none';
  updateCategoryDatalist();
  openModal('modal-music');
}

function openEditModal(id) {
  if (!isAdmin) { showToast('Faça login como admin para editar.', 'error'); return; }
  const s = songs.find(x => x.id === id);
  if (!s) return;
  pendingThumbData = s.thumbnail || null;
  pendingThumbFile = null; pendingMp3File = null;
  document.getElementById('edit-id').value                  = s.id;
  document.getElementById('modal-music-title').textContent  = 'Editar música';
  document.getElementById('edit-title').value                = s.titulo;
  document.getElementById('edit-artist').value                = s.artista;
  document.getElementById('edit-category').value             = s.categoria || '';
  document.getElementById('edit-fav').value                  = s.favorita ? 'true' : 'false';
  document.getElementById('edit-video').value                 = s.videoPlayback || '';
  document.getElementById('edit-lyrics').value                = s.letra || '';
  document.getElementById('thumb-url').value                  = '';
  if (s.temMp3) {
    document.getElementById('mp3-filename').textContent     = '✅ MP3 salvo na nuvem';
    document.getElementById('mp3-status').textContent       = '';
    document.getElementById('btn-remove-mp3').style.display = '';
  } else {
    document.getElementById('mp3-filename').textContent     = 'Nenhum arquivo';
    document.getElementById('mp3-status').textContent       = '';
    document.getElementById('btn-remove-mp3').style.display = 'none';
  }
  setThumbPreview(s.thumbnail);
  document.getElementById('btn-duplicate').style.display = '';
  document.getElementById('btn-delete').style.display    = '';
  updateCategoryDatalist();
  openModal('modal-music');
}

function openEditFromKaraoke() {
  if (karaokeCurrentSong) openEditModal(karaokeCurrentSong.id);
}

async function saveSong() {
  if (!isAdmin) { showToast('Faça login como admin.', 'error'); return; }
  const titulo  = document.getElementById('edit-title').value.trim();
  const artista = document.getElementById('edit-artist').value.trim();
  if (!titulo) { showToast('Nome da música é obrigatório', 'error'); return; }

  const idField  = document.getElementById('edit-id').value;
  const videoRaw = document.getElementById('edit-video').value.trim();
  const existing = idField ? songs.find(s => s.id === idField) : null;
  const isNew    = !idField;

  showToast('Salvando…', 'info');

  let songId = idField || null;
  try {
    if (isNew) {
      const { data, error } = await sb.from('songs').insert({ titulo, artista }).select().single();
      if (error) throw error;
      songId = data.id;
    }

    let thumbnailUrl = existing ? existing.thumbnail : '';
    let mp3Url       = existing ? existing.mp3Url    : '';

    if (pendingMp3File)        mp3Url       = await uploadMp3(songId, pendingMp3File);
    if (pendingThumbFile)      thumbnailUrl = await uploadThumb(songId, pendingThumbFile);
    else if (pendingThumbData !== null) thumbnailUrl = pendingThumbData;

    const payload = {
      titulo, artista,
      categoria:      document.getElementById('edit-category').value.trim() || null,
      thumbnail_url:  thumbnailUrl || null,
      video_playback: processVideoUrl(videoRaw) || null,
      letra:          document.getElementById('edit-lyrics').value || null,
      favorita:       document.getElementById('edit-fav').value === 'true',
      mp3_url:        mp3Url || null,
    };

    const { error: upErr } = await sb.from('songs').update(payload).eq('id', songId);
    if (upErr) throw upErr;

    await load();
    closeModal('modal-music'); renderPage();
    showToast(isNew ? 'Música adicionada!' : 'Música atualizada!', 'success');
  } catch (err) {
    console.error('Erro ao salvar música:', err);
    if (isNew && songId) await sb.from('songs').delete().eq('id', songId).then(()=>{}, ()=>{});
    showToast('Erro ao salvar a música.', 'error');
  }
}

async function removeMp3FromSong() {
  if (!isAdmin) return;
  const id = document.getElementById('edit-id').value;
  if (!id) return;
  await removeStorageFolder('mp3s', id);
  const { error } = await sb.from('songs').update({ mp3_url: null }).eq('id', id);
  if (error) { showToast('Erro ao remover MP3.', 'error'); return; }
  pendingMp3File = null;
  document.getElementById('mp3-filename').textContent     = 'Nenhum arquivo';
  document.getElementById('mp3-status').textContent       = '';
  document.getElementById('btn-remove-mp3').style.display = 'none';
  const s = songs.find(x => x.id === id); if (s) { s.mp3Url = ''; s.temMp3 = false; }
  showToast('MP3 removido.', 'info');
}

async function duplicateSong() {
  if (!isAdmin) return;
  const id = document.getElementById('edit-id').value;
  const s  = songs.find(x => x.id === id);
  if (!s) return;
  try {
    const { error } = await sb.from('songs').insert({
      titulo: s.titulo + ' (cópia)', artista: s.artista, categoria: s.categoria || null,
      thumbnail_url: s.thumbnail || null, video_playback: s.videoPlayback || null,
      letra: s.letra || null, favorita: false, mp3_url: null,
    });
    if (error) throw error;
    await load(); closeModal('modal-music'); renderPage();
    showToast('Música duplicada! (MP3 não copiado)', 'success');
  } catch (err) { console.error(err); showToast('Erro ao duplicar.', 'error'); }
}

async function deleteSong() {
  if (!isAdmin) return;
  const id = document.getElementById('edit-id').value;
  if (!id) return;
  if (!confirm('Excluir esta música e seu MP3?')) return;
  try {
    await removeStorageFolder('mp3s', id);
    await removeStorageFolder('thumbnails', id);
    const { error } = await sb.from('songs').delete().eq('id', id);
    if (error) throw error;
    await load();
    closeModal('modal-music'); renderPage();
    showToast('Música excluída.', 'info');
  } catch (err) { console.error(err); showToast('Erro ao excluir a música.', 'error'); }
}

async function toggleFav(id, e) {
  if (e) e.stopPropagation();
  if (!isAdmin) { showToast('Faça login como admin para favoritar.', 'error'); return; }
  const s = songs.find(x => x.id === id); if (!s) return;
  const novo = !s.favorita;
  const { error } = await sb.from('songs').update({ favorita: novo }).eq('id', id);
  if (error) { showToast('Erro ao favoritar.', 'error'); return; }
  s.favorita = novo;
  renderPage();
  showToast(novo ? 'Adicionada aos favoritos!' : 'Removida dos favoritos.', 'info');
}


/* ─────────────────────────────────────────────────────────────
   15. HELPERS DE VÍDEO, THUMBNAIL E STORAGE
───────────────────────────────────────────────────────────── */

function processVideoUrl(url) {
  if (!url) return '';
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if (m) return `https://www.youtube.com/embed/${m[1]}?autoplay=1&rel=0`;
  if (url.includes('youtube.com/embed/')) return url;
  return url;
}

function setThumbPreview(src) {
  const img  = document.getElementById('thumb-preview-img');
  const text = document.getElementById('thumb-preview-text');
  if (src) { img.src=src; img.style.display='block'; text.style.display='none'; }
  else     { img.src='';  img.style.display='none';  text.style.display='';    }
}

function handleThumbFile(e) {
  const file = e.target.files[0]; if (!file) return;
  pendingThumbFile = file; pendingThumbData = null;
  setThumbPreview(URL.createObjectURL(file));
}

function handleThumbDrop(e) {
  e.preventDefault();
  const file = e.dataTransfer.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  pendingThumbFile = file; pendingThumbData = null;
  setThumbPreview(URL.createObjectURL(file));
}

function updateThumbFromUrl(url) {
  if (url) { pendingThumbData = url; pendingThumbFile = null; setThumbPreview(url); }
  else     { pendingThumbData = null; pendingThumbFile = null; setThumbPreview(null); }
}

function handleMp3File(e) {
  const file = e.target.files[0]; if (!file) return;
  pendingMp3File = file;
  const mb = (file.size / 1024 / 1024).toFixed(2);
  document.getElementById('mp3-filename').textContent = file.name;
  document.getElementById('mp3-status').textContent   = `📦 ${mb} MB — será enviado para a nuvem ao clicar em Salvar`;
  document.getElementById('btn-remove-mp3').style.display = '';
}

function extFromMime(mime) {
  const map = { 'audio/mpeg':'mp3','audio/mp3':'mp3','audio/wav':'wav','audio/ogg':'ogg','audio/x-m4a':'m4a','audio/mp4':'m4a','image/jpeg':'jpg','image/png':'png','image/webp':'webp' };
  return map[mime] || 'bin';
}

/** Sobe um arquivo MP3 para o bucket 'mp3s' e devolve a URL pública */
async function uploadMp3(songId, file) {
  const ext  = file.name ? (file.name.split('.').pop() || 'mp3').toLowerCase() : extFromMime(file.type);
  const path = `${songId}/${Date.now()}.${ext}`;
  const { error } = await sb.storage.from('mp3s').upload(path, file, { upsert: true, contentType: file.type || 'audio/mpeg' });
  if (error) throw error;
  return sb.storage.from('mp3s').getPublicUrl(path).data.publicUrl;
}

/** Sobe uma imagem de capa para o bucket 'thumbnails' e devolve a URL pública */
async function uploadThumb(songId, file) {
  const ext  = file.name ? (file.name.split('.').pop() || 'jpg').toLowerCase() : extFromMime(file.type);
  const path = `${songId}/${Date.now()}.${ext}`;
  const { error } = await sb.storage.from('thumbnails').upload(path, file, { upsert: true, contentType: file.type || 'image/jpeg' });
  if (error) throw error;
  return sb.storage.from('thumbnails').getPublicUrl(path).data.publicUrl;
}

/** Remove todos os arquivos de uma "pasta" (prefixo = id da música) num bucket */
async function removeStorageFolder(bucket, prefix) {
  try {
    const { data: files, error } = await sb.storage.from(bucket).list(prefix);
    if (error || !files || files.length === 0) return;
    const paths = files.map(f => `${prefix}/${f.name}`);
    await sb.storage.from(bucket).remove(paths);
  } catch (e) { console.warn('Falha ao limpar storage:', e); }
}


/* ─────────────────────────────────────────────────────────────
   16. CRUD DE PLAYLISTS
───────────────────────────────────────────────────────────── */

function openPlaylistModal(id) {
  if (!isAdmin) { showToast('Faça login como admin.', 'error'); return; }
  editingPlaylistId = id || null;
  const pl = id ? playlists.find(p => p.id === id) : null;
  document.getElementById('modal-playlist-title').textContent = pl ? 'Renomear playlist' : 'Nova playlist';
  document.getElementById('playlist-name-input').value = pl ? pl.name : '';
  openModal('modal-playlist');
}

async function savePlaylist() {
  if (!isAdmin) { showToast('Faça login como admin.', 'error'); return; }
  const name = document.getElementById('playlist-name-input').value.trim();
  if (!name) { showToast('Digite um nome para a playlist', 'error'); return; }
  try {
    if (editingPlaylistId) {
      const { error } = await sb.from('playlists').update({ name }).eq('id', editingPlaylistId);
      if (error) throw error;
    } else {
      const { error } = await sb.from('playlists').insert({ name });
      if (error) throw error;
    }
    await load(); closeModal('modal-playlist'); renderPage();
    showToast(editingPlaylistId ? 'Playlist renomeada!' : 'Playlist criada!', 'success');
  } catch (err) { console.error(err); showToast('Erro ao salvar playlist.', 'error'); }
}

async function deletePlaylist(id) {
  if (!isAdmin) { showToast('Faça login como admin.', 'error'); return; }
  if (!confirm('Excluir esta playlist?')) return;
  const { error } = await sb.from('playlists').delete().eq('id', id);
  if (error) { showToast('Erro ao excluir playlist.', 'error'); return; }
  if (currentPlaylistId === id) currentPlaylistId = null;
  await load(); renderPage();
  showToast('Playlist excluída.', 'info');
}

function openPlaylistDetail(id) { currentPlaylistId = id; navigate('playlists', id); }

async function removeSongFromPlaylist(plId, songId) {
  if (!isAdmin) { showToast('Faça login como admin.', 'error'); return; }
  const { error } = await sb.from('playlist_songs').delete().eq('playlist_id', plId).eq('song_id', songId);
  if (error) { showToast('Erro ao remover música.', 'error'); return; }
  await load(); renderPage();
  showToast('Música removida da playlist.', 'info');
}

function openAddToPlaylist(songId) {
  if (!isAdmin) { showToast('Faça login como admin para gerenciar playlists.', 'error'); return; }
  addToPlaylistSongId = songId;
  const body = document.getElementById('add-to-pl-body');
  if (playlists.length === 0) {
    body.innerHTML = `<p style="color:var(--text-muted);font-size:14px">Nenhuma playlist criada. <a href="#" onclick="openPlaylistModal();closeModal('modal-add-to-pl')" style="color:var(--accent)">Criar playlist</a></p>`;
  } else {
    body.innerHTML = `<div style="display:flex;flex-direction:column;gap:8px">
      ${playlists.map(pl => {
        const inPl = pl.songs.includes(songId);
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg-card);border-radius:var(--radius-md)">
          <span style="font-size:14px;font-weight:500">${escHtml(pl.name)}</span>
          <button class="btn btn-${inPl?'danger':'primary'} btn-sm" onclick="toggleSongInPlaylist('${pl.id}','${songId}')">
            ${inPl ? '✕ Remover' : '+ Adicionar'}
          </button>
        </div>`;
      }).join('')}
    </div>`;
  }
  openModal('modal-add-to-pl');
}

async function toggleSongInPlaylist(plId, songId) {
  if (!isAdmin) { showToast('Faça login como admin.', 'error'); return; }
  const pl = playlists.find(p => p.id === plId); if (!pl) return;
  try {
    if (pl.songs.includes(songId)) {
      const { error } = await sb.from('playlist_songs').delete().eq('playlist_id', plId).eq('song_id', songId);
      if (error) throw error;
      showToast('Removida da playlist.', 'info');
    } else {
      const nextPos = pl.songs.length;
      const { error } = await sb.from('playlist_songs').insert({ playlist_id: plId, song_id: songId, position: nextPos });
      if (error) throw error;
      showToast('Adicionada à playlist!', 'success');
    }
    await load();
    openAddToPlaylist(songId);
  } catch (err) { console.error(err); showToast('Erro ao atualizar playlist.', 'error'); }
}


/* ─────────────────────────────────────────────────────────────
   17. DRAG & DROP (Playlist) — só admin reordena
───────────────────────────────────────────────────────────── */

function attachDrag() {
  if (!isAdmin) return;
  const list = document.getElementById('pl-song-list');
  if (!list) return;
  let dragSrc = null;
  list.querySelectorAll('.playlist-song-row').forEach(row => {
    row.addEventListener('dragstart', () => { dragSrc = row; row.classList.add('dragging'); });
    row.addEventListener('dragend',   () => {
      row.classList.remove('dragging');
      list.querySelectorAll('.playlist-song-row').forEach(r => r.classList.remove('drag-over'));
    });
    row.addEventListener('dragover',  e => { e.preventDefault(); row.classList.add('drag-over'); });
    row.addEventListener('dragleave', () => row.classList.remove('drag-over'));
    row.addEventListener('drop', async e => {
      e.preventDefault(); row.classList.remove('drag-over');
      if (!dragSrc || dragSrc === row) return;
      const pl = playlists.find(p => p.id === currentPlaylistId); if (!pl) return;
      const fi = pl.songs.indexOf(dragSrc.dataset.songId);
      const ti = pl.songs.indexOf(row.dataset.songId);
      if (fi < 0 || ti < 0) return;
      pl.songs.splice(fi, 1); pl.songs.splice(ti, 0, dragSrc.dataset.songId);
      renderPage();
      try {
        await Promise.all(pl.songs.map((songId, idx) =>
          sb.from('playlist_songs').update({ position: idx }).eq('playlist_id', pl.id).eq('song_id', songId)
        ));
      } catch (err) {
        console.error('Erro ao salvar nova ordem:', err);
        showToast('Erro ao salvar a nova ordem.', 'error');
        await load(); renderPage();
      }
    });
  });
}


/* ─────────────────────────────────────────────────────────────
   18. TELA DE KARAOKÊ
   O MP3 vem direto do Supabase Storage via URL pública —
   não precisa mais buscar Blob em IndexedDB.
───────────────────────────────────────────────────────────── */

function openKaraoke(id) {
  const s = songs.find(x => x.id === id); if (!s) return;
  karaokeCurrentSong = s;

  document.getElementById('kara-title').textContent   = s.titulo;
  document.getElementById('kara-artist').textContent  = s.artista;
  document.getElementById('kara-fav-btn').textContent = s.favorita ? '❤️' : '🤍';

  const lyricsEl = document.getElementById('lyrics-text');
  lyricsEl.textContent      = s.letra || '(Nenhuma letra cadastrada)';
  lyricsEl.style.fontSize   = settings.fontSize + 'rem';
  lyricsEl.style.lineHeight = settings.lineHeight;

  const wrap     = document.getElementById('kara-video-wrap');
  const noVid    = document.getElementById('kara-no-video');
  const thumbBig = document.getElementById('kara-thumb-big');
  const persBar  = document.getElementById('kara-persistent-audio');
  wrap.innerHTML = '';

  tpStop(); tpScrollPos = 0;
  document.getElementById('lyrics-scroll').scrollTop = 0;
  document.getElementById('tp-progress').style.width = '0%';
  document.getElementById('karaoke-view').classList.add('open');
  document.body.style.overflow = 'hidden';

  if (s.videoPlayback) {
    wrap.style.display = 'flex'; noVid.style.display = 'none';
    const url = processVideoUrl(s.videoPlayback);
    const hasBoth = s.temMp3;

    if (url.includes('youtube.com/embed')) {
      wrap.innerHTML = `<iframe id="kara-yt-iframe" src="${url}" allow="autoplay;encrypted-media" allowfullscreen style="flex:1;border:none"></iframe>`;
    } else if (s.videoPlayback.match(/\.(mp4|webm|ogg)$/i)) {
      wrap.innerHTML = `<video id="kara-bg-video" src="${escHtml(s.videoPlayback)}" controls autoplay loop style="flex:1;max-height:100%;object-fit:cover"></video>`;
    } else {
      wrap.innerHTML = `<iframe src="${escHtml(s.videoPlayback)}" allow="autoplay" allowfullscreen style="flex:1;border:none"></iframe>`;
    }

    if (hasBoth) {
      wrap.style.position = 'relative';
      persBar.style.display = 'flex';
      persBar.innerHTML = [
        '<button id="btn-mute-video" onclick="toggleKaraokeVideoMute()" title="Mutar/desmutar vídeo"',
        ' style="background:rgba(255,255,255,0.12);border:none;border-radius:8px;',
        'padding:4px 8px;cursor:pointer;font-size:15px;color:#fff;white-space:nowrap;flex-shrink:0">',
        '🔊 Vídeo</button>',
        `<audio id="kara-audio" controls src="${escHtml(s.mp3Url)}" style="flex:1;height:32px;accent-color:var(--accent);min-width:0"></audio>`,
        '<button id="btn-mute-mp3" onclick="toggleKaraokeMp3Mute()" title="Mutar/desmutar MP3"',
        ' style="background:rgba(255,255,255,0.12);border:none;border-radius:8px;',
        'padding:4px 8px;cursor:pointer;font-size:15px;color:#fff;white-space:nowrap;flex-shrink:0">',
        '🔊 MP3</button>'
      ].join('');
    }

  } else if (s.temMp3) {
    wrap.style.display = 'flex'; noVid.style.display = 'none';
    wrap.innerHTML = `
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;
                  justify-content:center;background:var(--bg-secondary);gap:20px">
        ${s.thumbnail
          ? `<img src="${escHtml(s.thumbnail)}" style="width:220px;height:220px;border-radius:20px;object-fit:cover;box-shadow:0 8px 32px rgba(0,0,0,0.5)">`
          : `<div style="width:220px;height:220px;border-radius:20px;background:linear-gradient(135deg,var(--accent),var(--accent2));display:flex;align-items:center;justify-content:center;font-size:80px;box-shadow:0 8px 32px var(--accent-glow)">🎵</div>`
        }
        <div style="text-align:center">
          <div style="font-size:17px;font-weight:700;color:var(--text-primary)">${escHtml(s.titulo)}</div>
          <div style="font-size:13px;color:var(--text-secondary);margin-top:4px">${escHtml(s.artista)}</div>
        </div>
      </div>`;
    persBar.style.display = 'flex';
    persBar.innerHTML = `<audio id="kara-audio" controls src="${escHtml(s.mp3Url)}" style="flex:1;height:32px;accent-color:var(--accent);min-width:0"></audio>`;

  } else {
    wrap.style.display = 'none'; noVid.style.display = 'flex';
    if (s.thumbnail) { thumbBig.src = s.thumbnail; thumbBig.style.display = ''; }
    else               thumbBig.style.display = 'none';
  }

  // Registra a reprodução no banco (não bloqueia a abertura da tela)
  sb.rpc('registrar_reproducao', { p_song_id: id }).then(({ error }) => {
    if (error) console.error('Erro ao registrar reprodução:', error);
  });
  s.plays = (s.plays || 0) + 1;
  history.unshift({ id: s.id, at: new Date().toISOString() });
}

function closeKaraoke() {
  tpStop();
  document.getElementById('karaoke-view').classList.remove('open');
  document.body.style.overflow = '';
  karaokePresMode = false;
  document.getElementById('karaoke-view').classList.remove('presentation-mode');
  const wrap = document.getElementById('kara-video-wrap');
  wrap.innerHTML = '';
  wrap.style.position = '';
  const persBar = document.getElementById('kara-persistent-audio');
  persBar.style.display = 'none';
  persBar.innerHTML = '';
}

/** Muta/desmuta o vídeo de fundo (funciona para <video>; YouTube não expõe API via iframe) */
function toggleKaraokeVideoMute() {
  const btn   = document.getElementById('btn-mute-video');
  const video = document.getElementById('kara-bg-video');
  if (video) {
    video.muted = !video.muted;
    btn.textContent = (video.muted ? '🔇' : '🔊') + ' Vídeo';
    btn.style.opacity = video.muted ? '0.5' : '1';
  } else {
    showToast('Para mutar o YouTube, use o botão de mute dentro do próprio player.', 'info');
  }
}

/** Muta/desmuta o player de MP3 */
function toggleKaraokeMp3Mute() {
  const btn   = document.getElementById('btn-mute-mp3');
  const audio = document.getElementById('kara-audio');
  if (!audio) return;
  audio.muted = !audio.muted;
  btn.textContent = (audio.muted ? '🔇' : '🔊') + ' MP3';
  btn.style.opacity = audio.muted ? '0.5' : '1';
}

async function favCurrentSong() {
  if (!isAdmin) { showToast('Faça login como admin para favoritar.', 'error'); return; }
  if (!karaokeCurrentSong) return;
  const novo = !karaokeCurrentSong.favorita;
  const { error } = await sb.from('songs').update({ favorita: novo }).eq('id', karaokeCurrentSong.id);
  if (error) { showToast('Erro ao favoritar.', 'error'); return; }
  karaokeCurrentSong.favorita = novo;
  document.getElementById('kara-fav-btn').textContent = novo ? '❤️' : '🤍';
  const s = songs.find(x => x.id === karaokeCurrentSong.id); if (s) s.favorita = novo;
  showToast(novo ? 'Adicionada aos favoritos!' : 'Removida dos favoritos.', 'info');
}

function togglePresentationMode() {
  karaokePresMode = !karaokePresMode;
  document.getElementById('karaoke-view').classList.toggle('presentation-mode', karaokePresMode);
  if (karaokePresMode) showToast('Modo apresentação ativo. Pressione P para sair.', 'info');
}

function toggleFullscreen() {
  if (!document.fullscreenElement) document.getElementById('karaoke-view').requestFullscreen?.();
  else                              document.exitFullscreen?.();
}


/* ─────────────────────────────────────────────────────────────
   19. TELEPROMPTER
───────────────────────────────────────────────────────────── */

function tpToggle() { tpRunning ? tpStop() : tpStart(); }

function tpStart() {
  tpRunning = true;
  document.getElementById('tp-play-btn').textContent = '⏸';
  const audio = document.getElementById('kara-audio');
  if (audio && audio.src && audio.paused) audio.play().catch(() => {});

  const scroll = document.getElementById('lyrics-scroll');
  tpInterval = setInterval(() => {
    const maxScroll = scroll.scrollHeight - scroll.clientHeight;
    if (maxScroll <= 0) return;
    tpScrollPos += tpSpeed * 0.8;
    scroll.scrollTop = tpScrollPos;
    const pct = Math.min(100, (tpScrollPos / maxScroll) * 100);
    document.getElementById('tp-progress').style.width = pct + '%';
    if (tpScrollPos >= maxScroll) { tpStop(); document.getElementById('tp-progress').style.width = '100%'; }
  }, 50);
}

function tpStop() {
  tpRunning = false; clearInterval(tpInterval);
  const btn = document.getElementById('tp-play-btn');
  if (btn) btn.textContent = '▶';
  const audio = document.getElementById('kara-audio');
  if (audio && audio.src && !audio.ended) audio.pause();
}

function tpRestart() {
  tpStop(); tpScrollPos = 0;
  document.getElementById('lyrics-scroll').scrollTop = 0;
  document.getElementById('tp-progress').style.width = '0%';
  const audio = document.getElementById('kara-audio');
  if (audio && audio.src) { audio.currentTime = 0; }
}

function tpFaster()        { tpSpeed = Math.min(tpSpeed + 0.5, 10); updateSpeedLabel(); }
function tpSlower()        { tpSpeed = Math.max(tpSpeed - 0.5, 0.5); updateSpeedLabel(); }
function updateSpeedLabel() { document.getElementById('tp-speed-label').textContent = tpSpeed + '×'; }

function changeFontSize(delta) {
  settings.fontSize = Math.max(0.9, Math.min(4, (settings.fontSize||1.4) + delta * 0.1));
  document.getElementById('lyrics-text').style.fontSize = settings.fontSize + 'rem';
  saveSettings();
}

function changeLineHeight(delta) {
  settings.lineHeight = Math.max(1.2, Math.min(4, (settings.lineHeight||2) + delta));
  document.getElementById('lyrics-text').style.lineHeight = settings.lineHeight;
  saveSettings();
}


/* ─────────────────────────────────────────────────────────────
   20. SIDEBAR
───────────────────────────────────────────────────────────── */

function renderSidebarPlaylists() {
  const el = document.getElementById('sidebar-playlists'); if (!el) return;
  el.innerHTML = playlists.slice(0, 8).map(pl => `
    <div class="playlist-sidebar-item ${currentPlaylistId === pl.id ? 'active' : ''}"
         onclick="openPlaylistDetail('${pl.id}')">
      <div class="pl-dot"></div>
      <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(pl.name)}</span>
    </div>`).join('');
}

function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
  document.getElementById('sidebar-overlay').classList.toggle('open');
}

function closeSidebar() {
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}


/* ─────────────────────────────────────────────────────────────
   21. TEMA (Dark / Light)
───────────────────────────────────────────────────────────── */

function toggleTheme() {
  const next = document.body.dataset.theme === 'dark' ? 'light' : 'dark';
  document.body.dataset.theme = next; settings.theme = next;
  document.getElementById('theme-icon').textContent  = next === 'dark' ? '☀️' : '🌙';
  document.getElementById('theme-label').textContent = next === 'dark' ? 'Tema claro' : 'Tema escuro';
  saveSettings();
}

function applyTheme() {
  document.body.dataset.theme = settings.theme || 'dark';
  const icon  = document.getElementById('theme-icon');
  const label = document.getElementById('theme-label');
  if (icon)  icon.textContent  = settings.theme === 'light' ? '🌙' : '☀️';
  if (label) label.textContent = settings.theme === 'light' ? 'Tema escuro' : 'Tema claro';
}


/* ─────────────────────────────────────────────────────────────
   22. MODAIS
───────────────────────────────────────────────────────────── */

function openModal(id)            { document.getElementById(id).classList.add('open'); }
function closeModal(id)           { document.getElementById(id).classList.remove('open'); }
function closeModalOutside(e, id) { if (e.target.id === id) closeModal(id); }


/* ─────────────────────────────────────────────────────────────
   23. BUSCA, FILTRO E ORDENAÇÃO
───────────────────────────────────────────────────────────── */

function onSearch(q)  { currentSearch = q; renderPage(); }
function setFilter(f) { currentFilter = f; renderPage(); }
function setSort(s)   { currentSort   = s; renderPage(); }


/* ─────────────────────────────────────────────────────────────
   24. UTILITÁRIOS
───────────────────────────────────────────────────────────── */

function escHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function highlightText(text, query) {
  if (!query) return escHtml(text);
  const escaped = escHtml(text);
  const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return escaped.replace(new RegExp(q, 'gi'), m => `<mark class="highlight">${m}</mark>`);
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso), now = new Date();
  if (d.toDateString() === now.toDateString())
    return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function updateBadge() {
  const el = document.getElementById('badge-count');
  if (el) el.textContent = songs.length;
}

function updateCategoryDatalist() {
  const dl = document.getElementById('category-list'); if (!dl) return;
  dl.innerHTML = getCategories().map(c => `<option value="${escHtml(c)}">`).join('');
}


/* ─────────────────────────────────────────────────────────────
   25. TOASTS
───────────────────────────────────────────────────────────── */

function showToast(msg, type = 'info') {
  const container = document.getElementById('toast-container');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  const icons = { success: '✅', error: '❌', info: 'ℹ️' };
  t.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${msg}</span>`;
  container.appendChild(t);
  setTimeout(() => {
    t.style.animation = 'slideInToast 0.3s ease reverse';
    setTimeout(() => t.remove(), 300);
  }, 3500);
}


/* ─────────────────────────────────────────────────────────────
   26. ATALHOS DE TECLADO
───────────────────────────────────────────────────────────── */

document.addEventListener('keydown', e => {
  const kv = document.getElementById('karaoke-view');
  if (kv && kv.classList.contains('open')) {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    switch (e.key) {
      case ' ':      e.preventDefault(); tpToggle();           break;
      case 'r': case 'R': tpRestart();                         break;
      case '+': case '=': tpFaster();                          break;
      case '-':           tpSlower();                           break;
      case 'p': case 'P': togglePresentationMode();            break;
      case 'f': case 'F': toggleFullscreen();                  break;
      case 'Escape':
        karaokePresMode ? togglePresentationMode() : closeKaraoke();
        break;
    }
  } else {
    if (e.key === 'n' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); openAddModal(); }
  }
});


/* ─────────────────────────────────────────────────────────────
   27. PWA MANIFEST
───────────────────────────────────────────────────────────── */

(function registerManifest() {
  const manifest = {
    name: 'KaraokêLive', short_name: 'KaraokêLive',
    description: 'Plataforma de karaokê compartilhada',
    theme_color: '#0f0f1a', background_color: '#0f0f1a',
    display: 'standalone', start_url: '.',
    icons: [{ src: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🎤</text></svg>', sizes: 'any', type: 'image/svg+xml' }],
  };
  const blob = new Blob([JSON.stringify(manifest)], { type: 'application/json' });
  const el   = document.getElementById('manifest-link');
  if (el) el.href = URL.createObjectURL(blob);
})();


/* ─────────────────────────────────────────────────────────────
   28. INICIALIZAÇÃO
───────────────────────────────────────────────────────────── */

async function init() {
  if (typeof sb === 'undefined' || !SUPABASE_ANON_KEY || SUPABASE_ANON_KEY.includes('COLE_AQUI')) {
    document.getElementById('content').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <h3>Configuração pendente</h3>
        <p>Abra o arquivo <b>config.js</b> e cole sua chave publicável (anon key) do Supabase
        na variável <code>SUPABASE_ANON_KEY</code>.</p>
      </div>`;
    return;
  }
  await initAuth();
  await load();
  applyTheme();
  navigate('library');
}

init();
