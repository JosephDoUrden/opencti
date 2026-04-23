import React, { FunctionComponent, Suspense } from 'react';
import { graphql, useLazyLoadQuery } from 'react-relay';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Loader from '../../../components/Loader';
import { useFormatter } from '../../../components/i18n';
import LaunchIcon from '@mui/icons-material/Launch';
import IconButton from '@mui/material/IconButton';
import { Change } from '../../../components/common/table/ChangesTable';
import { DraftReviewDiffPanelQuery } from './__generated__/DraftReviewDiffPanelQuery.graphql';
import { DraftReviewDiffPanelContainerObjectsQuery } from './__generated__/DraftReviewDiffPanelContainerObjectsQuery.graphql';
import { DraftReviewDiffPanelSubTypeQuery } from './__generated__/DraftReviewDiffPanelSubTypeQuery.graphql';
import { resolveLink } from '../../../utils/Entity';
import { Link } from 'react-router-dom';
import TruncatedRawValue from '../common/drawer/TruncatedRawValue';
import { containerTypes } from '../../../utils/hooks/useAttributes';

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

const draftReviewDiffPanelSubTypeQuery = graphql`
  query DraftReviewDiffPanelSubTypeQuery($entityType: String!) {
    subType(id: $entityType) {
      settings {
        attributesDefinitions {
          name
          label
        }
      }
    }
  }
`;

const draftReviewDiffPanelContainerObjectsQuery = graphql`
  query DraftReviewDiffPanelContainerObjectsQuery($draftId: String!, $containerId: String!) {
    draftWorkspaceContainerObjects(draftId: $draftId, containerId: $containerId) {
      entity_id
      entity_type
      representative_main
      draft_operation
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

const buildFieldLabelMap = (
  attributesDefinitions: ReadonlyArray<{ name: string; label: string | null | undefined }> | null | undefined,
): Record<string, string> => {
  if (!attributesDefinitions) return {};
  return Object.fromEntries(
    attributesDefinitions
      .filter((a) => a.label)
      .map((a) => [a.name, a.label as string]),
  );
};

const formatFieldKey = (field: string | undefined, labelMap: Record<string, string>): string => {
  if (!field) return '';
  if (labelMap[field]) return labelMap[field];
  const formatted = field.replace(/_/g, ' ');
  return formatted.charAt(0).toUpperCase() + formatted.slice(1);
};

interface ContainerObjectsTabProps {
  draftId: string;
  containerId: string;
}

const ContainerObjectsTab: FunctionComponent<ContainerObjectsTabProps> = ({ draftId, containerId }) => {
  const { t_i18n } = useFormatter();

  const data = useLazyLoadQuery<DraftReviewDiffPanelContainerObjectsQuery>(
    draftReviewDiffPanelContainerObjectsQuery,
    { draftId, containerId },
    { fetchPolicy: 'store-and-network' },
  );

  const objects = data.draftWorkspaceContainerObjects ?? [];

  if (objects.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: 'text.secondary', mt: 2 }}>
        {t_i18n('No objects added or removed from this container')}
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', backgroundColor: 'background.paper', borderRadius: '4px', p: '16px' }}>
      <Box sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center', mb: 2 }}>
        <Typography sx={{ width: 120, fontSize: 12, fontWeight: 600, color: 'text.secondary', fontFamily: 'IBM Plex Sans, sans-serif' }}>
          {t_i18n('Action')}
        </Typography>
        <Typography sx={{ flex: 1, fontSize: 12, fontWeight: 600, color: 'text.secondary', fontFamily: 'IBM Plex Sans, sans-serif' }}>
          {t_i18n('Type')}
        </Typography>
        <Typography sx={{ flex: 2, fontSize: 12, fontWeight: 600, color: 'text.secondary', fontFamily: 'IBM Plex Sans, sans-serif' }}>
          {t_i18n('Representative')}
        </Typography>
      </Box>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
        {objects.map((obj) => {
          const isAdd = obj.draft_operation === 'add';
          return (
            <Box
              key={obj.entity_id}
              sx={{ display: 'flex', flexDirection: 'row', alignItems: 'center' }}
            >
              <Box sx={{ width: 120 }}>
                <Chip
                  label={isAdd ? t_i18n('Added') : t_i18n('Removed')}
                  color={isAdd ? 'success' : 'error'}
                  size="small"
                  sx={{ borderRadius: '4px', height: 24, fontSize: 12, fontWeight: 600 }}
                />
              </Box>
              <Box sx={{ flex: 1, pr: 2 }}>
                <Typography sx={{ fontSize: 14, fontFamily: 'IBM Plex Sans, sans-serif', color: 'text.primary', wordBreak: 'break-word' }}>
                  {t_i18n(`entity_${obj.entity_type}`)}
                </Typography>
              </Box>
              <Box sx={{ flex: 2, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Typography sx={{ fontSize: 14, fontFamily: 'IBM Plex Sans, sans-serif', color: 'text.primary', wordBreak: 'break-word' }}>
                  {obj.representative_main ?? obj.entity_id}
                </Typography>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
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

  const subTypeData = useLazyLoadQuery<DraftReviewDiffPanelSubTypeQuery>(
    draftReviewDiffPanelSubTypeQuery,
    { entityType: entityNode?.entity_type ?? 'Report' },
    { fetchPolicy: 'store-and-network' },
  );

  const labelMap = buildFieldLabelMap(subTypeData.subType?.settings?.attributesDefinitions);

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
  const isContainer = containerTypes.includes(entityNode.entity_type);

  const renderFieldsTab = () => (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
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
                {t_i18n(formatFieldKey(row.field, labelMap)) ?? ''}
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
  );

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: '24px', maxWidth: 844 }}>
      {renderHeader()}

      {renderFieldsTab()}

      {isContainer && (
        <Suspense fallback={<Loader />}>
          <Typography variant="h3" sx={{ mb: 1, fontSize: 12, fontFamily: 'IBM Plex Sans, sans-serif' }}>
            {t_i18n('Data in container')}
          </Typography>
          <ContainerObjectsTab draftId={draftId} containerId={entityId} />
        </Suspense>
      )}
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
