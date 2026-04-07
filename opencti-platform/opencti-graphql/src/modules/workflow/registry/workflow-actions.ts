import { logApp } from '../../../config/conf';
import { createListTask } from '../../../domain/backgroundTask-common';
import { draftWorkspaceEditAuthorizedMembers, validateDraftWorkspace } from '../../draftWorkspace/draftWorkspace-domain';
import type { AsyncActionResult, Context } from '../types/workflow-types';

export type ActionFunction<TContext extends Context = Context> =
  (ctx: TContext, params?: any) => Promise<void | AsyncActionResult> | void | AsyncActionResult;

export const ActionRegistry: Record<string, ActionFunction> = {
  // actions examples:
  log: async (ctx, params) => {
    // eslint-disable-next-line no-console
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
    const ids = params?.ids ?? [entity.internal_id || entity.id];
    const input = {
      ids,
      scope: params?.scope,
      actions: params?.actions,
      description: params?.description ?? `Workflow async action for ${entity.internal_id || entity.id}`,
      orderMode: params?.orderMode,
    };
    const task = await createListTask(context, user, input);
    return {
      taskId: task?.id,
      workId: task?.work_id,
    };
  },
};
