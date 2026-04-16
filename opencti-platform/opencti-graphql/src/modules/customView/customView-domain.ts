import slugify from 'slug';
import { fullEntitiesList, storeLoadById } from '../../database/middleware-loader';
import type { AuthContext, AuthUser } from '../../types/user';
import { ENTITY_TYPE_CUSTOM_VIEW, type BasicStoreEntityCustomView, type StoreEntityCustomView } from './customView-types';
import {
  FilterMode,
  type CustomViewAddInput,
  type CustomViewDisplayContext,
  type CustomViewsDisplayContext,
  type EditInput,
  type ImportWidgetInput,
} from '../../generated/graphql';
import {
  ENTITY_TYPE_CONTAINER_NOTE,
  ENTITY_TYPE_CONTAINER_OBSERVED_DATA,
  ENTITY_TYPE_CONTAINER_OPINION,
  ENTITY_TYPE_COURSE_OF_ACTION,
  ENTITY_TYPE_DATA_COMPONENT,
  ENTITY_TYPE_DATA_SOURCE,
} from '../../schema/stixDomainObject';
import { ENTITY_TYPE_SECURITY_COVERAGE } from '../securityCoverage/securityCoverage-types';
import { ENTITY_TYPE_CONTAINER_TASK } from '../task/task-types';
import { ENTITY_TYPE_CONTAINER_FEEDBACK } from '../case/feedback/feedback-types';
import { ABSTRACT_STIX_CORE_RELATIONSHIP, ABSTRACT_STIX_CYBER_OBSERVABLE, ABSTRACT_STIX_DOMAIN_OBJECT } from '../../schema/general';
import { schemaTypesDefinition } from '../../schema/schema-types';
import { ENTITY_HASHED_OBSERVABLE_ARTIFACT } from '../../schema/stixCyberObservable';
import { createEntity, updateAttribute } from '../../database/middleware';
import { now } from '../../utils/format';
import { publishUserAction } from '../../listener/UserActionListener';
import { notify } from '../../database/redis';
import { BUS_TOPICS } from '../../config/conf';
import { exportWidget, processImportWidgetConfiguration, sanitizeElementForPublishAction } from '../workspace/workspace-domain';

/**
 * Exclusion list: entity types not capable of
 * having custom views.
 */
const ENTITY_TYPES_WITHOUT_CUSTOM_VIEWS = [
  ENTITY_TYPE_CONTAINER_NOTE,
  ENTITY_TYPE_CONTAINER_OBSERVED_DATA,
  ENTITY_TYPE_CONTAINER_TASK,
  ENTITY_TYPE_CONTAINER_FEEDBACK,
  ENTITY_TYPE_CONTAINER_OPINION,
  ENTITY_TYPE_COURSE_OF_ACTION,
  ENTITY_TYPE_DATA_COMPONENT,
  ENTITY_TYPE_DATA_SOURCE,
  ENTITY_TYPE_SECURITY_COVERAGE,
];

function isCustomViewsAvailableForEntityType(entityType: string) {
  const candidateTypes = [
    ...schemaTypesDefinition
      .get(ABSTRACT_STIX_DOMAIN_OBJECT),
    ABSTRACT_STIX_CORE_RELATIONSHIP,
    ABSTRACT_STIX_CYBER_OBSERVABLE,
    ENTITY_HASHED_OBSERVABLE_ARTIFACT,
  ];
  return candidateTypes.includes(entityType)
    && !ENTITY_TYPES_WITHOUT_CUSTOM_VIEWS.includes(entityType);
}

export function computeCustomViewPath({ slug, id }: BasicStoreEntityCustomView) {
  return `${slug}-${id.replaceAll('-', '')}`;
}

// View Use Cases (all authed users)

export const getCustomViewByIdForDisplay = async (
  context: AuthContext,
  user: AuthUser,
  customViewId: string,
) => {
  const entity = await storeLoadById<BasicStoreEntityCustomView>(
    context,
    user,
    customViewId,
    ENTITY_TYPE_CUSTOM_VIEW,
  );
  return entity;
};

export const getCustomViewsDisplayContext = async (context: AuthContext, user: AuthUser) => {
  const allCustomViewEntities = await fullEntitiesList<BasicStoreEntityCustomView>(
    context,
    user,
    [ENTITY_TYPE_CUSTOM_VIEW],
  );
  const customViewInfoMap = allCustomViewEntities.reduce((infoMap, customViewEntity) => {
    const infos = infoMap.get(customViewEntity.target_entity_type) ?? [];
    infos.push(customViewEntity);
    infoMap.set(customViewEntity.target_entity_type, infos);
    return infoMap;
  }, new Map<string, BasicStoreEntityCustomView[]>());
  return Array.from(customViewInfoMap.keys()).reduce((acc, targetEntityType) => {
    if (!isCustomViewsAvailableForEntityType(targetEntityType)) {
      return acc;
    }
    const customViewsInfos = customViewInfoMap.get(targetEntityType) ?? [];
    acc.push({
      entity_type: targetEntityType,
      custom_views_info: customViewsInfos,
    });
    return acc;
  }, [] as {
    custom_views_info: BasicStoreEntityCustomView[];
    entity_type: string;
  }[]);
};

// Settings Use Cases (admin users)

export const getCustomViewById = async (context: AuthContext, user: AuthUser, customViewId: string) => {
  return storeLoadById<BasicStoreEntityCustomView>(
    context,
    user,
    customViewId,
    ENTITY_TYPE_CUSTOM_VIEW,
  );
};

export const getCustomViewsSettings = async (
  context: AuthContext,
  user: AuthUser,
  entityType: string,
) => {
  if (!isCustomViewsAvailableForEntityType(entityType)) {
    return {
      canEntityTypeHaveCustomViews: false,
      customViews: [],
    };
  }
  const customViewEntities = await fullEntitiesList<BasicStoreEntityCustomView>(
    context,
    user,
    [ENTITY_TYPE_CUSTOM_VIEW],
    {
      filters: {
        filters: [{
          key: ['target_entity_type'],
          values: [entityType],
        }],
        filterGroups: [],
        mode: FilterMode.And,
      },
    },
  );
  return {
    canEntityTypeHaveCustomViews: true,
    customViews: customViewEntities,
  };
};

export const addCustomView = async (
  context: AuthContext,
  user: AuthUser,
  input: CustomViewAddInput,
) => {
  const created_at = now();
  const customViewToCreate = {
    ...input,
    slug: slugify(input.name),
    created_at,
    updated_at: created_at,
  };
  const entity = await createEntity(
    context,
    user,
    customViewToCreate,
    ENTITY_TYPE_CUSTOM_VIEW,
  );
  return entity;
};

export const editCustomView = async (
  context: AuthContext,
  user: AuthUser,
  customViewId: string,
  input: EditInput[],
) => {
  const nameInput = input.find((i) => i.key === 'name');
  const { element } = await updateAttribute<StoreEntityCustomView>(
    context,
    user,
    customViewId,
    ENTITY_TYPE_CUSTOM_VIEW,
    [
      ...input,
      ...(nameInput ? [{
        key: 'slug',
        value: [slugify(nameInput.value[0])],
      }] : []),
    ],
  );
  await publishUserAction({
    user,
    event_type: 'mutation',
    event_scope: 'update',
    event_access: 'administration',
    message: `updates \`${input.map((i) => i.key).join(', ')}\` for custom view ${element.name}`,
    context_data: { id: element.id, entity_type: ENTITY_TYPE_CUSTOM_VIEW, input },
  });

  await notify(BUS_TOPICS[ENTITY_TYPE_CUSTOM_VIEW].EDIT_TOPIC, element, user);
  return {
    ...element,
    path: computeCustomViewPath(element),
  };
};

export const customViewImportWidgetConfiguration = async (
  context: AuthContext,
  user: AuthUser,
  customViewId: string,
  input: ImportWidgetInput,
) => {
  const { updatedManifest, importedWidgetId } = await processImportWidgetConfiguration(
    context,
    user,
    input,
  );
  const { element } = await updateAttribute<StoreEntityCustomView>(
    context,
    user,
    customViewId,
    ENTITY_TYPE_CUSTOM_VIEW,
    [{ key: 'manifest', value: [updatedManifest] }],
  );

  await publishUserAction({
    user,
    event_type: 'mutation',
    event_scope: 'create',
    event_access: 'extended',
    message: `import widget (id : ${importedWidgetId}) in custom view (id : ${customViewId})`,
    context_data: {
      id: customViewId,
      entity_type: ENTITY_TYPE_CUSTOM_VIEW,
      input: sanitizeElementForPublishAction(element),
    },
  });
  await notify(BUS_TOPICS[ENTITY_TYPE_CUSTOM_VIEW].EDIT_TOPIC, element, user);
  return element;
};

export const exportCustomViewWidget = (
  auth: AuthContext,
  user: AuthUser,
  customView: BasicStoreEntityCustomView,
  widgetId: string,
) => {
  return exportWidget(auth, user, customView, widgetId);
};
