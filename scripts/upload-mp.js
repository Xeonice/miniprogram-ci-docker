/**
 * 微信小程序上传主脚本
 * 功能：
 * - 解析命令行参数
 * - 执行构建
 * - 上传代码
 * - 上传二维码到 OSS CDN
 */

const ci = require('miniprogram-ci');
const path = require('path');
const fs = require('fs');
const minimist = require('minimist');
const KeyManager = require('./generate-key');
const VersionManager = require('./utils/version');
const Logger = require('./utils/logger');
const { OSSUploader } = require('./utils/oss-uploader');

// 支持从环境变量指定配置路径（Docker 环境使用 /ci/config）
const CI_CONFIG_PATH = process.env.CI_CONFIG_PATH || path.join(__dirname, '../config');
const ciConfig = require(path.join(CI_CONFIG_PATH, 'ci.config'));

class MiniProgramUploader {
  constructor(options) {
    this.env = options.env || 'development';
    this.action = options.action || 'upload'; // upload 或 preview
    this.version = options.version;
    this.desc = options.desc;
    this.qrcodeOutput = options.qrcode;
    this.uploadToOSS = options['upload-oss'] !== false; // 默认上传到 OSS
    this.verbose = options.verbose || false;
    this.silent = options.silent || false;
    this.privateKeyPath = options['private-key']; // 支持传入私钥文件路径

    // 获取配置
    this.config = ciConfig.getConfig(this.env);

    // 如果命令行指定了机器人编号，覆盖配置（命令行优先级最高）
    if (options.robot) {
      this.config.robot = parseInt(options.robot);
    }

    // 初始化工具
    this.keyManager = new KeyManager(this.config.appid);
    this.versionManager = new VersionManager();
    this.logger = new Logger({
      verbose: this.verbose,
      silent: this.silent,
      timestamps: true,
      logFile: this.config.logging.file ? this.config.logging.filePath : null
    });
    this.ossUploader = new OSSUploader({
      ...this.config.oss,
      cookie: options.cookie || process.env.API_COOKIE
    });

    // 项目实例
    this.project = null;
  }

  /**
   * 读取构建信息
   */
  readBuildInfo() {
    try {
      const buildInfoPath = path.join(this.config.projectPath, 'build-info.json');
      if (fs.existsSync(buildInfoPath)) {
        const buildInfo = JSON.parse(fs.readFileSync(buildInfoPath, 'utf-8'));
        this.logger.debug('读取构建信息成功');
        return buildInfo;
      }
    } catch (error) {
      this.logger.debug('读取构建信息失败: ' + error.message);
    }
    return null;
  }

  /**
   * 初始化项目
   */
  async initProject() {
    this.logger.info('正在初始化项目...');

    try {
      // 读取构建信息（如果存在）
      const buildInfo = this.readBuildInfo();
      if (buildInfo && !this.version) {
        this.version = buildInfo.version;
        this.logger.info(`从构建信息读取版本号: ${this.version}`);
      }
      if (buildInfo && !this.desc) {
        this.desc = buildInfo.description;
        this.logger.info(`从构建信息读取描述: ${this.desc}`);
      }

      // 获取私钥文件路径
      // 将提供的私钥路径传递给 generateFromEnv，让它处理验证和生成逻辑
      const privateKeyPath = await this.keyManager.generateFromEnv(this.privateKeyPath);

      // 创建项目实例
      this.project = new ci.Project({
        appid: this.config.appid,
        type: this.config.type,
        projectPath: path.resolve(this.config.projectPath),
        privateKeyPath: privateKeyPath,
        ignores: this.config.ignores
      });

      this.logger.success('项目初始化完成');
      this.logger.debug(`项目路径: ${path.resolve(this.config.projectPath)}`);
      this.logger.debug(`私钥路径: ${privateKeyPath}`);
    } catch (error) {
      this.logger.error(`项目初始化失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 执行上传和预览（同时进行）
   */
  async uploadWithPreview() {
    const version = this.versionManager.getRecommendedVersion(this.version);
    const desc = this.versionManager.generateDescription(this.env, this.desc);
    const qrcodeOutput = this.qrcodeOutput || this.config.qrcodeOptions.outputDest;

    // 获取机器人信息
    const robotInfo = ciConfig.getRobotInfo(this.config.robot);

    this.logger.info(`开始执行上传和预览...`);
    this.logger.info(`版本号: ${version}`);
    this.logger.info(`描述: ${desc}`);
    this.logger.info(`使用机器人: ${robotInfo.id} (${robotInfo.name})`);
    this.logger.divider();

    try {
      // 同时执行上传和预览
      const [uploadResult] = await Promise.all([
        // 执行上传
        (async () => {
          this.logger.info('【上传】开始上传代码...');
          const result = await ci.upload({
            project: this.project,
            version: version,
            desc: desc,
            setting: this.config.setting,
            robot: this.config.robot,
            onProgressUpdate: (info) => {
              const percent = info.percent || 0;
              const message = info.message || '上传中';
              this.logger.progress(`【上传】${message} (${percent.toFixed(1)}%)`);
            }
          });
          this.logger.success('【上传】上传成功！');
          return result;
        })(),

        // 执行预览
        (async () => {
          this.logger.info('【预览】开始生成预览二维码...');
          const result = await ci.preview({
            project: this.project,
            desc: desc,
            setting: this.config.setting,
            robot: this.config.robot,
            qrcodeFormat: this.config.qrcodeOptions.format,
            qrcodeOutputDest: path.resolve(qrcodeOutput),
            onProgressUpdate: (info) => {
              const percent = info.percent || 0;
              const message = info.message || '生成中';
              this.logger.progress(`【预览】${message} (${percent.toFixed(1)}%)`);
            }
          });
          this.logger.success('【预览】预览二维码生成成功！');
          return result;
        })()
      ]);

      this.logger.divider();

      // 上传二维码到 OSS
      let qrcodeUrl = null;
      if (this.uploadToOSS && fs.existsSync(qrcodeOutput)) {
        this.logger.info('正在上传二维码到 OSS...');

        const ossResult = await this.ossUploader.upload(qrcodeOutput);

        if (ossResult.success) {
          qrcodeUrl = ossResult.url;
          this.logger.success(`二维码已上传到 CDN`);
          this.logger.highlight(`CDN 地址: ${qrcodeUrl}`);

          // 输出 CDN 地址到文件（方便 CI/CD 使用）
          const cdnUrlFile = './preview-qrcode-url.txt';
          fs.writeFileSync(cdnUrlFile, qrcodeUrl);
          this.logger.info(`CDN 地址已保存到: ${cdnUrlFile}`);

        } else {
          this.logger.warn(`二维码上传失败: ${ossResult.error}`);
          this.logger.info('二维码仅保存在本地');
        }
      } else if (!this.uploadToOSS) {
        this.logger.info('已禁用 OSS 上传，二维码仅保存在本地');
      }

      // 输出包信息
      if (uploadResult.subPackageInfo && uploadResult.subPackageInfo.length > 0) {
        this.logger.newline();
        this.logger.info('包体积信息:');
        const tableData = uploadResult.subPackageInfo.map(pkg => {
          const sizeKB = (pkg.size / 1024).toFixed(2);
          const sizeMB = (pkg.size / 1024 / 1024).toFixed(2);
          return [
            pkg.name === '__FULL__' ? '完整包' :
            pkg.name === '__APP__' ? '主包' : pkg.name,
            `${sizeKB} KB`,
            `${sizeMB} MB`
          ];
        });
        this.logger.table(tableData, ['包名', '大小(KB)', '大小(MB)']);
      }

      // 保存上传记录
      this.saveUploadRecord({
        version,
        desc,
        env: this.env,
        robot: this.config.robot,
        uploadTime: new Date().toISOString(),
        packageInfo: uploadResult.subPackageInfo,
        buildInfo: this.versionManager.getBuildInfo(),
        qrcodeUrl: qrcodeUrl  // 添加二维码URL到上传记录
      });

      // 保存预览记录
      if (qrcodeUrl) {
        this.savePreviewRecord({
          desc,
          env: this.env,
          robot: this.config.robot,
          previewTime: new Date().toISOString(),
          qrcodeUrl: qrcodeUrl,
          localQrcodePath: qrcodeOutput,
          buildInfo: this.versionManager.getBuildInfo()
        });
      }

      // 返回合并的结果，包含二维码URL
      return {
        ...uploadResult,
        qrcodeUrl,
        localQrcodePath: qrcodeOutput
      };
    } catch (error) {
      this.logger.error(`上传或预览失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 执行上传（保留原方法以兼容）
   */
  async upload() {
    // 如果是 upload 操作，现在会同时生成预览
    return this.uploadWithPreview();
  }

  /**
   * 执行预览（支持上传二维码到 OSS）
   */
  async preview() {
    const desc = this.versionManager.generateDescription(this.env, this.desc);
    const qrcodeOutput = this.qrcodeOutput || this.config.qrcodeOptions.outputDest;

    // 获取机器人信息
    const robotInfo = ciConfig.getRobotInfo(this.config.robot);

    this.logger.info(`开始生成预览...`);
    this.logger.info(`描述: ${desc}`);
    this.logger.info(`使用机器人: ${robotInfo.id} (${robotInfo.name})`);

    try {
      const previewResult = await ci.preview({
        project: this.project,
        desc: desc,
        setting: this.config.setting,
        robot: this.config.robot,
        qrcodeFormat: this.config.qrcodeOptions.format,
        qrcodeOutputDest: path.resolve(qrcodeOutput),
        onProgressUpdate: (info) => {
          const percent = info.percent || 0;
          const message = info.message || '生成中';
          this.logger.progress(`${message} (${percent.toFixed(1)}%)`);
        }
      });

      this.logger.success('预览生成成功！');
      this.logger.info(`二维码已保存至: ${qrcodeOutput}`);

      // 上传二维码到 OSS
      let qrcodeUrl = null;
      if (this.uploadToOSS && fs.existsSync(qrcodeOutput)) {
        this.logger.info('正在上传二维码到 OSS...');

        const ossResult = await this.ossUploader.upload(qrcodeOutput);

        if (ossResult.success) {
          qrcodeUrl = ossResult.url;
          this.logger.success(`二维码已上传到 CDN`);
          this.logger.highlight(`CDN 地址: ${qrcodeUrl}`);

          // 保存预览记录
          this.savePreviewRecord({
            desc,
            env: this.env,
            robot: this.config.robot,
            previewTime: new Date().toISOString(),
            qrcodeUrl: qrcodeUrl,
            localQrcodePath: qrcodeOutput,
            buildInfo: this.versionManager.getBuildInfo()
          });

          // 输出 CDN 地址到文件（方便 CI/CD 使用）
          const cdnUrlFile = './preview-qrcode-url.txt';
          fs.writeFileSync(cdnUrlFile, qrcodeUrl);
          this.logger.info(`CDN 地址已保存到: ${cdnUrlFile}`);

        } else {
          this.logger.warn(`二维码上传失败: ${ossResult.error}`);
          this.logger.info('二维码仅保存在本地');
        }
      } else if (!this.uploadToOSS) {
        this.logger.info('已禁用 OSS 上传，二维码仅保存在本地');
      }

      // 输出包信息
      if (previewResult.subPackageInfo && previewResult.subPackageInfo.length > 0) {
        this.logger.newline();
        this.logger.info('包体积信息:');
        const tableData = previewResult.subPackageInfo.map(pkg => {
          const sizeKB = (pkg.size / 1024).toFixed(2);
          const sizeMB = (pkg.size / 1024 / 1024).toFixed(2);
          return [
            pkg.name === '__FULL__' ? '完整包' :
            pkg.name === '__APP__' ? '主包' : pkg.name,
            `${sizeKB} KB`,
            `${sizeMB} MB`
          ];
        });
        this.logger.table(tableData, ['包名', '大小(KB)', '大小(MB)']);
      }

      return {
        ...previewResult,
        qrcodeUrl
      };
    } catch (error) {
      this.logger.error(`预览生成失败: ${error.message}`);
      throw error;
    }
  }

  /**
   * 保存上传记录
   */
  saveUploadRecord(record) {
    try {
      const recordFile = './upload-history.json';
      let history = [];

      if (fs.existsSync(recordFile)) {
        const content = fs.readFileSync(recordFile, 'utf-8');
        try {
          history = JSON.parse(content);
        } catch (e) {
          this.logger.warn('上传历史文件格式错误，将重新创建');
          history = [];
        }
      }

      history.push(record);

      // 只保留最近 100 条记录
      if (history.length > 100) {
        history = history.slice(-100);
      }

      fs.writeFileSync(recordFile, JSON.stringify(history, null, 2));
      this.logger.debug('上传记录已保存');
    } catch (error) {
      this.logger.warn(`保存上传记录失败: ${error.message}`);
    }
  }

  /**
   * 保存预览记录
   */
  savePreviewRecord(record) {
    try {
      const recordFile = './preview-history.json';
      let history = [];

      if (fs.existsSync(recordFile)) {
        const content = fs.readFileSync(recordFile, 'utf-8');
        try {
          history = JSON.parse(content);
        } catch (e) {
          this.logger.warn('预览历史文件格式错误，将重新创建');
          history = [];
        }
      }

      history.push(record);

      // 只保留最近 50 条记录
      if (history.length > 50) {
        history = history.slice(-50);
      }

      fs.writeFileSync(recordFile, JSON.stringify(history, null, 2));
      this.logger.debug('预览记录已保存');
    } catch (error) {
      this.logger.warn(`保存预览记录失败: ${error.message}`);
    }
  }

  /**
   * 清理
   */
  cleanup() {
    this.logger.info('清理临时文件...');

    // 清理私钥
    this.keyManager.cleanup();

    // 清理临时目录
    const tempDir = path.join(process.cwd(), '.temp');
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
        this.logger.debug('临时目录已清理');
      } catch (error) {
        this.logger.warn(`清理临时目录失败: ${error.message}`);
      }
    }

    this.logger.success('清理完成');
  }

  /**
   * 执行主流程
   */
  async execute() {
    const startTime = Date.now();

    try {
      this.logger.divider();
      this.logger.highlight(`开始执行 ${this.action} 操作 (${this.env} 环境)`);
      this.logger.divider();

      // 显示构建信息
      if (this.verbose) {
        const buildInfo = this.versionManager.getBuildInfo();
        this.logger.debug(`Node.js: ${buildInfo.nodejs}`);
        this.logger.debug(`平台: ${buildInfo.platform}`);
        this.logger.debug(`分支: ${buildInfo.branch}`);
        this.logger.debug(`提交: ${buildInfo.commit}`);
      }

      // 初始化项目
      await this.initProject();

      let result;
      // 执行操作
      if (this.action === 'upload') {
        result = await this.upload();
      } else if (this.action === 'preview') {
        result = await this.preview();
      } else {
        throw new Error(`不支持的操作: ${this.action}`);
      }

      const duration = ((Date.now() - startTime) / 1000).toFixed(1);

      this.logger.divider();
      this.logger.success(`操作完成！耗时: ${duration}秒`);

      // 如果有二维码 URL，输出到控制台
      if (result && result.qrcodeUrl) {
        this.logger.newline();
        this.logger.icon('🔗', '二维码 CDN 地址:');
        console.log(result.qrcodeUrl);
        this.logger.newline();
      }

      return result;

    } catch (error) {
      const duration = ((Date.now() - startTime) / 1000).toFixed(1);
      this.logger.error(`执行失败: ${error.message}`);
      this.logger.error(`耗时: ${duration}秒`);

      if (this.verbose && error.stack) {
        this.logger.debug('错误堆栈:');
        this.logger.debug(error.stack);
      }

      process.exit(1);
    } finally {
      this.cleanup();
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
  node scripts/upload-mp.js [options]

选项:
  --env              环境类型 (development/staging/production) [默认: development]
  --action           操作类型 (upload/preview) [默认: upload]
  --version          版本号 [默认: package.json 中的版本]
  --desc             版本描述
  --qrcode           预览二维码输出路径
  --upload-oss       是否上传二维码到 OSS [默认: true]
  --cookie           API Cookie (用于 OSS 上传)
  --robot            使用指定的 CI 机器人编号
  --private-key      私钥文件路径（可选，默认从环境变量生成）
  --verbose          显示详细日志
  --silent           静默模式（不输出日志）
  --help, -h         显示帮助信息

示例:
  # 上传体验版
  node scripts/upload-mp.js --env development --desc "修复了一些bug"

  # 上传正式版
  node scripts/upload-mp.js --env production --version 1.2.0 --desc "新版本发布"

  # 生成预览（上传二维码到 OSS）
  node scripts/upload-mp.js --action preview --desc "测试版本"

  # 生成预览（不上传二维码）
  node scripts/upload-mp.js --action preview --upload-oss false

环境变量:
  MP_PRIVATE_KEY_BASE64  小程序私钥的 Base64 编码 (必需)
  API_COOKIE             用于 OSS 上传的 Cookie
  OSS_ENDPOINT           OSS 端点
  OSS_CDN_DOMAIN         CDN 域名
    `);
    process.exit(0);
  }

  // 显示版本信息
  if (argv.version && !argv.action) {
    const versionManager = new VersionManager();
    console.log(versionManager.generateReport());
    process.exit(0);
  }

  const uploader = new MiniProgramUploader(argv);
  uploader.execute();
}

module.exports = MiniProgramUploader;