import React, { FunctionComponent, useState } from 'react';
import Box from '@mui/material/Box';
import DraftReviewEntityList from './DraftReviewEntityList';
import DraftReviewDiffPanel from './DraftReviewDiffPanel';

interface DraftReviewProps {
  draftId: string;
}

const DraftReview: FunctionComponent<DraftReviewProps> = ({ draftId }) => {
  const [selectedEntityId, setSelectedEntityId] = useState<string | null>(null);

  const handleSelectEntity = (entityId: string) => {
    setSelectedEntityId(entityId);
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
      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        <DraftReviewEntityList
          draftId={draftId}
          selectedEntityId={selectedEntityId}
          onSelectEntity={handleSelectEntity}
        />
      </Box>
      {/* Right column — diff panel */}

      <Box sx={{ flex: 2, overflowY: 'auto', padding: 2 }}>
        <DraftReviewDiffPanel
          draftId={draftId}
          entityId={selectedEntityId}
        />
      </Box>
    </Box>
  );
};

export default DraftReview;
