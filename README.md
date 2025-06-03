# FlipApp: Plataforma Conversacional Industrial

O FlipApp é uma plataforma conversacional PWA com UI declarativa LogLine, runtime JS reativo e integração WASM/Rust, desenvolvida para ambientes de produção com foco em segurança, performance e acessibilidade.

## 🚀 Recursos

- **UI Declarativa**: Linguagem LogLine para definição de interfaces
- **Core Reativo**: Sistema de estado centralizado com observer pattern
- **WebAssembly**: Processamento avançado via módulo Rust
- **Offline-First**: Cache estratégico e sincronização de fundo
- **PWA**: Instalação e funcionamento offline completo
- **Segurança**: Motor de expressão seguro sem eval()
- **Performance**: Virtual DOM com diffing otimizado
- **Acessibilidade**: Conformidade WCAG 2.1 AA

## 📋 Pré-requisitos

- Node.js 16+
- Rust e wasm-pack (para compilação WASM)
- Docker e Docker Compose (opcional, para ambiente completo)

## 🔧 Instalação

### Desenvolvimento Local

1. Clone o repositório:
   ```bash
   git clone https://github.com/sua-org/flipapp.git
   cd flipapp