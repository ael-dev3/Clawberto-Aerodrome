import { describe, expect, it } from 'vitest';
import hermesWorkflow from '../.github/workflows/hermes-check.yml?raw';
import pagesWorkflow from '../.github/workflows/pages.yml?raw';

describe('GitHub Actions workflow hardening', () => {
  it('opts JavaScript actions into Node 24 before GitHub removes Node 20 runner support', () => {
    for (const workflow of [pagesWorkflow, hermesWorkflow]) {
      expect(workflow).toContain('FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true');
    }
  });

  it('keeps the Pages deployment gated by tests before build and deploy', () => {
    expect(pagesWorkflow.indexOf('run: npm test')).toBeGreaterThan(-1);
    expect(pagesWorkflow.indexOf('run: npm run build')).toBeGreaterThan(pagesWorkflow.indexOf('run: npm test'));
    expect(pagesWorkflow.indexOf('uses: actions/deploy-pages@v4')).toBeGreaterThan(pagesWorkflow.indexOf('run: npm run build'));
  });
});
