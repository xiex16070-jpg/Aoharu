// ============================================================
//  贝贝最喜欢的作品们 — 图片画廊（v3 优化版）
//  功能：清单驱动加载、文件夹路径映射、懒加载、Lightbox
//        管理员登录（哈希密码）、编辑/添加/删除、localStorage
//        管理员拖拽排序（长按触发）、GitHub 同步
//        樱花&粒子动效、触摸滑动、图片预加载、键盘快捷键
// ============================================================

// ===== 从 manifest 获取数据（manifest.js 需先于本脚本加载）=====
const MANIFEST = (typeof GALLERY_MANIFEST !== 'undefined') ? GALLERY_MANIFEST : null;

// ===== 管理员凭据（SHA-256 哈希） =====
const ADMIN_USERNAME_HASH = '7cf0f774ebae842b6b19053a633ca959db164a69c5644ce1f179af5900384579';
const ADMIN_PASSWORD_HASH = '945af9dc78bf7affcc72266b0902eca6b1aeb256a6154491eb045539583fb985';

// 管理员凭据验证
async function verifyAdminCredentials(username, password) {
  if (!username || !password) return false;
  if (username.length > 64 || password.length > 128) return false;

  const encoder = new TextEncoder();
  const [userHashBuf, passHashBuf] = await Promise.all([
    crypto.subtle.digest('SHA-256', encoder.encode(username)),
    crypto.subtle.digest('SHA-256', encoder.encode(password))
  ]);

  const userHash = Array.from(new Uint8Array(userHashBuf))
    .map(b => b.toString(16).padStart(2, '0')).join('');
  const passHash = Array.from(new Uint8Array(passHashBuf))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  const userMatch = userHash.length === ADMIN_USERNAME_HASH.length &&
    [...userHash].every((c, i) => c === ADMIN_USERNAME_HASH[i]);
  const passMatch = passHash.length === ADMIN_PASSWORD_HASH.length &&
    [...passHash].every((c, i) => c === ADMIN_PASSWORD_HASH[i]);

  return userMatch && passMatch;
}

// ===== 从清单构建分类配置 =====
const categories = MANIFEST ? MANIFEST.categories.map(c => ({
  id: c.id, name: c.name, icon: c.icon, desc: c.desc
})) : [
  { id: 1, name: '入坑和启蒙', icon: '🌱', desc: '故事的起点，那些最初遇见的、打开新世界大门的作品。' },
  { id: 2, name: '青春和热爱', icon: '💫', desc: '在成长的关键时期，深刻影响和塑造了贝贝的作品。' },
  { id: 3, name: '那些无可替代的夏天', icon: '☀️', desc: '蝉鸣、汗水、蝉鸣与那些永远铭刻在记忆中的季节。' },
  { id: 4, name: '近来的优秀作品', icon: '🌟', desc: '近期发现和欣赏的优秀作品，值得反复回味。' },
  { id: 5, name: '其他优秀作品', icon: '✨', desc: '同样珍贵的作品，暂时还未归类到这里。' }
];

// ===== 从清单构建默认图片列表 =====
function buildDefaultImagesFromManifest() {
  if (MANIFEST && MANIFEST.images && MANIFEST.images.length > 0) {
    return MANIFEST.images.map(img => ({
      name: img.name,
      src: img.src,
      category: img.category,
      title: img.name,
      note: '',
      size: img.size,
      mtime: img.mtime,
      overrides: img.overrides || null
    }));
  }
  return [];
}

// ===== 音乐工具函数 =====
function getCustomMusicTracks() {
  const raw = safeGetStorage(MUSIC_PLAYLIST_KEY);
  const parsed = safeParseJSON(raw, []);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(t => t && typeof t.name === 'string' && typeof t.file === 'string' && t.name && t.file);
}

function saveCustomMusicTracks(tracks) {
  if (!Array.isArray(tracks)) return;
  safeSetStorage(MUSIC_PLAYLIST_KEY, JSON.stringify(tracks));
}

function buildMusicFromManifest() {
  const manifestTracks = (MANIFEST && MANIFEST.music && MANIFEST.music.length > 0)
    ? MANIFEST.music.map(m => ({ name: m.name || m.file, file: m.file }))
    : [];

  const customTracks = getCustomMusicTracks();
  const seenFiles = new Set(manifestTracks.map(t => t.file));
  const merged = [...manifestTracks];
  customTracks.forEach(t => {
    if (!seenFiles.has(t.file)) {
      merged.push(t);
      seenFiles.add(t.file);
    }
  });

  if (merged.length === 0) {
    merged.push({ name: "HOYO-MiX - I'm back, Kiana", file: "I'm back,Kiana-HOYO-MiX.mp3" });
  }

  return merged;
}

// ===== localStorage 键名 =====
const STORAGE_KEY = 'gallery_admin_data';
const SESSION_KEY = 'gallery_session_sources';
const AUTH_KEY = 'gallery_admin_auth';
const MUSIC_PLAYLIST_KEY = 'gallery_bg_music_custom';
const ORDER_KEY = 'gallery_image_order';

// ============================================================
//  🛡️ 安全工具函数
// ============================================================

function escapeHtml(str) {
  if (!str || typeof str !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function sanitizeText(str, maxLen = 5000) {
  if (!str || typeof str !== 'string') return '';
  return str.slice(0, maxLen)
    .replace(/<[^>]*>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim();
}

function sanitizeFilename(name, maxLen = 512) {
  if (!name || typeof name !== 'string') return '';
  return name.slice(0, maxLen)
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\.\./g, '')
    .replace(/[\x00-\x1f]/g, '')
    .trim();
}

function safeParseJSON(raw, fallback = null) {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return fallback;
    return parsed;
  } catch (e) { return fallback; }
}

function safeSetStorage(key, value) {
  try { localStorage.setItem(key, value); return true; }
  catch (e) { return false; }
}

function safeGetStorage(key) {
  try { return localStorage.getItem(key); }
  catch (e) { return null; }
}

function syncToStorage() {
  try {
    const compact = imageSources.map(s => ({
      name: s.name, src: s.src, title: s.title,
      note: s.note || '', category: s.category
    }));
    localStorage.setItem(SESSION_KEY, JSON.stringify(compact));
  } catch (e) {}
}

// ============================================================
//  💾 localStorage 持久化层
// ============================================================
function loadWorksData() {
  const raw = safeGetStorage(STORAGE_KEY);
  return safeParseJSON(raw, {});
}

function saveWorksData(data) {
  if (!data || typeof data !== 'object') return;
  safeSetStorage(STORAGE_KEY, JSON.stringify(data));
}

function getWorksData() {
  return loadWorksData();
}

// ===== 排序数据管理 =====
function loadOrderData() {
  const raw = safeGetStorage(ORDER_KEY);
  return safeParseJSON(raw, {});
}

function saveOrderData(data) {
  if (!data || typeof data !== 'object') return;
  safeSetStorage(ORDER_KEY, JSON.stringify(data));
}

function applyWorksDataToSources() {
  const worksData = getWorksData();
  imageSources = imageSources.map((item, i) => {
    const saved = worksData[item.name];
    const ov = item.overrides;

    const title = (saved && saved.title)
      ? sanitizeText(saved.title, 200)
      : (ov && ov.title)
        ? sanitizeText(ov.title, 200)
        : getDefaultTitle(item.name, i);

    const note = (saved && typeof saved.note === 'string')
      ? sanitizeText(saved.note, 5000)
      : (ov && typeof ov.note === 'string')
        ? sanitizeText(ov.note, 5000)
        : '';

    const category = (saved && typeof saved.category === 'number' && saved.category >= 1 && saved.category <= 5)
      ? saved.category
      : (ov && typeof ov.category === 'number' && ov.category >= 1 && ov.category <= 5)
        ? ov.category
        : (typeof item.category === 'number' && item.category >= 1 && item.category <= 5)
          ? item.category
          : 5;

    return { ...item, title, note, category };
  });
}

function getDefaultTitle(filename, index) {
  const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
  if (nameWithoutExt.startsWith('微信图片_')) {
    const datePart = nameWithoutExt.substring(5, 13);
    if (datePart && /^\d{8}$/.test(datePart)) {
      const y = datePart.slice(0, 4), m = datePart.slice(4, 6), d = datePart.slice(6, 8);
      return `微信图片 ${y}-${m}-${d}`;
    }
  }
  if (/^\d{14,17}/.test(nameWithoutExt)) {
    const y = nameWithoutExt.slice(0, 4), m = nameWithoutExt.slice(4, 6),
          d = nameWithoutExt.slice(6, 8), h = nameWithoutExt.slice(8, 10),
          min = nameWithoutExt.slice(10, 12), s = nameWithoutExt.slice(12, 14);
    return `作品 ${y}-${m}-${d} ${h}:${min}:${s}`;
  }
  return nameWithoutExt || `作品 ${index + 1}`;
}

// ============================================================
//  🔐 管理员认证
// ============================================================
function checkAdminAuth() {
  try {
    const auth = sessionStorage.getItem(AUTH_KEY) || localStorage.getItem(AUTH_KEY);
    if (auth === 'true') {
      isAdmin = true;
      showAdminUI();
    }
  } catch (e) { isAdmin = false; }
}

function showAdminUI() {
  adminBar.style.display = 'flex';
  adminBarUser.textContent = '👤 管理员';
  lightboxEditBtn.style.display = '';
  adminEntryBtn.textContent = '🔐 退出';
  adminEntryBtn.classList.add('admin-logged-in');
  if (adminMusicControls) adminMusicControls.style.display = 'flex';
  updateSyncStatusUI();
  if (syncStatusBadge) syncStatusBadge.style.display = '';
  if (adminSyncNowBtn) adminSyncNowBtn.style.display = '';
  if (adminTokenBtn) adminTokenBtn.style.display = '';
  // Add admin-mode class to body for drag styling
  document.body.classList.add('admin-mode');
  if (typeof GitHubSync !== 'undefined' && GitHubSync.isConfigured()) {
    GitHubSync.tryAutoSyncFromGitHub().then(result => {
      if (result.synced) {
        console.log('GitHubSync: 检测到远端更新，刷新页面');
        location.reload();
      }
    }).catch(() => {});
  }
}

function hideAdminUI() {
  adminBar.style.display = 'none';
  adminBarUser.textContent = '';
  lightboxEditBtn.style.display = 'none';
  adminEntryBtn.textContent = '🔐 管理';
  adminEntryBtn.classList.remove('admin-logged-in');
  if (adminMusicControls) adminMusicControls.style.display = 'none';
  if (syncStatusBadge) syncStatusBadge.style.display = 'none';
  if (adminSyncNowBtn) adminSyncNowBtn.style.display = 'none';
  if (adminTokenBtn) adminTokenBtn.style.display = 'none';
  document.body.classList.remove('admin-mode');
}

async function doLogin(username, password) {
  const ok = await verifyAdminCredentials(username, password);
  if (ok) {
    isAdmin = true;
    sessionStorage.setItem(AUTH_KEY, 'true');
    localStorage.setItem(AUTH_KEY, 'true');
    showAdminUI();
    closeLoginModal();
    renderGallery();
  }
  return ok;
}

function doLogout() {
  isAdmin = false;
  sessionStorage.removeItem(AUTH_KEY);
  localStorage.removeItem(AUTH_KEY);
  hideAdminUI();
  renderGallery();
}

// ===== DOM 引用 =====
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

const galleryContainer = $('#galleryContainer');
const emptyState = $('#emptyState');
const imageCount = $('#imageCount');
const categoryNavList = $('#categoryNavList');
const searchInput = $('#searchInput');
const sortSelect = $('#sortSelect');
const layoutToggle = $('#layoutToggle');
const slideshowButton = $('#slideshowButton');
const audioPlayer = $('#audioPlayer');
const folderButton = $('#folderButton');
const folderInput = $('#folderInput');
const canvas = $('#particleCanvas');
const ctx = canvas.getContext('2d');
const sakuraCanvas = $('#sakuraCanvas');
const sakuraCtx = sakuraCanvas.getContext('2d');

const adminEntryBtn = $('#adminEntryBtn');
const adminBar = $('#adminBar');
const adminBarUser = $('#adminBarUser');
const adminAddBtn = $('#adminAddBtn');
const adminLogoutBtn = $('#adminLogoutBtn');

const syncStatusBadge = $('#syncStatusBadge');
const adminSyncNowBtn = $('#adminSyncNowBtn');
const adminTokenBtn = $('#adminTokenBtn');

const adminMusicControls = $('#adminMusicControls');
const adminMusicPlayBtn = $('#adminMusicPlayBtn');
const adminMusicSelect = $('#adminMusicSelect');
const adminMusicVolume = $('#adminMusicVolume');
const adminMusicTrackInfo = $('#adminMusicTrackInfo');

const musicMgmtModal = $('#musicMgmtModal');
const musicMgmtClose = $('#musicMgmtClose');
const adminMusicMgmtBtn = $('#adminMusicMgmtBtn');
const musicFileInput = $('#musicFileInput');
const musicFilenameInput = $('#musicFilenameInput');
const musicAddBtn = $('#musicAddBtn');
const musicAddError = $('#musicAddError');
const musicTrackList = $('#musicTrackList');
const musicTrackCount = $('#musicTrackCount');

const tokenModal = $('#tokenModal');
const tokenModalClose = $('#tokenModalClose');
const tokenInput = $('#tokenInput');
const tokenToggleVisibility = $('#tokenToggleVisibility');
const tokenSaveBtn = $('#tokenSaveBtn');
const tokenClearBtn = $('#tokenClearBtn');
const tokenError = $('#tokenError');
const tokenSuccess = $('#tokenSuccess');
const tokenStatusValue = $('#tokenStatusValue');

const loginModal = $('#loginModal');
const loginForm = $('#loginForm');
const loginUsername = $('#loginUsername');
const loginPassword = $('#loginPassword');
const loginError = $('#loginError');
const loginModalClose = $('#loginModalClose');

const editModal = $('#editModal');
const editForm = $('#editForm');
const editFilename = $('#editFilename');
const editTitle = $('#editTitle');
const editNote = $('#editNote');
const editCategory = $('#editCategory');
const editSuccess = $('#editSuccess');
const editDeleteBtn = $('#editDeleteBtn');
const editModalClose = $('#editModalClose');

const addModal = $('#addModal');
const addForm = $('#addForm');
const addImageFile = $('#addImageFile');
const addFilename = $('#addFilename');
const addTitle = $('#addTitle');
const addNote = $('#addNote');
const addCategory = $('#addCategory');
const addError = $('#addError');
const addSuccess = $('#addSuccess');
const addModalClose = $('#addModalClose');

const deleteConfirmModal = $('#deleteConfirmModal');
const deleteConfirmText = $('#deleteConfirmText');
const deleteCancelBtn = $('#deleteCancelBtn');
const deleteConfirmBtn = $('#deleteConfirmBtn');

const lightbox = $('#lightbox');
const lightboxImage = $('#lightboxImage');
const lightboxLoader = $('#lightboxLoader');
const lightboxClose = $('#lightboxClose');
const lightboxPrev = $('#lightboxPrev');
const lightboxNext = $('#lightboxNext');
const lightboxImageArea = $('#lightboxImageArea');
const lightboxCounter = $('#lightboxCounter');
const lightboxTitle = $('#lightboxTitle');
const lightboxCategoryBadge = $('#lightboxCategoryBadge');
const lightboxNote = $('#lightboxNote');
const lightboxMemoryTitle = $('#lightboxMemoryTitle');
const lightboxEditBtn = $('#lightboxEditBtn');
const lightboxZoomIn = $('#lightboxZoomIn');
const lightboxZoomOut = $('#lightboxZoomOut');
const lightboxZoomReset = $('#lightboxZoomReset');
const slideshowBar = $('#slideshowBar');
const slideshowProgress = $('#slideshowProgress');

// ===== 状态 =====
let imageSources = [];
let currentObjectURLs = [];
let isAdmin = false;
let deletePendingFilename = null;
let lightboxIndex = -1;
let lightboxScale = 1;
let lightboxTranslate = { x: 0, y: 0 };
let isDragging = false;
let dragStart = { x: 0, y: 0 };
let slideshowTimer = null;
let slideshowInterval = 4000;
let isSlideshowActive = false;
let isWaterfallLayout = false;
let filterTerm = '';
let sortMode = 'default';
let searchDebounceTimer = null;
let preloadCache = new Map();

// ===== 音乐 =====
let musicTracks = buildMusicFromManifest();
let currentTrackIndex = 0;

function refreshMusicTracks() {
  musicTracks = buildMusicFromManifest();
  if (currentTrackIndex >= musicTracks.length) currentTrackIndex = 0;
  renderMusicTrackList();
  if (adminMusicSelect) populateAdminMusicSelect();
}

// ============================================================
//  🎵 音乐
// ============================================================

function setTrack(file) {
  if (!file) return;
  audioPlayer.src = file;
  audioPlayer.load();
  const track = musicTracks.find(t => t.file === file);
  if (track) {
    audioPlayer.volume = parseFloat(adminMusicVolume?.value || 45) / 100;
    if (adminMusicTrackInfo) adminMusicTrackInfo.textContent = `🎵 ${track.name}`;
  }
}

function initBackgroundMusic() {
  if (musicTracks.length === 0) return;

  const savedVol = safeGetStorage('gallery_bg_volume');
  if (savedVol !== null) {
    const vol = Math.max(0, Math.min(100, parseInt(savedVol) || 45));
    audioPlayer.volume = vol / 100;
    if (adminMusicVolume) adminMusicVolume.value = vol;
  } else {
    audioPlayer.volume = 0.45;
    if (adminMusicVolume) adminMusicVolume.value = 45;
  }

  const savedTrack = safeGetStorage('gallery_bg_track');
  if (savedTrack) {
    const idx = musicTracks.findIndex(t => t.file === savedTrack);
    if (idx >= 0) { currentTrackIndex = idx; setTrack(musicTracks[idx].file); }
    else { setTrack(musicTracks[0]?.file || ''); }
  } else {
    setTrack(musicTracks[0]?.file || '');
  }

  const tryAutoPlay = () => {
    if (!audioPlayer.src || audioPlayer.src === window.location.href) {
      setTrack(musicTracks[0]?.file || '');
    }
    audioPlayer.play().catch(() => {
      const resume = () => {
        audioPlayer.play().catch(() => {});
        document.removeEventListener('click', resume);
        document.removeEventListener('keydown', resume);
        document.removeEventListener('touchstart', resume);
      };
      document.addEventListener('click', resume, { once: true });
      document.addEventListener('keydown', resume, { once: true });
      document.addEventListener('touchstart', resume, { once: true });
    });
  };

  setTimeout(tryAutoPlay, 500);

  audioPlayer.addEventListener('ended', () => {
    audioPlayer.currentTime = 0;
    audioPlayer.play().catch(() => {});
  });
}

function initAdminMusicControls() {
  if (!adminMusicPlayBtn || !adminMusicVolume) return;
  adminMusicVolume.value = Math.round(audioPlayer.volume * 100);
  populateAdminMusicSelect();

  if (adminMusicSelect) {
    adminMusicSelect.addEventListener('change', () => {
      const file = adminMusicSelect.value;
      if (file) { setTrack(file); safeSetStorage('gallery_bg_track', file); audioPlayer.play().catch(() => {}); }
    });
  }

  let isPlaying = !audioPlayer.paused;
  const updatePlayBtn = () => { adminMusicPlayBtn.textContent = isPlaying ? '⏸' : '▶'; };
  updatePlayBtn();

  adminMusicPlayBtn.addEventListener('click', () => {
    if (isPlaying) { audioPlayer.pause(); isPlaying = false; }
    else {
      if (!audioPlayer.src || audioPlayer.src === window.location.href) setTrack(musicTracks[0]?.file || '');
      audioPlayer.play().catch(() => {}); isPlaying = true;
    }
    updatePlayBtn();
  });

  audioPlayer.addEventListener('play', () => { isPlaying = true; updatePlayBtn(); });
  audioPlayer.addEventListener('pause', () => { isPlaying = false; updatePlayBtn(); });

  adminMusicVolume.addEventListener('input', () => {
    const vol = parseInt(adminMusicVolume.value) / 100;
    audioPlayer.volume = vol;
    safeSetStorage('gallery_bg_volume', adminMusicVolume.value);
  });

  if (musicTracks.length > 1) {
    adminMusicPlayBtn.addEventListener('dblclick', () => {
      currentTrackIndex = (currentTrackIndex + 1) % musicTracks.length;
      const track = musicTracks[currentTrackIndex];
      setTrack(track.file); safeSetStorage('gallery_bg_track', track.file);
      audioPlayer.play().catch(() => {}); isPlaying = true;
      if (adminMusicSelect) adminMusicSelect.value = track.file;
      updatePlayBtn();
    });
    adminMusicPlayBtn.title = '单击播放/暂停，双击切换曲目';
  }
}

function populateAdminMusicSelect() {
  if (!adminMusicSelect) return;
  adminMusicSelect.innerHTML = '';
  musicTracks.forEach(t => {
    const opt = document.createElement('option');
    opt.value = t.file;
    opt.textContent = t.name || t.file;
    adminMusicSelect.appendChild(opt);
  });
  const saved = safeGetStorage('gallery_bg_track');
  if (saved) { const found = Array.from(adminMusicSelect.options).find(o => o.value === saved); if (found) adminMusicSelect.value = saved; }
  else if (musicTracks.length > 0 && musicTracks[currentTrackIndex]) adminMusicSelect.value = musicTracks[currentTrackIndex].file;
}

function renderMusicTrackList() {
  if (!musicTrackList || !musicTrackCount) return;
  musicTrackList.innerHTML = '';
  musicTrackCount.textContent = `${musicTracks.length} 首`;

  if (musicTracks.length === 0) {
    musicTrackList.innerHTML = '<p style="text-align:center;color:var(--muted);padding:20px;">暂无曲目</p>';
    return;
  }

  musicTracks.forEach((track, idx) => {
    const item = document.createElement('div');
    item.className = 'music-track-item';
    if (idx === currentTrackIndex) item.classList.add('active');

    const icon = document.createElement('span');
    icon.className = 'music-track-item-icon';
    icon.textContent = idx === currentTrackIndex ? '▶️' : '🎵';

    const name = document.createElement('span');
    name.className = 'music-track-item-name';
    name.textContent = sanitizeText(track.name || track.file, 100);

    const badge = document.createElement('span');
    badge.className = 'music-track-item-badge';
    const isManifest = MANIFEST && MANIFEST.music && MANIFEST.music.some(m => m.file === track.file);
    badge.textContent = isManifest ? '内置' : '自定义';

    const actions = document.createElement('div');
    actions.className = 'music-track-item-actions';

    const playBtn = document.createElement('button');
    playBtn.className = 'music-track-item-btn play-btn';
    playBtn.textContent = '▶';
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      currentTrackIndex = idx; setTrack(track.file);
      safeSetStorage('gallery_bg_track', track.file); audioPlayer.play().catch(() => {});
      if (adminMusicSelect) adminMusicSelect.value = track.file;
      renderMusicTrackList();
    });

    if (!isManifest) {
      const delBtn = document.createElement('button');
      delBtn.className = 'music-track-item-btn delete-btn';
      delBtn.textContent = '🗑';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const customTracks = getCustomMusicTracks();
        const updated = customTracks.filter(t => t.file !== track.file);
        saveCustomMusicTracks(updated);
        refreshMusicTracks();
        if (currentTrackIndex >= musicTracks.length) currentTrackIndex = 0;
        if (musicTracks.length > 0) { setTrack(musicTracks[0].file); safeSetStorage('gallery_bg_track', musicTracks[0].file); audioPlayer.play().catch(() => {}); }
        else { audioPlayer.pause(); audioPlayer.src = ''; }
        scheduleGitHubSync();
      });
      actions.appendChild(delBtn);
    }

    actions.appendChild(playBtn);
    item.appendChild(icon);
    item.appendChild(name);
    item.appendChild(badge);
    item.appendChild(actions);
    musicTrackList.appendChild(item);
  });
}

function initMusicManagement() {
  if (!musicMgmtModal || !adminMusicMgmtBtn) return;

  adminMusicMgmtBtn.addEventListener('click', () => {
    musicFileInput.value = ''; musicFilenameInput.value = '';
    if (musicAddError) musicAddError.style.display = 'none';
    renderMusicTrackList();
    musicMgmtModal.classList.add('active'); musicMgmtModal.setAttribute('aria-hidden', 'false');
  });

  musicMgmtClose.addEventListener('click', () => { musicMgmtModal.classList.remove('active'); musicMgmtModal.setAttribute('aria-hidden', 'true'); });
  musicMgmtModal.addEventListener('click', (e) => { if (e.target === musicMgmtModal) { musicMgmtModal.classList.remove('active'); musicMgmtModal.setAttribute('aria-hidden', 'true'); } });

  musicAddBtn.addEventListener('click', () => {
    if (musicAddError) musicAddError.style.display = 'none';
    const file = musicFileInput.files[0];
    const manualName = sanitizeFilename(musicFilenameInput.value.trim());

    if (file) {
      if (!/^audio\//.test(file.type) && !file.name.match(/\.(mp3|flac|wav|ogg|m4a|aac|wma)$/i)) {
        if (musicAddError) { musicAddError.textContent = '请选择有效的音频文件'; musicAddError.style.display = 'block'; } return;
      }
      const filename = sanitizeFilename(file.name);
      if (musicTracks.some(t => t.file === filename)) { if (musicAddError) { musicAddError.textContent = '同名曲目已存在'; musicAddError.style.display = 'block'; } return; }
      const objectURL = URL.createObjectURL(file);
      const customTracks = getCustomMusicTracks();
      const displayName = file.name.replace(/\.[^.]+$/, '');
      customTracks.push({ name: displayName, file: filename, objectURL });
      saveCustomMusicTracks(customTracks);
      refreshMusicTracks(); musicFileInput.value = '';
      currentTrackIndex = musicTracks.findIndex(t => t.file === filename);
      if (currentTrackIndex >= 0 && objectURL) setTrack(objectURL);
      safeSetStorage('gallery_bg_track', filename);
      scheduleGitHubSync();
    } else if (manualName) {
      if (!manualName.match(/\.(mp3|flac|wav|ogg|m4a|aac|wma)$/i)) { if (musicAddError) { musicAddError.textContent = '文件名需以音频扩展名结尾'; musicAddError.style.display = 'block'; } return; }
      if (musicTracks.some(t => t.file === manualName)) { if (musicAddError) { musicAddError.textContent = '同名曲目已存在'; musicAddError.style.display = 'block'; } return; }
      const customTracks = getCustomMusicTracks();
      customTracks.push({ name: manualName.replace(/\.[^.]+$/, ''), file: manualName });
      saveCustomMusicTracks(customTracks);
      refreshMusicTracks(); musicFilenameInput.value = '';
      currentTrackIndex = musicTracks.findIndex(t => t.file === manualName);
      if (currentTrackIndex >= 0) setTrack(manualName);
      safeSetStorage('gallery_bg_track', manualName); audioPlayer.play().catch(() => {});
      scheduleGitHubSync();
    } else {
      if (musicAddError) { musicAddError.textContent = '请选择音频文件或输入文件名'; musicAddError.style.display = 'block'; }
    }
  });
}

// ============================================================
//  🔑 Token 管理
// ============================================================

function updateTokenStatusUI() {
  if (!tokenStatusValue) return;
  if (typeof GitHubSync !== 'undefined' && GitHubSync.isConfigured()) {
    const token = localStorage.getItem('gallery_github_sync');
    if (token) {
      const masked = token.substring(0, 20) + '...' + token.substring(token.length - 8);
      tokenStatusValue.textContent = '✅ 已配置'; tokenStatusValue.title = masked;
      tokenStatusValue.className = 'token-status-value configured';
      tokenInput.placeholder = masked;
    }
  } else {
    tokenStatusValue.textContent = '❌ 未配置';
    tokenStatusValue.className = 'token-status-value unconfigured';
    tokenInput.placeholder = '输入 GitHub PAT（github_pat_ 开头）...';
  }
}

function openTokenModal() {
  if (!tokenModal) return;
  tokenInput.value = ''; tokenError.style.display = 'none'; tokenSuccess.style.display = 'none';
  tokenInput.type = 'password';
  if (tokenToggleVisibility) tokenToggleVisibility.textContent = '👁';
  updateTokenStatusUI();
  tokenModal.classList.add('active'); tokenModal.setAttribute('aria-hidden', 'false');
  setTimeout(() => tokenInput.focus(), 100);
}

function closeTokenModal() {
  if (!tokenModal) return;
  tokenModal.classList.remove('active'); tokenModal.setAttribute('aria-hidden', 'true'); tokenInput.value = '';
}

function saveToken() {
  if (!tokenInput || !tokenError || !tokenSuccess) return;
  tokenError.style.display = 'none'; tokenSuccess.style.display = 'none';
  const token = (tokenInput.value || '').trim();
  if (!token) { tokenError.textContent = '请输入 Token'; tokenError.style.display = 'block'; return; }
  if (!token.startsWith('github_pat_')) { tokenError.textContent = 'Token 必须以 github_pat_ 开头'; tokenError.style.display = 'block'; return; }
  if (token.length < 40) { tokenError.textContent = 'Token 长度不足'; tokenError.style.display = 'block'; return; }
  try {
    localStorage.setItem('gallery_github_sync', token);
    tokenSuccess.textContent = '✅ Token 已保存！'; tokenSuccess.style.display = 'block';
    tokenInput.value = ''; updateTokenStatusUI();
    if (isAdmin) updateSyncStatusUI();
    setTimeout(() => { closeTokenModal(); tokenSuccess.style.display = 'none'; }, 2000);
  } catch (e) { tokenError.textContent = '保存失败：' + e.message; tokenError.style.display = 'block'; }
}

function clearToken() {
  if (!confirm('确定要清除 GitHub Token 吗？')) return;
  localStorage.removeItem('gallery_github_sync');
  localStorage.removeItem('gallery_github_sync_status');
  tokenInput.value = ''; updateTokenStatusUI();
  if (tokenSuccess) { tokenSuccess.textContent = '🗑 Token 已清除'; tokenSuccess.style.display = 'block'; }
  if (isAdmin) updateSyncStatusUI();
  setTimeout(() => { closeTokenModal(); if (tokenSuccess) tokenSuccess.style.display = 'none'; }, 1500);
}

function initTokenManagement() {
  if (!tokenModal || !adminTokenBtn) return;
  adminTokenBtn.addEventListener('click', openTokenModal);
  tokenModalClose.addEventListener('click', closeTokenModal);
  tokenModal.addEventListener('click', (e) => { if (e.target === tokenModal) closeTokenModal(); });
  tokenSaveBtn.addEventListener('click', saveToken);
  tokenClearBtn.addEventListener('click', clearToken);
  if (tokenToggleVisibility) {
    tokenToggleVisibility.addEventListener('click', () => {
      if (tokenInput.type === 'password') { tokenInput.type = 'text'; tokenToggleVisibility.textContent = '🙈'; }
      else { tokenInput.type = 'password'; tokenToggleVisibility.textContent = '👁'; }
    });
  }
  tokenInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveToken(); } });
}

// ============================================================
//  🔄 GitHub 同步
// ============================================================

function buildManifestForSync() {
  if (!MANIFEST) return null;
  const manifest = JSON.parse(JSON.stringify(MANIFEST));
  const worksData = loadWorksData();
  const orderData = loadOrderData();

  if (manifest.images && Array.isArray(manifest.images)) {
    manifest.images = manifest.images.map(img => {
      const saved = worksData[img.name];
      if (saved) {
        return { ...img, overrides: { title: saved.title || img.name, category: (typeof saved.category === 'number' && saved.category >= 1 && saved.category <= 5) ? saved.category : img.category, note: saved.note || '', hidden: saved.hidden || false } };
      }
      return img;
    });
  }

  const customTracks = getCustomMusicTracks();
  if (Array.isArray(customTracks) && customTracks.length > 0) {
    const existingFiles = new Set((manifest.music || []).map(m => m.file));
    const extra = customTracks.filter(t => t && t.name && t.file && !existingFiles.has(t.file)).map(t => ({ name: t.name, file: t.file, source: 'admin' }));
    manifest.music = [...(manifest.music || []), ...extra];
  }

  // Include order data
  if (Object.keys(orderData).length > 0) {
    manifest.imageOrder = orderData;
  }

  manifest.generated = new Date().toISOString();
  manifest.totalImages = manifest.images ? manifest.images.filter(i => !(i.overrides && i.overrides.hidden)).length : 0;
  return manifest;
}

function updateSyncStatusUI() {
  if (!syncStatusBadge) return;
  if (typeof GitHubSync === 'undefined') { syncStatusBadge.innerHTML = '⚙️ 同步模块未加载'; syncStatusBadge.style.color = '#8b7a6b'; return; }
  if (!GitHubSync.isConfigured()) { syncStatusBadge.innerHTML = '⚠️ Token 未配置'; syncStatusBadge.style.color = '#e8986e'; return; }
  const status = GitHubSync.getSyncStatus();
  switch (status.status) {
    case 'pushing': syncStatusBadge.innerHTML = '⏳ 同步中...'; syncStatusBadge.style.color = '#d4a853'; break;
    case 'pending': syncStatusBadge.innerHTML = '⏳ 等待同步'; syncStatusBadge.style.color = '#d4a853'; break;
    case 'error': syncStatusBadge.innerHTML = '❌ 同步失败'; syncStatusBadge.style.color = '#e07070'; syncStatusBadge.title = status.lastPushError || ''; break;
    default: syncStatusBadge.innerHTML = '✅ 已同步'; syncStatusBadge.style.color = '#7cb89c'; break;
  }
}

function scheduleGitHubSync() {
  const manifest = buildManifestForSync();
  if (!manifest) return;
  if (typeof GitHubSync === 'undefined' || !GitHubSync.isConfigured()) { updateSyncStatusUI(); return; }
  GitHubSync.schedulePushUpdate(manifest, { force: true });
  updateSyncStatusUI();
  setTimeout(updateSyncStatusUI, 35000);
}

setInterval(() => {
  if (isAdmin && syncStatusBadge && syncStatusBadge.style.display !== 'none') updateSyncStatusUI();
}, 15000);

// ============================================================
//  🖼 画廊渲染
// ============================================================

function buildImageSources() {
  if (imageSources.length === 0) {
    imageSources = buildDefaultImagesFromManifest();
    applyWorksDataToSources();
    const worksData = loadWorksData();
    imageSources = imageSources.filter(s => {
      const saved = worksData[s.name];
      const ov = s.overrides;
      return !(saved && saved.hidden) && !(ov && ov.hidden);
    });
  }
}

function getImageDisplayList() {
  let list = [...imageSources];

  if (filterTerm.trim()) {
    const term = filterTerm.trim().toLowerCase();
    list = list.filter(item =>
      item.name.toLowerCase().includes(term) ||
      (item.title || '').toLowerCase().includes(term) ||
      (item.note || '').toLowerCase().includes(term)
    );
  }

  switch (sortMode) {
    case 'name-asc': list.sort((a, b) => a.name.localeCompare(b.name, 'zh')); break;
    case 'name-desc': list.sort((a, b) => b.name.localeCompare(a.name, 'zh')); break;
    case 'date-desc': list.sort((a, b) => (b.mtime || 0) - (a.mtime || 0)); break;
    case 'date-asc': list.sort((a, b) => (a.mtime || 0) - (b.mtime || 0)); break;
    default: break;
  }

  return list;
}

// ===== Apply saved order within each category =====
function applyOrderToCategory(catImages, catId) {
  const orderData = loadOrderData();
  const catOrder = orderData[catId];
  if (!catOrder || !Array.isArray(catOrder)) return catImages;

  const orderMap = new Map(catOrder.map((name, idx) => [name, idx]));
  return [...catImages].sort((a, b) => {
    const ai = orderMap.has(a.name) ? orderMap.get(a.name) : 9999;
    const bi = orderMap.has(b.name) ? orderMap.get(b.name) : 9999;
    return ai - bi;
  });
}

function buildCategoryNav(displayList) {
  if (!categoryNavList) return;
  categoryNavList.innerHTML = '';
  categories.forEach(cat => {
    const catImages = displayList.filter(s => (s.category || 5) === cat.id);
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'category-nav-link';
    btn.innerHTML = `<span class="nav-icon">${cat.icon}</span> ${escapeHtml(cat.name)} <span class="nav-count">(${catImages.length})</span>`;
    btn.addEventListener('click', () => {
      const section = document.getElementById(`category-${cat.id}`);
      if (section) {
        const offset = 140;
        const top = section.getBoundingClientRect().top + window.pageYOffset - offset;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
    li.appendChild(btn);
    categoryNavList.appendChild(li);
  });
}

let navScrollTicking = false;
function updateActiveNavOnScroll() {
  const sections = categories.map(cat => document.getElementById(`category-${cat.id}`)).filter(Boolean);
  const navLinks = $$('.category-nav-link');
  if (sections.length === 0 || navLinks.length === 0) return;
  let activeIdx = 0;
  const viewTop = window.pageYOffset + 150;
  sections.forEach((section, i) => { if (section.getBoundingClientRect().top + window.pageYOffset <= viewTop) activeIdx = i; });
  navLinks.forEach((link, i) => link.classList.toggle('active', i === activeIdx));
}
window.addEventListener('scroll', () => { if (!navScrollTicking) { requestAnimationFrame(() => { updateActiveNavOnScroll(); navScrollTicking = false; }); navScrollTicking = true; } }, { passive: true });

function renderGallery() {
  galleryContainer.innerHTML = '';
  const displayList = getImageDisplayList();

  if (displayList.length === 0) {
    emptyState.style.display = 'block'; imageCount.textContent = ''; buildCategoryNav(displayList); return;
  }

  emptyState.style.display = 'none';
  imageCount.textContent = `共 ${displayList.length} 张`;
  buildCategoryNav(displayList);

  categories.forEach(cat => {
    let catImages = displayList.filter(s => (s.category || 5) === cat.id);

    // Apply saved order if sort mode is default
    if (sortMode === 'default') {
      catImages = applyOrderToCategory(catImages, cat.id);
    }

    const section = document.createElement('section');
    section.className = 'category-section';
    section.id = `category-${cat.id}`;

    const header = document.createElement('div');
    header.className = 'category-header';
    header.innerHTML = `
      <span class="category-header-icon">${cat.icon}</span>
      <div class="category-header-text"><h3>${escapeHtml(cat.name)}</h3><p>${escapeHtml(cat.desc)}</p></div>
      <span class="category-header-count">${catImages.length} 张</span>
    `;
    header.style.cursor = 'pointer';
    header.title = '点击折叠/展开';
    header.addEventListener('click', () => {
      const grid = section.querySelector('.gallery-grid');
      if (grid) { const collapsed = grid.style.display === 'none'; grid.style.display = collapsed ? '' : 'none'; header.style.opacity = collapsed ? '1' : '0.6'; }
    });
    section.appendChild(header);

    if (catImages.length > 0) {
      const grid = document.createElement('div');
      grid.className = 'gallery-grid';
      grid.dataset.categoryId = cat.id;
      if (isWaterfallLayout) grid.classList.add('waterfall');
      section.appendChild(grid);
      renderCards(catImages, grid);
    } else {
      const emptyCard = document.createElement('div');
      emptyCard.className = 'category-empty-card';
      emptyCard.innerHTML = `<span class="category-empty-icon">📭</span><p class="category-empty-text">暂无作品</p>`;
      section.appendChild(emptyCard);
    }

    galleryContainer.appendChild(section);
  });

  if (window.requestIdleCallback) {
    requestIdleCallback(() => { observeCards(); updateWaterfallHeights(); });
  } else {
    setTimeout(() => { observeCards(); updateWaterfallHeights(); }, 0);
  }

  syncToStorage();

  // Re-initialize drag if admin
  if (isAdmin) initDragToReorder();
}

function renderCards(cardList, container) {
  const fragment = document.createDocumentFragment();
  cardList.forEach(item => {
    const idx = imageSources.findIndex(s => s.name === item.name && s.src === item.src);
    const card = createGalleryCard(item, idx >= 0 ? idx : 0);
    fragment.appendChild(card);
  });
  container.appendChild(fragment);
}

function createGalleryCard(item, index) {
  const card = document.createElement('article');
  card.className = 'gallery-card';
  card.dataset.index = index;
  card.dataset.src = item.src;
  card.dataset.name = item.name;
  card.style.setProperty('--parallax', '0px');
  card.style.setProperty('--card-bg', `url('${item.src.replace(/'/g, "\\'")}')`);

  const skeleton = document.createElement('div');
  skeleton.className = 'gallery-card-skeleton';
  card.appendChild(skeleton);

  const errorOverlay = document.createElement('div');
  errorOverlay.className = 'gallery-card-error';
  errorOverlay.innerHTML = '<span>🖼</span><p>图片加载失败</p>';
  card.appendChild(errorOverlay);

  if (isAdmin) {
    const actions = document.createElement('div');
    actions.className = 'card-admin-actions';
    const editBtn = document.createElement('button');
    editBtn.className = 'card-admin-btn card-admin-edit'; editBtn.title = '编辑'; editBtn.textContent = '✏️';
    editBtn.addEventListener('click', (e) => { e.stopPropagation(); e.preventDefault(); openEditModal(item.name); });
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'card-admin-btn card-admin-delete'; deleteBtn.title = '删除'; deleteBtn.textContent = '🗑';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation(); e.preventDefault();
      deletePendingFilename = item.name;
      deleteConfirmText.textContent = `确定要删除 「${sanitizeText(item.title || item.name, 200)}」 吗？`;
      deleteConfirmModal.classList.add('active'); deleteConfirmModal.setAttribute('aria-hidden', 'false');
    });
    actions.appendChild(editBtn); actions.appendChild(deleteBtn);
    card.appendChild(actions);

    // Drag hint for admin
    const dragHint = document.createElement('span');
    dragHint.className = 'card-drag-hint';
    dragHint.textContent = '⠿';
    dragHint.title = '长按拖动排序';
    card.appendChild(dragHint);
  }

  const cat = categories.find(c => c.id === (item.category || 5));
  if (cat && !filterTerm.trim()) {
    const catBadge = document.createElement('span');
    catBadge.className = 'gallery-card-category'; catBadge.textContent = cat.icon; catBadge.title = cat.name;
    card.appendChild(catBadge);
  }

  const label = document.createElement('span');
  label.className = 'gallery-card-label';
  label.textContent = sanitizeText(item.title || `作品 ${index + 1}`, 200);
  card.appendChild(label);

  const overlay = document.createElement('div');
  overlay.className = 'gallery-card-overlay';
  card.appendChild(overlay);

  card.addEventListener('click', (e) => {
    if (e.target.closest('.card-admin-actions')) return;
    if (card.classList.contains('drag-active')) return;
    const realIndex = imageSources.findIndex(s => s.src === item.src && s.name === item.name);
    if (realIndex >= 0) {
      syncToStorage();
      window.open(`detail.html?index=${realIndex}`, '_blank', 'noopener,noreferrer');
    }
  });

  return card;
}

// ============================================================
//  🎯 管理员拖拽排序（长按 500ms 触发）
// ============================================================

let dragState = {
  active: false,
  longPressTimer: null,
  sourceCard: null,
  ghostEl: null,
  sourceGrid: null,
  sourceCatId: null,
  startX: 0,
  startY: 0,
  offsetX: 0,
  offsetY: 0,
  placeholder: null,
};

const LONG_PRESS_DURATION = 500; // ms

function initDragToReorder() {
  // Attach mousedown listeners to all gallery cards
  const cards = $$('.gallery-card');
  cards.forEach(card => {
    card.addEventListener('mousedown', onCardMouseDown);
    card.addEventListener('touchstart', onCardTouchStart, { passive: false });
  });
}

function onCardMouseDown(e) {
  if (!isAdmin) return;
  if (e.button !== 0) return; // Only left click
  if (e.target.closest('.card-admin-actions')) return; // Don't drag from action buttons

  const card = e.currentTarget;
  const grid = card.closest('.gallery-grid');
  if (!grid) return;

  dragState.startX = e.clientX;
  dragState.startY = e.clientY;
  dragState.sourceCard = card;
  dragState.sourceGrid = grid;
  dragState.sourceCatId = parseInt(grid.dataset.categoryId);

  // Start long press timer
  dragState.longPressTimer = setTimeout(() => {
    startDrag(card, e.clientX, e.clientY);
  }, LONG_PRESS_DURATION);

  // If mouse moves too much before timer fires, cancel
  const cancelOnMove = (ev) => {
    const dx = Math.abs(ev.clientX - dragState.startX);
    const dy = Math.abs(ev.clientY - dragState.startY);
    if (dx > 8 || dy > 8) {
      clearTimeout(dragState.longPressTimer);
      dragState.longPressTimer = null;
      window.removeEventListener('mousemove', cancelOnMove);
    }
  };

  const cancelOnUp = () => {
    clearTimeout(dragState.longPressTimer);
    dragState.longPressTimer = null;
    window.removeEventListener('mousemove', cancelOnMove);
    window.removeEventListener('mouseup', cancelOnUp);
  };

  window.addEventListener('mousemove', cancelOnMove);
  window.addEventListener('mouseup', cancelOnUp);
}

function onCardTouchStart(e) {
  if (!isAdmin) return;
  if (e.touches.length !== 1) return;
  if (e.target.closest('.card-admin-actions')) return;

  const card = e.currentTarget;
  const grid = card.closest('.gallery-grid');
  if (!grid) return;

  const touch = e.touches[0];
  dragState.startX = touch.clientX;
  dragState.startY = touch.clientY;
  dragState.sourceCard = card;
  dragState.sourceGrid = grid;
  dragState.sourceCatId = parseInt(grid.dataset.categoryId);

  dragState.longPressTimer = setTimeout(() => {
    e.preventDefault();
    startDrag(card, touch.clientX, touch.clientY);
  }, LONG_PRESS_DURATION);

  const cancelOnMove = (ev) => {
    const t = ev.touches[0];
    const dx = Math.abs(t.clientX - dragState.startX);
    const dy = Math.abs(t.clientY - dragState.startY);
    if (dx > 8 || dy > 8) {
      clearTimeout(dragState.longPressTimer);
      dragState.longPressTimer = null;
      card.removeEventListener('touchmove', cancelOnMove);
    }
  };

  const cancelOnEnd = () => {
    clearTimeout(dragState.longPressTimer);
    dragState.longPressTimer = null;
    card.removeEventListener('touchmove', cancelOnMove);
    card.removeEventListener('touchend', cancelOnEnd);
    card.removeEventListener('touchcancel', cancelOnEnd);
  };

  card.addEventListener('touchmove', cancelOnMove, { passive: false });
  card.addEventListener('touchend', cancelOnEnd);
  card.addEventListener('touchcancel', cancelOnEnd);
}

function startDrag(card, clientX, clientY) {
  dragState.active = true;
  card.classList.add('drag-active');
  document.body.classList.add('dragging');

  const rect = card.getBoundingClientRect();
  dragState.offsetX = clientX - rect.left;
  dragState.offsetY = clientY - rect.top;

  // Create ghost element
  const ghost = card.cloneNode(true);
  ghost.classList.add('drag-ghost');
  ghost.style.position = 'fixed';
  ghost.style.width = rect.width + 'px';
  ghost.style.height = rect.height + 'px';
  ghost.style.left = (clientX - dragState.offsetX) + 'px';
  ghost.style.top = (clientY - dragState.offsetY) + 'px';
  ghost.style.zIndex = '9999';
  ghost.style.pointerEvents = 'none';
  ghost.style.opacity = '0.85';
  ghost.style.transform = 'rotate(2deg) scale(1.04)';
  ghost.style.boxShadow = '0 20px 60px rgba(0,0,0,0.25)';
  ghost.style.transition = 'none';
  document.body.appendChild(ghost);
  dragState.ghostEl = ghost;

  // Create placeholder
  const placeholder = document.createElement('div');
  placeholder.className = 'gallery-card drag-placeholder';
  placeholder.style.minHeight = rect.height + 'px';
  card.parentNode.insertBefore(placeholder, card);
  card.style.display = 'none';
  dragState.placeholder = placeholder;

  // Add move/end listeners
  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', onDragEnd);
  window.addEventListener('touchmove', onDragMoveTouch, { passive: false });
  window.addEventListener('touchend', onDragEndTouch);
  window.addEventListener('touchcancel', onDragEndTouch);

  // Haptic feedback on mobile
  if (navigator.vibrate) navigator.vibrate(30);
}

function onDragMove(e) {
  if (!dragState.active) return;
  moveDrag(e.clientX, e.clientY);
}

function onDragMoveTouch(e) {
  if (!dragState.active) return;
  e.preventDefault();
  const touch = e.touches[0];
  moveDrag(touch.clientX, touch.clientY);
}

function moveDrag(clientX, clientY) {
  // Move ghost
  if (dragState.ghostEl) {
    dragState.ghostEl.style.left = (clientX - dragState.offsetX) + 'px';
    dragState.ghostEl.style.top = (clientY - dragState.offsetY) + 'px';
  }

  // Find which card we're over
  const grid = dragState.sourceGrid;
  if (!grid) return;

  const cards = Array.from(grid.querySelectorAll('.gallery-card:not(.drag-placeholder)'));
  let closestCard = null;
  let closestDist = Infinity;
  let insertBefore = true;

  cards.forEach(c => {
    if (c === dragState.sourceCard) return;
    if (c.style.display === 'none') return;
    const rect = c.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const dist = Math.hypot(clientX - centerX, clientY - centerY);
    if (dist < closestDist) {
      closestDist = dist;
      closestCard = c;
      insertBefore = clientX < centerX || (clientX >= centerX && clientY < centerY);
    }
  });

  // Move placeholder
  if (closestCard && dragState.placeholder) {
    if (insertBefore) {
      grid.insertBefore(dragState.placeholder, closestCard);
    } else {
      const next = closestCard.nextElementSibling;
      if (next && next !== dragState.placeholder) {
        grid.insertBefore(dragState.placeholder, next);
      } else if (!next) {
        grid.appendChild(dragState.placeholder);
      }
    }
  }
}

function onDragEnd(e) {
  endDrag();
}

function onDragEndTouch(e) {
  endDrag();
}

function endDrag() {
  if (!dragState.active) return;
  dragState.active = false;

  // Remove event listeners
  window.removeEventListener('mousemove', onDragMove);
  window.removeEventListener('mouseup', onDragEnd);
  window.removeEventListener('touchmove', onDragMoveTouch);
  window.removeEventListener('touchend', onDragEndTouch);
  window.removeEventListener('touchcancel', onDragEndTouch);

  // Remove ghost
  if (dragState.ghostEl) { dragState.ghostEl.remove(); dragState.ghostEl = null; }

  // Place card where placeholder is
  const card = dragState.sourceCard;
  const placeholder = dragState.placeholder;
  const grid = dragState.sourceGrid;

  if (card && placeholder && grid) {
    card.style.display = '';
    card.classList.remove('drag-active');
    grid.insertBefore(card, placeholder);
    placeholder.remove();

    // Save the new order
    saveCurrentOrder(grid, dragState.sourceCatId);
  }

  document.body.classList.remove('dragging');
  dragState.placeholder = null;
  dragState.sourceCard = null;
  dragState.sourceGrid = null;
}

function saveCurrentOrder(grid, catId) {
  if (!grid || !catId) return;
  const cards = Array.from(grid.querySelectorAll('.gallery-card'));
  const nameOrder = cards.map(c => c.dataset.name).filter(Boolean);

  const orderData = loadOrderData();
  orderData[catId] = nameOrder;
  saveOrderData(orderData);

  // Trigger GitHub sync
  scheduleGitHubSync();

  // Show brief toast
  showDragToast('✅ 顺序已保存');
}

function showDragToast(msg) {
  const existing = document.querySelector('.drag-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = 'drag-toast';
  toast.textContent = msg;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));
  setTimeout(() => { toast.classList.remove('show'); setTimeout(() => toast.remove(), 300); }, 1800);
}

// ===== 懒加载 =====
let cardObserver = null;

function observeCards() {
  if (cardObserver) cardObserver.disconnect();
  cardObserver = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const card = entry.target;
        const src = card.dataset.src;
        if (src) {
          const img = new Image();
          img.onload = () => {
            card.classList.add('loaded');
            const skeleton = card.querySelector('.gallery-card-skeleton');
            if (skeleton) skeleton.remove();
            const errOverlay = card.querySelector('.gallery-card-error');
            if (errOverlay) errOverlay.style.display = 'none';
            requestAnimationFrame(() => card.classList.add('entered'));
          };
          img.onerror = () => {
            card.classList.add('loaded', 'entered');
            const skeleton = card.querySelector('.gallery-card-skeleton');
            if (skeleton) skeleton.remove();
            const errOverlay = card.querySelector('.gallery-card-error');
            if (errOverlay) errOverlay.style.display = 'flex';
          };
          img.src = src;
          cardObserver.unobserve(card);
        }
      }
    });
  }, { rootMargin: '200px 0px', threshold: 0.05 });
  $$('.gallery-card').forEach(card => cardObserver.observe(card));
}

function updateWaterfallHeights() {
  if (!isWaterfallLayout) { $$('.gallery-card').forEach(card => { card.style.height = ''; }); return; }
  $$('.gallery-card').forEach((card, i) => { card.style.height = `${260 + (i % 5) * 30}px`; });
}

let parallaxTicking = false;
function updateWaterfallParallax() {
  const cards = $$('.gallery-card');
  const viewHeight = window.innerHeight;
  cards.forEach(card => {
    const rect = card.getBoundingClientRect();
    const diff = (rect.top + rect.height / 2 - viewHeight / 2) / viewHeight;
    card.style.setProperty('--parallax', `${(diff * 40).toFixed(2)}px`);
  });
}
window.addEventListener('scroll', () => { if (!parallaxTicking) { requestAnimationFrame(() => { updateWaterfallParallax(); parallaxTicking = false; }); parallaxTicking = true; } }, { passive: true });

// ============================================================
//  🌟 Lightbox
// ============================================================

function preloadAdjacent(index) {
  for (let i = Math.max(0, index - 2); i <= Math.min(imageSources.length - 1, index + 2); i++) {
    if (i === index) continue;
    const src = imageSources[i].src;
    if (!preloadCache.has(src)) {
      const img = new Image();
      img.onload = () => preloadCache.set(src, true);
      img.onerror = () => preloadCache.set(src, false);
      img.src = src;
    }
  }
}

function openLightbox(index) {
  if (index < 0 || index >= imageSources.length) return;
  lightboxIndex = index;
  const item = imageSources[index];
  lightboxScale = 1; lightboxTranslate = { x: 0, y: 0 }; applyLightboxTransform();
  lightboxLoader.classList.add('loading'); lightboxImage.style.opacity = '0';
  lightboxImage.src = item.src; lightboxImage.alt = sanitizeText(item.name);
  lightboxImage.onload = () => { lightboxLoader.classList.remove('loading'); lightboxImage.style.opacity = '1'; preloadAdjacent(index); };
  lightboxImage.onerror = () => { lightboxLoader.classList.remove('loading'); lightboxImage.style.opacity = '1'; };
  updateLightboxInfo();
  lightbox.classList.add('active'); lightbox.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  document.addEventListener('keydown', handleLightboxKeydown);
  preloadAdjacent(index);
}

function closeLightbox() {
  lightbox.classList.remove('active'); lightbox.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = ''; lightboxIndex = -1;
  lightboxScale = 1; lightboxTranslate = { x: 0, y: 0 };
  document.removeEventListener('keydown', handleLightboxKeydown);
}

function updateLightboxInfo() {
  if (lightboxIndex < 0 || lightboxIndex >= imageSources.length) return;
  const item = imageSources[lightboxIndex];
  lightboxCounter.textContent = `${lightboxIndex + 1} / ${imageSources.length}`;
  lightboxTitle.textContent = sanitizeText(item.title || `作品 ${lightboxIndex + 1}`, 200);

  const cat = categories.find(c => c.id === (item.category || 5));
  if (cat) { lightboxCategoryBadge.textContent = `${cat.icon} ${cat.name}`; lightboxCategoryBadge.style.display = ''; }
  else { lightboxCategoryBadge.style.display = 'none'; }

  // Read latest note from localStorage
  const worksData = getWorksData();
  const saved = worksData[item.name];
  const note = (saved && typeof saved.note === 'string') ? sanitizeText(saved.note, 5000) : sanitizeText(item.note || '', 5000);
  lightboxNote.textContent = note || '✏️ 等待贝贝写下回忆...';
  lightboxMemoryTitle.textContent = note ? '📝 贝贝的回忆' : '📝 贝贝的回忆（待填写）';
  lightboxEditBtn.style.display = isAdmin ? '' : 'none';
}

function navigateLightbox(direction) {
  if (imageSources.length === 0) return;
  lightboxIndex = (lightboxIndex + direction + imageSources.length) % imageSources.length;
  const item = imageSources[lightboxIndex];
  lightboxScale = 1; lightboxTranslate = { x: 0, y: 0 }; applyLightboxTransform();
  lightboxLoader.classList.add('loading'); lightboxImage.style.opacity = '0';
  lightboxImage.src = item.src; lightboxImage.alt = sanitizeText(item.name);
  lightboxImage.onload = () => { lightboxLoader.classList.remove('loading'); lightboxImage.style.opacity = '1'; };
  lightboxImage.onerror = () => { lightboxLoader.classList.remove('loading'); };
  updateLightboxInfo(); preloadAdjacent(lightboxIndex);
}

function handleLightboxKeydown(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  switch (e.key) {
    case 'Escape': closeLightbox(); break;
    case 'ArrowLeft': navigateLightbox(-1); break;
    case 'ArrowRight': navigateLightbox(1); break;
    case '+': case '=': zoomLightbox(0.2); break;
    case '-': zoomLightbox(-0.2); break;
    case '0': lightboxScale = 1; lightboxTranslate = { x: 0, y: 0 }; applyLightboxTransform(); break;
    case 'f': case 'F':
      if (document.fullscreenElement) document.exitFullscreen();
      else lightboxImageArea.requestFullscreen().catch(() => {});
      break;
  }
}

// Touch swipe in lightbox
let touchStartX = 0, touchMoved = false;
lightboxImageArea.addEventListener('touchstart', (e) => {
  if (e.touches.length === 1 && lightboxScale <= 1) { touchStartX = e.touches[0].clientX; touchMoved = false; }
}, { passive: true });
lightboxImageArea.addEventListener('touchmove', (e) => {
  if (e.touches.length === 1 && lightboxScale <= 1) { if (Math.abs(e.touches[0].clientX - touchStartX) > 20) touchMoved = true; }
}, { passive: true });
lightboxImageArea.addEventListener('touchend', (e) => {
  if (!touchMoved || lightboxScale > 1) return;
  const dx = (e.changedTouches[0]?.clientX || 0) - touchStartX;
  if (Math.abs(dx) > 50) navigateLightbox(dx > 0 ? -1 : 1);
});

function zoomLightbox(delta) {
  lightboxScale = Math.max(0.3, Math.min(5, lightboxScale + delta));
  if (lightboxScale <= 0.35) lightboxTranslate = { x: 0, y: 0 };
  applyLightboxTransform();
}

function applyLightboxTransform() {
  lightboxImage.style.transform = `translate(${lightboxTranslate.x}px, ${lightboxTranslate.y}px) scale(${lightboxScale})`;
}

lightboxEditBtn.addEventListener('click', () => { if (lightboxIndex >= 0) openEditModal(imageSources[lightboxIndex].name); });
lightboxZoomIn.addEventListener('click', () => zoomLightbox(0.25));
lightboxZoomOut.addEventListener('click', () => zoomLightbox(-0.25));
lightboxZoomReset.addEventListener('click', () => { lightboxScale = 1; lightboxTranslate = { x: 0, y: 0 }; applyLightboxTransform(); });

lightboxImageArea.addEventListener('wheel', (e) => { e.preventDefault(); zoomLightbox(e.deltaY > 0 ? -0.15 : 0.15); }, { passive: false });
lightboxImageArea.addEventListener('mousedown', (e) => {
  if (lightboxScale <= 1) return;
  isDragging = true; dragStart = { x: e.clientX - lightboxTranslate.x, y: e.clientY - lightboxTranslate.y };
  lightboxImageArea.style.cursor = 'grabbing';
});
window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  lightboxTranslate.x = e.clientX - dragStart.x; lightboxTranslate.y = e.clientY - dragStart.y; applyLightboxTransform();
});
window.addEventListener('mouseup', () => { isDragging = false; lightboxImageArea.style.cursor = lightboxScale > 1 ? 'grab' : 'default'; });
lightboxClose.addEventListener('click', closeLightbox);
lightboxPrev.addEventListener('click', () => navigateLightbox(-1));
lightboxNext.addEventListener('click', () => navigateLightbox(1));
$('.lightbox-backdrop').addEventListener('click', closeLightbox);
lightboxImageArea.addEventListener('dblclick', (e) => { if (e.target === lightboxImage && lightboxScale <= 1.05) closeLightbox(); });

// ============================================================
//  🎞 幻灯片
// ============================================================
function toggleSlideshow() { isSlideshowActive ? stopSlideshow() : startSlideshow(); }

function startSlideshow() {
  if (imageSources.length === 0) return;
  isSlideshowActive = true; slideshowButton.textContent = '⏹ 停止'; slideshowButton.classList.add('slideshow-active');
  slideshowBar.style.display = 'block';
  if (lightboxIndex < 0) openLightbox(0);
  runSlideshowStep();
}

function stopSlideshow() {
  isSlideshowActive = false; slideshowButton.textContent = '▶▶ 幻灯片'; slideshowButton.classList.remove('slideshow-active');
  slideshowBar.style.display = 'none'; clearTimeout(slideshowTimer);
}

function runSlideshowStep() {
  if (!isSlideshowActive) return;
  const duration = slideshowInterval;
  const startTime = Date.now();
  function tick() {
    const elapsed = Date.now() - startTime;
    slideshowProgress.style.width = `${Math.min((elapsed / duration) * 100, 100)}%`;
    if (elapsed < duration && isSlideshowActive) requestAnimationFrame(tick);
    else if (isSlideshowActive) { slideshowProgress.style.width = '0%'; navigateLightbox(1); slideshowTimer = setTimeout(runSlideshowStep, 300); }
  }
  requestAnimationFrame(tick);
}
slideshowButton.addEventListener('click', toggleSlideshow);

// ============================================================
//  🔍 搜索与排序
// ============================================================
searchInput.addEventListener('input', (e) => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => { filterTerm = e.target.value; renderGallery(); }, 200);
});
sortSelect.addEventListener('change', (e) => { sortMode = e.target.value; renderGallery(); });
layoutToggle.addEventListener('click', () => {
  isWaterfallLayout = !isWaterfallLayout;
  if (isWaterfallLayout) { $$('.gallery-grid').forEach(g => g.classList.add('waterfall')); layoutToggle.textContent = '⊞ 网格'; }
  else { $$('.gallery-grid').forEach(g => g.classList.remove('waterfall')); layoutToggle.textContent = '▦ 布局'; }
  updateWaterfallHeights(); observeCards();
});

// ============================================================
//  📁 文件夹选择
// ============================================================
function initFolderScanner() {
  folderButton.addEventListener('click', () => folderInput.click());
  folderInput.addEventListener('change', (event) => {
    const files = Array.from(event.target.files || []);
    const images = files.filter(f => /\.(jpe?g|png|webp|gif|bmp|svg)$/i.test(f.name));
    if (images.length === 0) { alert('请选择包含图片文件的文件夹。'); return; }
    loadFolderImages(images); applyWorksDataToSources(); renderGallery();
  });
}

function loadFolderImages(files) {
  clearObjectURLs();
  currentObjectURLs = files.map(file => ({ name: file.name, url: URL.createObjectURL(file) }));
  imageSources = currentObjectURLs.map((item, i) => ({
    name: item.name, src: item.url, title: getDefaultTitle(item.name, i), note: '', category: 5, mtime: Date.now()
  }));
}

function clearObjectURLs() {
  currentObjectURLs.forEach(item => { try { URL.revokeObjectURL(item.url); } catch (e) {} });
  currentObjectURLs = [];
}

// ============================================================
//  📝 弹窗管理
// ============================================================

function openLoginModal() {
  loginModal.classList.add('active'); loginModal.setAttribute('aria-hidden', 'false');
  loginUsername.value = ''; loginPassword.value = ''; loginError.style.display = 'none';
  setTimeout(() => loginUsername.focus(), 100);
}
function closeLoginModal() { loginModal.classList.remove('active'); loginModal.setAttribute('aria-hidden', 'true'); }

adminEntryBtn.addEventListener('click', () => { if (isAdmin) doLogout(); else openLoginModal(); });
loginModalClose.addEventListener('click', closeLoginModal);
loginModal.addEventListener('click', (e) => { if (e.target === loginModal) closeLoginModal(); });

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = loginUsername.value.trim(), password = loginPassword.value;
  if (!username || !password) { loginError.textContent = '请输入账号和密码'; loginError.style.display = 'block'; return; }
  loginError.style.display = 'none';
  loginForm.querySelector('.form-submit').disabled = true; loginForm.querySelector('.form-submit').textContent = '验证中...';
  try {
    const ok = await doLogin(username, password);
    if (!ok) { loginError.textContent = '账号或密码错误'; loginError.style.display = 'block'; }
  } catch (err) { loginError.textContent = '验证失败'; loginError.style.display = 'block'; }
  finally { loginForm.querySelector('.form-submit').disabled = false; loginForm.querySelector('.form-submit').textContent = '登 录'; }
});

adminLogoutBtn.addEventListener('click', doLogout);

// GitHub Sync button
if (adminSyncNowBtn) {
  adminSyncNowBtn.addEventListener('click', () => {
    if (typeof GitHubSync === 'undefined' || !GitHubSync.isConfigured()) { alert('GitHub Token 未配置'); return; }
    adminSyncNowBtn.textContent = '⏳ 同步中...'; adminSyncNowBtn.disabled = true;
    const manifest = buildManifestForSync();
    if (!manifest) { adminSyncNowBtn.textContent = '🔄 同步'; adminSyncNowBtn.disabled = false; return; }
    GitHubSync.schedulePushUpdate(manifest, { force: true }); updateSyncStatusUI();
    let checks = 0;
    const checkInterval = setInterval(() => {
      const status = GitHubSync.getSyncStatus(); updateSyncStatusUI(); checks++;
      if (status.status === 'synced' || status.status === 'error' || checks > 30) {
        clearInterval(checkInterval); adminSyncNowBtn.textContent = '🔄 同步'; adminSyncNowBtn.disabled = false;
      }
    }, 2000);
  });
}

// Edit Modal
function openEditModal(filename) {
  const worksData = getWorksData();
  const saved = worksData[filename] || {};
  const item = imageSources.find(s => s.name === filename);

  editFilename.value = sanitizeFilename(filename);
  editTitle.value = sanitizeText(saved.title || (item ? item.title : '') || getDefaultTitle(filename, 0), 200);
  editNote.value = sanitizeText(saved.note || (item ? item.note : '') || '', 5000);

  editCategory.innerHTML = '';
  const currentCat = saved.category || (item ? item.category : 5) || 5;
  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.id; opt.textContent = `${cat.icon} ${cat.name}`;
    if (cat.id === currentCat) opt.selected = true;
    editCategory.appendChild(opt);
  });

  editSuccess.style.display = 'none';
  editModal.classList.add('active'); editModal.setAttribute('aria-hidden', 'false');
}

function closeEditModal() { editModal.classList.remove('active'); editModal.setAttribute('aria-hidden', 'true'); deletePendingFilename = null; }
editModalClose.addEventListener('click', closeEditModal);
editModal.addEventListener('click', (e) => { if (e.target === editModal) closeEditModal(); });

editForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const filename = editFilename.value;
  if (!filename) return;

  const title = sanitizeText(editTitle.value.trim(), 200);
  const note = sanitizeText(editNote.value.trim(), 5000);
  const category = Math.max(1, Math.min(5, parseInt(editCategory.value) || 5));

  const worksData = loadWorksData();
  worksData[filename] = { ...worksData[filename], title, note, category };
  saveWorksData(worksData);

  const idx = imageSources.findIndex(s => s.name === filename);
  if (idx >= 0) { imageSources[idx].title = title || `作品 ${idx + 1}`; imageSources[idx].note = note; imageSources[idx].category = category; }

  editSuccess.style.display = 'block';
  setTimeout(() => { editSuccess.style.display = 'none'; }, 1500);
  syncToStorage(); renderGallery();
  if (lightboxIndex >= 0) updateLightboxInfo();
  scheduleGitHubSync();
});

editDeleteBtn.addEventListener('click', () => {
  deletePendingFilename = editFilename.value;
  const title = sanitizeText(editTitle.value.trim() || deletePendingFilename, 200);
  deleteConfirmText.textContent = `确定要删除 「${title}」 吗？`;
  deleteConfirmModal.classList.add('active'); deleteConfirmModal.setAttribute('aria-hidden', 'false');
});

deleteCancelBtn.addEventListener('click', () => {
  deleteConfirmModal.classList.remove('active'); deleteConfirmModal.setAttribute('aria-hidden', 'true'); deletePendingFilename = null;
});

deleteConfirmBtn.addEventListener('click', () => {
  if (deletePendingFilename) {
    const worksData = loadWorksData();
    worksData[deletePendingFilename] = { ...worksData[deletePendingFilename], hidden: true };
    saveWorksData(worksData);
    imageSources = imageSources.filter(s => s.name !== deletePendingFilename);
    deletePendingFilename = null; closeEditModal(); renderGallery();
    if (lightboxIndex >= imageSources.length) closeLightbox();
    scheduleGitHubSync();
  }
  deleteConfirmModal.classList.remove('active'); deleteConfirmModal.setAttribute('aria-hidden', 'true');
});

deleteConfirmModal.addEventListener('click', (e) => {
  if (e.target === deleteConfirmModal) { deleteConfirmModal.classList.remove('active'); deleteConfirmModal.setAttribute('aria-hidden', 'true'); deletePendingFilename = null; }
});

// Add Modal
function openAddModal() {
  addImageFile.value = ''; addFilename.value = ''; addTitle.value = ''; addNote.value = '';
  addError.style.display = 'none'; addSuccess.style.display = 'none';
  addCategory.innerHTML = '';
  categories.forEach(cat => { const opt = document.createElement('option'); opt.value = cat.id; opt.textContent = `${cat.icon} ${cat.name}`; if (cat.id === 5) opt.selected = true; addCategory.appendChild(opt); });
  addModal.classList.add('active'); addModal.setAttribute('aria-hidden', 'false');
}
function closeAddModal() { addModal.classList.remove('active'); addModal.setAttribute('aria-hidden', 'true'); }
addModalClose.addEventListener('click', closeAddModal);
addModal.addEventListener('click', (e) => { if (e.target === addModal) closeAddModal(); });
adminAddBtn.addEventListener('click', openAddModal);

addForm.addEventListener('submit', (e) => {
  e.preventDefault(); addError.style.display = 'none'; addSuccess.style.display = 'none';
  const file = addImageFile.files[0];
  const manualName = sanitizeFilename(addFilename.value.trim());
  const title = sanitizeText(addTitle.value.trim(), 200);
  const note = sanitizeText(addNote.value.trim(), 5000);
  const category = Math.max(1, Math.min(5, parseInt(addCategory.value) || 5));

  if (file && !/^image\//.test(file.type)) { addError.textContent = '请选择有效的图片文件'; addError.style.display = 'block'; return; }

  let filename, src;
  if (file) { filename = sanitizeFilename(file.name); src = URL.createObjectURL(file); currentObjectURLs.push({ name: filename, url: src }); }
  else if (manualName) { filename = manualName; src = manualName; }
  else { addError.textContent = '请选择图片文件或输入文件名'; addError.style.display = 'block'; return; }

  if (imageSources.some(s => s.name === filename) && !file) { addError.textContent = '该文件名已存在'; addError.style.display = 'block'; return; }

  const worksData = loadWorksData();
  worksData[filename] = { title: title || filename, note, category, hidden: false };
  saveWorksData(worksData);
  if (!imageSources.some(s => s.name === filename)) {
    imageSources.push({ name: filename, src, title: title || filename, note, category, mtime: Date.now() });
  }

  addSuccess.textContent = `✅ 添加成功！`; addSuccess.style.display = 'block';
  addImageFile.value = ''; addFilename.value = ''; addTitle.value = ''; addNote.value = '';
  setTimeout(() => { addSuccess.style.display = 'none'; closeAddModal(); syncToStorage(); renderGallery(); scheduleGitHubSync(); }, 800);
});

// ============================================================
//  ✨ 粒子背景
// ============================================================
function resizeCanvas() {
  const w = window.innerWidth, h = window.innerHeight;
  const dpr = devicePixelRatio || 1;
  canvas.width = w * dpr; canvas.height = h * dpr; canvas.style.width = `${w}px`; canvas.style.height = `${h}px`; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  sakuraCanvas.width = w * dpr; sakuraCanvas.height = h * dpr; sakuraCanvas.style.width = `${w}px`; sakuraCanvas.style.height = `${h}px`; sakuraCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

const particles = [];
const particleCount = 50;
function setupParticles() {
  particles.length = 0;
  for (let i = 0; i < particleCount; i++) {
    particles.push({ x: Math.random() * window.innerWidth, y: Math.random() * window.innerHeight, vx: (Math.random() - 0.5) * 0.4, vy: (Math.random() - 0.5) * 0.4, radius: 1 + Math.random() * 2, alpha: 0.04 + Math.random() * 0.12 });
  }
}

function animateParticles() {
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  particles.forEach(p => {
    p.x += p.vx; p.y += p.vy;
    if (p.x < -40) p.x = window.innerWidth + 40; if (p.x > window.innerWidth + 40) p.x = -40;
    if (p.y < -40) p.y = window.innerHeight + 40; if (p.y > window.innerHeight + 40) p.y = -40;
    ctx.beginPath(); ctx.fillStyle = `rgba(124, 184, 156, ${p.alpha})`; ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2); ctx.fill();
  });

  // Draw connections (simplified)
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const dist = Math.hypot(particles[i].x - particles[j].x, particles[i].y - particles[j].y);
      if (dist < 120) {
        ctx.strokeStyle = `rgba(124, 184, 156, ${0.05 - dist * 0.00035})`;
        ctx.lineWidth = 0.8; ctx.beginPath();
        ctx.moveTo(particles[i].x, particles[i].y); ctx.lineTo(particles[j].x, particles[j].y); ctx.stroke();
      }
    }
  }
  requestAnimationFrame(animateParticles);
}

const sakuraPetals = [];
const SAKURA_COUNT = 35;
function setupSakura() {
  sakuraPetals.length = 0;
  for (let i = 0; i < SAKURA_COUNT; i++) {
    sakuraPetals.push({
      x: Math.random() * window.innerWidth, y: Math.random() * -window.innerHeight,
      size: 8 + Math.random() * 18, speedY: 0.3 + Math.random() * 1.2, speedX: -0.3 + Math.random() * 0.6,
      rotation: Math.random() * Math.PI * 2, rotationSpeed: (Math.random() - 0.5) * 0.03,
      sway: Math.random() * Math.PI * 2, swaySpeed: 0.01 + Math.random() * 0.02, swayAmount: 0.5 + Math.random() * 2.5,
      alpha: 0.3 + Math.random() * 0.5
    });
  }
}

function animateSakura() {
  sakuraCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  sakuraPetals.forEach(p => {
    p.y += p.speedY; p.sway += p.swaySpeed; p.x += p.speedX + Math.sin(p.sway) * p.swayAmount * 0.3; p.rotation += p.rotationSpeed;
    if (p.y > window.innerHeight + 40) { p.y = -40; p.x = Math.random() * window.innerWidth; }
    if (p.x < -40) p.x = window.innerWidth + 40; if (p.x > window.innerWidth + 40) p.x = -40;

    sakuraCtx.save(); sakuraCtx.translate(p.x, p.y); sakuraCtx.rotate(p.rotation); sakuraCtx.globalAlpha = p.alpha;
    sakuraCtx.fillStyle = `rgba(255, 183, 197, ${p.alpha})`;
    const w = p.size * 0.35, h = p.size * 0.55;
    sakuraCtx.beginPath(); sakuraCtx.moveTo(0, -h);
    sakuraCtx.bezierCurveTo(w, -h * 0.6, w, h * 0.3, 0, h);
    sakuraCtx.bezierCurveTo(-w, h * 0.3, -w, -h * 0.6, 0, -h);
    sakuraCtx.fill(); sakuraCtx.restore();
  });
  requestAnimationFrame(animateSakura);
}

// ============================================================
//  🚀 初始化
// ============================================================
window.addEventListener('resize', () => { resizeCanvas(); updateWaterfallParallax(); });

window.addEventListener('DOMContentLoaded', () => {
  checkAdminAuth();
  buildImageSources();
  initFolderScanner();
  initBackgroundMusic();
  initAdminMusicControls();
  initMusicManagement();
  initTokenManagement();
  renderGallery();
  resizeCanvas();
  setupParticles(); animateParticles();
  setupSakura(); animateSakura();
  updateWaterfallParallax();

  // Check if detail page triggered a sync
  if (localStorage.getItem('gallery_pending_sync') === 'true') {
    localStorage.removeItem('gallery_pending_sync');
    if (isAdmin) scheduleGitHubSync();
  }

  // Handle edit request from detail page
  const hash = window.location.hash;
  if (hash.startsWith('#edit=')) {
    const filename = decodeURIComponent(hash.slice(6));
    if (filename && !/[<>]/.test(filename) && imageSources.some(s => s.name === filename)) openEditModal(filename);
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // Keyboard shortcut hint
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); showKeyboardShortcuts(); }
  });

  window.addEventListener('beforeunload', () => { clearObjectURLs(); if (cardObserver) cardObserver.disconnect(); preloadCache.clear(); });

  if (MANIFEST) console.log(`🌸 画廊已加载: ${MANIFEST.totalImages} 张图片`);
});

function showKeyboardShortcuts() {
  const existing = document.getElementById('shortcuts-tooltip');
  if (existing) { existing.remove(); return; }
  const tip = document.createElement('div');
  tip.id = 'shortcuts-tooltip';
  tip.innerHTML = `
    <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:3000;background:rgba(255,252,247,0.98);border:1px solid var(--border-light,#ddd);border-radius:20px;padding:28px 32px;box-shadow:0 20px 60px rgba(0,0,0,0.15);backdrop-filter:blur(20px);min-width:320px;font-size:0.9rem;line-height:2;color:#3d2e1f;">
      <h3 style="margin:0 0 14px;font-size:1.2rem;text-align:center;">⌨️ 键盘快捷键</h3>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 16px;">
        <span style="font-weight:600;">← →</span><span>上一张 / 下一张</span>
        <span style="font-weight:600;">ESC</span><span>关闭弹窗</span>
        <span style="font-weight:600;">+/-</span><span>放大 / 缩小</span>
        <span style="font-weight:600;">0</span><span>重置缩放</span>
        <span style="font-weight:600;">F</span><span>全屏模式</span>
        <span style="font-weight:600;">?</span><span>显示/隐藏帮助</span>
        ${isAdmin ? '<span style="font-weight:600;">长按</span><span>拖拽排序（管理员）</span>' : ''}
      </div>
      <button style="display:block;margin:18px auto 0;padding:8px 24px;border-radius:999px;border:1px solid rgba(139,122,107,0.2);background:rgba(139,122,107,0.06);color:#3d2e1f;cursor:pointer;font-size:0.9rem;font-family:inherit;" onclick="this.closest('#shortcuts-tooltip').remove()">关闭</button>
    </div>`;
  document.body.appendChild(tip);
  tip.addEventListener('click', (e) => { if (e.target === tip) tip.remove(); });
}