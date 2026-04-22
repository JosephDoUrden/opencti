import React, { FunctionComponent, Suspense } from 'react';
import { graphql, useLazyLoadQuery } from 'react-relay';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Loader from '../../../components/Loader';
import { useFormatter } from '../../../components/i18n';
import ChangesTable, { Change } from '../../../components/common/table/ChangesTable';
import { DraftReviewDiffPanelQuery } from './__generated__/DraftReviewDiffPanelQuery.graphql';

const draftReviewDiffPanelQuery = graphql`
  query DraftReviewDiffPanelQuery($draftId: String!) {
    draftWorkspaceEntities(
      draftId: $draftId
      first: 500
    ) {
      edges {
        node {
          id
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

  const operation = entityNode.draftVersion?.draft_operation;
  if (operation === 'create') {
    return (
      <Typography variant="body2" color="text.secondary">
        {t_i18n('This entity will be created — no previous version to compare')}
      </Typography>
    );
  }

  if (operation === 'delete' || operation === 'delete_linked') {
    return (
      <Typography variant="body2" color="text.secondary">
        {t_i18n('This entity will be deleted')}
      </Typography>
    );
  }

  const changes = parseUpdatesPatch(entityNode.draftVersion?.draft_updates_patch);

  if (changes.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {t_i18n('No field changes detected for this entity')}
      </Typography>
    );
  }

  return <ChangesTable changes={changes} variant="text" />;
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
