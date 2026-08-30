const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const runtimeNames = [
  'msvcp140.dll',
  'msvcp140_1.dll',
  'vcruntime140.dll',
  'vcruntime140_1.dll',
];

// 运行期完整性校验覆盖的原生资源（相对 resources/ 的路径）。
// 缺失的文件跳过哈希，由运行期的存在性检查另行报错。
const manifestTargets = [
  'key/win32/x64/wx_key.dll',
  'wcdb/win32/x64/wcdb_api.dll',
  'wcdb/win32/x64/WCDB.dll',
  'wcdb/win32/x64/SDL2.dll',
  'wcdb/win32/x64/pingnest_monitor.dll',
  ...runtimeNames.map((name) => 'runtime/win32/' + name),
];

function sha256(filePath) {
  return createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function generateDllManifest(projectRoot) {
  const files = {};
  for (const relativePath of manifestTargets) {
    const fullPath = path.join(projectRoot, 'resources', relativePath);
    if (fs.existsSync(fullPath)) {
      files[relativePath] = sha256(fullPath);
    }
  }
  const manifest = {
    algorithm: 'sha256',
    generatedAt: new Date().toISOString(),
    files,
  };
  const manifestPath = path.join(projectRoot, 'resources', 'dll-manifest.json');
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log('[prepare-electron-runtime] wrote resources/dll-manifest.json (' + Object.keys(files).length + ' entries)');
}

function copyIfDifferent(sourcePath, targetPath) {
  const source = fs.statSync(sourcePath);
  const targetExists = fs.existsSync(targetPath);

  if (targetExists) {
    const target = fs.statSync(targetPath);
    if (target.size === source.size && target.mtimeMs >= source.mtimeMs) {
      return false;
    }
  }

  fs.copyFileSync(sourcePath, targetPath);
  return true;
}

function main() {
  const projectRoot = path.resolve(__dirname, '..');

  // 完整性清单与平台无关：非 Windows 平台也生成（缺文件的条目跳过）
  generateDllManifest(projectRoot);

  if (process.platform !== 'win32') {
    return;
  }

  const sourceDir = path.join(projectRoot, 'resources', 'runtime', 'win32');
  const targetDir = path.join(projectRoot, 'node_modules', 'electron', 'dist');

  if (!fs.existsSync(sourceDir) || !fs.existsSync(targetDir)) {
    return;
  }

  let copiedCount = 0;
  for (const name of runtimeNames) {
    const sourcePath = path.join(sourceDir, name);
    const targetPath = path.join(targetDir, name);
    if (!fs.existsSync(sourcePath)) continue;
    if (copyIfDifferent(sourcePath, targetPath)) copiedCount += 1;
  }

  if (copiedCount > 0) {
    console.log('[prepare-electron-runtime] synced ' + copiedCount + ' runtime DLL(s) to electron dist');
  }
}

main();
