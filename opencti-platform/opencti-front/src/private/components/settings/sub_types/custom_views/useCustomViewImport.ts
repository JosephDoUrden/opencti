import { graphql } from 'react-relay';
import { useState } from 'react';
import useApiMutation from '../../../../../utils/hooks/useApiMutation';
import type { useCustomViewImport_Mutation } from './__generated__/useCustomViewImport_Mutation.graphql';
import { customViewsDisplayContextUpdater } from './store-updaters';

const customViewImportMutation = graphql`
  mutation useCustomViewImport_Mutation($target_entity_type: String!, $file: Upload!) {
    customViewConfigurationImport(target_entity_type: $target_entity_type, file: $file) {
      id
      name
      description
      enabled
      default
      path
      target_entity_type
    }
  }
`;

const useCustomViewImport = () => {
  const [mutating, setMutating] = useState(false);
  const [commitImportMutation] = useApiMutation<useCustomViewImport_Mutation>(customViewImportMutation);

  const mutation: typeof commitImportMutation = ({ variables, onCompleted, onError }) => {
    setMutating(true);
    commitImportMutation({
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

export default useCustomViewImport;
