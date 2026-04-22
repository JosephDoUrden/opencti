import React, { FunctionComponent } from 'react';
import { graphql } from 'react-relay';
import {
  DraftReviewEntityListPaginationQuery,
  DraftReviewEntityListPaginationQuery$variables,
} from '@components/drafts/__generated__/DraftReviewEntityListPaginationQuery.graphql';
import { DraftReviewEntityList_data$data } from '@components/drafts/__generated__/DraftReviewEntityList_data.graphql';
import { DraftReviewEntityList_node$data } from '@components/drafts/__generated__/DraftReviewEntityList_node.graphql';
import Tooltip from '@mui/material/Tooltip';
import IconButton from '@mui/material/IconButton';
import BookmarkIcon from '@mui/icons-material/Bookmark';
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
  ) {
    ...DraftReviewEntityList_data
    @arguments(
      draftId: $draftId
      count: $count
      cursor: $cursor
      orderBy: $orderBy
      orderMode: $orderMode
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
  )
  @refetchable(queryName: "DraftReviewEntityListRefetchQuery") {
    draftWorkspaceEntities(
      draftId: $draftId
      first: $count
      after: $cursor
      orderBy: $orderBy
      orderMode: $orderMode
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

interface ReadToggleCellProps {
  entityId: string;
  draftId: string;
  isRead: boolean;
}

const ReadToggleCell: FunctionComponent<ReadToggleCellProps> = ({ entityId, draftId, isRead }) => {
  const { t_i18n } = useFormatter();
  const [commitMarkRead] = useApiMutation(draftEntityMarkReadMutation);
  const [commitMarkUnread] = useApiMutation(draftEntityMarkUnreadMutation);

  const handleToggle = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (isRead) {
      commitMarkUnread({ variables: { entityId, draftId } });
    } else {
      commitMarkRead({ variables: { entityId, draftId } });
    }
  };

  return (
    <Tooltip title={isRead ? t_i18n('Mark as unread') : t_i18n('Mark as read')}>
      <IconButton size="small" onClick={handleToggle}>
        {isRead
          ? <BookmarkIcon sx={{ fontSize: 18, color: 'text.disabled' }} />
          : <BookmarkBorderIcon sx={{ fontSize: 18, color: 'primary.main' }} />}
      </IconButton>
    </Tooltip>
  );
};

interface DraftReviewEntityListProps {
  draftId: string;
  selectedEntityId?: string | null;
  onSelectEntity: (entityId: string, entityType: string) => void;
}

const DraftReviewEntityList: FunctionComponent<DraftReviewEntityListProps> = ({
  draftId,
  onSelectEntity,
}) => {
  const initialValues = {
    searchTerm: '',
    sortBy: 'entity_type',
    orderAsc: true,
    openExports: false,
    draftId,
  };

  const {
    paginationOptions,
    helpers: storageHelpers,
  } = usePaginationLocalStorage<DraftReviewEntityListPaginationQuery$variables>(LOCAL_STORAGE_KEY, initialValues);

  const queryPaginationOptions = {
    ...paginationOptions,
    draftId,
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
      render: (node: DraftReviewEntityList_node$data) => (
        <ReadToggleCell
          entityId={node.id}
          draftId={draftId}
          isRead={node.draftVersion?.draft_is_read ?? false}
        />
      ),
    },
  };

  return (
    <>
      {queryRef && (
        <DataTable
          dataColumns={dataColumns}
          resolvePath={(data: DraftReviewEntityList_data$data) => data.draftWorkspaceEntities?.edges
            ?.map((n) => n?.node)
            .filter((n) => n?.draftVersion?.draft_operation === 'update' || n?.draftVersion?.draft_operation === 'update_linked')}
          storageKey={LOCAL_STORAGE_KEY}
          initialValues={initialValues}
          preloadedPaginationProps={preloadedPaginationProps}
          lineFragment={draftReviewEntityFragment}
          disableNavigation
          disableLineSelection
          disableToolBar
          onLineClick={(node: DraftReviewEntityList_node$data) => onSelectEntity(node.id, node.entity_type)}
        />
      )}
    </>
  );
};

export default DraftReviewEntityList;
