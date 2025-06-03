// src/core/expression-engine.js
/**
 * Motor de expressão seguro para substituir eval()
 * @module core/expression-engine
 */

/**
 * Erros específicos do motor de expressão
 */
export class ExpressionError extends Error {
  constructor(message, position = null, code = 'EXPRESSION_ERROR') {
    super(message);
    this.name = 'ExpressionError';
    this.position = position;
    this.code = code;
  }
}

/**
 * Motor de expressão seguro para substituir eval()
 */
export class ExpressionEngine {
  constructor() {
    // Operadores permitidos
    this.allowedOperators = [
      '===', '!==', '==', '!=', '>', '<', '>=', '<=',
      '&&', '||', '!', '+', '-', '*', '/', '%',
      '?', ':', '(', ')', '[', ']', '.', ','
    ];
    
    // Funções seguras permitidas
    this.allowedFunctions = new Map([
      ['includes', (arr, item) => Array.isArray(arr) ? arr.includes(item) : String(arr).includes(item)],
      ['length', (obj) => obj?.length || 0],
      ['toString', (obj) => String(obj || '')],
      ['toLowerCase', (str) => String(str || '').toLowerCase()],
      ['toUpperCase', (str) => String(str || '').toUpperCase()],
      ['trim', (str) => String(str || '').trim()],
      ['parseInt', (str) => parseInt(str, 10) || 0],
      ['parseFloat', (str) => parseFloat(str) || 0],
      ['max', (...args) => Math.max(...args)],
      ['min', (...args) => Math.min(...args)],
      ['startsWith', (str, search) => String(str || '').startsWith(search || '')],
      ['endsWith', (str, search) => String(str || '').endsWith(search || '')],
      ['replace', (str, search, replaceValue) => String(str || '').replace(search || '', replaceValue || '')],
      ['join', (arr, separator) => Array.isArray(arr) ? arr.join(separator || '') : ''],
      ['slice', (arr, start, end) => Array.isArray(arr) ? arr.slice(start, end) : 
                                     typeof arr === 'string' ? arr.slice(start, end) : []],
      ['map', (arr, fn) => Array.isArray(arr) && typeof fn === 'function' ? 
                          arr.map(item => fn(item)) : []],
      ['filter', (arr, fn) => Array.isArray(arr) && typeof fn === 'function' ? 
                             arr.filter(item => fn(item)) : []]
    ]);
    
    // Cache de expressões já avaliadas para desempenho
    this.cache = new Map();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Avalia uma expressão de forma segura
   * @param {string} expression - Expressão a ser avaliada
   * @param {Object} context - Contexto de variáveis
   * @returns {*} Resultado da avaliação
   * @throws {ExpressionError} Em caso de erro de sintaxe ou expressão proibida
   */
  evaluate(expression, context = {}) {
    if (typeof expression !== 'string') {
      return expression;
    }

    // Expressões vazias retornam undefined
    expression = expression.trim();
    if (!expression) {
      return undefined;
    }

    // Verifica expressões proibidas
    this._validateSafety(expression);

    // Verifica cache (apenas para expressões pequenas)
    if (expression.length < 100) {
      const cacheKey = `${expression}::${JSON.stringify(context)}`;
      if (this.cache.has(cacheKey)) {
        this.cacheHits++;
        return this.cache.get(cacheKey);
      }
      this.cacheMisses++;
    }

    try {
      const tokens = this._tokenize(expression);
      const ast = this._parse(tokens);
      const result = this._evaluate(ast, context);
      
      // Adiciona ao cache se a expressão for pequena
      if (expression.length < 100) {
        const cacheKey = `${expression}::${JSON.stringify(context)}`;
        if (this.cache.size > 1000) { // Limite de tamanho do cache
          this.cache.clear();
        }
        this.cache.set(cacheKey, result);
      }
      
      return result;
    } catch (error) {
      if (error instanceof ExpressionError) {
        throw error;
      }
      throw new ExpressionError(`Erro ao avaliar expressão: ${expression}. ${error.message}`);
    }
  }

  /**
   * Interpola variáveis em uma string template
   * @param {string} template - String com {{variable}} placeholders
   * @param {Object} context - Contexto de variáveis
   * @returns {string} String interpolada
   */
  interpolate(template, context = {}) {
    if (typeof template !== 'string') {
      return String(template || '');
    }

    return template.replace(/\{\{([^}]+)\}\}/g, (match, expression) => {
      try {
        const result = this.evaluate(expression.trim(), context);
        return result !== undefined && result !== null ? String(result) : '';
      } catch (error) {
        console.error(`[ExpressionEngine] Erro na interpolação: ${expression}`, error);
        return ''; // Retorna string vazia em caso de erro
      }
    });
  }

  /**
   * Valida se uma expressão é segura
   * @param {string} expression - Expressão a validar
   * @throws {ExpressionError} Se a expressão contiver construções perigosas
   * @private
   */
  _validateSafety(expression) {
    const forbiddenPatterns = [
      { pattern: /eval\s*\(/, message: 'Uso de eval() não permitido' },
      { pattern: /Function\s*\(/, message: 'Construtor Function não permitido' },
      { pattern: /setTimeout|setInterval/, message: 'Funções de timer não permitidas' },
      { pattern: /new\s+Function/, message: 'Construtor Function não permitido' },
      { pattern: /\bwindow\b|\bdocument\b|\blocation\b/, message: 'Acesso a objetos globais não permitido' },
      { pattern: /\bObject\b\s*\.\s*\b(defineProperty|__proto__|constructor|prototype)\b/, message: 'Acesso a propriedades de Object não permitido' },
      { pattern: /__proto__|prototype|constructor/, message: 'Acesso a propriedades internas não permitido' }
    ];

    for (const { pattern, message } of forbiddenPatterns) {
      if (pattern.test(expression)) {
        throw new ExpressionError(message, null, 'SECURITY_VIOLATION');
      }
    }
  }

  /**
   