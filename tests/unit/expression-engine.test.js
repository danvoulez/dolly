// tests/unit/expression-engine.test.js
import { ExpressionEngine } from '../../src/core/expression-engine';

describe('Expression Engine', () => {
  let engine;
  
  beforeEach(() => {
    engine = new ExpressionEngine();
  });
  
  test('deve avaliar expressões simples', () => {
    expect(engine.evaluate('1 + 1')).toBe(2);
    expect(engine.evaluate('2 * 3')).toBe(6);
    expect(engine.evaluate('10 / 2')).toBe(5);
    expect(engine.evaluate('5 - 3')).toBe(2);
  });
  
  test('deve avaliar comparações', () => {
    expect(engine.evaluate('1 < 2')).toBe(true);
    expect(engine.evaluate('2 > 1')).toBe(true);
    expect(engine.evaluate('1 === 1')).toBe(true);
    expect(engine.evaluate('1 !== 2')).toBe(true);
    expect(engine.evaluate('1 == 1')).toBe(true);
    expect(engine.evaluate('1 != 2')).toBe(true);
  });
  
  test('deve avaliar operadores lógicos', () => {
    expect(engine.evaluate('true && true')).toBe(true);
    expect(engine.evaluate('true && false')).toBe(false);
    expect(engine.evaluate('true || false')).toBe(true);
    expect(engine.evaluate('false || false')).toBe(false);
    expect(engine.evaluate('!false')).toBe(true);
    expect(engine.evaluate('!true')).toBe(false);
  });
  
  test('deve acessar propriedades do contexto', () => {
    const context = {
      user: {
        name: 'João',
        age: 30,
        isAdmin: true
      },
      count: 42
    };
    
    expect(engine.evaluate('user.name', context)).toBe('João');
    expect(engine.evaluate('user.age', context)).toBe(30);
    expect(engine.evaluate('user.isAdmin', context)).toBe(true);
    expect(engine.evaluate('count', context)).toBe(42);
    expect(engine.evaluate('user.age > 18', context)).toBe(true);
  });
  
  test('deve usar operador ternário', () => {
    const context = { age: 20 };
    
    expect(engine.evaluate('age >= 18 ? "adulto" : "menor"', context)).toBe('adulto');
    expect(engine.evaluate('age < 18 ? "menor" : "adulto"', context)).toBe('adulto');
  });
  
  test('deve interpolar strings', () => {
    const context = {
      user: {
        name: 'Maria',
        age: 25
      },
      product: {
        name: 'Laptop',
        price: 1200
      }
    };
    
    expect(engine.interpolate('Olá, {{user.name}}!', context)).toBe('Olá, Maria!');
    expect(engine.interpolate('{{user.name}} tem {{user.age}} anos.', context)).toBe('Maria tem 25 anos.');
    expect(engine.interpolate('Total: {{product.price * 1.1}}', context)).toBe('Total: 1320');
  });
  
  test('deve lidar com valores literais', () => {
    expect(engine.evaluate('null')).toBe(null);
    expect(engine.evaluate('undefined')).toBe(undefined);
    expect(engine.evaluate('true')).toBe(true);
    expect(engine.evaluate('false')).toBe(false);
    expect(engine.evaluate('"string"')).toBe('string');
    expect(engine.evaluate('42')).toBe(42);
  });
  
  test('deve validar expressões seguras', () => {
    expect(engine.validateExpression('user.name === "João"')).toBe(true);
    expect(engine.validateExpression('age >= 18 && isAdmin')).toBe(true);
    
    // Expressões perigosas
    expect(engine.validateExpression('eval("alert(1)")')).toBe(false);
    expect(engine.validateExpression('constructor.constructor("alert(1)")()')).toBe(false);
    expect(engine.validateExpression('window.document.body')).toBe(false);
  });
  
  test('deve lidar com funções permitidas', () => {
    const context = {
      text: 'Hello, World',
      items: [1, 2, 3, 4, 5]
    };
    
    expect(engine.evaluate('text.toLowerCase()', context)).toBe('hello, world');
    expect(engine.evaluate('text.includes("World")', context)).toBe(true);
    expect(engine.evaluate('items.length', context)).toBe(5);
  });
  
  test('deve rejeitar funções não permitidas', () => {
    const maliciousCode = 'console.log("hacked")';
    
    expect(() => {
      engine.evaluate(`eval('${maliciousCode}')`);
    }).toThrow();
    
    expect(() => {
      engine.evaluate('document.cookie');
    }).toThrow();
  });
  
  test('deve usar cache para expressões repetidas', () => {
    const context = { count: 42 };
    
    // Espia o método _parse
    const spy = jest.spyOn(engine, '_parse');
    
    // Primeira chamada deve parsear
    engine.evaluate('count + 1', context);
    expect(spy).toHaveBeenCalledTimes(1);
    
    // Segunda chamada com mesma expressão deve usar cache
    engine.evaluate('count + 1', context);
    expect(spy).toHaveBeenCalledTimes(1);
    
    // Diferente contexto mas mesma expressão deve usar cache
    engine.evaluate('count + 1', { count: 50 });
    expect(spy).toHaveBeenCalledTimes(1);
    
    // Expressão diferente não deve usar cache
    engine.evaluate('count - 1', context);
    expect(spy).toHaveBeenCalledTimes(2);
    
    spy.mockRestore();
  });
});