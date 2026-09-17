
function withSelection(body, selection) {
  const sel = (selection ?? '').trim();
  return sel ? `${body}\n\n\`\`\`\n${sel}\n\`\`\`` : body;
}

export const tools = {
  explain: {
    id: 'explain',
    label: 'Explain',
    render: ({ selection }) =>
      withSelection(
        'Explain this code clearly and precisely: what it does, how it works step by step, ' +
          'important edge cases, and any non-obvious behavior. Keep the language of the explanation matched to the code.',
        selection,
      ),
  },
  fix: {
    id: 'fix',
    label: 'Fix',
    render: ({ selection }) =>
      withSelection(
        'The following code has a problem. Analyze it carefully, explain the root cause, then provide the COMPLETE ' +
          'corrected code. Preserve the original formatting, naming, and indentation. Do NOT rewrite unrelated working ' +
          'code — change only what is necessary.',
        selection,
      ),
  },
  improve: {
    id: 'improve',
    label: 'Improve',
    render: ({ selection }) =>
      withSelection(
        'Review this code and improve it: readability, performance, idiomatic style, and safety. Provide the improved ' +
          'code, then a concise bullet list of every change and why. Preserve existing behavior unless it is a bug.',
        selection,
      ),
  },
  generate: {
    id: 'generate',
    label: 'Generate',
    render: ({ selection }) =>
      withSelection(
        'Generate clean, complete, production-quality code for the request below. Include brief comments only where ' +
          'non-obvious. If requirements are ambiguous, state your assumptions first, then write the code.',
        selection,
      ),
  },
};

export function renderTool(action, selection) {
  const tool = tools[action];
  if (!tool) return null;
  return tool.render({ selection });
}

export function listTools() {
  return Object.values(tools).map(({ id, label }) => ({ id, label }));
}
