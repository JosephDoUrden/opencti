import gql from 'graphql-tag';
import { beforeAll, describe, expect, it } from 'vitest';
import { queryInitPlatformAsAdmin } from '../../utils/testQuery';

const WORKFLOW_DEFINITION_ADD_MUTATION = gql`
  mutation WorkflowDefinitionSet($entityType: String!, $definition: String!) {
    workflowDefinitionSet(entityType: $entityType, definition: $definition) {
      id
      target_type
      workflow_id
    }
  }
`;

const CREATE_DRAFT_WORKSPACE_QUERY = gql`
  mutation DraftWorkspaceAdd($input: DraftWorkspaceAddInput!) {
    draftWorkspaceAdd(input: $input) {
      id
      name
      draft_status
    }
  }
`;

const TRIGGER_WORKFLOW_EVENT_MUTATION = gql`
  mutation TriggerWorkflowEvent($entityId: String!, $eventName: String!) {
    triggerWorkflowEvent(entityId: $entityId, eventName: $eventName) {
      success
      newState
      reason
    }
  }
`;

describe('Workflow Conditions Resolver', () => {
  let draftWorkspaceId: string;
  const workspaceName = 'Conditions Test Workspace';

  const workflowDefinition = JSON.stringify({
    id: 'conditions-workflow',
    name: 'Conditions Workflow',
    initialState: 'open',
    states: [{ statusId: 'open' }, { statusId: 'step1' }, { statusId: 'step2' }, { statusId: 'done' }],
    transitions: [
      {
        from: 'open',
        to: 'step1',
        event: 'named_condition_event',
        conditions: [{ type: 'isAdmin' }],
      },
      {
        from: 'step1',
        to: 'step2',
        event: 'field_comparison_event',
        conditions: [{ field: 'entity.name', operator: 'eq', value: workspaceName }],
      },
      {
        from: 'step2',
        to: 'done',
        event: 'mixed_conditions_event',
        conditions: [
          { type: 'isAdmin' },
          { field: 'entity.name', operator: 'contains', value: 'Conditions' },
        ],
      },
    ],
  });

  beforeAll(async () => {
    // 1. Create a workspace
    const result = await queryInitPlatformAsAdmin(CREATE_DRAFT_WORKSPACE_QUERY, {
        input: { name: workspaceName },
      });
    draftWorkspaceId = result.data.draftWorkspaceAdd.id;

    // 2. Set the workflow definition
    await queryInitPlatformAsAdmin(WORKFLOW_DEFINITION_ADD_MUTATION, {
        entityType: 'DraftWorkspace',
        definition: workflowDefinition,
      });
  });

  it('should pass named condition (isAdmin)', async () => {
    const result = await queryInitPlatformAsAdmin(TRIGGER_WORKFLOW_EVENT_MUTATION, {
        entityId: draftWorkspaceId,
        eventName: 'named_condition_event',
      });
    expect(result.data.triggerWorkflowEvent.success).toBe(true);
    expect(result.data.triggerWorkflowEvent.newState).toBe('step1');
  });

  it('should pass field comparison (entity.name eq workspaceName)', async () => {
    const result = await queryInitPlatformAsAdmin(TRIGGER_WORKFLOW_EVENT_MUTATION, {
        entityId: draftWorkspaceId,
        eventName: 'field_comparison_event',
      });
    expect(result.data.triggerWorkflowEvent.success).toBe(true);
    expect(result.data.triggerWorkflowEvent.newState).toBe('step2');
  });

  it('should pass mixed conditions (named + field)', async () => {
    const result = await queryInitPlatformAsAdmin(TRIGGER_WORKFLOW_EVENT_MUTATION, {
        entityId: draftWorkspaceId,
        eventName: 'mixed_conditions_event',
      });
    expect(result.data.triggerWorkflowEvent.success).toBe(true);
    expect(result.data.triggerWorkflowEvent.newState).toBe('done');
  });
});
