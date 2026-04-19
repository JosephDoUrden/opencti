import { graphql } from 'react-relay';
import { useState } from 'react';
import { useCustomViewAdd_Mutation } from './__generated__/useCustomViewAdd_Mutation.graphql';
import useApiMutation from '../../../../../utils/hooks/useApiMutation';
import { customViewsDisplayContextUpdater } from './store-updaters';

const customViewAddMutation = graphql`
  mutation useCustomViewAdd_Mutation($input: CustomViewAddInput!) {
    customViewAdd(input: $input) {
      id
      name
      path
      target_entity_type
      enabled
      default
    }
  }
`;

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
