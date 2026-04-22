import React, { FunctionComponent, useState } from 'react';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import Typography from '@mui/material/Typography';
import { useFormatter } from '../../../components/i18n';
import DraftReviewEntityList from './DraftReviewEntityList';
import DraftReviewDiffPanel from './DraftReviewDiffPanel';

interface DraftReviewProps {
  draftId: string;
}

const DraftReview: FunctionComponent<DraftReviewProps> = ({ draftId }) => {
  const { t_i18n } = useFormatter();
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);
  const [selectedEntityType, setSelectedEntityType] = useState<string | null>(null);

  const handleSelectEntity = (entityId: string, entityType: string) => {
    setSelectedEntityId(entityId);
    setSelectedEntityType(entityType);
  };

  return (
    <Box
      sx={{
        display: 'flex',
        gap: 2,
        height: 'calc(100vh - 250px)',
        minHeight: 400,
      }}
    >
      {/* Left column — entity list */}
      <Paper
        variant="outlined"
        sx={{
          width: 320,
          flexShrink: 0,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <Box sx={{ flex: 1, overflowY: 'auto' }}>
          <DraftReviewEntityList
            draftId={draftId}
            selectedEntityId={selectedEntityId}
            onSelectEntity={handleSelectEntity}
          />
        </Box>
      </Paper>

      {/* Right column — diff panel */}
      <Paper
        variant="outlined"
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <Box sx={{ padding: '12px 16px', borderBottom: '1px solid', borderColor: 'divider' }}>
          <Typography variant="subtitle2" fontWeight="bold">
            {selectedEntityType
              ? t_i18n(`entity_${selectedEntityType}`)
              : t_i18n('Changes')}
          </Typography>
        </Box>
        <Box sx={{ flex: 1, overflowY: 'auto', padding: 2 }}>
          <DraftReviewDiffPanel
            draftId={draftId}
            entityId={selectedEntityId}
          />
        </Box>
      </Paper>
    </Box>
  );
};

export default DraftReview;
