import type { Resolvers } from '../../generated/graphql';
import {
  addCustomView,
  editCustomView,
  getCustomViewsSettings,
  getCustomViewByIdForDisplay,
  getCustomViewsDisplayContext,
  computeCustomViewPath,
  getCustomViewById,
  customViewImportWidgetConfiguration,
} from './customView-domain';

const customViewResolver: Resolvers = {
  Query: {
    customViewDisplay: (_parent, { id }, context) => {
      return getCustomViewByIdForDisplay(context, context.user, id);
    },
    customViewsDisplayContext: (_parent, _args, context) => {
      return getCustomViewsDisplayContext(context, context.user);
    },
    customViewsSettings: (_parent, { entityType }, context) => {
      return getCustomViewsSettings(context, context.user, entityType);
    },
    customView: (_parent, { id }, context) => {
      return getCustomViewById(context, context.user, id);
    },
  },
  CustomView: {
    path: (customView) => {
      return computeCustomViewPath(customView);
    },
  },
  Mutation: {
    customViewAdd: (_, { input }, context) => {
      return addCustomView(context, context.user, input);
    },
    customViewEdit: (_, { id, input }, context) => {
      return editCustomView(context, context.user, id, input);
    },
    customViewWidgetConfigurationImport: (_, { id, input }, context) => {
      return customViewImportWidgetConfiguration(context, context.user, id, input);
    },
  },
};

export default customViewResolver;
