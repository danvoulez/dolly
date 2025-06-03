// public/src/core/renderer.js
/**
 * Renderer otimizado com Virtual DOM e diffing para performance
 */
import { expressionEngine } from './expression-engine.js';
import { stateManager } from './state.js';

export class VirtualNode {
  constructor(type, props = {}, children = [], key = null) {
    this.type = type;
    this.props = props;
    this.children = children;
    this.key = key;
    this.ref = null; // Referência ao DOM real
  }
}

export class LogLineRenderer {
  constructor() {
    this.componentRegistry = new Map();
    this.mountedComponents = new Map(); // Rastreamento de componentes montados
    this.eventListeners = new WeakMap(); // Rastreamento de listeners para cleanup
    this.subscriptions = new WeakMap(); // Rastreamento de subscrições de estado
  }

  /**
   * Renderiza AST para Virtual DOM
   * @param {Object} ast - AST do LogLine
   * @param {Object} handlers - Handlers de contrato
   * @param {Object} context - Contexto de dados local
   * @returns {VirtualNode} Árvore Virtual DOM
   */
  render(ast, handlers = {}, context = {}) {
    if (!ast || !ast.blocks) {
      console.warn('[Renderer] AST inválida recebida');
      return new VirtualNode('div', {}, []);
    }

    const children = ast.blocks.map(block => this.renderBlock(block, handlers, context));
    return new VirtualNode('div', { class: 'logline-root' }, children);
  }

  /**
   * Renderiza um bloco individual
   * @param {Object} block - Bloco LogLine
   * @param {Object} handlers - Handlers de contrato
   * @param {Object} context - Contexto local
   * @returns {VirtualNode} Nó virtual
   */
  renderBlock(block, handlers, context) {
    if (!block || !block.type) {
      console.warn('[Renderer] Bloco inválido:', block);
      return new VirtualNode('div', {}, []);
    }

    // Processa componentes personalizados
    if (block.type === 'component') {
      return this.renderComponent(block, handlers, context);
    }

    // Processa loops
    if (block.type === 'loop') {
      return this.renderLoop(block, handlers, context);
    }

    // Cria o nó virtual
    const elementType = this.getElementTag(block.type);
    const props = this.processProperties(block.properties || {}, context);
    
    // Processa condições 'when'
    if (props.when !== undefined) {
      const condition = expressionEngine.evaluate(props.when, context);
      if (!condition) {
        return new VirtualNode('template', { style: 'display: none' }, []);
      }
      delete props.when; // Remove para não passar ao DOM
    }

    // Renderiza filhos
    const children = (block.children || []).map(child => 
      this.renderBlock(child, handlers, context)
    );

    const vnode = new VirtualNode(elementType, props, children, block.metadata?.key);
    
    // Adiciona metadados para debugging
    if (process.env.NODE_ENV === 'development') {
      vnode.loglineBlock = block;
    }

    return vnode;
  }

  /**
   * Renderiza um componente reutilizável
   * @param {Object} block - Bloco de componente
   * @param {Object} handlers - Handlers
   * @param {Object} context - Contexto
   * @returns {VirtualNode} Nó virtual do componente
   */
  renderComponent(block, handlers, context) {
    const { componentName, properties = {}, template } = block;
    
    if (!this.componentRegistry.has(componentName) && !template) {
      console.error(`[Renderer] Componente não registrado: ${componentName}`);
      return new VirtualNode('div', { 
        class: 'error-component',
        'data-error': `Componente não encontrado: ${componentName}`
      }, []);
    }

    const componentTemplate = template || this.componentRegistry.get(componentName);
    
    // Cria contexto de props para o componente
    const componentContext = {
      ...context,
      props: this.processProperties(properties, context)
    };

    // Renderiza template do componente
    if (componentTemplate.blocks) {
      const children = componentTemplate.blocks.map(childBlock => 
        this.renderBlock(childBlock, handlers, componentContext)
      );
      
      return new VirtualNode('div', { 
        class: `component-${componentName}`,
        'data-component': componentName
      }, children);
    }

    return new VirtualNode('div', {}, []);
  }

  /**
   * Renderiza um loop sobre dados
   * @param {Object} block - Bloco de loop
   * @param {Object} handlers - Handlers
   * @param {Object} context - Contexto
   * @returns {VirtualNode} Container com itens do loop
   */
  renderLoop(block, handlers, context) {
    const { properties = {}, children = [] } = block;
    const dataPath = properties.data;
    
    if (!dataPath) {
      console.warn('[Renderer] Loop sem propriedade data:', block);
      return new VirtualNode('div', {}, []);
    }

    // Resolve dados do loop
    const loopData = expressionEngine.evaluate(dataPath, context);
    
    if (!Array.isArray(loopData)) {
      console.warn(`[Renderer] Dados de loop não são array: ${dataPath}`, loopData);
      return new VirtualNode('div', {}, []);
    }

    // Renderiza cada item
    const loopItems = loopData.map((item, index) => {
      const itemContext = {
        ...context,
        item,
        index,
        $index: index,
        $first: index === 0,
        $last: index === loopData.length - 1,
        $even: index % 2 === 0,
        $odd: index % 2 === 1
      };

      // Renderiza filhos para este item
      const itemChildren = children.map(child => 
        this.renderBlock(child, handlers, itemContext)
      );

      // Usa key único para otimização de diffing
      const key = item.id || item.key || `loop-item-${index}`;
      
      return new VirtualNode('div', { 
        class: 'loop-item',
        'data-loop-index': index
      }, itemChildren, key);
    });

    return new VirtualNode('div', { 
      class: 'loop-container',
      'data-loop-source': dataPath
    }, loopItems);
  }

  /**
   * Processa propriedades do bloco
   * @param {Object} properties - Propriedades brutas
   * @param {Object} context - Contexto para interpolação
   * @returns {Object} Propriedades processadas
   */
  processProperties(properties, context) {
    const processed = {};
    
    Object.entries(properties).forEach(([key, value]) => {
      if (typeof value === 'string') {
        processed[key] = expressionEngine.interpolate(value, context);
      } else {
        processed[key] = value;
      }
    });

    return processed;
  }

  /**
   * Monta Virtual DOM no DOM real com diffing otimizado
   * @param {VirtualNode} vnode - Nó virtual
   * @param {Element} container - Container DOM
   * @param {Object} handlers - Handlers de evento
   */
  mount(vnode, container, handlers = {}) {
    const element = this.createDOMElement(vnode, handlers);
    
    // Limpa container e monta
    this.unmountAll(container);
    container.appendChild(element);
    
    // Registra elemento para tracking
    vnode.ref = element;
    
    return element;
  }

  /**
   * Atualiza DOM usando algoritmo de diffing
   * @param {VirtualNode} oldVNode - Árvore virtual anterior
   * @param {VirtualNode} newVNode - Nova árvore virtual
   * @param {Element} container - Container DOM
   * @param {Object} handlers - Handlers
   */
  patch(oldVNode, newVNode, container, handlers = {}) {
    if (!oldVNode) {
      return this.mount(newVNode, container, handlers);
    }

    if (!newVNode) {
      this.unmount(oldVNode);
      return null;
    }

    if (this.shouldReplace(oldVNode, newVNode)) {
      const newElement = this.createDOMElement(newVNode, handlers);
      const oldElement = oldVNode.ref;
      
      if (oldElement && oldElement.parentNode) {
        this.unmount(oldVNode);
        oldElement.parentNode.replaceChild(newElement, oldElement);
      }
      
      newVNode.ref = newElement;
      return newElement;
    }

    // Atualiza nó existente
    this.updateElement(oldVNode, newVNode, handlers);
    this.patchChildren(oldVNode, newVNode, handlers);
    
    newVNode.ref = oldVNode.ref;
    return newVNode.ref;
  }

  /**
   * Verifica se deve substituir elemento completamente
   * @param {VirtualNode} oldVNode - Nó antigo
   * @param {VirtualNode} newVNode - Nó novo
   * @returns {boolean} True se deve substituir
   */
  shouldReplace(oldVNode, newVNode) {
    return oldVNode.type !== newVNode.type || 
           oldVNode.key !== newVNode.key;
  }

  /**
   * Atualiza propriedades de um elemento existente
   * @param {VirtualNode} oldVNode - Nó antigo
   * @param {VirtualNode} newVNode - Nó novo
   * @param {Object} handlers - Handlers
   */
  updateElement(oldVNode, newVNode, handlers) {
    const element = oldVNode.ref;
    if (!element) return;

    // Remove propriedades antigas
    Object.keys(oldVNode.props).forEach(key => {
      if (!(key in newVNode.props)) {
        this.removeProp(element, key, oldVNode.props[key]);
      }
    });

    // Adiciona/atualiza propriedades novas
    Object.entries(newVNode.props).forEach(([key, value]) => {
      if (oldVNode.props[key] !== value) {
        this.setProp(element, key, value, handlers);
      }
    });
  }

  /**
   * Faz patch dos filhos usando algoritmo otimizado
   * @param {VirtualNode} oldVNode - Nó pai antigo
   * @param {VirtualNode} newVNode - Nó pai novo
   * @param {Object} handlers - Handlers
   */
  patchChildren(oldVNode, newVNode, handlers) {
    const element = oldVNode.ref;
    const oldChildren = oldVNode.children || [];
    const newChildren = newVNode.children || [];

    // Algoritmo simples de diffing por chave
    const keyedOld = new Map();
    const keyedNew = new Map();
    
    oldChildren.forEach((child, index) => {
      if (child.key) {
        keyedOld.set(child.key, { child, index });
      }
    });
    
    newChildren.forEach((child, index) => {
      if (child.key) {
        keyedNew.set(child.key, { child, index });
      }
    });

    // Patches por chave primeiro
    for (const [key, { child: newChild, index: newIndex }] of keyedNew) {
      if (keyedOld.has(key)) {
        const { child: oldChild, index: oldIndex } = keyedOld.get(key);
        this.patch(oldChild, newChild, element, handlers);
        
        // Move elemento se necessário
        if (newIndex !== oldIndex) {
          const childElement = newChild.ref || oldChild.ref;
          if (childElement && element.children[newIndex] !== childElement) {
            element.insertBefore(childElement, element.children[newIndex] || null);
          }
        }
      } else {
        // Novo elemento com chave
        const newElement = this.createDOMElement(newChild, handlers);
        element.insertBefore(newElement, element.children[newIndex] || null);
        newChild.ref = newElement;
      }
    }

    // Remove elementos com chave que não existem mais
    for (const [key, { child: oldChild }] of keyedOld) {
      if (!keyedNew.has(key)) {
        this.unmount(oldChild);
      }
    }

    // Patch elementos sem chave (fallback simples)
    const maxLength = Math.max(oldChildren.length, newChildren.length);
    for (let i = 0; i < maxLength; i++) {
      const oldChild = oldChildren[i];
      const newChild = newChildren[i];
      
      if (oldChild && !oldChild.key && newChild && !newChild.key) {
        this.patch(oldChild, newChild, element, handlers);
      } else if (!oldChild && newChild && !newChild.key) {
        const newElement = this.createDOMElement(newChild, handlers);
        element.appendChild(newElement);
        newChild.ref = newElement;
      } else if (oldChild && !oldChild.key && !newChild) {
        this.unmount(oldChild);
      }
    }
  }

  /**
   * Cria elemento DOM a partir de VirtualNode
   * @param {VirtualNode} vnode - Nó virtual
   * @param {Object} handlers - Handlers de evento
   * @returns {Element} Elemento DOM
   */
  createDOMElement(vnode, handlers) {
    if (vnode.type === 'text') {
      const text = vnode.props.content || '';
      return document.createTextNode(text);
    }

    const element = document.createElement(vnode.type);
    
    // Aplica propriedades
    Object.entries(vnode.props).forEach(([key, value]) => {
      this.setProp(element, key, value, handlers);
    });

    // Cria filhos
    vnode.children.forEach(child => {
      const childElement = this.createDOMElement(child, handlers);
      element.appendChild(childElement);
      child.ref = childElement;
    });

    return element;
  }

  /**
   * Define propriedade no elemento DOM
   * @param {Element} element - Elemento DOM
   * @param {string} key - Nome da propriedade
   * @param {*} value - Valor da propriedade
   * @param {Object} handlers - Handlers de evento
   */
  setProp(element, key, value, handlers) {
    switch (key) {
      case 'style':
        if (typeof value === 'string') {
          element.style.cssText = value;
        } else if (typeof value === 'object') {
          Object.assign(element.style, value);
        }
        break;
        
      case 'class':
      case 'className':
        element.className = value;
        break;
        
      case 'on':
        this.applyEventHandlers(element, value, handlers);
        break;
        
      case 'bind':
        this.applyDataBinding(element, value, handlers);
        break;
        
      case 'content':
        if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
          element.value = value;
        } else {
          element.textContent = value;
        }
        break;
        
      case 'innerHTML':
        // Sanitização básica - em produção usar DOMPurify
        if (typeof window.DOMPurify !== 'undefined') {
          element.innerHTML = window.DOMPurify.sanitize(value);
        } else {
          console.warn('[Renderer] DOMPurify não disponível, pulando innerHTML');
        }
        break;
        
      default:
        // Propriedades HTML padrão
        try {
          if (value === null || value === undefined || value === false) {
            element.removeAttribute(key);
          } else if (value === true) {
            element.setAttribute(key, '');
          } else {
            element.setAttribute(key, String(value));
          }
        } catch (error) {
          console.warn(`[Renderer] Erro ao definir propriedade ${key}:`, error);
        }
        break;
    }
  }

  /**
   * Remove propriedade do elemento DOM
   * @param {Element} element - Elemento DOM
   * @param {string} key - Nome da propriedade
   * @param {*} value - Valor antigo da propriedade
   */
  removeProp(element, key, value) {
    switch (key) {
      case 'style':
        element.style.cssText = '';
        break;
        
      case 'class':
      case 'className':
        element.className = '';
        break;
        
      case 'on':
        this.removeEventHandlers(element);
        break;
        
      case 'bind':
        this.removeDataBinding(element);
        break;
        
      default:
        element.removeAttribute(key);
        break;
    }
  }

  /**
   * Aplica handlers de evento
   * @param {Element} element - Elemento DOM
   * @param {string} handlersString - String de handlers
   * @param {Object} contractHandlers - Handlers de contrato
   */
  applyEventHandlers(element, handlersString, contractHandlers) {
    if (!handlersString || !contractHandlers.onContractCall) return;

    // Remove listeners antigos
    this.removeEventHandlers(element);

    const handlers = this.parseEventHandlers(handlersString);
    const elementListeners = [];

    handlers.forEach(({ event, contract, params }) => {
      const listener = (e) => {
        e.preventDefault();
        contractHandlers.onContractCall(contract, {
          ...params,
          event: e,
          element: element,
          state: stateManager.getState('*')
        });
      };

      element.addEventListener(event, listener);
      elementListeners.push({ event, listener });
    });

    // Armazena listeners para cleanup
    this.eventListeners.set(element, elementListeners);
  }

  /**
   * Remove handlers de evento
   * @param {Element} element - Elemento DOM
   */
  removeEventHandlers(element) {
    const listeners = this.eventListeners.get(element);
    if (listeners) {
      listeners.forEach(({ event, listener }) => {
        element.removeEventListener(event, listener);
      });
      this.eventListeners.delete(element);
    }
  }

  /**
   * Aplica binding de dados
   * @param {Element} element - Elemento DOM
   * @param {string} binding - String de binding
   * @param {Object} handlers - Handlers
   */
  applyDataBinding(element, binding, handlers) {
    const [statePath, contract] = binding.split('|').map(s => s.trim());

    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA') {
      // Sincroniza valor inicial
      element.value = stateManager.getState(statePath) || '';

      // Listener para mudanças
      const listener = (e) => {
        stateManager.setState(statePath, e.target.value);
        
        // Executa contrato se especificado
        if (contract && handlers.onContractCall) {
          handlers.onContractCall(contract, {
            value: e.target.value,
            element: element,
            statePath: statePath
          });
        }
      };

      element.addEventListener('input', listener);

      // Subscrição para mudanças externas do estado
      const subscription = stateManager.subscribe(statePath, (value) => {
        if (element.value !== value) {
          element.value = value || '';
        }
      });

      // Armazena para cleanup
      this.subscriptions.set(element, { listener, subscription });
    }
  }

  /**
   * Remove binding de dados
   * @param {Element} element - Elemento DOM
   */
  removeDataBinding(element) {
    const binding = this.subscriptions.get(element);
    if (binding) {
      if (binding.listener) {
        element.removeEventListener('input', binding.listener);
      }
      if (binding.subscription) {
        binding.subscription(); // Chama função de cleanup
      }
      this.subscriptions.delete(element);
    }
  }

  /**
   * Faz parse de string de event handlers
   * @param {string} handlersString - String de handlers
   * @returns {Array} Array de handlers parseados
   */
  parseEventHandlers(handlersString) {
    const handlers = [];
    
    handlersString.split(';').forEach(handlerEntry => {
      const parts = handlerEntry.trim().split(':');
      if (parts.length < 2) return;

      const event = parts[0].trim();
      const contractCall = parts.slice(1).join(':').trim();

      let contract = contractCall;
      let params = {};

      // Parse de parâmetros: contract(param1='value', param2='another')
      const paramMatch = contractCall.match(/^([a-zA-Z0-9_]+)\((.*)\)$/);
      if (paramMatch) {
        contract = paramMatch[1];
        const rawParamsString = paramMatch[2];
        
        // Parse simples de parâmetros
        rawParamsString.split(',').forEach(paramPair => {
          const [key, rawValue] = paramPair.split('=').map(s => s.trim());
          if (key && rawValue) {
            params[key] = rawValue.replace(/^['"]|['"]$/g, '');
          }
        });
      }

      handlers.push({ event, contract, params });
    });

    return handlers;
  }

  /**
   * Desmonta elemento e faz cleanup
   * @param {VirtualNode} vnode - Nó virtual a ser desmontado
   */
  unmount(vnode) {
    if (!vnode.ref) return;

    // Cleanup de eventos e bindings
    this.removeEventHandlers(vnode.ref);
    this.removeDataBinding(vnode.ref);

    // Desmonta filhos recursivamente
    if (vnode.children) {
      vnode.children.forEach(child => this.unmount(child));
    }

    // Remove do DOM
    if (vnode.ref.parentNode) {
      vnode.ref.parentNode.removeChild(vnode.ref);
    }

    vnode.ref = null;
  }

  /**
   * Desmonta todos os elementos de um container
   * @param {Element} container - Container a ser limpo
   */
  unmountAll(container) {
    while (container.firstChild) {
      // Cleanup recursivo se necessário
      this.cleanupElement(container.firstChild);
      container.removeChild(container.firstChild);
    }
  }

  /**
   * Faz cleanup de um elemento DOM
   * @param {Element} element - Elemento a ser limpo
   */
  cleanupElement(element) {
    // Remove listeners
    this.eventListeners.delete(element);
    this.subscriptions.delete(element);

    // Cleanup recursivo dos filhos
    if (element.children) {
      Array.from(element.children).forEach(child => this.cleanupElement(child));
    }
  }

  /**
   * Obtém tag HTML para tipo de bloco
   * @param {string} blockType - Tipo do bloco LogLine
   * @returns {string} Tag HTML
   */
  getElementTag(blockType) {
    const typeMap = {
      container: 'div',
      text: 'p',
      markdown: 'div',
      button: 'button',
      input: 'input',
      textarea: 'textarea',
      image: 'img',
      link: 'a',
      list: 'ul',
      listItem: 'li',
      header: 'h1',
      section: 'section',
      article: 'article',
      nav: 'nav',
      footer: 'footer',
      span: 'span',
      strong: 'strong',
      em: 'em',
      loop: 'div',
      when: 'div',
      component: 'div'
    };
    
    return typeMap[blockType] || 'div';
  }

  /**
   * Registra componente reutilizável
   * @param {string} name - Nome do componente
   * @param {Object} template - Template do componente
   */
  registerComponent(name, template) {
    this.componentRegistry.set(name, template);
  }

  /**
   * Remove componente registrado
   * @param {string} name - Nome do componente
   */
  unregisterComponent(name) {
    this.componentRegistry.delete(name);
  }

  /**
   * Lista componentes registrados
   * @returns {Array} Lista de nomes de componentes
   */
  getRegisteredComponents() {
    return Array.from(this.componentRegistry.keys());
  }
}

// Singleton global
export const renderer = new LogLineRenderer();