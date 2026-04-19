import Button from '@common/button/Button';
import { Field, Form, Formik } from 'formik';
import { FormikConfig } from 'formik/dist/types';
import * as Yup from 'yup';
import TextField from '../../../../../components/TextField';
import FormButtonContainer from '../../../../../components/common/form/FormButtonContainer';
import MarkdownField from '../../../../../components/fields/MarkdownField';
import { useFormatter } from '../../../../../components/i18n';
import { fieldSpacingContainerStyle } from '../../../../../utils/field';
import { useEffect, useRef } from 'react';

export interface CustomViewFormInputs {
  name: string;
  description: string | null;
}

export type CustomViewFormInputKeys = keyof CustomViewFormInputs;

interface CustomViewFormProps {
  onClose: () => void;
  onSubmit: FormikConfig<CustomViewFormInputs>['onSubmit'];
  defaultValues?: CustomViewFormInputs;
}

const CustomViewForm = ({
  onClose,
  onSubmit,
  defaultValues,
}: CustomViewFormProps) => {
  const { t_i18n } = useFormatter();

  const validation = Yup.object().shape({
    name: Yup.string().trim().required(t_i18n('This field is required')),
    description: Yup.string().nullable(),
  });

  const initialValues: CustomViewFormInputs = defaultValues ?? {
    name: '',
    description: null,
  };
  const nameInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (nameInputRef.current && !isEdition) {
      nameInputRef.current.focus();
    }
  }, []);

  return (
    <Formik<CustomViewFormInputs>
      enableReinitialize={true}
      validationSchema={validation}
      initialValues={initialValues}
      onSubmit={onSubmit}
    >
      {({ submitForm, handleReset, isSubmitting }) => {
        return (
          <Form>
            <Field
              component={TextField}
              variant="standard"
              name="name"
              label={t_i18n('Name')}
              fullWidth={true}
              required
              inputRef={nameInputRef}
            />
            <Field
              component={MarkdownField}
              name="description"
              label={t_i18n('Description')}
              style={fieldSpacingContainerStyle}
              multiline={true}
              rows="4"
            />
            <FormButtonContainer>
              <Button
                variant="secondary"
                disabled={isSubmitting}
                onClick={() => {
                  handleReset();
                  onClose();
                }}
              >
                {t_i18n('Cancel')}
              </Button>
              <Button
                onClick={submitForm}
                disabled={isSubmitting}
              >
                {t_i18n('Create')}
              </Button>
            </FormButtonContainer>
          </Form>
        );
      }}
    </Formik>
  );
};

export default CustomViewForm;
