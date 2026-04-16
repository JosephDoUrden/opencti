import { BaseSyntheticEvent, useRef, useState } from 'react';
import { graphql, useFragment } from 'react-relay';
import Grid from '@mui/material/Grid';
import Card from '@common/card/Card';
import Tooltip from '@mui/material/Tooltip';
import { Add as AddIcon, CloudUploadOutlined } from '@mui/icons-material';
import IconButton from '@common/button/IconButton';
import { useFormatter } from '../../../../../components/i18n';
import { useSubTypeOutletContext } from '../SubTypeOutletContext';
import CustomViewsSettingsDataTable from './CustomViewsSettingsDataTable';
import { CustomViewsSettings_customViews$key } from './__generated__/CustomViewsSettings_customViews.graphql';
import CustomViewFormDrawer from './CustomViewFormDrawer';
import useCustomViewImport from './useCustomViewImport';
import VisuallyHiddenInput from '@components/common/VisuallyHiddenInput';
import { handleError, MESSAGING$ } from '../../../../../relay/environment';
import { useNavigate } from 'react-router-dom';

const customViewsFragment = graphql`
  fragment CustomViewsSettings_customViews on CustomViewsSettings {
    customViews {
      id
      name
      description
      created_at
      updated_at
      enabled
      default
    }
  }
`;

/**
 * Custom Views settings page.
 */
const CustomViewsSettings = () => {
  const { t_i18n } = useFormatter();
  const inputFileRef = useRef<HTMLInputElement>(null);
  const { customViewsSettings, subType } = useSubTypeOutletContext();
  const { customViews } = useFragment<CustomViewsSettings_customViews$key>(
    customViewsFragment,
    customViewsSettings,
  );
  const nonDeletedCustomViews = customViews.filter((c) => !!c);
  const [isDrawerOpen, setDrawerOpen] = useState(false);
  const [commitImportMutation, importMutating] = useCustomViewImport();
  const navigate = useNavigate();

  const onUpload = (event: BaseSyntheticEvent) => {
    const importedFile = event.target.files[0];
    if (importedFile) {
      commitImportMutation({
        variables: { target_entity_type: subType.id, file: importedFile },
        onError: (e) => {
          if (inputFileRef.current) inputFileRef.current.value = '';
          handleError(e);
        },
        onCompleted: (response) => {
          if (inputFileRef.current) inputFileRef.current.value = '';
          if (response.customViewConfigurationImport) {
            const { id, target_entity_type } = response.customViewConfigurationImport;
            MESSAGING$.notifySuccess(t_i18n('Custom view created'));
            navigate(`/dashboard/settings/customization/entity_types/${target_entity_type}/custom-views/${id}`);
          }
        },
      });
    }
  };

  return (
    <>
      <VisuallyHiddenInput
        ref={inputFileRef}
        type="file"
        accept="application/JSON"
        onChange={onUpload}
      />
      <Grid item xs={12}>
        <Card
          title={t_i18n('Custom Views')}
          sx={{
          // Compensate existing top padding from data table header
          //  to avoid the feeling of having too much empty space.
            pt: 2,
          }}
          action={(
            <>
              <Tooltip title={t_i18n('Create a new custom view')}>
                <IconButton
                  onClick={() => setDrawerOpen(true)}
                  size="small"
                >
                  <AddIcon fontSize="small" color="primary" />
                </IconButton>
              </Tooltip>
              <Tooltip title={t_i18n('Import a custom view')}>
                <IconButton
                  disabled={importMutating}
                  onClick={() => inputFileRef.current?.click()}
                  size="small"
                >
                  <CloudUploadOutlined fontSize="small" color="primary" />
                </IconButton>
              </Tooltip>
            </>
          )}
        >
          <CustomViewsSettingsDataTable customViews={nonDeletedCustomViews} targetType={subType.id} />
        </Card>
      </Grid>
      <CustomViewFormDrawer
        isOpen={isDrawerOpen}
        entityType={subType.id}
        onClose={() => {
          setDrawerOpen(false);
        }}
      />
    </>
  );
};

export default CustomViewsSettings;
