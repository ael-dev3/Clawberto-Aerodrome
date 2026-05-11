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
    expect(pagesWorkflow.indexOf('uses: actions/deploy-pages@v5')).toBeGreaterThan(pagesWorkflow.indexOf('run: npm run build'));
  });

  it('uses action majors that target the current GitHub runner runtime', () => {
    expect(pagesWorkflow).toContain('uses: actions/checkout@v6');
    expect(pagesWorkflow).toContain('uses: actions/setup-node@v6');
    expect(pagesWorkflow).toContain('uses: actions/configure-pages@v6');
    expect(pagesWorkflow).toContain('uses: actions/upload-pages-artifact@v5');
    expect(pagesWorkflow).toContain('uses: actions/deploy-pages@v5');
    expect(hermesWorkflow).toContain('uses: actions/checkout@v6');
    expect(hermesWorkflow).toContain('uses: actions/setup-python@v6');
  });
});
