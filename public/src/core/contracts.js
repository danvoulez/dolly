// public/src/core/contracts.js
/**
 * Sistema de contratos refinado com middleware, validação e auditoria
 */
import { stateManager } from './state.js';
import { indexedDBBridge } from '../wasm/indexeddb-bridge.js';

export class ContractSystem {
  constructor() {
    this.contracts = new Map();
    this.middleware = [];
    this.validationRules = new Map();
    this.executionHistory = [];
    this.maxHistorySize = 1000;
    
    // Registra contratos padrão
    this.registerDefaultContracts();
  }

  /**
   * Registra um novo contrato
   * @param {string} name - Nome do contrato
   * @param {function} handler - Função do contrato
   * @param {Object} options - Opções (validação, middleware, etc.)
   */
  register(name, handler, options = {}) {
    if (typeof handler !== 'function') {
      throw new Error(`Handler do contrato ${name} deve ser uma função`);
    }

    this.contracts.set(name, {
      handler,
      options: {
        requiresAuth: false,
        rateLimit: null,
        validation: null,
        async: false,
        ...options
      }
    });

    if (options.validation) {
      this.validationRules.set(name, options.validation);
    }

    console.debug(`[Contracts] Contrato registrado: ${name}`);
  }

  /**
   * Remove um contrato
   * @param {string} name - Nome do contrato
   */
  unregister(name) {
    this.contracts.delete(name);
    this.validationRules.delete(name);
    console.debug(`[Contracts] Contrato removido: ${name}`);
  }

  /**
   * Executa um contrato
   * @param {string} name - Nome do contrato
   * @param {Object} params - Parâmetros do contrato
   * @param {Object} context - Contexto de execução
   * @returns {Promise<*>} Resultado da execução
   */
  async execute(name, params = {}, context = {}) {
    const startTime = performance.now();
    const executionId = `${name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      // Verifica se contrato existe
      if (!this.contracts.has(name)) {
        throw new ContractError(`Contrato não encontrado: ${name}`, 'CONTRACT_NOT_FOUND');
      }

      const contract = this.contracts.get(name);
      const { handler, options } = contract;

      // Execução de middleware "before"
      const middlewareContext = { name, params, context, executionId };
      await this.executeMiddleware('before', middlewareContext);

      // Validação de parâmetros
      if (options.validation) {
        this.validateParams(name, params);
      }

      // Verificação de rate limiting
      if (options.rateLimit) {
        await this.checkRateLimit(name, options.rateLimit);
      }

      // Execução do contrato
      let result;
      if (options.async) {
        result = await handler(params, context, this);
      } else {
        result = handler(params, context, this);
      }

      const endTime = performance.now();
      const executionTime = endTime - startTime;

      // Log de auditoria
      const auditSpan = {
        id: executionId,
        type: 'contract_executed',
        contract: name,
        params: this.sanitizeParams(params),
        result: this.sanitizeResult(result),
        execution_time_ms: executionTime,
        timestamp: new Date().toISOString(),
        session_id: stateManager.getState('session.id'),
        user_id: context.userId || 'anonymous',
        success: true
      };

      // Salva span de auditoria
      stateManager.appendState('audit.spans', auditSpan);
      this.addToHistory(auditSpan);

      // Persiste no IndexedDB se disponível
      try {
        await indexedDBBridge.addSpan(auditSpan);
      } catch (error) {
        console.warn('[Contracts] Falha ao persistir span de auditoria:', error);
      }

      // Execução de middleware "after"
      middlewareContext.result = result;
      middlewareContext.executionTime = executionTime;
      await this.executeMiddleware('after', middlewareContext);

      console.debug(`[Contracts] Contrato ${name} executado com sucesso em ${executionTime.toFixed(2)}ms`);
      return result;

    } catch (error) {
      const endTime = performance.now();
      const executionTime = endTime - startTime;

      // Log de erro
      const errorSpan = {
        id: executionId,
        type: 'contract_execution_error',
        contract: name,
        params: this.sanitizeParams(params),
        error: error.message,
        error_type: error.constructor.name,
        execution_time_ms: executionTime,
        timestamp: new Date().toISOString(),
        session_id: stateManager.getState('session.id'),
        user_id: context.userId || 'anonymous',
        success: false
      };

      stateManager.appendState('audit.spans', errorSpan);
      this.addToHistory(errorSpan);

      // Execução de middleware "error"
      const middlewareContext = { name, params, context, executionId, error };
      await this.executeMiddleware('error', middlewareContext);

      console.error(`[Contracts] Erro no contrato ${name}:`, error);
      throw error;
    }
  }

  /**
   * Adiciona middleware
   * @param {string} phase - Fase (before, after, error)
   * @param {function} handler - Handler do middleware
   */
  addMiddleware(phase, handler) {
    if (!['before', 'after', 'error'].includes(phase)) {
      throw new Error(`Fase de middleware inválida: ${phase}`);
    }

    if (!this.middleware[phase]) {
      this.middleware[phase] = [];
    }

    this.middleware[phase].push(handler);
  }

  /**
   * Executa middleware para uma fase
   * @param {string} phase - Fase do middleware
   * @param {Object} context - Contexto
   */
  async executeMiddleware(phase, context) {
    const handlers = this.middleware[phase] || [];
    
    for (const handler of handlers) {
      try {
        await handler(context);
      } catch (error) {
        console.error(`[Contracts] Erro em middleware ${phase}:`, error);
        if (phase === 'before') {
          throw error; // Para middleware before, falha para a execução
        }
      }
    }
  }

  /**
   * Valida parâmetros do contrato
   * @param {string} contractName - Nome do contrato
   * @param {Object} params - Parâmetros a validar
   */
  validateParams(contractName, params) {
    const rules = this.validationRules.get(contractName);
    if (!rules) return;

    const errors = [];

    Object.entries(rules).forEach(([field, rule]) => {
      const value = params[field];

      if (rule.required && (value === undefined || value === null || value === '')) {
        errors.push(`Campo obrigatório: ${field}`);
        return;
      }

      if (value !== undefined && value !== null) {
        if (rule.type && typeof value !== rule.type) {
          errors.push(`Campo ${field} deve ser do tipo ${rule.type}`);
        }

        if (rule.minLength && value.length < rule.minLength) {
          errors.push(`Campo ${field} deve ter pelo menos ${rule.minLength} caracteres`);
        }

        if (rule.maxLength && value.length > rule.maxLength) {
          errors.push(`Campo ${field} deve ter no máximo ${rule.maxLength} caracteres`);
        }

        if (rule.pattern && !rule.pattern.test(value)) {
          errors.push(`Campo ${field} não atende ao padrão exigido`);
        }

        if (rule.validator && !rule.validator(value)) {
          errors.push(`Campo ${field} não passou na validação customizada`);
        }
      }
    });

    if (errors.length > 0) {
      throw new ValidationError(`Erro de validação: ${errors.join(', ')}`, errors);
    }
  }

  /**
   * Verifica rate limiting
   * @param {string} contractName - Nome do contrato
   * @param {Object} rateLimit - Configuração de rate limit
   */
  async checkRateLimit(contractName, rateLimit) {
    const { maxCalls, windowMs } = rateLimit;
    const now = Date.now();
    const windowStart = now - windowMs;

    // Filtra execuções recentes
    const recentExecutions = this.executionHistory.filter(
      execution => execution.contract === contractName && 
                  new Date(execution.timestamp).getTime() > windowStart
    );

    if (recentExecutions.length >= maxCalls) {
      throw new RateLimitError(`Rate limit excedido para contrato ${contractName}: ${maxCalls} calls/${windowMs}ms`);
    }
  }

  /**
   * Adiciona execução ao histórico
   * @param {Object} execution - Dados da execução
   */
  addToHistory(execution) {
    this.executionHistory.push(execution);
    
    // Mantém tamanho do histórico
    if (this.executionHistory.length > this.maxHistorySize) {
      this.executionHistory = this.executionHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Sanitiza parâmetros para log (remove dados sensíveis)
   * @param {Object} params - Parâmetros originais
   * @returns {Object} Parâmetros sanitizados
   */
  sanitizeParams(params) {
    const sanitized = { ...params };
    const sensitiveFields = ['password', 'token', 'apiKey', 'secret', 'private'];
    
    Object.keys(sanitized).forEach(key => {
      if (sensitiveFields.some(field => key.toLowerCase().includes(field))) {
        sanitized[key] = '[REDACTED]';
      }
    });

    return sanitized;
  }

  /**
   * Sanitiza resultado para log
   * @param {*} result - Resultado original
   * @returns {*} Resultado sanitizado
   */
  sanitizeResult(result) {
    if (typeof result === 'object' && result !== null) {
      const sanitized = { ...result };
      delete sanitized.password;
      delete sanitized.token;
      delete sanitized.apiKey;
      return sanitized;
    }
    return result;
  }

  /**
   * Registra contratos padrão do sistema
   */
  registerDefaultContracts() {
    // Contrato de envio de mensagem
    this.register('sendMessage', async (params, context) => {
      const sessionId = stateManager.getState('session.id');
      const messageContent = params.message || stateManager.getState('chat.messageInput');
      
      if (!messageContent?.trim()) {
        throw new ValidationError('Mensagem não pode estar vazia');
      }

      // Limpa input
      stateManager.setState('chat.messageInput', '');

      // Adiciona mensagem do usuário
      const userMessage = {
        id: `user_${Date.now()}`,
        type: 'message',
        sender: 'user',
        content: messageContent.trim(),
        timestamp: new Date().toISOString()
      };
      
      stateManager.appendState('chat.history', userMessage);

      // Indica que bot está digitando
      stateManager.setState('chat.isTyping', true);

      try {
        // Chama LLM via WASM
        let llmResponse = '';
        if (typeof window.wasm_process_prompt !== 'undefined') {
          llmResponse = await window.wasm_process_prompt(sessionId, messageContent);
        } else {
          llmResponse = `Resposta simulada para: "${messageContent}"`;
        }

        // Simula delay de processamento
        await new Promise(resolve => setTimeout(resolve, 1000));

        // Para digitação e adiciona resposta
        stateManager.setState('chat.isTyping', false);
        
        const botMessage = {
          id: `bot_${Date.now()}`,
          type: 'message',
          sender: 'bot',
          content: llmResponse,
          timestamp: new Date().toISOString()
        };
        
        stateManager.appendState('chat.history', botMessage);

        // Persiste histórico
        const fullHistory = stateManager.getState('chat.history');
        try {
          await indexedDBBridge.saveChatHistory(sessionId, fullHistory);
        } catch (error) {
          console.warn('[Contracts] Falha ao persistir chat:', error);
        }

        return { userMessage, botMessage };

      } catch (error) {
        stateManager.setState('chat.isTyping', false);
        throw error;
      }
    }, {
      async: true,
      validation: {
        message: { type: 'string', maxLength: 1000 }
      },
      rateLimit: { maxCalls: 10, windowMs: 60000 } // 10 mensagens por minuto
    });

    // Contrato de mudança de aba
    this.register('switchTab', (params) => {
      const { tabId } = params;
      if (!tabId) {
        throw new ValidationError('tabId é obrigatório');
      }

      stateManager.setState('activeTab', tabId);
      
      return { previousTab: stateManager.getState('activeTab'), newTab: tabId };
    }, {
      validation: {
        tabId: { type: 'string', required: true }
      }
    });

    // Contrato de commit de pagamento
    this.register('commitPaymentContract', async (params) => {
      const contractData = {
        amount: params.amount,
        recipient: params.recipient,
        currency: params.currency || 'BRL',
        description: params.description || '',
        timestamp: new Date().toISOString()
      };

      // Serializa para WASM
      const contractYaml = `
type: payment_request
amount: ${contractData.amount}
recipient: ${contractData.recipient}
currency: ${contractData.currency}
description: "${contractData.description}"
timestamp: ${contractData.timestamp}
      `.trim();

      let commitResult;
      try {
        if (typeof window.wasm_commit_contract !== 'undefined') {
          commitResult = await window.wasm_commit_contract(contractYaml);
        } else {
          commitResult = JSON.stringify({ 
            status: "simulated_ok", 
            span_id: `sim-${Date.now()}`,
            message: "Contrato simulado processado"
          });
        }

        const result = JSON.parse(commitResult);
        stateManager.setState('payment.lastStatus', result.status);

        // Persiste contrato
        try {
          await indexedDBBridge.saveContract({
            id: result.span_id,
            session_id: stateManager.getState('session.id'),
            type: 'payment_request',
            data: contractData,
            status: result.status,
            created_at: new Date().toISOString()
          });
        } catch (error) {
          console.warn('[Contracts] Falha ao persistir contrato:', error);
        }

        return result;

      } catch (error) {
        stateManager.setState('payment.lastStatus', 'error');
        throw new ContractError(`Falha ao processar contrato: ${error.message}`);
      }
    }, {
      async: true,
      validation: {
        amount: { type: 'number', required: true, validator: (v) => v > 0 },
        recipient: { type: 'string', required: true, minLength: 3 },
        currency: { type: 'string', pattern: /^[A-Z]{3}$/ }
      }
    });

    // Contrato de debounce para digitação
    this.register('userTypingDebounce', (() => {
      let timeoutId = null;
      
      return () => {
        // Cancela timeout anterior
        if (timeoutId) {
          clearTimeout(timeoutId);
        }

        stateManager.setState('chat.isTyping', true);

        // Define novo timeout
        timeoutId = setTimeout(() => {
          stateManager.setState('chat.isTyping', false);
          timeoutId = null;
        }, 3000);
      };
    })(), {
      rateLimit: { maxCalls: 20, windowMs: 10000 } // 20 calls por 10 segundos
    });

    // Contrato de debug de estado
    this.register('logState', (params) => {
      const path = params.path || '*';
      const state = stateManager.getState(path);
      console.log(`[Debug] Estado em '${path}':`, state);
      return state;
    });

    // Contrato de limpeza de cache
    this.register('clearCache', async () => {
      try {
        // Limpa localStorage
        localStorage.clear();
        
        // Limpa IndexedDB
        await indexedDBBridge.cleanup(0); // Remove tudo
        
        // Reseta estado
        stateManager.resetState();
        
        console.log('[Contracts] Cache limpo com sucesso');
        return { success: true, message: 'Cache limpo' };
      } catch (error) {
        throw new ContractError(`Falha ao limpar cache: ${error.message}`);
      }
    }, { async: true });
  }

  /**
   * Lista contratos registrados
   * @returns {Array} Lista de nomes de contratos
   */
  listContracts() {
    return Array.from(this.contracts.keys());
  }

  /**
   * Obtém informações de um contrato
   * @param {string} name - Nome do contrato
   * @returns {Object|null} Informações do contrato
   */
  getContractInfo(name) {
    const contract = this.contracts.get(name);
    if (!contract) return null;

    return {
      name,
      options: contract.options,
      validation: this.validationRules.get(name) || null
    };
  }

  /**
   * Obtém estatísticas de execução
   * @param {string} contractName - Nome do contrato (opcional)
   * @returns {Object} Estatísticas
   */
  getExecutionStats(contractName = null) {
    let executions = this.executionHistory;
    
    if (contractName) {
      executions = executions.filter(e => e.contract === contractName);
    }

    const successful = executions.filter(e => e.success);
    const failed = executions.filter(e => !e.success);
    const avgExecutionTime = executions.reduce((sum, e) => sum + e.execution_time_ms, 0) / executions.length || 0;

    return {
      total: executions.length,
      successful: successful.length,
      failed: failed.length,
      successRate: executions.length > 0 ? (successful.length / executions.length) * 100 : 0,
      avgExecutionTime: Math.round(avgExecutionTime * 100) / 100,
      contracts: contractName ? [contractName] : [...new Set(executions.map(e => e.contract))]
    };
  }
}

// Classes de erro customizadas
export class ContractError extends Error {
  constructor(message, code = 'CONTRACT_ERROR') {
    super(message);
    this.name = 'ContractError';
    this.code = code;
  }
}

export class ValidationError extends Error {
  constructor(message, fields = []) {
    super(message);
    this.name = 'ValidationError';
    this.fields = fields;
  }
}

export class RateLimitError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RateLimitError';
  }
}

// Singleton global
export const contractSystem = new ContractSystem();

// Middleware de desenvolvimento
if (process.env.NODE_ENV === 'development') {
  contractSystem.addMiddleware('before', (context) => {
    console.debug(`[Contracts] Executando: ${context.name}`, context.params);
  });

  contractSystem.addMiddleware('after', (context) => {
    console.debug(`[Contracts] Concluído: ${context.name} (${context.executionTime.toFixed(2)}ms)`);
  });
}