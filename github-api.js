// ============================================================
//  github-api.js — GitHub API 同步模块（v2 支持排序数据）
//  功能：读取/写入 manifest.js 到 GitHub 仓库，触发 Pages 部署
//  用法：在 manifest.js 之后、script.js 之前加载
// ============================================================

const GitHubSync = (() => {
  const CONFIG = {
    owner: 'xiex16070-jpg',
    repo: 'Aoharu',
    branch: 'main',
    manifestPath: 'manifest.js',
    get token() { return getToken(); }
  };

  const STORAGE_KEY = 'gallery_github_sync';

  function getToken() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return saved;

    const inputToken = prompt(
      '🔑 请输入 GitHub Personal Access Token\n\n' +
      '提示：登录管理员后可在顶部工具栏点击「🔑 Token」按钮设置。\n\n' +
      '权限要求：Contents (Read and Write)', ''
    );

    if (inputToken && inputToken.startsWith('github_pat_') && inputToken.length > 40) {
      localStorage.setItem(STORAGE_KEY, inputToken);
      return inputToken;
    } else {
      throw new Error('GitHub Token 未提供');
    }
  }

  window.GitHubTokenManager = {
    setToken() {
      const token = prompt('请输入完整的 GitHub PAT (github_pat_ 开头):');
      if (token && token.startsWith('github_pat_') && token.length > 40) {
        localStorage.setItem(STORAGE_KEY, token);
        alert('✅ Token 已成功保存！');
      } else if (token) { alert('❌ Token 格式错误'); }
    },
    showStatus() {
      const token = localStorage.getItem(STORAGE_KEY);
      if (token) { console.log('✅ Token 已设置，长度:', token.length); }
      else { console.log('❌ Token 未设置'); }
    },
    clearToken() {
      if (confirm('确定要清除 GitHub Token 吗？')) { localStorage.removeItem(STORAGE_KEY); alert('✅ Token 已清除'); }
    }
  };

  const EDIT_COOLDOWN_MS = 30 * 1000;
  const FULL_SYNC_COOLDOWN_MS = 6 * 60 * 60 * 1000;
  const MAX_RETRIES = 3;

  let debounceTimer = null;
  let pendingManifest = null;
  let retryCount = 0;

  function loadSyncStatus() {
    try { const raw = localStorage.getItem(STORAGE_KEY + '_status'); return raw ? JSON.parse(raw) : {}; }
    catch (e) { return {}; }
  }

  function saveSyncStatus(status) {
    try {
      const current = loadSyncStatus();
      const merged = { ...current, ...status, updated: Date.now() };
      localStorage.setItem(STORAGE_KEY + '_status', JSON.stringify(merged));
    } catch (e) {}
  }

  function getSyncStatus() { return loadSyncStatus(); }

  function isConfigured() {
    const token = localStorage.getItem(STORAGE_KEY);
    return !!(token && token.startsWith('github_pat_') && token.length > 40);
  }

  async function validateToken() {
    if (!isConfigured()) return { valid: false, error: 'Token 未配置' };
    try {
      const response = await fetch(`https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}`, {
        headers: { Authorization: `Bearer ${CONFIG.token}`, Accept: 'application/vnd.github+json' }
      });
      if (response.ok) return { valid: true };
      if (response.status === 401) return { valid: false, error: 'Token 无效' };
      if (response.status === 403) return { valid: false, error: 'Token 权限不足' };
      return { valid: false, error: `HTTP ${response.status}` };
    } catch (e) { return { valid: false, error: e.message }; }
  }

  async function fetchManifest() {
    if (!isConfigured()) throw new Error('GitHub Token 未配置');
    const url = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${CONFIG.manifestPath}?ref=${CONFIG.branch}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${CONFIG.token}`, Accept: 'application/vnd.github+json' }
    });
    if (!response.ok) throw new Error(`读取 manifest 失败 (${response.status})`);
    const data = await response.json();
    return { content: decodeBase64(data.content), sha: data.sha };
  }

  async function pushManifest(manifestObj, sha, commitMessage) {
    if (!isConfigured()) throw new Error('GitHub Token 未配置');
    if (!sha) {
      try { const fetched = await fetchManifest(); sha = fetched.sha; }
      catch (e) { if (e.message.includes('404')) sha = null; else throw e; }
    }

    const content = buildManifestContent(manifestObj);
    const body = { message: commitMessage || '🔧 管理员更新作品数据', content: encodeBase64(content), branch: CONFIG.branch };
    if (sha) body.sha = sha;

    const url = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${CONFIG.manifestPath}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${CONFIG.token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errBody = await response.text();
      if (response.status === 409) throw new Error('conflict: manifest 在远端已被修改');
      if (response.status === 401) throw new Error('Token 无效或已过期');
      throw new Error(`推送失败 (${response.status}): ${errBody}`);
    }

    const result = await response.json();
    saveSyncStatus({ lastEditPush: Date.now(), lastPushResult: 'success', lastPushError: null });
    return result;
  }

  function buildManifestContent(manifestObj) {
    const now = new Date().toISOString();
    const totalImages = manifestObj.images ? manifestObj.images.length : 0;
    const json = JSON.stringify(manifestObj, null, 2);
    const checksum = simpleHash(json);
    return [
      '// 自动生成 — 请勿手动编辑',
      `// 生成时间: ${now}`,
      `// 图片总数: ${totalImages}`,
      `// 校验码: ${checksum}`,
      '// 运行 node scan-manifest.js 刷新',
      '',
      `const GALLERY_MANIFEST = ${json};`,
      ''
    ].join('\n');
  }

  function simpleHash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 = Math.imul(h1 ^ (h1 >>> 13), 3266489909); h1 ^= (h1 >>> 16);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 = Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 ^= (h2 >>> 16);
    return (h1 + h2).toString(16).slice(0, 16);
  }

  function encodeBase64(str) {
    const bytes = new TextEncoder().encode(str);
    let binary = ''; bytes.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary);
  }

  function decodeBase64(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  function mergeLocalOverrides(baseManifest) {
    if (!baseManifest) return null;
    const manifest = JSON.parse(JSON.stringify(baseManifest));

    let worksData = {};
    try { const raw = localStorage.getItem('gallery_admin_data'); if (raw) worksData = JSON.parse(raw); } catch (e) {}

    if (manifest.images && Array.isArray(manifest.images)) {
      manifest.images = manifest.images.map(img => {
        const saved = worksData[img.name];
        if (saved) {
          return { ...img, overrides: { title: saved.title || img.name, category: (typeof saved.category === 'number' && saved.category >= 1 && saved.category <= 5) ? saved.category : img.category, note: saved.note || '', hidden: saved.hidden || false } };
        }
        return img;
      });
    }

    let customTracks = [];
    try { const raw = localStorage.getItem('gallery_bg_music_custom'); if (raw) customTracks = JSON.parse(raw); } catch (e) {}
    if (Array.isArray(customTracks) && customTracks.length > 0) {
      const existingFiles = new Set((manifest.music || []).map(m => m.file));
      const extra = customTracks.filter(t => t && t.name && t.file && !existingFiles.has(t.file)).map(t => ({ name: t.name, file: t.file, source: 'admin' }));
      manifest.music = [...(manifest.music || []), ...extra];
    }

    // Merge image order data
    try {
      const orderRaw = localStorage.getItem('gallery_image_order');
      if (orderRaw) {
        const orderData = JSON.parse(orderRaw);
        if (orderData && typeof orderData === 'object' && Object.keys(orderData).length > 0) {
          manifest.imageOrder = orderData;
        }
      }
    } catch (e) {}

    manifest.generated = new Date().toISOString();
    manifest.totalImages = manifest.images ? manifest.images.filter(i => !(i.overrides && i.overrides.hidden)).length : 0;
    return manifest;
  }

  function schedulePushUpdate(manifestObj, opts = {}) {
    if (!isConfigured()) { saveSyncStatus({ lastPushResult: 'skipped', lastPushError: 'Token 未配置' }); return; }
    pendingManifest = manifestObj;

    if (opts.immediate) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => { doPushWithRetry(pendingManifest); pendingManifest = null; }, EDIT_COOLDOWN_MS);
      saveSyncStatus({ status: 'pending' }); return;
    }

    if (opts.force) {
      clearTimeout(debounceTimer); debounceTimer = null;
      doPushWithRetry(pendingManifest); pendingManifest = null; return;
    }

    const status = getSyncStatus();
    const elapsed = status.lastFullSync ? (Date.now() - status.lastFullSync) : Infinity;
    if (elapsed < FULL_SYNC_COOLDOWN_MS) return;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => { doPushWithRetry(pendingManifest); pendingManifest = null; }, EDIT_COOLDOWN_MS);
    saveSyncStatus({ status: 'pending' });
  }

  function flushQueue() {
    clearTimeout(debounceTimer); debounceTimer = null;
    if (pendingManifest) { const m = pendingManifest; pendingManifest = null; return doPushWithRetry(m); }
    return Promise.resolve();
  }

  async function doPushWithRetry(manifestObj, attempt = 0) {
    if (!manifestObj) return;
    saveSyncStatus({ status: 'pushing' });
    try {
      await pushManifest(manifestObj);
      retryCount = 0;
      saveSyncStatus({ status: 'synced', lastEditPush: Date.now(), lastFullSync: Date.now(), lastPushResult: 'success', lastPushError: null });
      console.log('GitHubSync: ✅ 同步成功');
    } catch (err) {
      const msg = err.message || String(err);
      console.error(`GitHubSync: ❌ 同步失败 (${attempt + 1}/${MAX_RETRIES + 1}):`, msg);

      if (msg.includes('conflict') && attempt < MAX_RETRIES) {
        try {
          const fetched = await fetchManifest();
          const remoteJson = fetched.content.match(/const GALLERY_MANIFEST\s*=\s*(\{[\s\S]*?\});/)?.[1];
          if (!remoteJson) throw new Error('无法解析远端 manifest');
          const remoteManifest = JSON.parse(remoteJson);
          const merged = mergeLocalOverrides(remoteManifest);
          await pushManifest(merged, fetched.sha);
          retryCount = 0;
          saveSyncStatus({ status: 'synced', lastEditPush: Date.now(), lastFullSync: Date.now(), lastPushResult: 'success', lastPushError: null });
          console.log('GitHubSync: ✅ 冲突解决成功'); return;
        } catch (retryErr) { console.error('GitHubSync: 冲突重试失败:', retryErr.message); }
      }

      if (attempt < MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * 1000;
        await sleep(delay);
        return doPushWithRetry(manifestObj, attempt + 1);
      }

      retryCount = 0;
      saveSyncStatus({ status: 'error', lastPushResult: 'error', lastPushError: msg });
    }
  }

  function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

  async function tryAutoSyncFromGitHub() {
    if (!isConfigured()) return { synced: false, reason: 'Token 未配置' };
    const status = getSyncStatus();
    const elapsed = status.lastPullSync ? (Date.now() - status.lastPullSync) : Infinity;
    if (elapsed < 3600000) return { synced: false, reason: '冷却中' };

    try {
      const fetched = await fetchManifest();
      saveSyncStatus({ lastPullSync: Date.now() });

      const jsonStr = fetched.content.match(/const GALLERY_MANIFEST\s*=\s*(\{[\s\S]*?\});/)?.[1];
      if (!jsonStr) throw new Error('无法解析远端 manifest');
      const remoteManifest = JSON.parse(jsonStr);

      const localGen = (typeof GALLERY_MANIFEST !== 'undefined' && GALLERY_MANIFEST.generated) ? GALLERY_MANIFEST.generated : null;
      if (remoteManifest.generated && localGen && remoteManifest.generated <= localGen) {
        return { synced: false, reason: '本地已是最新' };
      }

      applyRemoteOverrides(remoteManifest);
      return { synced: true, manifest: remoteManifest };
    } catch (e) {
      console.warn('GitHubSync: 拉取失败:', e.message);
      return { synced: false, reason: e.message };
    }
  }

  function applyRemoteOverrides(remoteManifest) {
    if (!remoteManifest || !remoteManifest.images) return;

    const worksData = {};
    try { const raw = localStorage.getItem('gallery_admin_data'); if (raw) Object.assign(worksData, JSON.parse(raw)); } catch (e) {}

    let hasChanges = false;
    remoteManifest.images.forEach(img => {
      if (img.overrides) {
        const existing = worksData[img.name] || {};
        const merged = { ...existing, title: img.overrides.title || existing.title || img.name, category: img.overrides.category || existing.category || img.category, note: img.overrides.note || existing.note || '' };
        if (JSON.stringify(existing) !== JSON.stringify(merged)) { worksData[img.name] = merged; hasChanges = true; }
      }
    });

    // Apply remote image order
    if (remoteManifest.imageOrder && typeof remoteManifest.imageOrder === 'object') {
      try {
        const localOrder = localStorage.getItem('gallery_image_order');
        const localOrderObj = localOrder ? JSON.parse(localOrder) : {};
        // Merge: remote wins for categories not locally modified recently
        const mergedOrder = { ...localOrderObj, ...remoteManifest.imageOrder };
        localStorage.setItem('gallery_image_order', JSON.stringify(mergedOrder));
        hasChanges = true;
      } catch (e) {}
    }

    if (remoteManifest.music) {
      let customTracks = [];
      try { const raw = localStorage.getItem('gallery_bg_music_custom'); if (raw) customTracks = JSON.parse(raw); } catch (e) {}
      const existingFiles = new Set(customTracks.map(t => t.file));
      const newTracks = remoteManifest.music.filter(m => m.source === 'admin' && !existingFiles.has(m.file)).map(m => ({ name: m.name, file: m.file, source: 'admin' }));
      if (newTracks.length > 0) {
        customTracks = [...customTracks, ...newTracks];
        try { localStorage.setItem('gallery_bg_music_custom', JSON.stringify(customTracks)); } catch (e) {}
        hasChanges = true;
      }
    }

    if (hasChanges) {
      try { localStorage.setItem('gallery_admin_data', JSON.stringify(worksData)); } catch (e) {}
    }
  }

  return {
    CONFIG, isConfigured, validateToken, fetchManifest, pushManifest, buildManifestContent,
    mergeLocalOverrides, schedulePushUpdate, flushQueue, getSyncStatus,
    tryAutoSyncFromGitHub, applyRemoteOverrides, encodeBase64, decodeBase64,
  };
})();

if (typeof GALLERY_MANIFEST !== 'undefined') {
  window.addEventListener('DOMContentLoaded', () => {
    const isAdmin = (sessionStorage.getItem('gallery_admin_auth') || localStorage.getItem('gallery_admin_auth')) === 'true';
    if (isAdmin && GitHubSync.isConfigured()) {
      GitHubSync.tryAutoSyncFromGitHub().then(result => {
        if (result.synced) { console.log('GitHubSync: 🌐 已拉取最新数据'); location.reload(); }
      }).catch(() => {});
    }
  });
}