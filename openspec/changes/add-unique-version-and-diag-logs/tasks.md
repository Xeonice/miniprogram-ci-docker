## 1. 准备 (miniprogram-ci-docker 仓库)

- [x] 1.1 在 miniprogram-ci-docker 仓库当前 `main` 分支基础上切新分支（建议名 `feat/unique-version-and-diag-logs`，apply 前**主动 ask 用户**确认目标分支)
- [x] 1.2 确认本地工作树干净（如有 `private/Dockerfile.build` 改动等无关 dirty file，先沟通是否需要保留 / stash）

## 2. utils/version.js: 新增 generateUniqueVersion

- [x] 2.1 在 `VersionManager` 类内新增方法 `generateUniqueVersion(baseVersion, buildMode)`：
  - 用 `crypto.randomBytes(8).toString('hex')` 生成 16 hex
  - 切 `hex.slice(0,8)` + `-` + `hex.slice(8,16)`
  - 返回 `${baseVersion}-${buildMode}-${first8}-${last8}`
- [x] 2.2 在文件顶部 `require('crypto')` 引入 `randomBytes`（或方法内 require，二选一保持代码风格统一）
- [x] 2.3 `getRecommendedVersion` 完全不动（参数 / 返回值 / 实现）
- [x] 2.4 自测：node REPL 调用 `new VersionManager().generateUniqueVersion('3.8.0','pre')` 返回 `3.8.0-pre-{8}-{8}` 格式

## 3. upload-mp.js: catch 增强 + helper

- [x] 3.1 在 `MiniProgramUploader` 类内新增私有方法 `_logDiagnosticError(error, version)`：
  - 输出 version / message / code / type / ctor / errCode/errMsg / ownProps / JSON / stack
  - 全部走 `this.logger.error(...)`
- [x] 3.2 在 `MiniProgramUploader` 类内新增私有方法 `_probeEgressIp()`（async）：
  - 三个公共服务依次尝试（ifconfig.me / ipinfo.io/ip / icanhazip.com）
  - `child_process.execSync` + `curl -sS --max-time 5`
  - 成功 logger.error 一行 IP 信息后 return；全部失败 logger.error `(无法获取)`
- [x] 3.3 替换 `uploadWithPreview` 的 catch（line ~253）：
  ```js
  } catch (error) {
    this.logger.error('上传或预览失败:');
    this._logDiagnosticError(error, version);
    await this._probeEgressIp();
    throw error;
  }
  ```
- [x] 3.4 替换 `preview` 的 catch（line ~357）同样模式（label 改为 `预览生成失败:`，version 用 `'0.0.1'` 或 `desc` 上下文里的 version）

## 4. upload-mp.js: 调用 generateUniqueVersion

- [x] 4.1 在 `uploadWithPreview()` 入口（line ~122）改为：
  ```js
  const baseVersion = this.versionManager.getRecommendedVersion(this.version);
  const buildMode = process.env.BUILD_MODE || 'production';
  const version = this.versionManager.generateUniqueVersion(baseVersion, buildMode);
  this.logger.info(`用户版本: ${baseVersion}`);
  this.logger.info(`实际上传: ${version}`);
  ```
- [x] 4.2 后续 `ci.upload({version, ...})` 使用上面计算出的 `version`（不变）
- [x] 4.3 确保整段函数内所有 `version` 引用都指向新的 unique version（包括 saveUploadRecord 等记录用途）

## 5. Dockerfile + 文档版本号 bump

- [x] 5.1 `public/Dockerfile.base` 内涉及 `1.0.2` 字符串的注释/标签都改为 `1.1.0`
- [x] 5.2 `private/Dockerfile.base` 同上
- [x] 5.3 `README.md` 所有 `1.0.2` 引用改为 `1.1.0`（保留旧版本号在 changelog 段落如有）
- [x] 5.4 `CLAUDE.md` 所有 `1.0.2` 引用改为 `1.1.0`
- [x] 5.5 grep 全仓 `1.0.2` 确保无遗漏

## 6. 本仓库验证

- [x] 6.1 在本仓库 `node -e "require('./scripts/utils/version'); ..."` 跑 `generateUniqueVersion` 自测
- [x] 6.2 `node scripts/upload-mp.js --help` 仍正常输出（无 require / parse error）
- [x] 6.3 `grep -n '\\$\\{error\\.message\\}' scripts/upload-mp.js` 确认旧 catch 行已全部替换

## 7. 提交（待用户确认分支与策略）

- [x] 7.1 **主动 ask 用户**：分支用 `feat/unique-version-and-diag-logs` 还是直接 main / 别的命名
- [x] 7.2 git add scripts/ public/ private/ README.md CLAUDE.md openspec/
- [x] 7.3 git commit，message 形如：
  ```
  feat: 新增唯一版本号 + 内置诊断日志（base 1.1.0）

  Co-Authored-By: ...
  ```
- [x] 7.4 git push 到远端目标分支

## 8. Build & Push base 镜像 1.1.0

- [x] 8.1 `docker build -f public/Dockerfile.base -t your-registry/miniprogram-ci-base:1.1.0 .`
- [ ] 8.2 `docker push your-registry/miniprogram-ci-base:1.1.0`
- [x] 8.3 `docker build -f private/Dockerfile.base -t artifacts.iflytek.com/cbg-docker-private/xfyun_webdev/miniprogram-ci-base:1.1.0 .`
- [x] 8.4 `docker push artifacts.iflytek.com/cbg-docker-private/xfyun_webdev/miniprogram-ci-base:1.1.0`
- [x] 8.5 在镜像仓库平台确认 1.1.0 tag 可拉取

## 9. Phase 2 — frontend-app 升级 FROM + 撤诊断 patch

(跨仓库工作，在 `~/WorkProject/zhiwen/frontend-app` 进行)

- [x] 9.1 切到 `fix/runtime-and-product-bugs-2026-05-22` 分支（用户已确认）
- [x] 9.2 `frontend-app/Dockerfile.build` 第 18 行 FROM 改为 `:1.1.0`
- [x] 9.3 删 `frontend-app/Dockerfile.build` 中 `COPY ${PROJECT_DIR}/ci-patch /ci-patch` 与 `RUN node /ci-patch/patch-upload-mp.js` 两行
- [x] 9.4 删 `frontend-app/ci-patch/` 整个目录
- [x] 9.5 git add + commit（commit msg 短，避免触发 microprogram-ci desc 长度问题）：
  ```
  chore(ci): 升级 base 镜像到 1.1.0 并下线诊断 patch
  ```
- [x] 9.6 git push 到 `fix/runtime-and-product-bugs-2026-05-22`

## 10. Phase 3 — 验证

- [ ] 10.1 触发 frontend-app CI 部署（一次正常部署）
- [ ] 10.2 日志中 SHALL 看到 `用户版本: X.Y.Z` 和 `实际上传: X.Y.Z-{BUILD_MODE}-{8}-{8}` 两行
- [ ] 10.3 微信小程序后台「开发版本」列表 SHALL 看到形如 `3.8.0-pre-a1b2c3d4-e5f67890` 的版本号
- [ ] 10.4 连续触发 3-5 次部署（保持同一用户 baseVersion），SHALL 全部成功（不再触发 race condition）
- [ ] 10.5 如果有一次失败，日志 SHALL 看到完整诊断（version / errCode / IP / stack）—— 诊断方便定性

## 11. Archive

- [ ] 11.1 Phase 1-3 全部完成后，`openspec archive add-unique-version-and-diag-logs`
- [ ] 11.2 验证 `openspec/specs/unique-version-suffix/spec.md` 与 `openspec/specs/upload-mp-diagnostics/spec.md` 已合入主 specs
