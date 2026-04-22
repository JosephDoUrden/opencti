import { FunctionalError } from '../../../config/errors';
import { logApp } from '../../../config/conf';
import { createEntity, createRelation, loadEntity, updateAttribute } from '../../../database/middleware';
import { fullEntitiesList, storeLoadById } from '../../../database/middleware-loader';
import { FilterMode } from '../../../generated/graphql';
import { RELATION_HAS_WORKFLOW } from '../../../schema/internalRelationship';
import type { AuthContext, AuthUser } from '../../../types/user';
import { findByType as findEntitySettingByType } from '../../entitySetting/entitySetting-domain';
import { WorkflowFactory } from '../engine/workflow-factory';
import { ActionRegistry } from '../registry/workflow-actions';
import {
  ENTITY_TYPE_WORKFLOW_DEFINITION,
  ENTITY_TYPE_WORKFLOW_INSTANCE,
  type TriggerResult,
  type WorkflowPendingAsyncAction,
  type WorkflowPendingTransition,
} from '../types/workflow-types';
import type { BasicStoreEntity } from '../../../types/store';
import { executionContext as createExecutionContext, SYSTEM_USER } from '../../../utils/access';
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
  if (pendingTransition.asyncActions && pendingTransition.asyncActions.length > 0) {
    const trackedFromActions = pendingTransition.asyncActions
      .map((action) => action.workId)
      .filter((id): id is string => !!id);
    return Array.from(new Set(trackedFromActions));
  }
  const workIds = pendingTransition.workIds && pendingTransition.workIds.length > 0
    ? pendingTransition.workIds
    : (pendingTransition.workId ? [pendingTransition.workId] : []);
  return Array.from(new Set(workIds.filter((id): id is string => !!id)));
};

const syncPendingTransitionTracking = (pendingTransition: WorkflowPendingTransition): WorkflowPendingTransition => {
  if (!pendingTransition.asyncActions || pendingTransition.asyncActions.length === 0) {
    return pendingTransition;
  }

  const allWorkIds = Array.from(new Set(
    pendingTransition.asyncActions
      .map((action) => action.workId)
      .filter((id): id is string => !!id),
  ));

  const pendingWorkIds = pendingTransition.asyncActions
    .filter((action) => action.status === 'pending')
    .map((action) => action.workId)
    .filter((id): id is string => !!id);

  const completedWorkIds = Array.from(new Set(
    pendingTransition.asyncActions
      .filter((action) => action.status === 'success')
      .map((action) => action.workId)
      .filter((id): id is string => !!id),
  ));

  return {
    ...pendingTransition,
    workId: pendingWorkIds[0],
    workIds: allWorkIds.length > 0 ? allWorkIds : undefined,
    completedWorkIds,
  };
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
      const asyncActionExecutions: WorkflowPendingAsyncAction[] = [];
      for (let index = 0; index < asyncActions.length; index += 1) {
        const asyncAction = asyncActions[index];
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
        if (!actionResult || typeof actionResult !== 'object' || !actionResult.workId) {
          return {
            success: false,
            executionStatus: 'failed',
            reason: `Async action '${asyncAction.type}' didn't return a valid workId.`,
            entity,
          };
        }
        asyncActionExecutions.push({
          id: `${asyncAction.type}-${index}`,
          type: asyncAction.type,
          params: asyncAction.params,
          status: 'pending',
          taskId: actionResult.taskId,
          workId: actionResult.workId,
        });
      }

      const pendingTransition = syncPendingTransitionTracking({
        id: `${eventName}-${Date.now()}`,
        event: eventName,
        fromState: transition.from,
        toState: transition.to,
        startedAt: new Date().toISOString(),
        taskId: asyncActionExecutions[0]?.taskId,
        asyncActions: asyncActionExecutions,
      });
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
  logApp.info('[WORKFLOW] resolvePendingWorkflowTransition', { entityId, found: !!instanceEntity, pending_status: instanceEntity?.pending_status, executionUser: executionUser?.id });
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
  // Use SYSTEM_USER so workflow-instance look-ups succeed regardless of the
  // calling user's capabilities (e.g. a connector user reporting work completion
  // does not have access to internal WorkflowInstance entities).
  const systemContext = createExecutionContext('workflow_resolution', SYSTEM_USER);
  const systemUser = SYSTEM_USER;

  logApp.info('[WORKFLOW] resolvePendingWorkflowTransitionByWorkId called', { workId, success, reason });

  let pendingInstance: WorkflowInstanceStoreEntity | null = await loadEntity(systemContext, systemUser, [ENTITY_TYPE_WORKFLOW_INSTANCE], {
    filters: {
      mode: FilterMode.And,
      filters: [
        { key: ['pending_status'], values: ['pending'] },
        { key: ['pending_work_id'], values: [workId] },
      ],
      filterGroups: [],
    },
  }) as WorkflowInstanceStoreEntity;

  logApp.info('[WORKFLOW] primary lookup result', { workId, found: !!pendingInstance, instanceId: pendingInstance?.id ?? pendingInstance?.internal_id });

  // Fallback path for out-of-order async completion events: if a workId from
  // the tracked list finishes before it becomes the current pending_work_id,
  // find the matching pending transition by scanning pending instances.
  if (!pendingInstance) {
    const pendingInstances = await fullEntitiesList<WorkflowInstanceStoreEntity>(systemContext, systemUser, [ENTITY_TYPE_WORKFLOW_INSTANCE], {
      filters: {
        mode: FilterMode.And,
        filters: [
          { key: ['pending_status'], values: ['pending'] },
        ],
        filterGroups: [],
      },
    });
    logApp.info('[WORKFLOW] fallback scan', { workId, totalPendingInstances: pendingInstances.length });
    pendingInstance = pendingInstances.find((instance) => {
      const pendingTransition = parsePendingTransition(instance);
      const trackedWorkIds = getPendingTransitionWorkIds(pendingTransition);
      return trackedWorkIds.includes(workId);
    }) || null;
    logApp.info('[WORKFLOW] fallback scan result', { workId, found: !!pendingInstance });
  }

  if (!pendingInstance) {
    logApp.info('[WORKFLOW] no pending instance found for workId, skipping', { workId });
    return;
  }

  const pendingTransition = parsePendingTransition(pendingInstance);
  const trackedWorkIds = getPendingTransitionWorkIds(pendingTransition);
  logApp.info('[WORKFLOW] pending instance found', { workId, instanceId: pendingInstance.id ?? pendingInstance.internal_id, trackedWorkIds, hasAsyncActions: !!pendingTransition?.asyncActions?.length, asyncActions: pendingTransition?.asyncActions });

  if (trackedWorkIds.length === 0 || !trackedWorkIds.includes(workId)) {
    logApp.info('[WORKFLOW] workId not in trackedWorkIds, skipping', { workId, trackedWorkIds });
    return;
  }

  const instanceId = pendingInstance.id || pendingInstance.internal_id;
  const hasAsyncActionTracking = !!pendingTransition?.asyncActions?.length;

  if (hasAsyncActionTracking) {
    const asyncActions = (pendingTransition?.asyncActions ?? []).map((action) => ({ ...action }));
    const matchedAction = asyncActions.find((action) => action.workId === workId);
    logApp.info('[WORKFLOW] async tracking branch', { workId, matchedAction, asyncActions });
    if (!matchedAction) {
      logApp.info('[WORKFLOW] no matched action for workId, skipping', { workId, asyncActions });
      return;
    }

    if (success) {
      matchedAction.status = 'success';
      matchedAction.error = undefined;
    } else {
      matchedAction.status = 'failed';
      matchedAction.error = reason || 'Background work failed.';
    }

    const nextPendingTransition = syncPendingTransitionTracking({
      ...pendingTransition!,
      asyncActions,
    });

    const stillPendingActions = asyncActions.filter((action) => action.status === 'pending' && !!action.workId);
    const failedActions = asyncActions.filter((action) => action.status === 'failed');
    logApp.info('[WORKFLOW] after update', { workId, stillPendingActions: stillPendingActions.length, failedActions: failedActions.length });

    if (!success || failedActions.length > 0) {
      const failureReason = reason
        || failedActions[0]?.error
        || 'Pending transition failed.';
      await updateAttribute(systemContext, systemUser, instanceId, ENTITY_TYPE_WORKFLOW_INSTANCE, [
        { key: 'pending_status', value: ['failed'] },
        { key: 'pending_work_id', value: [stillPendingActions[0]?.workId ?? null] },
        { key: 'pending_transition', value: [JSON.stringify(nextPendingTransition)] },
        { key: 'pending_error', value: [failureReason] },
      ]);
      return;
    }

    if (stillPendingActions.length > 0) {
      await updateAttribute(systemContext, systemUser, instanceId, ENTITY_TYPE_WORKFLOW_INSTANCE, [
        { key: 'pending_work_id', value: [stillPendingActions[0].workId] },
        { key: 'pending_transition', value: [JSON.stringify(nextPendingTransition)] },
      ]);
      return;
    }

    logApp.info('[WORKFLOW] all async actions done, resolving transition', { workId, entityId: pendingInstance.entity_id });
    await resolvePendingWorkflowTransition(
      systemContext,
      systemUser,
      pendingInstance.entity_id,
      true,
      reason,
    );
    return;
  }

  if (success) {
    const completedWorkIds = Array.from(new Set([...(pendingTransition?.completedWorkIds ?? []), workId]));
    const remainingWorkIds = trackedWorkIds.filter((id) => !completedWorkIds.includes(id));

    if (remainingWorkIds.length > 0) {
      const nextPendingTransition: WorkflowPendingTransition = {
        ...pendingTransition!,
        workId: remainingWorkIds[0],
        workIds: trackedWorkIds.length > 1 ? trackedWorkIds : undefined,
        completedWorkIds,
      };
      await updateAttribute(systemContext, systemUser, instanceId, ENTITY_TYPE_WORKFLOW_INSTANCE, [
        { key: 'pending_work_id', value: [remainingWorkIds[0]] },
        { key: 'pending_transition', value: [JSON.stringify(nextPendingTransition)] },
      ]);
      return;
    }
  }

  await resolvePendingWorkflowTransition(
    systemContext,
    systemUser,
    pendingInstance.entity_id,
    success,
    reason,
  );
};

export const retryPendingWorkflowTransitionActions = async (
  context: AuthContext,
  user: AuthUser,
  entityId: string,
  actionIds?: string[],
): Promise<TriggerResult> => {
  const entity = await storeLoadById(context, user, entityId, 'Basic-Object');
  if (!entity) {
    throw FunctionalError('Entity not found', { entityId });
  }

  const executionContext = bypassDraftContext(context);
  const executionUser = executionContext.user!;
  const effectiveEntityId = entity.internal_id || entity.id;
  const instanceEntity = await findWorkflowInstanceEntity(executionContext, executionUser, effectiveEntityId);
  if (!instanceEntity || normalizePendingStatus(instanceEntity.pending_status) !== 'failed') {
    return {
      success: false,
      executionStatus: 'failed',
      reason: 'No failed pending transition to retry.',
      entity,
    };
  }

  const pendingTransition = parsePendingTransition(instanceEntity);
  const asyncActions = pendingTransition?.asyncActions ? pendingTransition.asyncActions.map((action) => ({ ...action })) : [];
  if (!pendingTransition || asyncActions.length === 0) {
    return {
      success: false,
      executionStatus: 'failed',
      reason: 'Pending transition does not contain retryable async actions.',
      entity,
    };
  }

  const retryableActions = asyncActions.filter((action) => action.status === 'failed');
  const selectedActions = retryableActions.filter((action) => !actionIds || actionIds.length === 0 || actionIds.includes(action.id));

  if (selectedActions.length === 0) {
    return {
      success: false,
      executionStatus: 'failed',
      reason: 'No failed async actions selected for retry.',
      entity,
    };
  }

  const actionEntity = await storeLoadById(context, user, entityId, 'Basic-Object') || entity;
  const workflowActionContext = {
    entity: actionEntity,
    user,
    context,
  };

  for (const action of selectedActions) {
    const actionFn = ActionRegistry[action.type];
    if (!actionFn) {
      return {
        success: false,
        executionStatus: 'failed',
        reason: `Action type '${action.type}' not found in registry.`,
        entity,
      };
    }
    const actionResult = await actionFn(workflowActionContext, action.params);
    if (!actionResult || typeof actionResult !== 'object' || !actionResult.workId) {
      return {
        success: false,
        executionStatus: 'failed',
        reason: `Async retry for action '${action.type}' didn't return a valid workId.`,
        entity,
      };
    }
    action.status = 'pending';
    action.taskId = actionResult.taskId;
    action.workId = actionResult.workId;
    action.error = undefined;
  }

  const nextPendingTransition = syncPendingTransitionTracking({
    ...pendingTransition,
    asyncActions,
  });

  const instanceId = instanceEntity.internal_id || instanceEntity.id;
  await updateAttribute(executionContext, executionUser, instanceId, ENTITY_TYPE_WORKFLOW_INSTANCE, [
    { key: 'pending_status', value: ['pending'] },
    { key: 'pending_work_id', value: [nextPendingTransition.workId ?? null] },
    { key: 'pending_transition', value: [JSON.stringify(nextPendingTransition)] },
    { key: 'pending_error', value: [null] },
  ]);

  const workflowInstance = await getWorkflowInstance(executionContext, executionUser, entityId);
  return {
    success: true,
    executionStatus: 'pending',
    pendingTransition: nextPendingTransition,
    instance: workflowInstance,
    entity,
  };
};
