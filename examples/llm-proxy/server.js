// examples/llm-proxy/server.js
// Proxy para serviço LLM com suporte a múltiplos modelos
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const dotenv = require('dotenv');
const crypto = require('crypto');

// Carregar variáveis de ambiente
dotenv.config();

const app = express();
const PORT = process.env.PORT || 8000;

// Middlewares
app.use(cors());
app.use(express.json());

// Configuração
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const DEFAULT_MODEL = process.env.DEFAULT_MODEL || 'gpt-4-turbo';
const CACHE_DURATION = process.env.CACHE_DURATION || 3600; // 1 hora

// Cache simples em memória
const promptCache = new Map();

// Middleware para verificar API key
function checkApiKey(req, res, next) {
  const apiKey = req.headers.authorization?.split('Bearer ')[1];
  
  // Se nenhuma API key fornecida mas temos OPENAI_API_KEY, use-a
  if (!apiKey && OPENAI_API_KEY) {
    return next();
  }
  
  // Se não temos nenhuma API key, retorne erro
  if (!apiKey && !OPENAI_API_KEY) {
    return res.status(401).json({ 
      error: 'api_key_required', 
      message: 'API key é obrigatória. Forneça via header Authorization: Bearer <API_KEY>'
    });
  }
  
  next();
}

// Endpoint de saúde
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Endpoint para processamento de prompt
app.post('/api/llm/process', checkApiKey, async (req, res) => {
  const { prompt, options = {}, session_id, context = [] } = req.body;
  
  if (!prompt) {
    return res.status(400).json({ error: 'prompt_required', message: 'O prompt é obrigatório' });
  }
  
  // Configuração da requisição
  const model = options.model || DEFAULT_MODEL;
  const max_tokens = options.max_tokens || 1024;
  const temperature = options.temperature || 0.7;
  const apiKey = req.headers.authorization?.split('Bearer ')[1] || OPENAI_API_KEY;
  
  try {
    // Gera hash único para esta combinação de parâmetros (para cache)
    const cacheKey = crypto
      .createHash('md5')
      .update(`${prompt}|${model}|${max_tokens}|${temperature}|${JSON.stringify(context)}`)
      .digest('hex');
    
    // Verifica cache se não desativado explicitamente
    if (options.use_cache !== false) {
      const cached = promptCache.get(cacheKey);
      if (cached && (Date.now() - cached.timestamp) < CACHE_DURATION * 1000) {
        console.log(`[LLM] Usando resposta em cache para: ${prompt.substring(0, 30)}...`);
        return res.json({
          content: cached.content,
          model: cached.model,
          usage: cached.usage,
          is_cached: true
        });
      }
    }
    
    // Sistema de fallback para simulação local quando offline ou sem API key
    if (!apiKey || options.simulate) {
      console.log(`[LLM] Usando simulação local para: ${prompt.substring(0, 30)}...`);
      
      // Simula delay de API
      await new Promise(resolve => setTimeout(resolve, 500 + Math.random() * 1000));
      
      // Gera resposta simulada
      const response = generateSimulatedResponse(prompt, model);
      
      // Armazena em cache
      promptCache.set(cacheKey, {
        content: response.content,
        model: response.model,
        usage: response.usage,
        timestamp: Date.now()
      });
      
      return res.json(response);
    }
    
    // Prepara mensagens para o formato OpenAI
    const messages = [
      { role: 'system', content: 'Você é um assistente útil e conciso.' },
      ...context.map(item => ({
        role: item.role || 'user',
        content: item.content
      })),
      { role: 'user', content: prompt }
    ];
    
    // Chama a API da OpenAI
    const response = await axios.post('https://api.openai.com/v1/chat/completions', {
      model,
      messages,
      max_tokens,
      temperature,
      stream: false
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    // Processa resposta
    const result = {
      content: response.data.choices[0].message.content,
      model: response.data.model,
      usage: response.data.usage
    };
    
    // Armazena em cache
    promptCache.set(cacheKey, {
      ...result,
      timestamp: Date.now()
    });
    
    return res.json(result);
    
  } catch (error) {
    console.error('[LLM] Erro ao processar prompt:', error.response?.data || error.message);
    
    if (error.response?.data?.error) {
      return res.status(error.response.status).json({
        error: error.response.data.error.type || 'api_error',
        message: error.response.data.error.message || 'Erro na API do LLM'
      });
    }
    
    return res.status(500).json({
      error: 'llm_error',
      message: `Erro ao processar prompt: ${error.message}`
    });
  }
});

// Endpoint para modelos disponíveis
app.get('/api/llm/models', checkApiKey, async (req, res) => {
  const apiKey = req.headers.authorization?.split('Bearer ')[1] || OPENAI_API_KEY;
  
  try {
    if (!apiKey) {
      // Sem API key, retorna lista simulada
      return res.json({
        models: [
          { id: 'gpt-4-turbo', name: 'GPT-4 Turbo (Simulado)' },
          { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo (Simulado)' }
        ]
      });
    }
    
    // Chama API da OpenAI para obter modelos
    const response = await axios.get('https://api.openai.com/v1/models', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      }
    });
    
    // Filtra apenas modelos GPT
    const gptModels = response.data.data
      .filter(model => model.id.includes('gpt'))
      .map(model => ({
        id: model.id,
        name: model.id.replace(/-/g, ' ').toUpperCase()
      }));
    
    return res.json({ models: gptModels });
    
  } catch (error) {
    console.error('[LLM] Erro ao obter modelos:', error.response?.data || error.message);
    
    // Se falhou, retorna lista simulada
    return res.json({
      models: [
        { id: 'gpt-4-turbo', name: 'GPT-4 Turbo (Fallback)' },
        { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo (Fallback)' }
      ],
      error: error.message
    });
  }
});

// Endpoint para limpar cache
app.post('/api/llm/clear-cache', (req, res) => {
  const oldSize = promptCache.size;
  promptCache.clear();
  res.json({ message: `Cache limpo. ${oldSize} entradas removidas.` });
});

// Função para gerar respostas simuladas
function generateSimulatedResponse(prompt, model) {
  const promptLower = prompt.toLowerCase();
  let content = '';
  
  if (promptLower.includes('olá') || promptLower.includes('oi')) {
    content = "Olá! Sou o assistente simulado do FlipApp. Como posso ajudar você hoje?";
  } else if (promptLower.includes('clima') || promptLower.includes('tempo')) {
    content = "Não tenho acesso a dados de clima em tempo real, mas posso sugerir verificar um serviço meteorológico local.";
  } else if (promptLower.includes('flipapp')) {
    content = "O FlipApp é uma plataforma conversacional com UI declarativa em LogLine e processamento WASM. Esta é uma resposta simulada para fins de desenvolvimento.";
  } else if (promptLower.length < 10) {
    content = "Poderia elaborar mais seu questionamento? Isso me ajudaria a fornecer uma resposta mais útil.";
  } else {
    content = `Esta é uma resposta simulada para o prompt: "${prompt.substring(0, 50)}${prompt.length > 50 ? '...' : ''}"\n\nEm um ambiente de produção, esta requisição seria processada por um modelo LLM real como GPT-4.`;
  }
  
  // Simula uso de tokens
  const promptTokens = Math.ceil(prompt.length / 4);
  const completionTokens = Math.ceil(content.length / 4);
  
  return {
    content,
    model: model || DEFAULT_MODEL,
    usage: {
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: promptTokens + completionTokens
    },
    is_simulated: true
  };
}

// Inicia o servidor
app.listen(PORT, () => {
  console.log(`[LLM Proxy] Servidor rodando na porta ${PORT}`);
  
  // Log de status da API key
  if (OPENAI_API_KEY) {
    console.log('[LLM Proxy] Usando API key do ambiente');
  } else {
    console.log('[LLM Proxy] API key não configurada, usando simulação por padrão');
  }
});