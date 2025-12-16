/**
 * 日志工具
 * 功能：
 * - 格式化输出日志
 * - 支持不同级别日志
 * - 进度显示
 */

const chalk = require('chalk');

class Logger {
  constructor(options = {}) {
    this.verbose = options.verbose || false;
    this.silent = options.silent || false;
    this.logFile = options.logFile || null;
    this.timestamps = options.timestamps !== false;
  }

  /**
   * 获取时间戳
   * @returns {string}
   */
  getTimestamp() {
    if (!this.timestamps) return '';
    const now = new Date();
    return `[${now.toTimeString().split(' ')[0]}]`;
  }

  /**
   * 格式化消息
   * @param {string} level - 日志级别
   * @param {string} message - 消息内容
   * @returns {string}
   */
  formatMessage(level, message) {
    const timestamp = this.getTimestamp();
    return timestamp ? `${timestamp} ${message}` : message;
  }

  /**
   * 输出到控制台和文件
   * @param {string} message - 消息内容
   * @param {Function} chalkFn - chalk 颜色函数
   */
  output(message, chalkFn = chalk.white) {
    if (!this.silent) {
      console.log(chalkFn(message));
    }

    // 如果配置了日志文件，同时写入文件
    if (this.logFile) {
      const fs = require('fs');
      const path = require('path');

      // 确保日志目录存在
      const logDir = path.dirname(this.logFile);
      if (!fs.existsSync(logDir)) {
        fs.mkdirSync(logDir, { recursive: true });
      }

      const plainMessage = message.replace(/\x1b\[[0-9;]*m/g, ''); // 移除颜色代码
      fs.appendFileSync(this.logFile, plainMessage + '\n', 'utf-8');
    }
  }

  /**
   * 信息日志
   * @param {string} message
   */
  info(message) {
    const formatted = this.formatMessage('INFO', message);
    this.output(`${chalk.blue('[INFO]')} ${formatted}`, chalk.white);
  }

  /**
   * 成功日志
   * @param {string} message
   */
  success(message) {
    const formatted = this.formatMessage('SUCCESS', message);
    this.output(`${chalk.green('[SUCCESS]')} ${formatted}`, chalk.green);
  }

  /**
   * 错误日志
   * @param {string} message
   */
  error(message) {
    const formatted = this.formatMessage('ERROR', message);
    this.output(`${chalk.red('[ERROR]')} ${formatted}`, chalk.red);
  }

  /**
   * 警告日志
   * @param {string} message
   */
  warn(message) {
    const formatted = this.formatMessage('WARN', message);
    this.output(`${chalk.yellow('[WARN]')} ${formatted}`, chalk.yellow);
  }

  /**
   * 调试日志（仅在 verbose 模式下显示）
   * @param {string} message
   */
  debug(message) {
    if (this.verbose) {
      const formatted = this.formatMessage('DEBUG', message);
      this.output(`${chalk.gray('[DEBUG]')} ${formatted}`, chalk.gray);
    }
  }

  /**
   * 进度日志
   * @param {string} message
   */
  progress(message) {
    const formatted = this.formatMessage('PROGRESS', message);
    this.output(`${chalk.cyan('[PROGRESS]')} ${formatted}`, chalk.cyan);
  }

  /**
   * 分隔线
   */
  divider() {
    this.output(chalk.gray('='.repeat(60)), chalk.gray);
  }

  /**
   * 空行
   */
  newline() {
    console.log('');
  }

  /**
   * 表格输出
   * @param {Array} data - 表格数据
   * @param {Array} headers - 表头
   */
  table(data, headers) {
    if (!data || data.length === 0) return;

    // 计算列宽
    const columnWidths = headers.map((header, index) => {
      const maxLength = Math.max(
        header.length,
        ...data.map(row => String(row[index] || '').length)
      );
      return Math.min(maxLength, 40); // 限制最大宽度
    });

    // 输出表头
    const headerRow = headers
      .map((header, index) => header.padEnd(columnWidths[index]))
      .join(' | ');

    this.output(chalk.bold(headerRow), chalk.white);
    this.output(chalk.gray('-'.repeat(headerRow.length)), chalk.gray);

    // 输出数据行
    data.forEach(row => {
      const dataRow = row
        .map((cell, index) => {
          const cellStr = String(cell || '');
          return cellStr.length > columnWidths[index]
            ? cellStr.substring(0, columnWidths[index] - 3) + '...'
            : cellStr.padEnd(columnWidths[index]);
        })
        .join(' | ');

      this.output(dataRow, chalk.white);
    });
  }

  /**
   * 列表输出
   * @param {Array} items - 列表项
   * @param {string} bullet - 项目符号
   */
  list(items, bullet = '•') {
    items.forEach(item => {
      this.output(`  ${chalk.cyan(bullet)} ${item}`, chalk.white);
    });
  }

  /**
   * 高亮输出
   * @param {string} message
   */
  highlight(message) {
    this.output(chalk.bgCyan.black(` ${message} `), chalk.white);
  }

  /**
   * 带图标的输出
   * @param {string} icon - 图标
   * @param {string} message - 消息
   */
  icon(icon, message) {
    this.output(`${icon} ${message}`, chalk.white);
  }

  /**
   * 静态方法 - 快速输出
   */
  static info(message) {
    console.log(`${chalk.blue('[INFO]')} ${message}`);
  }

  static success(message) {
    console.log(`${chalk.green('[SUCCESS]')} ${message}`);
  }

  static error(message) {
    console.log(`${chalk.red('[ERROR]')} ${message}`);
  }

  static warn(message) {
    console.log(`${chalk.yellow('[WARN]')} ${message}`);
  }

  static progress(message) {
    console.log(`${chalk.cyan('[PROGRESS]')} ${message}`);
  }

  static divider() {
    console.log(chalk.gray('='.repeat(60)));
  }
}

// 创建默认实例
const defaultLogger = new Logger();

// 导出类和默认实例
module.exports = Logger;
module.exports.default = defaultLogger;