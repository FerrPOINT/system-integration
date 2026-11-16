import { textRules } from '../../../build/generated/openapi/text-rules.ts';

type Rule = (typeof textRules)[keyof typeof textRules];

/** Same code-point length and explicit whitespace rule as the OpenAPI contract. */
function validText(value: string, rule: Rule) {
  return (
    !/[\uD800-\uDFFF]/u.test(value) && [...value].length <= rule.maxLength && new RegExp(rule.pattern, 'u').test(value)
  );
}

export const titleInputProps = {
  // HTML maxlength counts UTF-16 units; pattern enforces the actual code-point limit.
  maxLength: textRules.Title.maxLength * 2,
  pattern: '(?=[\\s\\S]{1,' + textRules.Title.maxLength + '}$)' + textRules.Title.pattern,
};
export const reasonMaxLength = textRules.ActionReason.maxLength * 2;
export const validReason = (value: string) => validText(value, textRules.ActionReason);
