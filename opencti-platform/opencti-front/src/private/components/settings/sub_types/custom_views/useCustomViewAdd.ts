import { graphql } from 'react-relay';
import { useState } from 'react';
import { RecordSourceSelectorProxy } from 'relay-runtime';
import { useCustomViewAdd_Mutation, useCustomViewAdd_Mutation$data } from './__generated__/useCustomViewAdd_Mutation.graphql';
import useApiMutation from '../../../../../utils/hooks/useApiMutation';

const customViewAddMutation = graphql`
  mutation useCustomViewAdd_Mutation($input: CustomViewAddInput!) {
    customViewAdd(input: $input) {
      id
      name
      path
      target_entity_type
    }
  }
`;

/**
 * Updates the Relay store after a successful custom view creation in order
 * to insert a new edge in the `customViewsDisplayContext` structure so that
 * the admin user can check out the new custom view in the entity page
 * without the need to refresh.
 */
const customViewsDisplayContextUpdater = (
  store: RecordSourceSelectorProxy<useCustomViewAdd_Mutation$data>,
  data: useCustomViewAdd_Mutation$data | null | undefined,
) => {
  const result = data as useCustomViewAdd_Mutation$data;
  const { target_entity_type, id } = result.customViewAdd;
  const root = store.getRoot();
  const displayContextRecords = root.getLinkedRecords('customViewsDisplayContext') ?? [];
  let targetRecord = displayContextRecords.find(
    (r) => r.getValue('entity_type') === target_entity_type,
  );
  if (!targetRecord) {
    const newDisplayContext = `CustomViewsDisplayContext:${target_entity_type}`;
    targetRecord = store.create(newDisplayContext, 'CustomViewsDisplayContext');
    targetRecord.setValue(target_entity_type, 'entity_type');
    root.setLinkedRecords([...displayContextRecords, targetRecord], 'customViewsDisplayContext');
  }
  const existingInfos = targetRecord.getLinkedRecords('custom_views_info') ?? [];
  const newInfoRecord = store.get(id)!;
  targetRecord.setLinkedRecords([...existingInfos, newInfoRecord], 'custom_views_info');
};

/**
 * Hook handling Custom view creation logic
 */
const useCustomViewAdd = () => {
  const [mutating, setMutating] = useState(false);
  const [commitAddMutation] = useApiMutation<useCustomViewAdd_Mutation>(customViewAddMutation);

  const mutation: typeof commitAddMutation = ({ variables, onCompleted, onError }) => {
    setMutating(true);
    commitAddMutation({
      variables,
      updater: customViewsDisplayContextUpdater,
      onError: (error) => {
        setMutating(false);
        onError?.(error);
      },
      onCompleted: (...args) => {
        setMutating(false);
        onCompleted?.(...args);
      },
    });
  };

  return [mutation, mutating] as const;
};

export default useCustomViewAdd;
