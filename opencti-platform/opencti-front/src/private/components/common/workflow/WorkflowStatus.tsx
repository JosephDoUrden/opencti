import React, { FunctionComponent, useState } from 'react';
import { graphql, useFragment, useMutation } from 'react-relay';
import {
  Alert,
  AlertTitle,
  CircularProgress,
  DialogActions,
  DialogContentText,
  LinearProgress,
  Menu,
  MenuItem,
  Stack,
  Typography,
} from '@mui/material';
import { ArrowDropDownOutlined, CheckCircleOutlined, ErrorOutlined } from '@mui/icons-material';
import ItemStatus from '../../../../components/ItemStatus';
import Button from '../../../../components/common/button/Button';
import { WorkflowStatus_data$key } from './__generated__/WorkflowStatus_data.graphql';
import { WorkflowStatusTriggerMutation } from './__generated__/WorkflowStatusTriggerMutation.graphql';
import { useFormatter } from '../../../../components/i18n';
import useSwitchDraft from '../../drafts/useSwitchDraft';
import { MESSAGING$ } from '../../../../relay/environment';
import { useNavigate } from 'react-router-dom';
import Transition from '../../../../components/Transition';
import Dialog from '@common/dialog/Dialog';

export const workflowStatusFragment = graphql`
  fragment WorkflowStatus_data on DraftWorkspace {
    id
    entity_id
    processingCount
    workflowInstance {
      id
      currentState
      pendingStatus
      pendingError
      pendingTransition {
        id
        event
        toState
        asyncActions {
          id
          type
          status
          error
          summary {
            affectedCount
            targetType
            targetIds
            operation
          }
        }
      }
      currentStatus {
        id
        template {
          name
          color
        }
      }
      allowedTransitions {
        event
        toState
        actions
        toStatus {
          id
          template {
            name
            color
          }
        }
      }
    }
  }
`;

const workflowStatusTriggerMutation = graphql`
  mutation WorkflowStatusTriggerMutation($entityId: String!, $eventName: String!) {
    triggerWorkflowEvent(entityId: $entityId, eventName: $eventName) {
      success
      reason
      newState
      executionStatus
      pendingTransition {
        id
        event
        toState
        asyncActions {
          id
          type
          status
          error
          summary {
            affectedCount
            targetType
            targetIds
            operation
          }
        }
      }
      instance {
        id
        currentState
        pendingStatus
        pendingError
        pendingTransition {
          id
          event
          toState
          asyncActions {
            id
            type
            status
            error
            summary {
              affectedCount
              targetType
              targetIds
              operation
            }
          }
        }
        currentStatus {
          id
          template {
            name
            color
          }
        }
        allowedTransitions {
          event
          toState
          actions
          toStatus {
            id
            template {
              name
              color
            }
          }
        }
      }
      entity {
        ... on DraftWorkspace {
          ...WorkflowStatus_data
        }
      }
    }
  }
`;

const workflowStatusRetryMutation = graphql`
  mutation WorkflowStatusRetryMutation($entityId: String!) {
    retryPendingWorkflowTransitionActions(entityId: $entityId) {
      success
      reason
      newState
      executionStatus
      pendingTransition {
        id
        event
        toState
        asyncActions {
          id
          type
          status
          error
          summary {
            affectedCount
            targetType
            targetIds
            operation
          }
        }
      }
      instance {
        id
        currentState
        pendingStatus
        pendingError
        pendingTransition {
          id
          event
          toState
          asyncActions {
            id
            type
            status
            error
            summary {
              affectedCount
              targetType
              targetIds
              operation
            }
          }
        }
        currentStatus {
          id
          template {
            name
            color
          }
        }
        allowedTransitions {
          event
          toState
          actions
          toStatus {
            id
            template {
              name
              color
            }
          }
        }
      }
      entity {
        ... on DraftWorkspace {
          ...WorkflowStatus_data
        }
      }
    }
  }
`;

interface WorkflowTransitionsProps {
  data: WorkflowStatus_data$key;
}

const WorkflowStatus: FunctionComponent<WorkflowTransitionsProps> = ({ data }) => {
  const draft = useFragment(workflowStatusFragment, data);

  if (!draft.workflowInstance) {
    return null;
  }

  const { workflowInstance } = draft;
  const currentStatus = workflowInstance.currentStatus;

  return (
    <ItemStatus status={currentStatus} />
  );
};

export const WorkflowTransitions: FunctionComponent<WorkflowTransitionsProps> = ({ data }) => {
  const { t_i18n } = useFormatter();
  const navigate = useNavigate();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const [validationTransition, setValidationTransition] = useState<string | null>(null);

  const draft = useFragment(workflowStatusFragment, data);
  const { exitDraft } = useSwitchDraft();
  const [commit, approving] = useMutation<WorkflowStatusTriggerMutation>(workflowStatusTriggerMutation);
  const [retryCommit, retrying] = useMutation(workflowStatusRetryMutation);

  if (!draft.workflowInstance) {
    return null;
  }

  const { workflowInstance } = draft;
  const pendingStatus = (workflowInstance as any).pendingStatus;
  const pendingError = (workflowInstance as any).pendingError;
  const pendingTransition = (workflowInstance as any).pendingTransition;
  const isPending = pendingStatus === 'pending' || pendingStatus === 'PENDING';
  const hasTransitions = workflowInstance.allowedTransitions.length > 0;

  if (!isPending && !pendingError && !hasTransitions) {
    return null;
  }

  const handleOpen = (event: React.MouseEvent<HTMLButtonElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  const handleTransition = (eventName: string, actions: readonly string[]) => {
    if (isPending) {
      return;
    }
    if (actions.includes('validateDraft')) {
      handleClose();
      setValidationTransition(eventName);
    } else {
      commit({
        variables: {
          entityId: draft.id,
          eventName,
        },
        onCompleted: () => {
          handleClose();
        },
      });
    }
  };

  const handleValidateDraft = () => {
    if (validationTransition) {
      commit({
        variables: {
          entityId: draft.id,
          eventName: validationTransition,
        },
        onCompleted: (response) => {
          const executionStatus = (response.triggerWorkflowEvent as any)?.executionStatus;
          if (response.triggerWorkflowEvent?.success && executionStatus !== 'pending') {
            setValidationTransition(null);
            MESSAGING$.notifySuccess(t_i18n('Draft validation in progress'));
            exitDraft({
              onCompleted: () => {
                if (draft.entity_id) {
                  navigate(`/dashboard/id/${draft.entity_id}`);
                } else {
                  navigate('/dashboard/data/import/draft');
                }
              },
            });
          } else if (executionStatus === 'pending') {
            setValidationTransition(null);
            MESSAGING$.notifySuccess(t_i18n('Workflow transition started and is pending completion'));
          }
        },
      });
    }
  };

  const handleRetryPendingTransition = () => {
    if (!pendingTransition?.event || isPending) {
      return;
    }
    retryCommit({
      variables: {
        entityId: draft.id,
      },
      onCompleted: (response: any) => {
        const executionStatus = response.retryPendingWorkflowTransitionActions?.executionStatus;
        if (response.retryPendingWorkflowTransitionActions?.success && executionStatus === 'pending') {
          MESSAGING$.notifySuccess(t_i18n('Workflow retry started and is pending completion'));
        }
      },
    });
  };

  const asyncActions: any[] = pendingTransition?.asyncActions ?? [];

  const getActionLabel = (action: any): string => {
    const count = action.summary?.affectedCount ?? 0;
    const targetType = action.summary?.targetType;
    const targetCount = action.summary?.targetIds?.length ?? 0;
    const operation = String(action.summary?.operation ?? '').toLowerCase();
    if (targetType === 'organization') {
      const verb = operation === 'unshare' ? t_i18n('Unsharing') : t_i18n('Sharing');
      return `${verb} ${count} ${t_i18n('entities with')} ${targetCount} ${t_i18n('organization(s)')}`;
    }
    return `${t_i18n('Processing')} ${count} ${t_i18n('entities')}`;
  };

  return (
    <>
      {hasTransitions && (
        <Button
          variant="secondary"
          onClick={handleOpen}
          endIcon={<ArrowDropDownOutlined />}
          disabled={isPending}
        >
          {t_i18n('Workflow')}
        </Button>
      )}
      {(isPending || (!isPending && pendingError)) && (
        <Stack spacing={0.75} sx={{ mt: 0.5, mb: 0.5 }}>
          {asyncActions.length > 0 ? asyncActions.map((action: any) => (
            <Stack key={action.id} direction="row" spacing={1} alignItems="flex-start">
              {action.status === 'success' && (
                <CheckCircleOutlined sx={{ fontSize: 14, mt: '2px', color: 'success.main' }} />
              )}
              {action.status === 'failed' && (
                <ErrorOutlined sx={{ fontSize: 14, mt: '2px', color: 'error.main' }} />
              )}
              {action.status === 'pending' && (
                <CircularProgress size={12} thickness={6} sx={{ mt: '2px', flexShrink: 0 }} />
              )}
              <Stack spacing={0}>
                <Typography variant="body2" component="div" color={action.status === 'failed' ? 'error' : 'text.secondary'}>
                  {getActionLabel(action)}
                </Typography>
                {action.status === 'failed' && action.error && (
                  <Typography variant="caption" color="error">
                    {action.error}
                  </Typography>
                )}
              </Stack>
            </Stack>
          )) : (
            <Stack direction="row" spacing={1} alignItems="center">
              <CircularProgress size={12} thickness={6} />
              <Typography variant="body2" component="div" color="text.secondary">
                {t_i18n('Workflow transition pending')}
              </Typography>
            </Stack>
          )}
          {isPending && <LinearProgress sx={{ height: 3, borderRadius: 4 }} />}
          {!isPending && pendingError && (
            <Button
              variant="secondary"
              size="small"
              disabled={approving || retrying || !pendingTransition?.event}
              onClick={handleRetryPendingTransition}
            >
              {t_i18n('Retry')}
            </Button>
          )}
        </Stack>
      )}
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleClose}>
        {workflowInstance.allowedTransitions.map((transition) => (
          <MenuItem
            key={transition.event}
            onClick={() => handleTransition(transition.event, transition.actions ?? [])}
          >
            {transition.event}
          </MenuItem>
        ))}
      </Menu>
      <Dialog
        open={Boolean(validationTransition)}
        slotProps={{ paper: { elevation: 1 } }}
        keepMounted={true}
        slots={{ transition: Transition }}
        onClose={() => setValidationTransition(null)}
        title={t_i18n('Are you sure?')}
        size="small"
      >
        <DialogContentText>
          {t_i18n('Do you want to approve this draft and send it to ingestion?')}
          {draft.processingCount > 0 && (
            <Alert sx={{ marginTop: 1 }} severity="warning">
              <AlertTitle>{t_i18n('Ongoing processes')}</AlertTitle>
              {t_i18n('There are processes still running that could impact the data of the draft. '
                + 'By approving the draft now, the remaining changes that would have been applied by those processes will be ignored.')}
            </Alert>
          )}
        </DialogContentText>
        <DialogActions>
          <Button
            variant="secondary"
            onClick={() => setValidationTransition(null)}
          >
            {t_i18n('Cancel')}
          </Button>
          <Button
            onClick={handleValidateDraft}
            disabled={approving}
          >
            {t_i18n('Approve')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
};

export default WorkflowStatus;
