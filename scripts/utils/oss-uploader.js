/**
 * OSS 上传工具
 * 功能：
 * - 通过签名方式上传文件到讯飞 OSS
 * - 返回 CDN 地址
 */

const fs = require('fs');
const path = require('path');
const axios = require('axios');

// 内容类型映射
const contentTypeMap = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.json': 'application/json',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript'
};

// 预设配置
const PRESETS = {
  // 智文项目配置
  zhiwen: {
    endpoint: 'https://pre-zw.xfyun.cn',
    bucket: 'zhiwen-assets',
    cdnDomain: 'https://zhiwen-cdn.xfyun.cn',
    signatureUrl: '/api/developer/user/fileToken'
  },
  // AI竞赛平台配置
  aicontest: {
    endpoint: 'https://open-inc.xfyun.cn',
    bucket: 'aicontest',
    cdnDomain: 'https://openres.xfyun.cn',
    signatureUrl: '/cmp/xfyundoc/getPresignedUrl'
  }
};

class OSSUploader {
  constructor(config = {}) {
    // 使用预设配置或自定义配置 - 默认使用 aicontest 配置
    const preset = config.preset || 'aicontest';
    const presetConfig = PRESETS[preset] || PRESETS.aicontest;

    // OSS 配置 - 严格使用预设配置，除非显式指定了完整的配置
    // 忽略任何 undefined、null 或空字符串的配置值
    this.ossConfig = {
      endpoint: (config.endpoint && config.endpoint !== '') ? config.endpoint : presetConfig.endpoint,
      bucket: (config.bucket && config.bucket !== '') ? config.bucket : presetConfig.bucket,
      cdnDomain: (config.cdnDomain && config.cdnDomain !== '') ? config.cdnDomain : presetConfig.cdnDomain
    };

    // API 配置 - 使用预设的 endpoint 构建签名 URL
    this.apiConfig = {
      signatureUrl: config.signatureUrl
        ? `${presetConfig.endpoint}${config.signatureUrl}`
        : `${presetConfig.endpoint}${presetConfig.signatureUrl}`,
      cookie: config.cookie || process.env.API_COOKIE || ''
    };

    console.log(`[OSSUploader] 使用配置: ${preset}`);
    console.log(`[OSSUploader] Endpoint: ${this.ossConfig.endpoint}`);
    console.log(`[OSSUploader] Bucket: ${this.ossConfig.bucket}`);
    console.log(`[OSSUploader] CDN Domain: ${this.ossConfig.cdnDomain}`);
    console.log(`[OSSUploader] SignatureUrl: ${this.apiConfig.signatureUrl}`);
  }

  /**
   * 生成唯一的文件名
   * @param {string} originalName - 原始文件名
   * @param {boolean} pureName - 是否使用原名
   * @returns {string} 文件名
   */
  generateFileName(originalName, pureName = false) {
    const timestamp = Date.now();
    const ext = path.extname(originalName);
    const baseName = path.basename(originalName, ext);

    if (pureName) {
      return originalName;
    }

    // 使用时间戳目录结构，避免文件名冲突
    return `${timestamp}/${baseName}${ext}`;
  }

  /**
   * 获取文件的 Content-Type
   * @param {string} fileName - 文件名
   * @returns {string} Content-Type
   */
  getContentType(fileName) {
    const ext = path.extname(fileName).toLowerCase();
    return contentTypeMap[ext] || 'application/octet-stream';
  }

  /**
   * 获取上传签名
   * @param {string} objectName - 对象名称
   * @param {string} contentType - 内容类型
   * @returns {Promise<Object>} 签名数据
   */
  async getSignature(objectName, contentType) {
    try {
      const url = `${this.apiConfig.signatureUrl}?objectName=${encodeURIComponent(objectName)}&contentType=${encodeURIComponent(contentType)}`;

      console.log(`[OSSUploader] 获取签名: ${url}`);

      const response = await axios.get(url, {
        headers: {
          'Cookie': this.apiConfig.cookie,
          'X-Requested-With': 'XMLHttpRequest',
          'device': 'miniprogram-ci',
          'from': 'zhiwen'
        },
        timeout: 10000
      });

      if (response.data && response.data.code === 0) {
        return response.data.data;
      } else {
        throw new Error(response.data?.desc || '获取签名失败');
      }
    } catch (error) {
      console.error('[OSSUploader] 获取上传签名失败:', error.message);
      if (error.response) {
        console.error('[OSSUploader] 响应状态:', error.response.status);
        console.error('[OSSUploader] 响应数据:', error.response.data);
      }
      throw error;
    }
  }

  /**
   * 使用签名上传文件
   * @param {string} filePath - 本地文件路径
   * @param {Object} options - 上传选项
   * @returns {Promise<{success: boolean, url?: string, error?: string}>}
   */
  async uploadWithSignature(filePath, options = {}) {
    try {
      // 检查文件是否存在
      if (!fs.existsSync(filePath)) {
        throw new Error(`文件不存在: ${filePath}`);
      }

      // 读取文件
      const fileBuffer = fs.readFileSync(filePath);
      const fileName = path.basename(filePath);
      const objectName = this.generateFileName(fileName, options.pureName);
      const contentType = this.getContentType(fileName);

      // 获取上传签名
      console.log(`[OSSUploader] 正在获取上传签名...`);
      const signatureData = await this.getSignature(objectName, contentType);

      // 签名返回的是预签名URL
      let uploadUrl = signatureData;

      // 强制使用 HTTPS
      if (options.forceSSL !== false) {
        uploadUrl = uploadUrl.replace('http://', 'https://');
      }

      console.log(`[OSSUploader] 正在上传文件: ${fileName}`);

      // 从 URL 中提取参数
      const urlObj = new URL(uploadUrl);
      const xAmzAcl = urlObj.searchParams.get('x-amz-acl');

      // 准备请求头
      const headers = {
        'Content-Type': contentType
      };

      if (xAmzAcl) {
        headers['x-amz-acl'] = xAmzAcl;
      }

      // 使用 PUT 方法上传文件
      const uploadResponse = await axios.put(uploadUrl, fileBuffer, {
        headers,
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 60000
      });

      // 上传成功
      if (uploadResponse.status === 200) {
        // 从预签名 URL 中获取最终的文件 URL
        let fileUrl = uploadUrl.split('?')[0];

        // 转换为 CDN URL
        if (this.ossConfig.cdnDomain) {
          // 提取路径部分（去除域名）
          const urlParts = fileUrl.match(/https?:\/\/[^\/]*(.*)/);
          if (urlParts && urlParts[1]) {
            let pathPart = urlParts[1];
            // 移除 /open_res 前缀（如果存在）
            pathPart = pathPart.replace(/^\/open_res/, '');
            // 构建最终的 CDN URL
            fileUrl = this.ossConfig.cdnDomain + pathPart;
          }
        }

        console.log(`[OSSUploader] 文件上传成功: ${fileUrl}`);

        return {
          success: true,
          url: fileUrl,
          objectName: objectName
        };
      } else {
        throw new Error(`上传失败，状态码: ${uploadResponse.status}`);
      }

    } catch (error) {
      console.error('[OSSUploader] 文件上传失败:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 上传文件（主入口）
   * @param {string} filePath - 本地文件路径
   * @param {Object} options - 上传选项
   * @returns {Promise<{success: boolean, url?: string, error?: string}>}
   */
  async upload(filePath, options = {}) {
    return this.uploadWithSignature(filePath, options);
  }

  /**
   * 批量上传文件
   * @param {string[]} filePaths - 文件路径数组
   * @param {Object} options - 上传选项
   * @returns {Promise<Array>} 上传结果数组
   */
  async uploadBatch(filePaths, options = {}) {
    const results = [];
    const successList = [];
    const errorList = [];

    for (let i = 0; i < filePaths.length; i++) {
      const filePath = filePaths[i];
      console.log(`[OSSUploader] 批量上传进度: ${i + 1}/${filePaths.length}`);

      const result = await this.upload(filePath, options);

      if (result.success) {
        successList.push(result.url);
      } else {
        errorList.push({
          filePath,
          error: result.error
        });
      }

      results.push({
        filePath,
        ...result
      });
    }

    console.log(`[OSSUploader] 批量上传完成: 成功 ${successList.length}，失败 ${errorList.length}`);

    return {
      results,
      successList,
      errorList
    };
  }

  /**
   * 上传 Buffer 数据
   * @param {Buffer} buffer - Buffer 数据
   * @param {string} fileName - 文件名
   * @param {Object} options - 上传选项
   * @returns {Promise<{success: boolean, url?: string, error?: string}>}
   */
  async uploadBuffer(buffer, fileName, options = {}) {
    try {
      // 创建临时文件
      const tempDir = path.join(process.cwd(), '.temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const tempFilePath = path.join(tempDir, fileName);
      fs.writeFileSync(tempFilePath, buffer);

      // 上传文件
      const result = await this.upload(tempFilePath, options);

      // 清理临时文件
      try {
        fs.unlinkSync(tempFilePath);
      } catch (e) {
        console.warn('[OSSUploader] 清理临时文件失败:', e.message);
      }

      return result;
    } catch (error) {
      console.error('[OSSUploader] Buffer 上传失败:', error.message);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * 从 URL 中获取参数值
   * @param {string} url - URL
   * @param {string} paramName - 参数名
   * @returns {string|null} 参数值
   */
  getParamFromUrl(url, paramName) {
    try {
      const urlObj = new URL(url);
      return urlObj.searchParams.get(paramName);
    } catch (error) {
      return null;
    }
  }
}

// 单例模式
let instance = null;

/**
 * 获取 OSS 上传器实例
 * @param {Object} config - 配置选项
 * @returns {OSSUploader} OSS 上传器实例
 */
function getOSSUploader(config) {
  if (!instance) {
    instance = new OSSUploader(config);
  }
  return instance;
}

module.exports = {
  OSSUploader,
  getOSSUploader,
  PRESETS
};