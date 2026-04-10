import { FunctionComponent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useFormatter } from '../../../components/i18n';
import useDraftContext from '../../../utils/hooks/useDraftContext';
import Tag from '../../../components/common/tag/Tag';
import { useTheme } from '@mui/styles';
import { Theme } from '../../../components/Theme';
import useHelper from '../../../utils/hooks/useHelper';

interface DraftProcessingStatusProps {
  forceRefetch: () => void;
}

const DraftProcessingStatus: FunctionComponent<DraftProcessingStatusProps> = ({ forceRefetch }) => {
  const theme = useTheme<Theme>();
  const { t_i18n } = useFormatter();
  const navigate = useNavigate();
  const { isFeatureEnable } = useHelper();
  const draftContext = useDraftContext();
  const currentDraftId = draftContext ? draftContext.id : '';
  const currentDraftProcessingCount = draftContext?.processingCount ?? 0;
  const isCurrentDraftProcessing = currentDraftProcessingCount > 0;

  const goToDraftProcesses = () => {
    forceRefetch();
    if (!currentDraftId) {
      return;
    }
    const targetPath = isFeatureEnable('DRAFT_WORKFLOW')
      ? `/dashboard/data/import/draft/${currentDraftId}/overview?section=processes`
      : `/dashboard/data/import/draft/${currentDraftId}/entities`;
    navigate(targetPath);
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center' }}>
      {!isCurrentDraftProcessing && (
        <Tag
          color={theme.palette.designSystem.alert.success.primary}
          label={t_i18n('No processes running')}
          onClick={goToDraftProcesses}
        />
      )}
      {isCurrentDraftProcessing && (
        <Tag
          color={theme.palette.designSystem.alert.warning.primary}
          label={`${t_i18n('Processes running')} (${currentDraftProcessingCount})`}
          onClick={goToDraftProcesses}
        />
      )}
    </div>
  );
};

export default DraftProcessingStatus;
