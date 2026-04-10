import { deleteTask, createQueryTask, findBackgroundTaskPaginated, findById } from '../domain/backgroundTask';
import { createListTask } from '../domain/backgroundTask-common';
import { ENTITY_TYPE_WORK } from '../schema/internalObject';
import { loadCreator } from '../database/members';
import { worksForBackgroundTask } from '../domain/work';

const taskResolvers = {
  Query: {
    backgroundTask: (_, { id }, context) => findById(context, context.user, id),
    backgroundTasks: (_, args, context) => findBackgroundTaskPaginated(context, context.user, args),
  },
  Mutation: {
    listTaskAdd: (_, { input }, context) => createListTask(context, context.user, input),
    queryTaskAdd: (_, { input }, context) => createQueryTask(context, context.user, input),
    deleteBackgroundTask: (_, { id }, context) => deleteTask(context, context.user, id),
  },
  BackgroundTask: {
    __resolveType(obj) {
      if (obj.type === 'QUERY') return 'QueryTask';
      if (obj.type === 'LIST') return 'ListTask';
      if (obj.type === 'RULE') return 'RuleTask';
      /* v8 ignore next */
      return 'Unknown';
    },
    initiator: (task, _, context) => loadCreator(context, context.user, task.initiator_id),
    work: async (task, _, context) => {
      if (task.work_id) {
        return context.batch.idsBatchLoader.load({ id: task.work_id, type: ENTITY_TYPE_WORK });
      }
      // Fallback for tasks where work_id has not been persisted yet.
      const fallbackWorks = await worksForBackgroundTask(context, context.user, task.id, { first: 1 });
      return fallbackWorks.length > 0 ? fallbackWorks[0] : undefined;
    },
  },
};

export default taskResolvers;
