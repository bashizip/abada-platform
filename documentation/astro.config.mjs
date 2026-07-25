import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import mermaid from 'astro-mermaid';

export default defineConfig({
  site: 'https://abada-engine-docs.vercel.app',
  integrations: [
    mermaid({
      autoTheme: true,
      enableLog: false,
      mermaidConfig: {
        flowchart: { curve: 'basis' },
        sequence: { mirrorActors: false },
      },
    }),
    starlight({
      title: 'Abada Engine',
      description: 'User, architecture and developer guides for the Abada BPMN orchestration platform.',
      favicon: '/favicon.svg',
      lastUpdated: true,
      editLink: {
        baseUrl: 'https://github.com/bashizip/abada-engine/edit/dev/documentation/',
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/bashizip/abada-engine',
        },
      ],
      customCss: ['./src/styles/custom.css'],
      sidebar: [
        {
          label: 'Start here',
          items: [
            { label: 'Documentation home', slug: 'index' },
            { label: 'Guide scope and contracts', slug: 'scope' },
          ],
        },
        {
          label: 'User guide',
          items: [
            { label: 'Choose a deployment', slug: 'user' },
            { label: 'Quickstart', slug: 'user/quickstart' },
            { label: 'Your first workflow', slug: 'user/first-workflow' },
            { label: 'Development deployment', slug: 'user/development' },
            { label: 'Production deployment', slug: 'user/production' },
            { label: 'Production identity', slug: 'user/identity' },
            { label: 'Telemetry', slug: 'user/telemetry' },
            { label: 'Scaling', slug: 'user/scaling' },
            { label: 'Backup and upgrades', slug: 'user/backup-upgrade' },
            { label: 'Troubleshooting', slug: 'user/troubleshooting' },
          ],
        },
        {
          label: 'Architecture',
          items: [
            { label: 'Architecture overview', slug: 'architecture' },
            { label: 'Platform deployment', slug: 'architecture/deployment' },
            { label: 'Runtime and transactions', slug: 'architecture/runtime' },
            { label: 'Cluster execution', slug: 'architecture/cluster' },
            { label: 'Security model', slug: 'architecture/security' },
            { label: 'BPMN canonical model', slug: 'architecture/bpmn' },
          ],
        },
        {
          label: 'Developer guide',
          items: [
            { label: 'Developer overview', slug: 'developer' },
            { label: 'Repository map', slug: 'developer/repository' },
            { label: 'Engine changes', slug: 'developer/engine' },
            { label: 'Database changes', slug: 'developer/database' },
            { label: 'API and worker contracts', slug: 'developer/contracts' },
            { label: 'Testing and verification', slug: 'developer/testing' },
            { label: 'Writing documentation', slug: 'developer/documentation' },
          ],
        },
        {
          label: 'Reference',
          items: [
            { label: 'Authoritative contracts', slug: 'reference/contracts' },
          ],
        },
      ],
    }),
  ],
});
