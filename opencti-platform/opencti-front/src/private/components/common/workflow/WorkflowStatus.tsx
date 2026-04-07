import React, { FunctionComponent, useState } from 'react';
import { graphql, useFragment, useMutation } from 'react-relay';
import { Alert, AlertTitle, DialogActions, DialogContentText, Menu, MenuItem } from '@mui/material';
import { ArrowDropDownOutlined } from '@mui/icons-material';
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

  if (!draft.workflowInstance) {
    return null;
  }

  const { workflowInstance } = draft;
  const pendingStatus = (workflowInstance as any).pendingStatus;
  const pendingError = (workflowInstance as any).pendingError;
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
      {isPending && (
        <Alert sx={{ mt: 1, mb: 1 }} severity="info">
          {t_i18n('A workflow transition is currently pending. Please wait for completion before triggering another transition.')}
        </Alert>
      )}
      {!isPending && pendingError && (
        <Alert sx={{ mt: 1, mb: 1 }} severity="error">
          {pendingError}
        </Alert>
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
