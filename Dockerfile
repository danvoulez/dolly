# Dockerfile para FlipApp
FROM node:18-alpine AS build

# Define o diretório de trabalho
WORKDIR /app

# Instala dependências do Rust e WASM
RUN apk add --update --no-cache curl gcc musl-dev \
    && curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
    && . $HOME/.cargo/env \
    && rustup component add rust-std \
    && cargo install wasm-pack

# Copia arquivos de configuração
COPY package.json package-lock.json ./
COPY rust_vm/Cargo.toml rust_vm/Cargo.lock ./rust_vm/

# Instala dependências do Node.js
RUN npm ci

# Copia código-fonte
COPY . .

# Compila WASM
RUN . $HOME/.cargo/env \
    && cd rust_vm \
    && wasm-pack build --target web --release \
    && mkdir -p ../public/wasm \
    && cp pkg/rust_vm.js pkg/rust_vm_bg.wasm ../public/wasm/

# Compila frontend com Vite
ENV NODE_ENV=production
RUN npm run build

# Imagem final de produção
FROM nginx:alpine

# Copia configuração do Nginx
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf

# Copia arquivos de build
COPY --from=build /app/dist /usr/share/nginx/html

# Adiciona script para substituir variáveis de ambiente em runtime
COPY docker/env-config.sh /docker-entrypoint.d/40-env-config.sh
RUN chmod +x /docker-entrypoint.d/40-env-config.sh

# Expõe porta 80
EXPOSE 80

# Comando para iniciar o Nginx
CMD ["nginx", "-g", "daemon off;"]