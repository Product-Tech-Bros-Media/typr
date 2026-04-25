use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

pub const MAX_ENTRIES: usize = 100;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct HistoryEntry {
    pub id: u64,
    pub text: String,
    #[serde(rename = "timestamp_ms")]
    pub timestamp_ms: u64,
}

pub fn history_path(app_dir: &PathBuf) -> PathBuf {
    app_dir.join("history.json")
}

pub fn load(app_dir: &PathBuf) -> Vec<HistoryEntry> {
    let path = history_path(app_dir);
    match fs::read_to_string(&path) {
        Ok(contents) => serde_json::from_str(&contents).unwrap_or_default(),
        Err(_) => Vec::new(),
    }
}

pub fn save(app_dir: &PathBuf, entries: &Vec<HistoryEntry>) -> Result<(), String> {
    let path = history_path(app_dir);
    fs::create_dir_all(app_dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_string_pretty(entries).map_err(|e| e.to_string())?;
    fs::write(&path, json).map_err(|e| e.to_string())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

pub fn append(app_dir: &PathBuf, text: &str) -> Vec<HistoryEntry> {
    let mut entries = load(app_dir);
    let ts = now_ms();
    entries.push(HistoryEntry {
        id: ts,
        text: text.to_string(),
        timestamp_ms: ts,
    });
    while entries.len() > MAX_ENTRIES {
        entries.remove(0);
    }
    let _ = save(app_dir, &entries);
    entries
}

pub fn delete(app_dir: &PathBuf, id: u64) -> Vec<HistoryEntry> {
    let mut entries = load(app_dir);
    entries.retain(|e| e.id != id);
    let _ = save(app_dir, &entries);
    entries
}

pub fn clear(app_dir: &PathBuf) -> Result<(), String> {
    save(app_dir, &Vec::new())
}

pub fn prune_expired(app_dir: &PathBuf, ttl_secs: u64) -> Vec<HistoryEntry> {
    let entries = load(app_dir);
    let cutoff = now_ms().saturating_sub(ttl_secs.saturating_mul(1000));
    let original_len = entries.len();
    let pruned: Vec<HistoryEntry> = entries
        .into_iter()
        .filter(|e| e.timestamp_ms >= cutoff)
        .collect();
    if pruned.len() != original_len {
        let _ = save(app_dir, &pruned);
    }
    pruned
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::env::temp_dir;

    #[test]
    fn test_append_and_load() {
        let dir = temp_dir().join("typr_test_history_append");
        let _ = fs::remove_dir_all(&dir);

        let entries = append(&dir, "hello");
        assert_eq!(entries.len(), 1);
        assert_eq!(entries[0].text, "hello");

        let loaded = load(&dir);
        assert_eq!(loaded.len(), 1);
        assert_eq!(loaded[0].text, "hello");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_append_prunes_to_cap() {
        let dir = temp_dir().join("typr_test_history_prune");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let mut entries: Vec<HistoryEntry> = (0..MAX_ENTRIES as u64)
            .map(|i| HistoryEntry {
                id: i,
                text: format!("entry-{}", i),
                timestamp_ms: i,
            })
            .collect();
        save(&dir, &entries).unwrap();

        entries = append(&dir, "newest");
        assert_eq!(entries.len(), MAX_ENTRIES);
        assert_eq!(entries.last().unwrap().text, "newest");
        // Oldest pruned from the front
        assert_eq!(entries[0].text, "entry-1");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_delete_by_id() {
        let dir = temp_dir().join("typr_test_history_delete");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let entries = vec![
            HistoryEntry { id: 1, text: "a".into(), timestamp_ms: 1 },
            HistoryEntry { id: 2, text: "b".into(), timestamp_ms: 2 },
            HistoryEntry { id: 3, text: "c".into(), timestamp_ms: 3 },
        ];
        save(&dir, &entries).unwrap();

        let result = delete(&dir, 2);
        assert_eq!(result.len(), 2);
        assert!(result.iter().all(|e| e.id != 2));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_clear() {
        let dir = temp_dir().join("typr_test_history_clear");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let entries = vec![HistoryEntry { id: 1, text: "a".into(), timestamp_ms: 1 }];
        save(&dir, &entries).unwrap();

        clear(&dir).unwrap();
        assert!(load(&dir).is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_load_corrupt_returns_empty() {
        let dir = temp_dir().join("typr_test_history_corrupt");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(history_path(&dir), "not json").unwrap();

        assert!(load(&dir).is_empty());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_load_missing_returns_empty() {
        let dir = temp_dir().join("typr_test_history_missing");
        let _ = fs::remove_dir_all(&dir);
        assert!(load(&dir).is_empty());
    }

    #[test]
    fn test_prune_expired() {
        let dir = temp_dir().join("typr_test_history_prune_ttl");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let now = now_ms();
        let entries = vec![
            HistoryEntry { id: 1, text: "old".into(), timestamp_ms: now - 10_000 },
            HistoryEntry { id: 2, text: "fresh".into(), timestamp_ms: now - 1_000 },
        ];
        save(&dir, &entries).unwrap();

        // 5-second TTL: only "fresh" survives
        let result = prune_expired(&dir, 5);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].text, "fresh");

        // Persisted
        let loaded = load(&dir);
        assert_eq!(loaded.len(), 1);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_prune_no_op_when_all_fresh() {
        let dir = temp_dir().join("typr_test_history_prune_noop");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let now = now_ms();
        let entries = vec![
            HistoryEntry { id: 1, text: "a".into(), timestamp_ms: now - 1_000 },
        ];
        save(&dir, &entries).unwrap();

        let result = prune_expired(&dir, 3600);
        assert_eq!(result.len(), 1);

        let _ = fs::remove_dir_all(&dir);
    }
}
