/**
 * CI 配置文件
 * 定义不同环境的上传配置
 */

const fs = require('fs');
const path = require('path');

/**
 * 从项目的 project.config.json 中读取 appid
 * @returns {string} appid
 */
function getAppIdFromProject() {
  try {
    // 优先从环境变量获取
    if (process.env.MP_APPID) {
      return process.env.MP_APPID;
    }

    // 尝试从当前工作目录的 project.config.json 读取
    const projectConfigPath = path.join(process.cwd(), 'project.config.json');
    if (fs.existsSync(projectConfigPath)) {
      const projectConfig = JSON.parse(fs.readFileSync(projectConfigPath, 'utf-8'));
      if (projectConfig.appid) {
        return projectConfig.appid;
      }
    }

    // 默认值（智文小程序）
    return "wxf2badc6a683ab3a9";
  } catch (error) {
    console.warn('读取 project.config.json 失败，使用默认 appid');
    return "wxf2badc6a683ab3a9";
  }
}

module.exports = {
  // 通用配置
  common: {
    appid: getAppIdFromProject(),
    type: "miniProgram",
    projectPath: "./dist",
    ignores: [
      "node_modules/**/*",
      "**/.DS_Store",
      "**/*.map",
      "**/*.log",
      "**/test/**",
      "**/tests/**",
      "**/*.test.*",
      "**/*.spec.*",
    ],
  },

  // 体验版配置
  development: {
    robot: 1, // 使用 1 号 CI 机器人
    setting: {
      es6: true,
      minifyJS: true,
      minifyWXML: true,
      minifyWXSS: true,
      minify: true,
      codeProtect: false,
      autoPrefixWXSS: false,
    },
    qrcodeOptions: {
      format: "image",
      outputDest: "./preview-qrcode-dev.jpg",
    },
  },

  // 预发布配置
  staging: {
    robot: 2, // 使用 2 号 CI 机器人
    setting: {
      es6: true,
      minifyJS: true,
      minifyWXML: true,
      minifyWXSS: true,
      minify: true,
      codeProtect: false,
      autoPrefixWXSS: false,
    },
    qrcodeOptions: {
      format: "image",
      outputDest: "./preview-qrcode-staging.jpg",
    },
  },

  // 正式版配置
  production: {
    robot: 3, // 使用 3 号 CI 机器人
    setting: {
      es6: true,
      minifyJS: true,
      minifyWXML: true,
      minifyWXSS: true,
      minify: true,
      codeProtect: false,
      autoPrefixWXSS: false,
    },
    qrcodeOptions: {
      format: "image",
      outputDest: "./preview-qrcode-prod.jpg",
    },
  },

  // OSS 配置
  oss: {
    // 使用 aicontest preset，不再硬编码具体配置
    preset: process.env.OSS_PRESET || "aicontest",
    uploadPath: "miniprogram-ci/qrcodes/", // OSS 上传路径前缀
  },

  // 通知配置
  notification: {
    // 钉钉机器人配置
    dingtalk: {
      webhook: process.env.DINGTALK_WEBHOOK,
      secret: process.env.DINGTALK_SECRET,
    },
    // 企业微信机器人配置
    wecom: {
      webhook: process.env.WECOM_WEBHOOK,
    },
    // 飞书机器人配置
    lark: {
      webhook: process.env.LARK_WEBHOOK,
      secret: process.env.LARK_SECRET,
    },
  },

  // 版本管理配置
  version: {
    // 版本号生成规则
    autoIncrement: false, // 是否自动递增版本号
    useGitTag: true, // 是否使用 Git Tag 作为版本号
    prefix: "v", // 版本号前缀

    // 版本描述模板
    descriptionTemplate: "${env} - ${time} - ${branch}@${commit}",
  },

  // 构建配置
  build: {
    // 构建命令
    commands: {
      development: "npm run build:pre",
      staging: "npm run build:pre",
      production: "npm run build",
    },
    // 构建超时时间（毫秒）
    timeout: 300000, // 5分钟
    // 是否在上传前自动构建
    autoBuild: true,
  },

  // 缓存配置
  cache: {
    // 是否启用缓存
    enabled: true,
    // 缓存目录
    directory: ".cache",
    // 缓存文件
    files: ["node_modules", ".taro"],
  },

  // 错误处理配置
  errorHandling: {
    // 重试次数
    retryCount: 3,
    // 重试延迟（毫秒）
    retryDelay: 5000,
    // 是否在错误时继续
    continueOnError: false,
  },

  // 日志配置
  logging: {
    // 日志级别：debug, info, warn, error
    level: process.env.LOG_LEVEL || "info",
    // 是否输出到文件
    file: true,
    // 日志文件路径
    filePath: "./logs/miniprogram-ci.log",
    // 是否带时间戳
    timestamps: true,
    // 是否彩色输出
    colors: true,
  },

  // 安全配置
  security: {
    // 是否检查私钥
    checkPrivateKey: true,
    // 允许的 IP 白名单
    ipWhitelist: process.env.IP_WHITELIST
      ? process.env.IP_WHITELIST.split(",")
      : [],
    // 是否强制 HTTPS
    forceHttps: true,
  },
};

// 获取指定环境的配置
module.exports.getConfig = function (env = 'development') {
  const envConfig = module.exports[env];

  if (!envConfig) {
    throw new Error(`未找到环境配置: ${env}`);
  }

  // 合并通用配置和环境配置
  return {
    ...module.exports.common,
    ...envConfig,
    env,
    oss: module.exports.oss,
    notification: module.exports.notification,
    version: module.exports.version,
    build: module.exports.build,
    cache: module.exports.cache,
    errorHandling: module.exports.errorHandling,
    logging: module.exports.logging,
    security: module.exports.security
  };
};

// 验证配置
module.exports.validate = function (config) {
  const required = ['appid', 'type', 'projectPath', 'robot', 'setting'];
  const missing = required.filter(key => !config[key]);

  if (missing.length > 0) {
    throw new Error(`配置缺少必要字段: ${missing.join(', ')}`);
  }

  return true;
};