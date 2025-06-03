#!/bin/sh
# Script para substituir variáveis de ambiente no HTML em runtime

# Arquivo de configuração
HTML_FILE="/usr/share/nginx/html/index.html"

# Lista de variáveis de ambiente para substituir
ENV_VARS=(
  "API_BASE_URL"
  "WHATSAPP_WS_URL"
  "ESPELHO_WS_URL"
  "LLM_API_URL"
  "NODE_ENV"
)

# Substitui as variáveis
for VAR in ${ENV_VARS[@]}; do
  VALUE=$(printenv $VAR || echo "")
  echo "Configurando $VAR = $VALUE"
  sed -i "s|{{$VAR}}|$VALUE|g" $HTML_FILE
done

# Substitui variáveis não encontradas com valores padrão
sed -i "s|{{API_BASE_URL}}|http://localhost:8000/api|g" $HTML_FILE
sed -i "s|{{WHATSAPP_WS_URL}}|ws://localhost:3001/ws/messages|g" $HTML_FILE
sed -i "s|{{ESPELHO_WS_URL}}|ws://localhost:8080/ws/espelho|g" $HTML_FILE
sed -i "s|{{LLM_API_URL}}|http://localhost:8000/api/llm|g" $HTML_FILE
sed -i "s|{{NODE_ENV}}|production|g" $HTML_FILE

echo "Configuração de ambiente concluída"