import type { AuthContext } from '../../../types/user';
import {
  deleteWorkflowDefinition,
  getAllowedNextStatuses,
  getAllowedTransitions,
  getWorkflowDefinition,
  getWorkflowInstance,
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
    workflowInstance: (_: any, { entityId }: { entityId: string }, context: AuthContext) => {
      // Logic for resolving workflowInstance
      return getWorkflowInstance(context, context.user!, entityId);
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
    triggerWorkflowEvent: (_: any, { entityId, eventName }: { entityId: string; eventName: string }, context: AuthContext) => {
      return triggerWorkflowEvent(context, context.user!, entityId, eventName);
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
