import { describe, it, expect } from 'vitest';
import type { StixBundle } from '../../../../src/types/stix-2-1-common';
import type { StixCaseIncident } from '../../../../src/modules/case/case-incident/case-incident-types';
import { ENTITY_TYPE_CONTAINER_CASE_INCIDENT } from '../../../../src/modules/case/case-incident/case-incident-types';
import { STIX_EXT_OCTI } from '../../../../src/types/stix-2-1-extensions';
import { PLAYBOOK_CONTAINER_WRAPPER_COMPONENT } from '../../../../src/modules/playbook/components/container-wrapper-component';
import { container_wrapper_component_bundle, INCIDENT_ID } from './container-wrapper-component-fixtures';

const buildPlaybookNode = () => ({
  id: 'playbook-node',
  name: 'share-node',
  component_id: 'PLAYBOOK_CONTAINER_WRAPPER_COMPONENT',
  configuration: {
    container_type: ENTITY_TYPE_CONTAINER_CASE_INCIDENT,
    all: false,
    excludeMainElement: false,
    copyFiles: false,
    newContainer: false,
    caseTemplates: [],
  },
});

describe('PLAYBOOK_CONTAINER_WRAPPER_COMPONENT — Incident → Case Incident mapping', () => {
  it('should map all three incident-specific attributes in a single execution', async () => {
    const result = await PLAYBOOK_CONTAINER_WRAPPER_COMPONENT.executor({
      eventId: '',
      executionId: '',
      playbookId: '',
      previousPlaybookNodeId: undefined,
      previousStepBundle: null as StixBundle | null,
      dataInstanceId: INCIDENT_ID,
      playbookNode: buildPlaybookNode(),
      bundle: structuredClone(container_wrapper_component_bundle),
    });

    const caseIncident = result.bundle.objects[1] as StixCaseIncident;

    expect(caseIncident).toBeDefined();
    expect(caseIncident.severity).toBe('high');
    expect(caseIncident.external_references).toEqual([
      {
        source_name: 'upload_file',
        external_id: 'upload_file_example.pdf',
      },
    ]);
    expect(caseIncident.extensions[STIX_EXT_OCTI].granted_refs).toEqual([
      '34a50091-acd7-5b12-88f4-086155cf40d4',
    ]);
  });
});
