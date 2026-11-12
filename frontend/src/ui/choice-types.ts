/** A domain value is never replaced by an internal library key. */
export interface ChoiceOption {
  value: string;
  label: string;
  disabled?: boolean;
}
