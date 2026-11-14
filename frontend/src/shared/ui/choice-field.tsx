import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ButtonHTMLAttributes,
} from 'react';
import type { ChoiceOption } from './choice-types';
import { useUiLabels } from './labels';

export interface ChoiceFieldProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'value' | 'defaultValue' | 'onChange' | 'children'
> {
  options: readonly ChoiceOption[];
  name?: string;
  form?: string;
  required?: boolean;
  placeholder?: string;
}

export function useChoiceState<T>(value: T | undefined, defaultValue: T) {
  const [local, setLocal] = useState(defaultValue);
  const [initial] = useState(defaultValue);
  return {
    value: value === undefined ? local : value,
    change: (next: T) => {
      if (value === undefined) setLocal(next);
    },
    reset: () => {
      if (value === undefined) setLocal(initial);
    },
    resetValue: value === undefined ? initial : value,
  };
}

/** Only this bridge owns native submission, constraint validation and reset. */
export function ChoiceFormBridge({
  value,
  options,
  name,
  form,
  required,
  disabled,
  trigger,
  onReset,
  resetValue,
  onInvalid,
}: {
  value: string;
  resetValue: string;
  options: readonly ChoiceOption[];
  name?: string;
  form?: string;
  required?: boolean;
  disabled?: boolean;
  trigger: HTMLButtonElement | null;
  onReset: () => void;
  onInvalid: () => void;
}) {
  const ui = useUiLabels();
  const ref = useRef<HTMLSelectElement>(null);
  const reset = useRef({ onReset, resetValue });
  useLayoutEffect(() => {
    reset.current = { onReset, resetValue };
  });
  useEffect(() => {
    const control = ref.current;
    const owner = control?.form;
    if (!control || !owner) return;
    let pending: ReturnType<typeof setTimeout>;
    const handler = (event: Event) => {
      clearTimeout(pending);
      pending = setTimeout(() => {
        if (event.defaultPrevented) return;
        reset.current.onReset();
        // Restore after the native reset default action has finished.
        control.value = reset.current.resetValue;
      });
    };
    owner.addEventListener('reset', handler);
    return () => {
      owner.removeEventListener('reset', handler);
      clearTimeout(pending);
    };
  }, [form, trigger]);
  // Native required single-selects treat only the first empty option as a placeholder.
  const formOptions = [
    ...options.filter((option) => option.value === ''),
    ...options.filter((option) => option.value !== ''),
  ];
  const missing = value !== '' && !options.some((option) => option.value === value);
  return (
    <select
      ref={ref}
      data-base-choice-bridge=""
      aria-hidden="true"
      tabIndex={-1}
      className="base-choice-bridge"
      name={name}
      form={form}
      required={required}
      disabled={disabled}
      value={value}
      onChange={() => {}}
      onInvalid={(event) => {
        event.preventDefault();
        onInvalid();
        trigger?.focus();
      }}
    >
      {!options.some((option) => option.value === '') && <option value="" />}
      {formOptions.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
      {missing && (
        <option value={value}>
          {value} — {ui.unavailableValue}
        </option>
      )}
    </select>
  );
}

/** A field leaves its popup on Tab; Radix action-menu defaults intentionally trap it. */
export function useChoiceTab(trigger: HTMLButtonElement | null, close: () => void) {
  const tabbing = useRef(false);
  return {
    onCloseAutoFocus: (event: Event) => {
      // A delayed popup close must not steal focus from the next field.
      const owner = trigger?.ownerDocument;
      const active = owner?.activeElement;
      const closingScope = event.currentTarget;
      const movedOutside =
        active &&
        active !== owner?.body &&
        active !== trigger &&
        closingScope instanceof Node &&
        !closingScope.contains(active);
      if (tabbing.current || movedOutside) event.preventDefault();
      tabbing.current = false;
    },
    onKeyDown: (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      event.preventDefault();
      tabbing.current = true;
      close();
      if (!trigger) return;
      const scope = trigger.closest('[role="dialog"], [role="alertdialog"], dialog') ?? trigger.ownerDocument;
      const fields = [
        ...scope.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]'),
      ].filter(
        (element) =>
          element.tabIndex >= 0 &&
          !element.closest('[role="menu"], [role="listbox"]') &&
          !element.closest('[inert]') &&
          !element.matches(':disabled') &&
          element.getClientRects().length > 0,
      );
      const next =
        fields[fields.indexOf(trigger) + (event.shiftKey ? -1 : 1)] ??
        (scope === trigger.ownerDocument ? trigger : fields[event.shiftKey ? fields.length - 1 : 0]);
      setTimeout(() => next?.focus(), 0);
    },
  };
}

/** Native fieldset disabling must also cover portalled options. */
export function useChoiceDisabled(trigger: HTMLElement | null, disabled: boolean | undefined) {
  const [fieldsetDisabled, setFieldsetDisabled] = useState(false);
  useLayoutEffect(() => {
    if (!trigger) return;
    const fieldsets: HTMLFieldSetElement[] = [];
    for (let parent = trigger.parentElement; parent; parent = parent.parentElement)
      if (parent.tagName === 'FIELDSET') fieldsets.push(parent as HTMLFieldSetElement);
    const update = () =>
      setFieldsetDisabled(
        fieldsets.some(
          (fieldset) => fieldset.disabled && !fieldset.querySelector(':scope > legend')?.contains(trigger),
        ),
      );
    update();
    const observer = new MutationObserver(update);
    for (const fieldset of fieldsets)
      observer.observe(fieldset, {
        attributes: true,
        attributeFilter: ['disabled'],
      });
    return () => observer.disconnect();
  }, [trigger]);
  return disabled || fieldsetDisabled;
}

export function useChoiceValidation(value: string, required: boolean | undefined, disabled: boolean | undefined) {
  const labels = useUiLabels();
  const [attempted, setAttempted] = useState(false);
  const errorId = useId();
  const invalid = attempted && required && !disabled && !value;
  return {
    invalid,
    errorId,
    onInvalid: () => setAttempted(true),
    reset: () => setAttempted(false),
    message: labels.chooseOne,
  };
}
