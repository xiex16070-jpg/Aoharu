// ============================================================
//  github-api.js — GitHub API 同步模块
//  功能：读取/写入 manifest.js 到 GitHub 仓库，触发 Pages 部署
//  用法：在 manifest.js 之后、script.js 之前加载
// ============================================================

const GitHubSync = (() => {
  // ---- 配置 ----
   // ---- 配置 ----
  const CONFIG = {
    owner: 'xiex16070-jpg',
    repo: 'memory',
    branch: 'main',
    manifestPath: 'manifest.js',

    // Token 由管理员手动输入并保存在 localStorage 中
    get token() {
      return getToken();
    }
  };

  const STORAGE_KEY = 'gallery_github_sync';
    // ===== Token 管理 =====
  function getToken() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return saved;

    // 没有 Token 时 — 优先提示使用管理员面板中的 Token 设置
    // 如果已登录管理员，使用 prompt 作为后备
    const inputToken = prompt(
      '🔑 请输入 GitHub Personal Access Token\n\n' +
      '提示：登录管理员后可在顶部工具栏点击「🔑 Token」按钮设置。\n\n' +
      '权限要求：Contents (Read and Write)',
      ''
    );

    if (inputToken && inputToken.startsWith('github_pat_') && inputToken.length > 40) {
      localStorage.setItem(STORAGE_KEY, inputToken);
      console.log('✅ GitHub Token 已保存');
      return inputToken;
    } else {
      console.warn('❌ Token 输入取消或格式错误');
      console.info('💡 提示：登录管理员后可点击顶部工具栏的「🔑 Token」按钮设置');
      throw new Error('GitHub Token 未提供');
    }
  }

  // Token 管理工具（可在控制台调用，也可通过管理员面板「🔑 Token」按钮操作）
  window.GitHubTokenManager = {
    setToken() {
      console.info('💡 推荐使用管理员面板中的「🔑 Token」按钮设置。');
      const token = prompt('请输入完整的 GitHub PAT (github_pat_ 开头):');
      if (token && token.startsWith('github_pat_') && token.length > 40) {
        localStorage.setItem(STORAGE_KEY, token);
        alert('✅ Token 已成功保存！');
        console.log('✅ Token 已更新');
      } else if (token) {
        alert('❌ Token 格式错误，必须以 github_pat_ 开头且长度足够');
      }
    },

    showStatus() {
      const token = localStorage.getItem(STORAGE_KEY);
      if (token) {
        console.log('✅ Token 已设置');
        console.log('长度:', token.length);
        console.log('前20位:', token.substring(0, 20) + '...');
      } else {
        console.log('❌ Token 未设置');
        console.info('💡 登录管理员后点击顶部「🔑 Token」按钮设置');
      }
    },

    clearToken() {
      if (confirm('确定要清除保存的 GitHub Token 吗？')) {
        localStorage.removeItem(STORAGE_KEY);
        alert('✅ Token 已清除');
        console.log('🗑️ Token 已清除');
      }
    }
  };
  const EDIT_COOLDOWN_MS = 30 * 1000;           // 单次编辑防抖窗口
  const FULL_SYNC_COOLDOWN_MS = 6 * 60 * 60 * 1000; // 完整同步冷却期 6h
  const MAX_RETRIES = 3;

  // ---- 状态 ----
  let debounceTimer = null;
  let pendingManifest = null;
  let retryCount = 0;

  // ===== 同步状态管理 =====
 function loadSyncStatus() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY + '_status');  // ← 改这里
    return raw ? JSON.parse(raw) : {};
  } catch (e) { return {}; }
}

  function saveSyncStatus(status) {
    try {
      const current = loadSyncStatus();
      const merged = { ...current, ...status, updated: Date.now() };
     localStorage.setItem(STORAGE_KEY + '_status', JSON.stringify(merged));
    } catch (e) { /* ignore */ }
  }

  function getSyncStatus() {
    return loadSyncStatus();
  }

  // ===== Token 管理 =====
   function isConfigured() {
    const token = localStorage.getItem(STORAGE_KEY);
    return !!(token && token.startsWith('github_pat_') && token.length > 40);
  }

  async function validateToken() {
    if (!isConfigured()) return { valid: false, error: 'Token 未配置' };
    try {
      const response = await fetch(
        `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}`,
        { headers: { Authorization: `Bearer ${CONFIG.token}`, Accept: 'application/vnd.github+json' } }
      );
      if (response.ok) return { valid: true };
      if (response.status === 401) return { valid: false, error: 'Token 无效或已过期' };
      if (response.status === 403) return { valid: false, error: 'Token 权限不足或被限流' };
      return { valid: false, error: `HTTP ${response.status}` };
    } catch (e) {
      return { valid: false, error: e.message };
    }
  }

  // ===== GitHub API 核心 =====
  /**
   * 读取 manifest.js 内容（从 GitHub 仓库）
   * @returns {{content: string, sha: string}|null}
   */
  async function fetchManifest() {
    if (!isConfigured()) throw new Error('GitHub Token 未配置');
    const url = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${CONFIG.manifestPath}?ref=${CONFIG.branch}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${CONFIG.token}`, Accept: 'application/vnd.github+json' }
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`读取 manifest 失败 (${response.status}): ${body}`);
    }
    const data = await response.json();
    const content = decodeBase64(data.content);
    return { content, sha: data.sha };
  }

  /**
   * 写入 manifest.js 到 GitHub 仓库
   * @param {object} manifestObj - GALLERY_MANIFEST 对象
   * @param {string} [sha] - 已知 blob SHA（省略则先 fetch）
   * @param {string} [commitMessage] - 自定义提交消息
   */
  async function pushManifest(manifestObj, sha, commitMessage) {
    if (!isConfigured()) throw new Error('GitHub Token 未配置');

    // 如果没有提供 sha，先 fetch 获取最新
    if (!sha) {
      try {
        const fetched = await fetchManifest();
        sha = fetched.sha;
      } catch (e) {
        // 如果文件不存在（404），sha 为 null 表示创建新文件
        if (e.message.includes('404')) {
          sha = null;
        } else {
          throw e;
        }
      }
    }

    const content = buildManifestContent(manifestObj);
    const body = {
      message: commitMessage || '🔧 管理员更新作品数据',
      content: encodeBase64(content),
      branch: CONFIG.branch,
    };
    if (sha) body.sha = sha;

    const url = `https://api.github.com/repos/${CONFIG.owner}/${CONFIG.repo}/contents/${CONFIG.manifestPath}`;
    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${CONFIG.token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errBody = await response.text();
      if (response.status === 409) {
        throw new Error('conflict: manifest 在远端已被修改，需要重新拉取');
      }
      if (response.status === 401) {
        throw new Error('Token 无效或已过期，请更新 github-api.js 中的 token');
      }
      throw new Error(`推送失败 (${response.status}): ${errBody}`);
    }

    const result = await response.json();
    saveSyncStatus({
      lastEditPush: Date.now(),
      lastPushResult: 'success',
      lastPushError: null
    });
    return result;
  }

  // ===== 构建 manifest.js 文件内容 =====
  /**
   * 将 manifest 对象序列化为完整的 manifest.js 文件内容
   */
  function buildManifestContent(manifestObj) {
    const now = new Date().toISOString();
    const totalImages = manifestObj.images ? manifestObj.images.length : 0;
    const json = JSON.stringify(manifestObj, null, 2);
    // 使用简单的校验和
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

  /** 简单校验和（替代 Node 端 crypto） */
  function simpleHash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
    h1 = Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    h1 ^= (h1 >>> 16);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
    h2 = Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 ^= (h2 >>> 16);
    return (h1 + h2).toString(16).slice(0, 16);
  }

  // ===== Base64 编码/解码（UTF-8 安全）=====
  function encodeBase64(str) {
    // 使用 TextEncoder 支持中文
    const bytes = new TextEncoder().encode(str);
    let binary = '';
    bytes.forEach(b => binary += String.fromCharCode(b));
    return btoa(binary);
  }

  function decodeBase64(b64) {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder().decode(bytes);
  }

  // ===== 合并 localStorage 覆盖到 manifest =====
  /**
   * 将 localStorage 中的管理员编辑合并到 manifest 对象
   * @param {object} baseManifest - 基础 manifest（来自 GALLERY_MANIFEST 或 fetch）
   * @returns {object} 合并后的 manifest 对象
   */
  function mergeLocalOverrides(baseManifest) {
    if (!baseManifest) return null;

    const manifest = JSON.parse(JSON.stringify(baseManifest)); // 深拷贝

    // 合并图片 overrides（从 localStorage）
    let worksData = {};
    try {
      const raw = localStorage.getItem('gallery_admin_data');
      if (raw) worksData = JSON.parse(raw);
    } catch (e) { /* ignore */ }

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
    let customTracks = [];
    try {
      const raw = localStorage.getItem('gallery_bg_music_custom');
      if (raw) customTracks = JSON.parse(raw);
    } catch (e) { /* ignore */ }

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

  // ===== 防抖调度 =====
  /**
   * 调度 manifest 推送（带防抖）
   * @param {object} manifestObj - 要推送的 manifest 对象
   * @param {object} opts
   * @param {boolean} [opts.immediate=false] - 跳过防抖，当前 tick 推送
   * @param {boolean} [opts.force=false] - 强制推送，忽略 6h 冷却
   */
  function schedulePushUpdate(manifestObj, opts = {}) {
    if (!isConfigured()) {
      console.warn('GitHubSync: Token 未配置，跳过推送');
      saveSyncStatus({ lastPushResult: 'skipped', lastPushError: 'Token 未配置' });
      return;
    }

    pendingManifest = manifestObj;

    // immediate: 使用较短防抖（合并 30s 内的多次编辑）
    if (opts.immediate) {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        doPushWithRetry(pendingManifest);
        pendingManifest = null;
      }, EDIT_COOLDOWN_MS);
      saveSyncStatus({ status: 'pending', pendingEdits: 1 });
      return;
    }

    // force: 立即推送，忽略所有限制
    if (opts.force) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
      doPushWithRetry(pendingManifest);
      pendingManifest = null;
      return;
    }

    // 默认：检查 6h 冷却
    const status = getSyncStatus();
    const elapsed = status.lastFullSync ? (Date.now() - status.lastFullSync) : Infinity;
    if (elapsed < FULL_SYNC_COOLDOWN_MS) {
      const remaining = FULL_SYNC_COOLDOWN_MS - elapsed;
      const hours = Math.ceil(remaining / 3600000);
      console.log(`GitHubSync: 距下次完整同步还有 ~${hours}h`);
      return;
    }

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      doPushWithRetry(pendingManifest);
      pendingManifest = null;
    }, EDIT_COOLDOWN_MS);
    saveSyncStatus({ status: 'pending' });
  }

  /** 立即推送（跳过所有等待） */
  function flushQueue() {
    clearTimeout(debounceTimer);
    debounceTimer = null;
    if (pendingManifest) {
      const m = pendingManifest;
      pendingManifest = null;
      return doPushWithRetry(m);
    }
    return Promise.resolve();
  }

  // ===== 带重试的推送 =====
  async function doPushWithRetry(manifestObj, attempt = 0) {
    if (!manifestObj) return;
    saveSyncStatus({ status: 'pushing' });

    try {
      await pushManifest(manifestObj);
      retryCount = 0;
      saveSyncStatus({
        status: 'synced',
        lastEditPush: Date.now(),
        lastFullSync: Date.now(),
        lastPushResult: 'success',
        lastPushError: null
      });
      console.log('GitHubSync: ✅ 同步成功');
    } catch (err) {
      const msg = err.message || String(err);
      console.error(`GitHubSync: ❌ 同步失败 (尝试 ${attempt + 1}/${MAX_RETRIES + 1}):`, msg);

      // 冲突时自动重试（重新 fetch + merge）
      if (msg.includes('conflict') && attempt < MAX_RETRIES) {
        try {
          const fetched = await fetchManifest();
          // 提取远端 manifest 对象
          const remoteJson = fetched.content
            .replace(/^const GALLERY_MANIFEST = /, '')
            .replace(/;\s*$/, '');
          const remoteManifest = JSON.parse(remoteJson);
          // 合并本地 overrides 到远端
          const merged = mergeLocalOverrides(remoteManifest);
          // 使用远端的 sha 重试
          await pushManifest(merged, fetched.sha);
          retryCount = 0;
          saveSyncStatus({
            status: 'synced',
            lastEditPush: Date.now(),
            lastFullSync: Date.now(),
            lastPushResult: 'success',
            lastPushError: null
          });
          console.log('GitHubSync: ✅ 冲突解决，重新同步成功');
          return;
        } catch (retryErr) {
          console.error('GitHubSync: 冲突重试失败:', retryErr.message);
        }
      }

      // 其他错误：指数退避重试
      if (attempt < MAX_RETRIES) {
        const delay = Math.pow(2, attempt) * 1000;
        console.log(`GitHubSync: ${delay/1000}s 后重试...`);
        await sleep(delay);
        return doPushWithRetry(manifestObj, attempt + 1);
      }

      // 彻底失败
      retryCount = 0;
      saveSyncStatus({
        status: 'error',
        lastPushResult: 'error',
        lastPushError: msg
      });
    }
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ===== 自动拉取远端更新 =====
  /**
   * 尝试从 GitHub 拉取最新 manifest，更新页面数据
   * （在管理员登录后调用，实现跨设备同步）
   */
  async function tryAutoSyncFromGitHub() {
    if (!isConfigured()) return { synced: false, reason: 'Token 未配置' };

    const status = getSyncStatus();
    const elapsed = status.lastPullSync ? (Date.now() - status.lastPullSync) : Infinity;
    // 拉取冷却 1h
    if (elapsed < 3600000) {
      return { synced: false, reason: '冷却中' };
    }

    try {
      const fetched = await fetchManifest();
      saveSyncStatus({ lastPullSync: Date.now() });

      // 解析远端 manifest
      const jsonStr = fetched.content
        .replace(/^const GALLERY_MANIFEST = /, '')
        .replace(/;\s*$/, '');
      const remoteManifest = JSON.parse(jsonStr);

      // 比较时间戳
      const localGen = (typeof GALLERY_MANIFEST !== 'undefined' && GALLERY_MANIFEST.generated)
        ? GALLERY_MANIFEST.generated : null;

      if (remoteManifest.generated && localGen && remoteManifest.generated <= localGen) {
        return { synced: false, reason: '本地已是最新' };
      }

      // 应用远端 overrides 到 localStorage
      applyRemoteOverrides(remoteManifest);
      return { synced: true, manifest: remoteManifest };
    } catch (e) {
      console.warn('GitHubSync: 拉取远端更新失败:', e.message);
      return { synced: false, reason: e.message };
    }
  }

  function applyRemoteOverrides(remoteManifest) {
    if (!remoteManifest || !remoteManifest.images) return;

    const worksData = {};
    try {
      const raw = localStorage.getItem('gallery_admin_data');
      if (raw) Object.assign(worksData, JSON.parse(raw));
    } catch (e) { /* ignore */ }

    let hasChanges = false;
    remoteManifest.images.forEach(img => {
      if (img.overrides) {
        const existing = worksData[img.name] || {};
        const merged = {
          ...existing,
          title: img.overrides.title || existing.title || img.name,
          category: img.overrides.category || existing.category || img.category,
          note: img.overrides.note || existing.note || '',
        };
        if (JSON.stringify(existing) !== JSON.stringify(merged)) {
          worksData[img.name] = merged;
          hasChanges = true;
        }
      }
    });

    // 合并远端音乐
    if (remoteManifest.music) {
      let customTracks = [];
      try {
        const raw = localStorage.getItem('gallery_bg_music_custom');
        if (raw) customTracks = JSON.parse(raw);
      } catch (e) { /* ignore */ }
      const existingFiles = new Set(customTracks.map(t => t.file));
      const newTracks = remoteManifest.music
        .filter(m => m.source === 'admin' && !existingFiles.has(m.file))
        .map(m => ({ name: m.name, file: m.file, source: 'admin' }));
      if (newTracks.length > 0) {
        customTracks = [...customTracks, ...newTracks];
        try { localStorage.setItem('gallery_bg_music_custom', JSON.stringify(customTracks)); } catch (e) { /* ignore */ }
        hasChanges = true;
      }
    }

    if (hasChanges) {
      try { localStorage.setItem('gallery_admin_data', JSON.stringify(worksData)); } catch (e) { /* ignore */ }
    }
  }

  // ===== 公开 API =====
  return {
    CONFIG,
    isConfigured,
    validateToken,
    fetchManifest,
    pushManifest,
    buildManifestContent,
    mergeLocalOverrides,
    schedulePushUpdate,
    flushQueue,
    getSyncStatus,
    tryAutoSyncFromGitHub,
    applyRemoteOverrides,
    // 底层函数暴露（调试用）
    encodeBase64,
    decodeBase64,
  };
})();

// 尝试自动拉取（延迟加载）
if (typeof GALLERY_MANIFEST !== 'undefined') {
  // 页面加载完成后自动尝试同步
  window.addEventListener('DOMContentLoaded', () => {
    // 仅在管理员已登录时尝试拉取
    const isAdmin = (sessionStorage.getItem('gallery_admin_auth') || localStorage.getItem('gallery_admin_auth')) === 'true';
    if (isAdmin && GitHubSync.isConfigured()) {
      GitHubSync.tryAutoSyncFromGitHub().then(result => {
        if (result.synced) {
          console.log('GitHubSync: 🌐 已从远端拉取最新数据');
          // 提示用户刷新页面以应用更新
          if (typeof renderGallery === 'function') {
            // 更新 imageSources
            location.reload();
          }
        }
      }).catch(() => {});
    }
  });
}
