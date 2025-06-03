// public/src/main.js
// Ponto de entrada principal da aplicação FlipApp
import { appConfig } from './core/config.js';
import { stateManager } from './core/state.js';
import { renderer } from './core/renderer.js';
import { parser } from './core/parser.js';
import { contractSystem } from './core/contracts.js';
import { WebSocketManager } from './core/websocket-manager.js';
import { setupComponents } from './ui/components/index.js';
import { expressionEngine } from './core/expression-engine.js';
import { indexedDBBridge } from './wasm/indexeddb-bridge.js';
import { logger } from './utils/logger.js';

/**
 * Classe principal que inicializa e orquestra o FlipApp
 */
class FlipApp {
  constructor() {
    this.initialized = false;
    this.version = appConfig.version;
    this.environment = appConfig.environment;
    this.websockets = new Map();

    logger.info(`FlipApp ${this.version} iniciando (${this.environment})...`);
  }

  /**
   * Inicializa a aplicação
   */
  async init() {
    if (this.initialized) return;
    
    try {
      // Inicializa IndexedDB
      await indexedDBBridge.init();
      logger.info('IndexedDB inicializado');

      // Registra Service Worker para PWA/offline
      await this.registerServiceWorker();

      // Inicializa componentes de UI LogLine reutilizáveis
      setupComponents(parser, renderer);
      
      // Inicializa sessão WASM
      await this.initWasmSession();
      
      // Carrega estado persistente
      stateManager.loadPersistedState();
      
      // Configura WebSockets
      this.setupWebSockets();

      // Configura handlers de contrato
      this.setupContractHandlers();

      // Carrega e renderiza UI LogLine
      await this.loadAndRenderUI();

      this.initialized = true;
      logger.info('FlipApp inicializado com sucesso');
      
      // Dispara evento de inicialização
      window.dispatchEvent(new CustomEvent('flipapp:ready'));
    } catch (error) {
      logger.error('Erro ao inicializar FlipApp:', error);
      this.showErrorScreen(error);
    }
  }

  /**
   * Registra Service Worker
   */
  async registerServiceWorker() {
    if ('serviceWorker' in navigator) {
      try {
        const registration = await navigator.serviceWorker.register('/service-worker.js');
        logger.info('Service Worker registrado:', registration);
        
        // Escuta por atualizações
        registration.addEventListener('updatefound', () => {
          const newWorker = registration.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              logger.info('Nova versão disponível!');
              this.notifyAppUpdate();
            }
          });
        });
      } catch (error) {
        logger.error('Erro ao registrar Service Worker:', error);
      }
    }
  }

  /**
   * Configura conexões WebSocket
   */
  setupWebSockets() {
    try {
      // Espelho WebSocket
      const espelhoWs = new WebSocketManager(appConfig.espelhoWsUrl, { 
        label: 'espelho',
        reconnectBaseDelay: 2000,
      });
      
      espelhoWs.on('message', message => {
        if (message && typeof message === 'object') {
          stateManager.appendState('espelho.spans', message);
        }
      });
      
      espelhoWs.on('open', () => {
        logger.info('WebSocket Espelho conectado');
        stateManager.setState('espelho.status', 'online');
      });
      
      espelhoWs.on('close', () => {
        stateManager.setState('espelho.status', 'offline');
      });
      
      this.websockets.set('espelho', espelhoWs);
      
      // WhatsApp WebSocket
      const whatsappWs = new WebSocketManager(appConfig.whatsappWsUrl, {
        label: 'whatsapp',
        reconnectBaseDelay: 3000,
      });
      
      whatsappWs.on('message', message => {
        if (message && typeof message === 'object') {
          stateManager.appendState('whatsapp.messages', message);
          
          // Reproduz som se estiver em outra aba
          if (stateManager.getState('activeTab') !== 'whatsapp') {
            try {
              new Audio('/sounds/notification.mp3').play();
            } catch (e) {
              // Alguns navegadores bloqueiam áudio sem interação do usuário
            }
          }
        }
      });
      
      whatsappWs.on('open', () => {
        logger.info('WebSocket WhatsApp conectado');
        stateManager.setState('whatsapp.status', 'online');
      });
      
      whatsappWs.on('close', () => {
        stateManager.setState('whatsapp.status', 'offline');
      });
      
      this.websockets.set('whatsapp', whatsappWs);
      
    } catch (error) {
      logger.error('Erro ao configurar WebSockets:', error);
    }
  }

  /**
   * Inicializa sessão WASM
   */
  async initWasmSession() {
    try {
      // Obtém ID de sessão existente ou cria um novo
      let sessionId = localStorage.getItem('flipapp_session_id');
      
      if (!sessionId) {
        sessionId = await window.wasm_init_session();
        localStorage.setItem('flipapp_session_id', sessionId);
        logger.info('Nova sessão WASM criada:', sessionId);
      } else {
        // Verifica se sessão ainda existe
        try {
          const healthCheck = await window.wasm_health_check();
          const health = JSON.parse(healthCheck);
          
          if (health.status !== 'healthy') {
            // Recria sessão se não estiver saudável
            sessionId = await window.wasm_init_session();
            localStorage.setItem('flipapp_session_id', sessionId);
            logger.info('Sessão WASM recriada:', sessionId);
          }
        } catch (e) {
          // Recria sessão em caso de erro
          sessionId = await window.wasm_init_session();
          localStorage.setItem('flipapp_session_id', sessionId);
          logger.info('Sessão WASM recriada após erro:', sessionId);
        }
      }
      
      // Salva ID no estado
      stateManager.setState('session.id', sessionId);
      
      // Carrega spans da sessão
      const spansJson = await window.wasm_get_spans(sessionId);
      const spans = JSON.parse(spansJson);
      stateManager.setState('audit.spans', spans);
      
      logger.info('Sessão WASM inicializada:', sessionId);
    } catch (error) {
      logger.error('Erro ao inicializar sessão WASM:', error);
      throw new Error('Falha ao inicializar módulo WASM. Verifique se o arquivo .wasm está disponível.');
    }
  }

  /**
   * Configura handlers para contratos
   */
  setupContractHandlers() {
    stateManager.setState('contract.handlers', {
      onContractCall: (name, params) => {
        logger.debug(`Contrato chamado: ${name}`, params);
        
        contractSystem.execute(name, params)
          .then(result => {
            logger.debug(`Contrato executado: ${name}`, result);
          })
          .catch(error => {
            logger.error(`Erro no contrato ${name}:`, error);
            // Mostra notificação de erro se apropriado
            if (error.name !== 'ValidationError' && error.name !== 'RateLimitError') {
              this.showErrorNotification(error.message);
            }
          });
      }
    });
  }

  /**
   * Carrega e renderiza a UI LogLine
   */
  async loadAndRenderUI() {
    try {
      // Define estado inicial da UI
      stateManager.setState('activeTab', 'chat');
      stateManager.setState('ui.loading', true);
      stateManager.setState('chat.isTyping', false);
      stateManager.setState('chat.history', []);
      stateManager.setState('chat.messageInput', '');
      
      // Carrega arquivo LogLine principal
      const response = await fetch('/ui/flipapp_ui.logline');
      
      if (!response.ok) {
        throw new Error(`Falha ao carregar UI: ${response.status} ${response.statusText}`);
      }
      
      const logLineSource = await response.text();
      
      // Parse da DSL LogLine
      const ast = parser.parse(logLineSource, 'flipapp_ui.logline');
      
      if (ast.errors && ast.errors.length > 0) {
        logger.error('Erros no parse da LogLine UI:', ast.errors);
        throw new Error(`Erro de sintaxe na UI LogLine: ${ast.errors[0].message}`);
      }
      
      // Renderiza árvore Virtual DOM
      const vnode = renderer.render(ast, stateManager.getState('contract.handlers'), stateManager.getState('*'));
      
      // Monta no DOM
      const rootElement = document.getElementById('root');
      renderer.mount(vnode, rootElement, stateManager.getState('contract.handlers'));
      
      // Estado inicial
      stateManager.setState('ui.loading', false);
      stateManager.setState('ui.rendered', true);
      
      logger.info('UI LogLine renderizada com sucesso');
    } catch (error) {
      logger.error('Erro ao renderizar UI:', error);
      throw error;
    }
  }
  
  /**
   * Mostra tela de erro fatal
   */
  showErrorScreen(error) {
    const rootElement = document.getElementById('root');
    
    if (!rootElement) return;
    
    rootElement.innerHTML = `
      <div style="text-align:center; padding:2rem; font-family:system-ui,sans-serif;">
        <h1 style="color:#d32f2f;">Erro ao inicializar FlipApp</h1>
        <p style="margin:1rem 0;">${error.message || 'Ocorreu um erro inesperado.'}</p>
        <button onclick="location.reload()" style="padding:0.5rem 1rem; background:#2196f3; color:white; border:none; border-radius:4px; cursor:pointer;">
          Recarregar aplicação
        </button>
        <p style="margin-top:2rem; font-size:0.8rem; color:#666;">
          Versão ${this.version} | ${this.environment}
        </p>
      </div>
    `;
  }
  
  /**
   * Mostra notificação de atualização disponível
   */
  notifyAppUpdate() {
    const notification = document.createElement('div');
    notification.className = 'app-update-notification';
    notification.innerHTML = `
      <p>Nova versão disponível!</p>
      <button id="update-button">Atualizar agora</button>
    `;
    
    document.body.appendChild(notification);
    
    document.getElementById('update-button').addEventListener('click', () => {
      window.location.reload();
    });
  }
  
  /**
   * Mostra notificação de erro
   */
  showErrorNotification(message) {
    const notification = document.createElement('div');
    notification.className = 'error-notification';
    notification.textContent = message;
    
    document.body.appendChild(notification);
    
    // Remove após 5 segundos
    setTimeout(() => {
      notification.classList.add('hide');
      setTimeout(() => {
        notification.remove();
      }, 300);
    }, 5000);
  }
  
  /**
   * Finaliza a aplicação
   */
  cleanup() {
    // Fecha WebSockets
    this.websockets.forEach((ws) => {
      ws.close();
    });
    
    // Fecha IndexedDB
    indexedDBBridge.close();
    
    logger.info('FlipApp finalizado');
  }
}

// Inicializa app
window.addEventListener('DOMContentLoaded', () => {
  window.app = new FlipApp();
  window.app.init().catch(error => {
    console.error('Erro fatal:', error);
  });
});

// Cleanup na saída
window.addEventListener('beforeunload', () => {
  if (window.app) {
    window.app.cleanup();
  }
});