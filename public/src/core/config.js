// public/src/core/config.js
/**
 * Configuração global do FlipApp, injetada via window.APP_CONFIG ou .env
 */
const defaultConfig = {
  apiBaseUrl: 'http://localhost:8000/api',
  whatsappWsUrl: 'ws://localhost:3001/ws/messages',
  espelhoWsUrl: 'ws://localhost:8080/ws/espelho',
  reconnectInterval: 5000,
  environment: 'development',
  version: '1.0.0'
};

function loadConfig() {
  if (typeof window !== 'undefined' && window.APP_CONFIG) {
    return { ...defaultConfig, ...window.APP_CONFIG };
  }
  if (typeof process !== 'undefined' && process.env) {
    return {
      ...defaultConfig,
      apiBaseUrl: process.env.API_BASE_URL || defaultConfig.apiBaseUrl,
      whatsappWsUrl: process.env.WHATSAPP_WS_URL || defaultConfig.whatsappWsUrl,
      espelhoWsUrl: process.env.ESPELHO_WS_URL || defaultConfig.espelhoWsUrl,
      reconnectInterval: process.env.RECONNECT_INTERVAL ? +process.env.RECONNECT_INTERVAL : defaultConfig.reconnectInterval,
      environment: process.env.NODE_ENV || defaultConfig.environment,
      version: process.env.FLIPAPP_VERSION || defaultConfig.version
    };
  }
  return defaultConfig;
}

export const appConfig = loadConfig();