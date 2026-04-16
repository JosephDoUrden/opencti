import { BaseSyntheticEvent, useRef } from 'react';
import fileDownload from 'js-file-download';
import VisuallyHiddenInput from '../../private/components/common/VisuallyHiddenInput';
import { resolveLink } from '../../../utils/Entity';
import { useNavigate } from 'react-router-dom';

interface useDashboardImportExportProps {
  onExport: (entityId: string) => Promise<string>;
}

export const useDashboardExport = ({
  onExport,
}: useDashboardImportExportProps) => {
  const handleExport = (dashboard: { id: string; name: string }) => {
    onExport?.(dashboard.id)
      .then((exportedDashboard: string) => {
        if (!exportedDashboard) {
          return;
        }
        const blob = new Blob([exportedDashboard], {
          type: 'text/json',
        });
        const [day, month, year] = new Date()
          .toLocaleDateString('fr-FR')
          .split('/');
        const fileName = `${year}${month}${day}_octi_dashboard_${dashboard.name}.json`;
        fileDownload(blob, fileName);
      });
  };

  return {
    handleExport,
  };
};

export const useDashboardImport = () => {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [commitImportMutation] = useApiMutation<WorkspaceCreationImportMutation>(importMutation);
  const navigate = useNavigate();

  const _onChange = (event: BaseSyntheticEvent) => {
    const importedFile = event.target.files[0];
    commitImportMutation({
      variables: { file: importedFile },
      onCompleted: (data) => {
        if (inputRef.current) inputRef.current.value = ''; // Reset the input uploader ref
        navigate(
          `${resolveLink('Dashboard')}/${data.workspaceConfigurationImport}`,
        );
      },
      onError: (error) => {
        if (inputRef.current) inputRef.current.value = ''; // Reset the input uploader ref
        handleError(error);
      },
    });
  };

  const handleImport = () => inputRef.current?.click();
  return { _onChange, handleImport, _inputRef: inputRef };
};

export const HiddenImportInput = ({ helpers }: { helpers: ReturnType<typeof useDashboardImport> }) => {
  return <VisuallyHiddenInput type="file" accept="application/JSON" ref={helpers._inputRef} onChange={helpers._onChange} />;
};
