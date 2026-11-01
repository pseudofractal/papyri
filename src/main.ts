import { mount } from 'svelte';
import App from './App.svelte';
import './style.css';
import { traceStartupPaint } from './lib/startup-trace';
import { prewarmDocumentParser } from './render/client';
if ((window as unknown as { __PAPYRI_PREWARM_MARKDOWN__?: boolean }).__PAPYRI_PREWARM_MARKDOWN__)
  prewarmDocumentParser();
mount(App, { target: document.getElementById('app')! });
traceStartupPaint('shell');
