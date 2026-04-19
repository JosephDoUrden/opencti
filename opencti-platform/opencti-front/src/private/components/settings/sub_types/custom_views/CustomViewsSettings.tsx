import { useState } from 'react';
import { graphql, useFragment } from 'react-relay';
import Grid from '@mui/material/Grid';
import Card from '@common/card/Card';
import Tooltip from '@mui/material/Tooltip';
import { Add as AddIcon } from '@mui/icons-material';
import IconButton from '@common/button/IconButton';
import { useFormatter } from '../../../../../components/i18n';
import { useSubTypeOutletContext } from '../SubTypeOutletContext';
import CustomViewsSettingsDataTable from './CustomViewsSettingsDataTable';
import { CustomViewsSettings_customViews$key } from './__generated__/CustomViewsSettings_customViews.graphql';
import CustomViewFormDrawer from './CustomViewFormDrawer';

const customViewsFragment = graphql`
  fragment CustomViewsSettings_customViews on CustomViewsSettings {
    customViews {
      id
      name
      description
      created_at
      updated_at
    }
  }
`;

/**
 * Custom Views settings page.
 */
const CustomViewsSettings = () => {
  const { t_i18n } = useFormatter();
  const { customViewsSettings, subType } = useSubTypeOutletContext();
  const { customViews } = useFragment<CustomViewsSettings_customViews$key>(
    customViewsFragment,
    customViewsSettings,
  );
  const [isDrawerOpen, setDrawerOpen] = useState(false);

  return (
    <>
      <Grid item xs={12}>
        <Card
          title={t_i18n('Custom Views')}
          sx={{
          // Compensate existing top padding from data table header
          //  to avoid the feeling of having too much empty space.
            pt: 2,
          }}
          action={(
            <Tooltip title={t_i18n('Create a new custom view')}>
              <IconButton
                onClick={() => setDrawerOpen(true)}
                size="small"
              >
                <AddIcon fontSize="small" color="primary" />
              </IconButton>
            </Tooltip>
          )}
        >
          <CustomViewsSettingsDataTable customViews={customViews} targetType={subType.id} />
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
