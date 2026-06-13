/* =========================================================
   ESTADO GLOBAL
   ========================================================= */
let songs = [];
let playlists = [];
let history = [];
let settings = { theme:'dark', fontSize:1.4, lineHeight:2 };
let currentPage = 'library';
let currentSearch = '';
let currentFilter = 'all';
let currentSort = 'name';
let currentPlaylistId = null; // for detail view
let editingPlaylistId = null;
let addToPlaylistSongId = null;
let pendingThumbData = null; // base64 or url
let pendingMp3Data = null;

// Karaoke state
let karaokeCurrentSong = null;
let tpInterval = null;
let tpRunning = false;
let tpSpeed = 1;
let tpScrollPos = 0;
let karaokePresMode = false;

/* =========================================================
   PERSISTÊNCIA
   ========================================================= */
function save(){
  try{
    localStorage.setItem('kl_songs', JSON.stringify(songs));
    localStorage.setItem('kl_playlists', JSON.stringify(playlists));
    localStorage.setItem('kl_history', JSON.stringify(history.slice(0,500)));
    localStorage.setItem('kl_settings', JSON.stringify(settings));
  }catch(e){
    showToast('Armazenamento cheio! Considere exportar e limpar dados.','error');
  }
}
function load(){
  try{ songs = JSON.parse(localStorage.getItem('kl_songs')||'[]'); }catch{ songs=[]; }
  try{ playlists = JSON.parse(localStorage.getItem('kl_playlists')||'[]'); }catch{ playlists=[]; }
  try{ history = JSON.parse(localStorage.getItem('kl_history')||'[]'); }catch{ history=[]; }
  try{ settings = Object.assign({theme:'dark',fontSize:1.4,lineHeight:2}, JSON.parse(localStorage.getItem('kl_settings')||'{}')); }catch{ settings={theme:'dark',fontSize:1.4,lineHeight:2}; }
}

function autoBackup(){
  try{ localStorage.setItem('kl_backup_'+new Date().toDateString(), JSON.stringify({songs,playlists,settings})); }catch{}
}

/* =========================================================
   NAVEGAÇÃO
   ========================================================= */
function navigate(page, extra){
  currentPage = page;
  if(extra) currentPlaylistId = extra;
  document.querySelectorAll('.nav-item').forEach(el=>{
    el.classList.toggle('active', el.dataset.page===page);
  });
  // Search visible only on library/favorites
  document.getElementById('search-box').style.display = ['library','favorites'].includes(page) ? '' : 'none';
  renderPage();
  closeSidebar();
}

function renderPage(){
  const c = document.getElementById('content');
  switch(currentPage){
    case 'library':    c.innerHTML = renderLibrary(); break;
    case 'favorites':  c.innerHTML = renderFavorites(); break;
    case 'playlists':  currentPlaylistId ? (c.innerHTML = renderPlaylistDetail()) : (c.innerHTML = renderPlaylists()); break;
    case 'history':    c.innerHTML = renderHistory(); break;
    case 'stats':      c.innerHTML = renderStats(); break;
    case 'importexport': c.innerHTML = renderImportExport(); break;
  }
  updateBadge();
  renderSidebarPlaylists();
  attachDrag();
}

/* =========================================================
   BIBLIOTECA
   ========================================================= */
function getFilteredSongs(songs_list){
  let res = songs_list.slice();
  if(currentFilter !== 'all') res = res.filter(s=>s.categoria===currentFilter);
  if(currentSearch){
    const q = currentSearch.toLowerCase();
    res = res.filter(s=>(s.titulo+s.artista+s.categoria).toLowerCase().includes(q));
  }
  switch(currentSort){
    case 'name':    res.sort((a,b)=>a.titulo.localeCompare(b.titulo)); break;
    case 'artist':  res.sort((a,b)=>a.artista.localeCompare(b.artista)); break;
    case 'date':    res.sort((a,b)=>new Date(b.dataCriacao)-new Date(a.dataCriacao)); break;
    case 'plays':   res.sort((a,b)=>(b.plays||0)-(a.plays||0)); break;
  }
  return res;
}

function getCategories(){
  return [...new Set(songs.map(s=>s.categoria).filter(Boolean))].sort();
}

function renderLibrary(){
  const filtered = getFilteredSongs(songs);
  const cats = getCategories();
  return `
<div class="section-header">
  <div>
    <div class="section-title">🎵 Biblioteca</div>
    <div class="section-subtitle">${songs.length} música(s) no total · ${filtered.length} exibida(s)</div>
  </div>
</div>
<div class="filters-bar">
  <span class="filter-chip ${currentFilter==='all'?'active':''}" onclick="setFilter('all')">Todas</span>
  ${cats.map(c=>`<span class="filter-chip ${currentFilter===c?'active':''}" onclick="setFilter('${escHtml(c)}')">${escHtml(c)}</span>`).join('')}
  <select class="sort-select" onchange="setSort(this.value)">
    <option value="name" ${currentSort==='name'?'selected':''}>Nome</option>
    <option value="artist" ${currentSort==='artist'?'selected':''}>Artista</option>
    <option value="date" ${currentSort==='date'?'selected':''}>Mais recente</option>
    <option value="plays" ${currentSort==='plays'?'selected':''}>Mais tocadas</option>
  </select>
</div>
${filtered.length===0 ? renderEmpty() : `<div id="music-grid">${filtered.map(renderCard).join('')}</div>`}
`;
}

function renderFavorites(){
  const favs = getFilteredSongs(songs.filter(s=>s.favorita));
  return `
<div class="section-header">
  <div>
    <div class="section-title">❤️ Favoritas</div>
    <div class="section-subtitle">${favs.length} música(s)</div>
  </div>
</div>
${favs.length===0 ? `<div class="empty-state"><div class="empty-icon">🤍</div><h3>Nenhuma favorita ainda</h3><p>Clique no coração em qualquer música para salvar aqui.</p></div>` : `<div id="music-grid">${favs.map(renderCard).join('')}</div>`}
`;
}

function renderCard(s){
  const thumb = s.thumbnail
    ? `<img src="${escHtml(s.thumbnail)}" alt="" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'">`
    : '';
  const ph = `<div class="card-thumb-placeholder" ${s.thumbnail?'style="display:none"':''}>🎤</div>`;
  const hl = currentSearch ? highlightText(s.titulo, currentSearch) : escHtml(s.titulo);
  const hla = currentSearch ? highlightText(s.artista, currentSearch) : escHtml(s.artista);
  return `
<div class="music-card" data-id="${s.id}">
  <div class="card-thumb">
    ${thumb}${ph}
    <div class="card-play-overlay">
      <div class="play-btn-circle" onclick="openKaraoke('${s.id}')">▶</div>
    </div>
    <button class="card-fav ${s.favorita?'active':''}" onclick="toggleFav('${s.id}',event)">${s.favorita?'❤️':'🤍'}</button>
  </div>
  <div class="card-info">
    <div class="card-title">${hl}</div>
    <div class="card-artist">${hla}</div>
    ${s.categoria?`<span class="card-cat">${escHtml(s.categoria)}</span>`:''}
  </div>
  <div class="card-actions">
    <button onclick="openKaraoke('${s.id}')" title="Cantar">🎤 Cantar</button>
    <button onclick="openEditModal('${s.id}')" title="Editar">✏️</button>
    <button onclick="openAddToPlaylist('${s.id}')" title="Playlist">📋</button>
  </div>
</div>`;
}

function renderEmpty(){
  return `<div class="empty-state">
    <div class="empty-icon">🎵</div>
    <h3>${currentSearch||currentFilter!=='all'?'Nenhuma música encontrada':'Biblioteca vazia'}</h3>
    <p>${currentSearch||currentFilter!=='all'?'Tente outro termo ou filtro.':'Adicione sua primeira música e comece a cantar!'}</p>
    ${!currentSearch&&currentFilter==='all'?`<button class="btn btn-primary" onclick="openAddModal()">＋ Adicionar primeira música</button>`:''}
  </div>`;
}

/* =========================================================
   PLAYLISTS
   ========================================================= */
function renderPlaylists(){
  return `
<div class="section-header">
  <div>
    <div class="section-title">📋 Playlists</div>
    <div class="section-subtitle">${playlists.length} playlist(s)</div>
  </div>
  <button class="btn btn-primary btn-sm" onclick="openPlaylistModal()">＋ Nova playlist</button>
</div>
${playlists.length===0?`<div class="empty-state"><div class="empty-icon">📋</div><h3>Nenhuma playlist</h3><p>Crie playlists para organizar suas músicas favoritas.</p><button class="btn btn-primary" onclick="openPlaylistModal()">＋ Criar playlist</button></div>`:
`<div class="playlist-grid">${playlists.map(renderPlaylistCard).join('')}</div>`}
`;
}

function renderPlaylistCard(pl){
  const thumbs = pl.songs.slice(0,4).map(id=>{
    const s = songs.find(x=>x.id===id);
    return s&&s.thumbnail?`<img src="${escHtml(s.thumbnail)}" alt="" onerror="this.style.display='none'">`:`<div class="mosaic-ph">🎵</div>`;
  });
  while(thumbs.length<4) thumbs.push(`<div class="mosaic-ph">🎵</div>`);
  return `
<div class="playlist-card">
  <div class="playlist-mosaic">${thumbs.join('')}</div>
  <div class="playlist-card-info" onclick="openPlaylistDetail('${pl.id}')">
    <div class="playlist-card-name">${escHtml(pl.name)}</div>
    <div class="playlist-card-count">${pl.songs.length} música(s)</div>
  </div>
  <div class="playlist-card-actions" style="padding:0 14px 14px">
    <button class="btn btn-secondary btn-sm" onclick="openPlaylistDetail('${pl.id}')">🎤 Abrir</button>
    <button class="btn btn-ghost btn-sm" onclick="openPlaylistModal('${pl.id}')">✏️</button>
    <button class="btn btn-danger btn-sm" onclick="deletePlaylist('${pl.id}')">🗑</button>
  </div>
</div>`;
}

function renderPlaylistDetail(){
  const pl = playlists.find(p=>p.id===currentPlaylistId);
  if(!pl) return `<p>Playlist não encontrada.</p>`;
  const plSongs = pl.songs.map(id=>songs.find(s=>s.id===id)).filter(Boolean);
  return `
<div class="back-btn" onclick="navigate('playlists')">← Voltar para Playlists</div>
<div class="section-header">
  <div>
    <div class="section-title">📋 ${escHtml(pl.name)}</div>
    <div class="section-subtitle">${pl.songs.length} música(s) · Arraste para reordenar</div>
  </div>
  <div style="display:flex;gap:8px">
    <button class="btn btn-ghost btn-sm" onclick="openPlaylistModal('${pl.id}')">✏️ Renomear</button>
    <button class="btn btn-danger btn-sm" onclick="deletePlaylist('${pl.id}')">🗑 Excluir</button>
  </div>
</div>
${plSongs.length===0?`<div class="empty-state"><div class="empty-icon">🎵</div><h3>Playlist vazia</h3><p>Adicione músicas clicando em 📋 nos cards da biblioteca.</p></div>`:''}
<div id="pl-song-list" style="display:flex;flex-direction:column;gap:4px">
${plSongs.map((s,i)=>`
<div class="playlist-song-row" draggable="true" data-song-id="${s.id}" data-idx="${i}">
  <span class="drag-handle">⠿</span>
  <span class="row-num">${i+1}</span>
  ${s.thumbnail?`<img class="row-thumb" src="${escHtml(s.thumbnail)}" alt="" onerror="this.src=''">`:`<div class="row-thumb" style="display:flex;align-items:center;justify-content:center;border-radius:8px;background:var(--bg-secondary)">🎤</div>`}
  <div class="row-info" onclick="openKaraoke('${s.id}')">
    <div class="row-title">${escHtml(s.titulo)}</div>
    <div class="row-artist">${escHtml(s.artista)}</div>
  </div>
  <button class="btn btn-ghost btn-sm btn-icon" onclick="openKaraoke('${s.id}')" title="Cantar">🎤</button>
  <button class="btn btn-danger btn-sm btn-icon" onclick="removeSongFromPlaylist('${pl.id}','${s.id}')" title="Remover">🗑</button>
</div>`).join('')}
</div>
`;
}

/* =========================================================
   DRAG AND DROP PLAYLIST
   ========================================================= */
function attachDrag(){
  const list = document.getElementById('pl-song-list');
  if(!list) return;
  let dragSrc = null;
  list.querySelectorAll('.playlist-song-row').forEach(row=>{
    row.addEventListener('dragstart',e=>{dragSrc=row;row.classList.add('dragging')});
    row.addEventListener('dragend',e=>{row.classList.remove('dragging');list.querySelectorAll('.playlist-song-row').forEach(r=>r.classList.remove('drag-over'))});
    row.addEventListener('dragover',e=>{e.preventDefault();row.classList.add('drag-over')});
    row.addEventListener('dragleave',e=>row.classList.remove('drag-over'));
    row.addEventListener('drop',e=>{
      e.preventDefault();row.classList.remove('drag-over');
      if(!dragSrc||dragSrc===row) return;
      const pl = playlists.find(p=>p.id===currentPlaylistId);
      if(!pl) return;
      const fromId = dragSrc.dataset.songId;
      const toId = row.dataset.songId;
      const fi = pl.songs.indexOf(fromId), ti = pl.songs.indexOf(toId);
      if(fi<0||ti<0) return;
      pl.songs.splice(fi,1);pl.songs.splice(ti,0,fromId);
      save(); renderPage();
    });
  });
}

/* =========================================================
   HISTÓRICO
   ========================================================= */
function renderHistory(){
  return `
<div class="section-header"><div class="section-title">🕓 Histórico de Reprodução</div></div>
${history.length===0?`<div class="empty-state"><div class="empty-icon">🕓</div><h3>Sem histórico ainda</h3><p>Cante uma música para começar!</p></div>`:''}
<div style="display:flex;flex-direction:column">
${history.slice(0,100).map(h=>{
  const s=songs.find(x=>x.id===h.id);
  if(!s) return '';
  return `<div class="history-row">
    <span class="history-time">${fmtDate(h.at)}</span>
    ${s.thumbnail?`<img style="width:40px;height:40px;border-radius:8px;object-fit:cover" src="${escHtml(s.thumbnail)}" alt="">`:`<div style="width:40px;height:40px;border-radius:8px;background:var(--bg-card);display:flex;align-items:center;justify-content:center">🎤</div>`}
    <div style="flex:1;overflow:hidden">
      <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(s.titulo)}</div>
      <div style="font-size:12px;color:var(--text-secondary)">${escHtml(s.artista)}</div>
    </div>
    <button class="btn btn-primary btn-sm" onclick="openKaraoke('${s.id}')">🎤</button>
  </div>`;
}).join('')}
</div>`;
}

/* =========================================================
   ESTATÍSTICAS
   ========================================================= */
function renderStats(){
  const totalPlays = songs.reduce((a,s)=>a+(s.plays||0),0);
  const topSongs = songs.slice().sort((a,b)=>(b.plays||0)-(a.plays||0)).slice(0,10);
  const cats = {};
  songs.forEach(s=>{ if(s.categoria) cats[s.categoria]=(cats[s.categoria]||0)+1; });
  const topCats = Object.entries(cats).sort((a,b)=>b[1]-a[1]).slice(0,5);
  const medals = ['🥇','🥈','🥉'];
  return `
<div class="section-title" style="margin-bottom:20px">📊 Estatísticas</div>
<div class="stats-grid">
  <div class="stat-card"><div class="stat-num">${songs.length}</div><div class="stat-label">Músicas</div></div>
  <div class="stat-card"><div class="stat-num">${playlists.length}</div><div class="stat-label">Playlists</div></div>
  <div class="stat-card"><div class="stat-num">${totalPlays}</div><div class="stat-label">Reproduções</div></div>
  <div class="stat-card"><div class="stat-num">${songs.filter(s=>s.favorita).length}</div><div class="stat-label">Favoritas</div></div>
  <div class="stat-card"><div class="stat-num">${getCategories().length}</div><div class="stat-label">Gêneros</div></div>
  <div class="stat-card"><div class="stat-num">${history.length}</div><div class="stat-label">Registros</div></div>
</div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;flex-wrap:wrap">
<div>
  <div style="font-size:16px;font-weight:700;margin-bottom:14px">🏆 Mais tocadas</div>
  ${topSongs.length===0?'<p style="color:var(--text-muted);font-size:14px">Nenhuma reprodução ainda.</p>':''}
  ${topSongs.map((s,i)=>`
  <div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--border)">
    <span class="top-song-rank ${i<3?['gold','silver','bronze'][i]:''}">${i<3?medals[i]:i+1}</span>
    <div style="flex:1;overflow:hidden">
      <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(s.titulo)}</div>
      <div style="font-size:12px;color:var(--text-secondary)">${escHtml(s.artista)}</div>
    </div>
    <span style="font-size:13px;color:var(--accent);font-weight:700">${s.plays||0}×</span>
  </div>`).join('')}
</div>
<div>
  <div style="font-size:16px;font-weight:700;margin-bottom:14px">🎸 Por gênero</div>
  ${topCats.map(([cat,n])=>`
  <div style="margin-bottom:10px">
    <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
      <span>${escHtml(cat)}</span><span style="color:var(--accent)">${n}</span>
    </div>
    <div style="height:6px;background:var(--bg-card);border-radius:3px;overflow:hidden">
      <div style="height:100%;width:${Math.round(n/songs.length*100)}%;background:linear-gradient(90deg,var(--accent),var(--accent2));border-radius:3px"></div>
    </div>
  </div>`).join('')}
  ${topCats.length===0?'<p style="color:var(--text-muted);font-size:14px">Adicione categorias nas músicas.</p>':''}
</div>
</div>`;
}

/* =========================================================
   IMPORTAR / EXPORTAR
   ========================================================= */
function renderImportExport(){
  return `
<div class="section-title" style="margin-bottom:6px">📦 Exportar / Importar</div>
<p style="color:var(--text-muted);font-size:14px;margin-bottom:28px">Faça backup da sua biblioteca ou compartilhe com outras pessoas. O arquivo JSON contém todas as músicas, playlists, capas e letras.</p>

<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
  <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px">
    <div style="font-size:36px;margin-bottom:10px">📤</div>
    <div style="font-size:16px;font-weight:700;margin-bottom:8px">Exportar Biblioteca</div>
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">Baixa um arquivo JSON com todas as ${songs.length} música(s), ${playlists.length} playlist(s), capas, letras, links e configurações.</p>
    <button class="btn btn-primary" onclick="exportAll()">⬇️ Exportar tudo</button>
  </div>

  <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px">
    <div style="font-size:36px;margin-bottom:10px">📥</div>
    <div style="font-size:16px;font-weight:700;margin-bottom:8px">Importar Biblioteca</div>
    <p style="font-size:13px;color:var(--text-muted);margin-bottom:16px">Carrega um arquivo JSON exportado anteriormente. Você pode mesclar com os dados atuais ou substituir tudo.</p>
    <input type="file" id="import-file" accept=".json" style="display:none" onchange="importFile(event)">
    <button class="btn btn-secondary" onclick="document.getElementById('import-file').click()">⬆️ Escolher arquivo</button>
  </div>
</div>

<div style="margin-top:20px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-lg);padding:24px">
  <div style="font-size:16px;font-weight:700;margin-bottom:14px">📋 Exportar Playlist específica</div>
  ${playlists.length===0?'<p style="color:var(--text-muted);font-size:14px">Nenhuma playlist criada ainda.</p>':''}
  <div style="display:flex;flex-wrap:wrap;gap:10px">
    ${playlists.map(pl=>`
    <button class="btn btn-secondary btn-sm" onclick="exportPlaylist('${pl.id}')">⬇️ ${escHtml(pl.name)} (${pl.songs.length})</button>`).join('')}
  </div>
</div>

<div style="margin-top:20px;background:rgba(248,113,113,0.08);border:1px solid rgba(248,113,113,0.2);border-radius:var(--radius-lg);padding:24px">
  <div style="font-size:16px;font-weight:700;margin-bottom:8px;color:var(--danger)">⚠️ Zona de Perigo</div>
  <p style="font-size:13px;color:var(--text-muted);margin-bottom:14px">Limpa completamente todos os dados armazenados. Esta ação não pode ser desfeita.</p>
  <button class="btn btn-danger btn-sm" onclick="clearAll()">🗑 Apagar tudo</button>
</div>
`;
}

/* =========================================================
   EXPORT / IMPORT
   ========================================================= */
function exportAll(){
  const data = { version:2, exportedAt:new Date().toISOString(), songs, playlists, settings };
  downloadJSON(data, `karaoke-backup-${new Date().toLocaleDateString('pt-BR').replace(/\//g,'-')}.json`);
  showToast('Biblioteca exportada com sucesso!','success');
}

function exportPlaylist(plId){
  const pl = playlists.find(p=>p.id===plId);
  if(!pl) return;
  const plSongs = pl.songs.map(id=>songs.find(s=>s.id===id)).filter(Boolean);
  const data = { version:2, exportedAt:new Date().toISOString(), songs:plSongs, playlists:[pl], settings };
  downloadJSON(data, `playlist-${pl.name.replace(/\s+/g,'-')}.json`);
  showToast('Playlist exportada!','success');
}

function downloadJSON(data, filename){
  const blob = new Blob([JSON.stringify(data,null,2)],{type:'application/json'});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

function importFile(e){
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ev=>{
    try{
      const data = JSON.parse(ev.target.result);
      if(!data.songs) throw new Error('Formato inválido');
      const mode = confirm(
        `Arquivo contém ${data.songs.length} música(s) e ${(data.playlists||[]).length} playlist(s).\n\nClicar OK: MESCLAR com biblioteca atual.\nClicar Cancelar: SUBSTITUIR tudo.`
      );
      if(mode===true){
        // Mesclar
        let added=0, skipped=0;
        data.songs.forEach(s=>{
          if(!songs.find(x=>x.id===s.id)){ songs.push(s); added++; }
          else skipped++;
        });
        (data.playlists||[]).forEach(pl=>{
          if(!playlists.find(x=>x.id===pl.id)) playlists.push(pl);
        });
        showToast(`${added} adicionadas, ${skipped} já existiam.`,'success');
      } else {
        // Substituir
        songs = data.songs;
        playlists = data.playlists||[];
        if(data.settings) settings = Object.assign(settings, data.settings);
        showToast('Biblioteca substituída com sucesso!','success');
      }
      save(); renderPage();
    }catch(err){
      showToast('Erro ao importar: arquivo inválido.','error');
    }
  };
  reader.readAsText(file);
  e.target.value='';
}

function clearAll(){
  if(!confirm('Apagar TODOS os dados? Esta ação não pode ser desfeita.')) return;
  songs=[];playlists=[];history=[];
  save(); renderPage();
  showToast('Todos os dados foram apagados.','info');
}

/* =========================================================
   CRUD MÚSICAS
   ========================================================= */
function openAddModal(){
  pendingThumbData=null; pendingMp3Data=null;
  document.getElementById('edit-id').value='';
  document.getElementById('modal-music-title').textContent='Adicionar música';
  document.getElementById('edit-title').value='';
  document.getElementById('edit-artist').value='';
  document.getElementById('edit-category').value='';
  document.getElementById('edit-fav').value='false';
  document.getElementById('edit-video').value='';
  document.getElementById('edit-lyrics').value='';
  document.getElementById('edit-mp3').value='';
  document.getElementById('mp3-filename').textContent='Nenhum arquivo';
  document.getElementById('thumb-url').value='';
  setThumbPreview(null);
  document.getElementById('btn-duplicate').style.display='none';
  document.getElementById('btn-delete').style.display='none';
  // Update category datalist
  updateCategoryDatalist();
  openModal('modal-music');
}

function openEditModal(id){
  const s = songs.find(x=>x.id===id);
  if(!s) return;
  pendingThumbData = s.thumbnail||null;
  pendingMp3Data = s.arquivoMp3||null;
  document.getElementById('edit-id').value=s.id;
  document.getElementById('modal-music-title').textContent='Editar música';
  document.getElementById('edit-title').value=s.titulo;
  document.getElementById('edit-artist').value=s.artista;
  document.getElementById('edit-category').value=s.categoria||'';
  document.getElementById('edit-fav').value=s.favorita?'true':'false';
  document.getElementById('edit-video').value=s.videoPlayback||'';
  document.getElementById('edit-lyrics').value=s.letra||'';
  document.getElementById('edit-mp3').value=s.arquivoMp3||'';
  document.getElementById('mp3-filename').textContent=s.arquivoMp3?'Arquivo carregado':'Nenhum arquivo';
  document.getElementById('thumb-url').value='';
  setThumbPreview(s.thumbnail);
  document.getElementById('btn-duplicate').style.display='';
  document.getElementById('btn-delete').style.display='';
  updateCategoryDatalist();
  openModal('modal-music');
}

function openEditFromKaraoke(){
  if(!karaokeCurrentSong) return;
  openEditModal(karaokeCurrentSong.id);
}

function saveSong(){
  const titulo = document.getElementById('edit-title').value.trim();
  const artista = document.getElementById('edit-artist').value.trim();
  if(!titulo){ showToast('Nome da música é obrigatório','error'); return; }

  const id = document.getElementById('edit-id').value || genId();
  const videoRaw = document.getElementById('edit-video').value.trim();

  const song = {
    id,
    titulo,
    artista,
    categoria: document.getElementById('edit-category').value.trim(),
    thumbnail: pendingThumbData||'',
    videoPlayback: processVideoUrl(videoRaw),
    arquivoMp3: pendingMp3Data||'',
    letra: document.getElementById('edit-lyrics').value,
    favorita: document.getElementById('edit-fav').value==='true',
    dataCriacao: new Date().toISOString(),
    plays: 0,
  };

  const existing = songs.find(s=>s.id===id);
  if(existing){
    Object.assign(existing, song);
    song.plays = existing.plays||0;
    song.dataCriacao = existing.dataCriacao;
  } else {
    songs.push(song);
  }

  save(); closeModal('modal-music'); renderPage();
  showToast(existing?'Música atualizada!':'Música adicionada!','success');
}

function duplicateSong(){
  const id = document.getElementById('edit-id').value;
  const s = songs.find(x=>x.id===id);
  if(!s) return;
  const dup = Object.assign({},s,{id:genId(), titulo:s.titulo+' (cópia)', dataCriacao:new Date().toISOString(), plays:0});
  songs.push(dup);
  save(); closeModal('modal-music'); renderPage();
  showToast('Música duplicada!','success');
}

function deleteSong(){
  const id = document.getElementById('edit-id').value;
  if(!id) return;
  if(!confirm('Excluir esta música?')) return;
  songs = songs.filter(s=>s.id!==id);
  playlists.forEach(pl=>{ pl.songs=pl.songs.filter(sid=>sid!==id); });
  save(); closeModal('modal-music'); renderPage();
  showToast('Música excluída.','info');
}

function toggleFav(id, e){
  if(e) e.stopPropagation();
  const s = songs.find(x=>x.id===id);
  if(!s) return;
  s.favorita = !s.favorita;
  save(); renderPage();
  showToast(s.favorita?'Adicionada aos favoritos!':'Removida dos favoritos.','info');
}

/* =========================================================
   VIDEO URL HELPER
   ========================================================= */
function processVideoUrl(url){
  if(!url) return '';
  // YouTube watch URL → embed
  let m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  if(m) return `https://www.youtube.com/embed/${m[1]}?autoplay=1&rel=0`;
  // Already embed
  if(url.includes('youtube.com/embed/')) return url;
  return url;
}

function getYoutubeThumb(videoUrl){
  const m = videoUrl.match(/embed\/([A-Za-z0-9_-]{11})/);
  return m ? `https://img.youtube.com/vi/${m[1]}/hqdefault.jpg` : null;
}

/* =========================================================
   THUMB HELPERS
   ========================================================= */
function setThumbPreview(src){
  const img = document.getElementById('thumb-preview-img');
  const txt = document.getElementById('thumb-preview-text');
  if(src){ img.src=src; img.style.display='block'; txt.style.display='none'; }
  else { img.src=''; img.style.display='none'; txt.style.display=''; }
}

function handleThumbFile(e){
  const file = e.target.files[0]; if(!file) return;
  const reader = new FileReader();
  reader.onload = ev=>{ pendingThumbData=ev.target.result; setThumbPreview(ev.target.result); };
  reader.readAsDataURL(file);
}

function handleThumbDrop(e){
  e.preventDefault();
  const file = e.dataTransfer.files[0]; if(!file||!file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = ev=>{ pendingThumbData=ev.target.result; setThumbPreview(ev.target.result); };
  reader.readAsDataURL(file);
}

function updateThumbFromUrl(url){
  if(url){ pendingThumbData=url; setThumbPreview(url); }
  else{ pendingThumbData=null; setThumbPreview(null); }
}

function handleMp3File(e){
  const file = e.target.files[0]; if(!file) return;
  document.getElementById('mp3-filename').textContent=file.name;
  const reader = new FileReader();
  reader.onload = ev=>{ pendingMp3Data=ev.target.result; };
  reader.readAsDataURL(file);
}

/* =========================================================
   PLAYLISTS CRUD
   ========================================================= */
function openPlaylistModal(id){
  editingPlaylistId = id||null;
  const pl = id ? playlists.find(p=>p.id===id) : null;
  document.getElementById('modal-playlist-title').textContent = pl?'Renomear playlist':'Nova playlist';
  document.getElementById('playlist-name-input').value = pl?pl.name:'';
  openModal('modal-playlist');
}

function savePlaylist(){
  const name = document.getElementById('playlist-name-input').value.trim();
  if(!name){ showToast('Digite um nome para a playlist','error'); return; }
  if(editingPlaylistId){
    const pl = playlists.find(p=>p.id===editingPlaylistId);
    if(pl) pl.name=name;
  } else {
    playlists.push({id:genId(), name, songs:[], createdAt:new Date().toISOString()});
  }
  save(); closeModal('modal-playlist'); renderPage();
  showToast(editingPlaylistId?'Playlist renomeada!':'Playlist criada!','success');
}

function deletePlaylist(id){
  if(!confirm('Excluir esta playlist?')) return;
  playlists = playlists.filter(p=>p.id!==id);
  if(currentPlaylistId===id){ currentPlaylistId=null; }
  save(); renderPage();
  showToast('Playlist excluída.','info');
}

function openPlaylistDetail(id){ currentPlaylistId=id; navigate('playlists',id); }

function removeSongFromPlaylist(plId,songId){
  const pl = playlists.find(p=>p.id===plId); if(!pl) return;
  pl.songs = pl.songs.filter(id=>id!==songId);
  save(); renderPage();
  showToast('Música removida da playlist.','info');
}

function openAddToPlaylist(songId){
  addToPlaylistSongId = songId;
  const body = document.getElementById('add-to-pl-body');
  if(playlists.length===0){
    body.innerHTML=`<p style="color:var(--text-muted);font-size:14px">Nenhuma playlist criada. <a href="#" onclick="openPlaylistModal();closeModal('modal-add-to-pl')" style="color:var(--accent)">Criar playlist</a></p>`;
  } else {
    body.innerHTML=`<div style="display:flex;flex-direction:column;gap:8px">
    ${playlists.map(pl=>{
      const inPl = pl.songs.includes(songId);
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;background:var(--bg-card);border-radius:var(--radius-md)">
        <span style="font-size:14px;font-weight:500">${escHtml(pl.name)}</span>
        <button class="btn btn-${inPl?'danger':'primary'} btn-sm" onclick="toggleSongInPlaylist('${pl.id}','${songId}')">
          ${inPl?'✕ Remover':'+ Adicionar'}
        </button>
      </div>`;
    }).join('')}
    </div>`;
  }
  openModal('modal-add-to-pl');
}

function toggleSongInPlaylist(plId, songId){
  const pl = playlists.find(p=>p.id===plId); if(!pl) return;
  if(pl.songs.includes(songId)){ pl.songs=pl.songs.filter(id=>id!==songId); showToast('Removida da playlist.','info'); }
  else { pl.songs.push(songId); showToast('Adicionada à playlist!','success'); }
  save(); openAddToPlaylist(songId);
}

/* =========================================================
   KARAOKÊ
   ========================================================= */
function openKaraoke(id){
  const s = songs.find(x=>x.id===id);
  if(!s) return;
  karaokeCurrentSong = s;
  s.plays = (s.plays||0)+1;
  history.unshift({id:s.id, at:new Date().toISOString()});
  save();

  document.getElementById('kara-title').textContent = s.titulo;
  document.getElementById('kara-artist').textContent = s.artista;
  document.getElementById('kara-fav-btn').textContent = s.favorita?'❤️':'🤍';

  // Lyrics
  const lyricsEl = document.getElementById('lyrics-text');
  lyricsEl.textContent = s.letra || '(Nenhuma letra cadastrada)';
  lyricsEl.style.fontSize = settings.fontSize+'rem';
  lyricsEl.style.lineHeight = settings.lineHeight;

  // Video
  const wrap = document.getElementById('kara-video-wrap');
  const noVid = document.getElementById('kara-no-video');
  const thumbBig = document.getElementById('kara-thumb-big');
  wrap.innerHTML='';

  if(s.videoPlayback){
    wrap.style.display='flex';
    noVid.style.display='none';
    if(s.videoPlayback.includes('youtube.com/embed')||s.videoPlayback.includes('youtube.com/watch')){
      const url = processVideoUrl(s.videoPlayback);
      wrap.innerHTML=`<iframe src="${url}" allow="autoplay;encrypted-media" allowfullscreen style="flex:1;border:none"></iframe>`;
    } else if(s.videoPlayback.match(/\.(mp4|webm|ogg)$/i)){
      wrap.innerHTML=`<video src="${escHtml(s.videoPlayback)}" controls autoplay style="flex:1;max-height:100%"></video>`;
    } else {
      // Try embed
      wrap.innerHTML=`<iframe src="${escHtml(s.videoPlayback)}" allow="autoplay" allowfullscreen style="flex:1;border:none"></iframe>`;
    }
  } else if(s.arquivoMp3){
    wrap.style.display='flex';
    noVid.style.display='none';
    wrap.innerHTML=`
      <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;background:var(--bg-secondary);gap:16px">
        ${s.thumbnail?`<img src="${escHtml(s.thumbnail)}" style="width:200px;height:200px;border-radius:16px;object-fit:cover">`:'<span style="font-size:80px">🎵</span>'}
        <audio src="${escHtml(s.arquivoMp3)}" controls autoplay style="width:90%;max-width:360px"></audio>
      </div>`;
  } else {
    wrap.style.display='none';
    noVid.style.display='flex';
    if(s.thumbnail){ thumbBig.src=s.thumbnail; thumbBig.style.display=''; }
    else thumbBig.style.display='none';
  }

  // Reset teleprompter
  tpStop();
  tpScrollPos=0;
  document.getElementById('lyrics-scroll').scrollTop=0;
  document.getElementById('tp-progress').style.width='0%';

  document.getElementById('karaoke-view').classList.add('open');
  document.body.style.overflow='hidden';
}

function closeKaraoke(){
  tpStop();
  document.getElementById('karaoke-view').classList.remove('open');
  document.body.style.overflow='';
  karaokePresMode=false;
  document.getElementById('karaoke-view').classList.remove('presentation-mode');
  // Stop video
  document.getElementById('kara-video-wrap').innerHTML='';
}

function favCurrentSong(){
  if(!karaokeCurrentSong) return;
  karaokeCurrentSong.favorita = !karaokeCurrentSong.favorita;
  document.getElementById('kara-fav-btn').textContent = karaokeCurrentSong.favorita?'❤️':'🤍';
  save();
  showToast(karaokeCurrentSong.favorita?'Adicionada aos favoritos!':'Removida dos favoritos.','info');
}

/* TELEPROMPTER */
function tpToggle(){
  if(tpRunning) tpStop(); else tpStart();
}

function tpStart(){
  tpRunning=true;
  document.getElementById('tp-play-btn').textContent='⏸';
  const scroll = document.getElementById('lyrics-scroll');
  const text = document.getElementById('lyrics-text');
  tpInterval = setInterval(()=>{
    const maxScroll = scroll.scrollHeight - scroll.clientHeight;
    if(maxScroll<=0) return;
    tpScrollPos += tpSpeed * 0.8;
    scroll.scrollTop = tpScrollPos;
    const pct = Math.min(100, (tpScrollPos/maxScroll)*100);
    document.getElementById('tp-progress').style.width=pct+'%';
    if(tpScrollPos >= maxScroll){ tpStop(); document.getElementById('tp-progress').style.width='100%'; }
  },50);
}

function tpStop(){
  tpRunning=false;
  clearInterval(tpInterval);
  const btn=document.getElementById('tp-play-btn');
  if(btn) btn.textContent='▶';
}

function tpRestart(){
  tpStop();
  tpScrollPos=0;
  document.getElementById('lyrics-scroll').scrollTop=0;
  document.getElementById('tp-progress').style.width='0%';
}

function tpFaster(){ tpSpeed=Math.min(tpSpeed+0.5, 10); updateSpeedLabel(); }
function tpSlower(){ tpSpeed=Math.max(tpSpeed-0.5, 0.5); updateSpeedLabel(); }
function updateSpeedLabel(){ document.getElementById('tp-speed-label').textContent=tpSpeed+'×'; }

function changeFontSize(delta){
  settings.fontSize = Math.max(0.9, Math.min(4, (settings.fontSize||1.4)+delta*0.1));
  document.getElementById('lyrics-text').style.fontSize=settings.fontSize+'rem';
  save();
}
function changeLineHeight(delta){
  settings.lineHeight = Math.max(1.2, Math.min(4, (settings.lineHeight||2)+delta));
  document.getElementById('lyrics-text').style.lineHeight=settings.lineHeight;
  save();
}

function togglePresentationMode(){
  karaokePresMode=!karaokePresMode;
  document.getElementById('karaoke-view').classList.toggle('presentation-mode',karaokePresMode);
  if(karaokePresMode) showToast('Modo apresentação ativo. Pressione P para sair.','info');
}

function toggleFullscreen(){
  if(!document.fullscreenElement) document.getElementById('karaoke-view').requestFullscreen?.();
  else document.exitFullscreen?.();
}

/* =========================================================
   SIDEBAR
   ========================================================= */
function renderSidebarPlaylists(){
  const el = document.getElementById('sidebar-playlists');
  if(!el) return;
  el.innerHTML = playlists.slice(0,8).map(pl=>`
    <div class="playlist-sidebar-item ${currentPlaylistId===pl.id?'active':''}" onclick="openPlaylistDetail('${pl.id}')">
      <div class="pl-dot"></div>
      <span style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escHtml(pl.name)}</span>
    </div>`).join('');
}

function toggleSidebar(){
  const s = document.getElementById('sidebar');
  const ov = document.getElementById('sidebar-overlay');
  s.classList.toggle('open');
  ov.classList.toggle('open');
}
function closeSidebar(){
  document.getElementById('sidebar').classList.remove('open');
  document.getElementById('sidebar-overlay').classList.remove('open');
}

/* =========================================================
   THEME
   ========================================================= */
function toggleTheme(){
  const current = document.body.dataset.theme;
  const next = current==='dark'?'light':'dark';
  document.body.dataset.theme=next;
  settings.theme=next;
  document.getElementById('theme-icon').textContent=next==='dark'?'☀️':'🌙';
  document.getElementById('theme-label').textContent=next==='dark'?'Tema claro':'Tema escuro';
  save();
}

function applyTheme(){
  document.body.dataset.theme=settings.theme||'dark';
  const icon=document.getElementById('theme-icon');
  const label=document.getElementById('theme-label');
  if(icon) icon.textContent=settings.theme==='light'?'🌙':'☀️';
  if(label) label.textContent=settings.theme==='light'?'Tema escuro':'Tema claro';
}

/* =========================================================
   MODAL HELPERS
   ========================================================= */
function openModal(id){ document.getElementById(id).classList.add('open'); }
function closeModal(id){ document.getElementById(id).classList.remove('open'); }
function closeModalOutside(e,id){ if(e.target.id===id) closeModal(id); }

/* =========================================================
   SEARCH / FILTER / SORT
   ========================================================= */
function onSearch(q){ currentSearch=q; renderPage(); }
function setFilter(f){ currentFilter=f; renderPage(); }
function setSort(s){ currentSort=s; renderPage(); }

/* =========================================================
   UTILS
   ========================================================= */
function genId(){ return Date.now().toString(36)+Math.random().toString(36).slice(2,7); }

function escHtml(s){
  if(!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function highlightText(text,query){
  if(!query) return escHtml(text);
  const escaped = escHtml(text);
  const q = query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  return escaped.replace(new RegExp(q,'gi'),m=>`<mark class="highlight">${m}</mark>`);
}

function fmtDate(iso){
  if(!iso) return '';
  const d=new Date(iso);
  const now=new Date();
  if(d.toDateString()===now.toDateString()) return d.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'});
  return d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit'});
}

function updateBadge(){
  const el=document.getElementById('badge-count');
  if(el) el.textContent=songs.length;
}

function updateCategoryDatalist(){
  const dl=document.getElementById('category-list');
  if(!dl) return;
  const cats=getCategories();
  dl.innerHTML=cats.map(c=>`<option value="${escHtml(c)}">`).join('');
}

/* =========================================================
   TOAST
   ========================================================= */
function showToast(msg, type='info'){
  const container=document.getElementById('toast-container');
  const t=document.createElement('div');
  t.className=`toast ${type}`;
  const icons={success:'✅',error:'❌',info:'ℹ️'};
  t.innerHTML=`<span>${icons[type]||'ℹ️'}</span><span>${msg}</span>`;
  container.appendChild(t);
  setTimeout(()=>{ t.style.animation='slideInToast 0.3s ease reverse'; setTimeout(()=>t.remove(),300); },3500);
}

/* =========================================================
   KEYBOARD SHORTCUTS
   ========================================================= */
document.addEventListener('keydown',e=>{
  // Karaoke shortcuts
  const kv=document.getElementById('karaoke-view');
  if(kv&&kv.classList.contains('open')){
    if(e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
    switch(e.key){
      case ' ': e.preventDefault(); tpToggle(); break;
      case 'r': case 'R': tpRestart(); break;
      case '+': case '=': tpFaster(); break;
      case '-': tpSlower(); break;
      case 'p': case 'P': togglePresentationMode(); break;
      case 'f': case 'F': toggleFullscreen(); break;
      case 'Escape': if(!karaokePresMode) closeKaraoke(); else togglePresentationMode(); break;
    }
  } else {
    if(e.key==='n'&&(e.ctrlKey||e.metaKey)){ e.preventDefault(); openAddModal(); }
  }
});

/* =========================================================
   PWA MANIFEST (inline)
   ========================================================= */
(function(){
  const manifest={
    name:'KaraokêLive',short_name:'KaraokêLive',
    description:'Plataforma pessoal de karaokê offline',
    theme_color:'#0f0f1a',background_color:'#0f0f1a',
    display:'standalone',start_url:'.',
    icons:[{src:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><text y=".9em" font-size="90">🎤</text></svg>',sizes:'any',type:'image/svg+xml'}]
  };
  const blob=new Blob([JSON.stringify(manifest)],{type:'application/json'});
  document.getElementById('manifest-link').href=URL.createObjectURL(blob);
})();

/* =========================================================
   INIT
   ========================================================= */
load();
applyTheme();
navigate('library');
autoBackup();

// Register SW placeholder (would need separate sw.js for full PWA)
if('serviceWorker' in navigator){
  // In production you'd register a real SW here
}