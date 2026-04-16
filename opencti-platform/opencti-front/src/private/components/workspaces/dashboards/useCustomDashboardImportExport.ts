import { graphql } from 'react-relay';
import { fetchQuery } from '../../../../relay/environment';
import useDashboardImportExport from '../../../../components/dashboard/useDashboardImportExport';

const WorkspaceExportHandlerQuery = graphql`
    query useCustomDashboardImportExport_ExportQuery($id: String!) {
        workspace(id: $id) {
            toConfigurationExport
        }
    }
`;

const onExport = async (id: string) => {
  const data = await fetchQuery(WorkspaceExportHandlerQuery, { id })
    .toPromise();
  const result = data as useCustomDashboardImportExport_ExportQuery$data;
  const exportString = result.customView?.toConfigurationExport;
  if (!exportString) {
    throw new Error('Failed to export custom dashboard');
  }
  return exportString;
};

const useCustomDashboardImportExport = () => {
  return useDashboardImportExport({ onExport });
};

export default useCustomDashboardImportExport;
