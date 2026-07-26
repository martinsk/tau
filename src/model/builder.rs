use std::marker::PhantomData;

use crate::model::{Container, ContainerId, Item, Metadata, Project, ProjectId, Reference};
use crate::model::validate::{validate, ValidationError};

/// Marker type for a [`ProjectBuilder`] that is still being edited.
#[derive(Debug, Clone, Copy)]
pub struct Draft;

/// Marker type for a [`ProjectBuilder`] that has passed validation.
#[derive(Debug, Clone, Copy)]
pub struct Validated;

/// A typestate builder for constructing a [`Project`] while preserving core
/// invariants: containers and items referenced by a parent must exist, and
/// references must point to existing items. The builder transitions from
/// [`Draft`] to [`Validated`] only when [`ProjectBuilder::build`] succeeds.
#[derive(Debug)]
pub struct ProjectBuilder<State = Draft> {
    project: Project,
    _state: PhantomData<State>,
}

impl ProjectBuilder<Draft> {
    /// Creates a new project with a single root container.
    pub fn new(id: ProjectId, name: impl Into<String>, root: ContainerId) -> Self {
        Self {
            project: Project::new(id, name, root),
            _state: PhantomData,
        }
    }

    /// Adds a container under an existing parent.
    ///
    /// Returns an error if the parent does not exist or if the container id
    /// has already been used.
    pub fn add_container(
        &mut self,
        id: ContainerId,
        name: impl Into<String>,
        parent: ContainerId,
    ) -> Result<&mut Self, ValidationError> {
        if self.project.containers.contains_key(&id) {
            return Err(ValidationError::DuplicateContainer { id });
        }
        if !self.project.containers.contains_key(&parent) {
            return Err(ValidationError::MissingContainer { id: parent });
        }
        let container = Container {
            id,
            name: name.into(),
            metadata: Metadata::new(),
            containers: Vec::new(),
            items: Vec::new(),
        };
        self.project.containers.insert(id, container);
        self.project
            .containers
            .get_mut(&parent)
            .unwrap()
            .containers
            .push(id);
        Ok(self)
    }

    /// Adds an item under an existing container.
    ///
    /// Returns an error if the parent container does not exist or if the item id
    /// has already been used.
    pub fn add_item(
        &mut self,
        item: Item,
        parent: ContainerId,
    ) -> Result<&mut Self, ValidationError> {
        if self.project.items.contains_key(&item.id) {
            return Err(ValidationError::DuplicateItem { id: item.id });
        }
        let parent_container = self
            .project
            .containers
            .get_mut(&parent)
            .ok_or(ValidationError::MissingContainer { id: parent })?;
        let item_id = item.id;
        self.project.items.insert(item_id, item);
        parent_container.items.push(item_id);
        Ok(self)
    }

    /// Adds a reference between two existing items.
    ///
    /// Returns an error if either the source or target item does not exist, or
    /// if the reference id has already been used.
    pub fn add_reference(
        &mut self,
        reference: Reference,
    ) -> Result<&mut Self, ValidationError> {
        if self.project.references.contains_key(&reference.id) {
            return Err(ValidationError::DuplicateReference { id: reference.id });
        }
        if !self.project.items.contains_key(&reference.source) {
            return Err(ValidationError::MissingItem {
                id: reference.source,
            });
        }
        if !self.project.items.contains_key(&reference.target) {
            return Err(ValidationError::MissingItem {
                id: reference.target,
            });
        }
        self.project.references.insert(reference.id, reference);
        Ok(self)
    }

    /// Validates the project and transitions the builder to the [`Validated`]
    /// state if it is correct. Otherwise returns the validation errors.
    pub fn build(self) -> Result<ProjectBuilder<Validated>, Vec<ValidationError>> {
        let errors = validate(&self.project);
        if errors.is_empty() {
            Ok(ProjectBuilder {
                project: self.project,
                _state: PhantomData,
            })
        } else {
            Err(errors)
        }
    }
}

impl ProjectBuilder<Validated> {
    /// Consumes the validated builder and returns the underlying [`Project`].
    pub fn into_project(self) -> Project {
        self.project
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Content, ItemId, ReferenceId};

    fn item(id: ItemId, name: &str) -> Item {
        Item {
            id,
            name: name.into(),
            kind: crate::model::ItemKind::Text,
            content: Content::InlineText("".into()),
            metadata: Metadata::new(),
        }
    }

    #[test]
    fn builder_creates_valid_project() {
        let mut builder = ProjectBuilder::new(ProjectId(1), "test", ContainerId(10));
        builder
            .add_container(ContainerId(20), "child", ContainerId(10))
            .unwrap()
            .add_item(item(ItemId(30), "a"), ContainerId(20))
            .unwrap()
            .add_reference(Reference {
                id: ReferenceId(1),
                source: ItemId(30),
                target: ItemId(30),
                kind: crate::model::ReferenceKind::Uses,
                anchor: None,
            })
            .unwrap();

        let project = builder.build().unwrap().into_project();
        assert_eq!(project.root, ContainerId(10));
        assert!(project.containers.contains_key(&ContainerId(20)));
        assert!(project.items.contains_key(&ItemId(30)));
    }

    #[test]
    fn builder_rejects_missing_parent_container() {
        let mut builder = ProjectBuilder::new(ProjectId(1), "test", ContainerId(10));
        let err = builder
            .add_container(ContainerId(20), "child", ContainerId(99))
            .unwrap_err();
        assert_eq!(
            err,
            ValidationError::MissingContainer {
                id: ContainerId(99)
            }
        );
    }

    #[test]
    fn builder_rejects_duplicate_container() {
        let mut builder = ProjectBuilder::new(ProjectId(1), "test", ContainerId(10));
        builder
            .add_container(ContainerId(20), "child", ContainerId(10))
            .unwrap();
        let err = builder
            .add_container(ContainerId(20), "child2", ContainerId(10))
            .unwrap_err();
        assert_eq!(
            err,
            ValidationError::DuplicateContainer {
                id: ContainerId(20)
            }
        );
    }

    #[test]
    fn builder_rejects_missing_parent_for_item() {
        let mut builder = ProjectBuilder::new(ProjectId(1), "test", ContainerId(10));
        let err = builder
            .add_item(item(ItemId(30), "a"), ContainerId(99))
            .unwrap_err();
        assert_eq!(
            err,
            ValidationError::MissingContainer {
                id: ContainerId(99)
            }
        );
    }

    #[test]
    fn builder_rejects_reference_to_missing_item() {
        let mut builder = ProjectBuilder::new(ProjectId(1), "test", ContainerId(10));
        builder.add_item(item(ItemId(30), "a"), ContainerId(10)).unwrap();
        let err = builder
            .add_reference(Reference {
                id: ReferenceId(1),
                source: ItemId(30),
                target: ItemId(99),
                kind: crate::model::ReferenceKind::Uses,
                anchor: None,
            })
            .unwrap_err();
        assert_eq!(
            err,
            ValidationError::MissingItem {
                id: ItemId(99)
            }
        );
    }

    #[test]
    fn builder_reports_validation_errors_on_build() {
        let mut builder = ProjectBuilder::new(ProjectId(1), "test", ContainerId(10));
        // Add a container that references a missing child directly, bypassing
        // the builder's parent check. This is only possible because we mutate
        // the internal Project in a test helper; public API users cannot do this.
        builder.project.containers.insert(
            ContainerId(20),
            Container {
                id: ContainerId(20),
                name: "orphan".into(),
                metadata: Metadata::new(),
                containers: Vec::new(),
                items: Vec::new(),
            },
        );
        let errors = builder.build().unwrap_err();
        assert!(errors.iter().any(|e| matches!(
            e,
            ValidationError::OrphanContainer { id: ContainerId(20) }
        )));
    }
}
