// examples/ws-server/server.js (continuação)
  
  // Gera spans simulados
  const categories = ['pessoal', 'trabalho', 'estudos', 'lazer'];
  let spanCounter = 0;
  
  function createSimulatedSpan() {
    const category = categories[Math.floor(Math.random() * categories.length)];
    spanCounter++;
    
    return {
      id: `span-${Date.now()}-${spanCounter}`,
      type: 'evento',
      content: `Evento simulado #${spanCounter} na categoria ${category}`,
      category: category,
      timestamp: new Date().toISOString(),
      source: 'simulação'
    };
  }
  
  wss.on('connection', (ws) => {
    console.log('[Espelho WS] Nova conexão');
    clients.add(ws);
    
    // Envia span inicial para novo cliente
    ws.send(JSON.stringify({
      id: `welcome-${Date.now()}`,
      type: 'welcome',
      content: 'Conexão estabelecida com Espelho',
      timestamp: new Date().toISOString()
    }));
    
    // Lidando com mensagens recebidas
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('[Espelho WS] Mensagem recebida:', data);
        
        // Ecoa a mensagem de volta para todos
        const response = {
          id: `echo-${Date.now()}`,
          type: 'echo',
          content: `Eco: ${JSON.stringify(data)}`,
          timestamp: new Date().toISOString(),
          original: data
        };
        
        broadcastMessage(response);
      } catch (err) {
        console.error('[Espelho WS] Erro ao processar mensagem:', err);
      }
    });
    
    // Lidando com desconexão
    ws.on('close', () => {
      console.log('[Espelho WS] Conexão fechada');
      clients.delete(ws);
    });
    
    // Lidando com erros
    ws.on('error', (error) => {
      console.error('[Espelho WS] Erro:', error);
      clients.delete(ws);
    });
  });
  
  // Broadcast para todos os clientes
  function broadcastMessage(data) {
    const message = JSON.stringify(data);
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
  
  // Simulação periódica de eventos
  setInterval(() => {
    if (clients.size > 0) {
      const span = createSimulatedSpan();
      broadcastMessage(span);
    }
  }, 5000); // A cada 5 segundos
  
  server.listen(PORT_ESPELHO, () => {
    console.log(`[Espelho WS] Servidor rodando em ws://localhost:${PORT_ESPELHO}/ws/espelho`);
  });
  
  return { server, wss };
}

// WebSocket para WhatsApp
function createWhatsAppServer() {
  const server = http.createServer(app);
  const wss = new WebSocket.Server({ server, path: '/ws/messages' });
  
  // Armazena conexões ativas
  const clients = new Set();
  
  // Dados simulados
  const contacts = [
    { id: 'contact1', name: 'Maria Silva', number: '+5511987654321' },
    { id: 'contact2', name: 'João Pereira', number: '+5511912345678' },
    { id: 'contact3', name: 'Ana Costa', number: '+5511955443322' },
    { id: 'contact4', name: 'Grupo Trabalho', number: 'grupo', isGroup: true },
  ];
  
  // Mensagens pré-definidas para simulação
  const simulatedMessages = [
    { text: "Oi, tudo bem?", from: 'contact1' },
    { text: "Vamos marcar aquele café?", from: 'contact1' },
    { text: "E aí, como vai o projeto?", from: 'contact2' },
    { text: "Não esquece da reunião amanhã!", from: 'contact4' },
    { text: "Preciso falar com você sobre um assunto importante", from: 'contact3' },
    { text: "Já viu aquele novo sistema?", from: 'contact2' },
    { text: "Obrigado pela ajuda!", from: 'contact1' }
  ];
  
  function createSimulatedMessage() {
    const messageTemplate = simulatedMessages[Math.floor(Math.random() * simulatedMessages.length)];
    const contact = contacts.find(c => c.id === messageTemplate.from);
    
    return {
      id: `msg-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`,
      content: messageTemplate.text,
      from: contact.name,
      fromId: contact.id,
      isGroup: !!contact.isGroup,
      timestamp: new Date().toISOString(),
      status: 'received'
    };
  }
  
  wss.on('connection', (ws) => {
    console.log('[WhatsApp WS] Nova conexão');
    clients.add(ws);
    
    // Envia mensagem inicial para novo cliente
    ws.send(JSON.stringify({
      id: `welcome-${Date.now()}`,
      type: 'system',
      content: 'Conexão estabelecida com servidor WhatsApp',
      timestamp: new Date().toISOString()
    }));
    
    // Envia lista de contatos simulados
    ws.send(JSON.stringify({
      id: `contacts-${Date.now()}`,
      type: 'contacts',
      data: contacts,
      timestamp: new Date().toISOString()
    }));
    
    // Lidando com mensagens recebidas
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        console.log('[WhatsApp WS] Mensagem recebida:', data);
        
        // Se for uma mensagem enviada pelo usuário
        if (data.type === 'message' && data.content) {
          // Simula uma mensagem enviada
          const sentMessage = {
            id: `msg-${Date.now()}-sent`,
            content: data.content,
            from: 'me',
            timestamp: new Date().toISOString(),
            status: 'sent',
            to: data.to || 'contact1' // Padrão para o primeiro contato se não especificado
          };
          
          // Ecoa para todos os clientes
          broadcastMessage(sentMessage);
          
          // Simula uma resposta após um tempo
          setTimeout(() => {
            if (Math.random() > 0.3) { // 70% de chance de resposta
              const response = createSimulatedMessage();
              broadcastMessage(response);
            }
          }, 3000 + Math.random() * 5000); // Resposta entre 3-8 segundos
        }
      } catch (err) {
        console.error('[WhatsApp WS] Erro ao processar mensagem:', err);
      }
    });
    
    // Lidando com desconexão
    ws.on('close', () => {
      console.log('[WhatsApp WS] Conexão fechada');
      clients.delete(ws);
    });
    
    // Lidando com erros
    ws.on('error', (error) => {
      console.error('[WhatsApp WS] Erro:', error);
      clients.delete(ws);
    });
  });
  
  // Broadcast para todos os clientes
  function broadcastMessage(data) {
    const message = JSON.stringify(data);
    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    });
  }
  
  // Simulação periódica de mensagens
  setInterval(() => {
    if (clients.size > 0 && Math.random() > 0.7) { // 30% de chance a cada intervalo
      const message = createSimulatedMessage();
      broadcastMessage(message);
    }
  }, 15000); // A cada 15 segundos
  
  server.listen(PORT_WHATSAPP, () => {
    console.log(`[WhatsApp WS] Servidor rodando em ws://localhost:${PORT_WHATSAPP}/ws/messages`);
  });
  
  return { server, wss };
}

// Inicializar os dois servidores
const espelhoServer = createEspelhoServer();
const whatsappServer = createWhatsAppServer();

// Manipulação de erros e encerramento gracioso
process.on('SIGINT', () => {
  console.log('Encerrando servidores WebSocket...');
  espelhoServer.server.close(() => console.log('[Espelho WS] Servidor encerrado'));
  whatsappServer.server.close(() => console.log('[WhatsApp WS] Servidor encerrado'));
  process.exit(0);
});