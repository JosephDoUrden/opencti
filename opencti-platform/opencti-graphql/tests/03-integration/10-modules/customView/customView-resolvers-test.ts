import { beforeAll, describe, expect, it } from 'vitest';
import gql from 'graphql-tag';
import { createEntity } from '../../../../src/database/middleware';
import { ADMIN_USER, testContext, USER_PARTICIPATE } from '../../../utils/testQuery';
import type { CustomViewsDisplayContext } from '../../../../src/generated/graphql';
import { queryAsUserWithSuccess, queryAsAdminWithSuccess, queryAsUserIsExpectedForbidden, queryAsAdminWithError } from '../../../utils/testQueryHelper';
import { CUSTOM_VIEW_ENTITY_1, CUSTOM_VIEW_ENTITY_2, CUSTOM_VIEW_ENTITY_INVALID, DASHBOARD_MANIFEST } from './customView-fixtures';
import { ENTITY_TYPE_CONTAINER_FEEDBACK } from '../../../../src/modules/case/feedback/feedback-types';

const READ_CONTEXT_QUERY = gql`
  query CustomViewsDisplayContextTest {
    customViewsDisplayContext {
      entity_type
      custom_views_info {
        id
        name
        path
      }
    }
  }
`;

const READ_CUSTOM_VIEW_FOR_DISPLAY_QUERY = gql`
  query CustomViewDisplayTest($id: ID!) {
    customViewDisplay(id: $id) {
      manifest
    }
  }
`;

const READ_SETTINGS_QUERY = gql`
  query CustomViewsSettingsTest($entityType: String!) {
    customViewsSettings(entityType: $entityType) {
      canEntityTypeHaveCustomViews
      customViews {
        id
        name
        description
        created_at
        updated_at
      }
    }
  }
`;

const CREATE_CUSTOM_VIEW_QUERY = gql`
  mutation CreateCustomViewTest($input: CustomViewAddInput!) {
    customViewAdd(input: $input) {
      id
      name
      description
      path
      target_entity_type
      updated_at
      created_at
    }
  }
`;

describe('CustomView resolvers', () => {
  let customViewId1: string;
  let customViewId2: string;
  beforeAll(async () => {
    const result1 = await createEntity(
      testContext,
      ADMIN_USER,
      CUSTOM_VIEW_ENTITY_1,
      'CustomView',
    );
    customViewId1 = result1.id;
    const result2 = await createEntity(
      testContext,
      ADMIN_USER,
      CUSTOM_VIEW_ENTITY_2,
      'CustomView',
    );
    customViewId2 = result2.id;
    await createEntity(
      testContext,
      ADMIN_USER,
      CUSTOM_VIEW_ENTITY_INVALID,
      'CustomView',
    );
  });
  describe('display use cases', () => {
    describe('customViewsDisplayContext', () => {
      it('should retrieve custom views display context', async () => {
        const result = await queryAsUserWithSuccess(USER_PARTICIPATE, {
          query: READ_CONTEXT_QUERY,
          variables: {},
        });
        expect(result.data.customViewsDisplayContext).toContainEqual({
          entity_type: CUSTOM_VIEW_ENTITY_1.target_entity_type,
          custom_views_info: [{
            id: customViewId1,
            name: CUSTOM_VIEW_ENTITY_1.name,
            path: `${CUSTOM_VIEW_ENTITY_1.slug}-${customViewId1.replaceAll('-', '')}`,
          }],
        });
        expect(result.data.customViewsDisplayContext).toContainEqual({
          entity_type: CUSTOM_VIEW_ENTITY_2.target_entity_type,
          custom_views_info: [{
            id: customViewId2,
            name: CUSTOM_VIEW_ENTITY_2.name,
            path: `${CUSTOM_VIEW_ENTITY_2.slug}-${customViewId2.replaceAll('-', '')}`,
          }],
        });
      });

      it('should not include excluded entity types in display context', async () => {
        const result = await queryAsUserWithSuccess(USER_PARTICIPATE, {
          query: READ_CONTEXT_QUERY,
          variables: {},
        });
        expect(result.data.customViewsDisplayContext).not.toSatisfy(
          (contexts: CustomViewsDisplayContext[]) => contexts.some((c) => {
            return c.entity_type === CUSTOM_VIEW_ENTITY_INVALID.target_entity_type;
          }));
      });
    });

    describe('customViewDisplay', () => {
      it('should retrieve serialized dashboard manifest', async () => {
        const result = await queryAsUserWithSuccess(USER_PARTICIPATE, {
          query: READ_CUSTOM_VIEW_FOR_DISPLAY_QUERY,
          variables: {
            id: customViewId1,
          },
        });
        expect(result.data.customViewDisplay.manifest).toBe(CUSTOM_VIEW_ENTITY_1.manifest);
      });
    });
  });

  describe('settings use cases', () => {
    describe('customViewsSettings', () => {
      describe('when user is admin', () => {
        it('should allow creating a custom view', async () => {
          const description = 'Some great description';
          const manifest = DASHBOARD_MANIFEST;
          const name = 'Custom view name';
          const target_entity_type = 'Intrusion-Set';
          const result = await queryAsAdminWithSuccess({
            query: CREATE_CUSTOM_VIEW_QUERY,
            variables: {
              input: {
                description,
                manifest,
                name,
                target_entity_type,
              },
            },
          });
          expect(result.data.customViewAdd).toMatchObject({
            id: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i),
            name,
            description,
            path: `custom-view-name-${result.data.customViewAdd.id.replaceAll('-', '')}`,
            target_entity_type,
            created_at: expect.any(Date),
            updated_at: expect.any(Date),
          });
        });

        it('should return a client error when trying to create a custom view for a non-supported entity type', async () => {
          const description = 'Some great description';
          const manifest = DASHBOARD_MANIFEST;
          const name = 'Custom view name';
          const target_entity_type = ENTITY_TYPE_CONTAINER_FEEDBACK;
          const result = await queryAsAdminWithError({
            query: CREATE_CUSTOM_VIEW_QUERY,
            variables: {
              input: {
                description,
                manifest,
                name,
                target_entity_type,
              },
            },
          });
          expect(result.errors?.[0].message).toBe('Custom views cannot be created for given entity type');
          expect(result.errors?.[0].extensions?.code).toBe('FUNCTIONAL_ERROR');
          expect(result.errors?.[0].extensions?.data).toMatchObject({ http_status: 400 });
        });

        it('should retrieve canEntityTypeHaveCustomViews=true and custom views for alowed entity type', async () => {
          const result = await queryAsAdminWithSuccess({
            query: READ_SETTINGS_QUERY,
            variables: {
              entityType: CUSTOM_VIEW_ENTITY_1.target_entity_type,
            },
          });
          expect(result.data.customViewsSettings.canEntityTypeHaveCustomViews).toBe(true);
          expect(result.data.customViewsSettings.customViews).toContainEqual({
            id: customViewId1,
            name: CUSTOM_VIEW_ENTITY_1.name,
            description: CUSTOM_VIEW_ENTITY_1.description,
            created_at: new Date(CUSTOM_VIEW_ENTITY_1.created_at),
            updated_at: new Date(CUSTOM_VIEW_ENTITY_1.updated_at),
          });
        });

        it('should retrieve canEntityTypeHaveCustomViews=false for other entity type', async () => {
          const result = await queryAsAdminWithSuccess({
            query: READ_SETTINGS_QUERY,
            variables: {
              entityType: CUSTOM_VIEW_ENTITY_INVALID.target_entity_type,
            },
          });
          expect(result.data.customViewsSettings.canEntityTypeHaveCustomViews).toBe(false);
          expect(result.data.customViewsSettings.customViews).toStrictEqual([]);
        });
      });

      describe('when user is a simple participant', () => {
        it('should fail retrieving custom view settings with ForbiddenAccess 403 error', async () => {
          await queryAsUserIsExpectedForbidden(USER_PARTICIPATE, {
            query: READ_SETTINGS_QUERY,
            variables: {
              entityType: CUSTOM_VIEW_ENTITY_1.target_entity_type,
            },
          });
        });
      });
    });
  });
});
