import { defineRule, type ESTree } from "@oxlint/plugins";

// Tailwind loops that change a value on every frame, so the compositor repaints at the
// display's refresh rate for as long as they are mounted.
const LOOPS = new Set(["animate-pulse", "animate-ping", "animate-bounce"]);

const MESSAGES = {
  "transition-all":
    "transition-all also animates layout and theme switches. Name the properties that change, such as transition-colors or transition-[box-shadow,translate].",
  loop: "This animation repaints every frame for as long as it is mounted. Show a static state, or the stepped animate-skeleton for a loading placeholder.",
  "animate-spin":
    "Use <Spinner> from components/ui, and only for short pending work; a status that can last stays static.",
} as const;

/** The utility a class token applies, without variants (`hover:`, `data-[x]:`) or `!`. */
const utilityOf = (token: string) => {
  let depth = 0;
  let start = 0;
  for (let index = 0; index < token.length; index++) {
    const char = token[index];
    if (char === "[" || char === "(") depth++;
    else if (char === "]" || char === ")") depth--;
    else if (char === ":" && depth === 0) start = index + 1;
  }
  return token.slice(start).replace(/^!|!$/g, "");
};

const problemOf = (utility: string): keyof typeof MESSAGES | undefined => {
  if (utility === "transition-all") return "transition-all";
  if (utility === "animate-spin") return "animate-spin";
  if (LOOPS.has(utility)) return "loop";
  if (utility.startsWith("animate-[") && utility.includes("infinite")) return "loop";
  return undefined;
};

export default defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow class names for animations that repaint continuously and for transition-all.",
    },
  },
  create(context) {
    const check = (node: ESTree.Node, text: string | null | undefined) => {
      if (!text) return;
      for (const token of text.split(/\s+/)) {
        const problem = problemOf(utilityOf(token));
        if (problem) context.report({ node, message: MESSAGES[problem] });
      }
    };
    return {
      Literal(node) {
        if (typeof node.value === "string") check(node, node.value);
      },
      TemplateElement(node) {
        check(node, node.value.cooked);
      },
    };
  },
});
