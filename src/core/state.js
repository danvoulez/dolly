// src/core/state.js
/**
 * Sistema de gerenciamento de estado reativo centralizado
 * @module core/state
 */

/**
 * Gerenciador de estado com padrão Observer
 */
export class StateManager {
  constructor() {
    this.state = {};
    this.observers = new Map(); // path -> Set<callback>
    this.middlewares = [];
    this.localStorage = typeof window !== 'undefined' ? window.localStorage : null;
    this.sessionId = null;
  }

  /**
   * Define um valor no estado com notificação reativa
   * @param {string} path - Caminho dot-notation (ex: 'user.profile.name')
   * @param {*} value - Valor a ser definido
   */
  setState(path, value) {
    const oldValue = this.getState(path);
    if (JSON.stringify(oldValue) === JSON.stringify(value)) return; // Evita re-renders desnecessários

    this._setNestedValue(path, value);
    
    // Executa middlewares
    this.middlewares.forEach(middleware => {
      try {
        middleware({ type: 'SET_STATE', path, value, oldValue });
      } catch (e) {
        console.error('Middleware error:', e);
      }
    });

    this.notifyObservers(path, value);
    this._persistCriticalState(path, value);
  }

  /**
   * Obtém valor do estado
   * @param {string} path - Caminho para a propriedade
   * @returns {*} Valor ou undefined
   */
  getState(path) {
    if (!path || path === '*') return this.state;
    return this._getNestedValue(path);
  }

  /**
   * Adiciona item a um array no estado
   * @param {string} path - Caminho para o array
   * @param {*} value - Item a ser adicionado
   */
  appendState(path, value) {
    const currentArray = this.getState(path);
    if (Array.isArray(currentArray)) {
      this.setState(path, [...currentArray, value]);
    } else {
      console.warn(`[StateManager] Tentativa de append em não-array: ${path}`);
      this.setState(path, [value]);
    }
  }

  /**
   * Remove item de array por índice ou condição
   * @param {string} path - Caminho para o array
   * @param {number|function} condition - Índice ou função de filtro
   */
  removeFromState(path, condition) {
    const currentArray = this.getState(path);
    if (!Array.isArray(currentArray)) return;

    let newArray;
    if (typeof condition === 'number') {
      newArray = currentArray.filter((_, index) => index !== condition);
    } else if (typeof condition === 'function') {
      newArray = currentArray.filter(item => !condition(item));
    }
    
    if (newArray) {
      this.setState(path, newArray);
    }
  }

  /**
   * Subscreve a mudanças de estado
   * @param {string} path - Caminho a observar
   * @param {function} callback - Função chamada na mudança
   * @returns {function} Função de cleanup para remover observador
   */
  subscribe(path, callback) {
    if (!this.observers.has(path)) {
      this.observers.set(path, new Set());
    }
    this.observers.get(path).add(callback);

    // Chama callback imediatamente com valor atual
    callback(this.getState(path), path);

    // Retorna função de cleanup
    return () => this.unsubscribe(path, callback);
  }

  /**
   * Remove subscrição
   * @param {string} path - Caminho observado
   * @param {function} callback - Callback a ser removido
   */
  unsubscribe(path, callback) {
    const observers = this.observers.get(path);
    if (observers) {
      observers.delete(callback);
      if (observers.size === 0) {
        this.observers.delete(path);
      }
    }
  }

  /**
   * Notifica observadores de mudanças
   * @param {string} changedPath - Caminho que mudou
   * @param {*} newValue - Novo valor
   */
  notifyObservers(changedPath, newValue) {
    // Notifica observadores do caminho exato
    this._notifyPathObservers(changedPath, newValue);

    // Notifica observadores de caminhos ancestrais
    let currentPath = changedPath;
    while (currentPath.includes('.')) {
      currentPath = currentPath.substring(0, currentPath.lastIndexOf('.'));
      this._notifyPathObservers(currentPath, this.getState(currentPath));
    }

    // Notifica observador global
    this._notifyPathObservers('*', this.state);
  }

  /**
   * Adiciona middleware para interceptar mudanças de estado
   * @param {function} middleware - Função middleware(event)
   */
  addMiddleware(middleware) {
    if (typeof middleware !== 'function') {
      throw new Error('Middleware deve ser uma função');
    }
    this.middlewares.push(middleware);
    return () => {
      this.middlewares = this.middlewares.filter(m => m !== middleware);
    };
  }

  /**
   * Inicializa o estado com dados persistidos se disponíveis
   * @param {string} sessionId - ID da sessão
   */
  init(sessionId) {
    this.sessionId = sessionId;
    this.setState('session.id', sessionId);
    this._loadPersistedState();
  }

  /**
   * Limpa todo o estado
   */
  resetState() {
    this.state = {};
    this.observers.clear();
    if (this.localStorage) {
      // Limpa apenas as entradas do localStorage relacionadas à sessão atual
      if (this.sessionId) {
        Object.keys(this.localStorage).forEach(key => {
          if (key.includes(this.sessionId)) {
            this.localStorage.removeItem(key);
          }
        });
      }
    }
    console.warn('[StateManager] Estado resetado');
  }

  // Métodos internos
  _setNestedValue(path, value) {
    if (!path) return;
    
    const parts = path.split('.');
    let current = this.state;
    
    for (let i = 0; i < parts.length - 1; i++) {
      if (current[parts[i]] === undefined) {
        current[parts[i]] = {};
      } else if (typeof current[parts[i]] !== 'object' || current[parts[i]] === null) {
        // Converte valores não-objeto para objeto vazio
        current[parts[i]] = {};
      }
      current = current[parts[i]];
    }
    
    current[parts[parts.length - 1]] = value;
  }

  _getNestedValue(path) {
    if (!path) return undefined;
    
    const parts = path.split('.');
    let current = this.state;
    
    for (const part of parts) {
      if (current === null || typeof current !== 'object' || !(part in current)) {
        return undefined;
      }
      current = current[part];
    }
    
    return current;
  }

  _notifyPathObservers(path, value) {
    const observers = this.observers.get(path);
    if (observers) {
      observers.forEach(callback => {
        try {
          callback(value, path);
        } catch (error) {
          console.error(`[StateManager] Erro em observer para ${path}:`, error);
        }
      });
    }
  }

  /**
   * Persiste estados críticos no localStorage
   */
  _persistCriticalState(path, value) {
    if (!this.localStorage || !this.sessionId) return;

    // Lista de paths que devem ser persistidos
    const criticalPaths = [
      'chat.history', 
      'user.preferences',
      'espelho.spans',
      'activeTab'
    ];
    
    for (const criticalPath of criticalPaths) {
      if (path === criticalPath || path.startsWith(`${criticalPath}.`)) {
        const key = `flipapp_${criticalPath.replace(/\./g, '_')}_${this.sessionId}`;
        try {
          this.localStorage.setItem(key, JSON.stringify(this.getState(criticalPath)));
        } catch (error) {
          console.error(`[StateManager] Falha ao persistir ${criticalPath}:`, error);
        }
        break;
      }
    }
  }

  /**
   * Carrega estados persistidos
   */
  _loadPersistedState() {
    if (!this.localStorage || !this.sessionId) return;

    const criticalPaths = [
      'chat.history',
      'user.preferences',
      'espelho.spans',
      'activeTab'
    ];
    
    criticalPaths.forEach(path => {
      const key = `flipapp_${path.replace(/\./g, '_')}_${this.sessionId}`;
      const stored = this.localStorage.getItem(key);
      
      if (stored) {
        try {
          const parsedValue = JSON.parse(stored);
          this.setState(path, parsedValue);
          console.debug(`[StateManager] Estado "${path}" carregado de localStorage`);
        } catch (error) {
          console.error(`[StateManager] Falha ao carregar ${path}:`, error);
        }
      }
    });
  }
}

// Singleton global
export const stateManager = new StateManager();