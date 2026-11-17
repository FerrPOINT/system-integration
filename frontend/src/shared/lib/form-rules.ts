import { formRules } from '../../../build/generated/openapi/form-rules.ts';

type Rule = (typeof formRules)['Title' | 'ActionReason'];

/** Same code-point length and explicit whitespace rule as the OpenAPI contract. */
function validText(value: string, rule: Rule) {
  return (
    !/[\uD800-\uDFFF]/u.test(value) && [...value].length <= rule.maxLength && new RegExp(rule.pattern, 'u').test(value)
  );
}

export const titleInputProps = {
  // HTML maxlength counts UTF-16 units; pattern enforces the actual code-point limit.
  maxLength: formRules.Title.maxLength * 2,
  pattern: '(?=[\\s\\S]{1,' + formRules.Title.maxLength + '}$)' + formRules.Title.pattern,
};
export const reasonCodePointLimit = formRules.ActionReason.maxLength;
export const reasonMaxLength = reasonCodePointLimit * 2;
export const validReason = (value: string) => validText(value, formRules.ActionReason);
export const quantityInputProps = { min: formRules.Quantity.minimum, max: formRules.Quantity.maximum, step: 1 };
export const usernameInputProps = { maxLength: formRules.Username.maxLength, pattern: formRules.Username.pattern };
