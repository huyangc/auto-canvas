import { useState } from "react";

/**
 * Auto mode's canvas when the Project has nothing drawn: import a netlist,
 * open a project or an example, or go draw by hand.
 */
export function EmptyStateCard({
  examples,
  onChooseNetlist,
  onOpenProject,
  onOpenExample,
  onDraw,
}: {
  examples: readonly { id: string; name: string; description: string }[];
  onChooseNetlist: () => void;
  onOpenProject: () => void;
  onOpenExample: (id: string) => void;
  onDraw: () => void;
}) {
  const [examplesOpen, setExamplesOpen] = useState(false);
  return (
    <section
      className="auto-empty-state"
      aria-label="Start a schematic"
      data-testid="auto-empty-state"
    >
      <h2>Import a netlist to get a schematic</h2>
      <p className="auto-empty-state-note">
        Drop a netlist (.sp / .spi / .cir / .scs) or a Project file (.json)
        anywhere on this page, or choose one
      </p>
      <div className="auto-empty-state-actions">
        <button
          type="button"
          className="app-action app-action-primary"
          data-testid="empty-choose-netlist"
          onClick={onChooseNetlist}
        >
          Choose netlist file…
        </button>
        <button
          type="button"
          className="app-action"
          data-testid="empty-open-project"
          onClick={onOpenProject}
        >
          Open project file…
        </button>
        <button
          type="button"
          className="app-action"
          data-testid="empty-examples"
          aria-expanded={examplesOpen}
          onClick={() => setExamplesOpen((open) => !open)}
        >
          Start from an example
        </button>
        <button
          type="button"
          className="app-action"
          data-testid="empty-draw"
          onClick={onDraw}
        >
          Draw it yourself →
        </button>
      </div>
      {/* The names render only once asked for. */}
      {examplesOpen ? (
        <ul className="auto-empty-state-examples" aria-label="Examples">
          {examples.map((example) => (
            <li key={example.id}>
              <button
                type="button"
                data-testid={`empty-example-${example.id}`}
                title={example.description}
                onClick={() => onOpenExample(example.id)}
              >
                {example.name}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
