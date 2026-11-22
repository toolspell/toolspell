// Small JSON files in userData that carry a value from one launch to the next.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";

/** The value last remembered in `file`, or undefined when there is none or it does not parse. */
export const readRemembered = (file: string): unknown => {
  try {
    return JSON.parse(NodeFS.readFileSync(file, "utf8"));
  } catch {
    return undefined;
  }
};

/** Writes a temporary file and renames it, so a crash mid-write never leaves a torn file. */
export const remember = (file: string, value: unknown) => {
  NodeFS.mkdirSync(NodePath.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  NodeFS.writeFileSync(temporary, `${JSON.stringify(value)}\n`);
  NodeFS.renameSync(temporary, file);
};
