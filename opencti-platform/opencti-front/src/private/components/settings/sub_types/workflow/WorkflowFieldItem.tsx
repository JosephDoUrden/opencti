import { useState } from 'react';
import { Accordion, AccordionDetails, AccordionSummary, IconButton, Typography } from '@mui/material';
import { DeleteOutlined, ExpandMoreOutlined } from '@mui/icons-material';
import { Field, FieldProps } from 'formik';
import TextField from '../../../../../components/TextField';
import DeleteDialog from '../../../../../components/DeleteDialog';
import useDeletion from '../../../../../utils/hooks/useDeletion';
import AuthorizedMembersField from '@components/common/form/AuthorizedMembersField';
import { camelCaseToSentenceCase } from '../../../../../utils/String';
import { useFormatter } from '../../../../../components/i18n';
import ObjectOrganizationField from '../../../common/form/ObjectOrganizationField';

const getActionLabel = (value: { type: string; params?: { actions?: Array<{ type?: string }> } }, t_i18n: (value: string) => string) => {
  const asyncActionType = value?.params?.actions?.[0]?.type;
  if (value.type === 'updateAuthorizedMembers') return t_i18n('Update authorized members');
  if (value.type === 'validateDraft') return t_i18n('Validate draft');
  if (value.type === 'backgroundListTask' || value.type === 'asyncListTask') {
    return asyncActionType === 'unshare'
      ? t_i18n('Unshare from an organization')
      : t_i18n('Share to an organization');
  }
  return camelCaseToSentenceCase(value.type);
};

interface WorkflowFieldItemProps extends FieldProps {
  onDelete: () => void;
}

const WorkflowFieldItem = ({ field, onDelete }: WorkflowFieldItemProps) => {
  const { t_i18n } = useFormatter();
  const { name, value } = field;
  const isCondition = 'operator' in value || 'field' in value;
  const showExpandAccordionDetails = isCondition || !!value.params;

  const [expanded, setExpanded] = useState(showExpandAccordionDetails);
  const deletion = useDeletion({});

  return (
    <>
      <Accordion expanded={expanded} variant="outlined" sx={{ width: '100%', mb: 2 }}>
        <AccordionSummary expandIcon={showExpandAccordionDetails && <ExpandMoreOutlined />} onClick={() => showExpandAccordionDetails && setExpanded(!expanded)}>
          <Typography sx={{ display: 'inline-flex', alignItems: 'center', fontWeight: 'bold', flexGrow: 1 }}>
            {isCondition ? t_i18n('Condition') : getActionLabel(value, t_i18n)}
          </Typography>
          <IconButton
            color="error"
            onClick={(e) => {
              e.stopPropagation();
              deletion.handleOpenDelete();
            }}
          >
            <DeleteOutlined fontSize="small" />
          </IconButton>
        </AccordionSummary>
        <AccordionDetails sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {isCondition ? (
            <div style={{ display: 'flex', gap: '10px' }}>
              <Field component={TextField} name={`${name}.field`} label={t_i18n('Field')} variant="standard" fullWidth />
              <Field component={TextField} name={`${name}.operator`} label={t_i18n('Operator')} variant="standard" fullWidth />
              <Field component={TextField} name={`${name}.value`} label={t_i18n('Value')} variant="standard" fullWidth />
            </div>
          ) : (
            <>
              {value.type === 'updateAuthorizedMembers' && (
                <Field name={`${name}.params.authorized_members`} component={AuthorizedMembersField} showAllMembersLine canDeactivate={false} enableAccesses hideInfo addMeUserWithAdminRights />
              )}
              {(value.type === 'backgroundListTask' || value.type === 'asyncListTask') && (
                <>
                  <Field component={TextField} name={`${name}.params.description`} label={t_i18n('Description')} variant="standard" fullWidth />
                  <ObjectOrganizationField
                    name={`${name}.params.actions[0].context.values`}
                    label={t_i18n('Default organizations (leave empty to let users choose at trigger)')}
                    multiple={true}
                    alert={false}
                    outlined={false}
                  />
                </>
              )}
            </>
          )}
        </AccordionDetails>
      </Accordion>

      <DeleteDialog
        message={t_i18n('Are you sure?')}
        deletion={deletion}
        submitDelete={() => {
          onDelete();
          deletion.handleCloseDelete();
        }}
      />
    </>
  );
};

export default WorkflowFieldItem;
