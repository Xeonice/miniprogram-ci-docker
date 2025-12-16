/**
 * 构建信息生成脚本
 * 功能：
 * - 接收版本号和描述参数
 * - 生成构建信息 JSON 文件
 * - 保存到指定目录（默认根目录）
 */

const fs = require('fs');
const path = require('path');
const minimist = require('minimist');

class BuildInfoGenerator {
  constructor(options = {}) {
    // 从命令行参数或选项中获取
    this.version = options.version || process.env.BUILD_VERSION || this.getPackageVersion();
    this.env = options.env || process.env.NODE_ENV || 'development';
    this.outputDir = options.output || './';
    this.filename = options.filename || 'build-info.json';

    // Git 信息 - 优先使用传入的参数
    this.gitBranch = options.branch || options['git-branch'] || process.env.GIT_BRANCH || process.env.CI_COMMIT_REF_NAME || '';
    this.gitCommit = options.commit || options['git-commit'] || process.env.GIT_COMMIT || process.env.CI_COMMIT_SHA || '';
    this.gitTag = process.env.GIT_TAG || process.env.CI_COMMIT_TAG || '';

    // description 将从 git commit 信息中获取
    this.description = '';
    this.providedCommit = options.commit || options['git-commit']; // 记录是否提供了 commit

    // CI 信息
    this.buildNumber = process.env.BUILD_NUMBER || process.env.CI_PIPELINE_ID || '';
    this.buildUrl = process.env.BUILD_URL || process.env.CI_PIPELINE_URL || '';

    // 构建信息
    this.buildTime = new Date().toISOString();
    this.buildTimestamp = Date.now();
    this.buildUser = process.env.BUILD_USER || process.env.GITLAB_USER_LOGIN || process.env.USER || '';
    this.buildMachine = process.env.BUILD_MACHINE || process.env.HOSTNAME || require('os').hostname();
  }

  /**
   * 获取 package.json 中的版本号
   */
  getPackageVersion() {
    try {
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      return packageJson.version || '1.0.0';
    } catch (error) {
      console.warn('无法读取 package.json，使用默认版本号 1.0.0');
      return '1.0.0';
    }
  }

  /**
   * 根据 commit ID 获取提交信息作为 description
   */
  getCommitDescription(commitId) {
    const { execSync } = require('child_process');

    try {
      if (commitId) {
        // 如果提供了 commit ID，获取该 commit 的信息
        const commitMessage = execSync(`git log -1 --pretty=%B ${commitId}`, { encoding: 'utf8' }).trim();
        return commitMessage;
      } else {
        // 如果没有提供 commit ID，获取当前 HEAD 的提交信息
        const commitMessage = execSync('git log -1 --pretty=%B', { encoding: 'utf8' }).trim();
        return commitMessage;
      }
    } catch (error) {
      console.warn('无法获取提交信息，使用默认描述');
      return '';
    }
  }

  /**
   * 获取 Git 信息
   */
  getGitInfo() {
    const { execSync } = require('child_process');
    const gitInfo = {};

    try {
      // 获取当前分支
      if (!this.gitBranch) {
        gitInfo.branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
      } else {
        gitInfo.branch = this.gitBranch;
      }

      // 获取当前提交
      if (!this.gitCommit) {
        gitInfo.commit = execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
        gitInfo.commitShort = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
      } else {
        gitInfo.commit = this.gitCommit;
        gitInfo.commitShort = this.gitCommit.substring(0, 7);
      }

      // 获取提交信息（优先使用指定的 commit，否则使用当前 HEAD）
      const targetCommit = this.gitCommit || 'HEAD';
      gitInfo.lastCommitMessage = execSync(`git log -1 --pretty=%B ${targetCommit}`, { encoding: 'utf8' }).trim();
      gitInfo.lastCommitAuthor = execSync(`git log -1 --pretty=%an ${targetCommit}`, { encoding: 'utf8' }).trim();
      gitInfo.lastCommitDate = execSync(`git log -1 --pretty=%ai ${targetCommit}`, { encoding: 'utf8' }).trim();

      // 获取标签
      if (!this.gitTag) {
        try {
          gitInfo.tag = execSync('git describe --tags --abbrev=0', { encoding: 'utf8' }).trim();
        } catch (e) {
          gitInfo.tag = '';
        }
      } else {
        gitInfo.tag = this.gitTag;
      }

      // 检查是否有未提交的更改
      try {
        execSync('git diff-index --quiet HEAD --', { encoding: 'utf8' });
        gitInfo.isDirty = false;
      } catch (e) {
        gitInfo.isDirty = true;
      }

    } catch (error) {
      console.warn('获取 Git 信息失败，可能不在 Git 仓库中');
      return {
        branch: this.gitBranch || 'unknown',
        commit: this.gitCommit || 'unknown',
        commitShort: this.gitCommit ? this.gitCommit.substring(0, 7) : 'unknown',
        tag: this.gitTag || '',
        isDirty: false
      };
    }

    return gitInfo;
  }

  /**
   * 生成构建信息
   */
  generateBuildInfo() {
    const gitInfo = this.getGitInfo();

    // 如果没有手动设置 description，使用 commit message
    if (!this.description) {
      this.description = this.getCommitDescription(this.gitCommit);
    }

    const buildInfo = {
      // 版本信息
      version: this.version,
      description: this.description,
      environment: this.env,

      // 时间信息
      buildTime: this.buildTime,
      buildTimestamp: this.buildTimestamp,
      buildDate: new Date().toLocaleDateString("zh-CN"),

      // Git 信息
      git: {
        branch: gitInfo.branch,
        commit: gitInfo.commit,
        commitShort: gitInfo.commitShort,
        tag: gitInfo.tag,
        isDirty: gitInfo.isDirty,
        lastCommitMessage: gitInfo.lastCommitMessage,
        lastCommitAuthor: gitInfo.lastCommitAuthor,
        lastCommitDate: gitInfo.lastCommitDate,
      },

      // CI/CD 信息
      ci: {
        buildNumber: this.buildNumber,
        buildUrl: this.buildUrl,
        buildUser: this.buildUser,
        buildMachine: this.buildMachine,
      },

      // 系统信息
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
      },

      // 项目信息
      project: {
        name: this.getProjectName(),
        appId: "wxf2badc6a683ab3a9",
      },
    };

    return buildInfo;
  }

  /**
   * 获取项目名称
   */
  getProjectName() {
    try {
      const packageJsonPath = path.join(process.cwd(), 'package.json');
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
      return packageJson.name || 'zhiwen-app';
    } catch (error) {
      return 'zhiwen-app';
    }
  }

  /**
   * 保存构建信息到文件
   */
  saveBuildInfo(buildInfo) {
    // 确保输出目录存在
    const outputPath = path.resolve(this.outputDir);
    if (!fs.existsSync(outputPath)) {
      fs.mkdirSync(outputPath, { recursive: true });
      console.log(`✓ 创建输出目录: ${outputPath}`);
    }

    // 写入 JSON 文件
    const filePath = path.join(outputPath, this.filename);
    fs.writeFileSync(filePath, JSON.stringify(buildInfo, null, 2), 'utf-8');
    console.log(`✓ 构建信息已生成: ${filePath}`);

    // 同时生成一个简化版本（用于运行时）
    const runtimeInfo = {
      version: buildInfo.version,
      description: buildInfo.description,
      buildTime: buildInfo.buildTime,
      environment: buildInfo.environment,
      gitCommit: buildInfo.git.commitShort,
      gitBranch: buildInfo.git.branch
    };

    const runtimeFilePath = path.join(outputPath, 'build-info.runtime.json');
    fs.writeFileSync(runtimeFilePath, JSON.stringify(runtimeInfo, null, 2), 'utf-8');
    console.log(`✓ 运行时信息已生成: ${runtimeFilePath}`);

    return { buildInfo, filePath, runtimeFilePath };
  }

  /**
   * 显示构建信息
   */
  displayBuildInfo(buildInfo) {
    console.log('\n' + '='.repeat(60));
    console.log('构建信息');
    console.log('='.repeat(60));
    console.log(`版本号: ${buildInfo.version}`);
    console.log(`描述: ${buildInfo.description || '(无描述)'}`);
    console.log(`环境: ${buildInfo.environment}`);
    console.log(`构建时间: ${buildInfo.buildTime}`);
    console.log(`Git 分支: ${buildInfo.git.branch}`);
    console.log(`Git 提交: ${buildInfo.git.commitShort}`);

    if (buildInfo.git.isDirty) {
      console.log('⚠️  警告: 工作区有未提交的更改');
    }

    if (buildInfo.ci.buildNumber) {
      console.log(`构建号: ${buildInfo.ci.buildNumber}`);
    }

    console.log('='.repeat(60) + '\n');
  }

  /**
   * 执行主流程
   */
  execute() {
    try {
      console.log('开始生成构建信息...\n');

      // 生成构建信息
      const buildInfo = this.generateBuildInfo();

      // 保存到文件
      const { filePath, runtimeFilePath } = this.saveBuildInfo(buildInfo);

      // 显示构建信息
      this.displayBuildInfo(buildInfo);

      console.log('✅ 构建信息生成成功！');
      console.log(`   完整信息: ${filePath}`);
      console.log(`   运行时信息: ${runtimeFilePath}`);

      return buildInfo;

    } catch (error) {
      console.error('❌ 生成构建信息失败:', error.message);
      process.exit(1);
    }
  }

  /**
   * 验证构建信息文件是否存在
   */
  static verify(distDir = './') {
    const buildInfoPath = path.join(distDir, 'build-info.json');
    const runtimeInfoPath = path.join(distDir, 'build-info.runtime.json');

    if (!fs.existsSync(buildInfoPath)) {
      console.error(`❌ 构建信息文件不存在: ${buildInfoPath}`);
      return false;
    }

    if (!fs.existsSync(runtimeInfoPath)) {
      console.error(`❌ 运行时信息文件不存在: ${runtimeInfoPath}`);
      return false;
    }

    try {
      const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf-8'));
      JSON.parse(fs.readFileSync(runtimeInfoPath, 'utf-8')); // 验证文件格式

      console.log('✅ 构建信息验证成功');
      console.log(`   版本: ${buildInfo.version}`);
      console.log(`   构建时间: ${buildInfo.buildTime}`);

      return true;
    } catch (error) {
      console.error('❌ 构建信息文件格式错误:', error.message);
      return false;
    }
  }
}

// 命令行入口
if (require.main === module) {
  const argv = minimist(process.argv.slice(2));

  // 显示帮助信息
  if (argv.help || argv.h) {
    console.log(`
使用方法:
  node scripts/generate-build-info.js [options]

选项:
  --version       版本号 [默认: package.json 中的版本]
  --git-branch    Git 分支名称 [默认: 当前分支]
  --git-commit    Git 提交 ID [默认: 当前 HEAD]
  --env           环境类型 [默认: development]
  --output        输出目录 [默认: ./]
  --filename      文件名 [默认: build-info.json]
  --verify        验证构建信息文件是否存在
  --help, -h      显示帮助信息

说明:
  description 将自动从指定的 git commit 提交信息中获取

示例:
  # 使用默认配置生成（从当前 HEAD 获取提交信息）
  node scripts/generate-build-info.js

  # 指定版本和 Git 信息
  node scripts/generate-build-info.js --version 1.2.3 --git-branch master --git-commit abc123def

  # 只指定 Git 分支和提交
  node scripts/generate-build-info.js --git-branch develop --git-commit 7f8e9d2

  # 生成到指定目录
  node scripts/generate-build-info.js --output ./build --filename version.json

  # 验证构建信息
  node scripts/generate-build-info.js --verify

环境变量:
  BUILD_VERSION       版本号
  NODE_ENV           环境类型
  GIT_BRANCH         Git 分支
  GIT_COMMIT         Git 提交
  BUILD_NUMBER       构建号
    `);
    process.exit(0);
  }

  // 验证模式
  if (argv.verify) {
    const isValid = BuildInfoGenerator.verify(argv.output);
    process.exit(isValid ? 0 : 1);
  }

  // 生成构建信息
  const generator = new BuildInfoGenerator(argv);
  generator.execute();
}

module.exports = BuildInfoGenerator;