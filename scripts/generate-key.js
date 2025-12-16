/**
 * 私钥生成工具
 * 功能：
 * - 从 CDN URL 下载私钥
 * - 从环境变量读取 Base64 编码的私钥（向后兼容）
 * - 生成临时私钥文件
 * - 提供清理方法
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

class KeyManager {
  constructor(appid) {
    this.appid = appid;
    this.keyFileName = `private.${appid}.key`;
    this.keyPath = path.join(process.cwd(), this.keyFileName);
  }

  /**
   * 从 URL 下载文件
   * @param {string} url 文件 URL
   * @param {string} destPath 目标文件路径
   * @returns {Promise<void>}
   */
  async downloadFile(url, destPath) {
    return new Promise((resolve, reject) => {
      const protocol = url.startsWith('https') ? https : http;
      const file = fs.createWriteStream(destPath);

      protocol.get(url, (response) => {
        if (response.statusCode !== 200) {
          reject(new Error(`下载失败，状态码: ${response.statusCode}`));
          return;
        }

        response.pipe(file);

        file.on('finish', () => {
          file.close();
          resolve();
        });

        file.on('error', (error) => {
          fs.unlinkSync(destPath);
          reject(error);
        });
      }).on('error', (error) => {
        reject(error);
      });
    });
  }

  /**
   * 从环境变量生成私钥文件（或验证已存在的私钥）
   * @param {string} existingKeyPath 可选的已存在的私钥文件路径
   * @returns {Promise<string>} 私钥文件路径
   */
  async generateFromEnv(existingKeyPath) {
    // 如果提供了已存在的私钥文件路径，直接验证并使用
    if (existingKeyPath && fs.existsSync(existingKeyPath)) {
      try {
        const keyContent = fs.readFileSync(existingKeyPath, 'utf-8');

        // 验证私钥内容格式
        if (!keyContent.includes('-----BEGIN RSA PRIVATE KEY-----') &&
            !keyContent.includes('-----BEGIN PRIVATE KEY-----')) {
          throw new Error('私钥格式无效');
        }

        console.log(`✓ 使用已存在的私钥文件: ${existingKeyPath}`);
        return existingKeyPath;
      } catch (error) {
        throw new Error(`验证私钥文件失败: ${error.message}`);
      }
    }

    // 优先从 CDN URL 下载私钥
    const keyUrl = process.env.MP_PRIVATE_KEY_URL;
    if (keyUrl) {
      try {
        console.log(`正在从 CDN 下载私钥: ${keyUrl}`);
        await this.downloadFile(keyUrl, this.keyPath);

        // 验证下载的私钥内容格式
        const keyContent = fs.readFileSync(this.keyPath, 'utf-8');
        if (!keyContent.includes('-----BEGIN RSA PRIVATE KEY-----') &&
            !keyContent.includes('-----BEGIN PRIVATE KEY-----')) {
          throw new Error('下载的私钥格式无效');
        }

        // 设置文件权限为只读
        fs.chmodSync(this.keyPath, 0o400);

        console.log(`✓ 私钥文件已从 CDN 下载: ${this.keyFileName}`);
        return this.keyPath;
      } catch (error) {
        // 清理失败的下载文件
        if (fs.existsSync(this.keyPath)) {
          fs.unlinkSync(this.keyPath);
        }
        throw new Error(`从 CDN 下载私钥失败: ${error.message}`);
      }
    }

    // 否则从环境变量生成（向后兼容）
    const base64Key = process.env.MP_PRIVATE_KEY_BASE64;

    if (!base64Key) {
      throw new Error('环境变量 MP_PRIVATE_KEY_URL 或 MP_PRIVATE_KEY_BASE64 未设置');
    }

    try {
      // 解码 Base64
      const keyContent = Buffer.from(base64Key, 'base64').toString('utf-8');

      // 验证私钥内容格式
      if (!keyContent.includes('-----BEGIN RSA PRIVATE KEY-----') &&
          !keyContent.includes('-----BEGIN PRIVATE KEY-----')) {
        throw new Error('私钥格式无效');
      }

      // 写入文件
      fs.writeFileSync(this.keyPath, keyContent, 'utf-8');

      // 设置文件权限为只读
      fs.chmodSync(this.keyPath, 0o400);

      console.log(`✓ 私钥文件已生成: ${this.keyFileName}`);
      return this.keyPath;
    } catch (error) {
      throw new Error(`生成私钥文件失败: ${error.message}`);
    }
  }

  /**
   * 从文件路径读取私钥
   * @param {string} filePath 私钥文件路径
   * @returns {Promise<string>} 私钥文件路径
   */
  async generateFromFile(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`私钥文件不存在: ${filePath}`);
    }

    try {
      const keyContent = fs.readFileSync(filePath, 'utf-8');

      // 验证私钥内容格式
      if (!keyContent.includes('-----BEGIN RSA PRIVATE KEY-----') &&
          !keyContent.includes('-----BEGIN PRIVATE KEY-----')) {
        throw new Error('私钥格式无效');
      }

      // 复制到工作目录
      fs.writeFileSync(this.keyPath, keyContent, 'utf-8');
      fs.chmodSync(this.keyPath, 0o400);

      console.log(`✓ 私钥文件已复制: ${this.keyFileName}`);
      return this.keyPath;
    } catch (error) {
      throw new Error(`读取私钥文件失败: ${error.message}`);
    }
  }

  /**
   * 清理私钥文件
   */
  cleanup() {
    if (fs.existsSync(this.keyPath)) {
      try {
        fs.unlinkSync(this.keyPath);
        console.log(`✓ 私钥文件已清理: ${this.keyFileName}`);
      } catch (error) {
        console.warn(`清理私钥文件失败: ${error.message}`);
      }
    }
  }

  /**
   * 检查私钥文件是否存在
   * @returns {boolean}
   */
  exists() {
    return fs.existsSync(this.keyPath);
  }

  /**
   * 获取私钥文件路径
   * @returns {string}
   */
  getPath() {
    return this.keyPath;
  }

  /**
   * 测试方法
   */
  static async test() {
    console.log('开始测试私钥生成工具...');

    // 创建测试私钥内容
    const testKey = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEAtest...
-----END RSA PRIVATE KEY-----`;

    const keyManager = new KeyManager('test_appid');

    try {
      console.log('\n--- 测试 1: 从 Base64 环境变量生成 ---');
      // 设置测试环境变量
      process.env.MP_PRIVATE_KEY_BASE64 = Buffer.from(testKey).toString('base64');

      // 测试从环境变量生成
      const keyPath = await keyManager.generateFromEnv();
      console.log(`✓ 测试通过: 私钥文件路径 ${keyPath}`);

      // 验证文件存在
      if (!keyManager.exists()) {
        throw new Error('私钥文件不存在');
      }
      console.log('✓ 测试通过: 私钥文件存在');

      // 清理测试文件
      keyManager.cleanup();

      // 验证文件已删除
      if (keyManager.exists()) {
        throw new Error('私钥文件未被清理');
      }
      console.log('✓ 测试通过: 私钥文件已清理');

      // 清理环境变量
      delete process.env.MP_PRIVATE_KEY_BASE64;

      console.log('\n--- 测试 2: 从 URL 下载私钥（模拟） ---');
      console.log('注意：URL 下载功能需要真实的 CDN 地址才能测试');
      console.log('可以设置 MP_PRIVATE_KEY_URL 环境变量进行测试');

      console.log('\n所有测试通过！');
    } catch (error) {
      console.error(`✗ 测试失败: ${error.message}`);
      // 确保清理测试文件
      keyManager.cleanup();
      process.exit(1);
    } finally {
      // 清理测试环境变量
      delete process.env.MP_PRIVATE_KEY_BASE64;
      delete process.env.MP_PRIVATE_KEY_URL;
    }
  }
}

// 如果直接运行此文件，执行测试
if (require.main === module) {
  KeyManager.test();
}

module.exports = KeyManager;