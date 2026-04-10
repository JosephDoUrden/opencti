import React, { FunctionComponent, useEffect, useMemo, useState } from 'react';
import { graphql, PreloadedQuery } from 'react-relay';
import { DraftTasksQuery, DraftTasksQuery$variables } from '@components/drafts/__generated__/DraftTasksQuery.graphql';
import { useQueryLoadingWithLoadQuery } from '../../../utils/hooks/useQueryLoading';
import { fetchQuery } from '../../../relay/environment';
import { emptyFilterGroup } from '../../../utils/filters/filtersUtils';
import { usePaginationLocalStorage } from '../../../utils/hooks/useLocalStorage';
import usePreloadedPaginationFragment from '../../../utils/hooks/usePreloadedPaginationFragment';
import {
  Box,
  Chip,
  Divider,
  IconButton,
  LinearProgress,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material';
import { ExpandLessOutlined, ExpandMoreOutlined } from '@mui/icons-material';
import { useFormatter } from '../../../components/i18n';

export const draftTaskLineFragment = graphql`
  fragment DraftTasksLine_task on BackgroundTask {
    id
    description
    initiator {
      id
      name
      representative {
        main
      }
    }
    type
    actions {
      type
      context {
        field
        type
        values
      }
    }
    created_at
    last_execution_date
    completed
    task_expected_number
    task_processed_number
    work {
      id
      name
      status
      timestamp
      received_time
      completed_time
      connector {
        id
        name
      }
    }
  }
`;

const draftTasksLinesFragment = graphql`
  fragment DraftTasksLines_data on Query
  @argumentDefinitions(
    count: { type: "Int", defaultValue: 500 }
    cursor: { type: "ID" }
    orderBy: { type: "BackgroundTasksOrdering" }
    orderMode: { type: "OrderingMode" }
    search: { type: "String" }
    filters: { type: "FilterGroup" }
  )
  @refetchable(queryName: "DraftTasksRefetchQuery") {
    backgroundTasks(
      first: $count,
      after: $cursor,
      orderBy: $orderBy,
      orderMode: $orderMode,
      search: $search,
      filters: $filters,
    )
    @connection(key: "Pagination_global_backgroundTasks") {
      edges {
        node {
          id
          description
          initiator {
            id
            name
            representative {
              main
            }
          }
          type
          actions {
            type
            context {
              field
              type
              values
            }
          }
          created_at
          last_execution_date
          completed
          task_expected_number
          task_processed_number
          work {
            id
            name
            status
            timestamp
            received_time
            completed_time
            connector {
              id
              name
            }
          }
        }
      }
      pageInfo {
        globalCount
      }
    }
  }
`;

export const draftTasksQuery = graphql`
  query DraftTasksQuery(
    $count: Int,
    $cursor: ID,
    $orderBy: BackgroundTasksOrdering,
    $orderMode: OrderingMode,
    $search: String,
    $filters: FilterGroup,
  ) {
    ...DraftTasksLines_data
    @arguments(
      count: $count
      cursor: $cursor
      orderBy: $orderBy
      orderMode: $orderMode
      search: $search
      filters: $filters
    )
  }
`;

const LOCAL_STORAGE_KEY = 'draft_tasks';
const TASKS_POLL_INTERVAL = 2000;

const formatTaskType = (type?: string) => (type ?? '')
  .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
  .replace(/[_-]+/g, ' ')
  .trim()
  .toLowerCase();

const formatActionTypes = (actions?: ReadonlyArray<{ type?: string | null } | null>) => {
  const normalized = Array.from(new Set(
    (actions ?? [])
      .map((action) => action?.type ?? '')
      .filter((type): type is string => type.length > 0),
  ));
  if (normalized.length === 0) {
    return '';
  }
  return normalized
    .map((type) => type.toLowerCase().replace(/_/g, ' '))
    .join(', ');
};

const getWorkStatusColor = (status?: string) => {
  if (!status) return 'default';
  const normalized = status.toLowerCase();
  if (normalized === 'complete') return 'success';
  if (normalized === 'wait' || normalized === 'progress') return 'warning';
  return 'default';
};

const formatConnectorLabel = (name?: string) => {
  if (!name) {
    return 'Unknown';
  }
  const internalTaskPrefix = '[TASK] Internal task processing #';
  if (name.startsWith(internalTaskPrefix)) {
    const workerIndex = name.slice(internalTaskPrefix.length);
    return `Internal task worker ${workerIndex}`;
  }
  return name;
};

interface DraftTasksProps {
  draftId: string;
}

interface DraftTasksTableProps {
  queryRef: PreloadedQuery<DraftTasksQuery>;
  setNumberOfElements: (value: string) => void;
}

const DraftTasksTable: FunctionComponent<DraftTasksTableProps> = ({ queryRef, setNumberOfElements }) => {
  const { t_i18n, nsdt } = useFormatter();
  const [expandedTaskIds, setExpandedTaskIds] = useState<Record<string, boolean>>({});

  const preloadedPaginationProps = {
    linesQuery: draftTasksQuery,
    linesFragment: draftTasksLinesFragment,
    queryRef,
    nodePath: ['backgroundTasks', 'pageInfo', 'globalCount'],
    setNumberOfElements,
  };

  const { data } = usePreloadedPaginationFragment<DraftTasksQuery, any>(preloadedPaginationProps as any);

  const rows = useMemo(() => {
    return (data?.backgroundTasks?.edges ?? [])
      .map((edge: any) => edge?.node)
      .filter(Boolean);
  }, [data]);

  const toggleRow = (taskId: string) => {
    setExpandedTaskIds((current) => ({
      ...current,
      [taskId]: !current[taskId],
    }));
  };

  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell width="4%" />
          <TableCell width="20%">{t_i18n('Initiator')}</TableCell>
          <TableCell width="28%">{t_i18n('Type')}</TableCell>
          <TableCell width="20%">{t_i18n('Created at')}</TableCell>
          <TableCell width="14%">{t_i18n('Impacted elements')}</TableCell>
          <TableCell width="14%">{t_i18n('Completed')}</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((task: any) => {
          const actionTypes = formatActionTypes(task.actions);
          const labelType = actionTypes || formatTaskType(task.type);
          const isExpanded = !!expandedTaskIds[task.id];
          return (
            <React.Fragment key={task.id}>
              <TableRow hover onClick={() => toggleRow(task.id)} style={{ cursor: 'pointer' }}>
                <TableCell>
                  <IconButton size="small" aria-label={t_i18n('Expand task')}>
                    {isExpanded ? <ExpandLessOutlined fontSize="small" /> : <ExpandMoreOutlined fontSize="small" />}
                  </IconButton>
                </TableCell>
                <TableCell>{task.initiator?.representative?.main ?? '-'}</TableCell>
                <TableCell>{labelType || '-'}</TableCell>
                <TableCell>{task.created_at ? nsdt(task.created_at) : '-'}</TableCell>
                <TableCell>{task.task_expected_number ?? '-'}</TableCell>
                <TableCell>{task.completed ? t_i18n('Yes') : t_i18n('No')}</TableCell>
              </TableRow>
              {isExpanded && (
                <TableRow>
                  <TableCell colSpan={6} sx={{ pt: 0, pb: 1 }}>
                    <Box sx={{ borderLeft: 2, borderColor: 'divider', pl: 2, ml: 3, py: 1 }}>
                      {!task.work && (
                        <Typography variant="body2" color="text.secondary">
                          {t_i18n('No work yet')}
                        </Typography>
                      )}
                      {task.work && (
                        <Box
                          sx={{
                            p: 1.5,
                            borderRadius: 1,
                            border: 1,
                            borderColor: 'divider',
                            backgroundColor: 'background.paper',
                          }}
                        >
                          <Stack spacing={1}>
                            <Stack direction="row" alignItems="center" justifyContent="space-between">
                              <Typography variant="subtitle2">
                                {task.work.name ?? t_i18n('Background work')}
                              </Typography>
                              <Chip
                                size="small"
                                color={getWorkStatusColor(task.work.status) as any}
                                label={task.work.status ?? t_i18n('Unknown')}
                                variant="outlined"
                              />
                            </Stack>
                            <Stack direction="row" spacing={1}>
                              <Chip
                                size="small"
                                label={`${t_i18n('Connector')}: ${formatConnectorLabel(task.work.connector?.name)}`}
                                variant="filled"
                              />
                            </Stack>
                            {(task.work.status === 'progress' || task.work.status === 'wait') && (
                              <LinearProgress />
                            )}
                            <Divider />
                            <Stack direction="row" spacing={3}>
                              <Typography variant="body2" color="text.secondary">
                                <strong>{t_i18n('Started')}:</strong> {task.work.received_time ? nsdt(task.work.received_time) : t_i18n('N/A')}
                              </Typography>
                              <Typography variant="body2" color="text.secondary">
                                <strong>{t_i18n('Completed')}:</strong> {task.work.completed_time ? nsdt(task.work.completed_time) : t_i18n('N/A')}
                              </Typography>
                            </Stack>
                          </Stack>
                        </Box>
                      )}
                    </Box>
                  </TableCell>
                </TableRow>
              )}
            </React.Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
};

const DraftTasks: FunctionComponent<DraftTasksProps> = ({ draftId }) => {
  const initialValues = {
    filters: {
      ...emptyFilterGroup,
    },
    searchTerm: '',
    sortBy: 'created_at',
    orderAsc: false,
  };

  const { viewStorage, helpers, paginationOptions } = usePaginationLocalStorage<DraftTasksQuery$variables>(LOCAL_STORAGE_KEY, initialValues, true);
  const { filters } = viewStorage;
  const currentDraftFilter = { key: 'draft_context', values: [draftId], operator: 'eq', mode: 'or' };
  const finalFilters = { ...filters, filters: [...(filters?.filters ?? []), currentDraftFilter] };
  const queryPaginationOptions = {
    ...paginationOptions,
    cursor: undefined,
    count: 500,
    filters: finalFilters,
  } as unknown as DraftTasksQuery$variables;

  const [queryRef] = useQueryLoadingWithLoadQuery<DraftTasksQuery>(draftTasksQuery, queryPaginationOptions);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchQuery(draftTasksQuery, queryPaginationOptions).toPromise();
    }, TASKS_POLL_INTERVAL);
    return () => clearInterval(interval);
  }, [queryPaginationOptions]);

  return (
    <span data-testid="draft-tasks-page">
      {queryRef && <DraftTasksTable queryRef={queryRef} setNumberOfElements={helpers.handleSetNumberOfElements} />}
    </span>
  );
};

export default DraftTasks;
