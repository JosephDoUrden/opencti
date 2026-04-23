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
import { createWork, reportExpectation, updateExpectationsNumber } from '../../../domain/work';
import { DRAFT_VALIDATION_CONNECTOR } from '../../draftWorkspace/draftWorkspace-connector';
import type { AsyncActionResult, Context } from '../types/workflow-types';

export type ActionFunction<TContext extends Context = Context> = (ctx: TContext, params?: any) => Promise<void | AsyncActionResult> | void | AsyncActionResult;

// Workflow definitions use SHARE/UNSHARE; these are remapped to the _MULTIPLE
// variants internally since we always dispatch a list task.
const SHARING_ACTION_REMAP: Record<string, string> = {
  SHARE: 'SHARE_MULTIPLE',
  UNSHARE: 'UNSHARE_MULTIPLE',
};

// Maps the workflow-facing action type (pre-remap) to the semantic target type
// used in the action summary. Add new entries here as new action types are introduced.
const TARGET_TYPE_BY_ACTION: Record<string, string> = {
  SHARE: 'organization',
  UNSHARE: 'organization',
};

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
  fail: async (_ctx, params) => {
    throw new Error(params?.message || 'Workflow action failed (test)');
  },
  failAsync: async (ctx, params) => {
    // Creates a real work entry and immediately marks it as failed — no worker needed.
    // Use mode: "async" in the transition definition to test the full async error path.
    const { entity, user, context } = ctx;
    const entityId = entity.internal_id || entity.id;
    const work = await createWork(context, user, DRAFT_VALIDATION_CONNECTOR, '[DEV] Async fail test', entityId);
    if (!work) throw new Error('failAsync: could not create work entry');
    await updateExpectationsNumber(context, user, work.id, 1);
    await reportExpectation(context, user, work.id, {
      error: params?.message || 'Async workflow action failed (test)',
      source: 'failAsync action',
    });
    return { workId: work.id };
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

    // Normalize action types: uppercase, then remap SHARE→SHARE_MULTIPLE etc.
    const normalizedActions = (params?.actions ?? []).map((a: any) => {
      const upperType = typeof a?.type === 'string' ? a.type.toUpperCase() : a?.type;
      return { ...a, originalType: upperType, type: SHARING_ACTION_REMAP[upperType] ?? upperType };
    });

    const normalizedActionSummary = normalizedActions
      .map((a: any) => String(a?.originalType ?? a?.type ?? ''))
      .filter((type: string) => type.length > 0)
      .map((type: string) => type.toLowerCase().replace(/_/g, ' '))
      .join(', ');

    // Determine if any action requires filtering to shareable elements only.
    const hasSharingAction = normalizedActions.some((a: any) => {
      const t = String(a?.originalType ?? a?.type ?? '');
      return t === 'SHARE' || t === 'UNSHARE';
    });

    if (entity.entity_type === 'DraftWorkspace' && !params?.ids) {
      const draftContext = { ...context, draft_context: targetId };
      const objects = await listDraftObjects(draftContext, user, { draftId: targetId, first: 5000 });
      const relations = await listDraftRelations(draftContext, user, { draftId: targetId, first: 5000 });
      const sightings = await listDraftSightingRelations(draftContext, user, { draftId: targetId, first: 5000 });

      const normalizeNodes = (edges: any[]) => edges
        .map((e: any) => e.node)
        .filter((node: any) => !hasSharingAction || isShareableDraftElement(node))
        .map((node: any) => node.internal_id);

      ids = [
        ...normalizeNodes(objects?.edges ?? []),
        ...normalizeNodes(relations?.edges ?? []),
        ...normalizeNodes(sightings?.edges ?? []),
      ];
    }

    const input = {
      ids,
      scope: params?.scope,
      actions: normalizedActions.map(({ originalType: _o, ...rest }: any) => rest),
      description: params?.description ?? `Workflow async action (${normalizedActionSummary || 'task'}) for ${entity.internal_id || entity.id}`,
      orderMode: params?.orderMode,
    };
    const task = await createListTask(context, user, input);

    // Build a summary describing what this action does, captured now while ids.length is known.
    const primaryOriginalType = String(normalizedActions[0]?.originalType ?? '');
    const targetType = TARGET_TYPE_BY_ACTION[primaryOriginalType];
    const targetIds: string[] = normalizedActions.flatMap((a: any) => a?.context?.values ?? []);
    const operation = primaryOriginalType.toLowerCase().replace(/_multiple$/, '');
    const summary = {
      affectedCount: ids.length,
      ...(targetType ? { targetType } : {}),
      ...(targetIds.length > 0 ? { targetIds } : {}),
      ...(operation ? { operation } : {}),
    };

    return { taskId: task?.id, workId: task?.work_id, summary };
  },
  // Alias to expose a clearer action name in workflow definitions while keeping compatibility.
  asyncListTask: async (ctx, params) => ActionRegistry.backgroundListTask(ctx, params),
};
