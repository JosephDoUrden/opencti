import React, { FunctionComponent, Suspense } from 'react';
import { graphql, useLazyLoadQuery } from 'react-relay';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Loader from '../../../components/Loader';
import { useFormatter } from '../../../components/i18n';
import LaunchIcon from '@mui/icons-material/Launch';
import IconButton from '@mui/material/IconButton';
import { Change } from '../../../components/common/table/ChangesTable';
import { DraftReviewDiffPanelQuery } from './__generated__/DraftReviewDiffPanelQuery.graphql';
import { resolveLink } from '../../../utils/Entity';
import { Link } from 'react-router-dom';
import TruncatedRawValue from '../common/drawer/TruncatedRawValue';

const draftReviewDiffPanelQuery = graphql`
  query DraftReviewDiffPanelQuery($draftId: String!) {
    draftWorkspaceEntities(
      draftId: $draftId
      first: 500
    ) {
      edges {
        node {
          id
          entity_type
          representative {
            main
          }
          draftVersion {
            draft_operation
            draft_updates_patch
          }
        }
      }
    }
  }
`;

interface PatchValue {
  initial_value: string[];
  replaced_value: string[];
  added_value: string[];
  removed_value: string[];
}

type UpdatesPatch = Record<string, PatchValue>;

const parseUpdatesPatch = (rawPatch: string | null | undefined): Change[] => {
  if (!rawPatch) return [];
  try {
    const patch: UpdatesPatch = JSON.parse(rawPatch);
    return Object.entries(patch).map(([field, values]) => {
      if (values.replaced_value && values.replaced_value.length > 0) {
        return {
          field,
          removed: values.initial_value?.map(String) ?? [],
          added: values.replaced_value.map(String),
        };
      }
      return {
        field,
        removed: values.removed_value?.map(String) ?? [],
        added: values.added_value?.map(String) ?? [],
      };
    });
  } catch {
    return [];
  }
};

const DRAFT_FIELD_MAPPING = {
  published: 'Publication date',
  x_opencti_reliability: 'Reliability',
  x_opencti_score: 'Score',
  x_opencti_workflow_id: 'Status',
  x_opencti_color: 'Color',
  x_opencti_description: 'Description',
  description: 'Description',
  url: 'URL',
  valid_from: 'Valid from',
  valid_until: 'Valid until',
  first_seen: 'First seen',
  last_seen: 'Last seen',
  objectLabel: 'Labels',
  objectMarking: 'Markings',
  createdBy: 'Author',
  objectAssignee: 'Assignees',
  objectParticipant: 'Participants',
  x_mitre_platforms: 'Platforms',
  x_mitre_permissions_required: 'Required permissions',
  malware_types: 'Malware types',
  threat_actor_types: 'Threat actor types',
  identity_class: 'Identity class',
  contact_information: 'Contact information',
  x_opencti_organization_type: 'Organization type',
};

const formatFieldKey = (field?: string) => {
  if (!field) return '';
  const mapped = DRAFT_FIELD_MAPPING[field as keyof typeof DRAFT_FIELD_MAPPING];
  if (mapped) return mapped;
  // Capitalize first letter and replace underscores with spaces
  const formatted = field.replace(/_/g, ' ');
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
};

interface DraftReviewDiffPanelContentProps {
  draftId: string;
  entityId: string;
}

const DraftReviewDiffPanelContent: FunctionComponent<DraftReviewDiffPanelContentProps> = ({
  draftId,
  entityId,
}) => {
  const { t_i18n } = useFormatter();

  const data = useLazyLoadQuery<DraftReviewDiffPanelQuery>(
    draftReviewDiffPanelQuery,
    { draftId },
    { fetchPolicy: 'store-and-network' },
  );

  const entityNode = (data.draftWorkspaceEntities?.edges ?? [])
    .map((e) => e?.node)
    .find((node) => node?.id === entityId);

  if (!entityNode) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t_i18n('Entity not found')}
      </Typography>
    );
  }

  const renderHeader = () => {
    const link = resolveLink(entityNode.entity_type);
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3, gap: 1 }}>
        <Typography sx={{ fontFamily: 'Geologica, sans-serif', fontSize: 14, fontWeight: 600, color: 'text.primary', letterSpacing: '0.0075em' }}>
          {entityNode.representative?.main}
        </Typography>
        {link && (
          <IconButton
            component={Link}
            to={`${link}/${entityNode.id}`}
            target="_blank"
            rel="noopener noreferrer"
            size="small"
            sx={{
              width: 26,
              height: 26,
              borderRadius: '4px',
              color: 'primary.main',
              backgroundColor: 'action.hover',
            }}
          >
            <LaunchIcon sx={{ fontSize: 18 }} />
          </IconButton>
        )}
      </Box>
    );
  };

  const renderChangeValues = (values?: readonly string[] | null, isRemoved = false) => {
    if (!values || values.length === 0) {
      return (
        <Typography sx={{ color: isRemoved ? 'text.secondary' : 'text.primary', fontSize: 14, fontFamily: 'IBM Plex Sans, sans-serif', letterSpacing: '0.0075em' }}>
          -
        </Typography>
      );
    }
    return values.map((s, i) => (
      <Box key={i} sx={{ mb: i < values.length - 1 ? 1 : 0, color: isRemoved ? 'text.secondary' : 'text.primary' }}>
        <TruncatedRawValue value={s} variant="text" />
      </Box>
    ));
  };

  const operation = entityNode.draftVersion?.draft_operation;
  if (operation === 'create') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {renderHeader()}
        <Typography variant="body2" color="text.secondary">
          {t_i18n('This entity will be created — no previous version to compare')}
        </Typography>
      </Box>
    );
  }

  if (operation === 'delete' || operation === 'delete_linked') {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
        {renderHeader()}
        <Typography variant="body2" color="text.secondary">
          {t_i18n('This entity will be deleted')}
        </Typography>
      </Box>
    );
  }

  const changes = parseUpdatesPatch(entityNode.draftVersion?.draft_updates_patch);

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: 844 }}>
      {renderHeader()}

      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <Typography sx={{ color: 'text.secondary', fontSize: 12, fontFamily: 'IBM Plex Sans, sans-serif', letterSpacing: '0.0075em', mb: '8px' }}>
          {t_i18n('Container’s Fields')}
        </Typography>

        <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', gap: '7px', width: '100%', mb: '8px' }}>
          <Box sx={{ flex: 1, backgroundColor: 'background.default', borderLeft: '1px solid', borderLeftColor: 'error.main', borderRadius: '4px', py: '6px', display: 'flex', justifyContent: 'center' }}>
            <Typography sx={{ color: 'error.main', fontSize: 10, fontFamily: 'IBM Plex Sans, sans-serif', letterSpacing: '0.0075em' }}>
              {t_i18n('Original Value')}
            </Typography>
          </Box>
          <Box sx={{ flex: 1, backgroundColor: 'background.default', borderLeft: '2px solid', borderLeftColor: 'success.main', borderRadius: '4px', py: '6px', display: 'flex', justifyContent: 'center' }}>
            <Typography sx={{ color: 'success.main', fontSize: 10, fontFamily: 'IBM Plex Sans, sans-serif', letterSpacing: '0.0075em' }}>
              {t_i18n('New value')}
            </Typography>
          </Box>
        </Box>

        {changes.length === 0 ? (
          <Typography variant="body2" sx={{ color: 'text.secondary', mt: 2 }}>
            {t_i18n('No field changes detected for this entity')}
          </Typography>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            {changes.map((row) => (
              <Box key={row.field} sx={{ backgroundColor: 'background.paper', borderRadius: '4px', p: '8px 16px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                <Typography sx={{ color: 'text.secondary', fontWeight: 500, fontSize: 12, fontFamily: 'IBM Plex Sans, sans-serif', letterSpacing: '0.0075em' }}>
                  {t_i18n(formatFieldKey(row.field)) ?? ''}
                </Typography>
                <Box sx={{ display: 'flex', flexDirection: 'row', gap: '16px' }}>
                  <Box sx={{ flex: 1, fontSize: 14, fontFamily: 'IBM Plex Sans, sans-serif', letterSpacing: '0.0075em' }}>
                    {renderChangeValues(row.removed, true)}
                  </Box>
                  <Box sx={{ flex: 1, fontSize: 14, fontFamily: 'IBM Plex Sans, sans-serif', letterSpacing: '0.0075em' }}>
                    {renderChangeValues(row.added, false)}
                  </Box>
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
};

interface DraftReviewDiffPanelProps {
  draftId: string;
  entityId: string | null;
}

const DraftReviewDiffPanel: FunctionComponent<DraftReviewDiffPanelProps> = ({
  draftId,
  entityId,
}) => {
  const { t_i18n } = useFormatter();

  if (!entityId) {
    return (
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          color: 'text.secondary',
        }}
      >
        <Typography variant="body2">
          {t_i18n('Select an entity on the left to see its changes')}
        </Typography>
      </Box>
    );
  }

  return (
    <Suspense fallback={<Loader />}>
      <DraftReviewDiffPanelContent draftId={draftId} entityId={entityId} />
    </Suspense>
  );
};

export default DraftReviewDiffPanel;
