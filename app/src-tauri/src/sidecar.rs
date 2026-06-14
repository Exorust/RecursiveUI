use serde_json::Value;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, oneshot, Mutex};

#[derive(Clone)]
pub struct SidecarHandle {
    tx: mpsc::Sender<(u64, Value, oneshot::Sender<Value>)>,
    next_req_id: Arc<AtomicU64>,
}

/// Stamp an outbound message with its request id so the sidecar can echo it
/// back for correlation. Pure for testability.
fn attach_req_id(msg: &mut Value, req_id: u64) {
    if let Some(obj) = msg.as_object_mut() {
        obj.insert("reqId".to_string(), serde_json::json!(req_id));
    }
}

/// Pull the request id off a sidecar response. None when absent/non-numeric.
fn extract_req_id(value: &Value) -> Option<u64> {
    value.get("reqId").and_then(|v| v.as_u64())
}

impl SidecarHandle {
    pub async fn send(&self, mut msg: Value) -> Result<Value, String> {
        let req_id = self.next_req_id.fetch_add(1, Ordering::Relaxed);
        attach_req_id(&mut msg, req_id);
        let (resp_tx, resp_rx) = oneshot::channel();
        self.tx
            .send((req_id, msg, resp_tx))
            .await
            .map_err(|_| "sidecar channel closed".to_string())?;
        resp_rx.await.map_err(|_| "sidecar response dropped".to_string())
    }
}

pub async fn boot_sidecar(app: &AppHandle) -> Result<SidecarHandle, String> {
    let sidecar_dir = std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .ok_or("no parent dir")?
        .join("../../../sidecar");

    // In dev mode, the sidecar is relative to the project
    let sidecar_dir = if sidecar_dir.join("index.ts").exists() {
        sidecar_dir
    } else {
        // Fall back to the app directory structure
        let manifest_dir = std::env!("CARGO_MANIFEST_DIR");
        std::path::PathBuf::from(manifest_dir).join("../sidecar")
    };

    let sidecar_entry = sidecar_dir.join("index.ts");
    if !sidecar_entry.exists() {
        return Err(format!("sidecar not found at {:?}", sidecar_entry));
    }

    let mut child = Command::new("bun")
        .arg("run")
        .arg(&sidecar_entry)
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::inherit())
        .spawn()
        .map_err(|e| format!("failed to spawn bun: {}", e))?;

    let stdin = child.stdin.take().ok_or("no stdin")?;
    let stdout = child.stdout.take().ok_or("no stdout")?;

    let stdin = Arc::new(Mutex::new(stdin));
    let (tx, mut rx) = mpsc::channel::<(u64, Value, oneshot::Sender<Value>)>(64);

    let app_handle = app.clone();

    // Reader task: forwards sidecar events to the frontend
    let reader_stdin = stdin.clone();
    tokio::spawn(async move {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        // Responses are matched by reqId: long-running calls (UI generation)
        // overlap short ones, so ordering can't be assumed.
        let mut pending_responses: HashMap<u64, oneshot::Sender<Value>> = HashMap::new();

        loop {
            tokio::select! {
                // Receive outbound messages to send to sidecar
                msg = rx.recv() => {
                    match msg {
                        Some((req_id, value, resp_tx)) => {
                            let mut json_str = serde_json::to_string(&value).unwrap();
                            json_str.push('\n');
                            let mut stdin = reader_stdin.lock().await;
                            if let Err(e) = stdin.write_all(json_str.as_bytes()).await {
                                eprintln!("[recursiveui] write to sidecar failed: {}", e);
                                let _ = resp_tx.send(serde_json::json!({"error": e.to_string()}));
                                continue;
                            }
                            let _ = stdin.flush().await;
                            pending_responses.insert(req_id, resp_tx);
                        }
                        None => break,
                    }
                }
                // Read responses/events from sidecar
                result = reader.read_line(&mut line) => {
                    match result {
                        Ok(0) => {
                            eprintln!("[recursiveui] sidecar stdout closed");
                            break;
                        }
                        Ok(_) => {
                            if let Ok(value) = serde_json::from_str::<Value>(&line) {
                                let msg_type = value.get("type").and_then(|v| v.as_str()).unwrap_or("");
                                match msg_type {
                                    "response" => {
                                        let req_id = extract_req_id(&value);
                                        match req_id.and_then(|id| pending_responses.remove(&id)) {
                                            Some(resp_tx) => {
                                                let _ = resp_tx.send(value);
                                            }
                                            None => {
                                                eprintln!("[recursiveui] response with unknown reqId: {:?}", req_id);
                                            }
                                        }
                                    }
                                    "skill-event" => {
                                        let _ = app_handle.emit("skill-event", &value);
                                    }
                                    _ => {
                                        eprintln!("[recursiveui] unknown sidecar msg: {}", msg_type);
                                    }
                                }
                            }
                            line.clear();
                        }
                        Err(e) => {
                            eprintln!("[recursiveui] read from sidecar failed: {}", e);
                            break;
                        }
                    }
                }
            }
        }
    });

    Ok(SidecarHandle {
        tx,
        next_req_id: Arc::new(AtomicU64::new(1)),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::collections::HashMap;

    #[test]
    fn attach_req_id_stamps_object() {
        let mut msg = json!({ "type": "scorecard", "skillId": "x" });
        attach_req_id(&mut msg, 42);
        assert_eq!(msg.get("reqId").and_then(|v| v.as_u64()), Some(42));
        // existing fields preserved
        assert_eq!(msg.get("type").unwrap(), "scorecard");
    }

    #[test]
    fn attach_req_id_noop_on_non_object() {
        let mut msg = json!("not an object");
        attach_req_id(&mut msg, 1); // must not panic
        assert!(msg.get("reqId").is_none());
    }

    #[test]
    fn extract_req_id_handles_present_missing_and_nonnumeric() {
        assert_eq!(extract_req_id(&json!({ "reqId": 7, "ok": true })), Some(7));
        assert_eq!(extract_req_id(&json!({ "ok": true })), None);
        assert_eq!(extract_req_id(&json!({ "reqId": "7" })), None);
        assert_eq!(extract_req_id(&json!({ "reqId": -3 })), None);
    }

    // The bug reqId exists to prevent: a slow response (UI generation) and a
    // fast one (chat invoke) overlap, so responses must be matched by id, not
    // arrival order. This proves out-of-order delivery reaches the right waiter.
    #[tokio::test]
    async fn responses_correlate_out_of_order() {
        let mut pending: HashMap<u64, oneshot::Sender<Value>> = HashMap::new();
        let (tx1, rx1) = oneshot::channel::<Value>();
        let (tx2, rx2) = oneshot::channel::<Value>();
        pending.insert(1, tx1);
        pending.insert(2, tx2);

        // Response for the LATER request (2) arrives FIRST.
        let resp2 = json!({ "type": "response", "reqId": 2, "tag": "second" });
        let id2 = extract_req_id(&resp2).unwrap();
        pending.remove(&id2).unwrap().send(resp2).unwrap();

        let resp1 = json!({ "type": "response", "reqId": 1, "tag": "first" });
        let id1 = extract_req_id(&resp1).unwrap();
        pending.remove(&id1).unwrap().send(resp1).unwrap();

        assert_eq!(rx1.await.unwrap().get("tag").unwrap(), "first");
        assert_eq!(rx2.await.unwrap().get("tag").unwrap(), "second");
        assert!(pending.is_empty());
    }
}
