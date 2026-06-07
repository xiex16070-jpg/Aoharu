/**
 * 图片清单扫描器
 * 扫描各分类文件夹中的图片，生成 manifest.js 供画廊加载。
 * 用法: node scan-manifest.js
 * 每次添加/移动图片后运行此脚本刷新清单。
 *
 * ✅ 会自动保留已有的 overrides（标题、回忆、分类、隐藏状态）
 *    以及管理员通过网页端添加的自定义音乐曲目。
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ---- 配置 ----
const ROOT = __dirname;

const CATEGORY_MAP = [
  { id: 1, folder: '入坑和启蒙',             icon: '🌱', name: '入坑和启蒙',             desc: '故事的起点，那些最初遇见的、打开新世界大门的作品。' },
  { id: 2, folder: '青春和热爱',             icon: '💫', name: '青春和热爱',             desc: '在成长的关键时期，深刻影响和塑造了贝贝的作品。' },
  { id: 3, folder: '那些无可替代的夏天',     icon: '☀️', name: '那些无可替代的夏天',     desc: '蝉鸣、汗水、蝉鸣与那些永远铭刻在记忆中的季节。' },
  { id: 4, folder: '近来的优秀作品',         icon: '🌟', name: '近来的优秀作品',         desc: '近期发现和欣赏的优秀作品，值得反复回味。' },
  { id: 5, folder: '其他优秀作品',           icon: '✨', name: '其他优秀作品',           desc: '同样珍贵的作品，暂时还未归类到这里。' },
];

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.svg', '.avif', '.heic', '.heif']);
const MUSIC_EXTENSIONS = new Set(['.flac', '.mp3', '.wav', '.ogg', '.m4a', '.aac', '.wma']);

// ---- 读取已有 manifest，提取 overrides 和自定义音乐 ----
function loadExistingOverrides() {
  const manifestPath = path.join(ROOT, 'manifest.js');
  if (!fs.existsSync(manifestPath)) {
    console.log('ℹ 未找到已有 manifest.js，将全新生成。');
    return { overridesMap: {}, customMusic: [] };
  }

  try {
    const content = fs.readFileSync(manifestPath, 'utf-8');
    const match = content.match(/const GALLERY_MANIFEST\s*=\s*(\{[\s\S]*?\});/);
    if (!match) {
      console.warn('⚠ 无法解析已有 manifest.js，overrides 将丢失。');
      return { overridesMap: {}, customMusic: [] };
    }

    const existing = JSON.parse(match[1]);

    // 提取每张图片的 overrides
    const overridesMap = {};
    if (existing.images && Array.isArray(existing.images)) {
      existing.images.forEach(img => {
        if (img.overrides && img.name) {
          overridesMap[img.name] = img.overrides;
        }
      });
    }

    // 提取管理员添加的自定义音乐（source === 'admin'）
    const customMusic = (existing.music || []).filter(m => m.source === 'admin');

    const overrideCount = Object.keys(overridesMap).length;
    if (overrideCount > 0) {
      console.log(`ℹ 已读取 ${overrideCount} 条已有 overrides，将保留到新清单中。`);
    }
    if (customMusic.length > 0) {
      console.log(`ℹ 已读取 ${customMusic.length} 首自定义音乐，将保留到新清单中。`);
    }

    return { overridesMap, customMusic };
  } catch (e) {
    console.warn('⚠ 解析已有 manifest.js 失败:', e.message, '— overrides 将丢失。');
    return { overridesMap: {}, customMusic: [] };
  }
}

// ---- 扫描 ----
function scanImages() {
  const images = [];
  const musicFiles = [];

  // 扫描根目录音乐文件
  try {
    const rootFiles = fs.readdirSync(ROOT);
    rootFiles.forEach(file => {
      const ext = path.extname(file).toLowerCase();
      if (MUSIC_EXTENSIONS.has(ext)) {
        const stat = fs.statSync(path.join(ROOT, file));
        musicFiles.push({
          name: path.basename(file, ext),
          file: file,
          size: stat.size,
          mtime: stat.mtimeMs
        });
      }
    });
  } catch (e) { /* ignore */ }

  // 扫描各分类文件夹
  for (const cat of CATEGORY_MAP) {
    const catDir = path.join(ROOT, cat.folder);
    if (!fs.existsSync(catDir) || !fs.statSync(catDir).isDirectory()) {
      console.warn(`⚠ 目录不存在，跳过: ${cat.folder}`);
      continue;
    }

    try {
      const files = fs.readdirSync(catDir);
      files.forEach(file => {
        const ext = path.extname(file).toLowerCase();
        if (IMAGE_EXTENSIONS.has(ext)) {
          const fullPath = path.join(catDir, file);
          const stat = fs.statSync(fullPath);
          const relPath = `${cat.folder}/${file}`;
          images.push({
            name: file,
            src: relPath,
            category: cat.id,
            size: stat.size,
            mtime: stat.mtimeMs
          });
        }
      });
    } catch (e) {
      console.warn(`⚠ 读取目录失败: ${cat.folder}`, e.message);
    }
  }

  return { images, musicFiles };
}

// ---- 生成 manifest.js ----
function generateManifest(images, musicFiles, overridesMap, customMusic) {
  const now = new Date().toISOString();

  // 按文件名排序
  images.sort((a, b) => a.name.localeCompare(b.name, 'zh'));

  // 将已有 overrides 回填到对应图片
  let preservedCount = 0;
  const imagesWithOverrides = images.map(img => {
    const ov = overridesMap[img.name];
    if (ov) {
      preservedCount++;
      return { ...img, overrides: ov };
    }
    return img;
  });

  if (preservedCount > 0) {
    console.log(`✅ 已保留 ${preservedCount} 张图片的 overrides。`);
  }

  // 合并磁盘音乐 + 自定义音乐（去重）
  const diskFiles = new Set(musicFiles.map(m => m.file));
  const extraMusic = customMusic.filter(m => !diskFiles.has(m.file));
  const allMusic = [
    ...musicFiles.sort((a, b) => a.name.localeCompare(b.name, 'zh')),
    ...extraMusic
  ];

  // 统计实际可见图片数（排除 hidden）
  const visibleCount = imagesWithOverrides.filter(
    img => !(img.overrides && img.overrides.hidden)
  ).length;

  const manifest = {
    generated: now,
    totalImages: visibleCount,
    categories: CATEGORY_MAP.map(c => ({ id: c.id, icon: c.icon, name: c.name, desc: c.desc, folder: c.folder })),
    images: imagesWithOverrides,
    music: allMusic
  };

  const json = JSON.stringify(manifest, null, 2);
  const hash = crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);

  const output = [
    '// 自动生成 — 请勿手动编辑',
    `// 生成时间: ${now}`,
    `// 图片总数: ${visibleCount}`,
    `// 校验码: ${hash}`,
    '// 运行 node scan-manifest.js 刷新',
    '',
    `const GALLERY_MANIFEST = ${json};`,
    ''
  ].join('\n');

  const outPath = path.join(ROOT, 'manifest.js');
  fs.writeFileSync(outPath, output, 'utf-8');

  console.log('✅ manifest.js 已生成');
  console.log(`   图片总数: ${images.length} 张（可见: ${visibleCount} 张）`);
  console.log(`   音乐文件: ${musicFiles.length} 首（含自定义: ${extraMusic.length} 首）`);
  CATEGORY_MAP.forEach(cat => {
    const count = imagesWithOverrides.filter(i => {
      const catId = (i.overrides && i.overrides.category) || i.category;
      return catId === cat.id && !(i.overrides && i.overrides.hidden);
    }).length;
    console.log(`   ${cat.icon} ${cat.folder}: ${count} 张`);
  });
  console.log(`   校验码: ${hash}`);

  return outPath;
}

// ---- 运行 ----
const { overridesMap, customMusic } = loadExistingOverrides();
const { images, musicFiles } = scanImages();

if (images.length === 0) {
  console.error('❌ 未找到任何图片！请检查文件夹结构。');
  process.exit(1);
}

generateManifest(images, musicFiles, overridesMap, customMusic);
