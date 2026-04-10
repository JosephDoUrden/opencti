import { FunctionComponent, useEffect, useRef } from 'react';
import { Alert, Paper } from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { useFormatter } from '../../../components/i18n';
import DraftTasks from './DraftTasks';

interface DraftProcessMonitoringPanelProps {
  draftId: string;
}

const DraftProcessMonitoringPanel: FunctionComponent<DraftProcessMonitoringPanelProps> = ({ draftId }) => {
  const { t_i18n } = useFormatter();
  const [searchParams] = useSearchParams();
  const panelRef = useRef<HTMLDivElement | null>(null);

  const shouldFocus = searchParams.get('section') === 'processes';

  useEffect(() => {
    if (shouldFocus && panelRef.current) {
      panelRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [shouldFocus]);

  return (
    <Paper
      ref={panelRef}
      variant="outlined"
      sx={{ p: 2, mb: 3 }}
      data-testid="draft-process-monitoring-panel"
    >
      <Alert severity="info" sx={{ mb: 2 }}>
        {t_i18n('This section lists background tasks for this draft. Expand a task to see its associated work execution details.')}
      </Alert>
      <DraftTasks draftId={draftId} />
    </Paper>
  );
};

export default DraftProcessMonitoringPanel;
