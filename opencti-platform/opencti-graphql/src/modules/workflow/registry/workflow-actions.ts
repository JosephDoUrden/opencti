import { logApp } from '../../../config/conf';
import { createListTask } from '../../../domain/backgroundTask-common';
import { DRAFT_OPERATION_CREATE, DRAFT_OPERATION_UPDATE } from '../../draftWorkspace/draftOperations';
import {
  draftWorkspaceEditAuthorizedMembers,
  listDraftObjects,
  listDraftRelations,
  listDraftSightingRelations,
  validateDraftWorkspace,
} from '../../draftWorkspace/draftWorkspace-domain';
import type { AsyncActionResult, Context } from '../types/workflow-types';

export type ActionFunction<TContext extends Context = Context> = (ctx: TContext, params?: any) => Promise<void | AsyncActionResult> | void | AsyncActionResult;

const isShareableDraftElement = (element: any): boolean => {
  const draftOperation = element?.draft_change?.draft_operation;
  // Keep only direct draft changes and ignore linked/delete artifacts.
  if (!draftOperation) {
    return true;
  }
  return draftOperation === DRAFT_OPERATION_CREATE || draftOperation === DRAFT_OPERATION_UPDATE;
};

export const ActionRegistry: Record<string, ActionFunction> = {
  // actions examples:
  log: async (ctx, params) => {
    logApp.info(`[Action: LOG] Context: ${JSON.stringify(ctx)} | Message: ${params?.message || 'No message'}`);
  },
  validateDraft: async (ctx) => {
    const { entity, user, context } = ctx;
    await validateDraftWorkspace(context, user, entity.id);
  },
  updateAuthorizedMembers: async (ctx, params) => {
    const { entity, user, context } = ctx;
    await draftWorkspaceEditAuthorizedMembers(context, user, entity.id, params?.authorized_members);
  },
  backgroundListTask: async (ctx, params) => {
    const { entity, user, context } = ctx;
    const targetId = entity.internal_id || entity.id;
    let ids = params?.ids ?? [targetId];
    const normalizedActions = (params?.actions ?? []).map((a: any) => ({
      ...a,
      type: typeof a?.type === 'string' ? a.type.toUpperCase() : a?.type,
    }));
    const normalizedActionSummary = normalizedActions
      .map((a: any) => String(a?.type ?? ''))
      .filter((type: string) => type.length > 0)
      .map((type: string) => type.toLowerCase().replace(/_/g, ' '))
      .join(', ');

    if (entity.entity_type === 'DraftWorkspace' && !params?.ids) {
      const draftContext = { ...context, draft_context: targetId };
      const objects = await listDraftObjects(draftContext, user, { draftId: targetId, first: 5000 });
      const relations = await listDraftRelations(draftContext, user, { draftId: targetId, first: 5000 });
      const sightings = await listDraftSightingRelations(draftContext, user, { draftId: targetId, first: 5000 });

      ids = [
        ...((objects?.edges ?? [])
          .map((e: any) => e.node)
          .filter(isShareableDraftElement)
          .map((node: any) => node.internal_id)),
        ...((relations?.edges ?? [])
          .map((e: any) => e.node)
          .filter(isShareableDraftElement)
          .map((node: any) => node.internal_id)),
        ...((sightings?.edges ?? [])
          .map((e: any) => e.node)
          .filter(isShareableDraftElement)
          .map((node: any) => node.internal_id)),
      ];
    }

    const input = {
      ids,
      scope: params?.scope,
      actions: normalizedActions,
      description: params?.description ?? `Workflow async action (${normalizedActionSummary || 'list task'}) for ${entity.internal_id || entity.id}`,
      orderMode: params?.orderMode,
    };
    const task = await createListTask(context, user, input);
    return {
      taskId: task?.id,
      workId: task?.work_id,
    };
  },
};
