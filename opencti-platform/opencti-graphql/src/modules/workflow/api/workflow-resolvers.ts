import type { AuthContext } from '../../../types/user';
import { loadWorkById } from '../../../domain/work';
import {
  deleteWorkflowDefinition,
  getAllowedNextStatuses,
  getAllowedTransitions,
  getWorkflowDefinition,
  getWorkflowInstance,
  reconcileWorkflowTransitionForEntity,
  retryPendingWorkflowTransitionActions,
  resolvePendingWorkflowTransition,
  setWorkflowDefinition,
  triggerWorkflowEvent,
} from '../domain/workflow-domain';

const workflowResolvers = {
  Query: {
    workflowDefinition: (_: any, { entityType }: { entityType: string }, context: AuthContext) => {
      return getWorkflowDefinition(context, context.user!, entityType);
    },
    workflowInstance: async (_: any, { entityId }: { entityId: string }, context: AuthContext) => {
      const instance = await getWorkflowInstance(context, context.user!, entityId);
      if (instance?.pendingStatus === 'pending' && instance?.pendingTransition) {
        const asyncActions = instance.pendingTransition.asyncActions ?? [];
        const pendingActionWorkIds: string[] = asyncActions
          .filter((a: any) => a.status === 'pending' && a.workId)
          .map((a: any) => a.workId as string);

        if (pendingActionWorkIds.length > 0) {
          // Load all pending works in parallel, then reconcile in one pass.
          const workResults = await Promise.all(
            pendingActionWorkIds.map(async (wid: string) => {
              const work = await loadWorkById(context, context.user!, wid) as any;
              if (!work) return { workId: wid, success: false, error: 'Background work no longer exists.' };
              if (work.status !== 'complete') return null;
              const hasErrors = (work.errors?.length ?? 0) > 0;
              return {
                workId: wid,
                success: !hasErrors,
                error: hasErrors ? (work.errors[0]?.message || 'Background work completed with errors.') : undefined,
              };
            }),
          );
          const completedResults = workResults.filter((r): r is NonNullable<typeof r> => r !== null);
          if (completedResults.length > 0) {
            await reconcileWorkflowTransitionForEntity(context, context.user!, entityId, completedResults);
            return getWorkflowInstance(context, context.user!, entityId);
          }
        }
      }
      return instance;
    },
    allowedNextStatuses: (_: any, { entityId }: { entityId: string }, context: AuthContext) => {
      return getAllowedNextStatuses(context, context.user!, entityId);
    },
    allowedTransitions: (_: any, { entityId }: { entityId: string }, context: AuthContext) => {
      return getAllowedTransitions(context, context.user!, entityId);
    },
  },
  Mutation: {
    workflowDefinitionSet: (_: any, { entityType, definition }: { entityType: string; definition: string }, context: AuthContext) => {
      return setWorkflowDefinition(context, context.user!, entityType, definition);
    },
    workflowDefinitionDelete: (_: any, { entityType }: { entityType: string }, context: AuthContext) => {
      return deleteWorkflowDefinition(context, context.user!, entityType);
    },
    triggerWorkflowEvent: (_: any, { entityId, eventName, runtimeParams }: { entityId: string; eventName: string; runtimeParams?: Record<string, unknown> }, context: AuthContext) => {
      return triggerWorkflowEvent(context, context.user!, entityId, eventName, runtimeParams);
    },
    resolvePendingWorkflowTransition: (
      _: any,
      { entityId, success, reason }: { entityId: string; success: boolean; reason?: string },
      context: AuthContext,
    ) => {
      return resolvePendingWorkflowTransition(context, context.user!, entityId, success, reason);
    },
    retryPendingWorkflowTransitionActions: (
      _: any,
      { entityId, actionIds }: { entityId: string; actionIds?: string[] },
      context: AuthContext,
    ) => {
      return retryPendingWorkflowTransitionActions(context, context.user!, entityId, actionIds);
    },
  },
  WorkflowInstance: {
    id: (instance: any) => instance.id || instance.internal_id,
    currentState: (instance: any) => instance.currentState,
    currentStatus: (instance: any) => ({ id: instance.currentState, template_id: instance.currentState }),
    pendingStatus: (instance: any) => instance.pendingStatus,
    pendingError: (instance: any) => instance.pendingError,
    pendingTransition: (instance: any) => instance.pendingTransition,
    allowedTransitions: (instance: any) => instance.allowedTransitions,
  },
  WorkflowTransition: {
    toStatus: (transition: any) => ({ id: transition.toState, template_id: transition.toState }),
    actions: (transition: any) => transition.actions ?? [],
  },
  WorkflowSerializedState: {
    onEnter: (state: any) => (Array.isArray(state.onEnter) ? state.onEnter : []),
    onExit: (state: any) => (Array.isArray(state.onExit) ? state.onExit : []),
  },
  WorkflowSerializedTransition: {
    actions: (t: any) => (Array.isArray(t.actions) ? t.actions : []),
    conditions: (t: any) => (Array.isArray(t.conditions) ? t.conditions : []),
  },
  WorkflowSchema: {
    states: (schema: any) => (Array.isArray(schema.states) ? schema.states : []),
    transitions: (schema: any) => (Array.isArray(schema.transitions) ? schema.transitions : []),
  },
  WorkflowTriggerResult: {
    status: (result: any) => (result.newState ? { id: result.newState, template_id: result.newState } : null),
    executionStatus: (result: any) => result.executionStatus,
    pendingTransition: (result: any) => result.pendingTransition,
    instance: (result: any) => result.instance,
    entity: (result: any) => result.entity,
  },
  DraftWorkspace: {
    workflowInstance: (draft: any, _: any, context: AuthContext) => {
      const draftId = draft.id || draft.internal_id;
      return getWorkflowInstance(context, context.user!, draftId);
    },
  },
};

export default workflowResolvers;
