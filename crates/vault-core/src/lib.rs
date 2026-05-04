//! vault-core - Core vault operations for Goalrate
//!
//! This crate provides the foundational vault management functionality
//! for the Goalrate desktop application, including:
//! - Vault creation, opening, and closing
//! - File system watching for external changes
//! - Configuration management
//! - Goal, Agenda, Memory, and audit-log file operations
//!
//! # Vault Structure
//!
//! ```text
//! ~/Goalrate/MyVault/
//! ├── .vault.json                   # Vault configuration
//! ├── .goalrate/                    # Local app data
//! │   └── index.db                  # SQLite index
//! ├── domains/                      # Reserved domain metadata
//! ├── goals/                        # Goal markdown files
//! │   └── [goal-id].md             # Goal definition + milestones
//! ├── tasks/                        # Reserved compatibility folder
//! ├── agenda/                       # Daily agenda markdown files
//! │   └── 2026-01-17.md
//! ├── logs/                         # User-readable logs
//! │   └── errors.md
//! ├── system/                       # User-readable audit metadata
//! │   ├── mutations.md
//! │   └── snapshots/
//! ├── memory.md                     # Persistent planning memory
//! ├── eisenhower-matrix.md          # Prioritization notes
//! └── focus/                        # Daily focus files
//!     └── 2026-01-17.md
//! ```
//!
//! # Example
//!
//! ```no_run
//! use vault_core::{VaultManager, VaultType};
//!
//! // Create a new vault
//! let manager = VaultManager::create("My Vault", "/path/to/vault", VaultType::Private).unwrap();
//!
//! // Open an existing vault
//! let manager = VaultManager::open("/path/to/vault").unwrap();
//! let config = manager.config();
//! println!("Vault: {}", config.name);
//! ```

pub mod config;
pub mod error;
pub mod vault;
pub mod watcher;

pub use config::VaultConfig;
pub use error::{VaultError, VaultResult};
pub use vault::{
    SnapshotHistoryEntry, SnapshotPreview, SnapshotRestoreResult, VaultErrorLogEntry, VaultManager,
    VaultStructure,
};
pub use watcher::{VaultEvent, VaultWatcher};

/// Vault type determines sync and visibility behavior
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum VaultType {
    /// Private vault - local only, no sync
    #[default]
    Private,
    /// Public vault - synced, visible on profile
    Public,
    /// Team vault - synced, shared with team members
    Team,
}

impl std::fmt::Display for VaultType {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Private => write!(f, "private"),
            Self::Public => write!(f, "public"),
            Self::Team => write!(f, "team"),
        }
    }
}

impl std::str::FromStr for VaultType {
    type Err = VaultError;

    fn from_str(s: &str) -> Result<Self, Self::Err> {
        match s.to_lowercase().as_str() {
            "private" => Ok(Self::Private),
            "public" => Ok(Self::Public),
            "team" => Ok(Self::Team),
            _ => Err(VaultError::InvalidVaultType(s.to_string())),
        }
    }
}
