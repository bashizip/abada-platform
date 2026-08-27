-- Project-scoped task groups: member-level candidate-group assignments for
-- human tasks.  A member with task group SALES_DIRECTOR can claim/complete
-- tasks whose candidate groups include SALES_DIRECTOR.  Resolved alongside
-- identity groups (JWT / X-Groups) at claim, complete and visibility time.

CREATE TABLE project_member_task_groups (
    member_id VARCHAR(36) NOT NULL REFERENCES project_members(id) ON DELETE CASCADE,
    task_group VARCHAR(128) NOT NULL,
    PRIMARY KEY (member_id, task_group)
);
