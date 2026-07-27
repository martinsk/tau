use crate::model::{Container, ContainerId, Item, ItemId, Project, Reference, ReferenceId};

pub fn container(project: &Project, id: ContainerId) -> Option<&Container> {
    project.containers.get(&id)
}

pub fn item(project: &Project, id: ItemId) -> Option<&Item> {
    project.items.get(&id)
}

pub fn reference(project: &Project, id: ReferenceId) -> Option<&Reference> {
    project.references.get(&id)
}

pub fn references_from(project: &Project, id: ItemId) -> Vec<&Reference> {
    project
        .references
        .values()
        .filter(|reference| reference.source == id)
        .collect()
}


pub fn references_to(project: &Project, id: ItemId) -> Vec<&Reference> {
    project
        .references
        .values()
        .filter(|reference| reference.target == id)
        .collect()
}

pub fn parent_of_container(project: &Project, id: ContainerId) -> Option<ContainerId> {
    if id == project.root {
        return None;
    }
    for container in project.containers.values() {
        if container.containers.contains(&id) {
            return Some(container.id);
        }
    }
    None
}

pub fn parent_of_item(project: &Project, id: ItemId) -> Option<ContainerId> {
    for container in project.containers.values() {
        if container.items.contains(&id) {
            return Some(container.id);
        }
    }
    None
}

pub fn walk_containers(project: &Project) -> Vec<ContainerId> {
    let mut result = Vec::new();
    let mut stack = vec![project.root];
    while let Some(current) = stack.pop() {
        result.push(current);
        if let Some(container) = project.containers.get(&current) {
            for child_id in container.containers.iter().rev() {
                stack.push(*child_id);
            }
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::model::{
        Container, ContainerId, Content, Item, ItemId, ItemKind, Metadata, Project, ProjectId,
        Reference, ReferenceId, ReferenceKind,
    };

    fn sample_project() -> Project {
        let mut project = Project::new(ProjectId(1), "test", ContainerId(10));

        let src = Container {
            id: ContainerId(20),
            name: "src".into(),
            metadata: Metadata::new(),
            containers: vec![ContainerId(30)],
            items: vec![],
        };
        project.containers.insert(src.id, src);

        let sub = Container {
            id: ContainerId(30),
            name: "sub".into(),
            metadata: Metadata::new(),
            containers: vec![],
            items: vec![ItemId(1)],
        };
        project.containers.insert(sub.id, sub);

        project
            .containers
            .get_mut(&ContainerId(10))
            .unwrap()
            .containers
            .push(ContainerId(20));

        let item = Item {
            id: ItemId(1),
            name: "main.rs".into(),
            kind: ItemKind::Rust,
            content: Content::InlineText("fn main() {}".into()),
            metadata: Metadata::new(),
        };
        project.items.insert(item.id, item);

        let reference = Reference {
            id: ReferenceId(1),
            source: ItemId(1),
            target: ItemId(2),
            kind: ReferenceKind::Uses,
            anchor: None,
        };
        project.references.insert(reference.id, reference);

        project
    }

    #[test]
    fn lookup_container() {
        let project = sample_project();
        assert_eq!(container(&project, ContainerId(20)).unwrap().name, "src");
    }

    #[test]
    fn lookup_item() {
        let project = sample_project();
        assert_eq!(item(&project, ItemId(1)).unwrap().name, "main.rs");
    }

    #[test]
    fn lookup_reference() {
        let project = sample_project();
        let reference = reference(&project, ReferenceId(1)).unwrap();
        assert_eq!(reference.source, ItemId(1));
        assert_eq!(reference.target, ItemId(2));
    }

    #[test]
    fn references_from_item() {
        let project = sample_project();
        let refs = references_from(&project, ItemId(1));
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].target, ItemId(2));
    }

    #[test]
    fn references_to_item() {
        let project = sample_project();
        let refs = references_to(&project, ItemId(2));
        assert_eq!(refs.len(), 1);
        assert_eq!(refs[0].source, ItemId(1));
    }

    #[test]
    fn parent_of_container_finds_parent() {
        let project = sample_project();
        assert_eq!(parent_of_container(&project, ContainerId(20)), Some(ContainerId(10)));
        assert_eq!(parent_of_container(&project, ContainerId(30)), Some(ContainerId(20)));
    }

    #[test]
    fn root_has_no_parent() {
        let project = sample_project();
        assert_eq!(parent_of_container(&project, ContainerId(10)), None);
    }

    #[test]
    fn finds_parent_of_item() {
        let project = sample_project();
        assert_eq!(parent_of_item(&project, ItemId(1)), Some(ContainerId(30)));
    }

    #[test]
    fn walk_containers_in_expected_order() {
        let project = sample_project();
        let walked = walk_containers(&project);
        assert_eq!(walked, vec![ContainerId(10), ContainerId(20), ContainerId(30)]);
    }
}
