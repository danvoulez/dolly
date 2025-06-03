// public/src/ui/components/index.js
/**
 * Registro de componentes reutilizáveis da UI LogLine
 */
import { logger } from '../../utils/logger.js';

// Componente Button
const buttonComponent = `
- type: button
  class: "{{props.className || 'btn'}}"
  style: "{{props.style}}"
  disabled: "{{props.disabled}}"
  content: "{{props.label || props.content || ''}}"
  on: "click: {{props.onClick || 'noop'}}"
`;

// Componente Card
const cardComponent = `
- type: container
  class: "card {{props.className || ''}}"
  style: "border-radius:8px; box-shadow:0 2px 8px rgba(0,0,0,0.1); padding:1rem; margin:1rem 0; {{props.style}}"
  children:
    - type: when
      when: "props.title"
      children:
        - type: container
          class: "card-header"
          style: "margin-bottom:0.5rem; font-weight:bold"
          content: "{{props.title}}"
    - type: container
      class: "card-content"
      children:
        - type: text
          content: "{{props.content}}"
          style: "margin:0"
`;

// Componente Input
const inputComponent = `
- type: container
  class: "input-wrapper {{props.className || ''}}"
  style: "{{props.style}}"
  children:
    - type: when
      when: "props.label"
      children:
        - type: text
          content: "{{props.label}}"
          style: "display:block; margin-bottom:0.25rem; font-size:0.9rem"
    - type: input
      placeholder: "{{props.placeholder || ''}}"
      bind: "{{props.bind || ''}}"
      type: "{{props.type || 'text'}}"
      style: "width:100%; padding:0.5rem; border:1px solid #ccc; border-radius:4px"
      disabled: "{{props.disabled}}"
`;

// Componente Badge
const badgeComponent = `
- type: container
  class: "badge {{props.className || ''}}"
  style: "display:inline-block; padding:0.25rem 0.5rem; border-radius:16px; font-size:0.75rem; background:{{props.color || '#e0e0e0'}}; color:{{props.textColor || '#333'}}; {{props.style}}"
  children:
    - type: text
      content: "{{props.content || props.text || ''}}"
      style: "margin:0"
`;

// Componente Avatar
const avatarComponent = `
- type: container
  class: "avatar {{props.className || ''}}"
  style: "width:{{props.size || '40px'}}; height:{{props.size || '40px'}}; border-radius:50%; overflow:hidden; {{props.style}}"
  children:
    - type: image
      src: "{{props.src || ''}}"
      alt: "{{props.alt || 'Avatar'}}"
      style: "width:100%; height:100%; object-fit:cover"
`;

// Componente Loader
const loaderComponent = `
- type: container
  class: "loader {{props.className || ''}}"
  style: "display:inline-block; width:{{props.size || '24px'}}; height:{{props.size || '24px'}}; border:3px solid rgba(0,0,0,0.1); border-radius:50%; border-top-color:{{props.color || '#3498db'}}; animation:spin 1s linear infinite; {{props.style}}"
`;

// Componente Modal
const modalComponent = `
- type: container
  class: "modal {{props.className || ''}}"
  style: "position:fixed; top:0; left:0; width:100%; height:100%; display:{{props.visible ? 'flex' : 'none'}}; align-items:center; justify-content:center; background:rgba(0,0,0,0.5); z-index:1000; {{props.style}}"
  children:
    - type: container
      class: "modal-content"
      style: "background:white; border-radius:8px; padding:1rem; max-width:90%; width:{{props.width || '400px'}}; max-height:90vh; overflow-y:auto"
      children:
        - type: container
          class: "modal-header"
          style: "display:flex; justify-content:space-between; align-items:center; margin-bottom:1rem"
          children:
            - type: text
              content: "{{props.title || 'Modal'}}"
              style: "font-weight:bold; margin:0"
            - type: button
              content: "×"
              style: "background:none; border:none; font-size:1.5rem; cursor:pointer"
              on: "click: {{props.onClose || ''}}"
        - type: container
          class: "modal-body"
          children:
            - type: text
              content: "{{props.content || ''}}"
`;

// Lista de todos os componentes a registrar
const components = {
  Button: buttonComponent,
  Card: cardComponent,
  Input: inputComponent,
  Badge: badgeComponent,
  Avatar: avatarComponent,
  Loader: loaderComponent,
  Modal: modalComponent
};

/**
 * Registra todos os componentes no parser e renderer
 */
export function setupComponents(parser, renderer) {
  Object.entries(components).forEach(([name, template]) => {
    try {
      const ast = parser.parse(template, `component_${name.toLowerCase()}.logline`);
      renderer.registerComponent(name, ast);
      logger.debug(`Componente '${name}' registrado com sucesso`);
    } catch (error) {
      logger.error(`Erro ao registrar componente '${name}':`, error);
    }
  });
  
  logger.info(`${Object.keys(components).length} componentes LogLine registrados`);
}

/**
 * Exporta componentes individuais para uso direto
 */
export const componentTemplates = components;