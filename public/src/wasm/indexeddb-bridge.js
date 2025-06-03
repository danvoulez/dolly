// public/src/wasm/indexeddb-bridge.js
/**
 * Bridge entre Rust/WASM e IndexedDB para persistência
 */
export class IndexedDBBridge {
  constructor(dbName = 'FlipAppDB', version = 1) {
    this.dbName = dbName;
    this.version = version;
    this.db = null;
    this.isReady = false;
    this.initPromise = null;
  }

  /**
   * Inicializa conexão com IndexedDB
   * @returns {Promise<IDBDatabase>} Database instance
   */
  async init() {
    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => {
        console.error('[IndexedDB] Erro ao abrir database:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        this.isReady = true;
        console.log(`[IndexedDB] Database ${this.dbName} aberta com sucesso`);
        resolve(this.db);
      };

      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        this.createStores(db, event.oldVersion);
      };
    });

    return this.initPromise;
  }

  /**
   * Cria object stores necessárias
   * @param {IDBDatabase} db - Database instance
   * @param {number} oldVersion - Versão anterior
   */
  createStores(db, oldVersion) {
    console.log(`[IndexedDB] Upgrade de ${oldVersion} para ${this.version}`);

    // Store para spans/eventos
    if (!db.objectStoreNames.contains('spans')) {
      const spanStore = db.createObjectStore('spans', { keyPath: 'id' });
      spanStore.createIndex('session_id', 'session_id', { unique: false });
      spanStore.createIndex('timestamp', 'timestamp', { unique: false });
      spanStore.createIndex('type', 'type', { unique: false });
    }

    // Store para sessões
    if (!db.objectStoreNames.contains('sessions')) {
      const sessionStore = db.createObjectStore('sessions', { keyPath: 'id' });
      sessionStore.createIndex('created_at', 'created_at', { unique: false });
    }

    // Store para contratos
    if (!db.objectStoreNames.contains('contracts')) {
      const contractStore = db.createObjectStore('contracts', { keyPath: 'id' });
      contractStore.createIndex('session_id', 'session_id', { unique: false });
      contractStore.createIndex('status', 'status', { unique: false });
    }

    // Store para cache de chat
    if (!db.objectStoreNames.contains('chat_history')) {
      const chatStore = db.createObjectStore('chat_history', { keyPath: 'id' });
      chatStore.createIndex('session_id', 'session_id', { unique: false });
      chatStore.createIndex('timestamp', 'timestamp', { unique: false });
    }
  }

  /**
   * Adiciona span ao IndexedDB
   * @param {Object} span - Objeto span
   * @returns {Promise<string>} ID do span adicionado
   */
  async addSpan(span) {
    await this.ensureReady();
    
    const transaction = this.db.transaction(['spans'], 'readwrite');
    const store = transaction.objectStore('spans');
    
    // Adiciona timestamp se não existir
    if (!span.timestamp) {
      span.timestamp = new Date().toISOString();
    }

    return new Promise((resolve, reject) => {
      const request = store.add(span);
      
      request.onsuccess = () => {
        console.debug(`[IndexedDB] Span adicionado: ${span.id}`);
        resolve(span.id);
      };
      
      request.onerror = () => {
        console.error('[IndexedDB] Erro ao adicionar span:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Recupera spans por sessão
   * @param {string} sessionId - ID da sessão
   * @param {Object} options - Opções de filtro
   * @returns {Promise<Array>} Array de spans
   */
  async getSpans(sessionId, options = {}) {
    await this.ensureReady();
    
    const transaction = this.db.transaction(['spans'], 'readonly');
    const store = transaction.objectStore('spans');
    const index = store.index('session_id');
    
    return new Promise((resolve, reject) => {
      const request = index.getAll(sessionId);
      
      request.onsuccess = () => {
        let spans = request.result;
        
        // Aplica filtros
        if (options.type) {
          spans = spans.filter(span => span.type === options.type);
        }
        
        if (options.since) {
          const sinceDate = new Date(options.since);
          spans = spans.filter(span => new Date(span.timestamp) >= sinceDate);
        }
        
        if (options.limit) {
          spans = spans.slice(-options.limit); // Últimos N spans
        }
        
        // Ordena por timestamp
        spans.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        
        resolve(spans);
      };
      
      request.onerror = () => {
        console.error('[IndexedDB] Erro ao recuperar spans:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Salva sessão
   * @param {Object} session - Dados da sessão
   * @returns {Promise<string>} ID da sessão
   */
  async saveSession(session) {
    await this.ensureReady();
    
    const transaction = this.db.transaction(['sessions'], 'readwrite');
    const store = transaction.objectStore('sessions');
    
    if (!session.created_at) {
      session.created_at = new Date().toISOString();
    }
    session.updated_at = new Date().toISOString();

    return new Promise((resolve, reject) => {
      const request = store.put(session);
      
      request.onsuccess = () => {
        console.debug(`[IndexedDB] Sessão salva: ${session.id}`);
        resolve(session.id);
      };
      
      request.onerror = () => {
        console.error('[IndexedDB] Erro ao salvar sessão:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Recupera sessão por ID
   * @param {string} sessionId - ID da sessão
   * @returns {Promise<Object|null>} Dados da sessão
   */
  async getSession(sessionId) {
    await this.ensureReady();
    
    const transaction = this.db.transaction(['sessions'], 'readonly');
    const store = transaction.objectStore('sessions');
    
    return new Promise((resolve, reject) => {
      const request = store.get(sessionId);
      
      request.onsuccess = () => {
        resolve(request.result || null);
      };
      
      request.onerror = () => {
        console.error('[IndexedDB] Erro ao recuperar sessão:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Salva contrato
   * @param {Object} contract - Dados do contrato
   * @returns {Promise<string>} ID do contrato
   */
  async saveContract(contract) {
    await this.ensureReady();
    
    const transaction = this.db.transaction(['contracts'], 'readwrite');
    const store = transaction.objectStore('contracts');
    
    if (!contract.created_at) {
      contract.created_at = new Date().toISOString();
    }

    return new Promise((resolve, reject) => {
      const request = store.add(contract);
      
      request.onsuccess = () => {
        console.debug(`[IndexedDB] Contrato salvo: ${contract.id}`);
        resolve(contract.id);
      };
      
      request.onerror = () => {
        console.error('[IndexedDB] Erro ao salvar contrato:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Salva histórico de chat
   * @param {string} sessionId - ID da sessão
   * @param {Array} messages - Array de mensagens
   * @returns {Promise<void>}
   */
  async saveChatHistory(sessionId, messages) {
    await this.ensureReady();
    
    const transaction = this.db.transaction(['chat_history'], 'readwrite');
    const store = transaction.objectStore('chat_history');
    
    // Remove histórico anterior desta sessão
    const index = store.index('session_id');
    const deleteRequest = index.openCursor(sessionId);
    
    return new Promise((resolve, reject) => {
      deleteRequest.onsuccess = (event) => {
        const cursor = event.target.result;
        if (cursor) {
          cursor.delete();
          cursor.continue();
        } else {
          // Adiciona novo histórico
          messages.forEach((message, index) => {
            store.add({
              id: `${sessionId}_${message.id || index}`,
              session_id: sessionId,
              ...message,
              timestamp: message.timestamp || new Date().toISOString()
            });
          });
          
          resolve();
        }
      };
      
      deleteRequest.onerror = () => {
        console.error('[IndexedDB] Erro ao salvar chat:', deleteRequest.error);
        reject(deleteRequest.error);
      };
    });
  }

  /**
   * Recupera histórico de chat
   * @param {string} sessionId - ID da sessão
   * @returns {Promise<Array>} Array de mensagens
   */
  async getChatHistory(sessionId) {
    await this.ensureReady();
    
    const transaction = this.db.transaction(['chat_history'], 'readonly');
    const store = transaction.objectStore('chat_history');
    const index = store.index('session_id');
    
    return new Promise((resolve, reject) => {
      const request = index.getAll(sessionId);
      
      request.onsuccess = () => {
        const messages = request.result;
        messages.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
        resolve(messages);
      };
      
      request.onerror = () => {
        console.error('[IndexedDB] Erro ao recuperar chat:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Limpa dados antigos (manutenção)
   * @param {number} daysOld - Dias de idade para limpeza
   * @returns {Promise<number>} Número de registros removidos
   */
  async cleanup(daysOld = 30) {
    await this.ensureReady();
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);
    const cutoffISO = cutoffDate.toISOString();
    
    let totalDeleted = 0;
    const stores = ['spans', 'sessions', 'contracts', 'chat_history'];
    
    for (const storeName of stores) {
      const transaction = this.db.transaction([storeName], 'readwrite');
      const store = transaction.objectStore('stores');
      const index = store.index('timestamp') || store.index('created_at');
      
      if (index) {
        const range = IDBKeyRange.upperBound(cutoffISO);
        const request = index.openCursor(range);
        
        await new Promise((resolve) => {
          request.onsuccess = (event) => {
            const cursor = event.target.result;
            if (cursor) {
              cursor.delete();
              totalDeleted++;
              cursor.continue();
            } else {
              resolve();
            }
          };
        });
      }
    }
    
    console.log(`[IndexedDB] Limpeza concluída: ${totalDeleted} registros removidos`);
    return totalDeleted;
  }

  /**
   * Garante que o DB está pronto
   * @returns {Promise<void>}
   */
  async ensureReady() {
    if (!this.isReady) {
      await this.init();
    }
  }

  /**
   * Fecha conexão com o banco
   */
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
      this.isReady = false;
      this.initPromise = null;
    }
  }

  /**
   * Remove database completamente
   * @returns {Promise<void>}
   */
  async deleteDatabase() {
    this.close();
    
    return new Promise((resolve, reject) => {
      const deleteRequest = indexedDB.deleteDatabase(this.dbName);
      
      deleteRequest.onsuccess = () => {
        console.log(`[IndexedDB] Database ${this.dbName} removida`);
        resolve();
      };
      
      deleteRequest.onerror = () => {
        console.error('[IndexedDB] Erro ao remover database:', deleteRequest.error);
        reject(deleteRequest.error);
      };
    });
  }
}

// Singleton global
export const indexedDBBridge = new IndexedDBBridge();

// Funções utilitárias para usar no WASM
window.idb_add_span = async (spanJson) => {
  try {
    const span = JSON.parse(spanJson);
    return await indexedDBBridge.addSpan(span);
  } catch (error) {
    console.error('[IndexedDB Bridge] Erro em idb_add_span:', error);
    throw error;
  }
};

window.idb_get_spans = async (sessionId, optionsJson = '{}') => {
  try {
    const options = JSON.parse(optionsJson);
    const spans = await indexedDBBridge.getSpans(sessionId, options);
    return JSON.stringify(spans);
  } catch (error) {
    console.error('[IndexedDB Bridge] Erro em idb_get_spans:', error);
    throw error;
  }
};

window.idb_save_session = async (sessionJson) => {
  try {
    const session = JSON.parse(sessionJson);
    return await indexedDBBridge.saveSession(session);
  } catch (error) {
    console.error('[IndexedDB Bridge] Erro em idb_save_session:', error);
    throw error;
  }
};

window.idb_save_contract = async (contractJson) => {
  try {
    const contract = JSON.parse(contractJson);
    return await indexedDBBridge.saveContract(contract);
  } catch (error) {
    console.error('[IndexedDB Bridge] Erro em idb_save_contract:', error);
    throw error;
  }
};