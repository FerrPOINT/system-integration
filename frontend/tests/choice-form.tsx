import { StrictMode } from 'react';
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Select } from '../src/shared/ui/select';
import '../src/shared/styles/design-tokens.css';
import '../src/shared/styles/controls.css';
import '../src/shared/styles/patterns.css';
import '../src/shared/styles/layout.css';
import '../src/app/shell/shell.css';

const options = [
  { value: 'A', label: 'Alpha' },
  { value: 'B', label: 'Beta' },
  { value: 'C', label: 'Disabled', disabled: true },
];

function ChoiceForm() {
  const [value, setValue] = useState('');
  const [disabled, setDisabled] = useState(false);
  const [entries, setEntries] = useState<unknown[]>([]);
  function inspect(form: HTMLFormElement) {
    setEntries([...new FormData(form)]);
  }
  return (
    <main className="ui-page-stack">
      <h1>Choice field fixture</h1>
      <form
        className="ui-form"
        onSubmit={(event) => {
          event.preventDefault();
          inspect(event.currentTarget);
        }}
      >
        <label htmlFor="controlled">Controlled</label>
        <Select
          id="controlled"
          name="controlled"
          options={options}
          required
          disabled={disabled}
          value={value}
          onValueChange={setValue}
        />
        <fieldset disabled={disabled}>
          <legend>Native fieldset</legend>
          <label htmlFor="uncontrolled">Uncontrolled</label>
          <Select id="uncontrolled" name="uncontrolled" options={options} defaultValue="A" />
        </fieldset>
        <button type="submit">Submit</button>
        <button type="reset">Reset</button>
        <button type="button" onClick={(event) => inspect(event.currentTarget.form!)}>
          Inspect FormData
        </button>
        <button type="button" onClick={() => setDisabled((current) => !current)}>
          Toggle disabled
        </button>
        <button type="button" onClick={() => setValue('RETIRED')}>
          Use unavailable value
        </button>
      </form>
      <output role="status">{JSON.stringify(entries)}</output>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ChoiceForm />
  </StrictMode>,
);
