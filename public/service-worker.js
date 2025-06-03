// public/service-worker.js
// Service Worker avançado com estratégias de cache optimizadas
const CACHE_VERSION = '1.1.0';
const STATIC_CACHE = `flipapp-static-${CACHE_VERSION}`;
const DYNAMIC_CACHE = `flipapp-dynamic-${CACHE_VERSION}`;
const ASSETS_CACHE = `flipapp-assets-${CACHE_VERSION}`;
const API_CACHE = `flipapp-api-${CACHE_VERSION}`;
const OFFLINE_PAGE = '/offline.html';
const OFFLINE_IMAGE = '/images/offline.svg';

// Recursos críticos para pré-cache
const CRITICAL_ASSETS = [
  '/',
  '/index.html',
  '/offline.html',
  '/styles/main.css',
  '/src/main.js',
  '/wasm/rust_vm.js',
  '/wasm/rust_vm_bg.wasm',
  '/images/offline.svg',
  '/icons/192.png',
  '/icons/512.png',
  '/favicon.ico',
  '/manifest.json'
];

// Recursos a serem pré-cacheados
const ASSET_URLS = [
  ...CRITICAL_ASSETS,
  '/ui/flipapp_ui.logline',
  '/ui/chat_ui.logline',
  '/ui/components/button.logline',
  '/ui/components/chat-message.logline',
  '/sounds/notification.mp3',
  '/sounds/click.mp3',
];

// CDN externos que também devem ser cacheados
const CDN_URLS = [
  'https://cdn.jsdelivr.net/npm/dompurify@3.0.6/dist/purify.min.js',
  'https://cdn.jsdelivr.net/npm/markdown-it@13.0.1/dist/markdown-it.min.js',
];

// Event: Install - Pré-cacheia recursos estáticos
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(STATIC_CACHE)
      .then(cache => {
        console.log('[Service Worker] Pré-cacheando recursos estáticos');
        return cache.addAll(CRITICAL_ASSETS);
      })
      .then(() => {
        // Cache separado para assets (que podem ser grande)
        return caches.open(ASSETS_CACHE)
          .then(cache => {
            console.log('[Service Worker] Pré-cacheando assets adicionais');
            // Cache em lotes para evitar problemas de timeout
            const assetPromises = [];
            const assetsToCache = [...ASSET_URLS.filter(url => !CRITICAL_ASSETS.includes(url)), ...CDN_URLS];
            
            // Divide em lotes de 10
            for (let i = 0; i < assetsToCache.length; i += 10) {
              const batch = assetsToCache.slice(i, i + 10);
              assetPromises.push(
                Promise.all(
                  batch.map(url => 
                    fetch(url, { cache: 'no-cache' })
                      .then(response => {
                        if (!response.ok) {
                          throw new Error(`Falha ao buscar ${url}: ${response.status}`);
                        }
                        return cache.put(url, response);
                      })
                      .catch(error => {
                        console.warn(`[Service Worker] Falha ao pré-cachear ${url}:`, error);
                        // Continue mesmo com falha em um asset
                        return Promise.resolve();
                      })
                  )
                )
              );
            }
            
            return Promise.all(assetPromises);
          });
      })
      .then(() => self.skipWaiting())
  );
});

// Event: Activate - Limpa caches antigos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            // Remove caches antigos
            if (
              cacheName !== STATIC_CACHE && 
              cacheName !== DYNAMIC_CACHE &&
              cacheName !== ASSETS_CACHE &&
              cacheName !== API_CACHE
            ) {
              console.log(`[Service Worker] Removendo cache antigo: ${cacheName}`);
              return caches.delete(cacheName);
            }
          })
        );
      })
      .then(() => {
        // Assume controle imediatamente
        return self.clients.claim();
      })
  );
});

// Event: Fetch - Intercepta requisições
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);
  
  // Ignora requisições internas do navegador
  if (event.request.url.includes('chrome-extension://') || 
      event.request.url.includes('extension://') ||
      event.request.url.includes('devtools')) {
    return;
  }
  
  // 1. Estratégia para APIs
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(networkFirstWithBackup(event.request));
    return;
  }
  
  // 2. Estratégia para WebSockets
  if (url.protocol === 'ws:' || url.protocol === 'wss:') {
    // WebSockets não podem ser interceptados, passamos adiante
    return;
  }
  
  // 3. Estratégia para arquivos .logline (stale-while-revalidate)
  if (url.pathname.endsWith('.logline')) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }
  
  // 4. Estratégia para recursos estáticos críticos (cache-first)
  const isCriticalAsset = CRITICAL_ASSETS.some(asset => 
    url.pathname === asset || url.href === asset
  );
  if (isCriticalAsset) {
    event.respondWith(cacheFirst(event.request));
    return;
  }
  
  // 5. Estratégia para CDN externos (stale-while-revalidate com fallback)
  const isCdnResource = CDN_URLS.some(cdnUrl => url.href.startsWith(cdnUrl));
  if (isCdnResource) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }
  
  // 6. Estratégia padrão para todos os outros recursos
  event.respondWith(networkFirst(event.request));
});

// Event: Background Sync
self.addEventListener('sync', event => {
  if (event.tag === 'sync-messages') {
    event.waitUntil(syncMessages());
  }
});

// Event: Push (notificações push)
self.addEventListener('push', event => {
  if (!event.data) return;
  
  try {
    const data = event.data.json();
    
    const options = {
      body: data.message || 'Nova notificação',
      icon: '/icons/192.png',
      badge: '/icons/badge.png',
      vibrate: [100, 50, 100],
      data: {
        url: data.url || '/'
      }
    };
    
    event.waitUntil(
      self.registration.showNotification('FlipApp', options)
    );
  } catch (error) {
    console.error('[Service Worker] Erro ao processar notificação push:', error);
  }
});

// Event: Notification Click
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  const urlToOpen = event.notification.data?.url || '/';
  
  event.waitUntil(
    clients.matchAll({ type: 'window' })
      .then(clientList => {
        for (const client of clientList) {
          if (client.url === urlToOpen && 'focus' in client) {
            return client.focus();
          }
        }
        if (clients.openWindow) {
          return clients.openWindow(urlToOpen);
        }
      })
  );
});

// Estratégias de cache

// Cache First: Tenta cache, depois rede (para recursos estáticos)
async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);
  
  if (cachedResponse) {
    return cachedResponse;
  }
  
  try {
    const networkResponse = await fetch(request);
    
    // Somente cacheia respostas válidas
    if (networkResponse.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    // Se não estiver no cache e a rede falhar
    return cacheOfflineFallback();
  }
}

// Network First: Tenta rede, depois cache (para conteúdo dinâmico)
async function networkFirst(request) {
  try {
    const networkResponse = await fetch(request);
    
    // Cache bem sucedido para próximas solicitações
    if (networkResponse.ok) {
      const cache = await caches.open(DYNAMIC_CACHE);
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    const cachedResponse = await caches.match(request);
    
    if (cachedResponse) {
      return cachedResponse;
    }
    
    return cacheOfflineFallback();
  }
}

// Network First com backup para APIs
async function networkFirstWithBackup(request) {
  const cache = await caches.open(API_CACHE);
  
  try {
    // Sempre vai para rede primeiro
    const networkResponse = await fetch(request);
    
    // Salva no cache para uso offline
    if (networkResponse.ok && request.method === 'GET') {
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    console.log('[Service Worker] Falha em rede, tentando cache para API:', request.url);
    
    const cachedResponse = await cache.match(request);
    
    if (cachedResponse) {
      // Adiciona header indicando que é dado de cache
      const headers = new Headers(cachedResponse.headers);
      headers.append('X-FlipApp-Cache', 'true');
      
      const cachedBody = await cachedResponse.blob();
      
      return new Response(cachedBody, {
        status: 200,
        statusText: 'OK (cached)',
        headers: headers
      });
    }
    
    // Se for método GET, retorna erro especial
    if (request.method === 'GET') {
      return new Response(
        JSON.stringify({ 
          error: 'offline',
          message: 'Você está offline e esta API não está disponível no cache'
        }),
        { 
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
    
    // Para métodos não-GET, loga para sincronização futura
    try {
      await logRequestForSync(request.clone());
      
      return new Response(
        JSON.stringify({ 
          error: 'offline',
          message: 'Operação enfileirada para sincronização quando estiver online',
          syncing: true
        }),
        { 
          status: 202, // Accepted
          headers: { 'Content-Type': 'application/json' }
        }
      );
    } catch (err) {
      return new Response(
        JSON.stringify({ 
          error: 'sync-failed',
          message: 'Não foi possível enfileirar operação para sincronização'
        }),
        { 
          status: 500,
          headers: { 'Content-Type': 'application/json' }
        }
      );
    }
  }
}

// Stale While Revalidate: Serve do cache enquanto atualiza em segundo plano
async function staleWhileRevalidate(request) {
  const cache = await caches.open(ASSETS_CACHE);
  
  // Serve do cache enquanto atualiza
  const cachedResponse = await cache.match(request);
  
  // Se estiver no cache, serve o cache e atualiza em segundo plano
  if (cachedResponse) {
    // Atualiza cache em segundo plano
    fetch(request)
      .then(networkResponse => {
        if (networkResponse.ok) {
          cache.put(request, networkResponse);
        }
      })
      .catch(error => console.warn('[Service Worker] Falha ao atualizar cache para:', request.url));
    
    return cachedResponse;
  }
  
  try {
    // Se não estiver no cache, vai para rede
    const networkResponse = await fetch(request);
    
    // Armazena resposta no cache
    if (networkResponse.ok) {
      cache.put(request, networkResponse.clone());
    }
    
    return networkResponse;
  } catch (error) {
    return cacheOfflineFallback();
  }
}

// Fallback para modo offline
async function cacheOfflineFallback() {
  const cache = await caches.open(STATIC_CACHE);
  
  const offlineHtml = await cache.match(OFFLINE_PAGE);
  if (offlineHtml) {
    return offlineHtml;
  }
  
  // Fallback para mensagem simples se offline.html não estiver disponível
  return new Response(
    `<html>
      <head>
        <title>FlipApp - Offline</title>
        <style>
          body { font-family: system-ui, sans-serif; text-align: center; padding: 2rem; }
          h1 { color: #1a8cff; }
        </style>
      </head>
      <body>
        <h1>Você está offline</h1>
        <p>O conteúdo solicitado não está disponível sem conexão.</p>
        <button onclick="location.reload()">Tentar novamente</button>
      </body>
    </html>`,
    {
      status: 503,
      headers: { 'Content-Type': 'text/html' }
    }
  );
}

// Loga requisições para sincronização offline
async function logRequestForSync(request) {
  try {
    // Obtém todos os dados da requisição
    const requestData = {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      credentials: request.credentials,
      body: await request.text(),
      timestamp: Date.now()
    };
    
    // Abre o IndexedDB para armazenar requisições de sincronização
    const db = await openSyncDB();
    
    // Armazena requisição para sincronização futura
    const tx = db.transaction('sync-requests', 'readwrite');
    await tx.objectStore('sync-requests').add(requestData);
    await tx.complete;
    
    console.log('[Service Worker] Requisição offline logada para sincronização futura:', requestData.url);
    
    // Registra tarefa de sincronização
    await self.registration.sync.register('sync-messages');
    
    return true;
  } catch (error) {
    console.error('[Service Worker] Erro ao logar requisição para sincronização:', error);
    return false;
  }
}

// Sincroniza mensagens quando online
async function syncMessages() {
  try {
    const db = await openSyncDB();
    const tx = db.transaction('sync-requests', 'readwrite');
    const store = tx.objectStore('sync-requests');
    
    // Obtém todas as requisições pendentes
    const pendingRequests = await store.getAll();
    
    console.log(`[Service Worker] Iniciando sincronização de ${pendingRequests.length} requisições pendentes`);
    
    // Processa cada requisição
    for (const request of pendingRequests) {
      try {
        // Reconstrói a requisição
        const response = await fetch(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.body || null,
          credentials: request.credentials
        });
        
        if (response.ok) {
          // Remove requisição sincronizada com sucesso
          await store.delete(request.id);
          console.log(`[Service Worker] Requisição sincronizada com sucesso: ${request.url}`);
        } else {
          console.warn(`[Service Worker] Falha ao sincronizar requisição: ${request.url}, status: ${response.status}`);
          // Mantém para tentar novamente depois se o erro for temporário
        }
      } catch (error) {
        console.error(`[Service Worker] Erro ao sincronizar requisição para ${request.url}:`, error);
        // Mantém na fila para tentativas futuras
      }
    }
    
    await tx.complete;
    return true;
  } catch (error) {
    console.error('[Service Worker] Erro durante sincronização:', error);
    return false;
  }
}

// Abre banco IndexedDB para sincronização
function openSyncDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('flipapp-sync-db', 1);
    
    request.onerror = event => {
      reject(new Error('Falha ao abrir banco de sync'));
    };
    
    request.onsuccess = event => {
      resolve(event.target.result);
    };
    
    request.onupgradeneeded = event => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('sync-requests')) {
        const store = db.createObjectStore('sync-requests', { 
          keyPath: 'id', 
          autoIncrement: true 
        });
        store.createIndex('timestamp', 'timestamp');
      }
    };
  });
}