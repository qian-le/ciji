#!/usr/bin/env node
/**
 * 读取 version.json，同步到 Android build.gradle / package.json / update.json 模板。
 * 发布前：node scripts/prepare-release.mjs
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const versionPath = join(root, 'version.json')
if (!existsSync(versionPath)) {
  console.error('version.json not found')
  process.exit(1)
}
const version = JSON.parse(readFileSync(versionPath, 'utf8'))
const { versionCode, versionName } = version
if (!versionCode || !versionName) {
  console.error('version.json must include versionCode and versionName')
  process.exit(1)
}

const pkgPath = join(root, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
pkg.version = versionName
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

const gradlePath = join(root, 'android', 'app', 'build.gradle')
if (existsSync(gradlePath)) {
  let gradle = readFileSync(gradlePath, 'utf8')
  gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`)
  gradle = gradle.replace(/versionName\s+"[^"]+"/, `versionName "${versionName}"`)
  writeFileSync(gradlePath, gradle)
}

// update.json 作为 GitHub raw 检查源（APK URL 由 Actions 在发布时改写）
const updateJson = {
  versionCode: Number(versionCode),
  versionName: String(versionName),
  minVersionCode: version.minVersionCode ?? 1,
  force: Boolean(version.force),
  releasedAt: version.releasedAt || new Date().toISOString(),
  changelog: version.changelog || [],
  github: version.github || { owner: 'qian-le', repo: 'ciji' },
  apkUrl: `https://github.com/${(version.github?.owner) || 'qian-le'}/${(version.github?.repo) || 'ciji'}/releases/download/v${versionName}/ciji-v${versionName}.apk`,
}
writeFileSync(join(root, 'update.json'), JSON.stringify(updateJson, null, 2) + '\n')

console.log(`Prepared release v${versionName} (versionCode=${versionCode})`)
console.log(`update.json apkUrl=${updateJson.apkUrl}`)
