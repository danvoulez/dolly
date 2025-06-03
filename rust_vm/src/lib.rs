// rust_vm/src/lib.rs
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;
use serde_json::{Value, json};
use uuid::Uuid;
use chrono::Utc;
use std::collections::HashMap;
use js_sys::Promise;

// Importações para interação com JavaScript
#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
    #[wasm_bindgen(js_namespace = console)]
    fn warn(s: &str);
    #[wasm_bindgen(js_namespace = console)]
    fn error(s: &str);
    
    // Funções de IndexedDB bridge
    #[wasm_bindgen(js_namespace = window, js_name = idb_add_span)]
    fn js_idb_add_span(span_json: &str) -> Promise;
    
    #[wasm_bindgen(js_namespace = window, js_name = idb_get_spans)]
    fn js_idb_get_spans(session_id: &str, options_json: &str) -> Promise;
    
    #[wasm_bindgen(js_namespace = window, js_name = idb_save_session)]
    fn js_idb_save_session(session_json: &str) -> Promise;
    
    #[wasm_bindgen(js_namespace = window, js_name = idb_save_contract)]
    fn js_idb_save_contract(contract_json: &str) -> Promise;
}

// Estado global (ainda em memória para fallback)
thread_local! {
    static SESSIONS: std::cell::RefCell<HashMap<String, SessionData>> =
        std::cell::RefCell::new(HashMap::new());
}

#[derive(Clone)]
struct SessionData {
    id: String,
    spans: Vec<Value>,
    created_at: String,
    last_activity: String,
}

impl SessionData {
    fn new(id: String) -> Self {
        let now = Utc::now().to_rfc3339();
        Self {
            id,
            spans: Vec::new(),
            created_at: now.clone(),
            last_activity: now,
        }
    }
    
    fn update_activity(&mut self) {
        self.last_activity = Utc::now().to_rfc3339();
    }
}

#[wasm_bindgen]
pub async fn wasm_init_session() -> Result<String, JsValue> {
    let session_id = Uuid::new_v4().to_string();
    let session_data = SessionData::new(session_id.clone());
    
    // Armazena em memória como fallback
    SESSIONS.with(|s| {
        s.borrow_mut().insert(session_id.clone(), session_data.clone());
    });
    
    // Tenta persistir no IndexedDB
    let session_json = json!({
        "id": session_id,
        "created_at": session_data.created_at,
        "last_activity": session_data.last_activity,
        "spans_count": 0
    });
    
    match JsFuture::from(js_idb_save_session(&session_json.to_string())).await {
        Ok(_) => {
            log(&format!("[WASM] Sessão {} criada e persistida", session_id));
        }
        Err(e) => {
            warn(&format!("[WASM] Falha ao persistir sessão, usando fallback em memória: {:?}", e));
        }
    }
    
    Ok(session_id)
}

#[wasm_bindgen]
pub async fn wasm_get_spans(session_id: &str, options_json: Option<String>) -> Result<String, JsValue> {
    let options = options_json.unwrap_or_else(|| "{}".to_string());
    
    // Primeiro tenta IndexedDB
    match JsFuture::from(js_idb_get_spans(session_id, &options)).await {
        Ok(spans_js) => {
            if let Some(spans_str) = spans_js.as_string() {
                log(&format!("[WASM] Spans recuperados do IndexedDB para sessão {}", session_id));
                return Ok(spans_str);
            }
        }
        Err(e) => {
            warn(&format!("[WASM] Falha ao recuperar do IndexedDB: {:?}", e));
        }
    }
    
    // Fallback para memória
    SESSIONS.with(|s| {
        let sessions = s.borrow();
        match sessions.get(session_id) {
            Some(session_data) => {
                log(&format!("[WASM] Spans recuperados da memória para sessão {}", session_id));
                Ok(serde_json::to_string(&session_data.spans).unwrap_or_else(|_| "[]".to_string()))
            }
            None => {
                warn(&format!("[WASM] Sessão não encontrada: {}", session_id));
                Ok("[]".to_string())
            }
        }
    })
}

#[wasm_bindgen]
pub async fn wasm_process_prompt(session_id: &str, prompt: &str) -> Result<String, JsValue> {
    // Atualiza atividade da sessão
    SESSIONS.with(|s| {
        if let Some(session_data) = s.borrow_mut().get_mut(session_id) {
            session_data.update_activity();
        }
    });
    
    // LLM simulado aprimorado
    let response_text = generate_llm_response(prompt);
    
    let span = json!({
        "id": Uuid::new_v4().to_string(),
        "timestamp": Utc::now().to_rfc3339(),
        "type": "llm_response",
        "content": response_text,
        "session_id": session_id,
        "prompt": prompt,
        "model": "flipapp-sim-v1",
        "cost_usd": calculate_cost(prompt, &response_text),
        "tokens_input": estimate_tokens(prompt),
        "tokens_output": estimate_tokens(&response_text),
        "processing_time_ms": simulate_processing_time(prompt)
    });
    
    // Adiciona à memória
    SESSIONS.with(|s| {
        if let Some(session_data) = s.borrow_mut().get_mut(session_id) {
            session_data.spans.push(span.clone());
        }
    });
    
    // Persiste no IndexedDB
    match JsFuture::from(js_idb_add_span(&span.to_string())).await {
        Ok(_) => {
            log(&format!("[WASM] Span LLM persistido para sessão {}", session_id));
        }
        Err(e) => {
            warn(&format!("[WASM] Falha ao persistir span: {:?}", e));
        }
    }
    
    Ok(response_text)
}

#[wasm_bindgen]
pub async fn wasm_commit_contract(contract_yaml: &str) -> Result<String, JsValue> {
    let contract_id = Uuid::new_v4().to_string();
    let timestamp = Utc::now().to_rfc3339();
    
    // Simula validação e processamento
    let validation_result = validate_contract_yaml(contract_yaml);
    
    let response = if validation_result.is_valid {
        json!({
            "status": "ok",
            "span_id": contract_id,
            "timestamp": timestamp,
            "message": "Contrato processado com sucesso",
            "validation": validation_result.details,
            "estimated_execution": "2-3 business days"
        })
    } else {
        json!({
            "status": "error",
            "span_id": contract_id,
            "timestamp": timestamp,
            "message": "Falha na validação do contrato",
            "errors": validation_result.errors
        })
    };
    
    // Cria span para auditoria
    let audit_span = json!({
        "id": contract_id,
        "timestamp": timestamp,
        "type": "contract_commit",
        "contract_yaml": contract_yaml,
        "status": response["status"],
        "validation_details": validation_result.details,
        "processing_node": "wasm-simulator"
    });
    
    // Persiste contrato no IndexedDB
    match JsFuture::from(js_idb_save_contract(&audit_span.to_string())).await {
        Ok(_) => {
            log(&format!("[WASM] Contrato {} persistido", contract_id));
        }
        Err(e) => {
            warn(&format!("[WASM] Falha ao persistir contrato: {:?}", e));
        }
    }
    
    Ok(response.to_string())
}

#[wasm_bindgen]
pub async fn wasm_clear_session(session_id: &str) -> Result<(), JsValue> {
    // Remove da memória
    let removed = SESSIONS.with(|s| {
        s.borrow_mut().remove(session_id).is_some()
    });
    
    if removed {
        log(&format!("[WASM] Sessão {} removida da memória", session_id));
    } else {
        warn(&format!("[WASM] Sessão {} não encontrada na memória", session_id));
    }
    
    // TODO: Implementar limpeza no IndexedDB se necessário
    // (normalmente sessions não são deletadas, apenas expiram)
    
    Ok(())
}

#[wasm_bindgen]
pub fn wasm_get_session_stats(session_id: &str) -> String {
    SESSIONS.with(|s| {
        let sessions = s.borrow();
        match sessions.get(session_id) {
            Some(session_data) => {
                let stats = json!({
                    "session_id": session_id,
                    "created_at": session_data.created_at,
                    "last_activity": session_data.last_activity,
                    "total_spans": session_data.spans.len(),
                    "span_types": count_span_types(&session_data.spans),
                    "memory_usage_kb": estimate_memory_usage(&session_data.spans)
                });
                stats.to_string()
            }
            None => {
                json!({ "error": "Sessão não encontrada" }).to_string()
            }
        }
    })
}

// Funções auxiliares
fn generate_llm_response(prompt: &str) -> String {
    let prompt_lower = prompt.to_lowercase();
    
    if prompt_lower.contains("olá") || prompt_lower.contains("oi") {
        "Olá! Como posso ajudar você hoje no FlipApp?"
    } else if prompt_lower.contains("clima") {
        "O clima hoje está ensolarado com 25°C. Perfeito para usar o FlipApp ao ar livre!"
    } else if prompt_lower.contains("data") || prompt_lower.contains("hoje") {
        &format!("Hoje é {}. Posso ajudar com mais alguma informação?", 
                Utc::now().format("%d/%m/%Y"))
    } else if prompt_lower.contains("flipapp") {
        "O FlipApp é uma plataforma conversacional inovadora com UI declarativa e processamento WASM. Como posso ajudar você a explorá-lo?"
    } else if prompt_lower.contains("ajuda") || prompt_lower.contains("help") {
        "Estou aqui para ajudar! Posso responder perguntas sobre:\n- Funcionalidades do FlipApp\n- Informações gerais\n- Clima e data\n- E muito mais!"
    } else if prompt_lower.contains("contratos") || prompt_lower.contains("contrato") {
        "Os contratos no FlipApp são unidades de lógica de negócio que podem ser executadas de forma auditável. Quer saber mais sobre algum contrato específico?"
    } else if prompt_lower.len() < 5 {
        "Poderia elaborar um pouco mais? Estou aqui para ajudar!"
    } else {
        &format!("Entendi sua pergunta sobre '{}'. Esta é uma resposta simulada do processamento WASM local. Em produção, isso seria processado por um LLM real.", 
                prompt.chars().take(50).collect::<String>())
    }
    .to_string()
}

fn calculate_cost(prompt: &str, response: &str) -> f64 {
    let input_tokens = estimate_tokens(prompt);
    let output_tokens = estimate_tokens(response);
    
    // Simula custo baseado em tokens (similar ao GPT-4)
    let input_cost = input_tokens as f64 * 0.00003; // $0.03 per 1K tokens
    let output_cost = output_tokens as f64 * 0.00006; // $0.06 per 1K tokens
    
    (input_cost + output_cost) * 100.0 / 100.0 // Arredonda para 2 casas decimais
}

fn estimate_tokens(text: &str) -> u32 {
    // Estimativa simplificada: ~4 caracteres por token
    (text.len() as f32 / 4.0).ceil() as u32
}

fn simulate_processing_time(prompt: &str) -> u32 {
    // Simula tempo baseado no tamanho do prompt
    let base_time = 200; // 200ms base
    let variable_time = (prompt.len() as f32 * 0.5) as u32; // 0.5ms per char
    base_time + variable_time
}

struct ValidationResult {
    is_valid: bool,
    details: Value,
    errors: Vec<String>,
}

fn validate_contract_yaml(yaml_content: &str) -> ValidationResult {
    let mut errors = Vec::new();
    let mut details = json!({});
    
    // Validações básicas simuladas
    if yaml_content.trim().is_empty() {
        errors.push("Contrato vazio".to_string());
    }
    
    if !yaml_content.contains("type:") {
        errors.push("Tipo de contrato não especificado".to_string());
    }
    
    if yaml_content.contains("amount:") {
        // Simula validação de valor monetário
        details["has_amount"] = json!(true);
        if !yaml_content.contains("currency:") {
            errors.push("Moeda não especificada para transação monetária".to_string());
        }
    }
    
    if yaml_content.len() > 10000 {
        errors.push("Contrato muito longo".to_string());
    }
    
    // Validação de caracteres perigosos
    let dangerous_patterns = ["<script", "javascript:", "eval(", "function("];
    for pattern in &dangerous_patterns {
        if yaml_content.to_lowercase().contains(pattern) {
            errors.push(format!("Padrão potencialmente perigoso detectado: {}", pattern));
        }
    }
    
    details["validation_timestamp"] = json!(Utc::now().to_rfc3339());
    details["content_length"] = json!(yaml_content.len());
    details["estimated_complexity"] = json!(if yaml_content.len() > 500 { "high" } else { "low" });
    
    ValidationResult {
        is_valid: errors.is_empty(),
        details,
        errors,
    }
}

fn count_span_types(spans: &[Value]) -> Value {
    let mut type_counts: HashMap<String, u32> = HashMap::new();
    
    for span in spans {
        if let Some(span_type) = span.get("type").and_then(|t| t.as_str()) {
            *type_counts.entry(span_type.to_string()).or_insert(0) += 1;
        }
    }
    
    json!(type_counts)
}

fn estimate_memory_usage(spans: &[Value]) -> u32 {
    // Estimativa simples baseada no JSON serializado
    spans.iter()
        .map(|span| span.to_string().len() as u32)
        .sum::<u32>() / 1024 // Convert to KB
}

// Função de inicialização chamada quando o WASM é carregado
#[wasm_bindgen(start)]
pub fn main() {
    console_error_panic_hook::set_once();
    log("[WASM] FlipApp WASM module inicializado");
}

// Funções de utilidade expostas para JavaScript
#[wasm_bindgen]
pub fn wasm_get_version() -> String {
    "1.0.0-production".to_string()
}

#[wasm_bindgen]
pub fn wasm_health_check() -> String {
    json!({
        "status": "healthy",
        "timestamp": Utc::now().to_rfc3339(),
        "memory_sessions": SESSIONS.with(|s| s.borrow().len()),
        "version": wasm_get_version()
    }).to_string()
}