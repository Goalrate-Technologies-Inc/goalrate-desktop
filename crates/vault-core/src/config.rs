//! Vault configuration types

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};

use crate::VaultType;

/// Integration configuration stored per vault
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationConfig {
    pub provider: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub access_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_token: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub token_expires_at: Option<DateTime<Utc>>,
    #[serde(default)]
    pub scopes: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub metadata: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub connected_at: Option<DateTime<Utc>>,
}

/// Vault configuration stored in .vault.json
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultConfig {
    /// Unique vault identifier
    pub id: String,

    /// Human-readable vault name
    pub name: String,

    /// Absolute path to the vault directory
    pub path: String,

    /// Vault type (private, public, team)
    #[serde(rename = "type")]
    pub vault_type: VaultType,

    /// When the vault was created
    pub created: DateTime<Utc>,

    /// When the vault was last opened
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_opened: Option<DateTime<Utc>>,

    /// Whether cloud sync is enabled
    #[serde(default)]
    pub sync_enabled: bool,

    /// Last sync timestamp
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sync_last_at: Option<DateTime<Utc>>,

    /// Remote vault ID (for synced vaults)
    #[serde(skip_serializing_if = "Option::is_none")]
    pub remote_id: Option<String>,

    /// Schema version for migration support
    #[serde(default = "default_schema_version")]
    pub schema_version: u32,

    /// Integration connections stored locally in the vault
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub integrations: Vec<IntegrationConfig>,
}

fn default_schema_version() -> u32 {
    1
}

impl VaultConfig {
    /// Create a new vault configuration
    pub fn new(name: impl Into<String>, path: impl Into<String>, vault_type: VaultType) -> Self {
        Self {
            id: format!("vault_{}", uuid::Uuid::new_v4()),
            name: name.into(),
            path: path.into(),
            vault_type,
            created: Utc::now(),
            last_opened: None,
            sync_enabled: false,
            sync_last_at: None,
            remote_id: None,
            schema_version: 1,
            integrations: Vec::new(),
        }
    }

    /// Update the last opened timestamp
    pub fn touch(&mut self) {
        self.last_opened = Some(Utc::now());
    }

    /// Enable sync with a remote ID
    pub fn enable_sync(&mut self, remote_id: String) {
        self.sync_enabled = true;
        self.remote_id = Some(remote_id);
    }

    /// Record a sync
    pub fn record_sync(&mut self) {
        self.sync_last_at = Some(Utc::now());
    }

    /// Check if sync is configured
    pub fn is_synced(&self) -> bool {
        self.sync_enabled && self.remote_id.is_some()
    }
}

/// Vault list item for display (lightweight version of VaultConfig)
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultListItem {
    pub id: String,
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub vault_type: VaultType,
    pub last_opened: Option<DateTime<Utc>>,
    pub sync_enabled: bool,
}

impl From<VaultConfig> for VaultListItem {
    fn from(config: VaultConfig) -> Self {
        Self {
            id: config.id,
            name: config.name,
            path: config.path,
            vault_type: config.vault_type,
            last_opened: config.last_opened,
            sync_enabled: config.sync_enabled,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_new_config() {
        let config = VaultConfig::new("Test Vault", "/path/to/vault", VaultType::Private);

        assert!(config.id.starts_with("vault_"));
        assert_eq!(config.name, "Test Vault");
        assert_eq!(config.path, "/path/to/vault");
        assert_eq!(config.vault_type, VaultType::Private);
        assert!(!config.sync_enabled);
        assert!(config.last_opened.is_none());
    }

    #[test]
    fn test_touch() {
        let mut config = VaultConfig::new("Test", "/test", VaultType::Private);
        assert!(config.last_opened.is_none());

        config.touch();
        assert!(config.last_opened.is_some());
    }

    #[test]
    fn test_enable_sync() {
        let mut config = VaultConfig::new("Test", "/test", VaultType::Public);
        assert!(!config.is_synced());

        config.enable_sync("remote_123".to_string());
        assert!(config.is_synced());
        assert_eq!(config.remote_id, Some("remote_123".to_string()));
    }

    #[test]
    fn test_serialization() {
        let config = VaultConfig::new("Test", "/test", VaultType::Team);
        let json = serde_json::to_string(&config).unwrap();

        assert!(json.contains("\"type\":\"team\""));
        assert!(json.contains("\"name\":\"Test\""));

        let parsed: VaultConfig = serde_json::from_str(&json).unwrap();
        assert_eq!(parsed.name, config.name);
        assert_eq!(parsed.vault_type, VaultType::Team);
    }
}
