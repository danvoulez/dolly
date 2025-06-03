// public/src/services/llm-client.js
/**
 * Cliente para API de LLM real (para substituir simulação WASM)
 */
import { logger } from '../utils/logger.js';
import { appConfig } from '../core/config.js';

export class LlmClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || appConfig.llmApiUrl || 'http://localhost:3000/api/llm';
    this.timeout = options.timeout || 30000; // 30 segundos
    this.retries = options.retries || 2;
    this.model = options.model || 'gpt-4-turbo';
    this.cache = new Map();
  }

  /**
   * Processa um prompt via API LLM
   * @param {string} prompt Texto do prompt
   * @param {Object} options Opções adicionais
   * @returns {Promise<string>} Resposta do LLM
   */
  async processPrompt(prompt, options = {}) {
    const sessionId = options.sessionId || 'default';
    const reqOptions = {
      model: options.model || this.model,
      max_tokens: options.maxTokens || 1024,
      temperature: options.temperature || 0.7
    };
    
    // Simulação de modo offline para dev
    if (options.offlineModeSimulation) {
      logger.info(`[LLM] Modo offline: simulando resposta para "${prompt.substring(0, 30)}..."`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      return `[OFFLINE MODE] Resposta simulada para: "${prompt.substring(0, 30)}..."`;
    }
    
    // Checa cache, se aplicável
    if (options.useCache !== false) {
      const cacheKey = `${prompt}|${JSON.stringify(reqOptions)}`;
      if (this.cache.has(cacheKey)) {
        logger.info(`[LLM] Resposta recuperada do cache para "${prompt.substring(0, 30)}..."`);
        return this.cache.get(cacheKey);
      }
    }

    // Prepara payload
    const payload = {
      prompt,
      options: reqOptions,
      session_id: sessionId,
      context: options.context || []
    };
    
    // Faz request
    let attempts = 0;
    let error;
    
    while (attempts <= this.retries) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        
        const response = await fetch(`${this.baseUrl}/process`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(options.apiKey ? { 'Authorization': `Bearer ${options.apiKey}` } : {})
          },
          body: JSON.stringify(payload),
          signal: controller.signal
        });
        
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          throw new Error(`HTTP error: ${response.status} ${response.statusText}`);
        }
        
        const data = await response.json();
        
        if (!data.content) {
          throw new Error('Resposta do LLM não contém conteúdo');
        }
        
        // Adiciona ao cache se aplicável
        if (options.useCache !== false) {
          const cacheKey = `${prompt}|${JSON.stringify(reqOptions)}`;
          this.cache.set(cacheKey, data.content);
          
          // Limita tamanho do cache
          if (this.cache.size > 100) {
            // Remove entrada mais antiga
            const firstKey = this.cache.keys().next().value;
            this.cache.delete(firstKey);
          }
        }
        
        // Rastreamento de uso/custos
        if (data.usage) {
          logger.debug('[LLM] Uso de tokens:', data.usage);
        }
        
        return data.content;
        
      } catch (e) {
        attempts++;
        error = e;
        
        if (e.name === 'AbortError') {
          logger.warn('[LLM] Timeout ao processar prompt');
        } else {
          logger.warn(`[LLM] Erro ao processar prompt (tentativa ${attempts}/${this.retries + 1}):`, e);
        }
        
        // Espera antes de retry com backoff exponencial
        if (attempts <= this.retries) {
          const delay = Math.min(1000 * (2 ** (attempts - 1)), 10000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // Se chegou aqui, todas as tentativas falharam
    throw error || new Error('Falha ao processar prompt');
  }
  
  /**
   * Cancela operações pendentes
   */
  cancelPending() {
    // Implementação depende do mecanismo usado para controle de requests
    logger.info('[LLM] Cancelando operações pendentes');
  }
}

// Singleton
export const llmClient = new LlmClient();