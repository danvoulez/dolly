// tests/setup.js - Setup de testes Jest
const { TextEncoder, TextDecoder } = require('util');

// Polyfills necessários para testes
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;

// Mock para WebSocket (não disponível no JSDOM)
global.WebSocket = class MockWebSocket {
  constructor(url) {
    this.url = url;
    this.readyState = 0; // CONNECTING
    this.CONNECTING = 0;
    this.OPEN = 1;
    this.CLOSING = 2;
    this.CLOSED = 3;
    
    // Simula conexão após timeout curto
    setTimeout(() => {
      this.readyState = 1; // OPEN
      if (this.onopen) this.onopen();
    }, 10);
  }
  
  send(data) {
    if (this.readyState !== 1) {
      throw new Error('WebSocket não está conectado');
    }
  }
  
  close() {
    this.readyState = 3; // CLOSED
    if (this.onclose) this.onclose();
  }
};

// Mock para localStorage
const localStorageMock = (() => {
  let store = {};
  
  return {
    getItem: key => store[key] || null,
    setItem: (key, value) => {
      store[key] = value.toString();
    },
    removeItem: key => {
      delete store[key];
    },
    clear: () => {
      store = {};
    }
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
});

// Mock para IndexedDB (simplificado)
const indexedDBMock = {
  open: () => {
    return {
      result: {
        transaction: () => ({
          objectStore: () => ({
            add: () => ({}),
            get: () => ({}),
            getAll: () => ({}),
            put: () => ({})
          })
        })
      },
      onupgradeneeded: null,
      onsuccess: null,
      onerror: null
    };
  }
};

Object.defineProperty(window, 'indexedDB', {
  value: indexedDBMock
});

// Mock para WASM
global.wasm_init_session = jest.fn().mockResolvedValue('test-session-id');
global.wasm_get_spans = jest.fn().mockResolvedValue('[]');
global.wasm_process_prompt = jest.fn().mockImplementation((sessionId, prompt) => {
  return Promise.resolve(`Resposta simulada para: "${prompt}"`);
});
global.wasm_commit_contract = jest.fn().mockResolvedValue(
  JSON.stringify({ status: "ok", span_id: "test-span-id" })
);
global.wasm_health_check = jest.fn().mockResolvedValue(
  JSON.stringify({ status: "healthy" })
);
global.wasm_get_version = jest.fn().mockReturnValue('1.0.0-test');

// Um pouco de console.log útil durante testes
console.debug = jest.fn();
console.info = jest.fn();