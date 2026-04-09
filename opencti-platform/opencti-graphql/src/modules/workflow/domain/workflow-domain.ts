import { FunctionalError } from '../../../config/errors';
import { createEntity, createRelation, loadEntity, updateAttribute } from '../../../database/middleware';
import { fullEntitiesList, storeLoadById } from '../../../database/middleware-loader';
import { FilterMode } from '../../../generated/graphql';
import { RELATION_HAS_WORKFLOW } from '../../../schema/internalRelationship';
import type { AuthContext, AuthUser } from '../../../types/user';
import { findByType as findEntitySettingByType } from '../../entitySetting/entitySetting-domain';
import { WorkflowFactory } from '../engine/workflow-factory';
import { ActionRegistry } from '../registry/workflow-actions';
import { ENTITY_TYPE_WORKFLOW_DEFINITION, ENTITY_TYPE_WORKFLOW_INSTANCE, type TriggerResult, type WorkflowPendingTransition } from '../types/workflow-types';
import type { BasicStoreEntity } from '../../../types/store';
import { bypassDraftContext } from '../../../utils/draftContext';

interface WorkflowInstanceStoreEntity extends BasicStoreEntity {
  entity_id: string;
  currentState: string;
  history: string;
  pending_status?: string;
  pending_work_id?: string;
  pending_transition?: string;
  pending_error?: string;
}

const parsePendingTransition = (instanceEntity?: WorkflowInstanceStoreEntity | null): WorkflowPendingTransition | null => {
  if (!instanceEntity?.pending_transition) {
    return null;
  }
  try {
    const pendingTransition = typeof instanceEntity.pending_transition === 'string'
      ? JSON.parse(instanceEntity.pending_transition)
      : instanceEntity.pending_transition;
    if (!pendingTransition?.id || !pendingTransition?.event || !pendingTransition?.fromState || !pendingTransition?.toState) {
      return null;
    }
    return pendingTransition;
  } catch {
    return null;
  }
};

const getPendingTransitionWorkIds = (pendingTransition?: WorkflowPendingTransition | null): string[] => {
  if (!pendingTransition) {
    return [];
  }
  const workIds = pendingTransition.workIds && pendingTransition.workIds.length > 0
    ? pendingTransition.workIds
    : (pendingTransition.workId ? [pendingTransition.workId] : []);
  return Array.from(new Set(workIds.filter((id): id is string => !!id)));
};

const normalizePendingStatus = (status?: string | null): string | null => {
  if (!status) {
    return null;
  }
  return status.toLowerCase();
};

const isPendingStatus = (status?: string | null): boolean => normalizePendingStatus(status) === 'pending';

const validateNoAsyncStateActions = (definitionObj: any) => {
  const states = definitionObj?.states ?? [];
  for (let index = 0; index < states.length; index += 1) {
    const state = states[index];
    const hasAsyncOnEnter = (state?.onEnter ?? []).some((a: any) => a?.mode === 'async');
    const hasAsyncOnExit = (state?.onExit ?? []).some((a: any) => a?.mode === 'async');
    if (hasAsyncOnEnter || hasAsyncOnExit) {
      throw FunctionalError('Async actions are only supported on transitions.');
    }
  }
};

const validateTransitionAsyncActions = (_definitionObj: any) => {
  // Multiple async actions and mixed sync/async per transition are supported.
};

const getWorkflowConfig = async (context: AuthContext, user: AuthUser, targetType: string) => {
  const executionContext = bypassDraftContext(context);
  return findEntitySettingByType(executionContext, executionContext.user!, targetType);
};

const getDefinitionData = async (context: AuthContext, user: AuthUser, entitySetting: any) => {
  if (!entitySetting) return null;

  if (entitySetting.workflow_id) {
    const executionContext = bypassDraftContext(context);
    const workflowDefinitionEntity = await storeLoadById(executionContext, executionContext.user!, entitySetting.workflow_id, ENTITY_TYPE_WORKFLOW_DEFINITION) as any;
    if (workflowDefinitionEntity) {
      const workflowContent = typeof workflowDefinitionEntity.workflow_content === 'string'
        ? JSON.parse(workflowDefinitionEntity.workflow_content)
        : workflowDefinitionEntity.workflow_content;
      return { ...workflowContent, id: workflowDefinitionEntity.id, name: workflowDefinitionEntity.name };
    }
  }

  return null;
};

const findWorkflowInstanceEntity = async (
  context: AuthContext,
  user: AuthUser,
  entityId: string,
): Promise<WorkflowInstanceStoreEntity | null> => {
  // Find existing instance via entity_id attribute directly (more robust than relationship)
  const executionContext = bypassDraftContext(context);
  return await loadEntity(executionContext, executionContext.user!, [ENTITY_TYPE_WORKFLOW_INSTANCE], {
    filters: {
      mode: FilterMode.And,
      filters: [{ key: ['entity_id'], values: [entityId] }],
      filterGroups: [],
    },
  }) as WorkflowInstanceStoreEntity;
};

const initializeWorkflowInstance = async (
  context: AuthContext,
  user: AuthUser,
  entity: any,
  entitySetting: any,
  definitionData: any,
): Promise<WorkflowInstanceStoreEntity> => {
  const initialState = definitionData.initialState;
  const entityId = entity.id || entity.internal_id;
  const instanceInput = {
    entity_id: entityId,
    workflow_id: entitySetting.workflow_id || 'manual',
    currentState: initialState,
    history: JSON.stringify([{
      state: initialState,
      user_id: user.id,
      timestamp: new Date().toISOString(),
      event: 'initialization',
    }]),
  };
  const executionContext = bypassDraftContext(context);
  const executionUser = executionContext.user!;
  const instance = await createEntity(executionContext, executionUser, instanceInput, ENTITY_TYPE_WORKFLOW_INSTANCE) as WorkflowInstanceStoreEntity;

  await createRelation(executionContext, executionUser, {
    fromId: entityId,
    toId: instance.id || instance.internal_id,
    relationship_type: RELATION_HAS_WORKFLOW,
  });

  return instance;
};

/**
 * Get workflow definition for an entity type.
 */
export const getWorkflowDefinition = async (
  context: AuthContext,
  user: AuthUser,
  entityType: string,
): Promise<any> => {
  const entitySetting = await getWorkflowConfig(context, user, entityType);
  return getDefinitionData(context, user, entitySetting);
};

/**
 * Create or update workflow definition for an entity type.
 */
export const setWorkflowDefinition = async (
  context: AuthContext,
  user: AuthUser,
  entityType: string,
  definition: string,
): Promise<any> => {
  const entitySetting = await getWorkflowConfig(context, user, entityType);
  if (!entitySetting) {
    throw FunctionalError('Entity setting not found for type', { entityType });
  }

  // Validate definition is valid JSON
  let definitionObj;
  try {
    definitionObj = JSON.parse(definition);
  } catch (_error) {
    throw FunctionalError('Invalid workflow definition JSON');
  }

  validateNoAsyncStateActions(definitionObj);
  validateTransitionAsyncActions(definitionObj);

  const workflowName = definitionObj.name || `Workflow for ${entityType}`;

  const executionContext = bypassDraftContext(context);
  const executionUser = executionContext.user!;

  // 1. Check if we have an existing workflow linked
  if (entitySetting.workflow_id) {
    const existingWorkflow = await storeLoadById(executionContext, executionUser, entitySetting.workflow_id, ENTITY_TYPE_WORKFLOW_DEFINITION);
    if (existingWorkflow) {
      await updateAttribute(executionContext, executionUser, existingWorkflow.id, ENTITY_TYPE_WORKFLOW_DEFINITION, [
        { key: 'workflow_content', value: [definition] },
        { key: 'name', value: [workflowName] },
      ]);
      return entitySetting;
    }
  }

  // 2. Create the WorkflowDefinition entity
  const workflowDefinitionInput = {
    name: workflowName,
    workflow_content: definition,
  };
  const workflowDefinition = await createEntity(executionContext, executionUser, workflowDefinitionInput, ENTITY_TYPE_WORKFLOW_DEFINITION);

  // 3. Link it to the EntitySetting
  const { element } = await updateAttribute(executionContext, executionUser, entitySetting.id, 'EntitySetting', [
    { key: 'workflow_id', value: [workflowDefinition.id] },
  ]);
  return element;
};

/**
 * Delete workflow definition for an entity type.
 */
export const deleteWorkflowDefinition = async (
  context: AuthContext,
  user: AuthUser,
  entityType: string,
): Promise<any> => {
  const entitySetting = await getWorkflowConfig(context, user, entityType);
  if (entitySetting?.workflow_id) {
    const executionContext = bypassDraftContext(context);
    const { element } = await updateAttribute(executionContext, executionContext.user!, entitySetting.id, 'EntitySetting', [
      { key: 'workflow_id', value: [null] },
    ]);
    return element;
  }
  return entitySetting;
};

/**
 * Get workflow instance for an entity.
 */
export const getWorkflowInstance = async (
  context: AuthContext,
  user: AuthUser,
  entityId: string,
): Promise<any> => {
  const entity = await storeLoadById(context, user, entityId, 'Basic-Object');
  if (!entity) {
    return null;
  }

  const entitySetting = await getWorkflowConfig(context, user, entity.entity_type);
  const definitionData = await getDefinitionData(context, user, entitySetting);
  if (!definitionData) {
    return null;
  }

  const effectiveEntityId = entity.internal_id || entity.id;
  const instanceEntity = await findWorkflowInstanceEntity(context, user, effectiveEntityId);
  const currentState = instanceEntity?.currentState ?? definitionData.initialState;
  const pendingTransition = parsePendingTransition(instanceEntity);
  const pendingStatus = normalizePendingStatus(instanceEntity?.pending_status ?? null);
  const pendingError = instanceEntity?.pending_error ?? null;

  const allowedTransitions = pendingStatus === 'pending'
    ? []
    : await getAllowedTransitions(context, user, entityId);
  const id = instanceEntity?.internal_id ?? instanceEntity?.id ?? `initial-${effectiveEntityId}`;
  return {
    id,
    internal_id: id,
    __typename: 'WorkflowInstance',
    currentState: currentState || '',
    pendingStatus,
    pendingError,
    pendingTransition,
    allowedTransitions,
  };
};

/**
 * Get allowed transitions for an entity.
 */
export const getAllowedTransitions = async (
  context: AuthContext,
  user: AuthUser,
  entityId: string,
): Promise<any[]> => {
  const entity = await storeLoadById(context, user, entityId, 'Basic-Object');
  if (!entity) {
    return [];
  }

  const entitySetting = await getWorkflowConfig(context, user, entity.entity_type);
  const definitionData = await getDefinitionData(context, user, entitySetting);

  if (!definitionData) {
    return [];
  }

  const effectiveEntityId = entity.internal_id || entity.id;
  const instanceEntity = await findWorkflowInstanceEntity(context, user, effectiveEntityId);
  const currentStateId = instanceEntity?.currentState ?? definitionData.initialState;

  const definition = WorkflowFactory.createDefinition(definitionData);
  const effectiveStateId = currentStateId || definition.getInitialState();
  if (!effectiveStateId || !definition.hasState(effectiveStateId)) {
    return [];
  }

  const transitions = definition.getTransitions(effectiveStateId);

  const resolvedTransitions = transitions.map((t) => {
    return {
      event: t.event,
      toState: t.to,
      actions: t.actionTypes || [],
    };
  });

  return resolvedTransitions;
};

/**
 * Get allowed next statuses for an entity.
 */
export const getAllowedNextStatuses = async (
  context: AuthContext,
  user: AuthUser,
  entityId: string,
): Promise<any[]> => {
  const transitions = await getAllowedTransitions(context, user, entityId);
  return transitions.map((t) => t.toStatus).filter((s) => s !== null && s !== undefined);
};

/**
 * Trigger a workflow event on an entity.
 * This is the main entry point for the backend logic.
 *
 * @param context The auth context
 * @param user The auth user
 * @param entityId The ID of the entity to trigger the event on
 * @param eventName The name of the event to trigger
 * @returns {Promise<TriggerResult>} The result of the trigger
 */
export const triggerWorkflowEvent = async (
  context: AuthContext,
  user: AuthUser,
  entityId: string,
  eventName: string,
): Promise<TriggerResult> => {
  // Bypass draft context for workflow state-machine persistence.
  // Action execution keeps original context to preserve draft-aware behavior.
  const executionContext = bypassDraftContext(context);
  const executionUser = executionContext.user!;

  // 1. Fetch the entity
  const entity = await storeLoadById(executionContext, executionUser, entityId, 'Basic-Object');
  if (!entity) {
    throw FunctionalError('Entity not found', { entityId });
  }
  // Keep original context/user for action execution so draft-scoped actions
  // (like org sharing from a draft) keep the same behavior as manual actions.
  const actionEntity = await storeLoadById(context, user, entityId, 'Basic-Object') || entity;

  // 2. Fetch its EntitySetting to get the workflow configuration
  const entitySetting = await getWorkflowConfig(executionContext, executionUser, entity.entity_type);
  const definitionData = await getDefinitionData(executionContext, executionUser, entitySetting);

  if (!definitionData) {
    return {
      success: false,
      reason: `Workflows are not configured for entity type: ${entity.entity_type}`,
    };
  }

  try {
    const workflowContext = {
      entity,
      user: executionUser,
      context: executionContext,
    };
    const workflowActionContext = {
      entity: actionEntity,
      user,
      context,
    };

    const effectiveEntityId = entity.internal_id || entity.id;
    let instanceEntity = await findWorkflowInstanceEntity(executionContext, executionUser, effectiveEntityId);
    if (!instanceEntity) {
      instanceEntity = await initializeWorkflowInstance(executionContext, executionUser, entity, entitySetting, definitionData);
    }

    if (isPendingStatus(instanceEntity.pending_status)) {
      const workflowInstance = await getWorkflowInstance(executionContext, executionUser, entityId);
      return {
        success: false,
        executionStatus: 'pending',
        reason: 'A transition is already pending for this workflow instance.',
        pendingTransition: parsePendingTransition(instanceEntity) ?? undefined,
        instance: workflowInstance,
        entity,
      };
    }

    const currentStateId = instanceEntity.currentState;

    const definition = WorkflowFactory.createDefinition(definitionData);
    const transition = definition.getTransition(currentStateId || definition.getInitialState(), eventName);

    if (!transition) {
      return {
        success: false,
        reason: `No transition found from state '${currentStateId}' for event '${eventName}'`,
        entity,
      };
    }

    if (transition.conditions) {
      for (const condition of transition.conditions) {
        const isValid = await condition(workflowContext);
        if (!isValid) {
          return {
            success: false,
            reason: `Condition failed for transition '${eventName}'`,
            entity,
          };
        }
      }
    }

    const schemaTransition = definitionData.transitions.find((t: any) => t.from === transition.from
      && t.to === transition.to
      && t.event === transition.event);
    const hasAsyncTransitionAction = (schemaTransition?.actions ?? []).some((a: any) => a?.mode === 'async');

    if (hasAsyncTransitionAction) {
      const transitionActions = schemaTransition?.actions ?? [];
      const syncActions = transitionActions.filter((a: any) => a?.mode !== 'async');
      const asyncActions = transitionActions.filter((a: any) => a?.mode === 'async');

      // Run sync actions first, in order
      for (const syncAction of syncActions) {
        const syncFn = ActionRegistry[syncAction.type];
        if (!syncFn) {
          return {
            success: false,
            executionStatus: 'failed',
            reason: `Action type '${syncAction.type}' not found in registry.`,
            entity,
          };
        }
        await syncFn(workflowActionContext, syncAction.params);
      }

      // Run all async actions, collect their workIds
      const asyncResults: Array<{ taskId?: string; workId?: string }> = [];
      for (const asyncAction of asyncActions) {
        const actionFn = ActionRegistry[asyncAction.type];
        if (!actionFn) {
          return {
            success: false,
            executionStatus: 'failed',
            reason: `Action type '${asyncAction.type}' not found in registry.`,
            entity,
          };
        }
        const actionResult = await actionFn(workflowActionContext, asyncAction.params);
        if (actionResult && typeof actionResult === 'object') {
          asyncResults.push(actionResult);
        }
      }

      const workIds = asyncResults.map((r) => r.workId).filter((id): id is string => !!id);
      const pendingTransition: WorkflowPendingTransition = {
        id: `${eventName}-${Date.now()}`,
        event: eventName,
        fromState: transition.from,
        toState: transition.to,
        startedAt: new Date().toISOString(),
        taskId: asyncResults[0]?.taskId,
        workId: workIds[0],
        workIds: workIds.length > 1 ? workIds : undefined,
        completedWorkIds: [],
      };
      const instanceId = instanceEntity.internal_id || instanceEntity.id;
      await updateAttribute(executionContext, executionUser, instanceId, ENTITY_TYPE_WORKFLOW_INSTANCE, [
        { key: 'pending_status', value: ['pending'] },
        { key: 'pending_work_id', value: [pendingTransition.workId ?? null] },
        { key: 'pending_transition', value: [JSON.stringify(pendingTransition)] },
        { key: 'pending_error', value: [null] },
      ]);

      const workflowInstance = await getWorkflowInstance(executionContext, executionUser, entityId);
      return {
        success: true,
        executionStatus: 'pending',
        pendingTransition,
        instance: workflowInstance,
        entity,
      };
    }

    // 5. Create instance and Trigger the event
    const instance = WorkflowFactory.getInstance(definitionData, definition, currentStateId || '', workflowContext);
    const result = await instance.trigger(eventName);

    // 6. If successful, update the database
    if (result.success && instanceEntity) {
      const newState = instance.getCurrentState();

      // Update the instance entity
      const history = JSON.parse(instanceEntity.history || '[]');
      history.push({
        state: newState,
        user_id: executionUser.id,
        timestamp: new Date().toISOString(),
        event: eventName,
      });
      const instanceId = instanceEntity.internal_id || instanceEntity.id;
      await updateAttribute(executionContext, executionUser, instanceId, ENTITY_TYPE_WORKFLOW_INSTANCE, [
        { key: 'currentState', value: [newState] },
        { key: 'history', value: [JSON.stringify(history)] },
        { key: 'pending_status', value: [null] },
        { key: 'pending_work_id', value: [null] },
        { key: 'pending_transition', value: [null] },
        { key: 'pending_error', value: [null] },
      ]);

      const workflowInstance = await getWorkflowInstance(executionContext, executionUser, entityId);
      return { success: true, executionStatus: 'success', newState, instance: workflowInstance, entity };
    }

    return { ...result, entity };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'Unknown error';
    return {
      success: false,
      reason: `Workflow execution failed: ${reason}`,
    };
  }
};

export const resolvePendingWorkflowTransition = async (
  context: AuthContext,
  user: AuthUser,
  entityId: string,
  success: boolean,
  reason?: string,
): Promise<TriggerResult> => {
  const entity = await storeLoadById(context, user, entityId, 'Basic-Object');
  if (!entity) {
    throw FunctionalError('Entity not found', { entityId });
  }

  const executionContext = bypassDraftContext(context);
  const executionUser = executionContext.user!;
  const effectiveEntityId = entity.internal_id || entity.id;
  const instanceEntity = await findWorkflowInstanceEntity(executionContext, executionUser, effectiveEntityId);
  if (!instanceEntity || !isPendingStatus(instanceEntity.pending_status)) {
    return { success: false, executionStatus: 'failed', reason: 'No pending transition to resolve.', entity };
  }

  const pendingTransition = parsePendingTransition(instanceEntity);
  if (!pendingTransition) {
    return { success: false, executionStatus: 'failed', reason: 'Pending transition payload is invalid.', entity };
  }

  const instanceId = instanceEntity.internal_id || instanceEntity.id;
  if (!success) {
    const failureReason = reason || 'Pending transition failed.';
    await updateAttribute(executionContext, executionUser, instanceId, ENTITY_TYPE_WORKFLOW_INSTANCE, [
      { key: 'pending_status', value: ['failed'] },
      { key: 'pending_error', value: [failureReason] },
    ]);
    const workflowInstance = await getWorkflowInstance(context, user, entityId);
    return {
      success: false,
      executionStatus: 'failed',
      reason: failureReason,
      pendingTransition,
      instance: workflowInstance,
      entity,
    };
  }

  const history = JSON.parse(instanceEntity.history || '[]');
  history.push({
    state: pendingTransition.toState,
    user_id: user.id,
    timestamp: new Date().toISOString(),
    event: pendingTransition.event,
  });

  await updateAttribute(executionContext, executionUser, instanceId, ENTITY_TYPE_WORKFLOW_INSTANCE, [
    { key: 'currentState', value: [pendingTransition.toState] },
    { key: 'history', value: [JSON.stringify(history)] },
    { key: 'pending_status', value: [null] },
    { key: 'pending_work_id', value: [null] },
    { key: 'pending_transition', value: [null] },
    { key: 'pending_error', value: [null] },
  ]);

  const workflowInstance = await getWorkflowInstance(context, user, entityId);
  return {
    success: true,
    executionStatus: 'success',
    newState: pendingTransition.toState,
    instance: workflowInstance,
    entity,
  };
};

export const resolvePendingWorkflowTransitionByWorkId = async (
  context: AuthContext,
  user: AuthUser,
  workId: string,
  success: boolean,
  reason?: string,
): Promise<void> => {
  const executionContext = bypassDraftContext(context);
  const executionUser = executionContext.user!;

  let pendingInstance: WorkflowInstanceStoreEntity | null = await loadEntity(executionContext, executionUser, [ENTITY_TYPE_WORKFLOW_INSTANCE], {
    filters: {
      mode: FilterMode.And,
      filters: [
        { key: ['pending_status'], values: ['pending'] },
        { key: ['pending_work_id'], values: [workId] },
      ],
      filterGroups: [],
    },
  }) as WorkflowInstanceStoreEntity;

  // Fallback path for out-of-order async completion events: if a workId from
  // the tracked list finishes before it becomes the current pending_work_id,
  // find the matching pending transition by scanning pending instances.
  if (!pendingInstance) {
    const pendingInstances = await fullEntitiesList<WorkflowInstanceStoreEntity>(executionContext, executionUser, [ENTITY_TYPE_WORKFLOW_INSTANCE], {
      filters: {
        mode: FilterMode.And,
        filters: [
          { key: ['pending_status'], values: ['pending'] },
        ],
        filterGroups: [],
      },
    });
    pendingInstance = pendingInstances.find((instance) => {
      const pendingTransition = parsePendingTransition(instance);
      const trackedWorkIds = getPendingTransitionWorkIds(pendingTransition);
      return trackedWorkIds.includes(workId);
    }) || null;
  }

  if (!pendingInstance) {
    return;
  }

  const pendingTransition = parsePendingTransition(pendingInstance);
  const trackedWorkIds = getPendingTransitionWorkIds(pendingTransition);
  if (trackedWorkIds.length === 0 || !trackedWorkIds.includes(workId)) {
    return;
  }

  if (success) {
    const completedWorkIds = Array.from(new Set([...(pendingTransition?.completedWorkIds ?? []), workId]));
    const remainingWorkIds = trackedWorkIds.filter((id) => !completedWorkIds.includes(id));
    const instanceId = pendingInstance.id || pendingInstance.internal_id;

    if (remainingWorkIds.length > 0) {
      const nextPendingTransition: WorkflowPendingTransition = {
        ...pendingTransition!,
        workId: remainingWorkIds[0],
        workIds: trackedWorkIds.length > 1 ? trackedWorkIds : undefined,
        completedWorkIds,
      };
      await updateAttribute(executionContext, executionUser, instanceId, ENTITY_TYPE_WORKFLOW_INSTANCE, [
        { key: 'pending_work_id', value: [remainingWorkIds[0]] },
        { key: 'pending_transition', value: [JSON.stringify(nextPendingTransition)] },
      ]);
      return;
    }
  }

  await resolvePendingWorkflowTransition(
    executionContext,
    executionUser,
    pendingInstance.entity_id,
    success,
    reason,
  );
};
