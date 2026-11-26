export function NetlistProfileCode({
  text,
  error,
  onChange,
  onBack,
}: {
  text: string;
  error: string | null;
  onChange(text: string): void;
  onBack?: () => void;
}) {
  return (
    <section
      className="netlist-profile-code"
      aria-label="Netlist configuration"
    >
      <div className="netlist-profile-header">
        <h2>Netlist configuration</h2>
        {onBack ? (
          <button
            type="button"
            className="netlist-settings-back"
            data-testid="netlist-settings-back"
            onClick={onBack}
          >
            Back to Netlist
          </button>
        ) : null}
      </div>
      <p>
        Edit or paste the complete JSON. The selected process maps device
        targets and fills missing parameters in the Project. Existing values
        stay unchanged. Format and port case control output spelling.
      </p>
      <textarea
        aria-label="Netlist configuration JSON"
        value={text}
        onChange={(event) => onChange(event.currentTarget.value)}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        wrap="off"
        aria-invalid={!!error}
      />
      {error ? (
        <p role="alert">
          {error} Copying is paused until the configuration is valid.
        </p>
      ) : (
        <p>
          Templates are saved in this browser. Applied device mappings are saved
          with the circuit and can be undone. Model library files belong in the
          Project model sources in Cell Manager.
        </p>
      )}
    </section>
  );
}
