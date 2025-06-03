// public/src/core/websocket-manager.js
/**
 * Gerenciamento robusto de WebSockets com reconexão exponencial, eventos e integração reativa
 */

import { stateManager } from './state.js';

export class WebSocketManager {
  constructor(url, options = {}) {
    this.url = url;
    this.protocols = options.protocols || [];
    this.label = options.label || 'ws';
    this.reconnectBaseDelay = options.reconnectBaseDelay || 1000; // ms
    this.reconnectMaxDelay = options.reconnectMaxDelay || 15000;
    this.reconnectAttempts = 0;
    this.handlers = new Map(); // type -> [handler]
    this.ws = null;
    this.connected = false;
    this.forcedClose = false;
    this.connectionStatePath = options.connectionStatePath || `connection.${this.label}`;
    this._setupState();
    this.connect();
  }

  _setupState() {
    stateManager.setState(this.connectionStatePath, {
      status: 'connecting',
      attempts: 0,
      lastError: null
    });
  }

  connect() {
    this.ws = new window.WebSocket(this.url, this.protocols);
    this.connected = false;
    this.forcedClose = false;

    this.ws.onopen = () => {
      this.connected = true;
      this.reconnectAttempts = 0;
      stateManager.setState(this.connectionStatePath, { status: 'connected', attempts: this.reconnectAttempts, lastError: null });
      this._emit('open');
    };

    this.ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch {
        data = event.data;
      }
      this._emit('message', data);
      if (data && data.type) {
        this._emit(data.type, data);
      }
    };

    this.ws.onerror = (event) => {
      stateManager.setState(this.connectionStatePath, { status: 'error', attempts: this.reconnectAttempts, lastError: event });
      this._emit('error', event);
    };

    this.ws.onclose = (event) => {
      this.connected = false;
      stateManager.setState(this.connectionStatePath, { status: 'disconnected', attempts: this.reconnectAttempts, lastError: event });
      this._emit('close', event);

      if (!this.forcedClose) {
        this._scheduleReconnect();
      }
    };
  }

  send(data) {
    if (this.connected && this.ws.readyState === window.WebSocket.OPEN) {
      this.ws.send(typeof data === 'string' ? data : JSON.stringify(data));
    } else {
      throw new Error(`[WebSocketManager] Não conectado`);
    }
  }

  close() {
    this.forcedClose = true;
    if (this.ws) this.ws.close();
  }

  _scheduleReconnect() {
    this.reconnectAttempts += 1;
    const delay = Math.min(this.reconnectBaseDelay * (2 ** this.reconnectAttempts), this.reconnectMaxDelay);
    stateManager.setState(this.connectionStatePath, { status: 'reconnecting', attempts: this.reconnectAttempts, lastError: null });
    setTimeout(() => {
      this.connect();
    }, delay);
  }

  on(type, handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(handler);
  }

  off(type, handler) {
    if (!this.handlers.has(type)) return;
    const arr = this.handlers.get(type);
    const idx = arr.indexOf(handler);
    if (idx >= 0) arr.splice(idx, 1);
  }

  _emit(type, ...args) {
    if (this.handlers.has(type)) {
      this.handlers.get(type).forEach(fn => {
        try { fn(...args); } catch (e) { console.error(`[WebSocketManager] Handler ${type} erro:`, e); }
      });
    }
  }
}

// Exemplo de uso (na inicialização do runtime):
// const wsEspelho = new WebSocketManager('ws://localhost:8080/ws/espelho', { label: 'espelho' });
// wsEspelho.on('message', msg => stateManager.appendState('espelho.spans', msg));
// wsEspelho.on('open', () => stateManager.setState('espelho.status', 'ok'));
// wsEspelho.on('close', () => stateManager.setState('espelho.status', 'down'));