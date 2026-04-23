import React, { FunctionComponent, useState } from 'react';
import { graphql } from 'react-relay';
import {
  DraftReviewEntityListPaginationQuery,
  DraftReviewEntityListPaginationQuery$variables,
} from '@components/drafts/__generated__/DraftReviewEntityListPaginationQuery.graphql';
import { DraftReviewEntityList_data$data } from '@components/drafts/__generated__/DraftReviewEntityList_data.graphql';
import { DraftReviewEntityList_node$data } from '@components/drafts/__generated__/DraftReviewEntityList_node.graphql';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import BookmarkAddedIcon from '@mui/icons-material/BookmarkAdded';
import BookmarkBorderIcon from '@mui/icons-material/BookmarkBorder';
import { usePaginationLocalStorage } from '../../../utils/hooks/useLocalStorage';
import useQueryLoading from '../../../utils/hooks/useQueryLoading';
import { UsePreloadedPaginationFragment } from '../../../utils/hooks/usePreloadedPaginationFragment';
import DataTable from '../../../components/dataGrid/DataTable';
import { DataTableProps } from '../../../components/dataGrid/dataTableTypes';
import { useFormatter } from '../../../components/i18n';
import useApiMutation from '../../../utils/hooks/useApiMutation';

const draftReviewEntityFragment = graphql`
  fragment DraftReviewEntityList_node on StixCoreObject {
    id
    standard_id
    entity_type
    representative {
      main
    }
    draftVersion {
      draft_operation
      draft_is_read
    }
  }
`;

const draftReviewEntitiesLinesQuery = graphql`
  query DraftReviewEntityListPaginationQuery(
    $draftId: String!
    $count: Int!
    $cursor: ID
    $orderBy: StixCoreObjectsOrdering
    $orderMode: OrderingMode
    $draftOperation: String
  ) {
    ...DraftReviewEntityList_data
    @arguments(
      draftId: $draftId
      count: $count
      cursor: $cursor
      orderBy: $orderBy
      orderMode: $orderMode
      draftOperation: $draftOperation
    )
  }
`;

const draftReviewEntitiesLinesFragment = graphql`
  fragment DraftReviewEntityList_data on Query
  @argumentDefinitions(
    draftId: { type: "String!" }
    count: { type: "Int", defaultValue: 25 }
    cursor: { type: "ID" }
    orderBy: { type: "StixCoreObjectsOrdering", defaultValue: entity_type }
    orderMode: { type: "OrderingMode", defaultValue: asc }
    draftOperation: { type: "String" }
  )
  @refetchable(queryName: "DraftReviewEntityListRefetchQuery") {
    draftWorkspaceEntities(
      draftId: $draftId
      first: $count
      after: $cursor
      orderBy: $orderBy
      orderMode: $orderMode
      draftOperation: $draftOperation
    ) @connection(key: "DraftReviewEntityList__draftWorkspaceEntities") {
      edges {
        node {
          id
          draftVersion {
            draft_operation
          }
          ...DraftReviewEntityList_node
        }
      }
      pageInfo {
        endCursor
        hasNextPage
        globalCount
      }
    }
  }
`;

const draftEntityMarkReadMutation = graphql`
  mutation DraftReviewEntityListMarkReadMutation($entityId: ID!, $draftId: ID!) {
    draftEntityMarkRead(entityId: $entityId, draftId: $draftId) {
      id
      is_read
    }
  }
`;

const draftEntityMarkUnreadMutation = graphql`
  mutation DraftReviewEntityListMarkUnreadMutation($entityId: ID!, $draftId: ID!) {
    draftEntityMarkUnread(entityId: $entityId, draftId: $draftId) {
      id
      is_read
    }
  }
`;

const LOCAL_STORAGE_KEY = 'draft_review_entities';

interface DraftReviewEntityListProps {
  draftId: string;
  selectedEntityId?: string | null;
  onSelectEntity: (entityId: string, entityType: string) => void;
}

const DraftReviewEntityList: FunctionComponent<DraftReviewEntityListProps> = ({
  draftId,
  onSelectEntity,
}) => {
  const { t_i18n } = useFormatter();
  const [readOverrides, setReadOverrides] = useState<Record<string, boolean>>({});
  const [commitMarkRead] = useApiMutation(draftEntityMarkReadMutation);
  const [commitMarkUnread] = useApiMutation(draftEntityMarkUnreadMutation);

  const initialValues = {
    searchTerm: '',
    sortBy: 'entity_type',
    orderAsc: true,
    openExports: false,
    draftId,
    draftOperation: 'update',
  };

  const {
    paginationOptions,
    helpers: storageHelpers,
  } = usePaginationLocalStorage<DraftReviewEntityListPaginationQuery$variables>(LOCAL_STORAGE_KEY, initialValues);

  const queryPaginationOptions = {
    ...paginationOptions,
    draftId,
    draftOperation: 'update',
  } as unknown as DraftReviewEntityListPaginationQuery$variables;

  const queryRef = useQueryLoading<DraftReviewEntityListPaginationQuery>(
    draftReviewEntitiesLinesQuery,
    queryPaginationOptions,
  );

  const preloadedPaginationProps = {
    linesQuery: draftReviewEntitiesLinesQuery,
    linesFragment: draftReviewEntitiesLinesFragment,
    queryRef,
    nodePath: ['draftWorkspaceEntities', 'pageInfo', 'globalCount'],
    setNumberOfElements: storageHelpers.handleSetNumberOfElements,
  } as UsePreloadedPaginationFragment<DraftReviewEntityListPaginationQuery>;

  const dataColumns: DataTableProps['dataColumns'] = {
    entity_type: {
      percentWidth: 25,
      isSortable: true,
    },
    name: {
      label: 'Representative',
      percentWidth: 63,
      isSortable: false,
      render: (node: DraftReviewEntityList_node$data) => node.representative?.main ?? node.id,
    },
    draft_is_read: {
      id: 'draft_is_read',
      label: 'Read',
      percentWidth: 12,
      isSortable: false,
      render: (node: DraftReviewEntityList_node$data) => {
        const isRead = readOverrides[node.id] ?? node.draftVersion?.draft_is_read ?? false;
        const handleToggle = (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          const next = !isRead;
          setReadOverrides((prev) => ({ ...prev, [node.id]: next }));
          if (next) {
            commitMarkRead({ variables: { entityId: node.id, draftId } });
          } else {
            commitMarkUnread({ variables: { entityId: node.id, draftId } });
          }
        };
        return (
          <Tooltip title={isRead ? t_i18n('Mark as unread') : t_i18n('Mark as read')}>
            <IconButton size="small" onClick={handleToggle}>
              {isRead
                ? <BookmarkAddedIcon sx={{ fontSize: 18, color: 'text.disabled' }} />
                : <BookmarkBorderIcon sx={{ fontSize: 18, color: 'primary.main' }} />}
            </IconButton>
          </Tooltip>
        );
      },
    },
  };

  return (
    <>
      {queryRef && (
        <DataTable
          dataColumns={dataColumns}
          resolvePath={(data: DraftReviewEntityList_data$data) => data.draftWorkspaceEntities?.edges
            ?.map((n) => n?.node)}
          storageKey={LOCAL_STORAGE_KEY}
          initialValues={initialValues}
          preloadedPaginationProps={preloadedPaginationProps}
          lineFragment={draftReviewEntityFragment}
          disableNavigation
          disableLineSelection
          disableToolBar
          onLineClick={(node: DraftReviewEntityList_node$data) => {
            onSelectEntity(node.id, node.entity_type);
            const isRead = readOverrides[node.id] ?? node.draftVersion?.draft_is_read ?? false;
            if (!isRead) {
              setReadOverrides((prev) => ({ ...prev, [node.id]: true }));
              commitMarkRead({ variables: { entityId: node.id, draftId } });
            }
          }}
        />
      )}
    </>
  );
};

export default DraftReviewEntityList;
