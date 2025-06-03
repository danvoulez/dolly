// public/src/core/parser.js
/**
 * Parser avançado para LogLine DSL com suporte a componentes e validação
 */
export class LogLineParser {
  constructor(componentRegistry = new Map()) {
    this.componentRegistry = componentRegistry;
    this.parseErrors = [];
  }

  /**
   * Analisa código LogLine e retorna AST
   * @param {string} source - Código LogLine
   * @param {string} fileName - Nome do arquivo (para debug)
   * @returns {Object} AST com blocos e metadados
   */
  parse(source, fileName = 'unknown') {
    this.parseErrors = [];
    const blocks = [];
    const lines = source.split('\n').map((line, index) => ({ content: line, number: index + 1 }));
    const contextStack = [];

    for (const { content: line, number: lineNumber } of lines) {
      if (!line.trim() || line.trim().startsWith('#')) continue; // Ignora vazias e comentários

      try {
        this._parseLine(line, lineNumber, blocks, contextStack, fileName);
      } catch (error) {
        this.parseErrors.push({
          line: lineNumber,
          message: error.message,
          file: fileName
        });
      }
    }

    // Valida AST final
    this._validateAST(blocks, fileName);

    return {
      blocks,
      errors: this.parseErrors,
      metadata: {
        fileName,
        parsedAt: new Date().toISOString(),
        componentCount: this._countComponents(blocks)
      }
    };
  }

  _parseLine(line, lineNumber, blocks, contextStack, fileName) {
    const lineIndent = line.search(/\S|$/);

    if (line.trim().startsWith('- type:')) {
      this._parseBlockDeclaration(line, lineIndent, lineNumber, blocks, contextStack, fileName);
    } else if (line.trim().startsWith('- component:')) {
      this._parseComponentDeclaration(line, lineIndent, lineNumber, blocks, contextStack, fileName);
    } else if (contextStack.length > 0) {
      this._parseProperty(line, lineIndent, lineNumber, contextStack, fileName);
    } else {
      throw new Error(`Linha órfã sem contexto de bloco: ${line.trim()}`);
    }
  }

  _parseBlockDeclaration(line, lineIndent, lineNumber, blocks, contextStack, fileName) {
    const blockType = line.split(':')[1].trim();
    
    if (!blockType) {
      throw new Error('Tipo de bloco vazio');
    }

    const newBlock = {
      type: blockType,
      properties: {},
      children: [],
      metadata: {
        line: lineNumber,
        file: fileName,
        indent: lineIndent
      }
    };

    // Desempilha contextos com indentação menor ou igual
    while (contextStack.length > 0 && lineIndent <= contextStack[contextStack.length - 1].indentLevel) {
      contextStack.pop();
    }

    if (contextStack.length > 0) {
      contextStack[contextStack.length - 1].block.children.push(newBlock);
    } else {
      blocks.push(newBlock);
    }

    contextStack.push({
      block: newBlock,
      indentLevel: lineIndent
    });
  }

  _parseComponentDeclaration(line, lineIndent, lineNumber, blocks, contextStack, fileName) {
    const componentName = line.split(':')[1].trim();
    
    if (!this.componentRegistry.has(componentName)) {
      throw new Error(`Componente não registrado: ${componentName}`);
    }

    const componentTemplate = this.componentRegistry.get(componentName);
    const componentBlock = {
      type: 'component',
      componentName,
      properties: {},
      children: [],
      template: componentTemplate,
      metadata: {
        line: lineNumber,
        file: fileName,
        indent: lineIndent
      }
    };

    // Mesmo fluxo de aninhamento que blocos normais
    while (contextStack.length > 0 && lineIndent <= contextStack[contextStack.length - 1].indentLevel) {
      contextStack.pop();
    }

    if (contextStack.length > 0) {
      contextStack[contextStack.length - 1].block.children.push(componentBlock);
    } else {
      blocks.push(componentBlock);
    }

    contextStack.push({
      block: componentBlock,
      indentLevel: lineIndent
    });
  }

  _parseProperty(line, lineIndent, lineNumber, contextStack, fileName) {
    const currentContext = contextStack[contextStack.length - 1];
    
    if (lineIndent <= currentContext.indentLevel) {
      throw new Error('Propriedade deve estar mais indentada que seu bloco pai');
    }

    if (!line.includes(':')) {
      throw new Error('Propriedade deve conter ":"');
    }

    const [key, ...valueParts] = line.trim().split(':');
    const trimmedKey = key.trim();
    
    if (!trimmedKey) {
      throw new Error('Chave de propriedade vazia');
    }

    let value = valueParts.join(':').trim();
    
    // Remove aspas externas se presentes
    if ((value.startsWith('"') && value.endsWith('"')) || 
        (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    // Validação de propriedades críticas
    this._validateProperty(trimmedKey, value, currentContext.block, lineNumber, fileName);

    currentContext.block.properties[trimmedKey] = value;
  }

  _validateProperty(key, value, block, lineNumber, fileName) {
    const validations = {
      'bind': (v) => {
        if (!v.includes('|') && !v.match(/^[a-zA-Z_][a-zA-Z0-9_.]*$/)) {
          throw new Error(`Propriedade 'bind' inválida: ${v}`);
        }
      },
      'on': (v) => {
        if (!v.match(/^[a-zA-Z]+\s*:\s*[a-zA-Z_][a-zA-Z0-9_]*(\([^)]*\))?(\s*;\s*[a-zA-Z]+\s*:\s*[a-zA-Z_][a-zA-Z0-9_]*(\([^)]*\))?)*$/)) {
          throw new Error(`Propriedade 'on' com sintaxe inválida: ${v}`);
        }
      },
      'when': (v) => {
        // Validação básica de expressão
        if (v.includes('eval') || v.includes('function') || v.includes('=>')) {
          throw new Error(`Propriedade 'when' contém código perigoso: ${v}`);
        }
      }
    };

    if (validations[key]) {
      try {
        validations[key](value);
      } catch (error) {
        throw new Error(`${error.message} (linha ${lineNumber})`);
      }
    }
  }

  _validateAST(blocks, fileName) {
    // Validações globais da AST
    this._checkForCircularReferences(blocks);
    this._validateComponentUsage(blocks);
  }

  _checkForCircularReferences(blocks, visited = new Set()) {
    blocks.forEach(block => {
      if (block.type === 'component') {
        if (visited.has(block.componentName)) {
          this.parseErrors.push({
            message: `Referência circular detectada no componente: ${block.componentName}`,
            file: block.metadata.file,
            line: block.metadata.line
          });
          return;
        }
        
        visited.add(block.componentName);
        if (block.template && block.template.blocks) {
          this._checkForCircularReferences(block.template.blocks, new Set(visited));
        }
        visited.delete(block.componentName);
      }
      
      if (block.children) {
        this._checkForCircularReferences(block.children, visited);
      }
    });
  }

  _validateComponentUsage(blocks) {
    blocks.forEach(block => {
      if (block.type === 'component' && !this.componentRegistry.has(block.componentName)) {
        this.parseErrors.push({
          message: `Componente não registrado: ${block.componentName}`,
          file: block.metadata.file,
          line: block.metadata.line
        });
      }
      
      if (block.children) {
        this._validateComponentUsage(block.children);
      }
    });
  }

  _countComponents(blocks) {
    let count = 0;
    blocks.forEach(block => {
      if (block.type === 'component') count++;
      if (block.children) count += this._countComponents(block.children);
    });
    return count;
  }

  /**
   * Registra um componente reutilizável
   * @param {string} name - Nome do componente
   * @param {Object} template - Template AST do componente
   */
  registerComponent(name, template) {
    this.componentRegistry.set(name, template);
  }

  /**
   * Obtém erros de parsing formatados
   * @returns {string} Relatório de erros
   */
  getErrorReport() {
    if (this.parseErrors.length === 0) return 'Nenhum erro encontrado.';
    
    return this.parseErrors.map(error => 
      `${error.file}:${error.line} - ${error.message}`
    ).join('\n');
  }
}