// public/src/utils/logger.js
/**
 * Sistema de logging centralizado com níveis e formatação
 */
export class Logger {
  constructor(options = {}) {
    this.options = {
      level: options.level || (process.env.NODE_ENV === 'production' ? 'warn' : 'debug'),
      prefix: options.prefix || 'FlipApp',
      enableTimestamps: options.enableTimestamps !== undefined ? options.enableTimestamps : true,
      enableStackTrace: options.enableStackTrace !== undefined ? options.enableStackTrace : false,
      persist: options.persist !== undefined ? options.persist : false,
      consoleOutput: options.consoleOutput !== undefined ? options.consoleOutput : true
    };
    
    this.levels = {
      debug: 0,
      info: 1,
      warn: 2,
      error: 3
    };
    
    this.persistedLogs = [];
    this.maxPersistedLogs = options.maxPersistedLogs || 1000;
  }
  
  /**
   * Log no nível debug
   * @param {...any} args Argumentos para log
   */
  debug(...args) {
    this._log('debug', ...args);
  }
  
  /**
   * Log no nível info
   * @param {...any} args Argumentos para log
   */
  info(...args) {
    this._log('info', ...args);
  }
  
  /**
   * Log no nível warn
   * @param {...any} args Argumentos para log
   */
  warn(...args) {
    this._log('warn', ...args);
  }
  
  /**
   * Log no nível error
   * @param {...any} args Argumentos para log
   */
  error(...args) {
    this._log('error', ...args);
  }
  
  /**
   * Método interno para processamento do log
   * @param {string} level Nível do log
   * @param {...any} args Argumentos para log
   */
  _log(level, ...args) {
    if (this.levels[level] < this.levels[this.options.level]) return;
    
    const timestamp = this.options.enableTimestamps ? new Date().toISOString() : '';
    const prefix = this.options.prefix ? `[${this.options.prefix}]` : '';
    const logLevel = `[${level.toUpperCase()}]`;
    
    // Prep mensagem para console
    const consoleArgs = [];
    if (timestamp) consoleArgs.push(`${timestamp}`);
    consoleArgs.push(`${prefix}${logLevel}`);
    consoleArgs.push(...args);
    
    // Log para console
    if (this.options.consoleOutput) {
      switch (level) {
        case 'debug':
          console.debug(...consoleArgs);
          break;
        case 'info':
          console.info(...consoleArgs);
          break;
        case 'warn':
          console.warn(...consoleArgs);
          break;
        case 'error':
          console.error(...consoleArgs);
          break;
      }
    }
    
    // Persistir log se configurado
    if (this.options.persist) {
      const logEntry = {
        timestamp: new Date().toISOString(),
        level,
        message: args.map(arg => 
          typeof arg === 'object' ? JSON.stringify(arg) : String(arg)
        ).join(' ')
      };
      
      this.persistedLogs.push(logEntry);
      
      // Limita tamanho do buffer de logs
      if (this.persistedLogs.length > this.maxPersistedLogs) {
        this.persistedLogs.shift();
      }
    }
    
    // Adiciona stack trace para erros se configurado
    if (level === 'error' && this.options.enableStackTrace) {
      console.groupCollapsed('Stack trace:');
      console.trace();
      console.groupEnd();
    }
  }
  
  /**
   * Exporta logs persistidos
   * @returns {Array} Array de logs persistidos
   */
  export() {
    return this.persistedLogs;
  }
  
  /**
   * Limpa logs persistidos
   */
  clear() {
    this.persistedLogs = [];
  }
  
  /**
   * Define nível de log
   * @param {string} level Nível de log ('debug', 'info', 'warn', 'error')
   */
  setLevel(level) {
    if (this.levels[level] !== undefined) {
      this.options.level = level;
    }
  }
}

// Logger singleton
export const logger = new Logger({
  level: process.env.NODE_ENV === 'production' ? 'warn' : 'debug',
  persist: process.env.NODE_ENV === 'development'
});