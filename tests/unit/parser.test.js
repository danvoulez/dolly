// tests/unit/parser.test.js
import { LogLineParser } from '../../src/core/parser';

describe('LogLine Parser', () => {
  let parser;
  
  beforeEach(() => {
    parser = new LogLineParser();
  });
  
  test('deve analisar bloco básico', () => {
    const source = `
- type: container
  class: "my-container"
    `;
    
    const ast = parser.parse(source);
    
    expect(ast.blocks.length).toBe(1);
    expect(ast.blocks[0].type).toBe('container');
    expect(ast.blocks[0].properties.class).toBe('my-container');
  });
  
  test('deve lidar com aninhamento', () => {
    const source = `
- type: container
  class: "parent"
  children:
    - type: text
      content: "Child text"
    - type: button
      content: "Click me"
    `;
    
    const ast = parser.parse(source);
    
    expect(ast.blocks.length).toBe(1);
    expect(ast.blocks[0].type).toBe('container');
    expect(ast.blocks[0].children.length).toBe(2);
    expect(ast.blocks[0].children[0].type).toBe('text');
    expect(ast.blocks[0].children[1].type).toBe('button');
  });
  
  test('deve validar bind com formato correto', () => {
    const validSource = `
- type: input
  bind: "user.name"
    `;
    
    const invalidSource = `
- type: input
  bind: "user name"
    `;
    
    expect(() => parser.parse(validSource)).not.toThrow();
    expect(() => parser.parse(invalidSource)).toThrow();
  });
  
  test('deve validar "on" com formato correto', () => {
    const validSource = `
- type: button
  on: "click: sendMessage"
    `;
    
    const invalidSource = `
- type: button
  on: "click => alert('invalid')"
    `;
    
    expect(() => parser.parse(validSource)).not.toThrow();
    expect(() => parser.parse(invalidSource)).toThrow();
  });
  
  test('deve detectar propriedades em linha inválida', () => {
    const invalidSource = `
- type: container
prop without proper indent
    `;
    
    expect(() => parser.parse(invalidSource)).toThrow();
  });
  
  test('deve lidar com componentes', () => {
    // Registra componente de exemplo
    const buttonTemplate = parser.parse(`
- type: button
  class: "custom-btn"
  content: "{{props.label}}"
    `);
    
    parser.registerComponent('Button', buttonTemplate);
    
    const source = `
- type: container
  children:
    - type: Button
      label: "Click me"
    `;
    
    const ast = parser.parse(source);
    expect(ast.blocks[0].children[0].type).toBe('Button');
    expect(ast.blocks[0].children[0].properties.label).toBe('Click me');
  });
  
  test('deve detectar referência circular em componentes', () => {
    const componentA = parser.parse(`
- type: container
  children:
    - type: componentB
    `);
    
    const componentB = parser.parse(`
- type: container
  children:
    - type: componentA
    `);
    
    parser.registerComponent('componentA', componentA);
    parser.registerComponent('componentB', componentB);
    
    const source = `
- type: componentA
    `;
    
    const ast = parser.parse(source);
    expect(ast.errors.length).toBeGreaterThan(0);
    expect(ast.errors[0].message).toContain('circular');
  });
});