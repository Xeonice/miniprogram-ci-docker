/**
 * 版本管理工具
 * 功能：
 * - 读取 package.json 版本号
 * - 生成版本描述
 * - 管理版本号递增
 */

const fs = require('fs');
const path = require('path');

class VersionManager {
  constructor() {
    this.packageJsonPath = path.join(process.cwd(), 'package.json');
    this.loadPackageJson();
  }

  /**
   * 加载 package.json
   */
  loadPackageJson() {
    try {
      const content = fs.readFileSync(this.packageJsonPath, 'utf-8');
      this.packageJson = JSON.parse(content);
    } catch (error) {
      throw new Error(`读取 package.json 失败: ${error.message}`);
    }
  }

  /**
   * 获取当前版本号
   * @returns {string}
   */
  getCurrentVersion() {
    return this.packageJson.version || '1.0.0';
  }

  /**
   * 生成版本描述
   * @param {string} env - 环境类型 (development/production)
   * @param {string} customDesc - 自定义描述
   * @returns {string}
   */
  generateDescription(env, customDesc) {
    const timestamp = new Date().toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false
    });

    const envLabel = env === 'production' ? '正式版' : '体验版';
    const baseDesc = customDesc || `${envLabel}上传`;

    // 添加 Git 信息（如果有）
    const gitBranch = process.env.GIT_BRANCH || process.env.CI_COMMIT_REF_NAME;
    const gitCommit = process.env.GIT_COMMIT || process.env.CI_COMMIT_SHA;

    let desc = `${baseDesc} - ${timestamp}`;

    if (gitBranch) {
      desc += ` [${gitBranch}]`;
    }

    if (gitCommit) {
      desc += ` (${gitCommit.substring(0, 7)})`;
    }

    return desc;
  }

  /**
   * 获取构建信息
   * @returns {Object}
   */
  getBuildInfo() {
    return {
      version: this.getCurrentVersion(),
      buildTime: new Date().toISOString(),
      env: process.env.NODE_ENV || 'development',
      branch: process.env.GIT_BRANCH || process.env.CI_COMMIT_REF_NAME || 'unknown',
      commit: process.env.GIT_COMMIT || process.env.CI_COMMIT_SHA || 'unknown',
      buildNumber: process.env.BUILD_NUMBER || process.env.CI_PIPELINE_ID || 'local',
      nodejs: process.version,
      platform: process.platform
    };
  }

  /**
   * 递增版本号
   * @param {string} type - 版本类型 (major/minor/patch)
   * @returns {string} 新版本号
   */
  incrementVersion(type = 'patch') {
    const currentVersion = this.getCurrentVersion();
    const parts = currentVersion.split('.').map(Number);

    switch (type) {
      case 'major':
        parts[0]++;
        parts[1] = 0;
        parts[2] = 0;
        break;
      case 'minor':
        parts[1]++;
        parts[2] = 0;
        break;
      case 'patch':
      default:
        parts[2]++;
        break;
    }

    return parts.join('.');
  }

  /**
   * 保存版本号到 package.json
   * @param {string} version - 新版本号
   */
  saveVersion(version) {
    this.packageJson.version = version;

    try {
      fs.writeFileSync(
        this.packageJsonPath,
        JSON.stringify(this.packageJson, null, 2) + '\n',
        'utf-8'
      );
      console.log(`✓ 版本号已更新: ${version}`);
    } catch (error) {
      throw new Error(`保存版本号失败: ${error.message}`);
    }
  }

  /**
   * 从 Git tag 获取版本号
   * @returns {string|null}
   */
  getVersionFromGitTag() {
    const gitTag = process.env.CI_COMMIT_TAG || process.env.GIT_TAG;

    if (gitTag) {
      // 移除 v 前缀（如果有）
      const version = gitTag.replace(/^v/, '');

      // 验证版本号格式
      if (/^\d+\.\d+\.\d+/.test(version)) {
        return version;
      }
    }

    return null;
  }

  /**
   * 获取推荐的版本号
   * @param {string} customVersion - 自定义版本号
   * @returns {string}
   */
  getRecommendedVersion(customVersion) {
    // 优先级：自定义版本 > Git Tag > package.json
    if (customVersion) {
      return customVersion;
    }

    const gitVersion = this.getVersionFromGitTag();
    if (gitVersion) {
      return gitVersion;
    }

    return this.getCurrentVersion();
  }

  /**
   * 生成版本报告
   * @returns {string}
   */
  generateReport() {
    const buildInfo = this.getBuildInfo();
    const lines = [
      '='.repeat(60),
      '版本信息报告',
      '='.repeat(60),
      `版本号: ${buildInfo.version}`,
      `构建时间: ${buildInfo.buildTime}`,
      `环境: ${buildInfo.env}`,
      `分支: ${buildInfo.branch}`,
      `提交: ${buildInfo.commit}`,
      `构建号: ${buildInfo.buildNumber}`,
      `Node.js: ${buildInfo.nodejs}`,
      `平台: ${buildInfo.platform}`,
      '='.repeat(60)
    ];

    return lines.join('\n');
  }
}

// 如果直接运行此文件，显示版本信息
if (require.main === module) {
  const versionManager = new VersionManager();
  console.log(versionManager.generateReport());
}

module.exports = VersionManager;