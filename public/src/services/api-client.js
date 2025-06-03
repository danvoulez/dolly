// public/src/services/api-client.js
/**
 * Cliente HTTP para APIs com cache, retry e validação
 */
import { logger } from '../utils/logger.js';
import { appConfig } from '../core/config.js';

export class ApiClient {
  constructor(options = {}) {
    this.baseUrl = options.baseUrl || appConfig.apiBaseUrl;
    this.defaultHeaders = options.headers || {};
    this.timeout = options.timeout || 20000;
    this.retries = options.retries || 1;
    
    this.cache = {
      data: new Map(),
      ttl: options.cacheTtl || 60000 // Default 1 min
    };
  }
  
  /**
   * Faz request GET
   * @param {string} endpoint Caminho da API
   * @param {Object} options Opções do request
   * @returns {Promise<Object>} Resposta da API
   */
  async get(endpoint, options = {}) {
    return this.request('GET', endpoint, null, options);
  }
  
  /**
   * Faz request POST
   * @param {string} endpoint Caminho da API
   * @param {Object} data Dados para enviar
   * @param {Object} options Opções do request
   * @returns {Promise<Object>} Resposta da API
   */
  async post(endpoint, data, options = {}) {
    return this.request('POST', endpoint, data, options);
  }
  
  /**
   * Faz request PUT
   * @param {string} endpoint Caminho da API
   * @param {Object} data Dados para enviar
   * @param {Object} options Opções do request
   * @returns {Promise<Object>} Resposta da API
   */
  async put(endpoint, data, options = {}) {
    return this.request('PUT', endpoint, data, options);
  }
  
  /**
   * Faz request DELETE
   * @param {string} endpoint Caminho da API
   * @param {Object} options Opções do request
   * @returns {Promise<Object>} Resposta da API
   */
  async delete(endpoint, options = {}) {
    return this.request('DELETE', endpoint, null, options);
  }
  
  /**
   * Método genérico para requests HTTP
   */
  async request(method, endpoint, data = null, options = {}) {
    const url = `${this.baseUrl}${endpoint}`;
    const cacheKey = `${method}:${url}:${JSON.stringify(data || {})}`;
    
    // Tenta do cache para GET
    if (method === 'GET' && options.useCache !== false) {
      const cached = this.getFromCache(cacheKey);
      if (cached) {
        return cached;
      }
    }
    
    const requestOptions = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...this.defaultHeaders,
        ...options.headers
      },
      credentials: options.credentials || 'same-origin'
    };
    
    // Adiciona corpo para métodos não GET
    if (data && method !== 'GET') {
      requestOptions.body = JSON.stringify(data);
    }
    
    // Retry logic
    let attempts = 0;
    let error;
    
    while (attempts <= this.retries) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.timeout);
        requestOptions.signal = controller.signal;
        
        const response = await fetch(url, requestOptions);
        clearTimeout(timeoutId);
        
        // Valida resposta HTTP
        if (!response.ok) {
          let errorData;
          try {
            errorData = await response.json();
          } catch (e) {
            errorData = { message: response.statusText };
          }
          
          throw new ApiError(
            errorData.message || `HTTP error ${response.status}`,
            response.status,
            errorData
          );
        }
        
        // Parse JSON response
        let responseData;
        const contentType = response.headers.get('content-type');
        
        if (contentType && contentType.includes('application/json')) {
          responseData = await response.json();
        } else {
          responseData = await response.text();
        }
        
        // Adiciona ao cache para GET
        if (method === 'GET' && options.useCache !== false) {
          this.addToCache(cacheKey, responseData);
        }
        
        return responseData;
        
      } catch (e) {
        attempts++;
        error = e;
        
        if (e.name === 'AbortError') {
          logger.warn(`[API] Timeout em request para ${endpoint}`);
        } else {
          logger.warn(`[API] Erro em request para ${endpoint} (tentativa ${attempts}/${this.retries + 1}):`, e);
        }
        
        // Não faz retry para certos casos
        if (e instanceof ApiError && [400, 401, 403, 404].includes(e.status)) {
          break;
        }
        
        // Espera antes de retry
        if (attempts <= this.retries) {
          const delay = Math.min(1000 * (2 ** (attempts - 1)), 10000);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    // Se chegou aqui, todas as tentativas falharam
    throw error || new Error(`Falha em request para ${endpoint}`);
  }
  
  /**
   * Recupera do cache
   */
  getFromCache(key) {
    const cacheItem = this.cache.data.get(key);
    if (!cacheItem) return null;
    
    const now = Date.now();
    if (now - cacheItem.timestamp < this.cache.ttl) {
      return cacheItem.data;
    }
    
    // Expirou
    this.cache.data.delete(key);
    return null;
  }
  
  /**
   * Adiciona ao cache
   */
  addToCache(key, data) {
    this.cache.data.set(key, {
      data,
      timestamp: Date.now()
    });
    
    // Limita tamanho do cache
    if (this.cache.data.size > 100) {
      const oldestKey = [...this.cache.data.entries()]
        .reduce((oldest, [key, item]) => {
          if (!oldest || item.timestamp < oldest.timestamp) {
            return { key, timestamp: item.timestamp };
          }
          return oldest;
        }, null).key;
      
      if (oldestKey) {
        this.cache.data.delete(oldestKey);
      }
    }
  }
  
  /**
   * Limpa cache
   */
  clearCache() {
    this.cache.data.clear();
  }
}

/**
 * Erro customizado para API
 */
export class ApiError extends Error {
  constructor(message, status, data = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

// Singleton
export const apiClient = new ApiClient();