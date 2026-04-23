import React, { FunctionComponent, useState } from 'react';
import { Formik, Form } from 'formik';
import { graphql, useFragment, useMutation } from 'react-relay';
import ObjectOrganizationField from '../form/ObjectOrganizationField';
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
  Tooltip,
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
        requiresOrganizationInput
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
  mutation WorkflowStatusTriggerMutation($entityId: String!, $eventName: String!, $runtimeParams: JSON) {
    triggerWorkflowEvent(entityId: $entityId, eventName: $eventName, runtimeParams: $runtimeParams) {
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
  const [sharingTransition, setSharingTransition] = useState<{ event: string; operation: 'share' | 'unshare' } | null>(null);

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

  const handleTransition = (eventName: string, actions: readonly string[], requiresOrgInput?: boolean | null) => {
    if (isPending) {
      return;
    }
    if (actions.includes('validateDraft')) {
      handleClose();
      setValidationTransition(eventName);
    } else if (requiresOrgInput) {
      handleClose();
      const operation = actions.includes('unshareFromOrganization') ? 'unshare' : 'share';
      setSharingTransition({ event: eventName, operation });
    } else {
      commit({
        variables: {
          entityId: draft.id,
          eventName,
        },
        onCompleted: (response) => {
          handleClose();
          const result = (response as any).triggerWorkflowEvent;
          if (result && !result.success && result.executionStatus !== 'pending' && !result.instance) {
            // Only fall back to toast if the instance wasn't updated (no bottom bar to show)
            MESSAGING$.notifyError(result.reason || t_i18n('Workflow transition failed'));
          }
        },
      });
    }
  };

  const handleSharingTransition = (orgValues: Array<{ value: string }>) => {
    if (!sharingTransition) return;
    const orgIds = orgValues.map((o) => o.value);
    const operation = sharingTransition.operation === 'unshare' ? 'UNSHARE' : 'SHARE';
    setSharingTransition(null);
    commit({
      variables: {
        entityId: draft.id,
        eventName: sharingTransition.event,
        runtimeParams: {
          organizationIds: orgIds,
        },
      },
      onCompleted: (response) => {
        const result = (response as any).triggerWorkflowEvent;
        if (result && !result.success && result.executionStatus !== 'pending' && !result.instance) {
          MESSAGING$.notifyError(result.reason || t_i18n('Workflow transition failed'));
        }
      },
    });
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
          {t_i18n('Actions')}
        </Button>
      )}
      {(isPending || (!isPending && pendingError)) && (
        <Stack spacing={0.75} sx={{ mt: 0.5, mb: 0.5 }}>
          <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
            <Stack spacing={0.75} sx={{ flex: 1, minWidth: 0 }}>
              {asyncActions.length > 0 ? asyncActions.map((action: any) => (
                <Stack key={action.id} direction="row" spacing={1} alignItems="center">
                  {action.status === 'success' && (
                    <CheckCircleOutlined sx={{ fontSize: 14, color: 'success.main' }} />
                  )}
                  {action.status === 'failed' && (
                    <ErrorOutlined sx={{ fontSize: 14, color: 'error.main' }} />
                  )}
                  {action.status === 'pending' && (
                    <CircularProgress size={12} thickness={6} sx={{ flexShrink: 0 }} />
                  )}
                  <Stack spacing={0} sx={{ minWidth: 0 }}>
                    <Typography variant="body2" component="div" color={action.status === 'failed' ? 'error' : 'text.secondary'}>
                      {getActionLabel(action)}
                    </Typography>
                    {action.status === 'failed' && action.error && (
                      <Tooltip title={action.error} placement="bottom-start">
                        <Typography
                          variant="caption"
                          color="error"
                          sx={{ display: 'block', maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'default' }}
                        >
                          {action.error}
                        </Typography>
                      </Tooltip>
                    )}
                  </Stack>
                </Stack>
              )) : (
                <Stack direction="row" spacing={1} alignItems="center">
                  {isPending ? (
                    <>
                      <CircularProgress size={12} thickness={6} sx={{ flexShrink: 0 }} />
                      <Typography variant="body2" component="div" color="text.secondary">
                        {t_i18n('Workflow transition pending')}
                      </Typography>
                    </>
                  ) : (
                    <>
                      <ErrorOutlined sx={{ fontSize: 14, color: 'error.main' }} />
                      <Tooltip title={pendingError ?? ''} placement="bottom-start">
                        <Typography
                          variant="body2"
                          component="div"
                          color="error"
                          sx={{ maxWidth: 320, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'default' }}
                        >
                          {pendingError}
                        </Typography>
                      </Tooltip>
                    </>
                  )}
                </Stack>
              )}
            </Stack>
            {!isPending && pendingError && (
              <Button
                variant="secondary"
                size="small"
                disabled={approving || retrying || !pendingTransition?.event}
                onClick={handleRetryPendingTransition}
                sx={{ flexShrink: 0 }}
              >
                {t_i18n('Retry')}
              </Button>
            )}
          </Stack>
          {isPending && <LinearProgress sx={{ height: 3, borderRadius: 4 }} />}
        </Stack>
      )}
      <Menu anchorEl={anchorEl} open={Boolean(anchorEl)} onClose={handleClose}>
        {workflowInstance.allowedTransitions.map((transition) => (
          <MenuItem
            key={transition.event}
            onClick={() => handleTransition(transition.event, transition.actions ?? [], transition.requiresOrganizationInput)}
          >
            {transition.event}
          </MenuItem>
        ))}
      </Menu>
      <Formik
        key={sharingTransition ? `${sharingTransition.event}-${sharingTransition.operation}` : 'closed'}
        initialValues={{ objectOrganizations: [] as Array<{ value: string; label: string }> }}
        onSubmit={(values) => handleSharingTransition(values.objectOrganizations)}
      >
        {({ submitForm, values, isSubmitting }) => (
          <Dialog
            open={Boolean(sharingTransition)}
            slotProps={{ paper: { elevation: 1 } }}
            keepMounted={false}
            slots={{ transition: Transition }}
            onClose={() => setSharingTransition(null)}
            title={sharingTransition?.operation === 'unshare' ? t_i18n('Unshare from organizations') : t_i18n('Share with organizations')}
            size="small"
          >
            <DialogContentText>
              {sharingTransition?.operation === 'unshare'
                ? t_i18n('Select organizations to unshare draft entities from.')
                : t_i18n('Select organizations to share draft entities with.')}
            </DialogContentText>
            <Form>
              <ObjectOrganizationField
                name="objectOrganizations"
                label={t_i18n('Organizations')}
                style={{ width: '100%', marginTop: 16 }}
                multiple
              />
            </Form>
            <DialogActions>
              <Button variant="secondary" onClick={() => setSharingTransition(null)}>
                {t_i18n('Cancel')}
              </Button>
              <Button
                onClick={submitForm}
                disabled={approving || isSubmitting || values.objectOrganizations.length === 0}
              >
                {t_i18n('Confirm')}
              </Button>
            </DialogActions>
          </Dialog>
        )}
      </Formik>
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
