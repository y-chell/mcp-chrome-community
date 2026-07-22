import { parseCodexModelCatalog } from './codex';

describe('Codex model catalog', () => {
  test('parses runtime models and their current reasoning efforts', () => {
    const models = parseCodexModelCatalog(
      JSON.stringify({
        models: [
          {
            slug: 'gpt-5.6-sol',
            display_name: 'GPT-5.6-Sol',
            description: 'Latest frontier agentic coding model.',
            default_reasoning_level: 'low',
            supported_reasoning_levels: [
              { effort: 'low' },
              { effort: 'xhigh' },
              { effort: 'max' },
              { effort: 'ultra' },
              { effort: 'future-value' },
            ],
            input_modalities: ['text', 'image'],
            visibility: 'list',
          },
          {
            slug: 'hidden-model',
            display_name: 'Hidden',
            visibility: 'hide',
          },
        ],
      }),
    );

    expect(models).toEqual([
      {
        id: 'gpt-5.6-sol',
        name: 'GPT-5.6-Sol',
        description: 'Latest frontier agentic coding model.',
        supportsImages: true,
        supportedReasoningEfforts: ['low', 'xhigh', 'max', 'ultra'],
        defaultReasoningEffort: 'low',
      },
    ]);
  });

  test('rejects malformed catalogs', () => {
    expect(() => parseCodexModelCatalog('{}')).toThrow('models array');
  });
});
