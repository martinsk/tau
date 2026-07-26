use std::collections::HashMap;

pub type Metadata = HashMap<String, String>;

#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct ProjectId(pub u64);

#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct ContainerId(pub u64);

#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct ItemId(pub u64);

#[derive(Clone, Copy, Debug, Default, Eq, Hash, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct ReferenceId(pub u64);

#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case", tag = "type", content = "value")]
pub enum Content {
    InlineText(String),
    InlineBytes(Vec<u8>),
    External(String),
}

#[derive(Clone, Debug, Eq, Hash, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemKind {
    Text,
    Markdown,
    Rust,
    Json,
    Binary,
    Unknown,
    Custom(String),
}

#[derive(Clone, Debug, Eq, Hash, PartialEq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ReferenceKind {
    Uses,
    Includes,
    Extends,
    DependsOn,
    Custom(String),
}

#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct Item {
    pub id: ItemId,
    pub name: String,
    pub kind: ItemKind,
    pub content: Content,
    pub metadata: Metadata,
}

#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct Container {
    pub id: ContainerId,
    pub name: String,
    pub metadata: Metadata,
    pub containers: Vec<ContainerId>,
    pub items: Vec<ItemId>,
}

#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct Reference {
    pub id: ReferenceId,
    pub source: ItemId,
    pub target: ItemId,
    pub kind: ReferenceKind,
    pub anchor: Option<String>,
}

#[derive(Clone, Debug, PartialEq, serde::Deserialize, serde::Serialize)]
pub struct Project {
    pub id: ProjectId,
    pub name: String,
    pub root: ContainerId,
    pub containers: HashMap<ContainerId, Container>,
    pub items: HashMap<ItemId, Item>,
    pub references: HashMap<ReferenceId, Reference>,
    pub metadata: Metadata,
}

impl Project {
    pub fn new(id: ProjectId, name: impl Into<String>, root: ContainerId) -> Self {
        let mut containers = HashMap::new();
        containers.insert(
            root,
            Container {
                id: root,
                name: "root".into(),
                metadata: Metadata::new(),
                containers: Vec::new(),
                items: Vec::new(),
            },
        );
        Self {
            id,
            name: name.into(),
            root,
            containers,
            items: HashMap::new(),
            references: HashMap::new(),
            metadata: Metadata::new(),
        }
    }
}

pub mod builder;
pub mod query;
pub mod validate;

pub use builder::{Draft, ProjectBuilder, Validated};

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn can_build_minimal_project() {
        let project = Project::new(ProjectId(1), "test", ContainerId(10));
        assert_eq!(project.id, ProjectId(1));
        assert_eq!(project.name, "test");
        assert_eq!(project.root, ContainerId(10));
        assert!(project.containers.contains_key(&ContainerId(10)));
    }

    #[test]
    fn serialization_roundtrip() {
        let mut project = Project::new(ProjectId(1), "test", ContainerId(10));
        let item = Item {
            id: ItemId(20),
            name: "main.rs".into(),
            kind: ItemKind::Rust,
            content: Content::InlineText("fn main() {}".into()),
            metadata: Metadata::new(),
        };
        project.items.insert(item.id, item.clone());
        project
            .containers
            .get_mut(&ContainerId(10))
            .unwrap()
            .items
            .push(ItemId(20));

        let serialized = serde_json::to_string(&project).unwrap();
        let deserialized: Project = serde_json::from_str(&serialized).unwrap();
        assert_eq!(project, deserialized);
    }

    #[test]
    fn custom_item_kind_roundtrips() {
        let kind = ItemKind::Custom("shader".into());
        let serialized = serde_json::to_string(&kind).unwrap();
        let deserialized: ItemKind = serde_json::from_str(&serialized).unwrap();
        assert_eq!(kind, deserialized);
    }
}
