// tests/unit/state-manager.test.js
import { StateManager } from '../../src/core/state';

describe('State Manager', () => {
  let stateManager;
  
  beforeEach(() => {
    stateManager = new StateManager();
  });
  
  test('deve definir e obter valores de estado simples', () => {
    stateManager.setState('count', 42);
    expect(stateManager.getState('count')).toBe(42);
  });
  
  test('deve definir e obter valores aninhados', () => {
    stateManager.setState('user.profile.name', 'João');
    expect(stateManager.getState('user.profile.name')).toBe('João');
    
    // Verifica estrutura aninhada
    expect(stateManager.getState('user')).toEqual({
      profile: {
        name: 'João'
      }
    });
  });
  
  test('deve anexar a arrays', () => {
    stateManager.setState('items', []);
    stateManager.appendState('items', 'a');
    stateManager.appendState('items', 'b');
    
    expect(stateManager.getState('items')).toEqual(['a', 'b']);
  });
  
  test('deve criar array automaticamente para append em não-array', () => {
    stateManager.appendState('newList', 'first');
    expect(stateManager.getState('newList')).toEqual(['first']);
  });
  
  test('deve notificar observadores sobre mudanças', () => {
    const observer = jest.fn();
    stateManager.subscribe('count', observer);
    
    stateManager.setState('count', 42);
    
    expect(observer).toHaveBeenCalledWith(42, 'count');
  });
  
  test('deve notificar observadores de objetos pai quando filhos mudam', () => {
    const rootObserver = jest.fn();
    const userObserver = jest.fn();
    const nameObserver = jest.fn();
    
    stateManager.subscribe('*', rootObserver);
    stateManager.subscribe('user', userObserver);
    stateManager.subscribe('user.name', nameObserver);
    
    stateManager.setState('user.name', 'Maria');
    
    expect(nameObserver).toHaveBeenCalledWith('Maria', 'user.name');
    expect(userObserver).toHaveBeenCalled();
    expect(rootObserver).toHaveBeenCalled();
  });
  
  test('deve cancelar inscrição de observadores', () => {
    const observer = jest.fn();
    const unsubscribe = stateManager.subscribe('test', observer);
    
    unsubscribe();
    stateManager.setState('test', 'changed');
    
    expect(observer).toHaveBeenCalledTimes(1); // Uma vez no subscribe inicial, depois nunca mais
  });
  
  test('deve executar middleware', () => {
    const middleware = jest.fn();
    stateManager.addMiddleware(middleware);
    
    stateManager.setState('test', 'value');
    
    expect(middleware).toHaveBeenCalledWith(expect.objectContaining({
      type: 'SET_STATE',
      path: 'test',
      value: 'value'
    }));
  });
  
  test('deve fazer atualização em lote', () => {
    const observer = jest.fn();
    stateManager.subscribe('user.name', observer);
    
    stateManager.batchUpdate({
      'user.name': 'João',
      'user.age': 30,
      'settings.theme': 'dark'
    });
    
    expect(observer).toHaveBeenCalledWith('João', 'user.name');
    expect(stateManager.getState('user.age')).toBe(30);
    expect(stateManager.getState('settings.theme')).toBe('dark');
  });
  
  test('deve resetar estado', () => {
    stateManager.setState('a', 1);
    stateManager.setState('b', 2);
    
    stateManager.resetState();
    
    expect(stateManager.getState('a')).toBeUndefined();
    expect(stateManager.getState('b')).toBeUndefined();
    expect(stateManager.getState('*')).toEqual({});
  });
  
  test('deve persistir estados críticos', () => {
    jest.spyOn(window.localStorage, 'setItem');
    
    stateManager.setState('session.id', 'abc123');
    stateManager.setState('chat.history', [{id: 1, text: 'Hello'}]);
    
    expect(localStorage.setItem).toHaveBeenCalledWith(expect.stringMatching(/flipapp_chat_history/), expect.any(String));
  });
  
  test('deve carregar estados persistidos', () => {
    // Configura mock de localStorage
    jest.spyOn(window.localStorage, 'getItem').mockImplementation((key) => {
      if (key === 'flipapp_chat_history_default') {
        return JSON.stringify([{id: 1, text: 'Saved message'}]);
      }
      return null;
    });
    
    stateManager.loadPersistedState();
    
    expect(stateManager.getState('chat.history')).toEqual([{id: 1, text: 'Saved message'}]);
  });
});