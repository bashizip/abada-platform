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
      title: 'Abada Platform',
      description: 'The self-hosted runtime for governed AI-driven business processes: APL, Studio, the Agent Worker and Insight on a PostgreSQL-authoritative engine.',
      favicon: '/favicon.svg',
      logo: {
        light: './src/assets/abada-mark-deep.svg',
        dark: './src/assets/abada-mark.svg',
      },
      lastUpdated: true,
      editLink: {
        baseUrl: 'https://github.com/bashizip/abada-platform/edit/dev/documentation/',
      },
      social: [
        {
          icon: 'github',
          label: 'GitHub',
          href: 'https://github.com/bashizip/abada-platform',
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
          label: 'Get started',
          items: [
            { label: 'Quickstart', slug: 'user/quickstart' },
            { label: 'Tutorial: a reviewed AI reply', slug: 'user/first-workflow' },
          ],
        },
        {
          label: 'Build processes',
          items: [
            { label: 'Author processes in APL', slug: 'user/authoring' },
            { label: 'Loops, routes and review decisions', slug: 'user/process-patterns' },
            { label: 'Agent nodes and the Agent Worker', slug: 'user/agent-worker' },
          ],
        },
        {
          label: 'Run and govern',
          items: [
            { label: 'Operate running processes', slug: 'user/operations' },
            { label: 'Insight: governed AI optimization', slug: 'user/studio-insight' },
            { label: 'Users, groups and project access', slug: 'user/studio-administration' },
            { label: 'Troubleshooting', slug: 'user/troubleshooting' },
          ],
        },
        {
          label: 'Deploy the platform',
          items: [
            { label: 'Choose a deployment', slug: 'user' },
            { label: 'Development deployment', slug: 'user/development' },
            { label: 'Production deployment', slug: 'user/production' },
            { label: 'Production identity', slug: 'user/identity' },
            { label: 'Single-VM server', slug: 'user/server' },
            { label: 'Telemetry', slug: 'user/telemetry' },
            { label: 'Scaling', slug: 'user/scaling' },
            { label: 'Backup and upgrades', slug: 'user/backup-upgrade' },
          ],
        },
        {
          label: 'Architecture',
          items: [
            { label: 'Architecture overview', slug: 'architecture' },
            { label: 'The transactional execution core', slug: 'architecture/runtime' },
            { label: 'Native APL and the canonical model', slug: 'architecture/apl' },
            { label: 'Agent Worker execution', slug: 'architecture/agent-worker' },
            { label: 'The Insight Engine', slug: 'architecture/insight' },
            { label: 'Platform deployment', slug: 'architecture/deployment' },
            { label: 'Cluster execution', slug: 'architecture/cluster' },
            { label: 'Security model', slug: 'architecture/security' },
          ],
        },
        {
          label: 'Compatibility & migration',
          items: [
            { label: 'BPMN import and compatibility', slug: 'compatibility/bpmn' },
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