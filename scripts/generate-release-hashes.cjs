// electron-builder afterAllArtifactBuild 钩子：为 release/ 下的构建产物生成 SHA256SUMS.txt，
// 供发布渠道公示产物哈希（配合包内 resources/dll-manifest.json 的运行期 DLL 校验）。
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

module.exports = async function afterAllArtifactBuild(buildResult) {
  const artifacts = Array.isArray(buildResult) ? buildResult : [];
  const lines = [];
  for (const artifact of artifacts) {
    try {
      const hash = createHash('sha256').update(fs.readFileSync(artifact)).digest('hex');
      lines.push(hash + '  ' + path.basename(artifact));
    } catch (e) {
      console.warn('[generate-release-hashes] skip ' + artifact + ': ' + String(e));
    }
  }
  if (lines.length === 0) return buildResult;

  const target = path.join(path.dirname(artifacts[0]), 'SHA256SUMS.txt');
  fs.writeFileSync(target, '# PingNest release artifacts (SHA256)\n' + lines.join('\n') + '\n', 'utf8');
  console.log('[generate-release-hashes] wrote ' + target + ' (' + lines.length + ' entries)');
  return buildResult;
};
