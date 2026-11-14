import { forwardRef, useEffect, useId, useState } from "react";
import * as Primitive from "@radix-ui/react-select";
import { useComposedRefs } from "@radix-ui/react-compose-refs";
import { Check, ChevronDown, ChevronUp } from "lucide-react";
import { cn } from "./utils";
import { useUiLabels } from "./labels";
import {
  ChoiceFormBridge,
  useChoiceState,
  useChoiceTab,
  useChoiceDisabled,
  useChoiceValidation,
  type ChoiceFieldProps,
} from "./choice-field";
export type { ChoiceOption } from "./choice-types";

export interface SelectProps extends ChoiceFieldProps {
  value?: string;
  defaultValue?: string;
  onValueChange?: (value: string) => void;
}

export const Select = forwardRef<HTMLButtonElement, SelectProps>(
  function Select(
    {
      options,
      value,
      defaultValue = "",
      onValueChange,
      name,
      form,
      required,
      disabled,
      placeholder,
      className,
      ...props
    },
    ref,
  ) {
    const ui = useUiLabels();
    const state = useChoiceState(value, defaultValue);
    const presentationForm = `base-choice-presentation-${useId()}`;
    const [trigger, setTrigger] = useState<HTMLButtonElement | null>(null);
    const composedRef = useComposedRefs(ref, setTrigger);
    const fieldDisabled = useChoiceDisabled(trigger, disabled);
    const validation = useChoiceValidation(
      state.value,
      required,
      fieldDisabled,
    );
    const [open, setOpen] = useState(false);
    useEffect(() => {
      if (fieldDisabled) setOpen(false);
    }, [fieldDisabled]);
    const tab = useChoiceTab(trigger, () => setOpen(false));
    const selected = options.find((option) => option.value === state.value);
    const label =
      selected?.label ??
      (state.value
        ? `${state.value} — ${ui.unavailableValue}`
        : (placeholder ?? ui.chooseOne));
    return (
      <>
        {/* Isolate Radix reset/bubble handling; ChoiceFormBridge is the sole form owner. */}
        <Primitive.Root
          form={presentationForm}
          value={state.value}
          open={open}
          onOpenChange={setOpen}
          disabled={fieldDisabled}
          onValueChange={(next) => {
            const option = options.find((option) => option.value === next);
            if (
              fieldDisabled ||
              !option ||
              option.disabled ||
              option.value === state.value
            )
              return;
            state.change(option.value);
            onValueChange?.(option.value);
          }}
        >
          <Primitive.Trigger
            form={form}
            data-value={state.value}
            {...props}
            id={props.id ?? `${presentationForm}-trigger`}
            ref={composedRef}
            className={cn("base-control base-choice-trigger", className)}
            aria-required={required || undefined}
            aria-invalid={
              validation.invalid || props["aria-invalid"] || undefined
            }
            aria-describedby={
              [
                props["aria-describedby"],
                validation.invalid ? validation.errorId : undefined,
              ]
                .filter(Boolean)
                .join(" ") || undefined
            }
            title={props.title ?? label}
          >
            <Primitive.Value
              className="base-choice-summary"
              placeholder={label}
            >
              {label}
            </Primitive.Value>
            <Primitive.Icon asChild>
              <ChevronDown size={16} aria-hidden="true" />
            </Primitive.Icon>
          </Primitive.Trigger>
          <Primitive.Portal container={trigger?.ownerDocument.body}>
            <Primitive.Content
              aria-labelledby={trigger?.id}
              onKeyDown={tab.onKeyDown}
              onCloseAutoFocus={tab.onCloseAutoFocus}
              className="base-choice-panel"
              position="popper"
              sideOffset={4}
              collisionPadding={8}
            >
              <Primitive.ScrollUpButton className="base-choice-scroll">
                <ChevronUp size={16} />
              </Primitive.ScrollUpButton>
              <Primitive.Viewport className="base-choice-viewport">
                {options.map((option) => (
                  <Primitive.Item
                    key={option.value}
                    value={option.value}
                    data-value={option.value}
                    disabled={option.disabled}
                    className="base-choice-option"
                  >
                    <Primitive.ItemIndicator className="base-choice-indicator">
                      <Check size={16} />
                    </Primitive.ItemIndicator>
                    <Primitive.ItemText>{option.label}</Primitive.ItemText>
                  </Primitive.Item>
                ))}
                {!options.length && (
                  <div className="base-choice-empty">{ui.noOptions}</div>
                )}
              </Primitive.Viewport>
              <Primitive.ScrollDownButton className="base-choice-scroll">
                <ChevronDown size={16} />
              </Primitive.ScrollDownButton>
            </Primitive.Content>
          </Primitive.Portal>
        </Primitive.Root>
        <ChoiceFormBridge
          value={state.value}
          resetValue={state.resetValue}
          options={options}
          name={name}
          form={form}
          required={required}
          disabled={fieldDisabled}
          trigger={trigger}
          onReset={() => {
            state.reset();
            validation.reset();
          }}
          onInvalid={validation.onInvalid}
        />
        {validation.invalid && (
          <span
            id={validation.errorId}
            role="alert"
            className="block text-sm text-danger"
          >
            {validation.message}
          </span>
        )}
      </>
    );
  },
);
