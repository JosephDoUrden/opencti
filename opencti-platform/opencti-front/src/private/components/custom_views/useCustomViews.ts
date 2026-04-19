import { getCurrentTab } from '../../../utils/utils';
import useAuth from '../../../utils/hooks/useAuth';
import type { CustomViewsInfo } from './CustomViews-types';

export const DEFAULT_CUSTOM_VIEW_TAB_VALUE = 'default-custom-view';

export const CUSTOM_VIEW_TAB_VALUE = 'custom-view';

function matchPath(customViews: CustomViewsInfo[]) {
  return (fullPath: string, basePath: string) => {
    const current = getCurrentTab(fullPath, basePath);
    const currentCustomView = customViews.find(({ path }) => path === current);
    if (currentCustomView) {
      return currentCustomView.default
        ? DEFAULT_CUSTOM_VIEW_TAB_VALUE
        : CUSTOM_VIEW_TAB_VALUE;
    }
    return undefined;
  };
}

const NO_CUSTOM_VIEWS = {
  customViews: [],
  getCurrentCustomViewTab: () => undefined,
};

export const useCustomViews = (entityType: string) => {
  const { customViews: customViewsContext } = useAuth();
  const customViewsContextForType = customViewsContext.find(({ entity_type }) => entity_type === entityType);
  if (!customViewsContextForType) {
    return NO_CUSTOM_VIEWS;
  }
  const customViews = customViewsContextForType.custom_views_info ?? [];
  const nonNullCustomViews = customViews
    .filter((c) => !!c)
    .filter(({ enabled }) => enabled === true);
  const getCurrentCustomViewTab = matchPath(nonNullCustomViews);
  const sortedCustomViews = [...nonNullCustomViews].sort(
    (lhs, rhs) => lhs.name.localeCompare(rhs.name),
  );
  return {
    customViews: sortedCustomViews,
    getCurrentCustomViewTab,
  };
};
