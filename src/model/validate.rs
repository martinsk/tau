use std::collections::{HashMap, HashSet};

use crate::model::{ContainerId, ItemId, Project};

#[derive(Clone, Debug, PartialEq)]
pub enum ValidationError {
    MissingContainer { id: ContainerId },
    MissingItem { id: ItemId },
    OrphanContainer { id: ContainerId },
    RootHasParent { id: ContainerId, parents: Vec<ContainerId> },
    MultipleParents { id: ContainerId, parents: Vec<ContainerId> },
    CycleInContainerGraph { ids: Vec<ContainerId> },
}

pub fn validate(project: &Project) -> Vec<ValidationError> {
    let mut errors = Vec::new();
    check_root_exists(project, &mut errors);
    check_container_children_exist(project, &mut errors);
    check_container_items_exist(project, &mut errors);
    check_references_exist(project, &mut errors);
    check_container_tree(project, &mut errors);
    errors
}

fn check_root_exists(project: &Project, errors: &mut Vec<ValidationError>) {
    if !project.containers.contains_key(&project.root) {
        errors.push(ValidationError::MissingContainer { id: project.root });
    }
}

fn check_container_children_exist(project: &Project, errors: &mut Vec<ValidationError>) {
    for container in project.containers.values() {
        for child_id in &container.containers {
            if !project.containers.contains_key(child_id) {
                errors.push(ValidationError::MissingContainer { id: *child_id });
            }
        }
    }
}

fn check_container_items_exist(project: &Project, errors: &mut Vec<ValidationError>) {
    for container in project.containers.values() {
        for item_id in &container.items {
            if !project.items.contains_key(item_id) {
                errors.push(ValidationError::MissingItem { id: *item_id });
            }
        }
    }
}

fn check_references_exist(project: &Project, errors: &mut Vec<ValidationError>) {
    for reference in project.references.values() {
        if !project.items.contains_key(&reference.source) {
            errors.push(ValidationError::MissingItem { id: reference.source });
        }
        if !project.items.contains_key(&reference.target) {
            errors.push(ValidationError::MissingItem { id: reference.target });
        }
    }
}

fn build_parent_map(project: &Project) -> HashMap<ContainerId, Vec<ContainerId>> {
    let mut map: HashMap<ContainerId, Vec<ContainerId>> = HashMap::new();
    for container in project.containers.values() {
        for child_id in &container.containers {
            map.entry(*child_id).or_default().push(container.id);
        }
    }
    map
}

fn check_container_tree(project: &Project, errors: &mut Vec<ValidationError>) {
    let parent_map = build_parent_map(project);

    for (child_id, parents) in &parent_map {
        if *child_id == project.root {
            errors.push(ValidationError::RootHasParent {
                id: *child_id,
                parents: parents.clone(),
            });
        } else if parents.len() > 1 {
            errors.push(ValidationError::MultipleParents {
                id: *child_id,
                parents: parents.clone(),
            });
        }
    }

    let mut visited = HashSet::new();
    let mut stack = vec![project.root];
    while let Some(current) = stack.pop() {
        if !visited.insert(current) {
            errors.push(ValidationError::CycleInContainerGraph {
                ids: vec![current],
            });
            continue;
        }
        if let Some(container) = project.containers.get(&current) {
            for child_id in &container.containers {
                stack.push(*child_id);
            }
        }
    }

    for container in project.containers.values() {
        if !visited.contains(&container.id) {
            errors.push(ValidationError::OrphanContainer { id: container.id });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{Container, ContainerId, Content, Item, ItemId, ItemKind, Metadata, Project, ProjectId, Reference, ReferenceId, ReferenceKind};

    fn empty_project() -> Project {
        Project::new(ProjectId(1), "test", ContainerId(10))
    }

    #[test]
    fn valid_project_has_no_errors() {
        let project = empty_project();
        let errors = validate(&project);
        assert!(errors.is_empty(), "expected no errors, got {errors:?}");
    }

    #[test]
    fn detects_missing_child_container() {
        let mut project = empty_project();
        project
            .containers
            .get_mut(&ContainerId(10))
            .unwrap()
            .containers
            .push(ContainerId(99));
        let errors = validate(&project);
        assert!(errors.contains(&ValidationError::MissingContainer { id: ContainerId(99) }));
    }

    #[test]
    fn detects_missing_container_item() {
        let mut project = empty_project();
        project
            .containers
            .get_mut(&ContainerId(10))
            .unwrap()
            .items
            .push(ItemId(99));
        let errors = validate(&project);
        assert!(errors.contains(&ValidationError::MissingItem { id: ItemId(99) }));
    }

    #[test]
    fn detects_missing_reference_target() {
        let mut project = empty_project();
        let item = Item {
            id: ItemId(20),
            name: "a".into(),
            kind: ItemKind::Text,
            content: Content::InlineText("".into()),
            metadata: Metadata::new(),
        };
        project.items.insert(item.id, item);
        project.references.insert(
            ReferenceId(1),
            Reference {
                id: ReferenceId(1),
                source: ItemId(20),
                target: ItemId(99),
                kind: ReferenceKind::Uses,
                anchor: None,
            },
        );
        let errors = validate(&project);
        assert!(errors.contains(&ValidationError::MissingItem { id: ItemId(99) }));
    }

    #[test]
    fn detects_orphan_container() {
        let mut project = empty_project();
        project.containers.insert(
            ContainerId(20),
            Container {
                id: ContainerId(20),
                name: "orphan".into(),
                metadata: Metadata::new(),
                containers: Vec::new(),
                items: Vec::new(),
            },
        );
        let errors = validate(&project);
        assert!(errors.contains(&ValidationError::OrphanContainer { id: ContainerId(20) }));
    }

    #[test]
    fn detects_cycle_in_container_graph() {
        let mut project = empty_project();
        project.containers.insert(
            ContainerId(20),
            Container {
                id: ContainerId(20),
                name: "a".into(),
                metadata: Metadata::new(),
                containers: vec![ContainerId(30)],
                items: Vec::new(),
            },
        );
        project.containers.insert(
            ContainerId(30),
            Container {
                id: ContainerId(30),
                name: "b".into(),
                metadata: Metadata::new(),
                containers: vec![ContainerId(20)],
                items: Vec::new(),
            },
        );
        project
            .containers
            .get_mut(&ContainerId(10))
            .unwrap()
            .containers
            .push(ContainerId(20));

        let errors = validate(&project);
        assert!(
            errors.iter().any(|e| matches!(e, ValidationError::CycleInContainerGraph { .. })),
            "expected cycle error, got {errors:?}"
        );
    }
}
