// public/src/core/state.js
/**
 * Sistema de gerenciamento de estado reativo centralizado
 * Implementa padrão Observer para notificações automáticas de mudanças
 */
export class StateManager {
  constructor() {
    this.state = {};
    this.observers = new Map(); // path -> Set<callback>
    this.middlewares = []; // Para logging, debugging, etc.
  }

  /**
   * Define um valor no estado com notificação reativa
   * @param {string} path - Caminho dot-notation (ex: 'user.profile.name')
   * @param {*} value - Valor a ser definido
   */
  setState(path, value) {
    const oldValue = this.getState(path);
    if (oldValue === value) return; // Evita re-renders desnecessários

    this._setNestedValue(path, value);
    
    // Executa middlewares
    this.middlewares.forEach(middleware => {
      middleware({ type: 'SET_STATE', path, value, oldValue });
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
    if (path === '*') return this.state;
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
   * Atualiza múltiplos caminhos atomicamente
   * @param {Object} updates - Objeto com path: value
   */
  batchUpdate(updates) {
    const oldValues = {};
    
    // Aplica todas as mudanças sem notificar
    Object.entries(updates).forEach(([path, value]) => {
      oldValues[path] = this.getState(path);
      this._setNestedValue(path, value);
    });

    // Executa middlewares para cada mudança
    Object.entries(updates).forEach(([path, value]) => {
      this.middlewares.forEach(middleware => {
        middleware({ type: 'BATCH_UPDATE', path, value, oldValue: oldValues[path] });
      });
    });

    // Notifica observadores
    Object.entries(updates).forEach(([path, value]) => {
      this.notifyObservers(path, value);
      this._persistCriticalState(path, value);
    });
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
   * Adiciona middleware para interceptar mudanças de estado
   * @param {function} middleware - Função middleware
   */
  addMiddleware(middleware) {
    this.middlewares.push(middleware);
  }

  /**
   * Limpa todo o estado
   */
  resetState() {
    this.state = {};
    this.observers.clear();
    localStorage.clear();
    console.warn('[StateManager] Estado resetado completamente');
  }

  // Métodos internos
  _setNestedValue(path, value) {
    const parts = path.split('.');
    let current = this.state;
    
    for (let i = 0; i < parts.length - 1; i++) {
      if (!current[parts[i]] || typeof current[parts[i]] !== 'object') {
        current[parts[i]] = {};
      }
      current = current[parts[i]];
    }
    
    current[parts[parts.length - 1]] = value;
  }

  _getNestedValue(path) {
    const parts = path.split('.');
    let current = this.state;
    
    for (const part of parts) {
      if (current === null || typeof current !== 'object' || !current.hasOwnProperty(part)) {
        return undefined;
      }
      current = current[part];
    }
    
    return current;
  }

  /**
   * Persiste estados críticos no localStorage
   * @param {string} path - Caminho alterado
   * @param {*} value - Novo valor
   */
  _persistCriticalState(path, value) {
    const criticalPaths = ['chat.history', 'user.preferences', 'session.id'];
    
    for (const criticalPath of criticalPaths) {
      if (path.startsWith(criticalPath)) {
        const sessionId = this.getState('session.id');
        const key = `flipapp_${criticalPath.replace(/\./g, '_')}_${sessionId || 'default'}`;
        
        try {
          localStorage.setItem(key, JSON.stringify(this.getState(criticalPath)));
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
  loadPersistedState() {
    const sessionId = this.getState('session.id');
    const criticalPaths = ['chat.history', 'user.preferences'];
    
    criticalPaths.forEach(path => {
      const key = `flipapp_${path.replace(/\./g, '_')}_${sessionId || 'default'}`;
      const stored = localStorage.getItem(key);
      
      if (stored) {
        try {
          this.setState(path, JSON.parse(stored));
        } catch (error) {
          console.error(`[StateManager] Falha ao carregar ${path}:`, error);
        }
      }
    });
  }
}

// Singleton global
export const stateManager = new StateManager();

// Middleware de logging para desenvolvimento
if (process.env.NODE_ENV === 'development') {
  stateManager.addMiddleware(({ type, path, value, oldValue }) => {
    console.debug(`[State] ${type}: ${path}`, { oldValue, newValue: value });
  });
}