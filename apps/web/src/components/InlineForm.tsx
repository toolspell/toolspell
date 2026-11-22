import { useState, type FormEvent } from "react";

import { Button } from "~/components/ui/button";
import { FieldError } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { errorMessage } from "~/client";

/** One text field and a submit button. Clears on success and shows the server's error otherwise. */
export function InlineForm({
  label,
  placeholder,
  submitLabel,
  onSubmit,
}: {
  readonly label: string;
  readonly placeholder: string;
  readonly submitLabel: string;
  readonly onSubmit: (value: string) => Promise<unknown>;
}) {
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (value.trim() === "") return;
    setPending(true);
    setError(null);
    // No try/finally: React Compiler skips functions that use it.
    const failure = await onSubmit(value.trim()).then(
      () => null,
      (cause: unknown) => errorMessage(cause),
    );
    setPending(false);
    if (failure === null) setValue("");
    else setError(failure);
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-1">
      <div className="flex gap-2">
        <Input
          aria-label={label}
          placeholder={placeholder}
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <Button type="submit" disabled={pending || value.trim() === ""}>
          {submitLabel}
        </Button>
      </div>
      {error && <FieldError>{error}</FieldError>}
    </form>
  );
}
