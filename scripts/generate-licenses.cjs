// 生成运行时依赖的第三方许可清单：resources/licenses/npm-licenses.json。
// 从 package.json 的 dependencies 出发 BFS 遍历传递依赖，收集许可名与许可文本，
// 供安装包随包分发（extraResources 已整体复制 resources/）。可随时重跑，输出幂等。
const fs = require('node:fs');
const path = require('node:path');

const LICENSE_FILE_CANDIDATES = ['LICENSE', 'LICENSE.md', 'LICENSE.txt', 'LICENCE', 'LICENCE.md', 'LICENCE.txt'];
const LICENSE_TEXT_LIMIT = 4000;

function resolvePackageDir(projectRoot, name) {
  const topLevel = path.join(projectRoot, 'node_modules', name);
  if (fs.existsSync(path.join(topLevel, 'package.json'))) return topLevel;
  try {
    return path.dirname(require.resolve(name + '/package.json', { paths: [projectRoot] }));
  } catch {
    return null;
  }
}

function readLicenseText(packageDir) {
  for (const name of LICENSE_FILE_CANDIDATES) {
    const file = path.join(packageDir, name);
    if (fs.existsSync(file)) {
      const text = fs.readFileSync(file, 'utf8').trim();
      return text.length > LICENSE_TEXT_LIMIT ? text.slice(0, LICENSE_TEXT_LIMIT) + '\n…（截断，完整文本见上游仓库）' : text;
    }
  }
  return '';
}

function collect(projectRoot) {
  const rootPackage = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const queue = Object.keys(rootPackage.dependencies || {});
  const seen = new Set();
  const packages = [];
  while (queue.length > 0) {
    const name = queue.shift();
    if (seen.has(name)) continue;
    seen.add(name);
    const dir = resolvePackageDir(projectRoot, name);
    if (!dir) continue;
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
    } catch {
      continue;
    }
    packages.push({
      name: manifest.name || name,
      version: manifest.version || '',
      license: manifest.license || 'UNKNOWN',
      homepage: manifest.homepage || '',
      licenseText: readLicenseText(dir),
    });
    for (const dep of Object.keys(manifest.dependencies || {})) {
      if (!seen.has(dep)) queue.push(dep);
    }
  }
  packages.sort((a, b) => a.name.localeCompare(b.name));
  return packages;
}

function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const outDir = path.join(projectRoot, 'resources', 'licenses');
  fs.mkdirSync(outDir, { recursive: true });
  const packages = collect(projectRoot);
  const output = {
    generatedAt: new Date().toISOString(),
    note: 'PingNest 运行时 npm 依赖的第三方许可清单（含传递依赖）。PingNest 本体遵循 CC BY-NC-SA 4.0。',
    packageCount: packages.length,
    packages,
  };
  const target = path.join(outDir, 'npm-licenses.json');
  fs.writeFileSync(target, JSON.stringify(output, null, 2) + '\n', 'utf8');
  console.log('[generate-licenses] wrote resources/licenses/npm-licenses.json (' + packages.length + ' packages)');
}

main();
