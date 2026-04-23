import { FunctionalError } from '../../../config/errors';
import { logApp } from '../../../config/conf';
import { createEntity, createRelation, loadEntity, updateAttribute } from '../../../database/middleware';
import { storeLoadById } from '../../../database/middleware-loader';
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
  type WorkflowTransitionPhase,
} from '../types/workflow-types';
import type { BasicStoreEntity } from '../../../types/store';
import { executionContext as createExecutionContext, SYSTEM_USER } from '../../../utils/access';
import { bypassDraftContext } from '../../../utils/draftContext';

interface WorkflowInstanceStoreEntity extends BasicStoreEntity {
  entity_id: string;
  currentState: string;
  history: string;
  pending_status?: string;
  pending_work_ids?: string[];
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
    if (!Array.isArray(pendingTransition?.phases) || typeof pendingTransition?.currentPhaseIndex !== 'number') {
      return null;
    }
    return pendingTransition;
  } catch {
    return null;
  }
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

/**
 * Splits a flat action list into phases: one phase per async action (plus its preceding
 * sync actions), with an optional trailing sync-only phase if the list ends with syncs.
 *
 * Example: [sync1, async1, sync2, async2, sync3]
 *   → Phase 0: syncActionDefs=[sync1], asyncActionDef=async1
 *   → Phase 1: syncActionDefs=[sync2], asyncActionDef=async2
 *   → Phase 2: syncActionDefs=[sync3]  (trailing sync-only)
 */
const buildTransitionPhases = (
  actions: Array<{ type: string; params?: any; mode?: string }>,
): WorkflowTransitionPhase[] => {
  const phases: WorkflowTransitionPhase[] = [];
  let syncBuffer: Array<{ type: string; params?: any }> = [];
  for (const action of actions) {
    if (action.mode !== 'async') {
      syncBuffer.push({ type: action.type, params: action.params });
    } else {
      phases.push({ syncActionDefs: syncBuffer, asyncActionDef: { type: action.type, params: action.params } });
      syncBuffer = [];
    }
  }
  if (syncBuffer.length > 0) {
    phases.push({ syncActionDefs: syncBuffer });
  }
  return phases;
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

  // Compute asyncActions for GQL consumers by flattening dispatched phases
  const gqlPendingTransition = pendingTransition
    ? {
      ...pendingTransition,
      asyncActions: pendingTransition.phases.flatMap((p) => (p.asyncAction ? [p.asyncAction] : [])),
    }
    : null;

  return {
    id,
    internal_id: id,
    __typename: 'WorkflowInstance',
    currentState: currentState || '',
    pendingStatus,
    pendingError,
    pendingTransition: gqlPendingTransition,
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
      const phases = buildTransitionPhases(transitionActions);

      // Validate all action types exist before executing anything
      for (const phase of phases) {
        for (const syncDef of phase.syncActionDefs) {
          if (!ActionRegistry[syncDef.type]) {
            return { success: false, executionStatus: 'failed', reason: `Action type '${syncDef.type}' not found in registry.`, entity };
          }
        }
        if (phase.asyncActionDef && !ActionRegistry[phase.asyncActionDef.type]) {
          return { success: false, executionStatus: 'failed', reason: `Action type '${phase.asyncActionDef.type}' not found in registry.`, entity };
        }
      }

      // Execute phase 0: run its sync actions, then dispatch its async action
      const phase0 = phases[0];
      for (const syncDef of phase0.syncActionDefs) {
        await ActionRegistry[syncDef.type]!(workflowActionContext, syncDef.params);
      }

      const asyncDef0 = phase0.asyncActionDef!;
      const actionResult0 = await ActionRegistry[asyncDef0.type]!(workflowActionContext, asyncDef0.params);
      if (!actionResult0 || typeof actionResult0 !== 'object' || !actionResult0.workId) {
        return { success: false, executionStatus: 'failed', reason: `Async action '${asyncDef0.type}' didn't return a valid workId.`, entity };
      }

      const phase0AsyncAction: WorkflowPendingAsyncAction = {
        id: `${asyncDef0.type}-0`,
        type: asyncDef0.type,
        params: asyncDef0.params,
        status: 'pending',
        taskId: actionResult0.taskId,
        workId: actionResult0.workId,
        summary: actionResult0.summary,
      };
      const initializedPhases = phases.map((p, i) => (
        i === 0 ? { ...p, asyncAction: phase0AsyncAction } : { ...p }
      ));
      const pendingTransition: WorkflowPendingTransition = {
        id: `${eventName}-${Date.now()}`,
        event: eventName,
        fromState: transition.from,
        toState: transition.to,
        startedAt: new Date().toISOString(),
        phases: initializedPhases,
        currentPhaseIndex: 0,
      };
      const instanceId = instanceEntity.internal_id || instanceEntity.id;
      await updateAttribute(executionContext, executionUser, instanceId, ENTITY_TYPE_WORKFLOW_INSTANCE, [
        { key: 'pending_status', value: ['pending'] },
        { key: 'pending_work_ids', value: [actionResult0.workId] },
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
        { key: 'pending_work_ids', value: [] },
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
    { key: 'pending_work_ids', value: [] },
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

/**
 * Advances the pending transition to the next phase.
 * - Runs the next phase's sync actions.
 * - If the next phase has an async action, dispatches it and writes the new workId.
 * - If there are no more phases (or the next phase is sync-only), calls resolvePendingWorkflowTransition.
 */
const startNextPhaseOrFinalize = async (
  executionContext: AuthContext,
  executionUser: AuthUser,
  actionContext: { entity: any; user: AuthUser; context: AuthContext },
  instanceId: string,
  entityId: string,
  pendingTransition: WorkflowPendingTransition,
): Promise<void> => {
  const nextPhaseIndex = pendingTransition.currentPhaseIndex + 1;

  if (nextPhaseIndex >= pendingTransition.phases.length) {
    await resolvePendingWorkflowTransition(executionContext, executionUser, entityId, true);
    return;
  }

  const nextPhase = pendingTransition.phases[nextPhaseIndex];

  // Run sync actions for the next phase
  for (const syncDef of nextPhase.syncActionDefs) {
    const actionFn = ActionRegistry[syncDef.type];
    if (!actionFn) {
      await updateAttribute(executionContext, executionUser, instanceId, ENTITY_TYPE_WORKFLOW_INSTANCE, [
        { key: 'pending_status', value: ['failed'] },
        { key: 'pending_error', value: [`Action type '${syncDef.type}' not found in registry.`] },
      ]);
      return;
    }
    await actionFn(actionContext, syncDef.params);
  }

  // Trailing sync-only phase — nothing left to dispatch, finalize
  if (!nextPhase.asyncActionDef) {
    await resolvePendingWorkflowTransition(executionContext, executionUser, entityId, true);
    return;
  }

  // Dispatch the next phase's async action
  const asyncDef = nextPhase.asyncActionDef;
  const asyncActionFn = ActionRegistry[asyncDef.type];
  if (!asyncActionFn) {
    await updateAttribute(executionContext, executionUser, instanceId, ENTITY_TYPE_WORKFLOW_INSTANCE, [
      { key: 'pending_status', value: ['failed'] },
      { key: 'pending_error', value: [`Async action type '${asyncDef.type}' not found in registry.`] },
    ]);
    return;
  }

  const actionResult = await asyncActionFn(actionContext, asyncDef.params);
  if (!actionResult || typeof actionResult !== 'object' || !actionResult.workId) {
    await updateAttribute(executionContext, executionUser, instanceId, ENTITY_TYPE_WORKFLOW_INSTANCE, [
      { key: 'pending_status', value: ['failed'] },
      { key: 'pending_error', value: [`Async action '${asyncDef.type}' didn't return a valid workId.`] },
    ]);
    return;
  }

  const dispatchedAsyncAction: WorkflowPendingAsyncAction = {
    id: `${asyncDef.type}-${nextPhaseIndex}`,
    type: asyncDef.type,
    params: asyncDef.params,
    status: 'pending',
    taskId: actionResult.taskId,
    workId: actionResult.workId,
    summary: actionResult.summary,
  };

  const updatedPhases = pendingTransition.phases.map((p, i) => (
    i === nextPhaseIndex ? { ...p, asyncAction: dispatchedAsyncAction } : { ...p }
  ));
  const updatedTransition: WorkflowPendingTransition = {
    ...pendingTransition,
    phases: updatedPhases,
    currentPhaseIndex: nextPhaseIndex,
  };

  await updateAttribute(executionContext, executionUser, instanceId, ENTITY_TYPE_WORKFLOW_INSTANCE, [
    { key: 'pending_work_ids', value: [actionResult.workId] },
    { key: 'pending_transition', value: [JSON.stringify(updatedTransition)] },
  ]);
};

export const resolvePendingWorkflowTransitionByWorkId = async (
  _context: AuthContext,
  _user: AuthUser,
  workId: string,
  success: boolean,
  reason?: string,
): Promise<void> => {
  // Use SYSTEM_USER so look-ups succeed regardless of the calling user's capabilities.
  const systemContext = createExecutionContext('workflow_resolution', SYSTEM_USER);
  const systemUser = SYSTEM_USER;

  const pendingInstance: WorkflowInstanceStoreEntity | null = await loadEntity(systemContext, systemUser, [ENTITY_TYPE_WORKFLOW_INSTANCE], {
    filters: {
      mode: FilterMode.And,
      filters: [
        { key: ['pending_status'], values: ['pending'] },
        { key: ['pending_work_ids'], values: [workId] },
      ],
      filterGroups: [],
    },
  }) as WorkflowInstanceStoreEntity;

  if (!pendingInstance) return;

  const pendingTransition = parsePendingTransition(pendingInstance);
  if (!pendingTransition?.phases?.length) return;

  const { currentPhaseIndex } = pendingTransition;
  const currentPhase = pendingTransition.phases[currentPhaseIndex];
  if (!currentPhase?.asyncAction || currentPhase.asyncAction.workId !== workId || currentPhase.asyncAction.status !== 'pending') return;

  const updatedPhases = pendingTransition.phases.map((p, i) => {
    if (i !== currentPhaseIndex || !p.asyncAction) return { ...p };
    return {
      ...p,
      asyncAction: {
        ...p.asyncAction,
        status: success ? ('success' as const) : ('failed' as const),
        error: success ? undefined : (reason || 'Background work failed.'),
      },
    };
  });
  const updatedTransition: WorkflowPendingTransition = { ...pendingTransition, phases: updatedPhases };
  const instanceId = pendingInstance.internal_id || pendingInstance.id;

  if (!success) {
    const failureReason = reason || 'Background work failed.';
    await updateAttribute(systemContext, systemUser, instanceId, ENTITY_TYPE_WORKFLOW_INSTANCE, [
      { key: 'pending_status', value: ['failed'] },
      { key: 'pending_work_ids', value: [] },
      { key: 'pending_transition', value: [JSON.stringify(updatedTransition)] },
      { key: 'pending_error', value: [failureReason] },
    ]);
    return;
  }

  // Persist the success status before advancing to the next phase
  await updateAttribute(systemContext, systemUser, instanceId, ENTITY_TYPE_WORKFLOW_INSTANCE, [
    { key: 'pending_work_ids', value: [] },
    { key: 'pending_transition', value: [JSON.stringify(updatedTransition)] },
  ]);

  const entityForAction = await storeLoadById(systemContext, systemUser, pendingInstance.entity_id, 'Basic-Object');
  const phaseActionContext = { entity: entityForAction, user: systemUser, context: systemContext };
  await startNextPhaseOrFinalize(systemContext, systemUser, phaseActionContext, instanceId, pendingInstance.entity_id, updatedTransition);
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
  if (!pendingTransition) {
    return {
      success: false,
      executionStatus: 'failed',
      reason: 'Pending transition does not contain retryable async actions.',
      entity,
    };
  }

  // Retry operates on the current phase's failed async action only
  const { currentPhaseIndex } = pendingTransition;
  const phases = pendingTransition.phases.map((p) => ({
    ...p,
    asyncAction: p.asyncAction ? { ...p.asyncAction } : undefined,
  }));
  const currentPhase = phases[currentPhaseIndex];
  const asyncAction = currentPhase?.asyncAction;

  if (!asyncAction || asyncAction.status !== 'failed') {
    return {
      success: false,
      executionStatus: 'failed',
      reason: 'No failed async action in current phase.',
      entity,
    };
  }

  if (actionIds && actionIds.length > 0 && !actionIds.includes(asyncAction.id)) {
    return {
      success: false,
      executionStatus: 'failed',
      reason: 'No failed async actions selected for retry.',
      entity,
    };
  }

  const actionEntity = await storeLoadById(context, user, entityId, 'Basic-Object') || entity;
  const workflowActionContext = { entity: actionEntity, user, context };

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
      reason: `Async retry for action '${asyncAction.type}' didn't return a valid workId.`,
      entity,
    };
  }

  // Update current phase with the new workId
  phases[currentPhaseIndex] = {
    ...currentPhase,
    asyncAction: {
      ...asyncAction,
      status: 'pending',
      taskId: actionResult.taskId,
      workId: actionResult.workId,
      error: undefined,
    },
  };

  const nextPendingTransition: WorkflowPendingTransition = { ...pendingTransition, phases };
  const instanceId = instanceEntity.internal_id || instanceEntity.id;
  await updateAttribute(executionContext, executionUser, instanceId, ENTITY_TYPE_WORKFLOW_INSTANCE, [
    { key: 'pending_status', value: ['pending'] },
    { key: 'pending_work_ids', value: [actionResult.workId] },
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

/**
 * Called on each poll of a pending workflow instance. Accepts pre-fetched work results
 * (to avoid a circular dependency with work.js) and reconciles the async-action tracking
 * state — updating individual action statuses, and resolving or failing the transition
 * once all actions have completed.
 */
export const reconcileWorkflowTransitionForEntity = async (
  context: AuthContext,
  user: AuthUser,
  entityId: string,
  workResults: Array<{ workId: string; success: boolean; error?: string }>,
): Promise<void> => {
  const executionContext = bypassDraftContext(context);
  const executionUser = executionContext.user!;
  const entity = await storeLoadById(executionContext, executionUser, entityId, 'Basic-Object');
  if (!entity) return;

  const effectiveEntityId = entity.internal_id || entity.id;
  const instanceEntity = await findWorkflowInstanceEntity(executionContext, executionUser, effectiveEntityId) as WorkflowInstanceStoreEntity | null;
  if (!instanceEntity || !isPendingStatus(instanceEntity.pending_status)) return;

  const pendingTransition = parsePendingTransition(instanceEntity);
  if (!pendingTransition?.phases?.length) return;

  const { currentPhaseIndex } = pendingTransition;
  const currentPhaseAsyncAction = pendingTransition.phases[currentPhaseIndex]?.asyncAction;
  if (!currentPhaseAsyncAction || currentPhaseAsyncAction.status !== 'pending') return;

  const matchingResult = workResults.find((r) => r.workId === currentPhaseAsyncAction.workId);
  if (!matchingResult) return;

  const updatedPhases = pendingTransition.phases.map((p, i) => {
    if (i !== currentPhaseIndex || !p.asyncAction) return { ...p };
    return {
      ...p,
      asyncAction: {
        ...p.asyncAction,
        status: matchingResult.success ? ('success' as const) : ('failed' as const),
        error: matchingResult.success ? undefined : (matchingResult.error || 'Background work failed.'),
      },
    };
  });
  const updatedTransition: WorkflowPendingTransition = { ...pendingTransition, phases: updatedPhases };
  const instanceId = instanceEntity.internal_id || instanceEntity.id;

  if (!matchingResult.success) {
    const failureReason = matchingResult.error || 'Pending transition failed.';
    await updateAttribute(executionContext, executionUser, instanceId, ENTITY_TYPE_WORKFLOW_INSTANCE, [
      { key: 'pending_status', value: ['failed'] },
      { key: 'pending_work_ids', value: [] },
      { key: 'pending_transition', value: [JSON.stringify(updatedTransition)] },
      { key: 'pending_error', value: [failureReason] },
    ]);
    return;
  }

  // Persist the success status before advancing to the next phase
  await updateAttribute(executionContext, executionUser, instanceId, ENTITY_TYPE_WORKFLOW_INSTANCE, [
    { key: 'pending_work_ids', value: [] },
    { key: 'pending_transition', value: [JSON.stringify(updatedTransition)] },
  ]);

  const actionEntity = await storeLoadById(executionContext, executionUser, entityId, 'Basic-Object');
  const phaseActionContext = { entity: actionEntity, user: executionUser, context: executionContext };
  await startNextPhaseOrFinalize(executionContext, executionUser, phaseActionContext, instanceId, entityId, updatedTransition);
};
