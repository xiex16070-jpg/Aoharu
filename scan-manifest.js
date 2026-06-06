/**
 * 图片清单扫描器
 * 扫描各分类文件夹中的图片，生成 manifest.js 供画廊加载。
 * 用法: node scan-manifest.js
 * 每次添加/移动图片后运行此脚本刷新清单。
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

// 音乐文件
const MUSIC_EXTENSIONS = new Set(['.flac', '.mp3', '.wav', '.ogg', '.m4a', '.aac', '.wma']);

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
          // 路径使用正斜杠（URL 兼容）
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
function generateManifest(images, musicFiles) {
  const now = new Date().toISOString();

  // 按文件名排序（可保持稳定顺序）
  images.sort((a, b) => a.name.localeCompare(b.name, 'zh'));

  const manifest = {
    generated: now,
    totalImages: images.length,
    categories: CATEGORY_MAP.map(c => ({ id: c.id, icon: c.icon, name: c.name, desc: c.desc, folder: c.folder })),
    images: images,
    music: musicFiles.sort((a, b) => a.name.localeCompare(b.name, 'zh'))
  };

  const json = JSON.stringify(manifest, null, 2);
  const hash = crypto.createHash('sha256').update(json).digest('hex').slice(0, 16);

  const output = [
    '// 自动生成 — 请勿手动编辑',
    `// 生成时间: ${now}`,
    `// 图片总数: ${images.length}`,
    `// 校验码: ${hash}`,
    '// 运行 node scan-manifest.js 刷新',
    '',
    `const GALLERY_MANIFEST = ${json};`,
    ''
  ].join('\n');

  const outPath = path.join(ROOT, 'manifest.js');
  fs.writeFileSync(outPath, output, 'utf-8');

  // 同时输出一份统计到控制台
  console.log('✅ manifest.js 已生成');
  console.log(`   图片总数: ${images.length}`);
  console.log(`   音乐文件: ${musicFiles.length}`);
  CATEGORY_MAP.forEach(cat => {
    const count = images.filter(i => i.category === cat.id).length;
    console.log(`   ${cat.icon} ${cat.folder}: ${count} 张`);
  });
  console.log(`   校验码: ${hash}`);

  return outPath;
}

// ---- 运行 ----
const { images, musicFiles } = scanImages();
if (images.length === 0) {
  console.error('❌ 未找到任何图片！请检查文件夹结构。');
  process.exit(1);
}
generateManifest(images, musicFiles);
