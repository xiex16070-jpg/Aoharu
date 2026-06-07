// ============================================================
//  贝贝最喜欢的作品们 — 图片画廊（v2 清单驱动版）
//  功能：清单驱动加载、文件夹路径映射、懒加载、Lightbox
//        管理员登录（哈希密码）、编辑/添加/删除、localStorage
//        樱花&粒子动效、触摸滑动、图片预加载、键盘快捷键
// ============================================================

// ===== 从 manifest 获取数据（manifest.js 需先于本脚本加载）=====
const MANIFEST = (typeof GALLERY_MANIFEST !== 'undefined') ? GALLERY_MANIFEST : null;

// ===== 管理员凭据（SHA-256 哈希） =====
// 实际账号: xiex16070 / 密码: 2103886050@Qq
const ADMIN_USERNAME_HASH = '7cf0f774ebae842b6b19053a633ca959db164a69c5644ce1f179af5900384579';
const ADMIN_PASSWORD_HASH = '945af9dc78bf7affcc72266b0902eca6b1aeb256a6154491eb045539583fb985';

// 管理员凭据验证（哈希比对 + 常量时间比较防时序攻击）
async function verifyAdminCredentials(username, password) {
  // 先做长度检查再哈希（减少不必要的哈希计算）
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

  // 常量时间比较
  const userMatch = userHash.length === ADMIN_USERNAME_HASH.length &&
    [...userHash].every((c, i) => c === ADMIN_USERNAME_HASH[i]);
  const passMatch = passHash.length === ADMIN_PASSWORD_HASH.length &&
    [...passHash].every((c, i) => c === ADMIN_PASSWORD_HASH[i]);

  return userMatch && passMatch;
}

// ===== 从清单构建分类配置 =====
const categories = MANIFEST ? MANIFEST.categories.map(c => ({
  id: c.id,
  name: c.name,
  icon: c.icon,
  desc: c.desc
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
      src: img.src,  // 已含文件夹前缀
      category: img.category,
      title: img.name,
      note: '',
      size: img.size,
      mtime: img.mtime
    }));
  }
  // 回退到硬编码列表（保持向后兼容）
  const fallback = [
    '20260507_210918.jpg','20260508_074444.jpg','20260508_074448.jpg',
    '20260519_075743.jpg','20260519_093743.jpg','20260519_231540.jpg',
    '20260523_000629.jpg','20260523_183038.jpg','20260525_230334.jpg',
    '20260526_074846.jpg','20260527_233409.jpg','20260527_233414.jpg',
    '20260530_190608.jpg','20260531_111150.jpg','20260531_232014.jpg',
    '20260531_232026.jpg','20260531_232326.jpg','20260601_203028.jpg',
    '20260601_203756.jpg','20260601_213503.jpg','20260602_095454.jpg',
    '20260602_193013.jpg','20260602_193720.jpg','20260603_103815.jpg',
    '20260603_104309.jpg','20260603_203452.jpg','20260603_204038.jpg',
    '20260603_204041.jpg','20260604_151401.jpg','20260604_205823.jpg',
    '20260604_205925.jpg','20260604_235227.jpg','20260605_151943.jpg',
    '微信图片_20250922104041_219_5_upscayl_4x_digital-art-4x.png',
    '微信图片_20250924180157_232_5.jpg','微信图片_20250924180204_233_5.jpg',
    '微信图片_20251108140618_340_5.jpg',
    '微信图片_20260124103147_301_4_upscayl_5x_digital-art-4x.png'
  ];
  return fallback.map((name, i) => ({
    name, src: name, category: 5, title: name, note: '', size: 0, mtime: 0
  }));
}

// ===== 从清单 + localStorage 构建统一音乐列表 =====
function getCustomMusicTracks() {
  const raw = safeGetStorage(MUSIC_PLAYLIST_KEY);
  const parsed = safeParseJSON(raw, []);
  if (!Array.isArray(parsed)) return [];
  // 过滤掉无效条目
  return parsed.filter(t => t && typeof t.name === 'string' && typeof t.file === 'string' && t.name && t.file);
}

function saveCustomMusicTracks(tracks) {
  if (!Array.isArray(tracks)) return;
  safeSetStorage(MUSIC_PLAYLIST_KEY, JSON.stringify(tracks));
}

function buildMusicFromManifest() {
  // 从清单获取磁盘上的音乐文件
  const manifestTracks = (MANIFEST && MANIFEST.music && MANIFEST.music.length > 0)
    ? MANIFEST.music.map(m => ({ name: m.name || m.file, file: m.file }))
    : [];

  // 合并自定义曲目（去重）
  const customTracks = getCustomMusicTracks();
  const seenFiles = new Set(manifestTracks.map(t => t.file));
  const merged = [...manifestTracks];
  customTracks.forEach(t => {
    if (!seenFiles.has(t.file)) {
      merged.push(t);
      seenFiles.add(t.file);
    }
  });

  // 如果没有清单曲目也没有自定义曲目，提供默认
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

// ============================================================
//  🛡️ 安全工具函数
// ============================================================

/** HTML 转义 — 防止 XSS */
function escapeHtml(str) {
  if (!str || typeof str !== 'string') return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/** 净化文本（用于插入 DOM，移除所有 HTML 标签） */
function sanitizeText(str, maxLen = 5000) {
  if (!str || typeof str !== 'string') return '';
  // 移除所有 HTML 标签、脚本事件和危险协议
  return str.slice(0, maxLen)
    .replace(/<[^>]*>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim();
}

/** 净化文件名（移除路径遍历字符） */
function sanitizeFilename(name, maxLen = 512) {
  if (!name || typeof name !== 'string') return '';
  return name.slice(0, maxLen)
    .replace(/[\\/:*?"<>|]/g, '')  // 移除 Windows 非法字符
    .replace(/\.\./g, '')          // 移除路径遍历
    .replace(/[\x00-\x1f]/g, '')   // 移除控制字符
    .trim();
}

/** 安全解析 JSON */
function safeParseJSON(raw, fallback = null) {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    const parsed = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return fallback;
    return parsed;
  } catch (e) {
    return fallback;
  }
}

/** 安全 localStorage set */
function safeSetStorage(key, value) {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (e) {
    console.warn('localStorage 写入失败:', e.message);
    return false;
  }
}

/** 安全 localStorage get */
function safeGetStorage(key) {
  try {
    return localStorage.getItem(key);
  } catch (e) {
    console.warn('localStorage 读取失败:', e.message);
    return null;
  }
}

/** 同步 imageSources 到 localStorage */
function syncToStorage() {
  try {
    // 只同步必要的字段（不含 size/mtime 等大数据）
    const compact = imageSources.map(s => ({
      name: s.name, src: s.src, title: s.title,
      note: s.note || '', category: s.category
    }));
    localStorage.setItem(SESSION_KEY, JSON.stringify(compact));
  } catch (e) { /* ignore */ }
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

function applyWorksDataToSources() {
  const worksData = getWorksData();
  imageSources = imageSources.map((item, i) => {
    const saved = worksData[item.name];
    const ov = item.overrides; // 读取 manifest 中推送的 overrides

    // 优先级：localStorage > manifest.overrides > 原始值
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
  // 尝试从文件名提取更有意义的标题
  const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
  // 微信图片特殊处理
  if (nameWithoutExt.startsWith('微信图片_')) {
    const datePart = nameWithoutExt.substring(5, 13);
    if (datePart && /^\d{8}$/.test(datePart)) {
      const y = datePart.slice(0, 4), m = datePart.slice(4, 6), d = datePart.slice(6, 8);
      return `微信图片 ${y}-${m}-${d}`;
    }
  }
  // 日期戳文件名
  if (/^\d{14,17}/.test(nameWithoutExt)) {
    const y = nameWithoutExt.slice(0, 4), m = nameWithoutExt.slice(4, 6),
          d = nameWithoutExt.slice(6, 8), h = nameWithoutExt.slice(8, 10),
          min = nameWithoutExt.slice(10, 12), s = nameWithoutExt.slice(12, 14);
    return `作品 ${y}-${m}-${d} ${h}:${min}:${s}`;
  }
  return `作品 ${index + 1}`;
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
  } catch (e) {
    isAdmin = false;
  }
}

function showAdminUI() {
  adminBar.style.display = 'flex';
  adminBarUser.textContent = '👤 管理员';
  lightboxEditBtn.style.display = '';
  adminEntryBtn.textContent = '🔐 退出';
  adminEntryBtn.classList.add('admin-logged-in');
  // 显示音乐管理控件
  if (adminMusicControls) adminMusicControls.style.display = 'flex';
  // 显示 GitHub 同步控件
  updateSyncStatusUI();
  if (syncStatusBadge) syncStatusBadge.style.display = '';
  if (adminSyncNowBtn) adminSyncNowBtn.style.display = '';
  if (adminTokenBtn) adminTokenBtn.style.display = '';
  // 尝试从 GitHub 拉取最新数据
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
  // 隐藏音乐管理控件
  if (adminMusicControls) adminMusicControls.style.display = 'none';
  // 隐藏 GitHub 同步控件
  if (syncStatusBadge) syncStatusBadge.style.display = 'none';
  if (adminSyncNowBtn) adminSyncNowBtn.style.display = 'none';
  if (adminTokenBtn) adminTokenBtn.style.display = 'none';
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

// Admin DOM
const adminEntryBtn = $('#adminEntryBtn');
const adminBar = $('#adminBar');
const adminBarUser = $('#adminBarUser');
const adminAddBtn = $('#adminAddBtn');
const adminLogoutBtn = $('#adminLogoutBtn');

// GitHub Sync DOM
const syncStatusBadge = $('#syncStatusBadge');
const adminSyncNowBtn = $('#adminSyncNowBtn');
const adminTokenBtn = $('#adminTokenBtn');

// Admin Music Controls
const adminMusicControls = $('#adminMusicControls');
const adminMusicPlayBtn = $('#adminMusicPlayBtn');
const adminMusicSelect = $('#adminMusicSelect');
const adminMusicVolume = $('#adminMusicVolume');
const adminMusicTrackInfo = $('#adminMusicTrackInfo');

// Music Management Modal
const musicMgmtModal = $('#musicMgmtModal');
const musicMgmtClose = $('#musicMgmtClose');
const adminMusicMgmtBtn = $('#adminMusicMgmtBtn');
const musicFileInput = $('#musicFileInput');
const musicFilenameInput = $('#musicFilenameInput');
const musicAddBtn = $('#musicAddBtn');
const musicAddError = $('#musicAddError');
const musicTrackList = $('#musicTrackList');
const musicTrackCount = $('#musicTrackCount');

// Token Modal
const tokenModal = $('#tokenModal');
const tokenModalClose = $('#tokenModalClose');
const tokenInput = $('#tokenInput');
const tokenToggleVisibility = $('#tokenToggleVisibility');
const tokenSaveBtn = $('#tokenSaveBtn');
const tokenClearBtn = $('#tokenClearBtn');
const tokenError = $('#tokenError');
const tokenSuccess = $('#tokenSuccess');
const tokenStatusValue = $('#tokenStatusValue');

// Login Modal
const loginModal = $('#loginModal');
const loginForm = $('#loginForm');
const loginUsername = $('#loginUsername');
const loginPassword = $('#loginPassword');
const loginError = $('#loginError');
const loginModalClose = $('#loginModalClose');

// Edit Modal
const editModal = $('#editModal');
const editForm = $('#editForm');
const editFilename = $('#editFilename');
const editTitle = $('#editTitle');
const editNote = $('#editNote');
const editCategory = $('#editCategory');
const editSuccess = $('#editSuccess');
const editDeleteBtn = $('#editDeleteBtn');
const editModalClose = $('#editModalClose');

// Add Modal
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

// Delete Confirm
const deleteConfirmModal = $('#deleteConfirmModal');
const deleteConfirmText = $('#deleteConfirmText');
const deleteCancelBtn = $('#deleteCancelBtn');
const deleteConfirmBtn = $('#deleteConfirmBtn');

// Lightbox
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
let preloadCache = new Map();  // 预加载缓存

// ===== 音乐 =====
let musicTracks = buildMusicFromManifest();
let currentTrackIndex = 0;

/** 刷新音乐列表（合并清单 + localStorage）并更新 UI */
function refreshMusicTracks() {
  musicTracks = buildMusicFromManifest();
  if (currentTrackIndex >= musicTracks.length) currentTrackIndex = 0;
  // 更新管理弹窗列表
  renderMusicTrackList();
  // 更新管理栏下拉
  if (adminMusicSelect) populateAdminMusicSelect();
}

// ============================================================
//  🎵 音乐 — 背景自动播放 + 管理员可见控制
// ============================================================

/** 设置并加载曲目 */
function setTrack(file) {
  if (!file) return;
  audioPlayer.src = file;
  audioPlayer.load();
  const track = musicTracks.find(t => t.file === file);
  if (track) {
    audioPlayer.volume = parseFloat(adminMusicVolume?.value || 45) / 100;
    if (adminMusicTrackInfo) {
      adminMusicTrackInfo.textContent = `🎵 ${track.name}`;
    }
  }
}

/** 后台初始化音乐 — 自动播放（无 UI） */
function initBackgroundMusic() {
  if (musicTracks.length === 0) return;

  // 尝试恢复上次音量
  const savedVol = safeGetStorage('gallery_bg_volume');
  if (savedVol !== null) {
    const vol = Math.max(0, Math.min(100, parseInt(savedVol) || 45));
    audioPlayer.volume = vol / 100;
    if (adminMusicVolume) adminMusicVolume.value = vol;
  } else {
    audioPlayer.volume = 0.45;
    if (adminMusicVolume) adminMusicVolume.value = 45;
  }

  // 恢复上次选择的曲目（若存在）
  const savedTrack = safeGetStorage('gallery_bg_track');
  if (savedTrack) {
    const idx = musicTracks.findIndex(t => t.file === savedTrack);
    if (idx >= 0) {
      currentTrackIndex = idx;
      setTrack(musicTracks[idx].file);
    } else {
      setTrack(musicTracks[0]?.file || '');
    }
  } else {
    setTrack(musicTracks[0]?.file || '');
  }

  // 尝试自动播放（用户首次交互后生效）
  const tryAutoPlay = () => {
    if (!audioPlayer.src || audioPlayer.src === window.location.href) {
      setTrack(musicTracks[0]?.file || '');
    }
    audioPlayer.play().catch(() => {
      // 浏览器阻止自动播放 — 在首次用户交互时重试
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

  // 延迟尝试，等页面加载完成
  setTimeout(tryAutoPlay, 500);

  // 曲目播放结束自动循环当前曲目
  audioPlayer.addEventListener('ended', () => {
    audioPlayer.currentTime = 0;
    audioPlayer.play().catch(() => {});
  });
}

/** 管理员音乐控制 — 仅管理员可见 */
function initAdminMusicControls() {
  if (!adminMusicPlayBtn || !adminMusicVolume) return;

  // 同步初始音量
  adminMusicVolume.value = Math.round(audioPlayer.volume * 100);

  // 构建曲目选择下拉（管理员可切换曲目）
  populateAdminMusicSelect();

  if (adminMusicSelect) {
    adminMusicSelect.addEventListener('change', () => {
      const file = adminMusicSelect.value;
      if (file) {
        setTrack(file);
        safeSetStorage('gallery_bg_track', file);
        audioPlayer.play().catch(() => {});
      }
    });
  }

  // 播放/暂停切换
  let isPlaying = !audioPlayer.paused;
  const updatePlayBtn = () => {
    adminMusicPlayBtn.textContent = isPlaying ? '⏸' : '▶';
  };
  updatePlayBtn();

  adminMusicPlayBtn.addEventListener('click', () => {
    if (isPlaying) {
      audioPlayer.pause();
      isPlaying = false;
    } else {
      if (!audioPlayer.src || audioPlayer.src === window.location.href) {
        setTrack(musicTracks[0]?.file || '');
      }
      audioPlayer.play().catch(() => {});
      isPlaying = true;
    }
    updatePlayBtn();
  });

  // 同步播放状态
  audioPlayer.addEventListener('play', () => { isPlaying = true; updatePlayBtn(); });
  audioPlayer.addEventListener('pause', () => { isPlaying = false; updatePlayBtn(); });

  // 音量滑块
  adminMusicVolume.addEventListener('input', () => {
    const vol = parseInt(adminMusicVolume.value) / 100;
    audioPlayer.volume = vol;
    safeSetStorage('gallery_bg_volume', adminMusicVolume.value);
  });

  // 曲目切换（单曲模式则循环）
  if (musicTracks.length > 1) {
    adminMusicPlayBtn.addEventListener('dblclick', () => {
      currentTrackIndex = (currentTrackIndex + 1) % musicTracks.length;
      const track = musicTracks[currentTrackIndex];
      setTrack(track.file);
      safeSetStorage('gallery_bg_track', track.file);
      audioPlayer.play().catch(() => {});
      isPlaying = true;
      // 同步下拉选择（若存在）
      if (adminMusicSelect) adminMusicSelect.value = track.file;
      updatePlayBtn();
    });
    adminMusicPlayBtn.title = '单击播放/暂停，双击切换曲目';
  }
}
function populateAdminMusicSelect() {
  if (!adminMusicSelect) return;
  adminMusicSelect.innerHTML = '';
  musicTracks.forEach((t) => {
    const opt = document.createElement('option');
    opt.value = t.file;
    opt.textContent = t.name || t.file;
    adminMusicSelect.appendChild(opt);
  });
  const saved = safeGetStorage('gallery_bg_track');
  if (saved) {
    const found = Array.from(adminMusicSelect.options).find(o => o.value === saved);
    if (found) adminMusicSelect.value = saved;
  } else if (musicTracks.length > 0 && musicTracks[currentTrackIndex]) {
    adminMusicSelect.value = musicTracks[currentTrackIndex].file;
  }
}

/** 渲染音乐管理弹窗的曲目列表 */
function renderMusicTrackList() {
  if (!musicTrackList || !musicTrackCount) return;

  musicTrackList.innerHTML = '';
  musicTrackCount.textContent = `${musicTracks.length} 首`;

  if (musicTracks.length === 0) {
    musicTrackList.innerHTML = '<p style="text-align:center;color:var(--muted);padding:20px;">暂无曲目，请添加背景音乐</p>';
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
    name.title = track.name || track.file;

    const badge = document.createElement('span');
    badge.className = 'music-track-item-badge';
    const isManifest = MANIFEST && MANIFEST.music && MANIFEST.music.some(m => m.file === track.file);
    badge.textContent = isManifest ? '内置' : '自定义';

    const actions = document.createElement('div');
    actions.className = 'music-track-item-actions';

    const playBtn = document.createElement('button');
    playBtn.className = 'music-track-item-btn play-btn';
    playBtn.title = '播放此曲目';
    playBtn.textContent = '▶';
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      currentTrackIndex = idx;
      setTrack(track.file);
      safeSetStorage('gallery_bg_track', track.file);
      audioPlayer.play().catch(() => {});
      if (adminMusicSelect) adminMusicSelect.value = track.file;
      renderMusicTrackList();
    });

    if (!isManifest) {
      const delBtn = document.createElement('button');
      delBtn.className = 'music-track-item-btn delete-btn';
      delBtn.title = '删除此曲目';
      delBtn.textContent = '🗑';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        const customTracks = getCustomMusicTracks();
        const updated = customTracks.filter(t => t.file !== track.file);
        saveCustomMusicTracks(updated);
        refreshMusicTracks();
        if (currentTrackIndex >= musicTracks.length) {
          currentTrackIndex = 0;
        }
        if (musicTracks.length > 0) {
          setTrack(musicTracks[0].file);
          safeSetStorage('gallery_bg_track', musicTracks[0].file);
          audioPlayer.play().catch(() => {});
        } else {
          audioPlayer.pause();
          audioPlayer.src = '';
        }
        // 调度 GitHub 同步
        scheduleGitHubSync();
      });
      actions.appendChild(delBtn);
    }

    actions.appendChild(playBtn);
    item.appendChild(icon);
    item.appendChild(name);
    item.appendChild(badge);
    item.appendChild(actions);

    item.addEventListener('dblclick', () => {
      currentTrackIndex = idx;
      setTrack(track.file);
      safeSetStorage('gallery_bg_track', track.file);
      audioPlayer.play().catch(() => {});
      if (adminMusicSelect) adminMusicSelect.value = track.file;
      renderMusicTrackList();
    });

    musicTrackList.appendChild(item);
  });
}

/** 初始化音乐管理弹窗 */
function initMusicManagement() {
  if (!musicMgmtModal || !adminMusicMgmtBtn) return;

  adminMusicMgmtBtn.addEventListener('click', () => {
    musicFileInput.value = '';
    musicFilenameInput.value = '';
    if (musicAddError) musicAddError.style.display = 'none';
    renderMusicTrackList();
    musicMgmtModal.classList.add('active');
    musicMgmtModal.setAttribute('aria-hidden', 'false');
  });

  musicMgmtClose.addEventListener('click', () => {
    musicMgmtModal.classList.remove('active');
    musicMgmtModal.setAttribute('aria-hidden', 'true');
  });
  musicMgmtModal.addEventListener('click', (e) => {
    if (e.target === musicMgmtModal) {
      musicMgmtModal.classList.remove('active');
      musicMgmtModal.setAttribute('aria-hidden', 'true');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && musicMgmtModal.classList.contains('active')) {
      musicMgmtModal.classList.remove('active');
      musicMgmtModal.setAttribute('aria-hidden', 'true');
    }
  });

  musicAddBtn.addEventListener('click', () => {
    if (musicAddError) musicAddError.style.display = 'none';

    const file = musicFileInput.files[0];
    const manualName = sanitizeFilename(musicFilenameInput.value.trim());

    if (file) {
      if (!/^audio\//.test(file.type) && !file.name.match(/\.(mp3|flac|wav|ogg|m4a|aac|wma)$/i)) {
        if (musicAddError) {
          musicAddError.textContent = '请选择有效的音频文件（mp3 / flac / wav / ogg 等）';
          musicAddError.style.display = 'block';
        }
        return;
      }

      const filename = sanitizeFilename(file.name);
      if (musicTracks.some(t => t.file === filename)) {
        if (musicAddError) {
          musicAddError.textContent = '同名曲目已存在，请勿重复添加';
          musicAddError.style.display = 'block';
        }
        return;
      }

      const objectURL = URL.createObjectURL(file);
      const customTracks = getCustomMusicTracks();
      const displayName = file.name.replace(/\.[^.]+$/, '');
      customTracks.push({ name: displayName, file: filename, objectURL: objectURL });
      saveCustomMusicTracks(customTracks);

      refreshMusicTracks();
      musicFileInput.value = '';
      currentTrackIndex = musicTracks.findIndex(t => t.file === filename);
      if (currentTrackIndex >= 0 && objectURL) {
        setTrack(objectURL);
      }
      safeSetStorage('gallery_bg_track', filename);
      // 调度 GitHub 同步
      scheduleGitHubSync();
    } else if (manualName) {
      if (!manualName.match(/\.(mp3|flac|wav|ogg|m4a|aac|wma)$/i)) {
        if (musicAddError) {
          musicAddError.textContent = '文件名需以音频扩展名结尾（如 .mp3 .flac .wav .ogg）';
          musicAddError.style.display = 'block';
        }
        return;
      }

      if (musicTracks.some(t => t.file === manualName)) {
        if (musicAddError) {
          musicAddError.textContent = '同名曲目已存在，请勿重复添加';
          musicAddError.style.display = 'block';
        }
        return;
      }

      const customTracks = getCustomMusicTracks();
      const displayName = manualName.replace(/\.[^.]+$/, '');
      customTracks.push({ name: displayName, file: manualName });
      saveCustomMusicTracks(customTracks);

      refreshMusicTracks();
      musicFilenameInput.value = '';
      currentTrackIndex = musicTracks.findIndex(t => t.file === manualName);
      if (currentTrackIndex >= 0) {
        setTrack(manualName);
      }
      safeSetStorage('gallery_bg_track', manualName);
      audioPlayer.play().catch(() => {});
      // 调度 GitHub 同步
      scheduleGitHubSync();
    } else {
      if (musicAddError) {
        musicAddError.textContent = '请选择音频文件或输入文件名';
        musicAddError.style.display = 'block';
      }
    }
  });

  if (musicFileInput) {
    musicFileInput.addEventListener('change', () => {
      const file = musicFileInput.files[0];
      if (file && !musicFilenameInput.value) {
        musicFilenameInput.placeholder = `将添加: ${file.name}`;
      }
    });
  }
}

// ============================================================
//  🔑 Token 管理弹窗
// ============================================================

/** 刷新 Token 状态显示 */
function updateTokenStatusUI() {
  if (!tokenStatusValue) return;
  if (typeof GitHubSync !== 'undefined' && GitHubSync.isConfigured()) {
    const token = localStorage.getItem('gallery_github_sync');
    if (token) {
      const masked = token.substring(0, 20) + '...' + token.substring(token.length - 8);
      tokenStatusValue.textContent = '✅ 已配置';
      tokenStatusValue.title = masked;
      tokenStatusValue.className = 'token-status-value configured';
      tokenInput.value = '';
      tokenInput.placeholder = masked;
    } else {
      tokenStatusValue.textContent = '✅ 已配置';
      tokenStatusValue.title = '';
      tokenStatusValue.className = 'token-status-value configured';
      tokenInput.placeholder = '（已保存）';
    }
  } else {
    tokenStatusValue.textContent = '❌ 未配置';
    tokenStatusValue.title = '请设置 GitHub Personal Access Token';
    tokenStatusValue.className = 'token-status-value unconfigured';
    tokenInput.placeholder = '输入 GitHub PAT（github_pat_ 开头）...';
  }
}

function openTokenModal() {
  if (!tokenModal) return;
  tokenInput.value = '';
  tokenError.style.display = 'none';
  tokenSuccess.style.display = 'none';
  tokenInput.type = 'password';
  if (tokenToggleVisibility) tokenToggleVisibility.textContent = '👁';
  updateTokenStatusUI();
  tokenModal.classList.add('active');
  tokenModal.setAttribute('aria-hidden', 'false');
  setTimeout(() => tokenInput.focus(), 100);
}

function closeTokenModal() {
  if (!tokenModal) return;
  tokenModal.classList.remove('active');
  tokenModal.setAttribute('aria-hidden', 'true');
  tokenInput.value = '';
}

function saveToken() {
  if (!tokenInput || !tokenError || !tokenSuccess) return;
  tokenError.style.display = 'none';
  tokenSuccess.style.display = 'none';

  const token = (tokenInput.value || '').trim();
  if (!token) {
    tokenError.textContent = '请输入 Token';
    tokenError.style.display = 'block';
    return;
  }

  if (!token.startsWith('github_pat_')) {
    tokenError.textContent = 'Token 必须以 github_pat_ 开头';
    tokenError.style.display = 'block';
    return;
  }

  if (token.length < 40) {
    tokenError.textContent = 'Token 长度不足，请检查是否完整复制';
    tokenError.style.display = 'block';
    return;
  }

  // 保存到 localStorage
  try {
    localStorage.setItem('gallery_github_sync', token);
    tokenSuccess.textContent = '✅ Token 已保存！同步功能已就绪。';
    tokenSuccess.style.display = 'block';
    tokenInput.value = '';
    updateTokenStatusUI();
    // 更新同步状态
    if (isAdmin) updateSyncStatusUI();
    // 3秒后自动关闭
    setTimeout(() => {
      closeTokenModal();
      tokenSuccess.style.display = 'none';
    }, 2000);
  } catch (e) {
    tokenError.textContent = '保存失败：' + (e.message || '存储空间不足');
    tokenError.style.display = 'block';
  }
}

function clearToken() {
  if (!tokenError || !tokenSuccess) return;
  tokenError.style.display = 'none';
  tokenSuccess.style.display = 'none';

  if (!confirm('确定要清除已保存的 GitHub Token 吗？清除后同步功能将不可用。')) {
    return;
  }

  localStorage.removeItem('gallery_github_sync');
  // 同时清除同步状态缓存
  localStorage.removeItem('gallery_github_sync_status');
  tokenInput.value = '';
  updateTokenStatusUI();
  tokenSuccess.textContent = '🗑 Token 已清除';
  tokenSuccess.style.display = 'block';
  if (isAdmin) updateSyncStatusUI();
  setTimeout(() => {
    closeTokenModal();
    tokenSuccess.style.display = 'none';
  }, 1500);
}

/** 初始化 Token 管理弹窗事件 */
function initTokenManagement() {
  if (!tokenModal || !adminTokenBtn) return;

  // 打开弹窗
  adminTokenBtn.addEventListener('click', openTokenModal);

  // 关闭弹窗
  tokenModalClose.addEventListener('click', closeTokenModal);
  tokenModal.addEventListener('click', (e) => {
    if (e.target === tokenModal) closeTokenModal();
  });

  // ESC 关闭
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && tokenModal.classList.contains('active')) {
      closeTokenModal();
    }
  });

  // 保存
  tokenSaveBtn.addEventListener('click', saveToken);

  // 清除
  tokenClearBtn.addEventListener('click', clearToken);

  // 显示/隐藏 Token
  if (tokenToggleVisibility) {
    tokenToggleVisibility.addEventListener('click', () => {
      if (tokenInput.type === 'password') {
        tokenInput.type = 'text';
        tokenToggleVisibility.textContent = '🙈';
      } else {
        tokenInput.type = 'password';
        tokenToggleVisibility.textContent = '👁';
      }
    });
  }

  // Enter 键保存
  tokenInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      saveToken();
    }
  });
}

// ============================================================
//  🔄 GitHub 同步 UI
// ============================================================

/** 构建用于同步的 manifest 对象 */
function buildManifestForSync() {
  if (!MANIFEST) return null;
  const manifest = JSON.parse(JSON.stringify(MANIFEST)); // 深拷贝
  const worksData = loadWorksData();

  // 合并图片 overrides
  if (manifest.images && Array.isArray(manifest.images)) {
    manifest.images = manifest.images.map(img => {
      const saved = worksData[img.name];
      if (saved) {
        return {
          ...img,
          overrides: {
            title: saved.title || img.name,
            category: (typeof saved.category === 'number' && saved.category >= 1 && saved.category <= 5)
              ? saved.category : img.category,
            note: saved.note || '',
            hidden: saved.hidden || false
          }
        };
      }
      return img;
    });
  }

  // 合并自定义音乐
  const customTracks = getCustomMusicTracks();
  if (Array.isArray(customTracks) && customTracks.length > 0) {
    const existingFiles = new Set((manifest.music || []).map(m => m.file));
    const extra = customTracks
      .filter(t => t && t.name && t.file && !existingFiles.has(t.file))
      .map(t => ({ name: t.name, file: t.file, source: 'admin' }));
    manifest.music = [...(manifest.music || []), ...extra];
  }

  manifest.generated = new Date().toISOString();
  manifest.totalImages = manifest.images ? manifest.images.filter(i => !(i.overrides && i.overrides.hidden)).length : 0;

  return manifest;
}

/** 更新同步状态指示器 */
function updateSyncStatusUI() {
  if (!syncStatusBadge) return;

  if (typeof GitHubSync === 'undefined') {
    syncStatusBadge.innerHTML = '⚙️ 同步模块未加载';
    syncStatusBadge.style.color = '#8b7a6b';
    return;
  }

  if (!GitHubSync.isConfigured()) {
    syncStatusBadge.innerHTML = '⚠️ Token 未配置';
    syncStatusBadge.style.color = '#e8986e';
    syncStatusBadge.title = '请编辑 github-api.js 配置 GitHub Token';
    return;
  }

  const status = GitHubSync.getSyncStatus();
  switch (status.status) {
    case 'pushing':
      syncStatusBadge.innerHTML = '⏳ 同步中...';
      syncStatusBadge.style.color = '#d4a853';
      break;
    case 'pending':
      syncStatusBadge.innerHTML = '⏳ 等待同步';
      syncStatusBadge.style.color = '#d4a853';
      syncStatusBadge.title = '编辑已保存，等待推送到 GitHub';
      break;
    case 'error':
      syncStatusBadge.innerHTML = '❌ 同步失败';
      syncStatusBadge.style.color = '#e07070';
      syncStatusBadge.title = status.lastPushError || '未知错误，点击刷新重试';
      break;
    default:
      syncStatusBadge.innerHTML = '✅ 已同步';
      syncStatusBadge.style.color = '#7cb89c';
      syncStatusBadge.title = '数据已同步到 GitHub';
      break;
  }
}

/** 调度 GitHub 同步（含状态更新） */
function scheduleGitHubSync() {
  const manifest = buildManifestForSync();
  if (!manifest) return;
  if (typeof GitHubSync === 'undefined' || !GitHubSync.isConfigured()) {
    updateSyncStatusUI();
    return;
  }
  GitHubSync.schedulePushUpdate(manifest, { force: true });
  updateSyncStatusUI();
  // 延迟再检查一次状态（等待实际推送完成）
  setTimeout(updateSyncStatusUI, 35000);
}

// 定期刷新同步状态
setInterval(() => {
  if (isAdmin && syncStatusBadge && syncStatusBadge.style.display !== 'none') {
    updateSyncStatusUI();
  }
}, 15000);

// ============================================================
function buildImageSources() {
  if (imageSources.length === 0) {
    imageSources = buildDefaultImagesFromManifest();
    applyWorksDataToSources();
    // 过滤隐藏项（同时检查 localStorage 和 manifest overrides）
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
    case 'name-asc':
      list.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
      break;
    case 'name-desc':
      list.sort((a, b) => b.name.localeCompare(a.name, 'zh'));
      break;
    case 'date-desc':
      list.sort((a, b) => (b.mtime || 0) - (a.mtime || 0));
      break;
    case 'date-asc':
      list.sort((a, b) => (a.mtime || 0) - (b.mtime || 0));
      break;
    default:
      break;
  }

  return list;
}

// ===== 分类导航栏 =====
function buildCategoryNav(displayList) {
  if (!categoryNavList) return;
  categoryNavList.innerHTML = '';

  categories.forEach(cat => {
    const catImages = displayList.filter(s => (s.category || 5) === cat.id);
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.className = 'category-nav-link';
    btn.innerHTML = `<span class="nav-icon">${cat.icon}</span> ${escapeHtml(cat.name)} <span class="nav-count">(${catImages.length})</span>`;
    btn.title = cat.name;
    btn.addEventListener('click', () => {
      const section = document.getElementById(`category-${cat.id}`);
      if (section) {
        const navHeight = $('#categoryNav')?.offsetHeight || 0;
        const topbarHeight = 90;
        const offset = navHeight + topbarHeight + 16;
        const top = section.getBoundingClientRect().top + window.pageYOffset - offset;
        window.scrollTo({ top, behavior: 'smooth' });
      }
    });
    li.appendChild(btn);
    categoryNavList.appendChild(li);
  });
}

// 滚动时高亮当前可见分类
let navScrollTicking = false;
function updateActiveNavOnScroll() {
  const sections = categories.map(cat => document.getElementById(`category-${cat.id}`)).filter(Boolean);
  const navLinks = $$('.category-nav-link');
  if (sections.length === 0 || navLinks.length === 0) return;

  let activeIdx = 0;
  const viewTop = window.pageYOffset + 120;

  sections.forEach((section, i) => {
    const rect = section.getBoundingClientRect();
    const sectionTop = rect.top + window.pageYOffset;
    if (sectionTop <= viewTop) activeIdx = i;
  });

  navLinks.forEach((link, i) => link.classList.toggle('active', i === activeIdx));
}

window.addEventListener('scroll', () => {
  if (!navScrollTicking) {
    requestAnimationFrame(() => {
      updateActiveNavOnScroll();
      navScrollTicking = false;
    });
    navScrollTicking = true;
  }
}, { passive: true });

function renderGallery() {
  galleryContainer.innerHTML = '';

  const displayList = getImageDisplayList();

  if (displayList.length === 0) {
    emptyState.style.display = 'block';
    imageCount.textContent = '';
    buildCategoryNav(displayList);
    return;
  }

  emptyState.style.display = 'none';
  imageCount.textContent = `共 ${displayList.length} 张`;

  buildCategoryNav(displayList);

  let totalRendered = 0;

  categories.forEach(cat => {
    const catImages = displayList.filter(s => (s.category || 5) === cat.id);

    const section = document.createElement('section');
    section.className = 'category-section';
    section.id = `category-${cat.id}`;

    const header = document.createElement('div');
    header.className = 'category-header';
    header.innerHTML = `
      <span class="category-header-icon">${cat.icon}</span>
      <div class="category-header-text">
        <h3>${escapeHtml(cat.name)}</h3>
        <p>${escapeHtml(cat.desc)}</p>
      </div>
      <span class="category-header-count">${catImages.length} 张</span>
    `;
    header.addEventListener('click', () => {
      // 点击分类标题折叠/展开
      const grid = section.querySelector('.gallery-grid');
      if (grid) {
        const collapsed = grid.style.display === 'none';
        grid.style.display = collapsed ? '' : 'none';
        header.style.opacity = collapsed ? '1' : '0.6';
      }
    });
    header.style.cursor = 'pointer';
    header.title = '点击折叠/展开';
    section.appendChild(header);

    if (catImages.length > 0) {
      const grid = document.createElement('div');
      grid.className = 'gallery-grid';
      if (isWaterfallLayout) grid.classList.add('waterfall');
      section.appendChild(grid);
      renderCards(catImages, grid);
      totalRendered += catImages.length;
    } else {
      const emptyCard = document.createElement('div');
      emptyCard.className = 'category-empty-card';
      emptyCard.innerHTML = `
        <span class="category-empty-icon">📭</span>
        <p class="category-empty-text">暂无作品</p>
        <p class="category-empty-hint">编辑作品时可将其归类到这里</p>
      `;
      section.appendChild(emptyCard);
    }

    galleryContainer.appendChild(section);
  });

  if (window.requestIdleCallback) {
    requestIdleCallback(() => {
      observeCards();
      updateWaterfallHeights();
    });
  } else {
    setTimeout(() => {
      observeCards();
      updateWaterfallHeights();
    }, 0);
  }

  syncToStorage();
}

function renderCards(cardList, container) {
  const fragment = document.createDocumentFragment();
  cardList.forEach((item) => {
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

  // 骨架屏
  const skeleton = document.createElement('div');
  skeleton.className = 'gallery-card-skeleton';
  card.appendChild(skeleton);

  // 错误状态处理
  const errorOverlay = document.createElement('div');
  errorOverlay.className = 'gallery-card-error';
  errorOverlay.innerHTML = '<span>🖼</span><p>图片加载失败</p>';
  errorOverlay.style.cssText = 'display:none;position:absolute;inset:0;z-index:0;display:none;flex-direction:column;align-items:center;justify-content:center;background:rgba(255,248,240,0.8);color:var(--muted);font-size:0.85rem;border-radius:24px;';
  card.appendChild(errorOverlay);

  // 管理员操作按钮
  if (isAdmin) {
    const actions = document.createElement('div');
    actions.className = 'card-admin-actions';

    const editBtn = document.createElement('button');
    editBtn.className = 'card-admin-btn card-admin-edit';
    editBtn.title = '编辑';
    editBtn.textContent = '✏️';
    editBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      openEditModal(item.name);
    });

    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'card-admin-btn card-admin-delete';
    deleteBtn.title = '删除';
    deleteBtn.textContent = '🗑';
    deleteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      deletePendingFilename = item.name;
      deleteConfirmText.textContent = `确定要删除 「${sanitizeText(item.title || item.name, 200)}」 吗？\n该作品将从画廊中移除（图片文件不会被删除）。`;
      deleteConfirmModal.classList.add('active');
      deleteConfirmModal.setAttribute('aria-hidden', 'false');
    });

    actions.appendChild(editBtn);
    actions.appendChild(deleteBtn);
    card.appendChild(actions);
  }

  // 分类标签
  const cat = categories.find(c => c.id === (item.category || 5));
  if (cat && !filterTerm.trim()) {
    const catBadge = document.createElement('span');
    catBadge.className = 'gallery-card-category';
    catBadge.textContent = cat.icon;
    catBadge.title = cat.name;
    card.appendChild(catBadge);
  }

  // 标签
  const label = document.createElement('span');
  label.className = 'gallery-card-label';
  label.textContent = sanitizeText(item.title || `作品 ${index + 1}`, 200);
  card.appendChild(label);

  // 悬浮遮罩
  const overlay = document.createElement('div');
  overlay.className = 'gallery-card-overlay';
  card.appendChild(overlay);

  // 点击打开 detail 页面
  card.addEventListener('click', (e) => {
    // 如果点击的是管理按钮区域则不触发
    if (e.target.closest('.card-admin-actions')) return;
    const realIndex = imageSources.findIndex(s => s.src === item.src && s.name === item.name);
    if (realIndex >= 0) {
      syncToStorage();
      window.open(`detail.html?index=${realIndex}`, '_blank', 'noopener,noreferrer');
    }
  });

  return card;
}

// ===== 懒加载（含图片加载错误处理）=====
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
  }, {
    rootMargin: '200px 0px',
    threshold: 0.05
  });

  $$('.gallery-card').forEach(card => cardObserver.observe(card));
}

// ===== 瀑布流 =====
function updateWaterfallHeights() {
  if (!isWaterfallLayout) {
    $$('.gallery-card').forEach(card => { card.style.height = ''; });
    return;
  }
  $$('.gallery-card').forEach((card, i) => {
    card.style.height = `${260 + (i % 5) * 30}px`;
  });
}

// ===== Parallax =====
let parallaxTicking = false;
function updateWaterfallParallax() {
  const cards = $$('.gallery-card');
  const viewHeight = window.innerHeight;
  cards.forEach((card) => {
    const rect = card.getBoundingClientRect();
    const cardCenter = rect.top + rect.height / 2;
    const viewCenter = viewHeight / 2;
    const diff = (cardCenter - viewCenter) / viewHeight;
    const offset = diff * 40;
    card.style.setProperty('--parallax', `${offset.toFixed(2)}px`);
  });
}

window.addEventListener('scroll', () => {
  if (!parallaxTicking) {
    requestAnimationFrame(() => {
      updateWaterfallParallax();
      parallaxTicking = false;
    });
    parallaxTicking = true;
  }
}, { passive: true });

// ============================================================
//  🌟 Lightbox（含预加载、触摸滑动）
// ============================================================

// 预加载相邻图片
function preloadAdjacent(index) {
  const toPreload = [];
  for (let i = Math.max(0, index - 2); i <= Math.min(imageSources.length - 1, index + 2); i++) {
    if (i === index) continue;
    const src = imageSources[i].src;
    if (!preloadCache.has(src)) {
      toPreload.push(src);
    }
  }
  toPreload.forEach(src => {
    const img = new Image();
    img.onload = () => preloadCache.set(src, true);
    img.onerror = () => preloadCache.set(src, false);
    img.src = src;
  });
}

function openLightbox(index) {
  if (index < 0 || index >= imageSources.length) return;
  lightboxIndex = index;
  const item = imageSources[index];

  lightboxScale = 1;
  lightboxTranslate = { x: 0, y: 0 };
  applyLightboxTransform();

  lightboxLoader.classList.add('loading');
  lightboxImage.style.opacity = '0';
  lightboxImage.src = item.src;
  lightboxImage.alt = sanitizeText(item.name);

  lightboxImage.onload = () => {
    lightboxLoader.classList.remove('loading');
    lightboxImage.style.opacity = '1';
    preloadAdjacent(index);
  };
  lightboxImage.onerror = () => {
    lightboxLoader.classList.remove('loading');
    lightboxImage.style.opacity = '1';
    // 显示错误占位
    lightboxImage.src = 'data:image/svg+xml,' + encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150" viewBox="0 0 200 150">' +
      '<rect fill="%23fef9f0" width="200" height="150"/><text fill="%238b7a6b" x="100" y="75" text-anchor="middle" font-size="14">图片加载失败</text></svg>'
    );
  };

  updateLightboxInfo();
  lightbox.classList.add('active');
  lightbox.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';

  document.addEventListener('keydown', handleLightboxKeydown);

  // 预加载相邻图片
  preloadAdjacent(index);
}

function closeLightbox() {
  lightbox.classList.remove('active');
  lightbox.setAttribute('aria-hidden', 'true');
  document.body.style.overflow = '';
  lightboxIndex = -1;
  lightboxScale = 1;
  lightboxTranslate = { x: 0, y: 0 };
  document.removeEventListener('keydown', handleLightboxKeydown);
}

function updateLightboxInfo() {
  if (lightboxIndex < 0 || lightboxIndex >= imageSources.length) return;
  const item = imageSources[lightboxIndex];
  lightboxCounter.textContent = `${lightboxIndex + 1} / ${imageSources.length}`;
  lightboxTitle.textContent = sanitizeText(item.title || `作品 ${lightboxIndex + 1}`, 200);

  const cat = categories.find(c => c.id === (item.category || 5));
  if (cat) {
    lightboxCategoryBadge.textContent = `${cat.icon} ${cat.name}`;
    lightboxCategoryBadge.style.display = '';
  } else {
    lightboxCategoryBadge.style.display = 'none';
  }

  const worksData = getWorksData();
  const saved = worksData[item.name];
  const note = saved ? sanitizeText(saved.note || '', 5000) : sanitizeText(item.note || '', 5000);
  lightboxNote.textContent = note || '✏️ 等待贝贝写下回忆...';
  lightboxMemoryTitle.textContent = note ? '📝 贝贝的回忆' : '📝 贝贝的回忆（待填写）';

  lightboxEditBtn.style.display = isAdmin ? '' : 'none';
}

function navigateLightbox(direction) {
  if (imageSources.length === 0) return;
  lightboxIndex = (lightboxIndex + direction + imageSources.length) % imageSources.length;
  const item = imageSources[lightboxIndex];

  lightboxScale = 1;
  lightboxTranslate = { x: 0, y: 0 };
  applyLightboxTransform();

  lightboxLoader.classList.add('loading');
  lightboxImage.style.opacity = '0';
  lightboxImage.src = item.src;
  lightboxImage.alt = sanitizeText(item.name);

  lightboxImage.onload = () => {
    lightboxLoader.classList.remove('loading');
    lightboxImage.style.opacity = '1';
  };
  lightboxImage.onerror = () => {
    lightboxLoader.classList.remove('loading');
  };

  updateLightboxInfo();
  preloadAdjacent(lightboxIndex);
}

function handleLightboxKeydown(e) {
  // 如果焦点在输入框则不处理快捷操作
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;

  switch (e.key) {
    case 'Escape': closeLightbox(); break;
    case 'ArrowLeft': navigateLightbox(-1); break;
    case 'ArrowRight': navigateLightbox(1); break;
    case '+': case '=': zoomLightbox(0.2); break;
    case '-': zoomLightbox(-0.2); break;
    case '0': lightboxScale = 1; lightboxTranslate = { x: 0, y: 0 }; applyLightboxTransform(); break;
    case 'f': case 'F':
      // 全屏切换
      if (document.fullscreenElement) {
        document.exitFullscreen();
      } else {
        lightboxImageArea.requestFullscreen().catch(() => {});
      }
      break;
  }
}

// 触摸滑动支持
let touchStartX = 0;
let touchStartY = 0;
let touchMoved = false;

lightboxImageArea.addEventListener('touchstart', (e) => {
  if (e.touches.length === 1 && lightboxScale <= 1) {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
    touchMoved = false;
  }
}, { passive: true });

lightboxImageArea.addEventListener('touchmove', (e) => {
  if (e.touches.length === 1 && lightboxScale <= 1) {
    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;
    if (Math.abs(dx) > Math.abs(dy)) {
      touchMoved = true;
    }
  }
}, { passive: true });

lightboxImageArea.addEventListener('touchend', (e) => {
  if (!touchMoved || lightboxScale > 1) return;
  const dx = (e.changedTouches[0]?.clientX || 0) - touchStartX;
  if (Math.abs(dx) > 50) {
    navigateLightbox(dx > 0 ? -1 : 1);
  }
});

function zoomLightbox(delta) {
  lightboxScale = Math.max(0.3, Math.min(5, lightboxScale + delta));
  if (lightboxScale <= 0.35) { lightboxTranslate = { x: 0, y: 0 }; }
  applyLightboxTransform();
}

function applyLightboxTransform() {
  lightboxImage.style.transform = `translate(${lightboxTranslate.x}px, ${lightboxTranslate.y}px) scale(${lightboxScale})`;
}

// 事件绑定
lightboxEditBtn.addEventListener('click', () => {
  if (lightboxIndex < 0) return;
  const item = imageSources[lightboxIndex];
  openEditModal(item.name);
});

lightboxZoomIn.addEventListener('click', () => zoomLightbox(0.25));
lightboxZoomOut.addEventListener('click', () => zoomLightbox(-0.25));
lightboxZoomReset.addEventListener('click', () => {
  lightboxScale = 1;
  lightboxTranslate = { x: 0, y: 0 };
  applyLightboxTransform();
});

lightboxImageArea.addEventListener('wheel', (e) => {
  e.preventDefault();
  zoomLightbox(e.deltaY > 0 ? -0.15 : 0.15);
}, { passive: false });

lightboxImageArea.addEventListener('mousedown', (e) => {
  if (lightboxScale <= 1) return;
  isDragging = true;
  dragStart = { x: e.clientX - lightboxTranslate.x, y: e.clientY - lightboxTranslate.y };
  lightboxImageArea.style.cursor = 'grabbing';
});

window.addEventListener('mousemove', (e) => {
  if (!isDragging) return;
  lightboxTranslate.x = e.clientX - dragStart.x;
  lightboxTranslate.y = e.clientY - dragStart.y;
  applyLightboxTransform();
});

window.addEventListener('mouseup', () => {
  isDragging = false;
  lightboxImageArea.style.cursor = lightboxScale > 1 ? 'grab' : 'default';
});

lightboxClose.addEventListener('click', closeLightbox);
lightboxPrev.addEventListener('click', () => navigateLightbox(-1));
lightboxNext.addEventListener('click', () => navigateLightbox(1));

// 点击 backdrop 关闭
$('.lightbox-backdrop').addEventListener('click', closeLightbox);

// 双击图片区域关闭（缩放为 1 时）
lightboxImageArea.addEventListener('dblclick', (e) => {
  if (e.target === lightboxImage && lightboxScale <= 1.05) {
    closeLightbox();
  }
});

// ============================================================
//  🎞 幻灯片
// ============================================================
function toggleSlideshow() {
  isSlideshowActive ? stopSlideshow() : startSlideshow();
}

function startSlideshow() {
  if (imageSources.length === 0) return;
  isSlideshowActive = true;
  slideshowButton.textContent = '⏹ 停止';
  slideshowButton.classList.add('slideshow-active');
  slideshowBar.style.display = 'block';
  if (lightboxIndex < 0) openLightbox(0);
  runSlideshowStep();
}

function stopSlideshow() {
  isSlideshowActive = false;
  slideshowButton.textContent = '▶▶ 幻灯片';
  slideshowButton.classList.remove('slideshow-active');
  slideshowBar.style.display = 'none';
  clearTimeout(slideshowTimer);
}

function runSlideshowStep() {
  if (!isSlideshowActive) return;
  const duration = slideshowInterval;
  const startTime = Date.now();
  function tick() {
    const elapsed = Date.now() - startTime;
    const progress = Math.min((elapsed / duration) * 100, 100);
    slideshowProgress.style.width = `${progress}%`;
    if (elapsed < duration && isSlideshowActive) {
      requestAnimationFrame(tick);
    } else if (isSlideshowActive) {
      slideshowProgress.style.width = '0%';
      navigateLightbox(1);
      slideshowTimer = setTimeout(runSlideshowStep, 300);
    }
  }
  requestAnimationFrame(tick);
}

slideshowButton.addEventListener('click', toggleSlideshow);

// ============================================================
//  🔍 搜索与排序
// ============================================================
searchInput.addEventListener('input', (e) => {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    filterTerm = e.target.value;
    renderGallery();
  }, 200);
});

sortSelect.addEventListener('change', (e) => {
  sortMode = e.target.value;
  renderGallery();
});

// ===== 布局切换 =====
layoutToggle.addEventListener('click', () => {
  isWaterfallLayout = !isWaterfallLayout;
  if (isWaterfallLayout) {
    $$('.gallery-grid').forEach(g => g.classList.add('waterfall'));
    layoutToggle.textContent = '⊞ 网格';
  } else {
    $$('.gallery-grid').forEach(g => g.classList.remove('waterfall'));
    layoutToggle.textContent = '▦ 布局';
  }
  updateWaterfallHeights();
  observeCards();
});

// ============================================================
//  📁 文件夹选择（运行时添加图片）
// ============================================================
function initFolderScanner() {
  folderButton.addEventListener('click', () => folderInput.click());
  folderInput.addEventListener('change', (event) => {
    const files = Array.from(event.target.files || []);
    const images = files.filter(f => /\.(jpe?g|png|webp|gif|bmp|svg)$/i.test(f.name));
    if (images.length === 0) {
      alert('请选择包含图片文件的文件夹。');
      return;
    }
    loadFolderImages(images);
    applyWorksDataToSources();
    renderGallery();
  });
}

function loadFolderImages(files) {
  clearObjectURLs();
  currentObjectURLs = files.map(file => ({
    name: file.name,
    url: URL.createObjectURL(file)
  }));
  imageSources = currentObjectURLs.map((item, i) => ({
    name: item.name,
    src: item.url,
    title: getDefaultTitle(item.name, i),
    note: '',
    category: 5,
    mtime: Date.now()
  }));
}

function clearObjectURLs() {
  currentObjectURLs.forEach(item => {
    try { URL.revokeObjectURL(item.url); } catch (e) { /* ignore */ }
  });
  currentObjectURLs = [];
}

// ============================================================
//  📝 弹窗管理
// ============================================================

// ----- 登录弹窗 -----
function openLoginModal() {
  loginModal.classList.add('active');
  loginModal.setAttribute('aria-hidden', 'false');
  loginUsername.value = '';
  loginPassword.value = '';
  loginError.style.display = 'none';
  setTimeout(() => loginUsername.focus(), 100);
}

function closeLoginModal() {
  loginModal.classList.remove('active');
  loginModal.setAttribute('aria-hidden', 'true');
}

adminEntryBtn.addEventListener('click', () => {
  if (isAdmin) { doLogout(); } else { openLoginModal(); }
});

loginModalClose.addEventListener('click', closeLoginModal);
loginModal.addEventListener('click', (e) => {
  if (e.target === loginModal) closeLoginModal();
});

loginForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const username = loginUsername.value.trim();
  const password = loginPassword.value;

  if (!username || !password) {
    loginError.textContent = '请输入账号和密码';
    loginError.style.display = 'block';
    return;
  }

  loginError.style.display = 'none';
  loginForm.querySelector('.form-submit').disabled = true;
  loginForm.querySelector('.form-submit').textContent = '验证中...';

  try {
    const ok = await doLogin(username, password);
    if (!ok) {
      loginError.textContent = '账号或密码错误，请重试';
      loginError.style.display = 'block';
    }
  } catch (err) {
    loginError.textContent = '验证失败，请重试';
    loginError.style.display = 'block';
  } finally {
    loginForm.querySelector('.form-submit').disabled = false;
    loginForm.querySelector('.form-submit').textContent = '登 录';
  }
});

adminLogoutBtn.addEventListener('click', doLogout);

// ----- GitHub 同步按钮 -----
if (adminSyncNowBtn) {
  adminSyncNowBtn.addEventListener('click', () => {
    if (typeof GitHubSync === 'undefined' || !GitHubSync.isConfigured()) {
      alert('GitHub Token 未配置，请编辑 github-api.js 设置 token');
      return;
    }
    adminSyncNowBtn.textContent = '⏳ 同步中...';
    adminSyncNowBtn.disabled = true;
    const manifest = buildManifestForSync();
    if (!manifest) {
      adminSyncNowBtn.textContent = '🔄 同步';
      adminSyncNowBtn.disabled = false;
      return;
    }
    GitHubSync.schedulePushUpdate(manifest, { force: true });
    updateSyncStatusUI();
    // 轮询结果
    let checks = 0;
    const checkInterval = setInterval(() => {
      const status = GitHubSync.getSyncStatus();
      updateSyncStatusUI();
      checks++;
      if (status.status === 'synced' || status.status === 'error' || checks > 30) {
        clearInterval(checkInterval);
        adminSyncNowBtn.textContent = '🔄 同步';
        adminSyncNowBtn.disabled = false;
      }
    }, 2000);
  });
}

// ----- 编辑弹窗 -----
function openEditModal(filename) {
  const worksData = getWorksData();
  const saved = worksData[filename] || {};

  editFilename.value = sanitizeFilename(filename);
  editTitle.value = sanitizeText(saved.title || getDefaultTitle(filename, imageSources.findIndex(s => s.name === filename)), 200);
  editNote.value = sanitizeText(saved.note || '', 5000);

  editCategory.innerHTML = '';
  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = `${cat.icon} ${cat.name}`;
    if (cat.id === (saved.category || 5)) opt.selected = true;
    editCategory.appendChild(opt);
  });

  editSuccess.style.display = 'none';
  editModal.classList.add('active');
  editModal.setAttribute('aria-hidden', 'false');
}

function closeEditModal() {
  editModal.classList.remove('active');
  editModal.setAttribute('aria-hidden', 'true');
  deletePendingFilename = null;
}

editModalClose.addEventListener('click', closeEditModal);
editModal.addEventListener('click', (e) => {
  if (e.target === editModal) closeEditModal();
});

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
  if (idx >= 0) {
    imageSources[idx].title = title || `作品 ${idx + 1}`;
    imageSources[idx].note = note;
    imageSources[idx].category = category;
  }

  editSuccess.style.display = 'block';
  setTimeout(() => { editSuccess.style.display = 'none'; }, 1500);
  syncToStorage();
  renderGallery();
  if (lightboxIndex >= 0) updateLightboxInfo();
  // 调度 GitHub 同步
  scheduleGitHubSync();
});

editDeleteBtn.addEventListener('click', () => {
  deletePendingFilename = editFilename.value;
  const title = sanitizeText(editTitle.value.trim() || deletePendingFilename, 200);
  deleteConfirmText.textContent = `确定要删除 「${title}」 吗？\n该作品将从画廊中移除（图片文件不会被删除）。`;
  deleteConfirmModal.classList.add('active');
  deleteConfirmModal.setAttribute('aria-hidden', 'false');
});

// ----- 删除确认弹窗 -----
deleteCancelBtn.addEventListener('click', () => {
  deleteConfirmModal.classList.remove('active');
  deleteConfirmModal.setAttribute('aria-hidden', 'true');
  deletePendingFilename = null;
});

deleteConfirmBtn.addEventListener('click', () => {
  if (deletePendingFilename) {
    const worksData = loadWorksData();
    worksData[deletePendingFilename] = { ...worksData[deletePendingFilename], hidden: true };
    saveWorksData(worksData);
    imageSources = imageSources.filter(s => s.name !== deletePendingFilename);
    deletePendingFilename = null;
    closeEditModal();
    renderGallery();
    if (lightboxIndex >= imageSources.length) closeLightbox();
    // 调度 GitHub 同步
    scheduleGitHubSync();
  }
  deleteConfirmModal.classList.remove('active');
  deleteConfirmModal.setAttribute('aria-hidden', 'true');
});

deleteConfirmModal.addEventListener('click', (e) => {
  if (e.target === deleteConfirmModal) {
    deleteConfirmModal.classList.remove('active');
    deleteConfirmModal.setAttribute('aria-hidden', 'true');
    deletePendingFilename = null;
  }
});

// ----- 添加作品弹窗 -----
function openAddModal() {
  addImageFile.value = '';
  addFilename.value = '';
  addTitle.value = '';
  addNote.value = '';
  addError.style.display = 'none';
  addSuccess.style.display = 'none';

  addCategory.innerHTML = '';
  categories.forEach(cat => {
    const opt = document.createElement('option');
    opt.value = cat.id;
    opt.textContent = `${cat.icon} ${cat.name}`;
    if (cat.id === 5) opt.selected = true;
    addCategory.appendChild(opt);
  });

  addModal.classList.add('active');
  addModal.setAttribute('aria-hidden', 'false');
}

function closeAddModal() {
  addModal.classList.remove('active');
  addModal.setAttribute('aria-hidden', 'true');
}

addModalClose.addEventListener('click', closeAddModal);
addModal.addEventListener('click', (e) => {
  if (e.target === addModal) closeAddModal();
});

adminAddBtn.addEventListener('click', openAddModal);

addForm.addEventListener('submit', (e) => {
  e.preventDefault();
  addError.style.display = 'none';
  addSuccess.style.display = 'none';

  const file = addImageFile.files[0];
  const manualName = sanitizeFilename(addFilename.value.trim());
  const title = sanitizeText(addTitle.value.trim(), 200);
  const note = sanitizeText(addNote.value.trim(), 5000);
  const category = Math.max(1, Math.min(5, parseInt(addCategory.value) || 5));

  if (file && !/^image\//.test(file.type)) {
    addError.textContent = '请选择有效的图片文件';
    addError.style.display = 'block';
    return;
  }

  let filename, src;

  if (file) {
    filename = sanitizeFilename(file.name);
    src = URL.createObjectURL(file);
    currentObjectURLs.push({ name: filename, url: src });
  } else if (manualName) {
    filename = manualName;
    src = manualName;
  } else {
    addError.textContent = '请选择图片文件或输入文件名';
    addError.style.display = 'block';
    return;
  }

  if (imageSources.some(s => s.name === filename) && !file) {
    addError.textContent = '该文件名已存在，请勿重复添加';
    addError.style.display = 'block';
    return;
  }

  const worksData = loadWorksData();
  worksData[filename] = { title: title || filename, note, category, hidden: false };
  saveWorksData(worksData);

  if (!imageSources.some(s => s.name === filename)) {
    imageSources.push({ name: filename, src, title: title || filename, note, category, mtime: Date.now() });
  }

  addSuccess.textContent = `✅ 「${title || filename}」添加成功！`;
  addSuccess.style.display = 'block';
  addImageFile.value = '';
  addFilename.value = '';
  addTitle.value = '';
  addNote.value = '';

  setTimeout(() => {
    addSuccess.style.display = 'none';
    closeAddModal();
    syncToStorage();
    renderGallery();
    // 调度 GitHub 同步
    scheduleGitHubSync();
  }, 800);
});

// ============================================================
//  ✨ 粒子背景
// ============================================================
function resizeCanvas() {
  const w = window.innerWidth, h = window.innerHeight;
  const dpr = devicePixelRatio || 1;

  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  sakuraCanvas.width = w * dpr;
  sakuraCanvas.height = h * dpr;
  sakuraCanvas.style.width = `${w}px`;
  sakuraCanvas.style.height = `${h}px`;
  sakuraCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

const particles = [];
const particleCount = 50;
let spatialGrid = new Map();
const GRID_CELL = 120;

function setupParticles() {
  particles.length = 0;
  for (let i = 0; i < particleCount; i++) {
    particles.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * window.innerHeight,
      vx: (Math.random() - 0.5) * 0.4,
      vy: (Math.random() - 0.5) * 0.4,
      radius: 1 + Math.random() * 2,
      alpha: 0.04 + Math.random() * 0.12
    });
  }
}

function buildSpatialGrid() {
  spatialGrid.clear();
  particles.forEach((p, i) => {
    const key = `${Math.floor(p.x / GRID_CELL)},${Math.floor(p.y / GRID_CELL)}`;
    if (!spatialGrid.has(key)) spatialGrid.set(key, []);
    spatialGrid.get(key).push(i);
  });
}

function animateParticles() {
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  particles.forEach((p) => {
    p.x += p.vx; p.y += p.vy;
    if (p.x < -40) p.x = window.innerWidth + 40;
    if (p.x > window.innerWidth + 40) p.x = -40;
    if (p.y < -40) p.y = window.innerHeight + 40;
    if (p.y > window.innerHeight + 40) p.y = -40;
    ctx.beginPath();
    ctx.fillStyle = `rgba(124, 184, 156, ${p.alpha})`;
    ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
    ctx.fill();
  });

  buildSpatialGrid();
  const checked = new Set();
  spatialGrid.forEach((indices, key) => {
    const [gx, gy] = key.split(',').map(Number);
    for (let dx = 0; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        if (dx === 0 && dy < 0) continue;
        const nKey = `${gx + dx},${gy + dy}`;
        const nIndices = spatialGrid.get(nKey);
        if (!nIndices) continue;
        indices.forEach((i) => {
          nIndices.forEach((j) => {
            if (i >= j) return;
            const pairKey = `${Math.min(i, j)}-${Math.max(i, j)}`;
            if (checked.has(pairKey)) return;
            checked.add(pairKey);
            const dxP = particles[i].x - particles[j].x;
            const dyP = particles[i].y - particles[j].y;
            const dist = Math.hypot(dxP, dyP);
            if (dist < 120) {
              ctx.strokeStyle = `rgba(124, 184, 156, ${0.05 - dist * 0.00035})`;
              ctx.lineWidth = 0.8;
              ctx.beginPath();
              ctx.moveTo(particles[i].x, particles[i].y);
              ctx.lineTo(particles[j].x, particles[j].y);
              ctx.stroke();
            }
          });
        });
      }
    }
  });

  requestAnimationFrame(animateParticles);
}

// ============================================================
//  🌸 樱花飘落
// ============================================================
const sakuraPetals = [];
const SAKURA_COUNT = 35;

function drawSakuraPetal(ctx, x, y, size, rotation, alpha, color) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rotation);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;

  const w = size * 0.35;
  const h = size * 0.55;

  ctx.beginPath();
  ctx.moveTo(0, -h);
  ctx.bezierCurveTo(w, -h * 0.6, w, h * 0.3, 0, h);
  ctx.bezierCurveTo(-w, h * 0.3, -w, -h * 0.6, 0, -h);
  ctx.fill();

  ctx.restore();
}

function setupSakura() {
  sakuraPetals.length = 0;
  const colors = [
    'rgba(255, 183, 197, VAR)',
    'rgba(255, 160, 180, VAR)',
    'rgba(255, 200, 210, VAR)',
    'rgba(255, 175, 190, VAR)',
    'rgba(255, 190, 200, VAR)',
  ];

  for (let i = 0; i < SAKURA_COUNT; i++) {
    const baseColor = colors[Math.floor(Math.random() * colors.length)];
    sakuraPetals.push({
      x: Math.random() * window.innerWidth,
      y: Math.random() * -window.innerHeight,
      size: 8 + Math.random() * 18,
      speedY: 0.3 + Math.random() * 1.2,
      speedX: -0.3 + Math.random() * 0.6,
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.03,
      sway: Math.random() * Math.PI * 2,
      swaySpeed: 0.01 + Math.random() * 0.02,
      swayAmount: 0.5 + Math.random() * 2.5,
      alpha: 0.3 + Math.random() * 0.5,
      baseColor: baseColor,
      flicker: Math.random() * 0.1
    });
  }
}

function animateSakura() {
  sakuraCtx.clearRect(0, 0, window.innerWidth, window.innerHeight);

  sakuraPetals.forEach((petal) => {
    petal.y += petal.speedY;
    petal.sway += petal.swaySpeed;
    petal.x += petal.speedX + Math.sin(petal.sway) * petal.swayAmount * 0.3;
    petal.rotation += petal.rotationSpeed;

    if (petal.y > window.innerHeight + 40) {
      petal.y = -40;
      petal.x = Math.random() * window.innerWidth;
    }
    if (petal.x < -40) petal.x = window.innerWidth + 40;
    if (petal.x > window.innerWidth + 40) petal.x = -40;

    const flickerAlpha = petal.alpha + (Math.sin(Date.now() * 0.003 + petal.flicker) * 0.06);
    const color = petal.baseColor.replace('VAR', Math.max(0, Math.min(1, flickerAlpha)).toFixed(2));

    drawSakuraPetal(sakuraCtx, petal.x, petal.y, petal.size, petal.rotation, Math.max(0.15, flickerAlpha), color);
  });

  requestAnimationFrame(animateSakura);
}

// ============================================================
//  🚀 初始化
// ============================================================
window.addEventListener('resize', () => {
  resizeCanvas();
  updateWaterfallParallax();
});

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
  setupParticles();
  animateParticles();
  setupSakura();
  animateSakura();

  updateWaterfallParallax();

  // 处理从 detail.html 传来的编辑请求
  const hash = window.location.hash;
  if (hash.startsWith('#edit=')) {
    const filename = decodeURIComponent(hash.slice(6));
    if (filename && !/[<>]/.test(filename) && imageSources.some(s => s.name === filename)) {
      openEditModal(filename);
    }
    history.replaceState(null, '', window.location.pathname + window.location.search);
  }

  // 键盘快捷键提示（按 ? 显示）
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      e.preventDefault();
      showKeyboardShortcuts();
    }
  });

  // 页面卸载时清理
  window.addEventListener('beforeunload', () => {
    clearObjectURLs();
    if (cardObserver) cardObserver.disconnect();
    preloadCache.clear();
  });

  // 检查清单版本更新
  if (MANIFEST) {
    console.log(`🌸 画廊已加载: ${MANIFEST.totalImages} 张图片, 生成于 ${MANIFEST.generated}`);
  } else {
    console.warn('⚠ 未加载清单文件，使用回退模式。请运行 node scan-manifest.js');
  }
});

/** 显示键盘快捷键指引 */
function showKeyboardShortcuts() {
  const existing = document.getElementById('shortcuts-tooltip');
  if (existing) {
    existing.remove();
    return;
  }

  const tip = document.createElement('div');
  tip.id = 'shortcuts-tooltip';
  tip.innerHTML = `
    <div style="position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);z-index:3000;
      background:rgba(255,252,247,0.98);border:1px solid var(--border-light, #ddd);
      border-radius:20px;padding:28px 32px;box-shadow:0 20px 60px rgba(0,0,0,0.15);
      backdrop-filter:blur(20px);min-width:320px;font-size:0.9rem;line-height:2;color:#3d2e1f;">
      <h3 style="margin:0 0 14px;font-size:1.2rem;text-align:center;">⌨️ 键盘快捷键</h3>
      <div style="display:grid;grid-template-columns:auto 1fr;gap:6px 16px;">
        <span style="font-weight:600;">← →</span><span>上一张 / 下一张（Lightbox）</span>
        <span style="font-weight:600;">ESC</span><span>关闭 Lightbox / 弹窗</span>
        <span style="font-weight:600;">+/-</span><span>放大 / 缩小图片</span>
        <span style="font-weight:600;">0</span><span>重置缩放</span>
        <span style="font-weight:600;">F</span><span>全屏模式</span>
        <span style="font-weight:600;">?</span><span>显示/隐藏此帮助</span>
        <span style="font-weight:600;">滚轮</span><span>缩放图片</span>
        <span style="font-weight:600;">双击</span><span>关闭 Lightbox</span>
        <span style="font-weight:600;">←→滑动</span><span>移动端左右滑动切换</span>
      </div>
      <button style="display:block;margin:18px auto 0;padding:8px 24px;border-radius:999px;
        border:1px solid rgba(139,122,107,0.2);background:rgba(139,122,107,0.06);
        color:#3d2e1f;cursor:pointer;font-size:0.9rem;font-family:inherit;"
        onclick="this.closest('#shortcuts-tooltip').remove()">关闭</button>
    </div>
  `;
  document.body.appendChild(tip);

  // 点击背景关闭
  tip.addEventListener('click', (e) => {
    if (e.target === tip) tip.remove();
  });
}
