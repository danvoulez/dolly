// public/src/core/expression-engine.js
/**
 * Motor de expressão seguro para substituir eval()
 * Implementa um subset seguro de JavaScript para condições e interpolações
 */
export class ExpressionEngine {
  constructor() {
    this.allowedOperators = [
      '===', '!==', '==', '!=', '>', '<', '>=', '<=',
      '&&', '||', '!', '+', '-', '*', '/', '%',
      '?', ':', '(', ')', '[', ']', '.', ','
    ];
    
    this.allowedFunctions = new Map([
      ['includes', (arr, item) => Array.isArray(arr) ? arr.includes(item) : String(arr).includes(item)],
      ['length', (obj) => obj?.length || 0],
      ['toString', (obj) => String(obj)],
      ['toLowerCase', (str) => String(str).toLowerCase()],
      ['toUpperCase', (str) => String(str).toUpperCase()],
      ['trim', (str) => String(str).trim()],
      ['parseInt', (str) => parseInt(str, 10)],
      ['parseFloat', (str) => parseFloat(str)]
    ]);
    
    this.cache = new Map();
  }

  /**
   * Avalia uma expressão de forma segura
   * @param {string} expression - Expressão a ser avaliada
   * @param {Object} context - Contexto de variáveis
   * @returns {*} Resultado da avaliação
   */
  evaluate(expression, context = {}) {
    if (!expression || typeof expression !== 'string') {
      return expression;
    }

    const cacheKey = `${expression}::${JSON.stringify(context)}`;
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey);
    }

    try {
      const tokens = this._tokenize(expression);
      const ast = this._parse(tokens);
      const result = this._evaluate(ast, context);
      
      // Cache apenas se o contexto for pequeno para evitar vazamento de memória
      if (JSON.stringify(context).length < 1000) {
        this.cache.set(cacheKey, result);
      }
      
      return result;
    } catch (error) {
      console.error(`[ExpressionEngine] Erro ao avaliar: ${expression}`, error);
      return false; // Falha segura
    }
  }

  /**
   * Interpola variáveis em uma string template
   * @param {string} template - String com {{variable}} placeholders
   * @param {Object} context - Contexto de variáveis
   * @returns {string} String interpolada
   */
  interpolate(template, context = {}) {
    if (!template || typeof template !== 'string') {
      return template;
    }

    return template.replace(/\{\{([^}]+)\}\}/g, (match, expression) => {
      try {
        const result = this.evaluate(expression.trim(), context);
        return result !== undefined ? String(result) : '';
      } catch (error) {
        console.error(`[ExpressionEngine] Erro na interpolação: ${expression}`, error);
        return match; // Retorna placeholder original em caso de erro
      }
    });
  }

  /**
   * Valida se uma expressão é segura
   * @param {string} expression - Expressão a validar
   * @returns {boolean} True se segura
   */
  validateExpression(expression) {
    try {
      // Verifica por padrões perigosos
      const dangerousPatterns = [
        /eval\s*\(/,
        /Function\s*\(/,
        /constructor/,
        /prototype/,
        /__proto__/,
        /import\s*\(/,
        /require\s*\(/,
        /process\./,
        /global\./,
        /window\./,
        /document\./,
        /alert\s*\(/,
        /confirm\s*\(/,
        /prompt\s*\(/
      ];

      for (const pattern of dangerousPatterns) {
        if (pattern.test(expression)) {
          return false;
        }
      }

      // Tenta tokenizar para verificar sintaxe básica
      this._tokenize(expression);
      return true;
    } catch (error) {
      return false;
    }
  }

  // Métodos internos
  _tokenize(expression) {
    const tokens = [];
    let i = 0;
    
    while (i < expression.length) {
      const char = expression[i];
      
      if (/\s/.test(char)) {
        i++;
        continue;
      }
      
      // Strings
      if (char === '"' || char === "'") {
        const quote = char;
        let value = '';
        i++;
        while (i < expression.length && expression[i] !== quote) {
          if (expression[i] === '\\' && i + 1 < expression.length) {
            i++;
            value += expression[i];
          } else {
            value += expression[i];
          }
          i++;
        }
        if (i >= expression.length) {
          throw new Error('String não terminada');
        }
        i++;
        tokens.push({ type: 'STRING', value });
        continue;
      }
      
      // Números
      if (/\d/.test(char)) {
        let value = '';
        while (i < expression.length && /[\d.]/.test(expression[i])) {
          value += expression[i];
          i++;
        }
        tokens.push({ type: 'NUMBER', value: parseFloat(value) });
        continue;
      }
      
      // Identificadores
      if (/[a-zA-Z_$]/.test(char)) {
        let value = '';
        while (i < expression.length && /[a-zA-Z0-9_$]/.test(expression[i])) {
          value += expression[i];
          i++;
        }
        
        // Palavras-chave
        if (['true', 'false', 'null', 'undefined'].includes(value)) {
          const keywordValues = {
            'true': true,
            'false': false,
            'null': null,
            'undefined': undefined
          };
          tokens.push({ type: 'LITERAL', value: keywordValues[value] });
        } else {
          tokens.push({ type: 'IDENTIFIER', value });
        }
        continue;
      }
      
      // Operadores multi-caractere
      const twoChar = expression.substr(i, 2);
      const threeChar = expression.substr(i, 3);
      
      if (['===', '!=='].includes(threeChar)) {
        tokens.push({ type: 'OPERATOR', value: threeChar });
        i += 3;
        continue;
      }
      
      if (['==', '!=', '<=', '>=', '&&', '||'].includes(twoChar)) {
        tokens.push({ type: 'OPERATOR', value: twoChar });
        i += 2;
        continue;
      }
      
      // Operadores single-character
      if ('+-*/%!<>()[].,?:'.includes(char)) {
        tokens.push({ type: 'OPERATOR', value: char });
        i++;
        continue;
      }
      
      throw new Error(`Caractere não reconhecido: ${char}`);
    }
    
    return tokens;
  }

  _parse(tokens) {
    // Implementação simplificada de parser recursivo descendente
    let position = 0;
    
    const peek = () => tokens[position];
    const consume = () => tokens[position++];
    const expect = (type, value = null) => {
      const token = consume();
      if (!token || token.type !== type || (value && token.value !== value)) {
        throw new Error(`Token esperado: ${type}${value ? ` (${value})` : ''}, recebido: ${token?.type} (${token?.value})`);
      }
      return token;
    };
    
    const parseExpression = () => {
      return parseTernary();
    };
    
    const parseTernary = () => {
      let expr = parseLogicalOr();
      
      if (peek()?.value === '?') {
        consume(); // ?
        const trueExpr = parseExpression();
        expect('OPERATOR', ':');
        const falseExpr = parseExpression();
        return { type: 'TERNARY', condition: expr, trueExpr, falseExpr };
      }
      
      return expr;
    };
    
    const parseLogicalOr = () => {
      let left = parseLogicalAnd();
      
      while (peek()?.value === '||') {
        const operator = consume();
        const right = parseLogicalAnd();
        left = { type: 'BINARY', operator: operator.value, left, right };
      }
      
      return left;
    };
    
    const parseLogicalAnd = () => {
      let left = parseEquality();
      
      while (peek()?.value === '&&') {
        const operator = consume();
        const right = parseEquality();
        left = { type: 'BINARY', operator: operator.value, left, right };
      }
      
      return left;
    };
    
    const parseEquality = () => {
      let left = parseComparison();
      
      while (peek() && ['===', '!==', '==', '!='].includes(peek().value)) {
        const operator = consume();
        const right = parseComparison();
        left = { type: 'BINARY', operator: operator.value, left, right };
      }
      
      return left;
    };
    
    const parseComparison = () => {
      let left = parseAdditive();
      
      while (peek() && ['<', '>', '<=', '>='].includes(peek().value)) {
        const operator = consume();
        const right = parseAdditive();
        left = { type: 'BINARY', operator: operator.value, left, right };
      }
      
      return left;
    };
    
    const parseAdditive = () => {
      let left = parseMultiplicative();
      
      while (peek() && ['+', '-'].includes(peek().value)) {
        const operator = consume();
        const right = parseMultiplicative();
        left = { type: 'BINARY', operator: operator.value, left, right };
      }
      
      return left;
    };
    
    const parseMultiplicative = () => {
      let left = parseUnary();
      
      while (peek() && ['*', '/', '%'].includes(peek().value)) {
        const operator = consume();
        const right = parseUnary();
        left = { type: 'BINARY', operator: operator.value, left, right };
      }
      
      return left;
    };
    
    const parseUnary = () => {
      if (peek()?.value === '!') {
        const operator = consume();
        const operand = parseUnary();
        return { type: 'UNARY', operator: operator.value, operand };
      }
      
      return parsePostfix();
    };
    
    const parsePostfix = () => {
      let expr = parsePrimary();
      
      while (peek()) {
        if (peek().value === '.') {
          consume(); // .
          const property = expect('IDENTIFIER');
          expr = { type: 'MEMBER', object: expr, property: property.value };
        } else if (peek().value === '[') {
          consume(); // [
          const index = parseExpression();
          expect('OPERATOR', ']');
          expr = { type: 'COMPUTED', object: expr, property: index };
        } else if (peek().value === '(') {
          consume(); // (
          const args = [];
          
          if (peek()?.value !== ')') {
            args.push(parseExpression());
            while (peek()?.value === ',') {
              consume(); // ,
              args.push(parseExpression());
            }
          }
          
          expect('OPERATOR', ')');
          expr = { type: 'CALL', callee: expr, arguments: args };
        } else {
          break;
        }
      }
      
      return expr;
    };
    
    const parsePrimary = () => {
      const token = peek();
      
      if (!token) {
        throw new Error('Expressão inesperadamente terminada');
      }
      
      if (token.type === 'NUMBER' || token.type === 'STRING' || token.type === 'LITERAL') {
        return { type: 'LITERAL', value: consume().value };
      }
      
      if (token.type === 'IDENTIFIER') {
        return { type: 'IDENTIFIER', name: consume().value };
      }
      
      if (token.value === '(') {
        consume(); // (
        const expr = parseExpression();
        expect('OPERATOR', ')');
        return expr;
      }
      
      throw new Error(`Token inesperado: ${token.type} (${token.value})`);
    };
    
    return parseExpression();
  }

  _evaluate(node, context) {
    switch (node.type) {
      case 'LITERAL':
        return node.value;
        
      case 'IDENTIFIER':
        return this._resolveIdentifier(node.name, context);
        
      case 'BINARY':
        return this._evaluateBinary(node, context);
        
      case 'UNARY':
        return this._evaluateUnary(node, context);
        
      case 'TERNARY':
        const condition = this._evaluate(node.condition, context);
        return condition ? this._evaluate(node.trueExpr, context) : this._evaluate(node.falseExpr, context);
        
      case 'MEMBER':
        const object = this._evaluate(node.object, context);
        return object?.[node.property];
        
      case 'COMPUTED':
        const obj = this._evaluate(node.object, context);
        const prop = this._evaluate(node.property, context);
        return obj?.[prop];
        
      case 'CALL':
        return this._evaluateCall(node, context);
        
      default:
        throw new Error(`Tipo de nó não suportado: ${node.type}`);
    }
  }

  _resolveIdentifier(name, context) {
    // Busca em contexto local primeiro, depois global
    if (context.hasOwnProperty(name)) {
      return context[name];
    }
    
    // Resolve paths com pontos (ex: user.name)
    const parts = name.split('.');
    let current = context;
    
    for (const part of parts) {
      if (current === null || typeof current !== 'object' || !current.hasOwnProperty(part)) {
        return undefined;
      }
      current = current[part];
    }
    
    return current;
  }

  _evaluateBinary(node, context) {
    const left = this._evaluate(node.left, context);
    const right = this._evaluate(node.right, context);
    
    switch (node.operator) {
      case '===': return left === right;
      case '!==': return left !== right;
      case '==': return left == right;
      case '!=': return left != right;
      case '<': return left < right;
      case '>': return left > right;
      case '<=': return left <= right;
      case '>=': return left >= right;
      case '&&': return left && right;
      case '||': return left || right;
      case '+': return left + right;
      case '-': return left - right;
      case '*': return left * right;
      case '/': return left / right;
      case '%': return left % right;
      default:
        throw new Error(`Operador binário não suportado: ${node.operator}`);
    }
  }

  _evaluateUnary(node, context) {
    const operand = this._evaluate(node.operand, context);
    
    switch (node.operator) {
      case '!': return !operand;
      default:
        throw new Error(`Operador unário não suportado: ${node.operator}`);
    }
  }

  _evaluateCall(node, context) {
    const callee = this._evaluate(node.callee, context);
    
    if (typeof callee === 'function') {
      const args = node.arguments.map(arg => this._evaluate(arg, context));
      return callee(...args);
    }
    
    // Funções permitidas
    if (node.callee.type === 'IDENTIFIER' && this.allowedFunctions.has(node.callee.name)) {
      const func = this.allowedFunctions.get(node.callee.name);
      const args = node.arguments.map(arg => this._evaluate(arg, context));
      return func(...args);
    }
    
    throw new Error(`Função não permitida ou não encontrada: ${node.callee.name || 'unknown'}`);
  }

  /**
   * Limpa cache para liberar memória
   */
  clearCache() {
    this.cache.clear();
  }
}

// Singleton global
export const expressionEngine = new ExpressionEngine();