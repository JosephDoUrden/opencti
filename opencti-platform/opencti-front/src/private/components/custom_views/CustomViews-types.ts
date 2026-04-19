import type { Widget } from '../../../utils/widget/widget';
import { RootPrivateQuery$data } from '../../__generated__/RootPrivateQuery.graphql';

// Excludes deleted items (null or undefined items in the array)
export type CustomViewsInfo = NonNullable<NonNullable<RootPrivateQuery$data['customViewsDisplayContext']>[number]['custom_views_info'][number]>;

export interface CustomViewManifestConfig {
  startDate?: string;
  endDate?: string;
  relativeDate?: string;
}

export interface CustomViewManifest {
  config?: CustomViewManifestConfig;
  widgets?: Record<string, Widget>;
}
